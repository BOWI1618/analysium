/**
 * Proof that a Mini App was opened by a particular Telegram account.
 *
 * When Analysium is opened inside Telegram, the client hands the page a string
 * of launch data signed by Telegram with the bot's token. Nobody but Telegram
 * and this server knows the token, so a valid signature means the «user» in
 * the data is who opened the app — which is what lets a person who connected
 * Telegram in without typing a password.
 *
 * The check is Telegram's own recipe: every field except `hash`, sorted and
 * joined as `key=value` lines, signed with HMAC-SHA256 under a key derived
 * from the bot token.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Launch data older than this is refused: a copied string must not work forever. */
const MAX_AGE_SECONDS = 24 * 60 * 60;

/** The Telegram user id behind valid launch data, or null when it does not check out. */
export function verifyInitData(initData: string, botToken: string, now = new Date()): string | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !botToken) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const authDate = Number(params.get('auth_date'));
  const age = now.getTime() / 1000 - authDate;
  if (!Number.isFinite(authDate) || age > MAX_AGE_SECONDS || age < -300) return null;

  try {
    const user = JSON.parse(params.get('user') ?? '') as { id?: unknown };
    return typeof user.id === 'number' ? String(user.id) : null;
  } catch {
    return null;
  }
}
