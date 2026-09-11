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
  SESSION_SECRET: z.string().min(24, 'SESSION_SECRET must be at least 24 characters'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  UPLOAD_DIR: z.string().default('./uploads'),
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

/** Origins allowed to call the API with credentials. */
export const allowedOrigins = env.WEB_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
