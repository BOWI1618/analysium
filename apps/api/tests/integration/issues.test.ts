import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  addMember,
  createIssue,
  createProject,
  disconnectTestDb,
  login,
  migrateTestSchema,
  registerUser,
  type TestUser,
} from '../setup';

let app: FastifyInstance;
let owner: TestUser;
let project: { id: string; key: string; statuses: { id: string; name: string; category: string }[] };

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();
  owner = await registerUser(app, { name: 'Владелец', email: 'owner@issues.test' });
  project = await createProject(app, owner, { name: 'Доска', key: 'BRD' });
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

const statusNamed = (name: string) => project.statuses.find((s) => s.name === name)!;
const statusIn = (category: string) => project.statuses.find((s) => s.category === category)!;

describe('creating an issue', () => {
  it('numbers issues sequentially per project', async () => {
    const first = await createIssue(app, owner, project.id, { title: 'Первая' });
    const second = await createIssue(app, owner, project.id, { title: 'Вторая' });
    expect(first.issueKey).toBe('BRD-1');
    expect(second.issueKey).toBe('BRD-2');
  });

  it('records an ISSUE_CREATED activity entry', async () => {
    const issue = await createIssue(app, owner, project.id, { title: 'С историей' });
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/issues/${issue.id}/activity`,
      headers: { cookie: owner.cookie },
    });
    expect(response.json()[0].type).toBe('ISSUE_CREATED');
  });

  it('defaults to the project’s default status', async () => {
    const issue = await createIssue(app, owner, project.id);
    expect(issue.status.category).toBe('UNSTARTED');
  });

  it('rejects an empty title', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/issues',
      headers: { cookie: owner.cookie },
      payload: { projectId: project.id, title: '   ' },
    });
    expect(response.statusCode).toBe(422);
  });

  it('sanitises the description before storing it', async () => {
    const issue = await createIssue(app, owner, project.id, {
      title: 'С разметкой',
      description: {
        type: 'doc',
        content: [
          { type: 'script', content: [{ type: 'text', text: 'alert(1)' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'ок' }] },
        ],
      },
    });
    expect(JSON.stringify(issue.description)).not.toContain('script');
    expect(JSON.stringify(issue.description)).toContain('ок');
  });

  it('refuses an assignee from outside the workspace', async () => {
    const stranger = await registerUser(app, { email: 'stranger@issues.test' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/issues',
      headers: { cookie: owner.cookie },
      payload: { projectId: project.id, title: 'Чужой', assigneeId: stranger.id },
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses a subtask with no parent', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/issues',
      headers: { cookie: owner.cookie },
      payload: { projectId: project.id, title: 'Сирота', type: 'SUBTASK' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses to nest a subtask under another subtask', async () => {
    const parent = await createIssue(app, owner, project.id, { title: 'Родитель' });
    const child = await createIssue(app, owner, project.id, {
      title: 'Подзадача',
      type: 'SUBTASK',
      parentId: parent.id,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/issues',
      headers: { cookie: owner.cookie },
      payload: { projectId: project.id, title: 'Внучка', type: 'SUBTASK', parentId: child.id },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('updating an issue', () => {
  it('stamps completedAt when moved to a completed status and clears it on reopen', async () => {
    const issue = await createIssue(app, owner, project.id, { title: 'Жизненный цикл' });

    const done = await app.inject({
      method: 'PATCH',
      url: `/api/v1/issues/${issue.id}`,
      headers: { cookie: owner.cookie },
      payload: { statusId: statusIn('COMPLETED').id },
    });
    expect(done.json().completedAt).not.toBeNull();

    const reopened = await app.inject({
      method: 'PATCH',
      url: `/api/v1/issues/${issue.id}`,
      headers: { cookie: owner.cookie },
      payload: { statusId: statusIn('STARTED').id },
    });
    expect(reopened.json().completedAt).toBeNull();
  });

  it('appends one activity entry per changed field', async () => {
    const issue = await createIssue(app, owner, project.id, { title: 'До' });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/issues/${issue.id}`,
      headers: { cookie: owner.cookie },
      payload: { title: 'После', priority: 'URGENT' },
    });

    const activity = await app.inject({
      method: 'GET',
      url: `/api/v1/issues/${issue.id}/activity`,
      headers: { cookie: owner.cookie },
    });
    const types = activity.json().map((e: { type: string }) => e.type);
    expect(types).toContain('TITLE_CHANGED');
    expect(types).toContain('PRIORITY_CHANGED');
  });

  it('does not log activity when a value is set to what it already was', async () => {
    const issue = await createIssue(app, owner, project.id, { title: 'Без изменений', priority: 'HIGH' });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/issues/${issue.id}`,
      headers: { cookie: owner.cookie },
      payload: { priority: 'HIGH' },
    });
    const activity = await app.inject({
      method: 'GET',
      url: `/api/v1/issues/${issue.id}/activity`,
      headers: { cookie: owner.cookie },
    });
    expect(activity.json().filter((e: { type: string }) => e.type === 'PRIORITY_CHANGED')).toHaveLength(0);
  });

  it('records label additions and removals by name', async () => {
    const label = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${project.id}/labels`,
        headers: { cookie: owner.cookie },
        payload: { name: 'для истории', color: '#0083ca' },
      })
    ).json();
    const issue = await createIssue(app, owner, project.id, { title: 'С меткой' });

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/issues/${issue.id}`,
      headers: { cookie: owner.cookie },
      payload: { labelIds: [label.id] },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/issues/${issue.id}`,
      headers: { cookie: owner.cookie },
      payload: { labelIds: [] },
    });

    const activity = await app.inject({
      method: 'GET',
      url: `/api/v1/issues/${issue.id}/activity`,
      headers: { cookie: owner.cookie },
    });
    const entries = activity.json();
    expect(entries.find((e: { type: string }) => e.type === 'LABEL_ADDED').toValue).toBe(label.name);
    expect(entries.find((e: { type: string }) => e.type === 'LABEL_REMOVED').fromValue).toBe(label.name);
  });
});

describe('moving an issue', () => {
  it('places a card between its neighbours', async () => {
    const target = statusNamed('К выполнению');
    const a = await createIssue(app, owner, project.id, { title: 'A', statusId: target.id });
    const b = await createIssue(app, owner, project.id, { title: 'B', statusId: target.id });
    const c = await createIssue(app, owner, project.id, { title: 'C', statusId: target.id });

    // Cards are created at the top, so the current order is C, B, A.
    const moved = await app.inject({
      method: 'POST',
      url: `/api/v1/issues/${c.id}/move`,
      headers: { cookie: owner.cookie },
      payload: { statusId: target.id, beforeId: b.id, afterId: a.id },
    });

    expect(moved.statusCode).toBe(200);
    expect(moved.json().rank > b.rank).toBe(true);
    expect(moved.json().rank < a.rank).toBe(true);
  });

  it('logs a status change when the column changes', async () => {
    const issue = await createIssue(app, owner, project.id, { title: 'Переезд' });
    await app.inject({
      method: 'POST',
      url: `/api/v1/issues/${issue.id}/move`,
      headers: { cookie: owner.cookie },
      payload: { statusId: statusIn('STARTED').id },
    });

    const activity = await app.inject({
      method: 'GET',
      url: `/api/v1/issues/${issue.id}/activity`,
      headers: { cookie: owner.cookie },
    });
    expect(activity.json().some((e: { type: string }) => e.type === 'STATUS_CHANGED')).toBe(true);
  });

  it('enforces the WIP limit on entry', async () => {
    const wipProject = await createProject(app, owner, { name: 'WIP', key: 'WIP' });
    const inProgress = wipProject.statuses.find((s: { name: string }) => s.name === 'В работе');

    // The default workflow sets this column's limit to 5.
    for (let i = 0; i < 5; i += 1) {
      await createIssue(app, owner, wipProject.id, { title: `В работе ${i}`, statusId: inProgress.id });
    }

    const extra = await createIssue(app, owner, wipProject.id, { title: 'Лишняя' });
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/issues/${extra.id}/move`,
      headers: { cookie: owner.cookie },
      payload: { statusId: inProgress.id },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CONFLICT');
  });
});

describe('permissions', () => {
  it('lets a member create and edit but not delete', async () => {
    const memberUser = await registerUser(app, { email: 'member@issues.test' });
    await addMember(app, owner, memberUser.email, 'MEMBER');
    const cookie = await login(app, memberUser.email);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/issues',
      headers: { cookie },
      payload: { projectId: project.id, title: 'От участника' },
    });
    expect(created.statusCode).toBe(201);

    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/v1/issues/${created.json().id}`,
      headers: { cookie },
      payload: { title: 'Изменено участником' },
    });
    expect(edited.statusCode).toBe(200);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/issues/${created.json().id}`,
      headers: { cookie },
    });
    expect(deleted.statusCode).toBe(403);
  });

  it('stops a guest from creating issues', async () => {
    const guest = await registerUser(app, { email: 'guest@issues.test' });
    await addMember(app, owner, guest.email, 'GUEST');
    const cookie = await login(app, guest.email);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/issues',
      headers: { cookie },
      payload: { projectId: project.id, title: 'Гостевая' },
    });
    // The guest cannot even see this project, so it does not exist for them.
    expect(response.statusCode).toBe(404);
  });

  it('hides another workspace’s issues entirely (IDOR)', async () => {
    const outsider = await registerUser(app, { email: 'outsider@issues.test' });
    const issue = await createIssue(app, owner, project.id, { title: 'Приватная' });

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/issues/${issue.id}`,
      headers: { cookie: outsider.cookie },
    });
    expect(read.statusCode).toBe(404);

    const write = await app.inject({
      method: 'PATCH',
      url: `/api/v1/issues/${issue.id}`,
      headers: { cookie: outsider.cookie },
      payload: { title: 'Взлом' },
    });
    expect(write.statusCode).toBe(404);
  });

  it('scopes bulk updates to issues the caller can reach', async () => {
    const outsider = await registerUser(app, { email: 'bulk@issues.test' });
    const issue = await createIssue(app, owner, project.id, { title: 'Не трогать' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${outsider.workspaceId}/issues/bulk`,
      headers: { cookie: outsider.cookie },
      payload: { issueIds: [issue.id], patch: { priority: 'URGENT' } },
    });

    expect(response.json().updated).toBe(0);
  });
});

describe('listing and filtering', () => {
  it('returns a cursor when more rows remain', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/issues?limit=2`,
      headers: { cookie: owner.cookie },
    });
    const body = response.json();
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).toBeTruthy();
  });

  it('pages without repeating rows', async () => {
    const first = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/issues?limit=3&sort=created&order=asc`,
      headers: { cookie: owner.cookie },
    });
    const second = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/issues?limit=3&sort=created&order=asc&cursor=${first.json().nextCursor}`,
      headers: { cookie: owner.cookie },
    });

    const firstIds = first.json().items.map((i: { id: string }) => i.id);
    const secondIds = second.json().items.map((i: { id: string }) => i.id);
    expect(firstIds.filter((id: string) => secondIds.includes(id))).toHaveLength(0);
  });

  it('filters by assignee', async () => {
    await createIssue(app, owner, project.id, { title: 'Моя', assigneeId: owner.id });
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/issues?assigneeId=@me`,
      headers: { cookie: owner.cookie },
    });
    const items = response.json().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i: { assignee: { id: string } }) => i.assignee.id === owner.id)).toBe(true);
  });

  it('groups the board by status column', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/board`,
      headers: { cookie: owner.cookie },
    });
    const columns = response.json().columns;
    expect(columns).toHaveLength(project.statuses.length);
    expect(columns[0]).toHaveProperty('total');
  });
});
