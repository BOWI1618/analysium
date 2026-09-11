/**
 * Password hashing with node's built-in scrypt — no native module to build,
 * memory-hard, and parameterised in the stored string so cost can be raised
 * later without invalidating existing hashes.
 *
 * Format: scrypt$N$r$p$<salt-b64>$<hash-b64>
 */
import { randomBytes, scrypt, timingSafeEqual, createHash, type ScryptOptions } from 'node:crypto';

/** promisify() drops scrypt's options overload, so wrap it by hand. */
function scryptAsync(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derived) => (err ? reject(err) : resolve(derived)));
  });
}

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password.normalize('NFKC'), salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const salt = Buffer.from(saltB64!, 'base64');
  const expected = Buffer.from(hashB64!, 'base64');

  try {
    const derived = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: 128 * 1024 * 1024,
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Opaque session/invite tokens: random secret to the client, digest to the DB. */
export function generateToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
