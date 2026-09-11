import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  createIssue,
  createProject,
  dropTestSchema,
  migrateTestSchema,
  registerUser,
  type TestUser,
} from '../setup';

let app: FastifyInstance;
let owner: TestUser;
let project: { id: string; statuses: { id: string; name: string; category: string }[] };

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();
  owner = await registerUser(app, { name: 'Скрам-мастер', email: 'owner@sprints.test' });
  project = await createProject(app, owner, { name: 'Скрам', key: 'SCR', projectType: 'SCRUM' });
});

afterAll(async () => {
  await app?.close();
  await dropTestSchema();
});


async function newSprint(name: string, extra: Record<string, unknown> = {}, projectId = project.id) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/sprints`,
    headers: { cookie: owner.cookie },
    payload: { name, ...extra },
  });
  if (response.statusCode !== 201) throw new Error(`sprint create failed: ${response.body}`);
  return response.json();
}

/**
 * A project can only ever have one ACTIVE sprint, so any test that starts one
 * gets its own project — otherwise the suite would depend on execution order.
 */
let scratchCount = 0;
async function scratchProject() {
  scratchCount += 1;
  return createProject(app, owner, {
    name: `Скрам ${scratchCount}`,
    key: `S${String(scratchCount).padStart(2, '0')}`,
    projectType: 'SCRUM',
  });
}

const start = (sprintId: string) =>
  app.inject({ method: 'POST', url: `/api/v1/sprints/${sprintId}/start`, headers: { cookie: owner.cookie } });

describe('sprint lifecycle', () => {
  it('creates a sprint in the PLANNED state', async () => {
    const sprint = await newSprint('Спринт 1');
    expect(sprint.status).toBe('PLANNED');
    expect(sprint.issueCount).toBe(0);
  });

  it('rejects an end date before the start date', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/sprints`,
      headers: { cookie: owner.cookie },
      payload: {
        name: 'Задом наперёд',
        startDate: '2026-05-10T00:00:00.000Z',
        endDate: '2026-05-01T00:00:00.000Z',
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('starts a sprint and records the committed points', async () => {
    const own = await scratchProject();
    const sprint = await newSprint('Спринт со стартом', {}, own.id);
    await createIssue(app, owner, own.id, {
      title: 'Оценённая задача',
      sprintId: sprint.id,
      storyPoints: 5,
    });

    const started = await start(sprint.id);

    expect(started.statusCode).toBe(200);
    expect(started.json().status).toBe('ACTIVE');
    expect(started.json().totalPoints).toBe(5);
  });

  it('refuses to start an already active sprint', async () => {
    const own = await scratchProject();
    const sprint = await newSprint('Двойной старт', {}, own.id);
    expect((await start(sprint.id)).statusCode).toBe(200);

    const again = await start(sprint.id);
    expect(again.statusCode).toBe(400);
  });

  it('refuses to run two sprints at once in one project', async () => {
    const own = await scratchProject();
    const first = await newSprint('Первый', {}, own.id);
    const second = await newSprint('Второй', {}, own.id);

    expect((await start(first.id)).statusCode).toBe(200);

    const clash = await start(second.id);
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.code).toBe('CONFLICT');
  });

  it('moves unfinished issues to the backlog on completion', async () => {
    const own = await scratchProject();
    const sprint = await newSprint('Завершаемый', {}, own.id);
    const done = await createIssue(app, owner, own.id, { title: 'Готово', sprintId: sprint.id });
    const open = await createIssue(app, owner, own.id, { title: 'Не готово', sprintId: sprint.id });

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/issues/${done.id}`,
      headers: { cookie: owner.cookie },
      payload: { statusId: own.statuses.find((s: { category: string }) => s.category === 'COMPLETED').id },
    });

    await start(sprint.id);

    const completed = await app.inject({
      method: 'POST',
      url: `/api/v1/sprints/${sprint.id}/complete`,
      headers: { cookie: owner.cookie },
      payload: { moveUnfinishedTo: 'backlog' },
    });

    expect(completed.statusCode).toBe(200);
    expect(completed.json().movedCount).toBe(1);
    expect(completed.json().sprint.status).toBe('COMPLETED');

    // The finished issue stays in the sprint; the unfinished one leaves it.
    const stayed = await app.inject({
      method: 'GET',
      url: `/api/v1/issues/${done.id}`,
      headers: { cookie: owner.cookie },
    });
    const left = await app.inject({
      method: 'GET',
      url: `/api/v1/issues/${open.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(stayed.json().sprintId).toBe(sprint.id);
    expect(left.json().sprintId).toBeNull();
  });

  it('can carry unfinished issues into the next sprint instead', async () => {
    const own = await scratchProject();
    const current = await newSprint('Текущий', {}, own.id);
    const next = await newSprint('Следующий', {}, own.id);
    const carried = await createIssue(app, owner, own.id, { title: 'Переносится', sprintId: current.id });

    await start(current.id);
    await app.inject({
      method: 'POST',
      url: `/api/v1/sprints/${current.id}/complete`,
      headers: { cookie: owner.cookie },
      payload: { moveUnfinishedTo: next.id },
    });

    const issue = await app.inject({
      method: 'GET',
      url: `/api/v1/issues/${carried.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(issue.json().sprintId).toBe(next.id);
  });

  it('refuses to complete a sprint that was never started', async () => {
    const sprint = await newSprint('Не начинался');
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/sprints/${sprint.id}/complete`,
      headers: { cookie: owner.cookie },
      payload: { moveUnfinishedTo: 'backlog' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses to delete an active sprint', async () => {
    const own = await scratchProject();
    const sprint = await newSprint('Активный', {}, own.id);
    expect((await start(sprint.id)).statusCode).toBe(200);

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/sprints/${sprint.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns issues to the backlog when a planned sprint is deleted', async () => {
    const sprint = await newSprint('Удаляемый');
    const issue = await createIssue(app, owner, project.id, { title: 'Вернётся', sprintId: sprint.id });

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/sprints/${sprint.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(deleted.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/issues/${issue.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(after.statusCode).toBe(200);
    expect(after.json().sprintId).toBeNull();
  });
});

describe('sprint access control', () => {
  it('hides another workspace’s sprints', async () => {
    const outsider = await registerUser(app, { email: 'outsider@sprints.test' });
    const sprint = await newSprint('Приватный');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sprints/${sprint.id}`,
      headers: { cookie: outsider.cookie },
      payload: { name: 'Взлом' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('will not put an issue into a sprint from a different project', async () => {
    const other = await createProject(app, owner, { name: 'Другой', key: 'OTH', projectType: 'SCRUM' });
    const sprint = await newSprint('Чужой спринт');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/issues',
      headers: { cookie: owner.cookie },
      payload: { projectId: other.id, title: 'Не туда', sprintId: sprint.id },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('backlog view', () => {
  it('lists only issues with no sprint', async () => {
    const sprint = await newSprint('Для бэклога');
    await createIssue(app, owner, project.id, { title: 'В спринте', sprintId: sprint.id });
    await createIssue(app, owner, project.id, { title: 'В бэклоге' });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/issues?noSprint=true`,
      headers: { cookie: owner.cookie },
    });

    const items = response.json().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i: { sprintId: string | null }) => i.sprintId === null)).toBe(true);
  });
});
