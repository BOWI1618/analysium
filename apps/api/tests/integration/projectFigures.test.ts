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
let project: { id: string };
let statuses: { id: string; name: string; category: string; position: number; isDefault?: boolean }[];

const DAY = 86_400_000;
const noonUtc = (offsetDays: number) =>
  `${new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10)}T12:00:00.000Z`;

const call = (
  user: TestUser,
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { cookie: user.cookie, ...headers },
    ...(payload ? { payload: payload as never } : {}),
  });

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();

  owner = await registerUser(app, { name: 'Владелец Цифр', workspaceName: 'Цифры' });
  worker = await registerUser(app, { name: 'Работник Цифр' });
  await addMember(app, owner, worker.email, 'MEMBER');
  project = await createProject(app, owner);
  statuses = (await call(owner, 'GET', `/projects/${project.id}`)).json().statuses;
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

describe('статус новой задачи', () => {
  it('проект сообщает, какой статус получит задача без выбора, и это не обязательно первая колонка', async () => {
    const preset = statuses.filter((status) => status.isDefault);
    expect(preset).toHaveLength(1);
    expect(preset[0]!.position).not.toBe(0);

    const created = await createIssue(app, owner, project.id, { title: 'Без выбора статуса' });
    expect(created.status.id).toBe(preset[0]!.id);

    // And a status picked in the form is the one that is saved.
    const first = statuses.find((status) => status.position === 0)!;
    const chosen = await createIssue(app, owner, project.id, { title: 'С выбранным статусом', statusId: first.id });
    expect(chosen.status.id).toBe(first.id);
  });
});

describe('аналитика проекта', () => {
  it('«открыто» и «без исполнителя» не включают завершённые и отменённые; по людям видно, что на них сейчас', async () => {
    const fresh = await createProject(app, owner, { name: 'Для аналитики' });
    // A new project has no «отменено» column of its own; the team adds one.
    const added = await call(owner, 'POST', `/projects/${fresh.id}/statuses`, { name: 'Отменено', category: 'CANCELED' });
    expect(added.statusCode).toBe(201);
    const detail = (await call(owner, 'GET', `/projects/${fresh.id}`)).json();
    const byCategory = (category: string) =>
      (detail.statuses as { id: string; category: string }[]).find((status) => status.category === category)!.id;

    await createIssue(app, owner, fresh.id, { title: 'Активная просроченная', assigneeId: worker.id, dueDate: noonUtc(-5) });
    await createIssue(app, owner, fresh.id, { title: 'Активная в срок', assigneeId: worker.id, dueDate: noonUtc(5) });
    await createIssue(app, owner, fresh.id, { title: 'Ничья активная' });
    const done = await createIssue(app, owner, fresh.id, { title: 'Ничья завершённая' });
    await call(owner, 'PATCH', `/issues/${done.id}`, { statusId: byCategory('COMPLETED') });
    const dropped = await createIssue(app, owner, fresh.id, { title: 'Отменённая', assigneeId: worker.id });
    await call(owner, 'PATCH', `/issues/${dropped.id}`, { statusId: byCategory('CANCELED') });

    const dashboard = (await call(owner, 'GET', `/projects/${fresh.id}/dashboard?days=7`)).json();
    expect(dashboard.totals).toEqual({ total: 5, completed: 1, canceled: 1, open: 3, overdue: 1, unassigned: 1 });
    // The period speaks of the period only.
    expect(dashboard.period).toEqual({ days: 7, created: 5, completed: 1 });

    type Row = { user: { id: string } | null; count: number; completed: number; active: number; overdue: number };
    const row = (userId: string | null) =>
      (dashboard.byAssignee as Row[]).find((entry) => (entry.user?.id ?? null) === userId)!;
    expect(row(worker.id)).toMatchObject({ count: 3, completed: 0, active: 2, overdue: 1 });
    // One finished task with nobody on it is not a backlog of unassigned work.
    expect(row(null)).toMatchObject({ count: 2, completed: 1, active: 1, overdue: 0 });
  });

  it('Гант сообщает, целиком ли показан проект', async () => {
    const gantt = (await call(owner, 'GET', `/projects/${project.id}/gantt`)).json();
    expect(gantt.truncated).toBe(false);
  });
});

describe('просрочка считается по часам того, кто смотрит', () => {
  it('срок без времени просрочен в цифре, в списке и в аналитике одинаково — и зависит от зоны браузера', async () => {
    const fresh = await createProject(app, owner, { name: 'Для часовых зон' });
    // A zone whose calendar date differs from the UTC one at this very moment:
    // Kiritimati (UTC+14) is in tomorrow from 10:00 UTC, Pago Pago (UTC−11) is
    // still in yesterday until 11:00 UTC.
    const ahead = new Date().getUTCHours() >= 11;
    const zone = ahead ? 'Pacific/Kiritimati' : 'Pacific/Pago_Pago';
    // Due today by the UTC date (over for Kiritimati), or yesterday (not over yet for Pago Pago).
    await createIssue(app, owner, fresh.id, {
      title: 'На границе суток',
      assigneeId: worker.id,
      dueDate: noonUtc(ahead ? 0 : -1),
    });

    const overdueFor = async (timezone: string) => {
      const headers = { 'x-time-zone': timezone };
      const query = `assigneeId=${worker.id}&projectId=${fresh.id}`;
      const workspace = `/workspaces/${owner.workspaceId}`;
      const stats = (await call(owner, 'GET', `${workspace}/issues/stats?${query}`, undefined, headers)).json();
      const list = (await call(owner, 'GET', `${workspace}/issues?${query}&isOverdue=true`, undefined, headers)).json();
      const dashboard = (await call(owner, 'GET', `/projects/${fresh.id}/dashboard`, undefined, headers)).json();
      // The figure, the filtered list and the project analytics never disagree.
      expect(list.items.length).toBe(stats.items[0].overdue);
      expect(dashboard.totals.overdue).toBe(stats.items[0].overdue);
      return stats.items[0].overdue as number;
    };

    expect(await overdueFor('UTC')).toBe(ahead ? 0 : 1);
    expect(await overdueFor(zone)).toBe(ahead ? 1 : 0);
    // A header that names no real zone falls back to the profile's, not to an error.
    expect(await overdueFor('Not/A_Zone')).toBe(ahead ? 0 : 1);
  });
});

describe('статус для новых задач выбирается в настройках проекта', () => {
  type Status = { id: string; name: string; category: string; position: number; isDefault?: boolean };
  const statusesOf = async (projectId: string) =>
    (await call(owner, 'GET', `/projects/${projectId}`)).json().statuses as Status[];

  it('отметка переходит к выбранному статусу, и задача без статуса попадает в него', async () => {
    const fresh = await createProject(app, owner, { name: 'Свой статус для новых' });
    const before = await statusesOf(fresh.id);
    const first = before.find((status) => status.position === 0)!;
    expect(first.isDefault).toBe(false);

    const picked = await call(owner, 'PATCH', `/projects/${fresh.id}/statuses/${first.id}`, { isDefault: true });
    expect(picked.statusCode).toBe(200);
    expect(picked.json().isDefault).toBe(true);

    // One per project: the mark moved, it was not added.
    const after = await statusesOf(fresh.id);
    expect(after.filter((status) => status.isDefault).map((status) => status.id)).toEqual([first.id]);

    const created = await createIssue(app, owner, fresh.id, { title: 'В новый статус по умолчанию' });
    expect(created.status.id).toBe(first.id);
  });

  it('закрывающий статус не может принимать новые задачи — ни выбором, ни сменой смысла', async () => {
    const fresh = await createProject(app, owner, { name: 'Закрывающий не по умолчанию' });
    const statuses = await statusesOf(fresh.id);
    const done = statuses.find((status) => status.category === 'COMPLETED')!;
    const preset = statuses.find((status) => status.isDefault)!;

    expect((await call(owner, 'PATCH', `/projects/${fresh.id}/statuses/${done.id}`, { isDefault: true })).statusCode).toBe(400);
    expect(
      (await call(owner, 'PATCH', `/projects/${fresh.id}/statuses/${preset.id}`, { category: 'COMPLETED' })).statusCode,
    ).toBe(400);
    // Nothing moved.
    expect((await statusesOf(fresh.id)).filter((status) => status.isDefault).map((status) => status.id)).toEqual([preset.id]);
  });

  it('при удалении статуса для новых задач отметка переходит к первому незакрывающему', async () => {
    const fresh = await createProject(app, owner, { name: 'Удаление статуса по умолчанию' });
    const preset = (await statusesOf(fresh.id)).find((status) => status.isDefault)!;

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${fresh.id}/statuses/${preset.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(removed.statusCode).toBeLessThan(300);

    const left = await statusesOf(fresh.id);
    const heirs = left.filter((status) => status.isDefault);
    expect(heirs).toHaveLength(1);
    expect(['COMPLETED', 'CANCELED']).not.toContain(heirs[0]!.category);
    expect(heirs[0]!.position).toBe(Math.min(...left.filter((s) => !['COMPLETED', 'CANCELED'].includes(s.category)).map((s) => s.position)));
  });
});
