import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addMember, createIssue, createProject, disconnectTestDb, login, migrateTestSchema, registerUser } from '../setup';
import { prisma } from '../../src/lib/prisma';

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

type User = Awaited<ReturnType<typeof registerUser>>;

const transfer = (user: { cookie: string }, issueId: string, projectId: string) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/issues/${issueId}/transfer`,
    headers: { cookie: user.cookie },
    payload: { projectId },
  });

async function statusId(user: User, projectId: string, name: string) {
  const project = await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}`, headers: { cookie: user.cookie } });
  return project.json().statuses.find((s: { name: string }) => s.name === name).id as string;
}

describe('перенос задачи в другой проект', () => {
  it('задача без проекта переезжает с подзадачей, статусом и метками, старый ключ открывает её', async () => {
    const owner = await registerUser(app, { workspaceName: 'Перенос задач' });
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/issues',
      headers: { cookie: owner.cookie },
      payload: { workspaceId: owner.workspaceId, title: 'Пока без проекта' },
    });
    const task = created.json();
    const inbox = task.projectId as string;

    const label = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${inbox}/labels`,
        headers: { cookie: owner.cookie },
        payload: { name: 'важно', color: '#c22e1f' },
      })
    ).json();
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/issues/${task.id}`,
      headers: { cookie: owner.cookie },
      payload: { labelIds: [label.id], statusId: await statusId(owner, inbox, 'В работе'), assigneeId: owner.id },
    });
    const subtask = await createIssue(app, owner, inbox, { title: 'Часть работы', type: 'SUBTASK', parentId: task.id });

    const target = await createProject(app, owner, { name: 'Алабуга Старт' });
    const response = await transfer(owner, task.id, target.id);
    expect(response.statusCode).toBe(200);
    const moved = response.json();

    expect(moved.projectId).toBe(target.id);
    expect(moved.issueKey).toBe(`${target.key}-1`);
    expect(moved.status.name).toBe('В работе');
    expect(moved.assignee.id).toBe(owner.id);
    expect(moved.labels.map((l: { name: string }) => l.name)).toEqual(['важно']);
    expect(moved.subtasks).toHaveLength(1);
    expect(moved.subtasks[0].issueKey).toBe(`${target.key}-1.1`);

    // The label now exists in the target project too.
    const targetLabels = (await app.inject({ method: 'GET', url: `/api/v1/projects/${target.id}/labels`, headers: { cookie: owner.cookie } })).json();
    expect(targetLabels.map((l: { name: string }) => l.name)).toContain('важно');

    // Old links keep working.
    const byOldKey = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${owner.workspaceId}/issues/by-key/${task.issueKey}`,
      headers: { cookie: owner.cookie },
    });
    expect(byOldKey.statusCode).toBe(200);
    expect(byOldKey.json().id).toBe(task.id);

    const activity = (await app.inject({ method: 'GET', url: `/api/v1/issues/${task.id}/activity`, headers: { cookie: owner.cookie } })).json();
    const entry = activity.find((e: { type: string }) => e.type === 'PROJECT_CHANGED');
    expect(entry.fromValue).toBe(task.issueKey);
    expect(entry.toValue).toBe(moved.issueKey);

    expect((await prisma.issue.findUniqueOrThrow({ where: { id: subtask.id } })).projectId).toBe(target.id);
  });

  it('подзадача, перенесённая отдельно, становится обычной задачей; связи с оставшимися снимаются', async () => {
    const owner = await registerUser(app, { workspaceName: 'Перенос подзадачи' });
    const from = await createProject(app, owner, { name: 'Откуда' });
    const to = await createProject(app, owner, { name: 'Куда' });
    const parent = await createIssue(app, owner, from.id, { title: 'Родитель' });
    const child = await createIssue(app, owner, from.id, { title: 'Ребёнок', type: 'SUBTASK', parentId: parent.id });
    const neighbour = await createIssue(app, owner, from.id, { title: 'Сосед' });
    const dependency = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${from.id}/dependencies`,
      headers: { cookie: owner.cookie },
      payload: { predecessorId: neighbour.id, successorId: child.id },
    });
    expect(dependency.statusCode).toBe(201);

    const moved = (await transfer(owner, child.id, to.id)).json();
    expect(moved.type).toBe('TASK');
    expect(moved.parent).toBeNull();
    expect(await prisma.issueDependency.count({ where: { successorId: child.id } })).toBe(0);
  });

  it('права: гость не переносит в чужой проект, в тот же проект перенести нельзя, гость-исполнитель снимается', async () => {
    const owner = await registerUser(app, { workspaceName: 'Права переноса' });
    const open = await createProject(app, owner, { name: 'Открытый' });
    const closed = await createProject(app, owner, { name: 'Закрытый' });
    const guest = await registerUser(app, { email: 'guest@transfer.test' });
    await addMember(app, owner, guest.email, 'GUEST');
    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${open.id}/members`,
      headers: { cookie: owner.cookie },
      payload: { userId: guest.id, role: 'CONTRIBUTOR' },
    });
    const issue = await createIssue(app, owner, open.id, { title: 'Гостевая', assigneeId: guest.id });

    const guestCookie = await login(app, guest.email);
    expect((await transfer({ cookie: guestCookie }, issue.id, closed.id)).statusCode).toBe(404);
    expect((await transfer(owner, issue.id, open.id)).statusCode).toBe(400);

    const moved = (await transfer(owner, issue.id, closed.id)).json();
    expect(moved.assignee).toBeNull();
  });
});

describe('связи задачи в карточке', () => {
  it('показывает, от чего задача зависит и что она блокирует; гостю без доступа не видно', async () => {
    const owner = await registerUser(app, { workspaceName: 'Связи в карточке' });
    const project = await createProject(app, owner, { name: 'Связи' });
    const first = await createIssue(app, owner, project.id, { title: 'Сначала это' });
    const then = await createIssue(app, owner, project.id, { title: 'Потом это' });
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/dependencies`,
      headers: { cookie: owner.cookie },
      payload: { predecessorId: first.id, successorId: then.id },
    });
    expect(created.statusCode).toBe(201);

    const links = (id: string, cookie = owner.cookie) =>
      app.inject({ method: 'GET', url: `/api/v1/issues/${id}/links`, headers: { cookie } });

    const ofThen = (await links(then.id)).json();
    expect(ofThen.dependsOn.map((l: { issue: { id: string } }) => l.issue.id)).toEqual([first.id]);
    expect(ofThen.blocks).toEqual([]);
    expect(ofThen.dependsOn[0].dependencyId).toBe(created.json().id);

    const ofFirst = (await links(first.id)).json();
    expect(ofFirst.blocks[0].issue.issueKey).toBe(then.issueKey);

    const guest = await registerUser(app, { email: 'guest@links.test' });
    await addMember(app, owner, guest.email, 'GUEST');
    expect((await links(then.id, await login(app, guest.email))).statusCode).toBe(404);
  });
});
