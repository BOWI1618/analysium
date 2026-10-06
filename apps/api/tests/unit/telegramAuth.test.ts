import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyInitData } from '../../src/domain/telegramAuth';

const TOKEN = '123456:TEST-TOKEN';
const now = new Date('2026-10-05T12:00:00.000Z');
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/** Signs launch data the way Telegram does. */
function sign(fields: Record<string, string>, token = TOKEN): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const fields = (overrides: Record<string, string> = {}) => ({
  auth_date: String(seconds(now) - 60),
  query_id: 'AAH',
  user: JSON.stringify({ id: 4242, first_name: 'Мария' }),
  ...overrides,
});

describe('вход из Telegram: проверка данных запуска', () => {
  it('подписанные Telegram данные дают номер пользователя', () => {
    expect(verifyInitData(sign(fields()), TOKEN, now)).toBe('4242');
  });

  it('чужая подпись, подмена пользователя и пустой токен не проходят', () => {
    expect(verifyInitData(sign(fields(), 'другой:токен'), TOKEN, now)).toBeNull();

    const tampered = new URLSearchParams(sign(fields()));
    tampered.set('user', JSON.stringify({ id: 1, first_name: 'Мария' }));
    expect(verifyInitData(tampered.toString(), TOKEN, now)).toBeNull();

    expect(verifyInitData(sign(fields(), ''), '', now)).toBeNull();
    expect(verifyInitData('user=%7B%22id%22%3A4242%7D', TOKEN, now)).toBeNull();
  });

  it('данные старше суток не принимаются', () => {
    const old = sign(fields({ auth_date: String(seconds(now) - 25 * 60 * 60) }));
    expect(verifyInitData(old, TOKEN, now)).toBeNull();
  });
});
