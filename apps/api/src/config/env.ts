/** Environment configuration — validated once at boot so a misconfigured
 *  deployment fails fast instead of throwing on the first request. */
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Node's built-in .env loader — no dotenv dependency. Real environment
// variables always win, so containers and CI override the file.
const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const file of ['.env.local', '.env']) {
  const path = resolve(apiRoot, file);
  if (existsSync(path)) {
    try {
      process.loadEnvFile(path);
    } catch {
      /* malformed or unreadable file — validation below reports what is missing */
    }
  }
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z
    .string()
    .min(24, 'SESSION_SECRET must be at least 24 characters')
    // A placeholder passes the length check too — reject the obvious ones.
    .refine((s) => !/^(replace-me|changeme|secret|password)/i.test(s), 'SESSION_SECRET looks like a placeholder'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  UPLOAD_DIR: z.string().default('./uploads'),
  /**
   * Whether strangers can create an account.
   *
   * Defaults to open, which is what a local or self-hosted first run needs —
   * somebody has to create the first workspace. On a public domain turn it off
   * once the team is onboarded: existing members keep inviting each other, and
   * the sign-up form stops being an open door.
   */
  ALLOW_PUBLIC_REGISTRATION: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  MAX_UPLOAD_BYTES: z.coerce.number().int().default(10 * 1024 * 1024),
  RATE_LIMIT_MAX: z.coerce.number().int().default(600),
  /**
   * Ceiling for credential endpoints (register / login), per IP per 5 minutes.
   * Deliberately separate from the global limit and deliberately not tiny: a
   * whole office behind one NAT shares an IP, and locking them all out after a
   * handful of sign-ins is a worse failure than the attack it prevents.
   * Test runs raise it via the environment.
   */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(30),
  /**
   * Which proxies to trust when deriving the client IP from X-Forwarded-For.
   * Empty (default) trusts no proxy: the header is ignored and the socket
   * address is used, so a client cannot spoof its IP past the rate limiter.
   * A bare integer means that many proxy hops; anything else is a
   * comma-separated list of trusted proxy IPs/CIDRs.
   */
  TRUST_PROXY: z.string().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = load();
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** `trustProxy` option for Fastify, parsed from TRUST_PROXY. */
export const trustProxy: boolean | number | string[] = (() => {
  const raw = env.TRUST_PROXY.trim();
  if (!raw) return false;
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
  return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
})();

/**
 * Origins allowed to call the API with credentials.
 *
 * Outside production the loopback dev server is also trusted on whatever port
 * it ended up on: Vite moves to 5174, 5175… when 5173 is already taken, and
 * without this a developer whose 5173 is busy gets an opaque 403 on every
 * write. Production trusts only what WEB_ORIGIN names.
 */
const configuredOrigins = env.WEB_ORIGIN.split(',')
  .map((o) => o.trim())
  .filter(Boolean);

export const allowedOrigins: (string | RegExp)[] = isProd
  ? configuredOrigins
  : [...configuredOrigins, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

/** Whether a browser Origin header is allowed to make a credentialed call. */
export function isAllowedOrigin(origin: string): boolean {
  return allowedOrigins.some((allowed) =>
    typeof allowed === 'string' ? allowed === origin : allowed.test(origin),
  );
}
