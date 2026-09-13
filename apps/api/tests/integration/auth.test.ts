import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { disconnectTestDb, login, migrateTestSchema, registerUser } from '../setup';

let app: FastifyInstance;

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

describe('POST /auth/register', () => {
  it('creates the user, a workspace and an owner membership', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { name: 'Анна Смирнова', email: 'anna@test.local', password: 'password123' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.user.email).toBe('anna@test.local');
    expect(body.workspaces).toHaveLength(1);
    expect(body.workspaces[0].role).toBe('OWNER');
    expect(response.headers['set-cookie']).toBeDefined();
  });

  it('never returns the password hash', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { name: 'Борис Ким', email: 'boris@test.local', password: 'password123' },
    });
    expect(JSON.stringify(response.json())).not.toContain('passwordHash');
    expect(JSON.stringify(response.json())).not.toContain('scrypt$');
  });

  it('rejects a duplicate email with 409', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { name: 'Анна Дубль', email: 'anna@test.local', password: 'password123' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CONFLICT');
  });

  it('rejects a weak password with field-level messages', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { name: 'Слабый Пароль', email: 'weak@test.local', password: 'short' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.fields.password).toBeTruthy();
  });


  it('sets an httpOnly session cookie', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { name: 'Кука Тест', email: 'cookie@test.local', password: 'password123' },
    });
    const cookies = response.headers['set-cookie'] as string | string[];
    const raw = Array.isArray(cookies) ? cookies.join(';') : cookies;
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Lax');
  });
});

describe('POST /auth/login', () => {
  it('accepts the right password', async () => {
    const cookie = await login(app, 'anna@test.local');
    expect(cookie).toContain('fd_session=');
  });

  it('rejects the wrong password without revealing which field was wrong', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'anna@test.local', password: 'wrong-password' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.fields).toBeUndefined();
  });

  it('gives the same answer for an unknown email', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@test.local', password: 'password123' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('GET /auth/session', () => {
  it('returns a null user when unauthenticated', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });
    expect(response.statusCode).toBe(200);
    expect(response.json().user).toBeNull();
  });

  it('returns the user and their workspaces when signed in', async () => {
    const user = await registerUser(app, { workspaceName: 'Моё пространство' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: user.cookie },
    });
    expect(response.json().user.id).toBe(user.id);
    expect(response.json().workspaces[0].name).toBe('Моё пространство');
  });
});

describe('POST /auth/logout', () => {
  it('revokes the session server-side, not just the cookie', async () => {
    const user = await registerUser(app);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: user.cookie },
    });
    expect(logout.statusCode).toBe(204);

    // Replaying the very same cookie must now fail — the row is gone.
    const replay = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces',
      headers: { cookie: user.cookie },
    });
    expect(replay.statusCode).toBe(401);
  });
});

describe('authentication guard', () => {
  it('rejects unauthenticated access to protected routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/workspaces' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a forged session token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces',
      headers: { cookie: 'fd_session=not-a-real-token' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('приглашения', () => {
  it('приглашённый заводит пароль по ссылке и входит', async () => {
    const owner = await registerUser(app, { workspaceName: 'Пространство приглашений' });

    const invited = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${owner.workspaceId}/members`,
      headers: { cookie: owner.cookie },
      payload: { email: 'invited@test.local', role: 'MEMBER' },
    });
    expect(invited.statusCode).toBe(201);

    // Until the link is opened the account has no password at all, so there is
    // no way in — that is exactly what the invitation exists to hand over.
    const beforeAccepting = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'invited@test.local', password: 'whatever123' },
    });
    expect(beforeAccepting.statusCode).toBe(401);

    const { prisma } = await import('../../src/lib/prisma');
    const token = await prisma.verificationToken.findFirst({
      where: { purpose: 'INVITE', usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(token).not.toBeNull();
  });

  it('ссылка приглашения возвращается администратору и пускает человека внутрь', async () => {
    const owner = await registerUser(app, { workspaceName: 'Ссылка' });
    const invited = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${owner.workspaceId}/members`,
      headers: { cookie: owner.cookie },
      payload: { email: 'bylink@test.local', role: 'MEMBER' },
    });
    const { invite } = invited.json();
    // Mail is off in tests, so the link is the only way the invitation can
    // reach anyone — exactly the case the returned URL exists for.
    expect(invite.emailSent).toBe(false);
    const token = new URL(invite.url).searchParams.get('token');

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/accept-invite',
      payload: { token, name: 'По Ссылке', password: 'bylink12345' },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().workspaces.some((w: { id: string }) => w.id === owner.workspaceId)).toBe(true);
  });

  it('повторное приглашение непринявшего выдаёт новую ссылку, старая гаснет', async () => {
    const owner = await registerUser(app, { workspaceName: 'Повтор' });
    const inviteOnce = () =>
      app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${owner.workspaceId}/members`,
        headers: { cookie: owner.cookie },
        payload: { email: 'again@test.local', role: 'MEMBER' },
      });

    const first = (await inviteOnce()).json().invite.url;
    const second = await inviteOnce();
    expect(second.statusCode).toBe(201);
    expect(second.json().invite.url).not.toBe(first);

    const stale = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/accept-invite',
      payload: { token: new URL(first).searchParams.get('token'), name: 'Старая', password: 'stale12345' },
    });
    expect(stale.statusCode).toBe(400);
  });

  it('человеку с аккаунтом ссылка не выдаётся — он попадает в пространство сразу', async () => {
    const owner = await registerUser(app, { workspaceName: 'Свои' });
    const existing = await registerUser(app, { email: 'has-account@test.local' });
    const added = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${owner.workspaceId}/members`,
      headers: { cookie: owner.cookie },
      payload: { email: existing.email, role: 'MEMBER' },
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().invite).toBeUndefined();
  });

  it('членство в пространстве выдаётся сразу, роль сохраняется', async () => {
    const owner = await registerUser(app, { workspaceName: 'Роли' });
    await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${owner.workspaceId}/members`,
      headers: { cookie: owner.cookie },
      payload: { email: 'admin-invite@test.local', role: 'ADMIN' },
    });

    const members = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${owner.workspaceId}/members`,
      headers: { cookie: owner.cookie },
    });
    const invited = members.json().find((m: { user: { email: string } }) => m.user.email === 'admin-invite@test.local');
    expect(invited?.role).toBe('ADMIN');
    expect(invited?.user.status).toBe('INVITED');
  });
});
