import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  addMember,
  createIssue,
  createProject,
  dropTestSchema,
  login,
  migrateTestSchema,
  registerUser,
  type TestUser,
} from '../setup';

let app: FastifyInstance;
let owner: TestUser;
let member: TestUser & { sessionCookie: string };
let project: { id: string };
let issue: { id: string; issueKey: string };

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();

  owner = await registerUser(app, { name: 'Автор', email: 'owner@comments.test' });
  project = await createProject(app, owner, { name: 'Обсуждения', key: 'CMT' });
  issue = await createIssue(app, owner, project.id, { title: 'Тема для обсуждения' });

  const raw = await registerUser(app, { name: 'Коллега', email: 'member@comments.test' });
  await addMember(app, owner, raw.email, 'MEMBER');
  member = { ...raw, sessionCookie: await login(app, raw.email) };
});

afterAll(async () => {
  await app?.close();
  await dropTestSchema();
});

const post = (cookie: string, text: string) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/issues/${issue.id}/comments`,
    headers: { cookie },
    payload: { body: doc(text) },
  });

describe('creating comments', () => {
  it('stores a comment and returns its author', async () => {
    const response = await post(owner.cookie, 'Первый комментарий');
    expect(response.statusCode).toBe(201);
    expect(response.json().author.id).toBe(owner.id);
    expect(JSON.stringify(response.json().body)).toContain('Первый комментарий');
  });

  it('rejects an empty comment', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/issues/${issue.id}/comments`,
      headers: { cookie: owner.cookie },
      payload: { body: { type: 'doc', content: [{ type: 'paragraph' }] } },
    });
    expect(response.statusCode).toBe(400);
  });

  it('strips unsafe nodes from the body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/issues/${issue.id}/comments`,
      headers: { cookie: owner.cookie },
      payload: {
        body: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'чисто' }] },
            { type: 'iframe', attrs: { src: 'https://evil.test' } },
          ],
        },
      },
    });
    expect(JSON.stringify(response.json().body)).not.toContain('iframe');
  });

  it('appends a COMMENT_ADDED activity entry', async () => {
    await post(owner.cookie, 'Появится в истории');
    const activity = await app.inject({
      method: 'GET',
      url: `/api/v1/issues/${issue.id}/activity`,
      headers: { cookie: owner.cookie },
    });
    expect(activity.json().some((e: { type: string }) => e.type === 'COMMENT_ADDED')).toBe(true);
  });

  it('lists comments oldest first', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/issues/${issue.id}/comments`,
      headers: { cookie: owner.cookie },
    });
    const times = response.json().map((c: { createdAt: string }) => new Date(c.createdAt).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe('mentions', () => {
  it('notifies a mentioned workspace member', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/issues/${issue.id}/comments`,
      headers: { cookie: owner.cookie },
      payload: {
        body: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Взгляни, ' },
                { type: 'mention', attrs: { id: member.id, label: 'Коллега' } },
              ],
            },
          ],
        },
      },
    });

    const inbox = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${owner.workspaceId}/notifications`,
      headers: { cookie: member.sessionCookie },
    });
    const types = inbox.json().items.map((n: { type: string }) => n.type);
    expect(types).toContain('ISSUE_MENTIONED');
  });

  it('ignores mentions of people outside the workspace', async () => {
    const outsider = await registerUser(app, { email: 'outsider@comments.test' });
    await app.inject({
      method: 'POST',
      url: `/api/v1/issues/${issue.id}/comments`,
      headers: { cookie: owner.cookie },
      payload: {
        body: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'mention', attrs: { id: outsider.id, label: 'Чужой' } }] },
          ],
        },
      },
    });

    // The outsider is not a member of that workspace, so the notification
    // list for it is not even visible to them.
    const inbox = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${owner.workspaceId}/notifications`,
      headers: { cookie: outsider.cookie },
    });
    expect(inbox.statusCode).toBe(404);

    // And nothing landed in their own workspace either.
    const ownInbox = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${outsider.workspaceId}/notifications`,
      headers: { cookie: outsider.cookie },
    });
    expect(ownInbox.json().items).toHaveLength(0);
  });
});

describe('editing and deleting', () => {
  it('lets the author edit their own comment and marks it edited', async () => {
    const created = await post(member.sessionCookie, 'Черновик');
    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/comments/${created.json().id}`,
      headers: { cookie: member.sessionCookie },
      payload: { body: doc('Исправлено') },
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json().editedAt).not.toBeNull();
    expect(JSON.stringify(updated.json().body)).toContain('Исправлено');
  });

  it('stops a member editing someone else’s comment', async () => {
    const created = await post(owner.cookie, 'Чужой комментарий');
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/comments/${created.json().id}`,
      headers: { cookie: member.sessionCookie },
      payload: { body: doc('Подмена') },
    });
    expect(response.statusCode).toBe(403);
  });

  it('lets the author delete their own comment', async () => {
    const created = await post(member.sessionCookie, 'Удалю сам');
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/comments/${created.json().id}`,
      headers: { cookie: member.sessionCookie },
    });
    expect(response.statusCode).toBe(204);
  });

  it('lets an owner delete anyone’s comment', async () => {
    const created = await post(member.sessionCookie, 'Удалит владелец');
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/comments/${created.json().id}`,
      headers: { cookie: owner.cookie },
    });
    expect(response.statusCode).toBe(204);
  });

  it('stops a member deleting someone else’s comment', async () => {
    const created = await post(owner.cookie, 'Не удалить');
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/comments/${created.json().id}`,
      headers: { cookie: member.sessionCookie },
    });
    expect(response.statusCode).toBe(403);
  });

  it('reports per-comment permissions to the client', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/issues/${issue.id}/comments`,
      headers: { cookie: member.sessionCookie },
    });
    const comments = response.json();
    const mine = comments.find((c: { author: { id: string } }) => c.author.id === member.id);
    const theirs = comments.find((c: { author: { id: string } }) => c.author.id === owner.id);
    expect(mine.canEdit).toBe(true);
    expect(theirs.canEdit).toBe(false);
    expect(theirs.canDelete).toBe(false);
  });
});

describe('access control', () => {
  it('hides comments on another workspace’s issue', async () => {
    const outsider = await registerUser(app, { email: 'nosy@comments.test' });
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/issues/${issue.id}/comments`,
      headers: { cookie: outsider.cookie },
    });
    expect(response.statusCode).toBe(404);
  });
});
