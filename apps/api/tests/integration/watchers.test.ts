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
import { prisma } from '../../src/lib/prisma';

let app: FastifyInstance;
let owner: TestUser;
let member: TestUser;
let issue: { id: string; issueKey: string };

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();

  owner = await registerUser(app, { name: 'Автор Задачи', workspaceName: 'Подписки' });
  member = await registerUser(app, { name: 'Наблюдатель' });
  await addMember(app, owner, member.email, 'MEMBER');
  const project = await createProject(app, owner);
  issue = await createIssue(app, owner, project.id, { title: 'Следить за этим' });
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

const comment = (user: TestUser, content: unknown[]) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/issues/${issue.id}/comments`,
    headers: { cookie: user.cookie },
    payload: { body: { type: 'doc', content: [{ type: 'paragraph', content }] } },
  });

const watch = (user: TestUser, watching: boolean) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/issues/${issue.id}/watch`,
    headers: { cookie: user.cookie },
    payload: { watching },
  });

const watching = async (user: TestUser) =>
  (await app.inject({ method: 'GET', url: `/api/v1/issues/${issue.id}`, headers: { cookie: user.cookie } })).json()
    .watching as boolean;

const notifications = (user: TestUser, type: string) =>
  prisma.notification.count({ where: { userId: user.id, issueId: issue.id, type: type as never } });

describe('подписка на задачу', () => {
  it('подписавшийся получает уведомления о комментариях, до подписки — нет', async () => {
    expect(await watching(member)).toBe(false);
    await comment(owner, [{ type: 'text', text: 'Пока без вас' }]);
    expect(await notifications(member, 'ISSUE_COMMENTED')).toBe(0);

    const response = await watch(member, true);
    expect(response.statusCode).toBe(200);
    expect(response.json().watching).toBe(true);
    expect(await watching(member)).toBe(true);

    await comment(owner, [{ type: 'text', text: 'Теперь с вами' }]);
    expect(await notifications(member, 'ISSUE_COMMENTED')).toBe(1);
  });

  it('автор может отписаться, но упоминание всё равно доходит', async () => {
    expect(await watching(owner)).toBe(true);
    expect((await watch(owner, false)).json().watching).toBe(false);
    expect(await watching(owner)).toBe(false);

    await comment(member, [{ type: 'text', text: 'Автор не услышит' }]);
    expect(await notifications(owner, 'ISSUE_COMMENTED')).toBe(0);

    await comment(member, [
      { type: 'mention', attrs: { id: owner.id, label: owner.name } },
      { type: 'text', text: ' а так услышит' },
    ]);
    expect(await notifications(owner, 'ISSUE_MENTIONED')).toBe(1);
  });
});

describe('управление наблюдателями', () => {
  let guest: TestUser;
  let outsider: TestUser;
  let projectId: string;

  const call = (user: TestUser, method: 'GET' | 'POST', url: string, payload?: unknown) =>
    app.inject({ method, url: `/api/v1${url}`, headers: { cookie: user.cookie }, ...(payload ? { payload: payload as never } : {}) });
  const watchers = async (user: TestUser, issueId = issue.id) =>
    (await call(user, 'GET', `/issues/${issueId}/watchers`)).json() as {
      items: { user: { id: string }; reasons: string[] }[];
      canManage: boolean;
    };
  const setWatcher = (user: TestUser, userId: string, watching: boolean, issueId = issue.id) =>
    call(user, 'POST', `/issues/${issueId}/watchers`, { userId, watching });

  beforeAll(async () => {
    guest = await registerUser(app, { name: 'Гость Проекта' });
    outsider = await registerUser(app, { name: 'Гость Без Доступа' });
    await addMember(app, owner, guest.email, 'GUEST');
    await addMember(app, owner, outsider.email, 'GUEST');
    projectId = (await prisma.issue.findUniqueOrThrow({ where: { id: issue.id }, select: { projectId: true } })).projectId;
    await call(owner, 'POST', `/projects/${projectId}/members`, { userId: guest.id, role: 'VIEWER' });
  });

  it('список называет каждого, кто получает уведомления, и почему', async () => {
    const fresh = await createIssue(app, owner, projectId, { title: 'Кто слушает', assigneeId: member.id });
    const list = await watchers(owner, fresh.id);
    expect(list.canManage).toBe(true);
    expect(list.items.find((item) => item.user.id === owner.id)?.reasons).toEqual(['REPORTER']);
    expect(list.items.find((item) => item.user.id === member.id)?.reasons).toEqual(['ASSIGNEE']);

    const card = (await call(owner, 'GET', `/issues/${fresh.id}`)).json();
    expect(card.watcherCount).toBe(2);
  });

  it('тот, кто может править задачу, добавляет коллегу — и коллега начинает получать уведомления', async () => {
    const fresh = await createIssue(app, owner, projectId, { title: 'Добавить наблюдателя' });
    const response = await setWatcher(owner, member.id, true, fresh.id);
    expect(response.statusCode).toBe(200);
    expect(response.json().items.find((item: { user: { id: string } }) => item.user.id === member.id).reasons).toEqual(['SUBSCRIBED']);

    await app.inject({
      method: 'POST',
      url: `/api/v1/issues/${fresh.id}/comments`,
      headers: { cookie: owner.cookie },
      payload: { body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Для наблюдателя' }] }] } },
    });
    expect(await prisma.notification.count({ where: { userId: member.id, issueId: fresh.id, type: 'ISSUE_COMMENTED' } })).toBe(1);

    // Taking the subscription away stops it; an author stays an author.
    expect((await setWatcher(owner, member.id, false, fresh.id)).statusCode).toBe(200);
    const after = await watchers(owner, fresh.id);
    expect(after.items.map((item) => item.user.id)).toEqual([owner.id]);
  });

  it('гость с правом только на просмотр подписывает себя, но не других', async () => {
    const fresh = await createIssue(app, owner, projectId, { title: 'Только себя' });
    expect((await watchers(guest, fresh.id)).canManage).toBe(false);
    expect((await setWatcher(guest, member.id, true, fresh.id)).statusCode).toBe(403);
    expect((await setWatcher(guest, guest.id, true, fresh.id)).statusCode).toBe(200);
    expect((await watchers(guest, fresh.id)).items.some((item) => item.user.id === guest.id)).toBe(true);
  });

  it('человека без доступа к задаче добавить нельзя: подписка не открывает задачу', async () => {
    const fresh = await createIssue(app, owner, projectId, { title: 'Закрыто для посторонних' });
    const response = await setWatcher(owner, outsider.id, true, fresh.id);
    expect(response.statusCode).toBe(400);
    expect(await prisma.issueSubscription.count({ where: { issueId: fresh.id, userId: outsider.id } })).toBe(0);
    expect((await call(outsider, 'GET', `/issues/${fresh.id}`)).statusCode).toBe(404);
    expect((await call(outsider, 'GET', `/issues/${fresh.id}/watchers`)).statusCode).toBe(404);
  });

  it('того, кто сам отключил уведомления, не подписывают за его спиной', async () => {
    const fresh = await createIssue(app, owner, projectId, { title: 'Отказ уважается' });
    await call(member, 'POST', `/issues/${fresh.id}/watch`, { watching: false });
    expect((await setWatcher(owner, member.id, true, fresh.id)).statusCode).toBe(409);
  });

  it('задача создаётся сразу с наблюдателями — или не создаётся вовсе', async () => {
    const created = await createIssue(app, owner, projectId, { title: 'С наблюдателями', watcherIds: [member.id, guest.id] });
    const list = await watchers(owner, created.id);
    expect(list.items.map((item) => item.user.id).sort()).toEqual([owner.id, member.id, guest.id].sort());

    const before = await prisma.issue.count({ where: { projectId } });
    const refused = await app.inject({
      method: 'POST',
      url: '/api/v1/issues',
      headers: { cookie: owner.cookie },
      payload: { projectId, title: 'Не должна появиться', watcherIds: [member.id, outsider.id] },
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.fields.watcherIds).toBeTruthy();
    expect(await prisma.issue.count({ where: { projectId } })).toBe(before);
  });
});
