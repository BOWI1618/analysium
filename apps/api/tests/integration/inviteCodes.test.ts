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

async function createCode(cookie: string, workspaceId: string, role = 'MEMBER') {
  return app.inject({
    method: 'POST',
    url: `/api/v1/workspaces/${workspaceId}/invite-codes`,
    headers: { cookie },
    payload: { role },
  });
}

async function join(code: string, email: string, name = 'Новый Участник') {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/join',
    payload: { code, name, email, password: 'joiner12345' },
  });
}

describe('коды приглашения', () => {
  it('человек входит по коду и сам задаёт имя, почту и пароль', async () => {
    const owner = await registerUser(app, { workspaceName: 'По коду' });
    const created = await createCode(owner.cookie, owner.workspaceId, 'ADMIN');
    expect(created.statusCode).toBe(201);
    const { code } = created.json();
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const joined = await join(code, 'joiner@test.local', 'Сам Задал');
    expect(joined.statusCode).toBe(201);
    const session = joined.json();
    expect(session.user.name).toBe('Сам Задал');
    const membership = session.workspaces.find((w: { id: string }) => w.id === owner.workspaceId);
    expect(membership?.role).toBe('ADMIN');

    // The chosen credentials are real: an ordinary sign-in works afterwards.
    await expect(login(app, 'joiner@test.local', 'joiner12345')).resolves.toBeTruthy();
  });

  it('регистр и разделители в коде не важны — его набирает человек', async () => {
    const owner = await registerUser(app, { workspaceName: 'Регистр' });
    const { code } = (await createCode(owner.cookie, owner.workspaceId)).json();
    const sloppy = code.toLowerCase().replace('-', ' ');
    expect((await join(sloppy, 'sloppy@test.local')).statusCode).toBe(201);
  });

  it('код срабатывает один раз', async () => {
    const owner = await registerUser(app, { workspaceName: 'Однократно' });
    const { code } = (await createCode(owner.cookie, owner.workspaceId)).json();
    expect((await join(code, 'first@test.local')).statusCode).toBe(201);

    const second = await join(code, 'second@test.local');
    expect(second.statusCode).toBe(400);
    expect(second.json().error.fields.code).toBeTruthy();
  });

  it('отозванный код больше не пускает', async () => {
    const owner = await registerUser(app, { workspaceName: 'Отзыв' });
    const created = (await createCode(owner.cookie, owner.workspaceId)).json();
    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${owner.workspaceId}/invite-codes/${created.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(revoked.statusCode).toBe(204);
    expect((await join(created.code, 'late@test.local')).statusCode).toBe(400);
  });

  it('список показывает только неиспользованные коды и не раскрывает сам код', async () => {
    const owner = await registerUser(app, { workspaceName: 'Список' });
    const used = (await createCode(owner.cookie, owner.workspaceId)).json();
    const waiting = (await createCode(owner.cookie, owner.workspaceId, 'GUEST')).json();
    await join(used.code, 'used@test.local');

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${owner.workspaceId}/invite-codes`,
      headers: { cookie: owner.cookie },
    });
    const ids = list.json().map((c: { id: string }) => c.id);
    expect(ids).toContain(waiting.id);
    expect(ids).not.toContain(used.id);
    expect(list.body).not.toContain(waiting.code);
  });

  it('занятая почта даёт понятный отказ, а код не сгорает', async () => {
    const owner = await registerUser(app, { workspaceName: 'Занято' });
    const taken = await registerUser(app, { email: 'taken@test.local' });
    const { code } = (await createCode(owner.cookie, owner.workspaceId)).json();

    const clash = await join(code, taken.email);
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.fields.email).toBeTruthy();

    // The refusal happened before the code was claimed, so it still works.
    expect((await join(code, 'free@test.local')).statusCode).toBe(201);
  });

  it('обычный участник не может выпускать коды', async () => {
    const owner = await registerUser(app, { workspaceName: 'Права' });
    const { code } = (await createCode(owner.cookie, owner.workspaceId, 'MEMBER')).json();
    await join(code, 'plain@test.local');
    const memberCookie = await login(app, 'plain@test.local', 'joiner12345');

    const attempt = await createCode(memberCookie, owner.workspaceId);
    expect(attempt.statusCode).toBe(403);
  });

  it('роль владельца кодом не выдаётся', async () => {
    const owner = await registerUser(app, { workspaceName: 'Владелец' });
    expect((await createCode(owner.cookie, owner.workspaceId, 'OWNER')).statusCode).toBe(400);
  });
});
