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

/**
 * Reactions to comments — one sign from one person, put on and taken off by
 * the same press — and what becomes of a person's place in projects when they
 * are taken out of the workspace.
 */
let app: FastifyInstance;
let owner: TestUser;
let member: TestUser;
let guest: TestUser;
let memberId: string;
let project: { id: string };
let issue: { id: string; issueKey: string };

type Reaction = { emoji: string; count: number; mine: boolean; users: string[] };
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const call = (user: TestUser, method: Method, url: string, payload?: unknown) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { cookie: user.cookie },
    ...(payload ? { payload: payload as never } : {}),
  });

const say = async (user: TestUser, text: string) =>
  (
    await call(user, 'POST', `/issues/${issue.id}/comments`, {
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    })
  ).json() as { id: string; reactions: Reaction[] };
const react = (user: TestUser, commentId: string, emoji: string) =>
  call(user, 'POST', `/comments/${commentId}/reactions`, { emoji });
const reactionsFor = async (user: TestUser, commentId: string) =>
  ((await call(user, 'GET', `/issues/${issue.id}/comments`)).json() as { id: string; reactions: Reaction[] }[]).find(
    (comment) => comment.id === commentId,
  )!.reactions;

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();

  owner = await registerUser(app, { name: 'Автор Комментария', workspaceName: 'Реакции' });
  member = await registerUser(app, { name: 'Коллега Реагирующий' });
  guest = await registerUser(app, { name: 'Гость Читающий' });
  memberId = await addMember(app, owner, member.email, 'MEMBER');
  await addMember(app, owner, guest.email, 'GUEST');
  project = await createProject(app, owner, { name: 'Проект с обсуждением' });
  issue = await createIssue(app, owner, project.id, { title: 'Задача с обсуждением' });
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

describe('реакции на комментарии', () => {
  it('ставятся и снимаются одним нажатием; каждый видит, чьи они', async () => {
    const comment = await say(owner, 'Отчёт готов');
    // A new comment has none.
    expect(comment.reactions).toEqual([]);

    const first = await react(member, comment.id, '👍');
    expect(first.statusCode).toBe(200);
    expect(first.json().reactions).toEqual([{ emoji: '👍', count: 1, mine: true, users: ['Коллега Реагирующий'] }]);
    // The author sees it as someone else's; a second person joins the same sign.
    expect(await reactionsFor(owner, comment.id)).toEqual([{ emoji: '👍', count: 1, mine: false, users: ['Коллега Реагирующий'] }]);
    expect((await react(owner, comment.id, '👍')).json().reactions).toEqual([
      { emoji: '👍', count: 2, mine: true, users: ['Коллега Реагирующий', 'Автор Комментария'] },
    ]);
    // Several signs from one person, in the order they first appeared.
    await react(member, comment.id, '🔥');
    expect((await reactionsFor(member, comment.id)).map((reaction) => [reaction.emoji, reaction.count, reaction.mine])).toEqual([
      ['👍', 2, true],
      ['🔥', 1, true],
    ]);

    // The same press again takes one's own off — and nobody else's.
    expect((await react(member, comment.id, '👍')).json().reactions.map((r: Reaction) => [r.emoji, r.count, r.mine])).toEqual([
      ['👍', 1, false],
      ['🔥', 1, true],
    ]);
    await react(member, comment.id, '🔥');
    expect((await reactionsFor(owner, comment.id)).map((reaction) => reaction.emoji)).toEqual(['👍']);
  });

  it('только из своего ряда знаков; ставит тот, кто может комментировать в этой задаче', async () => {
    const comment = await say(owner, 'Нужна проверка');
    expect((await react(member, comment.id, '💩')).statusCode).toBe(422);
    expect((await react(member, comment.id, 'текст')).statusCode).toBe(422);
    expect((await react(member, 'nosuchcomment0', '👍')).statusCode).toBe(404);

    // A guest who was not added to the project does not see the task at all…
    expect((await react(guest, comment.id, '👍')).statusCode).toBe(404);
    // …and once added may comment there, and so may react.
    await call(owner, 'POST', `/projects/${project.id}/members`, { userId: guest.id, role: 'VIEWER' });
    await react(member, comment.id, '✅');
    expect((await react(guest, comment.id, '✅')).statusCode).toBe(200);
    expect((await reactionsFor(guest, comment.id))[0]).toMatchObject({ emoji: '✅', count: 2, mine: true });

    // Someone whose role does not let them comment reads the reactions and puts none.
    const reader = await registerUser(app, { name: 'Только Читатель' });
    const readerId = await addMember(app, owner, reader.email, 'MEMBER');
    const readOnly = (await call(owner, 'POST', `/workspaces/${owner.workspaceId}/roles`, { scope: 'WORKSPACE', name: 'Читатель', permissions: [] })).json();
    expect((await call(owner, 'PATCH', `/workspaces/${owner.workspaceId}/members/${readerId}`, { roleId: readOnly.id })).statusCode).toBe(204);
    expect((await reactionsFor(reader, comment.id))[0]).toMatchObject({ emoji: '✅', count: 2, mine: false });
    expect((await react(reader, comment.id, '✅')).statusCode).toBe(403);
  });

  it('уходят вместе с комментарием', async () => {
    const comment = await say(owner, 'Удалят вместе с реакциями');
    await react(member, comment.id, '🎉');
    expect((await call(owner, 'DELETE', `/comments/${comment.id}`)).statusCode).toBe(204);
    const { prisma } = await import('../../src/lib/prisma');
    expect(await prisma.commentReaction.count({ where: { commentId: comment.id } })).toBe(0);
  });
});

describe('человек, убранный из пространства', () => {
  it('пропадает и из участников его проектов; вернувшись, начинает без прежних ролей', async () => {
    expect((await call(owner, 'POST', `/projects/${project.id}/members`, { userId: member.id, role: 'LEAD' })).statusCode).toBe(204);
    const members = async () =>
      ((await call(owner, 'GET', `/projects/${project.id}`)).json().members as { userId: string }[]).map((item) => item.userId);
    expect(await members()).toContain(member.id);

    expect((await call(owner, 'DELETE', `/workspaces/${owner.workspaceId}/members/${memberId}`)).statusCode).toBe(204);
    expect(await members()).not.toContain(member.id);
    // Let in again, the person is a member of the workspace — not a lead of the project they once led.
    await addMember(app, owner, member.email, 'MEMBER');
    expect(await members()).not.toContain(member.id);
  });
});
