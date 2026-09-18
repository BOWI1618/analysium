import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createIssue, createProject, disconnectTestDb, migrateTestSchema, registerUser, type TestUser } from '../setup';

let app: FastifyInstance;
let owner: TestUser;
let projectId: string;
let doneId: string;
let todoId: string;

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();

  owner = await registerUser(app, { workspaceName: 'Повторы' });
  projectId = (await createProject(app, owner)).id;
  const project = (
    await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}`, headers: { cookie: owner.cookie } })
  ).json();
  doneId = project.statuses.find((s: { category: string }) => s.category === 'COMPLETED').id;
  todoId = project.statuses.find((s: { category: string }) => s.category === 'UNSTARTED').id;
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

const noonUtc = (offsetDays: number) => {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  return new Date(d.getTime() + offsetDays * 24 * 60 * 60 * 1000).toISOString();
};

const patch = (issueId: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'PATCH', url: `/api/v1/issues/${issueId}`, headers: { cookie: owner.cookie }, payload });

const tasksTitled = async (title: string) => {
  const list = (
    await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/issues?includeDone=true&limit=100`,
      headers: { cookie: owner.cookie },
    })
  ).json().items as { id: string; title: string; dueDate: string | null; recurrence: string | null; status: { category: string }; subtaskCount: number }[];
  return list.filter((issue) => issue.title === title);
};

describe('повторяющиеся задачи', () => {
  it('закрытая еженедельная задача возвращается через неделю вместе с подзадачами', async () => {
    const issue = await createIssue(app, owner, projectId, { title: 'Недельный отчёт', dueDate: noonUtc(0) });
    await createIssue(app, owner, projectId, { title: 'Собрать цифры', type: 'SUBTASK', parentId: issue.id });
    expect((await patch(issue.id, { recurrence: 'WEEKLY' })).json().recurrence).toBe('WEEKLY');

    const closed = (await patch(issue.id, { statusId: doneId })).json();
    expect(closed.recurrence).toBeNull();

    const tasks = await tasksTitled('Недельный отчёт');
    expect(tasks).toHaveLength(2);
    const next = tasks.find((t) => t.id !== issue.id)!;
    expect(next.recurrence).toBe('WEEKLY');
    expect(next.status.category).not.toBe('COMPLETED');
    expect(next.dueDate).toBe(noonUtc(7));
    expect(next.subtaskCount).toBe(1);

    // Reopened and closed again, the old one does not make a second copy.
    await patch(issue.id, { statusId: todoId });
    await patch(issue.id, { statusId: doneId });
    expect(await tasksTitled('Недельный отчёт')).toHaveLength(2);
  });

  it('закрытие перетаскиванием на доске тоже создаёт следующую', async () => {
    const issue = await createIssue(app, owner, projectId, { title: 'Полить цветы', recurrence: 'DAILY' });
    const moved = await app.inject({
      method: 'POST',
      url: `/api/v1/issues/${issue.id}/move`,
      headers: { cookie: owner.cookie },
      payload: { statusId: doneId },
    });
    expect(moved.statusCode).toBe(200);

    const tasks = await tasksTitled('Полить цветы');
    expect(tasks).toHaveLength(2);
    // No deadline: counted from today, so it comes back tomorrow.
    expect(tasks.find((t) => t.id !== issue.id)!.dueDate).toBe(noonUtc(1));
  });

  it('подзадача не повторяется сама по себе', async () => {
    const parent = await createIssue(app, owner, projectId, { title: 'Родитель' });
    const subtask = await createIssue(app, owner, projectId, { title: 'Часть', type: 'SUBTASK', parentId: parent.id });
    expect((await patch(subtask.id, { recurrence: 'DAILY' })).statusCode).toBe(400);
  });
});
