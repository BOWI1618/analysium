import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addMember, createProject, disconnectTestDb, login, migrateTestSchema, registerUser } from '../setup';

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

describe('метка из списка меток', () => {
  it('участник добавляет метку в проект, но переименовать её не может', async () => {
    const owner = await registerUser(app, { workspaceName: 'Метки участника' });
    const project = await createProject(app, owner);
    const member = await registerUser(app, { email: 'labeller@labels.test' });
    await addMember(app, owner, member.email, 'MEMBER');
    const cookie = await login(app, member.email);

    // Used to be refused: adding a label took the right to manage the project.
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/labels`,
      headers: { cookie },
      payload: { name: 'срочно', color: '#ef4444' },
    });
    expect(created.statusCode).toBe(201);

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${project.id}/labels/${created.json().id}`,
      headers: { cookie },
      payload: { name: 'не срочно' },
    });
    expect(renamed.statusCode).toBe(403);
  });

  it('метка для задач без проекта появляется до первой такой задачи и ставится на неё', async () => {
    const owner = await registerUser(app, { workspaceName: 'Метка без проекта' });

    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${owner.workspaceId}/projectless/labels`,
      headers: { cookie: owner.cookie },
      payload: { name: 'идеи', color: '#3b82f6' },
    });
    expect(created.statusCode).toBe(201);
    const label = created.json();

    const issue = await app.inject({
      method: 'POST',
      url: '/api/v1/issues',
      headers: { cookie: owner.cookie },
      payload: { workspaceId: owner.workspaceId, title: 'С новой меткой', labelIds: [label.id] },
    });
    expect(issue.statusCode).toBe(201);
    expect(issue.json().projectId).toBe(label.projectId);
    expect(issue.json().labels.map((l: { name: string }) => l.name)).toContain('идеи');
  });

  it('гость не создаёт метки для задач без проекта', async () => {
    const owner = await registerUser(app, { workspaceName: 'Гость и метки' });
    const guest = await registerUser(app, { email: 'guest@labels.test' });
    await addMember(app, owner, guest.email, 'GUEST');
    const cookie = await login(app, guest.email);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${owner.workspaceId}/projectless/labels`,
      headers: { cookie },
      payload: { name: 'нельзя', color: '#3b82f6' },
    });
    expect(response.statusCode).toBe(403);
  });
});
