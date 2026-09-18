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
