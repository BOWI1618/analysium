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
let worker: TestUser;
let guest: TestUser;
let open: { id: string };
let closed: { id: string };

const DAY = 86_400_000;
const noon = (offsetDays: number) => {
  const date = new Date(Date.now() + offsetDays * DAY);
  return `${date.toISOString().slice(0, 10)}T12:00:00.000Z`;
};

const call = (user: TestUser, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { cookie: user.cookie }, ...(payload ? { payload: payload as never } : {}) });

const stats = async (user: TestUser, query: string) => {
  const response = await call(user, 'GET', `/workspaces/${owner.workspaceId}/issues/stats?${query}`);
  expect(response.statusCode).toBe(200);
  return response.json().items as { userId: string; active: number; overdue: number; dueSoon: number; done: number }[];
};

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();

  owner = await registerUser(app, { name: 'Руководитель', workspaceName: 'Счётчики' });
  worker = await registerUser(app, { name: 'Исполнитель Работ' });
  guest = await registerUser(app, { name: 'Гость Счётчиков' });
  await addMember(app, owner, worker.email, 'MEMBER');
  await addMember(app, owner, guest.email, 'GUEST');

  open = await createProject(app, owner, { name: 'Открытый' });
  closed = await createProject(app, owner, { name: 'Закрытый для гостя' });
  await call(owner, 'POST', `/projects/${open.id}/members`, { userId: guest.id, role: 'VIEWER' });

  // In the project the guest can see: one overdue, one due tomorrow with a
  // subtask of its own, one far ahead, one finished.
  await createIssue(app, owner, open.id, { title: 'Просрочена', assigneeId: worker.id, dueDate: noon(-10), storyPoints: 5 });
  const parent = await createIssue(app, owner, open.id, { title: 'Завтра', assigneeId: worker.id, dueDate: noon(1) });
  await createIssue(app, owner, open.id, { title: 'Подзадача', assigneeId: worker.id, parentId: parent.id, type: 'SUBTASK' });
  await createIssue(app, owner, open.id, { title: 'Через месяц', assigneeId: worker.id, dueDate: noon(30), storyPoints: 3 });
  // Points of finished work are not part of what someone still carries.
  const finished = await createIssue(app, owner, open.id, { title: 'Готова', assigneeId: worker.id, storyPoints: 8 });
  const project = (await call(owner, 'GET', `/projects/${open.id}`)).json();
  const done = project.statuses.find((status: { category: string }) => status.category === 'COMPLETED');
  await call(owner, 'PATCH', `/issues/${finished.id}`, { statusId: done.id });

  // And two more in a project the guest is not in.
  await createIssue(app, owner, closed.id, { title: 'Скрытая просроченная', assigneeId: worker.id, dueDate: noon(-3) });
  await createIssue(app, owner, closed.id, { title: 'Скрытая обычная', assigneeId: worker.id });
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

describe('задачи сотрудника в цифрах', () => {
  it('считает активные, просроченные, ближайшие и завершённые по всем проектам, вместе с подзадачами', async () => {
    const [figures] = await stats(owner, `assigneeId=${worker.id}`);
    expect(figures).toEqual({ userId: worker.id, active: 6, overdue: 2, dueSoon: 1, done: 1, activePoints: 8 });
  });

  it('«без срока» считает и показывает только задачи без срока', async () => {
    const [figures] = await stats(owner, `assigneeId=${worker.id}&noDueDate=true`);
    // The subtask and the plain task in the closed project; the finished one is not active.
    expect(figures).toMatchObject({ active: 2, overdue: 0, dueSoon: 0, done: 1 });

    const list = await call(
      owner,
      'GET',
      `/workspaces/${owner.workspaceId}/issues?assigneeId=${worker.id}&noDueDate=true&includeSubtasks=true&includeDone=false`,
    );
    const titles = (list.json().items as { title: string }[]).map((issue) => issue.title).sort();
    expect(titles).toEqual(['Подзадача', 'Скрытая обычная']);
  });

  it('фильтр проекта сужает цифры так же, как список', async () => {
    const [figures] = await stats(owner, `assigneeId=${worker.id}&projectId=${closed.id}`);
    expect(figures).toMatchObject({ active: 2, overdue: 1, dueSoon: 0, done: 0 });
  });

  it('гость видит цифры и задачи только своих проектов', async () => {
    const [figures] = await stats(guest, `assigneeId=${worker.id}`);
    expect(figures).toMatchObject({ active: 4, overdue: 1, dueSoon: 1, done: 1 });

    // Asking for the hidden project by id changes nothing: there is nothing to count.
    const [hidden] = await stats(guest, `assigneeId=${worker.id}&projectId=${closed.id}`);
    expect(hidden).toMatchObject({ active: 0, overdue: 0, dueSoon: 0, done: 0 });

    const list = await call(
      guest,
      'GET',
      `/workspaces/${owner.workspaceId}/issues?assigneeId=${worker.id}&includeSubtasks=true&limit=200`,
    );
    const titles = (list.json().items as { title: string }[]).map((issue) => issue.title);
    expect(titles).toContain('Подзадача');
    expect(titles.some((title) => title.startsWith('Скрытая'))).toBe(false);
  });

  it('несколько человек одним запросом; без людей запрос отклоняется', async () => {
    const items = await stats(owner, `assigneeId=${worker.id},${owner.id}`);
    expect(items.map((item) => item.userId)).toEqual([worker.id, owner.id]);
    expect(items[1]).toMatchObject({ active: 0, overdue: 0 });

    const empty = await call(owner, 'GET', `/workspaces/${owner.workspaceId}/issues/stats`);
    expect(empty.statusCode).toBe(400);
  });

  it('человек из чужого пространства цифр не получает', async () => {
    const outsider = await registerUser(app, { name: 'Посторонний' });
    const response = await call(outsider, 'GET', `/workspaces/${owner.workspaceId}/issues/stats?assigneeId=${worker.id}`);
    expect(response.statusCode).toBe(404);
  });
});
