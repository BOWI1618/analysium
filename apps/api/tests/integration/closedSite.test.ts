import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { disconnectTestDb, migrateTestSchema } from '../setup';

/**
 * The installation as it runs in production: nobody signs up on their own.
 *
 * Every other suite runs with sign-up open, because that is how its accounts
 * are made. Here the switch is off — set before the application is loaded, as
 * the configuration is read once — and the database starts empty.
 */
let app: FastifyInstance;

type Session = { user: { id: string; email: string }; workspaces: { id: string; role: string }[] };
const cookieOf = (raw: string | string[] | undefined) =>
  ([raw].flat().find((value) => value?.startsWith('fd_session=')) ?? '').split(';')[0]!;

const register = (name: string, email: string) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { name, email, password: 'password123' } });
const config = async () => (await app.inject({ method: 'GET', url: '/api/v1/auth/config' })).json();
const call = (cookie: string, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { cookie }, ...(payload ? { payload: payload as never } : {}) });

let ownerCookie: string;
let workspaceId: string;

beforeAll(async () => {
  process.env.ALLOW_PUBLIC_REGISTRATION = 'false';
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

describe('закрытая установка', () => {
  it('первый аккаунт создаётся свободно и становится владельцем; после него регистрации нет', async () => {
    // Nobody has an account yet: somebody has to be first.
    expect((await config()).registrationOpen).toBe(true);
    const first = await register('Первый Владелец', 'owner');
    expect(first.statusCode).toBe(201);
    const session = first.json() as Session;
    expect(session.workspaces[0]!.role).toBe('OWNER');
    ownerCookie = cookieOf(first.headers['set-cookie']);
    workspaceId = session.workspaces[0]!.id;

    expect((await config()).registrationOpen).toBe(false);
    const stranger = await register('Посторонний Человек', 'stranger');
    expect(stranger.statusCode).toBe(403);
    expect(stranger.json().error.message).toContain('Регистрация закрыта');
    // And no account was left behind by the attempt.
    const { prisma } = await import('../../src/lib/prisma');
    expect(await prisma.user.count()).toBe(1);
  });

  it('человек попадает внутрь по ссылке владельца и нового пространства завести не может', async () => {
    const link = await call(ownerCookie, 'POST', `/workspaces/${workspaceId}/invite-codes`, { role: 'ADMIN' });
    expect(link.statusCode).toBe(201);

    const joined = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/join',
      payload: { code: link.json().code, name: 'Приглашённый Админ', email: 'invited.admin', password: 'password123' },
    });
    expect(joined.statusCode).toBe(201);
    const session = joined.json() as Session;
    expect(session.workspaces).toEqual([expect.objectContaining({ id: workspaceId, role: 'ADMIN' })]);
    const adminCookie = cookieOf(joined.headers['set-cookie']);

    // Let in — but not let to let others in: no links, and no workspace of their own to invite into.
    expect((await call(adminCookie, 'POST', `/workspaces/${workspaceId}/invite-codes`, { role: 'GUEST' })).statusCode).toBe(403);
    const side = await call(adminCookie, 'POST', '/workspaces', { name: 'Боковая дверь' });
    expect(side.statusCode).toBe(403);
    // The owner still may: a second workspace is theirs to open.
    expect((await call(ownerCookie, 'POST', '/workspaces', { name: 'Второе пространство' })).statusCode).toBe(201);
  });

  it('без ссылки внутрь не попасть: выдуманный код не подходит', async () => {
    const guessed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/join',
      payload: { code: 'AAAA-BBBB', name: 'Угадавший Код', email: 'guesser', password: 'password123' },
    });
    expect(guessed.statusCode).toBe(400);
  });
});
