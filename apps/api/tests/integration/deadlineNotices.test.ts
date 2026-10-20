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
import { scanDueDates } from '../../src/jobs/dueDateScanner';

let app: FastifyInstance;
let owner: TestUser;
let member: TestUser;
let project: { id: string };

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();
  owner = await registerUser(app, { name: 'Владелец Сроков', workspaceName: 'Сроки' });
  member = await registerUser(app, { name: 'Мария Исполнитель' });
  await addMember(app, owner, member.email, 'MEMBER');
  project = await createProject(app, owner);
  await prisma.user.updateMany({ where: { id: { in: [owner.id, member.id] } }, data: { timezone: 'Europe/Moscow' } });
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

const call = (user: TestUser, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { cookie: user.cookie }, ...(payload ? { payload: payload as never } : {}) });

const notices = (userId: string, issueId: string) =>
  prisma.notification.findMany({ where: { userId, issueId }, orderBy: { createdAt: 'asc' }, select: { type: true, title: true, body: true } });

describe('напоминания о сроке', () => {
  it('приходят исполнителю по его часам и не повторяются', async () => {
    const issue = await createIssue(app, owner, project.id, {
      title: 'Отчёт за неделю',
      assigneeId: member.id,
      dueDate: '2030-04-10T12:00:00.000Z',
    });
    await prisma.notification.deleteMany({ where: { issueId: issue.id } });

    // 9:05 по Москве в день срока — дважды: второй проход ничего не шлёт.
    await scanDueDates(new Date('2030-04-10T06:05:00Z'));
    await scanDueDates(new Date('2030-04-10T06:10:00Z'));
    // 3:00 следующей ночи — тишина; 9:05 следующего утра — просрочка.
    await scanDueDates(new Date('2030-04-11T00:00:00Z'));
    await scanDueDates(new Date('2030-04-11T06:05:00Z'));
    await scanDueDates(new Date('2030-04-11T06:30:00Z'));

    expect(await notices(member.id, issue.id)).toEqual([
      { type: 'ISSUE_DUE_SOON', title: `${issue.issueKey}: срок сегодня`, body: null },
      { type: 'ISSUE_OVERDUE', title: `${issue.issueKey}: срок прошёл вчера`, body: null },
    ]);
    expect(await notices(owner.id, issue.id)).toEqual([]);
  });

  it('новый срок — свои напоминания', async () => {
    const issue = await createIssue(app, owner, project.id, {
      title: 'Созвон',
      assigneeId: member.id,
      dueDate: '2030-05-10T12:00:00.000Z',
      dueHasTime: true,
    });
    await prisma.notification.deleteMany({ where: { issueId: issue.id } });
    await scanDueDates(new Date('2030-05-10T11:10:00Z')); // 14:10 — через час
    await call(owner, 'PATCH', `/issues/${issue.id}`, { dueDate: '2030-05-10T14:00:00.000Z', dueHasTime: true });
    await scanDueDates(new Date('2030-05-10T13:05:00Z')); // 16:05 — через час до нового срока 17:00
    const titles = (await notices(member.id, issue.id)).filter((n) => n.type === 'ISSUE_DUE_SOON').map((n) => n.title);
    expect(titles).toEqual([`${issue.issueKey}: срок через час в 15:00`, `${issue.issueKey}: срок через час в 17:00`]);
  });
});

describe('изменения задачи', () => {
  it('новый срок написан в уведомлении, со временем по часам читателя', async () => {
    const issue = await createIssue(app, owner, project.id, { title: 'Выгрузка', assigneeId: member.id });
    await call(owner, 'PATCH', `/issues/${issue.id}`, { dueDate: '2030-06-23T12:00:00.000Z' });
    await call(owner, 'PATCH', `/issues/${issue.id}`, { dueDate: '2030-06-24T06:30:00.000Z', dueHasTime: true });
    await call(owner, 'PATCH', `/issues/${issue.id}`, { dueDate: null });
    const bodies = (await notices(member.id, issue.id)).filter((n) => n.type === 'ISSUE_DUE_DATE_CHANGED').map((n) => n.body);
    expect(bodies).toEqual(['Новый срок: 23 июня 2030 г.', 'Новый срок: 24 июня 2030 г., 09:30', 'Срок снят']);
  });

  it('смена статуса — автору, исполнителю и подписчикам, но не тем, кто только комментировал', async () => {
    const commenter = await registerUser(app, { name: 'Комментатор Разовый' });
    await addMember(app, owner, commenter.email, 'MEMBER');
    const issue = await createIssue(app, owner, project.id, { title: 'Статусы', assigneeId: member.id });
    await call(commenter, 'POST', `/issues/${issue.id}/comments`, {
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Я тут спросил' }] }] },
    });
    const statuses = (await call(owner, 'GET', `/projects/${project.id}`)).json().statuses as { id: string; category: string }[];
    await call(owner, 'PATCH', `/issues/${issue.id}`, { statusId: statuses.find((s) => s.category === 'STARTED')!.id });

    const typesOf = async (userId: string) => (await notices(userId, issue.id)).map((n) => n.type);
    expect(await typesOf(member.id)).toContain('ISSUE_STATUS_CHANGED');
    expect(await typesOf(commenter.id)).not.toContain('ISSUE_STATUS_CHANGED');

    // A comment still reaches whoever wrote in the task.
    await call(owner, 'POST', `/issues/${issue.id}/comments`, {
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ответил' }] }] },
    });
    expect(await typesOf(commenter.id)).toContain('ISSUE_COMMENTED');
  });
});
