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
