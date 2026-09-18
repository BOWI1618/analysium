import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { disconnectTestDb, migrateTestSchema, registerUser, type TestUser } from '../setup';

let app: FastifyInstance;
let user: TestUser;

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();
  user = await registerUser(app, { name: 'Фото Профилева' });
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

const BOUNDARY = '----analysium-avatar';
const bytes = Buffer.from('не совсем png, но для хранения это неважно');

const upload = (mimeType: string, filename = 'me.png') =>
  app.inject({
    method: 'POST',
    url: '/api/v1/me/avatar',
    headers: { cookie: user.cookie, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload: Buffer.concat([
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
    ]),
  });

const sessionAvatar = async () =>
  (await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: user.cookie } })).json().user
    .avatarUrl as string | null;

describe('фото профиля', () => {
  it('загружается с компьютера, отдаётся по своему адресу и убирается', async () => {
    const response = await upload('image/png');
    expect(response.statusCode).toBe(200);
    const { avatarUrl } = response.json();
    expect(avatarUrl).toMatch(new RegExp(`^/api/v1/users/${user.id}/avatar\\?v=`));
    expect(await sessionAvatar()).toBe(avatarUrl);

    const picture = await app.inject({ method: 'GET', url: avatarUrl, headers: { cookie: user.cookie } });
    expect(picture.statusCode).toBe(200);
    expect(picture.headers['content-type']).toBe('image/png');
    expect(picture.rawPayload.equals(bytes)).toBe(true);

    const removed = await app.inject({ method: 'DELETE', url: '/api/v1/me/avatar', headers: { cookie: user.cookie } });
    expect(removed.statusCode).toBe(204);
    expect(await sessionAvatar()).toBeNull();
    const gone = await app.inject({ method: 'GET', url: avatarUrl, headers: { cookie: user.cookie } });
    expect(gone.statusCode).toBe(404);
  });

  it('SVG и прочие не-картинки не принимаются', async () => {
    expect((await upload('image/svg+xml', 'me.svg')).statusCode).toBe(400);
    expect((await upload('application/pdf', 'me.pdf')).statusCode).toBe(400);
  });
});
