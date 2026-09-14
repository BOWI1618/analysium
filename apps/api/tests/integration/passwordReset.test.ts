import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addMember, disconnectTestDb, login, migrateTestSchema, registerUser } from '../setup';
import { prisma } from '../../src/lib/prisma';

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

async function memberIdOf(cookie: string, workspaceId: string, userId: string) {
  const list = await app.inject({ method: 'GET', url: `/api/v1/workspaces/${workspaceId}/members`, headers: { cookie } });
  return list.json().find((m: { user: { id: string } }) => m.user.id === userId).id as string;
}

const signIn = (email: string, password: string) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });

describe('сброс пароля администратором', () => {
  it('после сброса человек входит без пароля, задаёт новый и дальше входит с ним', async () => {
    const owner = await registerUser(app, { workspaceName: 'Сброс пароля' });
    const member = await registerUser(app, { email: 'forgot@reset.test' });
    await addMember(app, owner, member.email, 'MEMBER');
    const memberCookie = await login(app, member.email);
    const memberId = await memberIdOf(owner.cookie, owner.workspaceId, member.id);

    const reset = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${owner.workspaceId}/members/${memberId}/reset-password`,
      headers: { cookie: owner.cookie },
    });
    expect(reset.statusCode).toBe(200);

    // Signed out everywhere, and the old password no longer opens anything.
    const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: memberCookie } });
    expect(session.json().user).toBeNull();

    const listed = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${owner.workspaceId}/members`,
      headers: { cookie: owner.cookie },
    });
    expect(listed.json().find((m: { id: string }) => m.id === memberId).passwordResetExpiresAt).not.toBeNull();

    // The address alone: no session yet, only a token for the new password.
    const withoutPassword = await signIn(member.email, '');
    expect(withoutPassword.statusCode).toBe(200);
    expect(withoutPassword.json().passwordResetRequired).toBe(true);
    expect(withoutPassword.headers['set-cookie']).toBeUndefined();

    const weak = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/set-password',
      payload: { token: withoutPassword.json().token, password: 'short' },
    });
    expect(weak.statusCode).toBe(422);

    const saved = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/set-password',
      payload: { token: withoutPassword.json().token, password: 'newpass123' },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().user.id).toBe(member.id);

    // From now on it is an ordinary account again.
    expect((await signIn(member.email, '')).statusCode).toBe(401);
    expect((await signIn(member.email, 'password123')).statusCode).toBe(401);
    expect((await signIn(member.email, 'newpass123')).statusCode).toBe(200);

    // The token was single-use.
    const reuse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/set-password',
      payload: { token: withoutPassword.json().token, password: 'another123' },
    });
    expect(reuse.statusCode).toBe(400);
  });

  it('истёкший сброс не впускает без пароля', async () => {
    const owner = await registerUser(app, { workspaceName: 'Истёкший сброс' });
    const member = await registerUser(app, { email: 'late@reset.test' });
    await addMember(app, owner, member.email, 'MEMBER');
    const memberId = await memberIdOf(owner.cookie, owner.workspaceId, member.id);
    await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${owner.workspaceId}/members/${memberId}/reset-password`,
      headers: { cookie: owner.cookie },
    });
    await prisma.user.update({ where: { id: member.id }, data: { passwordResetExpiresAt: new Date(Date.now() - 1000) } });

    const response = await signIn(member.email, '');
    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toMatch(/истёк/);
  });

  it('участник не сбрасывает чужой пароль, администратор — не сбрасывает владельцу и равным', async () => {
    const owner = await registerUser(app, { workspaceName: 'Права на сброс' });
    const admin = await registerUser(app, { email: 'admin@reset.test' });
    const otherAdmin = await registerUser(app, { email: 'admin2@reset.test' });
    const plain = await registerUser(app, { email: 'plain@reset.test' });
    await addMember(app, owner, admin.email, 'ADMIN');
    await addMember(app, owner, otherAdmin.email, 'ADMIN');
    await addMember(app, owner, plain.email, 'MEMBER');
    const adminCookie = await login(app, admin.email);
    const plainCookie = await login(app, plain.email);

    const resetAs = async (cookie: string, userId: string) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${owner.workspaceId}/members/${await memberIdOf(owner.cookie, owner.workspaceId, userId)}/reset-password`,
        headers: { cookie },
      });

    expect((await resetAs(plainCookie, admin.id)).statusCode).toBe(403);
    expect((await resetAs(adminCookie, owner.id)).statusCode).toBe(403);
    expect((await resetAs(adminCookie, otherAdmin.id)).statusCode).toBe(403);
    expect((await resetAs(adminCookie, admin.id)).statusCode).toBe(400);

    // Someone who runs another team's workspace keeps their account to
    // themselves, even against this workspace's owner. A personal workspace
    // with nobody else in it does not count.
    expect((await resetAs(owner.cookie, otherAdmin.id)).statusCode).toBe(200);
    const outsider = await registerUser(app, { email: 'outsider@reset.test' });
    await addMember(app, plain, outsider.email, 'MEMBER');
    expect((await resetAs(owner.cookie, plain.id)).statusCode).toBe(403);
  });
});
