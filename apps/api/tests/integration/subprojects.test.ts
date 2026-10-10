import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  addMember,
  createIssue,
  createProject,
  disconnectTestDb,
  migrateTestSchema,
  registerUser,
  type TestUser,
} from '../setup';

let app: FastifyInstance;
let owner: TestUser;
let guest: TestUser;
let outsider: TestUser;

const call = (user: TestUser, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { cookie: user.cookie },
    ...(payload ? { payload: payload as never } : {}),
  });

type Listed = { id: string; name: string; parentId: string | null; openIssueCount: number; totalIssueCount: number };
const projectsFor = async (user: TestUser) =>
  (await call(user, 'GET', `/workspaces/${owner.workspaceId}/projects`)).json() as Listed[];

const newProject = (user: TestUser, body: Record<string, unknown>) =>
  call(user, 'POST', `/workspaces/${owner.workspaceId}/projects`, body);

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();

  owner = await registerUser(app, { name: 'Владелец Подпроектов', workspaceName: 'Подпроекты' });
  guest = await registerUser(app, { name: 'Гость Подпроектов' });
  outsider = await registerUser(app, { name: 'Чужой Владелец', workspaceName: 'Чужое' });
  await addMember(app, owner, guest.email, 'GUEST');
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

describe('подпроекты', () => {
  it('подпроект — отдельный проект со своей доской и ключом, записанный под основным', async () => {
    const main = await createProject(app, owner, { name: 'Основной проект' });
    const created = await newProject(owner, { name: 'Первый подпроект', parentId: main.id });
    expect(created.statusCode).toBe(201);
    const sub = created.json();
    expect(sub.parentId).toBe(main.id);
    expect(sub.key).not.toBe(main.key);
    // Its own workflow, as any project gets.
    expect(sub.statuses.length).toBeGreaterThan(0);

    const list = await projectsFor(owner);
    expect(list.find((project) => project.id === sub.id)?.parentId).toBe(main.id);
    expect(list.find((project) => project.id === main.id)?.parentId).toBeNull();

    // A task of the subproject is not a task of the main project: each has its own analytics.
    await createIssue(app, owner, sub.id, { title: 'Задача подпроекта' });
    const again = await projectsFor(owner);
    expect(again.find((project) => project.id === sub.id)).toMatchObject({ openIssueCount: 1, totalIssueCount: 1 });
    expect(again.find((project) => project.id === main.id)).toMatchObject({ openIssueCount: 0, totalIssueCount: 0 });
    const analytics = (await call(owner, 'GET', `/projects/${main.id}/dashboard`)).json();
    expect(analytics.totals.total).toBe(0);
  });

  it('вложенность — один уровень, в пределах пространства; сам в себя проект не входит', async () => {
    const main = await createProject(app, owner, { name: 'Родитель правил' });
    const sub = (await newProject(owner, { name: 'Ребёнок правил', parentId: main.id })).json();
    const other = await createProject(app, owner, { name: 'Соседний проект' });
    const foreign = await createProject(app, outsider, { name: 'Чужой проект' });

    // No subprojects of a subproject.
    const deeper = await newProject(owner, { name: 'Внук', parentId: sub.id });
    expect(deeper.statusCode).toBe(400);
    expect(deeper.json().error.fields.parentId).toBeTruthy();
    // A project that has subprojects cannot become one.
    expect((await call(owner, 'PATCH', `/projects/${main.id}`, { parentId: other.id })).statusCode).toBe(400);
    expect((await call(owner, 'PATCH', `/projects/${other.id}`, { parentId: other.id })).statusCode).toBe(400);
    // Another workspace's project is not a parent, whoever asks.
    expect((await newProject(owner, { name: 'Под чужим', parentId: foreign.id })).statusCode).toBe(400);

    // Moving under a project and back out again.
    const moved = await call(owner, 'PATCH', `/projects/${other.id}`, { parentId: main.id });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().parentId).toBe(main.id);
    const freed = await call(owner, 'PATCH', `/projects/${other.id}`, { parentId: null });
    expect(freed.json().parentId).toBeNull();
    // A change of something else leaves the place in the tree alone.
    const renamed = await call(owner, 'PATCH', `/projects/${sub.id}`, { name: 'Ребёнок переименован' });
    expect(renamed.json().parentId).toBe(main.id);
  });

  it('доступ у подпроекта свой: гость видит подпроект, в который добавлен, без основного', async () => {
    const main = await createProject(app, owner, { name: 'Закрытый основной' });
    const sub = (await newProject(owner, { name: 'Открытый гостю подпроект', parentId: main.id })).json();
    const added = await call(owner, 'POST', `/projects/${sub.id}/members`, { userId: guest.id, role: 'CONTRIBUTOR' });
    expect(added.statusCode).toBeLessThan(300);

    const seen = await projectsFor(guest);
    expect(seen.map((project) => project.id)).toEqual([sub.id]);
    // The id of the parent is there, but the parent itself is not — the interface then shows the subproject on its own.
    expect((await call(guest, 'GET', `/projects/${main.id}`)).statusCode).toBeGreaterThanOrEqual(403);
    // And the guest cannot hang a project under one they cannot open.
    expect((await call(guest, 'PATCH', `/projects/${sub.id}`, { parentId: main.id })).statusCode).toBeGreaterThanOrEqual(400);
  });

  it('удаление основного проекта оставляет подпроекты самостоятельными проектами', async () => {
    const main = await createProject(app, owner, { name: 'Удаляемый основной' });
    const sub = (await newProject(owner, { name: 'Переживший подпроект', parentId: main.id })).json();
    await createIssue(app, owner, sub.id, { title: 'Задача переживёт' });

    expect((await call(owner, 'DELETE', `/projects/${main.id}`)).statusCode).toBeLessThan(300);
    const left = (await projectsFor(owner)).find((project) => project.id === sub.id);
    expect(left).toMatchObject({ parentId: null, totalIssueCount: 1 });
  });
});

describe('цифры проекта и типы задач', () => {
  it('в счётчике проекта — только задачи: подзадачи в него не входят', async () => {
    const project = await createProject(app, owner, { name: 'Счёт без подзадач' });
    const task = await createIssue(app, owner, project.id, { title: 'Задача с частями' });
    await createIssue(app, owner, project.id, { title: 'Часть первая', parentId: task.id, type: 'SUBTASK' });
    await createIssue(app, owner, project.id, { title: 'Часть вторая', parentId: task.id, type: 'SUBTASK' });
    await createIssue(app, owner, project.id, { title: 'Ещё одна задача' });

    const listed = (await projectsFor(owner)).find((item) => item.id === project.id)!;
    expect(listed).toMatchObject({ openIssueCount: 2, totalIssueCount: 2 });
    const detail = (await call(owner, 'GET', `/projects/${project.id}`)).json();
    expect(detail).toMatchObject({ openIssueCount: 2, totalIssueCount: 2 });

    // Closing a subtask moves nothing; closing a task does.
    const done = (detail.statuses as { id: string; category: string }[]).find((status) => status.category === 'COMPLETED')!;
    await call(owner, 'PATCH', `/issues/${task.id}`, { statusId: done.id });
    expect((await projectsFor(owner)).find((item) => item.id === project.id)).toMatchObject({
      openIssueCount: 1,
      totalIssueCount: 2,
    });
  });

  it('эпиков больше нет: такой тип не принимается, а подзадача создаётся у любой задачи', async () => {
    const project = await createProject(app, owner, { name: 'Без эпиков' });
    const refused = await call(owner, 'POST', '/issues', { projectId: project.id, title: 'Эпик', type: 'EPIC' });
    expect(refused.statusCode).toBe(422);

    for (const type of ['TASK', 'BUG', 'STORY']) {
      const parent = await createIssue(app, owner, project.id, { title: `Родитель ${type}`, type });
      const child = await call(owner, 'POST', '/issues', {
        projectId: project.id,
        parentId: parent.id,
        type: 'SUBTASK',
        title: `Подзадача у ${type}`,
      });
      expect(child.statusCode, type).toBe(201);
    }
    // And a task cannot be turned into an epic afterwards.
    const task = await createIssue(app, owner, project.id, { title: 'Не станет эпиком' });
    expect((await call(owner, 'PATCH', `/issues/${task.id}`, { type: 'EPIC' })).statusCode).toBe(422);
  });
});
