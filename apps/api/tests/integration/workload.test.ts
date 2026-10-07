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
let busy: TestUser;
let idle: TestUser;
let guest: TestUser;
let project: { id: string };
let statuses: { id: string; category: string }[];

const DAY = 86_400_000;
const noonUtc = (offsetDays: number) =>
  `${new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10)}T12:00:00.000Z`;
/** Midnight UTC of a day counted from today. */
const dayStart = (offsetDays: number) =>
  new Date(`${new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10)}T00:00:00.000Z`);

// Two weeks cut by the test itself, the first one starting the day before
// yesterday: yesterday's task is then both overdue and inside a week.
const bounds = [dayStart(-2), dayStart(5), dayStart(12)];
const boundsQuery = bounds.map((bound) => bound.toISOString()).join(',');

const call = (user: TestUser, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { cookie: user.cookie },
    ...(payload ? { payload: payload as never } : {}),
  });

type Row = {
  userId: string;
  active: number;
  overdue: number;
  noDueDate: number;
  later: number;
  unestimated: number;
  points: number;
  weeks: { count: number; points: number }[];
};

const workload = async (user: TestUser, people: TestUser[]) => {
  const response = await call(
    user,
    'GET',
    `/workspaces/${owner.workspaceId}/issues/workload?assigneeId=${people.map((p) => p.id).join(',')}&bounds=${boundsQuery}`,
  );
  expect(response.statusCode).toBe(200);
  return response.json() as { weeks: { start: string; end: string }[]; rows: Row[]; usesEstimates: boolean; truncated: boolean };
};

const listed = async (user: TestUser, query: string) =>
  (
    (await call(user, 'GET', `/workspaces/${owner.workspaceId}/issues?includeSubtasks=true&limit=200&${query}`)).json() as {
      items: { id: string; title: string; blockedBy: { issueKey: string }[] }[];
    }
  ).items;

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();

  owner = await registerUser(app, { name: 'Владелец Недель', workspaceName: 'Недели' });
  busy = await registerUser(app, { name: 'Занятый Сотрудник' });
  idle = await registerUser(app, { name: 'Свободный Сотрудник' });
  guest = await registerUser(app, { name: 'Гость Недель' });
  await addMember(app, owner, busy.email, 'MEMBER');
  await addMember(app, owner, idle.email, 'MEMBER');
  await addMember(app, owner, guest.email, 'GUEST');
  project = await createProject(app, owner);
  statuses = (await call(owner, 'GET', `/projects/${project.id}`)).json().statuses;

  const give = (title: string, extra: Record<string, unknown> = {}) =>
    createIssue(app, owner, project.id, { title, assigneeId: busy.id, ...extra });

  await give('Давно просрочена', { dueDate: noonUtc(-5) });
  await give('Просрочена вчера', { dueDate: noonUtc(-1) });
  await give('На этой неделе', { dueDate: noonUtc(3), storyPoints: 3 });
  await give('На следующей неделе', { dueDate: noonUtc(8), storyPoints: 2 });
  await give('Через месяц', { dueDate: noonUtc(30) });
  await give('Без срока');
  // A task split into estimated subtasks: only the parts are counted.
  const split = await give('Разбита на части', { dueDate: noonUtc(3), storyPoints: 13 });
  await give('Часть первая', { parentId: split.id, type: 'SUBTASK', storyPoints: 5 });
  await give('Часть вторая', { parentId: split.id, type: 'SUBTASK', storyPoints: 8 });
  // Finished work is nobody's load.
  const done = await give('Уже сделана', { dueDate: noonUtc(3), storyPoints: 40 });
  await call(owner, 'PATCH', `/issues/${done.id}`, {
    statusId: statuses.find((status) => status.category === 'COMPLETED')!.id,
  });
  // Nobody's task is not in anyone's row.
  await createIssue(app, owner, project.id, { title: 'Ничья', dueDate: noonUtc(3) });
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

describe('активные задачи сотрудников по неделям', () => {
  it('считает по сроку: недели, просрочено, без срока, позже — и не складывает оценку задачи с оценками её частей', async () => {
    const data = await workload(owner, [busy, idle]);
    expect(data.weeks).toEqual([
      { start: bounds[0]!.toISOString(), end: bounds[1]!.toISOString() },
      { start: bounds[1]!.toISOString(), end: bounds[2]!.toISOString() },
    ]);
    expect(data.usesEstimates).toBe(true);
    expect(data.truncated).toBe(false);

    const row = data.rows.find((item) => item.userId === busy.id)!;
    // Nine active: six of his own, the split task and its two parts.
    expect(row.active).toBe(9);
    expect(row.overdue).toBe(2);
    expect(row.noDueDate).toBe(3); // «Без срока» and the two parts
    expect(row.later).toBe(1);
    // Yesterday's task is overdue and in its week at once.
    expect(row.weeks[0]).toEqual({ count: 3, points: 3 }); // вчера, «на этой неделе», «разбита на части» (её 13 не в счёт)
    expect(row.weeks[1]).toEqual({ count: 1, points: 2 });
    // 3 + 2 + the parts 5 + 8; the parent's own 13 is not added on top.
    expect(row.points).toBe(18);
    expect(row.unestimated).toBe(4);

    // Someone with nothing on them still has a row — that is the point of comparing.
    expect(data.rows.find((item) => item.userId === idle.id)).toMatchObject({ active: 0, overdue: 0, points: 0 });
  });

  it('каждое число совпадает со списком, который оно открывает', async () => {
    const row = (await workload(owner, [busy])).rows[0]!;
    const base = `assigneeId=${busy.id}&includeDone=false`;

    const week = await listed(
      owner,
      `${base}&dueAfter=${bounds[0]!.toISOString()}&dueBefore=${new Date(bounds[1]!.getTime() - 1).toISOString()}`,
    );
    expect(week).toHaveLength(row.weeks[0]!.count);
    expect(await listed(owner, `${base}&noDueDate=true`)).toHaveLength(row.noDueDate);
    expect(await listed(owner, `${base}&noEstimate=true`)).toHaveLength(row.unestimated);
    expect(await listed(owner, `${base}&dueAfter=${bounds[2]!.toISOString()}`)).toHaveLength(row.later);
    expect(await listed(owner, `assigneeId=${busy.id}&isOverdue=true`)).toHaveLength(row.overdue);

    // The figure next to a person elsewhere follows the same rule for estimates.
    const stats = (await call(owner, 'GET', `/workspaces/${owner.workspaceId}/issues/stats?assigneeId=${busy.id}`)).json();
    expect(stats.items[0]).toMatchObject({ active: row.active, overdue: row.overdue, activePoints: row.points });
  });

  it('гость видит только то, что ему открыто; без границ недель запрос не принимается', async () => {
    // The guest was added to no project: the same person's row is empty for them.
    const forGuest = (await workload(guest, [busy])).rows[0]!;
    expect(forGuest).toMatchObject({ active: 0, overdue: 0, noDueDate: 0, later: 0 });

    const url = `/workspaces/${owner.workspaceId}/issues/workload?assigneeId=${busy.id}`;
    expect((await call(owner, 'GET', url)).statusCode).toBe(400);
    const backwards = [bounds[1], bounds[0]].map((bound) => bound!.toISOString()).join(',');
    expect((await call(owner, 'GET', `${url}&bounds=${backwards}`)).statusCode).toBe(400);
    expect((await call(owner, 'GET', `/workspaces/${owner.workspaceId}/issues/workload?bounds=${boundsQuery}`)).statusCode).toBe(400);
  });
});

describe('чего ждёт задача', () => {
  it('в списке видно, какую незавершённую задачу она ждёт; когда ту закрывают — уже ничего', async () => {
    const first = await createIssue(app, owner, project.id, { title: 'Сначала это', assigneeId: idle.id });
    const second = await createIssue(app, owner, project.id, { title: 'Потом это', assigneeId: idle.id });
    const linked = await call(owner, 'POST', `/projects/${project.id}/dependencies`, {
      predecessorId: first.id,
      successorId: second.id,
    });
    expect(linked.statusCode).toBe(201);

    const waiting = (await listed(owner, `assigneeId=${idle.id}`)).find((issue) => issue.id === second.id)!;
    expect(waiting.blockedBy.map((blocker) => blocker.issueKey)).toEqual([first.issueKey]);
    // The one it waits for waits for nothing.
    expect((await listed(owner, `assigneeId=${idle.id}`)).find((issue) => issue.id === first.id)!.blockedBy).toEqual([]);

    await call(owner, 'PATCH', `/issues/${first.id}`, {
      statusId: statuses.find((status) => status.category === 'COMPLETED')!.id,
    });
    const free = (await listed(owner, `assigneeId=${idle.id}&includeDone=false`)).find((issue) => issue.id === second.id)!;
    expect(free.blockedBy).toEqual([]);
  });
});
