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

describe('логин', () => {
  it('не обязан быть почтой; регистр не различается', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { name: 'Иван Логинов', email: 'Ivan.Loginov', password: 'password123' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().user.email).toBe('ivan.loginov');
    await expect(login(app, 'IVAN.loginov')).resolves.toContain('fd_session=');
  });

  it('пробелы и посторонние знаки в новом логине не принимаются', async () => {
    for (const bad of ['два слова', 'a', 'имя!']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { name: 'Плохой Логин', email: bad, password: 'password123' },
      });
      expect(response.statusCode, bad).toBe(422);
      expect(response.json().error.fields.email, bad).toBeTruthy();
    }
  });

  it('меняется в профиле — с паролем; занятый не отдаётся; входить дальше нужно по новому', async () => {
    const user = await registerUser(app, { email: 'before@test.local' });
    const other = await registerUser(app, { email: 'occupied@test.local' });
    const change = (payload: Record<string, unknown>, cookie = user.cookie) =>
      app.inject({ method: 'POST', url: '/api/v1/me/login', headers: { cookie }, payload });

    // Without the password the name of the account does not change.
    const guessed = await change({ login: 'after', currentPassword: 'not-the-password1' });
    expect(guessed.statusCode).toBe(400);
    expect(guessed.json().error.fields.currentPassword).toBeTruthy();

    const taken = await change({ login: other.email, currentPassword: 'password123' });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.fields.login).toBeTruthy();
    expect((await change({ login: 'с пробелом', currentPassword: 'password123' })).statusCode).toBe(422);

    const changed = await change({ login: 'After.Change', currentPassword: 'password123' });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toEqual({ email: 'after.change' });

    // The session that asked stays signed in and shows the new login.
    const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: user.cookie } });
    expect(session.json().user.email).toBe('after.change');
    // The old login no longer opens the account; the new one does.
    const old = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'before@test.local', password: 'password123' },
    });
    expect(old.statusCode).toBe(401);
    await expect(login(app, 'after.change')).resolves.toContain('fd_session=');
    // And the old one is free for someone else to take.
    expect((await change({ login: 'before@test.local', currentPassword: 'password123' }, other.cookie)).statusCode).toBe(200);
  });
});

describe('человек с аккаунтом добавляется в пространство по логину', () => {
  const add = (cookie: string, workspaceId: string, email: string, role = 'MEMBER') =>
    app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/members`,
      headers: { cookie },
      payload: { email, role },
    });

  it('попадает сразу, с выданной ролью; второй раз — отказ', async () => {
    const owner = await registerUser(app, { workspaceName: 'Свои' });
    const existing = await registerUser(app, { email: 'has-account@test.local' });

    const added = await add(owner.cookie, owner.workspaceId, existing.email, 'ADMIN');
    expect(added.statusCode).toBe(201);
    expect(added.json()).toMatchObject({ role: 'ADMIN', user: { id: existing.id } });
    expect((await add(owner.cookie, owner.workspaceId, existing.email)).statusCode).toBe(409);
  });

  it('аккаунт так не создаётся: неизвестный логин — отказ, и в базе никого нового', async () => {
    const owner = await registerUser(app, { workspaceName: 'Без заготовок' });
    const { prisma } = await import('../../src/lib/prisma');
    const before = await prisma.user.count();

    const unknown = await add(owner.cookie, owner.workspaceId, 'nobody-here@test.local');
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error.fields.email).toBeTruthy();
    expect(await prisma.user.count()).toBe(before);
  });

  it('добавляет только владелец: администратору отказ', async () => {
    const owner = await registerUser(app, { workspaceName: 'Только владелец' });
    const admin = await registerUser(app, { email: 'admin-of-space@test.local' });
    const someone = await registerUser(app, { email: 'someone-else@test.local' });
    expect((await add(owner.cookie, owner.workspaceId, admin.email, 'ADMIN')).statusCode).toBe(201);

    const attempt = await add(admin.cookie, owner.workspaceId, someone.email);
    expect(attempt.statusCode).toBe(403);
  });
});
