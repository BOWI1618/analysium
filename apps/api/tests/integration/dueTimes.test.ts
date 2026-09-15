import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createIssue, createProject, disconnectTestDb, migrateTestSchema, registerUser } from '../setup';

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

const HOUR = 60 * 60 * 1000;
const noonUtc = (offsetDays: number) => {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  return new Date(d.getTime() + offsetDays * 24 * HOUR).toISOString();
};

describe('время у сроков', () => {
  it('срок со временем сохраняется и сбрасывается, если дату задать без времени', async () => {
    const owner = await registerUser(app, { workspaceName: 'Время сроков' });
    const project = await createProject(app, owner);
    const at = new Date(Date.now() + 5 * HOUR).toISOString();

    const issue = await createIssue(app, owner, project.id, { title: 'Созвон', dueDate: at, dueHasTime: true });
    expect(issue.dueHasTime).toBe(true);
    expect(issue.dueDate).toBe(at);

    const start = await app.inject({
      method: 'PATCH',
      url: `/api/v1/issues/${issue.id}`,
      headers: { cookie: owner.cookie },
      payload: { startDate: new Date(Date.now() + 4 * HOUR).toISOString(), startHasTime: true },
    });
    expect(start.json().startHasTime).toBe(true);
    expect(start.json().dueHasTime).toBe(true);

    // A new date sent without a time is a whole-day date.
    const wholeDay = await app.inject({
      method: 'PATCH',
      url: `/api/v1/issues/${issue.id}`,
      headers: { cookie: owner.cookie },
      payload: { dueDate: noonUtc(1) },
    });
    expect(wholeDay.json().dueHasTime).toBe(false);

    const cleared = await app.inject({
      method: 'PATCH',
      url: `/api/v1/issues/${issue.id}`,
      headers: { cookie: owner.cookie },
      payload: { startDate: null },
    });
    expect(cleared.json().startHasTime).toBe(false);
  });

  it('просрочено: время прошло, а срок без времени — только когда закончился его день', async () => {
    const owner = await registerUser(app, { workspaceName: 'Просрочка' });
    const project = await createProject(app, owner);
    const today = await createIssue(app, owner, project.id, { title: 'Сегодня весь день', dueDate: noonUtc(0) });
    const passed = await createIssue(app, owner, project.id, {
      title: 'Час назад',
      dueDate: new Date(Date.now() - HOUR).toISOString(),
      dueHasTime: true,
    });
    const yesterday = await createIssue(app, owner, project.id, { title: 'Вчера', dueDate: noonUtc(-1) });

    const overdue = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/issues?isOverdue=true`,
      headers: { cookie: owner.cookie },
    });
    const ids = overdue.json().items.map((i: { id: string }) => i.id);
    expect(ids).toContain(passed.id);
    expect(ids).toContain(yesterday.id);
    // Used to be overdue from noon UTC — 15:00 in Moscow — on the day itself.
    expect(ids).not.toContain(today.id);

    const gantt = await app.inject({ method: 'GET', url: `/api/v1/projects/${project.id}/gantt`, headers: { cookie: owner.cookie } });
    const row = (id: string) => gantt.json().rows.find((r: { id: string }) => r.id === id);
    expect(row(passed.id).isOverdue).toBe(true);
    expect(row(passed.id).endHasTime).toBe(true);
    expect(row(today.id).isOverdue).toBe(false);
  });

  it('перенос на диаграмме по часам сохраняет время', async () => {
    const owner = await registerUser(app, { workspaceName: 'Перенос по часам' });
    const project = await createProject(app, owner);
    const start = new Date(Date.now() + 24 * HOUR);
    const issue = await createIssue(app, owner, project.id, {
      title: 'Встреча',
      startDate: start.toISOString(),
      dueDate: new Date(start.getTime() + HOUR).toISOString(),
      startHasTime: true,
      dueHasTime: true,
    });
    const moved = await app.inject({
      method: 'POST',
      url: `/api/v1/issues/${issue.id}/reschedule`,
      headers: { cookie: owner.cookie },
      payload: {
        startDate: new Date(start.getTime() + HOUR / 2).toISOString(),
        dueDate: new Date(start.getTime() + 1.5 * HOUR).toISOString(),
      },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().issue.startHasTime).toBe(true);
    expect(moved.json().issue.dueHasTime).toBe(true);
  });
});

describe('фильтры календаря', () => {
  it('includeDone=false скрывает закрытые; периоды попадают по пересечению; noDates — только без дат', async () => {
    const owner = await registerUser(app, { workspaceName: 'Фильтры календаря' });
    const project = await createProject(app, owner);
    const statuses = (await app.inject({ method: 'GET', url: `/api/v1/projects/${project.id}`, headers: { cookie: owner.cookie } })).json().statuses;
    const doneId = statuses.find((s: { category: string }) => s.category === 'COMPLETED').id;

    const closed = await createIssue(app, owner, project.id, { title: 'Закрыта', statusId: doneId });
    const open = await createIssue(app, owner, project.id, { title: 'Открыта' });
    const list = async (query: string) =>
      (await app.inject({ method: 'GET', url: `/api/v1/projects/${project.id}/issues?${query}`, headers: { cookie: owner.cookie } }))
        .json()
        .items.map((i: { id: string }) => i.id);

    // "false" in a query string used to be read as true.
    const withoutDone = await list('includeDone=false');
    expect(withoutDone).toContain(open.id);
    expect(withoutDone).not.toContain(closed.id);

    const period = await createIssue(app, owner, project.id, { title: 'Период', startDate: noonUtc(-3), dueDate: noonUtc(3) });
    const later = await createIssue(app, owner, project.id, { title: 'Позже', dueDate: noonUtc(10) });
    const window = `overlapsFrom=${encodeURIComponent(noonUtc(0))}&overlapsTo=${encodeURIComponent(noonUtc(1))}`;
    const inWindow = await list(window);
    expect(inWindow).toContain(period.id);
    expect(inWindow).not.toContain(later.id);
    expect(inWindow).not.toContain(open.id);

    const undated = await list('noDates=true');
    expect(undated).toContain(open.id);
    expect(undated).not.toContain(period.id);
  });
});
