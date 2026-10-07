import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addMember, createProject, disconnectTestDb, migrateTestSchema, registerUser, type TestUser } from '../setup';

let app: FastifyInstance;
let owner: TestUser;
let worker: TestUser;
let guest: TestUser;
let project: { id: string };

const call = (user: TestUser, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { cookie: user.cookie },
    ...(payload ? { payload: payload as never } : {}),
  });

const views = async (user: TestUser, query = '') =>
  (await call(user, 'GET', `/workspaces/${owner.workspaceId}/views${query}`)).json() as {
    id: string;
    name: string;
    layout: string;
    projectId: string | null;
    filters: Record<string, unknown>;
    display: { params?: Record<string, string>; columns?: string[]; groupBy?: string } | null;
    isShared: boolean;
    ownerName: string;
    canManage: boolean;
  }[];

const save = (user: TestUser, payload: Record<string, unknown>) =>
  call(user, 'POST', `/workspaces/${owner.workspaceId}/views`, payload);

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();

  owner = await registerUser(app, { name: 'Владелец Видов', workspaceName: 'Виды' });
  worker = await registerUser(app, { name: 'Работник Видов' });
  guest = await registerUser(app, { name: 'Гость Видов' });
  await addMember(app, owner, worker.email, 'MEMBER');
  await addMember(app, owner, guest.email, 'GUEST');
  project = await createProject(app, owner);
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

describe('сохранённые виды', () => {
  it('вид личный, пока автор не покажет его команде; чужой личный вид не виден и не меняется', async () => {
    const created = await save(owner, {
      name: 'Неделя работника',
      layout: 'EMPLOYEE',
      filters: { statusCategory: ['STARTED'] },
      display: { params: { user: worker.id, view: 'overdue' } },
    });
    expect(created.statusCode).toBe(201);
    const view = created.json();
    expect(view).toMatchObject({
      name: 'Неделя работника',
      layout: 'EMPLOYEE',
      isShared: false,
      canManage: true,
      ownerName: 'Владелец Видов',
      filters: { statusCategory: ['STARTED'] },
      display: { params: { user: worker.id, view: 'overdue' } },
    });

    // Not shared: for a colleague it does not exist.
    expect((await views(worker)).some((item) => item.id === view.id)).toBe(false);
    expect((await call(worker, 'PATCH', `/views/${view.id}`, { name: 'Чужое' })).statusCode).toBe(404);
    expect((await call(worker, 'DELETE', `/views/${view.id}`)).statusCode).toBe(404);

    // Shown to the team: visible, but still the author's to change.
    const shared = await call(owner, 'PATCH', `/views/${view.id}`, { isShared: true });
    expect(shared.statusCode).toBe(200);
    const seen = (await views(worker)).find((item) => item.id === view.id);
    expect(seen).toMatchObject({ isShared: true, canManage: false, ownerName: 'Владелец Видов' });
    expect((await call(worker, 'PATCH', `/views/${view.id}`, { name: 'Чужое' })).statusCode).toBe(403);
    expect((await call(worker, 'DELETE', `/views/${view.id}`)).statusCode).toBe(403);
  });

  it('общий вид может переименовать и убрать администратор; личный вид участника ему не виден', async () => {
    const shared = (await save(worker, { name: 'Общий от участника', layout: 'MY_WORK', filters: {}, isShared: true })).json();
    const personal = (await save(worker, { name: 'Личный участника', layout: 'MY_WORK', filters: {} })).json();

    const forOwner = await views(owner, '?layout=MY_WORK');
    expect(forOwner.find((item) => item.id === shared.id)).toMatchObject({ canManage: true });
    expect(forOwner.some((item) => item.id === personal.id)).toBe(false);
    expect((await call(owner, 'PATCH', `/views/${personal.id}`, { name: 'Не моё' })).statusCode).toBe(404);

    const renamed = await call(owner, 'PATCH', `/views/${shared.id}`, { name: 'Переименован администратором' });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().name).toBe('Переименован администратором');
    expect((await call(owner, 'DELETE', `/views/${shared.id}`)).statusCode).toBe(204);
    expect((await views(worker)).some((item) => item.id === shared.id)).toBe(false);

    // The author removes their own without anyone's leave.
    expect((await call(worker, 'DELETE', `/views/${personal.id}`)).statusCode).toBe(204);
  });

  it('вид принадлежит своему экрану и проекту; гость не видит видов закрытого для него проекта', async () => {
    const ofProject = (
      await save(owner, {
        name: 'Список проекта',
        layout: 'LIST',
        projectId: project.id,
        filters: { priority: ['URGENT'], sort: 'dueDate', order: 'asc' },
        display: { columns: ['status', 'dueDate'], groupBy: 'assignee' },
        isShared: true,
      })
    ).json();
    const ofDepartment = (
      await save(owner, {
        name: 'Все просроченные',
        layout: 'DEPARTMENT',
        filters: { isOverdue: true },
        display: { params: { department: 'all' } },
        isShared: true,
      })
    ).json();

    const listViews = await views(worker, `?layout=LIST&projectId=${project.id}`);
    expect(listViews.map((item) => item.id)).toEqual([ofProject.id]);
    expect(listViews[0]!.display).toEqual({ columns: ['status', 'dueDate'], groupBy: 'assignee' });
    expect((await views(worker, '?layout=DEPARTMENT')).map((item) => item.id)).toContain(ofDepartment.id);

    // The guest was added to no project: a view of this one would give away its name.
    const forGuest = await views(guest);
    expect(forGuest.some((item) => item.id === ofProject.id)).toBe(false);
    expect(forGuest.some((item) => item.id === ofDepartment.id)).toBe(true);
    const refused = await save(guest, { name: 'В чужой проект', layout: 'LIST', projectId: project.id, filters: {} });
    expect(refused.statusCode).toBe(404);
  });

  it('вид перезаписывается тем, что сейчас на экране; лишнее и пустое не принимается', async () => {
    const view = (
      await save(owner, {
        name: 'Для перезаписи',
        layout: 'PLANNING',
        filters: { priority: ['HIGH'] },
        display: { params: { user: worker.id, period: '14' } },
      })
    ).json();

    const rewritten = await call(owner, 'PATCH', `/views/${view.id}`, {
      filters: { noDueDate: true },
      display: { params: { period: '30' } },
    });
    expect(rewritten.statusCode).toBe(200);
    expect(rewritten.json()).toMatchObject({ filters: { noDueDate: true }, display: { params: { period: '30' } } });

    const cleared = await call(owner, 'PATCH', `/views/${view.id}`, { display: null });
    expect(cleared.json().display).toBeNull();

    expect((await save(owner, { name: '   ', layout: 'LIST', filters: {} })).statusCode).toBe(422);
    expect((await save(owner, { name: 'Не тот экран', layout: 'GANTT', filters: {} })).statusCode).toBe(422);
    const huge = { search: 'я'.repeat(5000) };
    expect((await save(owner, { name: 'Слишком большой', layout: 'LIST', filters: huge })).statusCode).toBe(422);
  });
});
