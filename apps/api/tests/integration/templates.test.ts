import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addMember, createProject, disconnectTestDb, migrateTestSchema, registerUser, type TestUser } from '../setup';

let app: FastifyInstance;
let owner: TestUser;
let worker: TestUser;
let outsider: TestUser;
let project: { id: string };

const call = (user: TestUser, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { cookie: user.cookie },
    ...(payload ? { payload: payload as never } : {}),
  });

const templates = async (user: TestUser) =>
  (await call(user, 'GET', `/workspaces/${owner.workspaceId}/issue-templates`)).json() as {
    items: {
      id: string;
      name: string;
      title: string;
      description: unknown;
      dueInDays: number | null;
      recurrence: string | null;
      subtasks: string[];
      watchers: { id: string }[];
    }[];
    canManage: boolean;
  };

const checklist = {
  type: 'doc',
  content: [
    {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Повестка' }] }] },
      ],
    },
  ],
};

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();

  owner = await registerUser(app, { name: 'Владелец Шаблонов', workspaceName: 'Шаблоны' });
  worker = await registerUser(app, { name: 'Работник Шаблонов' });
  outsider = await registerUser(app, { name: 'Посторонний', workspaceName: 'Чужое пространство' });
  await addMember(app, owner, worker.email, 'MEMBER');
  project = await createProject(app, owner);
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

describe('шаблоны задач', () => {
  it('шаблоны ведёт администратор, а пользуются ими все участники', async () => {
    const body = {
      name: 'Совещание',
      title: 'Совещание',
      description: checklist,
      dueInDays: 3,
      subtasks: ['Собрать повестку', 'Разослать протокол'],
      watcherIds: [worker.id],
    };
    // A member may not add to the workspace's vocabulary of typical work.
    expect((await call(worker, 'POST', `/workspaces/${owner.workspaceId}/issue-templates`, body)).statusCode).toBe(403);

    const created = await call(owner, 'POST', `/workspaces/${owner.workspaceId}/issue-templates`, body);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      name: 'Совещание',
      title: 'Совещание',
      type: 'TASK',
      priority: 'MEDIUM',
      dueInDays: 3,
      recurrence: null,
      subtasks: ['Собрать повестку', 'Разослать протокол'],
      watchers: [{ id: worker.id }],
    });

    const forWorker = await templates(worker);
    expect(forWorker.canManage).toBe(false);
    expect(forWorker.items.map((item) => item.name)).toEqual(['Совещание']);
    expect((await templates(owner)).canManage).toBe(true);

    const id = created.json().id as string;
    expect((await call(worker, 'PATCH', `/issue-templates/${id}`, { title: 'Не моё' })).statusCode).toBe(403);
    expect((await call(worker, 'DELETE', `/issue-templates/${id}`)).statusCode).toBe(403);
    // Someone from another workspace does not learn the template exists.
    expect((await call(outsider, 'PATCH', `/issue-templates/${id}`, { title: 'Чужое' })).statusCode).toBe(404);
  });

  it('название не повторяется; наблюдатель — только из пространства; шаблон не бывает подзадачей', async () => {
    const url = `/workspaces/${owner.workspaceId}/issue-templates`;
    const taken = await call(owner, 'POST', url, { name: 'Совещание', title: 'Ещё одно' });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.fields?.name ?? taken.json().fields?.name).toBeTruthy();

    expect((await call(owner, 'POST', url, { name: 'С чужим', title: 'Задача', watcherIds: [outsider.id] })).statusCode).toBe(400);
    expect((await call(owner, 'POST', url, { name: 'Подзадача', title: 'Часть', type: 'SUBTASK' })).statusCode).toBe(422);
    expect((await call(owner, 'POST', url, { name: '  ', title: 'Без названия' })).statusCode).toBe(422);
  });

  it('шаблон меняется и удаляется; ушедший из пространства наблюдатель из него выпадает', async () => {
    const created = (
      await call(owner, 'POST', `/workspaces/${owner.workspaceId}/issue-templates`, {
        name: 'Регулярная проверка',
        title: 'Регулярная проверка',
        recurrence: 'WEEKLY',
        dueInDays: 7,
        watcherIds: [worker.id],
      })
    ).json();

    const changed = await call(owner, 'PATCH', `/issue-templates/${created.id}`, {
      title: 'Проверка стендов',
      dueInDays: null,
      subtasks: ['Осмотр'],
      description: null,
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({
      name: 'Регулярная проверка',
      title: 'Проверка стендов',
      dueInDays: null,
      recurrence: 'WEEKLY',
      subtasks: ['Осмотр'],
      description: null,
    });

    // The watcher leaves the workspace: the template stops naming them.
    const leaving = await registerUser(app, { name: 'Уходящий Наблюдатель' });
    await addMember(app, owner, leaving.email, 'MEMBER');
    await call(owner, 'PATCH', `/issue-templates/${created.id}`, { watcherIds: [worker.id, leaving.id] });
    const members = (await call(owner, 'GET', `/workspaces/${owner.workspaceId}/members`)).json() as {
      id: string;
      user: { id: string };
    }[];
    const membership = members.find((member) => member.user.id === leaving.id)!;
    const removed = await call(owner, 'DELETE', `/workspaces/${owner.workspaceId}/members/${membership.id}`);
    expect(removed.statusCode).toBeLessThan(300);
    const after = (await templates(owner)).items.find((item) => item.id === created.id)!;
    expect(after.watchers.map((watcher) => watcher.id)).toEqual([worker.id]);

    expect((await call(owner, 'DELETE', `/issue-templates/${created.id}`)).statusCode).toBe(204);
    expect((await templates(owner)).items.some((item) => item.id === created.id)).toBe(false);
  });
});

describe('задача с подзадачами за один запрос', () => {
  it('подзадачи шаблона создаются вместе с задачей и нумеруются от неё', async () => {
    const created = await call(owner, 'POST', '/issues', {
      projectId: project.id,
      title: 'Подготовить ТЗ на стенд',
      subtaskTitles: ['Собрать требования', 'Написать черновик'],
      watcherIds: [worker.id],
    });
    expect(created.statusCode).toBe(201);
    const issue = created.json() as { id: string; issueKey: string; subtasks: { title: string; issueKey: string; type: string }[] };
    expect(issue.subtasks.map((subtask) => subtask.title).sort()).toEqual(['Написать черновик', 'Собрать требования']);
    expect(issue.subtasks.map((subtask) => subtask.issueKey).sort()).toEqual([`${issue.issueKey}.1`, `${issue.issueKey}.2`]);
    expect(issue.subtasks.every((subtask) => subtask.type === 'SUBTASK')).toBe(true);

    // One level only: a subtask does not get parts of its own.
    const nested = await call(owner, 'POST', '/issues', {
      projectId: project.id,
      parentId: issue.id,
      type: 'SUBTASK',
      title: 'Часть с частями',
      subtaskTitles: ['Глубже нельзя'],
    });
    expect(nested.statusCode).toBe(400);
    const again = (await call(owner, 'GET', `/issues/${issue.id}`)).json() as { subtasks: unknown[] };
    expect(again.subtasks).toHaveLength(2);
  });
});
