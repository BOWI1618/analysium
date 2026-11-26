import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { richTextChecklistItem, type DayPlanDraftDto, type DayPlansDto, type NotificationDto, type RichDoc } from '@flowdesk/contracts';
import { addMember, disconnectTestDb, migrateTestSchema, registerUser, type TestUser } from '../setup';

let app: FastifyInstance;
let manager: TestUser;
let report: TestUser;
let mentioned: TestUser;
let colleague: TestUser;

const date = '2030-01-15';
const call = (user: TestUser, method: 'GET' | 'PATCH' | 'POST', url: string, payload?: object) =>
  app.inject({ method, url: `/api/v1/workspaces/${manager.workspaceId}${url}`, headers: { cookie: user.cookie }, ...(payload && { payload }) });
const getPlans = async (user: TestUser, day = date) =>
  (await call(user, 'GET', `/day-plans/${day}`)).json<DayPlansDto>();
const save = (content: RichDoc, revision: number | null, publish: boolean, day = date, user = manager) =>
  call(user, 'PATCH', `/day-plans/${day}`, { content, revision, publish });
const notices = async (user: TestUser) =>
  (await call(user, 'GET', '/notifications')).json<{ items: NotificationDto[] }>().items.filter((item) => item.type === 'DAY_PLAN');

function plan(time: string, withMention = true): RichDoc {
  return {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Выполнить за день без привязки ко времени' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: `${time} · Встреча` }] },
      {
        type: 'bulletList',
        content: [{
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Посмотреть задачу ' },
              { type: 'text', text: 'WEB-42', marks: [{ type: 'link', attrs: { href: '/issue/WEB-42' } }] },
              ...(withMention ? [{ type: 'mention', attrs: { id: mentioned.id, label: mentioned.name } }] : []),
            ],
          }],
        }],
      },
    ],
  };
}

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();
  manager = await registerUser(app, { name: 'Руководитель', workspaceName: 'Планы' });
  report = await registerUser(app, { name: 'Подчинённый' });
  mentioned = await registerUser(app, { name: 'Отмеченный сотрудник' });
  colleague = await registerUser(app, { name: 'Другой сотрудник' });
  for (const member of [report, mentioned, colleague]) await addMember(app, manager, member.email, 'MEMBER');
  const department = await call(manager, 'POST', '/departments', {
    name: 'Отдел',
    memberIds: [manager.id, report.id],
    structure: [{ userId: manager.id, managerId: null }, { userId: report.id, managerId: manager.id }],
  });
  expect(department.statusCode, department.body).toBe(201);
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

it('показывает опубликованный план подчинённому и отмеченному человеку, уведомляя только отмеченного', async () => {
  const draft = await save(plan('14:00–16:00'), null, false);
  expect(draft.statusCode, draft.body).toBe(200);
  expect((await getPlans(manager)).draft?.revision).toBe(1);
  expect(await getPlans(report)).toEqual({ draft: null, plans: [] });
  expect(await notices(mentioned)).toEqual([]);

  const published = await save(plan('14:00–16:00'), 1, true);
  expect(published.statusCode, published.body).toBe(200);
  const visible = (await getPlans(report)).plans;
  expect(visible).toHaveLength(1);
  expect(JSON.stringify(visible[0]?.content)).toContain('без привязки ко времени');
  expect(JSON.stringify(visible[0]?.content)).toContain('/issue/WEB-42');
  expect((await getPlans(mentioned)).plans).toEqual(visible);
  expect((await getPlans(colleague)).plans).toEqual([]);
  expect((await getPlans(report, '2030-01-16')).plans).toEqual([]);
  expect(await notices(report)).toEqual([]);
  expect(await notices(mentioned)).toMatchObject([{
    dayPlan: { id: visible[0]?.id, date },
    body: expect.stringContaining('14:00–16:00 · Встреча · Посмотреть задачу WEB-42'),
  }]);

  const changedDraft = await save(plan('15:00–16:00'), 2, false);
  expect(changedDraft.statusCode, changedDraft.body).toBe(200);
  expect((await getPlans(report)).plans).toEqual(visible);
  expect(await notices(mentioned)).toHaveLength(1);

  expect((await save(plan('15:00–16:00'), 2, true)).statusCode).toBe(409);
  const changed = await save(plan('15:00–16:00'), 3, true);
  expect(changed.statusCode, changed.body).toBe(200);
  expect(await notices(mentioned)).toHaveLength(2);
  expect((await notices(mentioned)).some(({ body }) => body?.includes('15:00–16:00'))).toBe(true);
  expect((await save(plan('15:00–16:00'), changed.json<DayPlanDraftDto>().revision, true)).statusCode).toBe(200);
  expect(await notices(mentioned)).toHaveLength(2);

  expect((await save(plan('15:00–16:00', false), 5, true)).statusCode).toBe(200);
  expect((await getPlans(mentioned)).plans).toEqual([]);
  expect((await getPlans(report)).plans).toHaveLength(1);
  expect(await notices(mentioned)).toHaveLength(3);

  const unpublish = (user: TestUser, revision: number) => call(user, 'POST', `/day-plans/${date}/unpublish`, { revision });
  expect((await unpublish(colleague, 6)).statusCode).toBe(404);
  expect((await unpublish(manager, 5)).statusCode).toBe(409);
  const withdrawn = await unpublish(manager, 6);
  expect(withdrawn.statusCode, withdrawn.body).toBe(200);
  expect(withdrawn.json<DayPlanDraftDto>()).toMatchObject({ revision: 7, publishedContent: null });
  expect(JSON.stringify(withdrawn.json<DayPlanDraftDto>().content)).toContain('15:00–16:00');
  expect((await getPlans(report)).plans).toEqual([]);
  expect((await notices(mentioned)).every((item) => !item.dayPlan)).toBe(true);

  expect((await save(plan('15:00–16:00'), 7, true)).statusCode).toBe(200);
  expect((await getPlans(report)).plans).toHaveLength(1);
  expect((await notices(mentioned)).filter((item) => item.dayPlan)).toHaveLength(1);
});

it('сохраняет отметки команды в публикации и черновике и отклоняет устаревшие запросы', async () => {
  const day = '2030-01-18';
  const content: RichDoc = {
    type: 'doc',
    content: [{
      type: 'taskList',
      content: ['Первый пункт', 'Второй пункт'].map((text) => ({
        type: 'taskItem',
        attrs: { checked: false },
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      })),
    }],
  };
  expect((await save(content, null, true, day)).statusCode).toBe(200);
  const [published] = (await getPlans(report, day)).plans;
  const tick = (user: TestUser, path: number[], checked: boolean, publishedAt = published!.publishedAt) =>
    call(user, 'PATCH', `/day-plans/${published!.id}/checklist`, { path, checked, publishedAt });

  expect((await tick(colleague, [0, 0], true)).statusCode).toBe(404);
  expect((await tick(report, [0, 0, 0], true)).statusCode).toBe(404);
  const toggled = await Promise.all([
    tick(report, [0, 0], true),
    tick(manager, [0, 1], true),
  ]);
  expect(toggled.map((reply) => reply.statusCode)).toEqual([204, 204]);
  const result = await getPlans(manager, day);
  expect(result.draft?.revision).toBe(3);
  for (const index of [0, 1]) {
    expect(richTextChecklistItem(result.draft!.content, [0, index])?.attrs?.checked).toBe(true);
    expect(richTextChecklistItem(result.plans[0]!.content, [0, index])?.attrs?.checked).toBe(true);
  }
  expect((await tick(report, [0, 0], false, '2030-01-17T12:00:00.000Z')).statusCode).toBe(409);
  expect((await tick(report, [0, 0], false)).statusCode).toBe(204);
  expect(richTextChecklistItem((await getPlans(report, day)).plans[0]!.content, [0, 0])?.attrs?.checked).toBe(false);
});
