import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createProject, disconnectTestDb, migrateTestSchema, registerUser } from '../setup';

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

describe('задачи без проекта', () => {
  it('создаются в пространстве без единого проекта и назначаются любому участнику', async () => {
    const owner = await registerUser(app, { workspaceName: 'Без проектов' });
    const invited = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${owner.workspaceId}/members`,
      headers: { cookie: owner.cookie },
      payload: { email: 'teammate-np@test.local', role: 'MEMBER' },
    });
    const teammateId = invited.json().user.id as string;

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/issues',
      headers: { cookie: owner.cookie },
      payload: { workspaceId: owner.workspaceId, title: 'Первая задача', assigneeId: teammateId },
    });
    expect(created.statusCode).toBe(201);
    const issue = created.json();
    expect(issue.issueKey).toBe('TASK-1');
    expect(issue.assignee.id).toBe(teammateId);
    expect(issue.project.name).toBe('Без проекта');

    // The second one goes into the same list, not a new one.
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/issues',
      headers: { cookie: owner.cookie },
      payload: { workspaceId: owner.workspaceId, title: 'Вторая задача' },
    });
    expect(second.json().issueKey).toBe('TASK-2');
    expect(second.json().projectId).toBe(issue.projectId);
  });

  it('служебный список не считается проектом и не меняется', async () => {
    const owner = await registerUser(app, { workspaceName: 'Служебный список' });
    await createProject(app, owner, { key: 'REAL' });
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/issues',
      headers: { cookie: owner.cookie },
      payload: { workspaceId: owner.workspaceId, title: 'Без проекта' },
    });
    const systemProjectId = created.json().projectId as string;

    const workspaces = await app.inject({ method: 'GET', url: '/api/v1/workspaces', headers: { cookie: owner.cookie } });
    const workspace = workspaces.json().find((w: { id: string }) => w.id === owner.workspaceId);
    expect(workspace.projectCount).toBe(1);

    const rename = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${systemProjectId}`,
      headers: { cookie: owner.cookie },
      payload: { name: 'Переименовать' },
    });
    expect(rename.statusCode).toBe(400);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${systemProjectId}`,
      headers: { cookie: owner.cookie },
    });
    expect(remove.statusCode).toBe(400);
  });

  it('ключ служебного списка не отнимает у пользователя ключ проекта', async () => {
    const owner = await registerUser(app, { workspaceName: 'Занятый ключ' });
    // Someone already has a project keyed TASK: the list picks another key.
    await createProject(app, owner, { key: 'TASK' });
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/issues',
      headers: { cookie: owner.cookie },
      payload: { workspaceId: owner.workspaceId, title: 'Не в TASK' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().issueKey).not.toMatch(/^TASK-/);
  });

  it('ключ проекта создаётся сам, из русского названия и без повторов', async () => {
    const owner = await registerUser(app, { workspaceName: 'Ключи сами' });
    const create = () =>
      app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${owner.workspaceId}/projects`,
        headers: { cookie: owner.cookie },
        payload: { name: 'Алабуга Старт' },
      });
    const first = await create();
    expect(first.statusCode).toBe(201);
    expect(first.json().key).toBe('AS');
    expect(first.json().labels).toEqual([]);
    expect((await create()).json().key).toBe('AS2');
  });

  it('проект создаётся с любой иконкой из набора, в том числе с длинным именем', async () => {
    const owner = await registerUser(app, { workspaceName: 'Иконки проектов' });
    // Names longer than eight characters used to be rejected, so picking
    // «Телефон», «Щит», «График» and others made the project impossible to create.
    for (const icon of ['smartphone', 'shield-check', 'bar-chart-3', 'settings-2', 'flask-conical', 'message-square']) {
      const created = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${owner.workspaceId}/projects`,
        headers: { cookie: owner.cookie },
        payload: { name: `Проект ${icon}`, icon },
      });
      expect(created.statusCode, icon).toBe(201);
      expect(created.json().icon).toBe(icon);
    }
  });

  it('без проекта и без пространства запрос отклоняется', async () => {
    const owner = await registerUser(app, { workspaceName: 'Нет адресата' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/issues',
      headers: { cookie: owner.cookie },
      payload: { title: 'Куда?' },
    });
    expect(response.statusCode).toBe(422);
  });
});
