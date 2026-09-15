import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createIssue, createProject, disconnectTestDb, migrateTestSchema, registerUser } from '../setup';
import { carryOverTasks } from '../../src/jobs/carryOver';

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

const DAY = 24 * 60 * 60 * 1000;
const noonUtc = (offsetDays: number) => {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  return new Date(d.getTime() + offsetDays * DAY).toISOString();
};
const atUtc = (offsetDays: number, hours: number) => {
  const d = new Date();
  d.setUTCHours(hours, 0, 0, 0);
  return new Date(d.getTime() + offsetDays * DAY).toISOString();
};

describe('дублирование задачи', () => {
  it('копия с подзадачами и метками, без исполнителя и сроков — по выбору', async () => {
    const owner = await registerUser(app, { workspaceName: 'Дубли' });
    const project = await createProject(app, owner);
    const label = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${project.id}/labels`,
        headers: { cookie: owner.cookie },
        payload: { name: 'важно', color: '#c22e1f' },
      })
    ).json();
    const source = await createIssue(app, owner, project.id, {
      title: 'Отчёт за месяц',
      assigneeId: owner.id,
      dueDate: noonUtc(3),
      labelIds: [label.id],
      priority: 'HIGH',
    });
    await createIssue(app, owner, project.id, { title: 'Собрать цифры', type: 'SUBTASK', parentId: source.id });
    await createIssue(app, owner, project.id, { title: 'Свести таблицу', type: 'SUBTASK', parentId: source.id });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/issues/${source.id}/duplicate`,
      headers: { cookie: owner.cookie },
      payload: { title: 'Отчёт за следующий месяц', assignee: false, dates: false },
    });
    expect(response.statusCode).toBe(201);
    const copy = response.json();

    expect(copy.id).not.toBe(source.id);
    expect(copy.title).toBe('Отчёт за следующий месяц');
    expect(copy.statusId).toBe(source.statusId);
    expect(copy.priority).toBe('HIGH');
    expect(copy.assignee).toBeNull();
    expect(copy.dueDate).toBeNull();
    expect(copy.labels.map((l: { name: string }) => l.name)).toEqual(['важно']);
    expect(copy.subtasks.map((s: { title: string }) => s.title)).toEqual(['Собрать цифры', 'Свести таблицу']);
    expect(copy.subtasks[0].issueKey).toBe(`${copy.issueKey}.1`);

    // The original is left as it was.
    const original = (await app.inject({ method: 'GET', url: `/api/v1/issues/${source.id}`, headers: { cookie: owner.cookie } })).json();
    expect(original.subtasks).toHaveLength(2);
    expect(original.assignee.id).toBe(owner.id);
  });
});

describe('фильтры диаграммы Ганта', () => {
  it('те же фильтры, что у доски: приоритет и скрытие завершённых, подзадачи остаются', async () => {
    const owner = await registerUser(app, { workspaceName: 'Гант с фильтрами' });
    const project = await createProject(app, owner);
    const urgent = await createIssue(app, owner, project.id, { title: 'Срочное', priority: 'URGENT', dueDate: noonUtc(2) });
    await createIssue(app, owner, project.id, { title: 'Часть срочного', type: 'SUBTASK', parentId: urgent.id, priority: 'URGENT' });
    await createIssue(app, owner, project.id, { title: 'Обычное', priority: 'LOW', dueDate: noonUtc(2) });

    const gantt = async (query: string) =>
      (await app.inject({ method: 'GET', url: `/api/v1/projects/${project.id}/gantt?${query}`, headers: { cookie: owner.cookie } })).json();

    const byPriority = await gantt('priority=URGENT');
    expect(byPriority.rows.map((r: { title: string }) => r.title).sort()).toEqual(['Срочное', 'Часть срочного']);

    const done = (
      await app.inject({ method: 'GET', url: `/api/v1/projects/${project.id}`, headers: { cookie: owner.cookie } })
    ).json().statuses.find((s: { category: string }) => s.category === 'COMPLETED');
    await app.inject({ method: 'PATCH', url: `/api/v1/issues/${urgent.id}`, headers: { cookie: owner.cookie }, payload: { statusId: done.id } });

    const open = await gantt('includeDone=false');
    expect(open.rows.map((r: { title: string }) => r.title)).not.toContain('Срочное');
    expect(open.rows.map((r: { title: string }) => r.title)).toContain('Обычное');
  });
});

describe('перенос невыполненных задач на следующий день', () => {
  it('в пространстве с настройкой задачи встают на сегодня и считают дни; ручной срок сбрасывает счётчик', async () => {
    const owner = await registerUser(app, { workspaceName: 'Перенос на завтра' });
    const project = await createProject(app, owner);

    const setting = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${owner.workspaceId}`,
      headers: { cookie: owner.cookie },
      payload: { carryOverTasks: true },
    });
    expect(setting.statusCode).toBe(200);
    expect(setting.json().carryOverTasks).toBe(true);

    const wholeDay = await createIssue(app, owner, project.id, { title: 'Позвонить', dueDate: noonUtc(-3) });
    const timed = await createIssue(app, owner, project.id, {
      title: 'Созвон',
      startDate: atUtc(-2, 9),
      startHasTime: true,
      dueDate: atUtc(-2, 10),
      dueHasTime: true,
    });
    const period = await createIssue(app, owner, project.id, { title: 'Ремонт', startDate: noonUtc(-5), dueDate: noonUtc(-2) });
    const today = await createIssue(app, owner, project.id, { title: 'Сегодняшняя', dueDate: noonUtc(0) });
    const closed = await createIssue(app, owner, project.id, { title: 'Закрытая', dueDate: noonUtc(-4) });
    const done = (
      await app.inject({ method: 'GET', url: `/api/v1/projects/${project.id}`, headers: { cookie: owner.cookie } })
    ).json().statuses.find((s: { category: string }) => s.category === 'COMPLETED');
    await app.inject({ method: 'PATCH', url: `/api/v1/issues/${closed.id}`, headers: { cookie: owner.cookie }, payload: { statusId: done.id } });

    // Another workspace did not turn it on.
    const other = await registerUser(app, { workspaceName: 'Без переноса' });
    const otherProject = await createProject(app, other);
    const untouched = await createIssue(app, other, otherProject.id, { title: 'Как было', dueDate: noonUtc(-3) });

    await carryOverTasks();

    const read = async (id: string, user = owner) =>
      (await app.inject({ method: 'GET', url: `/api/v1/issues/${id}`, headers: { cookie: user.cookie } })).json();

    const movedWholeDay = await read(wholeDay.id);
    expect(movedWholeDay.dueDate).toBe(noonUtc(0));
    expect(movedWholeDay.carriedOverDays).toBe(3);

    const movedTimed = await read(timed.id);
    expect(movedTimed.startDate).toBe(atUtc(0, 9));
    expect(movedTimed.dueDate).toBe(atUtc(0, 10));
    expect(movedTimed.dueHasTime).toBe(true);

    const movedPeriod = await read(period.id);
    expect(movedPeriod.startDate).toBe(noonUtc(-5));
    expect(movedPeriod.dueDate).toBe(noonUtc(0));

    expect((await read(today.id)).carriedOverDays).toBe(0);
    expect((await read(closed.id)).dueDate).toBe(noonUtc(-4));
    expect((await read(untouched.id, other)).dueDate).toBe(noonUtc(-3));

    // Running again the same day changes nothing.
    await carryOverTasks();
    expect((await read(wholeDay.id)).carriedOverDays).toBe(3);

    const reset = await app.inject({
      method: 'PATCH',
      url: `/api/v1/issues/${wholeDay.id}`,
      headers: { cookie: owner.cookie },
      payload: { dueDate: noonUtc(2) },
    });
    expect(reset.json().carriedOverDays).toBe(0);
  });
});
