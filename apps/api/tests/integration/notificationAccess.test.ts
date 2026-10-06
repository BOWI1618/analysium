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
import type { Mail } from '../../src/lib/mailer';
import { UNREAD_DELAY_MS, sendNotificationDigests } from '../../src/jobs/notificationMailer';
import { prisma } from '../../src/lib/prisma';

let app: FastifyInstance;
let owner: TestUser;
let guest: TestUser;
let member: TestUser;
let project: { id: string };

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();

  owner = await registerUser(app, { name: 'Владелец Доступа', workspaceName: 'Доступ' });
  guest = await registerUser(app, { name: 'Гость Временный' });
  member = await registerUser(app, { name: 'Мария Участник' });
  await addMember(app, owner, guest.email, 'GUEST');
  await addMember(app, owner, member.email, 'MEMBER');
  project = await createProject(app, owner);
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

const call = (user: TestUser, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { cookie: user.cookie }, ...(payload ? { payload: payload as never } : {}) });

const addToProject = (userId: string, role = 'CONTRIBUTOR') =>
  call(owner, 'POST', `/projects/${project.id}/members`, { userId, role });
const removeFromProject = (userId: string) => call(owner, 'DELETE', `/projects/${project.id}/members/${userId}`);

const comment = (user: TestUser, issueId: string, text: string) =>
  call(user, 'POST', `/issues/${issueId}/comments`, {
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  });

const count = (userId: string, issueId: string, type?: string) =>
  prisma.notification.count({ where: { userId, issueId, ...(type ? { type: type as never } : {}) } });

const inbox = async (user: TestUser) =>
  (await call(user, 'GET', `/workspaces/${owner.workspaceId}/notifications`)).json() as {
    items: { title: string; body: string | null; issue: { id: string } | null }[];
    unreadCount: number;
  };

describe('уведомления не раскрывают недоступную задачу', () => {
  it('после отзыва доступа гость не получает новых уведомлений и не видит старые', async () => {
    expect((await addToProject(guest.id)).statusCode).toBe(204);
    const issue = await createIssue(app, owner, project.id, { title: 'Секретный план' });
    expect((await call(guest, 'POST', `/issues/${issue.id}/watch`, { watching: true })).statusCode).toBe(200);

    await call(owner, 'PATCH', `/issues/${issue.id}`, { dueDate: '2030-01-10T12:00:00.000Z' });
    expect(await count(guest.id, issue.id, 'ISSUE_DUE_DATE_CHANGED')).toBe(1);
    expect((await inbox(guest)).items.some((n) => n.issue?.id === issue.id)).toBe(true);

    expect((await removeFromProject(guest.id)).statusCode).toBe(204);
    expect((await call(guest, 'GET', `/issues/${issue.id}`)).statusCode).toBe(404);

    await comment(owner, issue.id, 'Пароль от сейфа — 1234');
    await call(owner, 'PATCH', `/issues/${issue.id}`, { dueDate: '2030-02-10T12:00:00.000Z' });
    // Nothing new is written for someone who can no longer open the task.
    expect(await count(guest.id, issue.id, 'ISSUE_COMMENTED')).toBe(0);
    expect(await count(guest.id, issue.id, 'ISSUE_DUE_DATE_CHANGED')).toBe(1);

    // And what was written while they had access is gone from the inbox and its badge.
    const after = await inbox(guest);
    expect(after.items.some((n) => n.issue?.id === issue.id)).toBe(false);
    expect(JSON.stringify(after)).not.toContain('Секретный план');
    expect(after.unreadCount).toBe(0);

    // Returning access brings the history back.
    await addToProject(guest.id);
    expect((await inbox(guest)).items.some((n) => n.issue?.id === issue.id)).toBe(true);
    await removeFromProject(guest.id);
  });

  it('отложенное письмо не уходит, если доступ отозвали, пока оно ждало', async () => {
    await addToProject(guest.id);
    const issue = await createIssue(app, owner, project.id, { title: 'Письмо, которое не уйдёт' });
    await call(guest, 'POST', `/issues/${issue.id}/watch`, { watching: true });
    await comment(owner, issue.id, 'Подробности для своих');
    expect(await count(guest.id, issue.id, 'ISSUE_COMMENTED')).toBe(1);

    await removeFromProject(guest.id);

    const letters: Mail[] = [];
    const later = new Date(Date.now() + UNREAD_DELAY_MS + 60_000);
    await sendNotificationDigests(later, async (mail) => {
      letters.push(mail);
      return true;
    });
    expect(letters.filter((mail) => mail.to === guest.email)).toHaveLength(0);
    // Marked as handled, so it does not wait for a chance to go out later.
    const pending = await prisma.notification.count({ where: { userId: guest.id, issueId: issue.id, emailedAt: null } });
    expect(pending).toBe(0);
  });

  it('упоминание человека без доступа к проекту ничего ему не присылает', async () => {
    const issue = await createIssue(app, owner, project.id, { title: 'Упоминание мимо' });
    await call(owner, 'POST', `/issues/${issue.id}/comments`, {
      body: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: guest.id, label: guest.name } }] }],
      },
    });
    expect(await count(guest.id, issue.id)).toBe(0);
  });
});

describe('наблюдатели и смена исполнителя', () => {
  it('наблюдатель узнаёт о новом исполнителе и о снятии, новый исполнитель получает одно уведомление', async () => {
    const watcher = await registerUser(app, { name: 'Наблюдатель Смены' });
    await addMember(app, owner, watcher.email, 'MEMBER');
    const issue = await createIssue(app, owner, project.id, { title: 'Кто возьмёт' });
    await call(watcher, 'POST', `/issues/${issue.id}/watch`, { watching: true });
    // The future assignee follows the task too: still one notice for them.
    await call(member, 'POST', `/issues/${issue.id}/watch`, { watching: true });

    expect((await call(owner, 'PATCH', `/issues/${issue.id}`, { assigneeId: member.id })).statusCode).toBe(200);
    expect(await count(watcher.id, issue.id, 'ISSUE_ASSIGNED')).toBe(1);
    expect(await count(member.id, issue.id)).toBe(1);

    // Saving the same assignee again is not news.
    await call(owner, 'PATCH', `/issues/${issue.id}`, { assigneeId: member.id });
    expect(await count(watcher.id, issue.id)).toBe(1);

    await call(owner, 'PATCH', `/issues/${issue.id}`, { assigneeId: null });
    expect(await count(watcher.id, issue.id, 'ISSUE_UNASSIGNED')).toBe(1);
    // The person the task was taken from hears about it as well.
    expect(await count(member.id, issue.id, 'ISSUE_UNASSIGNED')).toBe(1);
  });

  it('тот же срок повторно не рассылается', async () => {
    const issue = await createIssue(app, owner, project.id, { title: 'Срок без изменений', dueDate: '2030-03-01T12:00:00.000Z' });
    await call(member, 'POST', `/issues/${issue.id}/watch`, { watching: true });
    await call(owner, 'PATCH', `/issues/${issue.id}`, { dueDate: '2030-03-01T12:00:00.000Z' });
    expect(await count(member.id, issue.id, 'ISSUE_DUE_DATE_CHANGED')).toBe(0);
    await call(owner, 'PATCH', `/issues/${issue.id}`, { dueDate: '2030-03-02T12:00:00.000Z' });
    expect(await count(member.id, issue.id, 'ISSUE_DUE_DATE_CHANGED')).toBe(1);
  });
});

describe('массовые изменения', () => {
  const bulk = (user: TestUser, body: unknown) => call(user, 'POST', `/workspaces/${owner.workspaceId}/issues/bulk`, body);

  it('гость с ролью участника проекта назначает одну задачу и несколько одинаково', async () => {
    await addToProject(guest.id, 'CONTRIBUTOR');
    const one = await createIssue(app, owner, project.id, { title: 'Одна' });
    const two = await createIssue(app, owner, project.id, { title: 'Две' });

    expect((await call(guest, 'PATCH', `/issues/${one.id}`, { assigneeId: member.id })).statusCode).toBe(200);
    const response = await bulk(guest, { issueIds: [two.id], patch: { assigneeId: member.id } });
    expect(response.statusCode).toBe(200);
    expect(response.json().updated).toBe(1);
    await removeFromProject(guest.id);
  });

  it('срок, история с прежним значением и уведомления — как у одиночного изменения', async () => {
    const issue = await createIssue(app, owner, project.id, { title: 'Пакетная', assigneeId: member.id });
    const watcher = await registerUser(app, { name: 'Следит За Пакетом' });
    await addMember(app, owner, watcher.email, 'MEMBER');
    await call(watcher, 'POST', `/issues/${issue.id}/watch`, { watching: true });

    const response = await bulk(owner, {
      issueIds: [issue.id],
      patch: { assigneeId: owner.id, dueDate: '2030-05-20T12:00:00.000Z' },
    });
    expect(response.statusCode).toBe(200);

    const history = await prisma.activityEvent.findMany({ where: { issueId: issue.id, type: { in: ['ASSIGNEE_CHANGED', 'DUE_DATE_CHANGED'] } } });
    const assignee = history.find((event) => event.type === 'ASSIGNEE_CHANGED');
    expect(assignee?.fromValue).toBe(member.id);
    expect(assignee?.toValue).toBe(owner.id);
    expect(history.find((event) => event.type === 'DUE_DATE_CHANGED')?.toValue).toBe('2030-05-20T12:00:00.000Z');

    expect(await count(watcher.id, issue.id, 'ISSUE_ASSIGNED')).toBe(1);
    expect(await count(watcher.id, issue.id, 'ISSUE_DUE_DATE_CHANGED')).toBe(1);
    // The previous assignee: once when given the task, once when it went to someone else.
    expect(await count(member.id, issue.id, 'ISSUE_ASSIGNED')).toBe(2);
  });

  it('недоступная задача в выборке отклоняет весь пакет, ничего не меняя и не называя её', async () => {
    const hidden = await createProject(app, owner, { name: 'Скрытый' });
    await addToProject(guest.id, 'CONTRIBUTOR');
    const visible = await createIssue(app, owner, project.id, { title: 'Видимая' });
    const secret = await createIssue(app, owner, hidden.id, { title: 'Совсем секретная' });

    const response = await bulk(guest, { issueIds: [visible.id, secret.id], patch: { priority: 'URGENT' } });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('секретная');
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: visible.id } })).priority).not.toBe('URGENT');
    await removeFromProject(guest.id);
  });

  it('из пула без исполнителя нельзя молча перезаписать уже назначенную задачу', async () => {
    const free = await createIssue(app, owner, project.id, { title: 'Свободная' });
    const taken = await createIssue(app, owner, project.id, { title: 'Уже занята', assigneeId: member.id });

    const response = await bulk(owner, { issueIds: [free.id, taken.id], patch: { assigneeId: owner.id }, onlyUnassigned: true });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain(taken.issueKey);
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: free.id } })).assigneeId).toBeNull();
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: taken.id } })).assigneeId).toBe(member.id);

    const ok = await bulk(owner, { issueIds: [free.id], patch: { assigneeId: owner.id }, onlyUnassigned: true });
    expect(ok.statusCode).toBe(200);
  });
});

describe('профиль и поиск людей', () => {
  it('счётчики профиля считают все задачи, а не первые двадцать', async () => {
    const busy = await registerUser(app, { name: 'Очень Занятой' });
    await addMember(app, owner, busy.email, 'MEMBER');
    for (let i = 0; i < 23; i++) await createIssue(app, owner, project.id, { title: `Работа ${i}`, assigneeId: busy.id });

    const profile = (await call(owner, 'GET', `/workspaces/${owner.workspaceId}/users/${busy.id}`)).json();
    expect(profile.stats.assigned).toBe(23);
    expect(profile.assignedIssues).toHaveLength(20);
  });

  it('«@имя» находит человека, а не задачи', async () => {
    await createIssue(app, owner, project.id, { title: 'Мария должна проверить' });
    const results = (await call(owner, 'GET', `/workspaces/${owner.workspaceId}/search?q=${encodeURIComponent('@Мария')}`)).json();
    expect(results.users.map((u: { id: string }) => u.id)).toContain(member.id);
    expect(results.issues).toHaveLength(0);
  });
});
