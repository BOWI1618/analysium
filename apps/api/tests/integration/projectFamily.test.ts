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

/**
 * A project opened together with its subprojects: one board, one list, one
 * set of figures — while every task keeps to its own project's statuses.
 */
let app: FastifyInstance;
let owner: TestUser;
let guest: TestUser;
let main: { id: string };
let sub: { id: string };
let other: { id: string };

type Status = { id: string; name: string; category: string };
let mainStatuses: Status[];
let subStatuses: Status[];

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const call = (user: TestUser, method: Method, url: string, payload?: unknown) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { cookie: user.cookie },
    ...(payload ? { payload: payload as never } : {}),
  });

const statusesOf = async (projectId: string) => (await call(owner, 'GET', `/projects/${projectId}`)).json().statuses as Status[];
const named = (statuses: Status[], name: string) => statuses.find((status) => status.name === name)!;
const read = async (id: string) =>
  (await call(owner, 'GET', `/issues/${id}`)).json() as { id: string; statusId: string; status: Status; projectId: string };

type Card = { id: string; title: string; projectId: string; project: { id: string; icon: string } };
const board = async (user: TestUser, projectId: string, query = '') =>
  (await call(user, 'GET', `/projects/${projectId}/board${query}`)).json().columns as { status: Status; issues: Card[]; total: number; ownTotal: number }[];
const list = async (user: TestUser, projectId: string, query = '') =>
  (await call(user, 'GET', `/projects/${projectId}/issues${query}`)).json().items as Card[];
const titlesIn = (columns: Awaited<ReturnType<typeof board>>, name: string) =>
  columns
    .find((column) => column.status.name === name)!
    .issues.map((issue) => issue.title)
    .sort();

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();

  owner = await registerUser(app, { name: 'Владелец Семьи', workspaceName: 'Семья проектов' });
  guest = await registerUser(app, { name: 'Гость Семьи' });
  await addMember(app, owner, guest.email, 'GUEST');

  main = await createProject(app, owner, { name: 'Основной' });
  sub = (await call(owner, 'POST', `/workspaces/${owner.workspaceId}/projects`, { name: 'Подпроект', parentId: main.id, icon: 'calendar-days' })).json();
  other = await createProject(app, owner, { name: 'Посторонний' });
  // The guest is in the main project only: the subproject stays closed to them.
  await call(owner, 'POST', `/projects/${main.id}/members`, { userId: guest.id, role: 'CONTRIBUTOR' });

  // The subproject has a column of its own that the main project lacks.
  await call(owner, 'POST', `/projects/${sub.id}/statuses`, { name: 'Тестирование', category: 'STARTED' });
  mainStatuses = await statusesOf(main.id);
  subStatuses = await statusesOf(sub.id);

  await createIssue(app, owner, main.id, { title: 'Своя в работе', statusId: named(mainStatuses, 'В работе').id });
  await createIssue(app, owner, main.id, { title: 'Своя в бэклоге', statusId: named(mainStatuses, 'Бэклог').id });
  await createIssue(app, owner, sub.id, { title: 'Подпроекта в работе', statusId: named(subStatuses, 'В работе').id });
  await createIssue(app, owner, sub.id, { title: 'Подпроекта на тестировании', statusId: named(subStatuses, 'Тестирование').id });
  await createIssue(app, owner, sub.id, { title: 'Подпроекта готова', statusId: named(subStatuses, 'Готово').id });
  await createIssue(app, owner, other.id, { title: 'Постороннего проекта' });
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

describe('в основном проекте видны задачи подпроектов', () => {
  it('доска: задачи подпроекта стоят в колонках основного — по названию статуса, а без такого — по смыслу', async () => {
    const columns = await board(owner, main.id, '?withSubprojects=true');
    // The columns are the main project's own.
    expect(columns.map((column) => column.status.id)).toEqual(mainStatuses.map((status) => status.id));
    // «Тестирование» has no column here: it means «в процессе», so it stands in the first such column.
    expect(titlesIn(columns, 'В работе')).toEqual(['Подпроекта в работе', 'Подпроекта на тестировании', 'Своя в работе']);
    expect(titlesIn(columns, 'Готово')).toEqual(['Подпроекта готова']);
    expect(titlesIn(columns, 'Бэклог')).toEqual(['Своя в бэклоге']);
    // Three cards, one of them the project's own: the column's limit is held against that one.
    expect(columns.find((column) => column.status.name === 'В работе')).toMatchObject({ total: 3, ownTotal: 1 });
    expect(columns.find((column) => column.status.name === 'Бэклог')).toMatchObject({ total: 1, ownTotal: 1 });

    // A card says which project it is from — that is what the subproject's icon is drawn by.
    const foreign = columns.flatMap((column) => column.issues).find((issue) => issue.title === 'Подпроекта в работе')!;
    expect(foreign.project).toMatchObject({ id: sub.id, icon: 'calendar-days' });

    // Nothing from an unrelated project, and nothing at all unless asked for.
    const everything = columns.flatMap((column) => column.issues.map((issue) => issue.title));
    expect(everything).not.toContain('Постороннего проекта');
    const alone = (await board(owner, main.id)).flatMap((column) => column.issues.map((issue) => issue.title)).sort();
    expect(alone).toEqual(['Своя в бэклоге', 'Своя в работе']);
    // The subproject opened by itself shows only its own.
    const below = (await board(owner, sub.id, '?withSubprojects=true')).flatMap((column) => column.issues.map((issue) => issue.title));
    expect(below).not.toContain('Своя в работе');
  });

  it('список и фильтр по статусу: статус основного проекта находит и то, что стоит в его колонке у подпроекта', async () => {
    const all = (await list(owner, main.id, '?withSubprojects=true')).map((issue) => issue.title).sort();
    expect(all).toEqual(['Подпроекта в работе', 'Подпроекта готова', 'Подпроекта на тестировании', 'Своя в бэклоге', 'Своя в работе']);

    const inProgress = await list(owner, main.id, `?withSubprojects=true&statusId=${named(mainStatuses, 'В работе').id}`);
    expect(inProgress.map((issue) => issue.title).sort()).toEqual(['Подпроекта в работе', 'Подпроекта на тестировании', 'Своя в работе']);

    // The Gantt chart of the project draws the same family, each row with its project.
    const chart = (await call(owner, 'GET', `/projects/${main.id}/gantt?withSubprojects=true`)).json();
    const rows = chart.rows as { title: string; project: { id: string } }[];
    expect(rows.map((row) => row.title).sort()).toEqual(all);
    expect(rows.find((row) => row.title === 'Подпроекта готова')!.project.id).toBe(sub.id);
  });

  it('аналитика основного проекта считает и подпроекты; у подпроекта она своя', async () => {
    const whole = (await call(owner, 'GET', `/projects/${main.id}/dashboard`)).json();
    expect(whole.totals).toMatchObject({ total: 5, completed: 1, open: 4 });
    const inProgress = (whole.byStatus as { name: string; count: number }[]).find((row) => row.name === 'В работе')!;
    expect(inProgress.count).toBe(3);

    const own = (await call(owner, 'GET', `/projects/${sub.id}/dashboard`)).json();
    expect(own.totals).toMatchObject({ total: 3, completed: 1, open: 2 });
  });

  it('подпроект, закрытый человеку, ничего не добавляет: ни задач, ни цифр', async () => {
    const seen = (await board(guest, main.id, '?withSubprojects=true')).flatMap((column) => column.issues.map((issue) => issue.title)).sort();
    expect(seen).toEqual(['Своя в бэклоге', 'Своя в работе']);
    expect((await list(guest, main.id, '?withSubprojects=true')).map((issue) => issue.title).sort()).toEqual(seen);
    expect((await call(guest, 'GET', `/projects/${main.id}/dashboard`)).json().totals.total).toBe(2);
  });
});

describe('задача подпроекта на доске основного проекта', () => {
  it('перенесённая в колонку основного, получает свой статус с тем же названием; перестановка в колонке статус не меняет', async () => {
    const task = await createIssue(app, owner, sub.id, { title: 'Двигаем с доски основного', statusId: named(subStatuses, 'К выполнению').id });

    const moved = await call(owner, 'POST', `/issues/${task.id}/move`, { statusId: named(mainStatuses, 'На ревью').id });
    expect(moved.statusCode).toBe(200);
    // Its own project's «На ревью», not the main project's.
    expect((await read(task.id)).statusId).toBe(named(subStatuses, 'На ревью').id);

    // Dropped into the same column again — a reorder: no second change of status in its history.
    const again = await call(owner, 'POST', `/issues/${task.id}/move`, { statusId: named(mainStatuses, 'На ревью').id });
    expect(again.statusCode).toBe(200);
    const history = (await call(owner, 'GET', `/issues/${task.id}/activity`)).json();
    const changes = ((history.items ?? history) as { type: string }[]).filter((event) => event.type === 'STATUS_CHANGED');
    expect(changes).toHaveLength(1);

    // On the main board it now stands in that column.
    const columns = await board(owner, main.id, '?withSubprojects=true');
    expect(titlesIn(columns, 'На ревью')).toContain('Двигаем с доски основного');
  });

  it('статус из списка основного проекта переводится в свой — в карточке и пакетом; чужой проект так не делает', async () => {
    const first = await createIssue(app, owner, sub.id, { title: 'Статус из списка основного' });
    const patched = await call(owner, 'PATCH', `/issues/${first.id}`, { statusId: named(mainStatuses, 'Готово').id });
    expect(patched.statusCode).toBe(200);
    expect((await read(first.id)).statusId).toBe(named(subStatuses, 'Готово').id);

    // A batch picked in the main project's list: its own task and a subproject's, one status for both.
    const mine = await createIssue(app, owner, main.id, { title: 'Своя в пакете' });
    const theirs = await createIssue(app, owner, sub.id, { title: 'Подпроекта в пакете' });
    const batch = await call(owner, 'POST', `/workspaces/${owner.workspaceId}/issues/bulk`, {
      issueIds: [mine.id, theirs.id],
      patch: { statusId: named(mainStatuses, 'В работе').id },
    });
    expect(batch.statusCode).toBe(200);
    expect(batch.json()).toEqual({ updated: 2 });
    expect((await read(mine.id)).statusId).toBe(named(mainStatuses, 'В работе').id);
    expect((await read(theirs.id)).statusId).toBe(named(subStatuses, 'В работе').id);

    // A project that is neither above nor below: its status means nothing here.
    const stranger = await createIssue(app, owner, other.id, { title: 'Чужая' });
    expect((await call(owner, 'PATCH', `/issues/${stranger.id}`, { statusId: named(mainStatuses, 'Готово').id })).statusCode).toBe(400);
    const mixed = await call(owner, 'POST', `/workspaces/${owner.workspaceId}/issues/bulk`, {
      issueIds: [mine.id, stranger.id],
      patch: { statusId: named(mainStatuses, 'Готово').id },
    });
    expect(mixed.statusCode).toBe(400);
    expect((await read(mine.id)).statusId).toBe(named(mainStatuses, 'В работе').id);
  });
});
