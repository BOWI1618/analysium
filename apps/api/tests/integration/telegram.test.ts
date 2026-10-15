import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addMember, createIssue, createProject, disconnectTestDb, migrateTestSchema, registerUser, type TestUser } from '../setup';
import { TelegramError, type TelegramApi } from '../../src/lib/telegram';
import {
  createLinkUrl,
  deliverToTelegram,
  formatNotice,
  handleUpdate,
  linkFromApp,
} from '../../src/modules/telegram/service';
import { prisma } from '../../src/lib/prisma';

let app: FastifyInstance;
let owner: TestUser;
let member: TestUser;
let projectId: string;

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();
  owner = await registerUser(app, { name: 'Автор Задач', workspaceName: 'Телеграм' });
  member = await registerUser(app, { name: 'Мария <Телеграмова>' });
  await addMember(app, owner, member.email, 'MEMBER');
  projectId = (await createProject(app, owner)).id;
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

/** Stands in for Telegram: remembers what the bot would have sent. */
function fakeTelegram(options: { blocked?: boolean } = {}) {
  const sent: { chatId: string; text: string }[] = [];
  const api: TelegramApi = {
    username: async () => 'analysium_test_bot',
    sendMessage: async (chatId, text) => {
      if (options.blocked) throw new TelegramError(403, 'Forbidden: bot was blocked by the user');
      sent.push({ chatId, text });
    },
    getUpdates: async () => [],
    configure: async () => undefined,
  };
  return { api, sent };
}

const message = (chatId: number, text: string, type = 'private') => ({
  update_id: Math.floor(Math.random() * 1e9),
  message: { text, chat: { id: chatId, type } },
});

const linked = async (user: TestUser) =>
  (await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: user.cookie } })).json().user
    .telegramLinked as boolean;

const tokenFrom = (url: string) => new URL(url).searchParams.get('start')!;

describe('Telegram', () => {
  it('аккаунт подключается одноразовой ссылкой; вторая попытка с той же ссылкой не проходит', async () => {
    const { api, sent } = fakeTelegram();
    const { url } = await createLinkUrl(member.id, api);
    expect(url).toMatch(/^https:\/\/t\.me\/analysium_test_bot\?start=[\w-]{32}$/);
    expect(await linked(member)).toBe(false);

    // A group chat is not a place for personal notifications.
    await handleUpdate(message(-100, `/start ${tokenFrom(url)}`, 'group'), api);
    expect(sent).toHaveLength(0);

    await handleUpdate(message(777, `/start ${tokenFrom(url)}`), api);
    expect(sent[0]).toMatchObject({ chatId: '777' });
    // The name goes into HTML and must not break the markup.
    expect(sent[0]!.text).toContain('Готово, Мария &lt;Телеграмова&gt;!');
    expect(await linked(member)).toBe(true);

    await handleUpdate(message(888, `/start ${tokenFrom(url)}`), api);
    expect(sent[1]!.text).toContain('Ссылка устарела');
    expect((await prisma.user.findUnique({ where: { id: member.id } }))!.telegramChatId).toBe('777');
  });

  it('уведомление приходит в Telegram со ссылкой на задачу и не дублируется письмом', async () => {
    const issue = await createIssue(app, owner, projectId, { title: 'Проверить <b>отчёт</b>', assigneeId: member.id });
    let notification = await prisma.notification.findFirst({ where: { userId: member.id, issueId: issue.id } });
    for (let attempt = 0; !notification && attempt < 50; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      notification = await prisma.notification.findFirst({ where: { userId: member.id, issueId: issue.id } });
    }

    const { api, sent } = fakeTelegram();
    const delivered = await deliverToTelegram(
      [
        {
          id: notification!.id,
          userId: member.id,
          title: notification!.title,
          body: notification!.body,
          actorName: owner.name,
          issueKey: issue.issueKey,
        },
        // The author has no Telegram: nothing is sent, nothing is marked.
        { id: 'missing', userId: owner.id, title: 'x', body: null, actorName: null, issueKey: null },
      ],
      api,
    );
    expect(delivered).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.chatId).toBe('777');
    expect(sent[0]!.text).toContain(`<b>${issue.issueKey} назначена на вас</b>`);
    expect(sent[0]!.text).toContain('Проверить &lt;b&gt;отчёт&lt;/b&gt;');
    expect(sent[0]!.text).toContain(`/issue/${issue.issueKey}">Открыть задачу</a>`);

  });

  it('кто заблокировал бота — отключается; /stop отключает по просьбе', async () => {
    const blocked = fakeTelegram({ blocked: true });
    await deliverToTelegram(
      [{ id: 'any', userId: member.id, title: 'Новое', body: null, actorName: null, issueKey: null }],
      blocked.api,
    );
    expect(await linked(member)).toBe(false);

    const { api, sent } = fakeTelegram();
    await handleUpdate(message(555, `/start ${tokenFrom((await createLinkUrl(member.id, api)).url)}`), api);
    expect(await linked(member)).toBe(true);
    await handleUpdate(message(555, '/stop'), api);
    expect(sent.at(-1)!.text).toContain('Telegram отключён');
    expect(await linked(member)).toBe(false);

    // Any other message from a stranger gets directions, not silence.
    await handleUpdate(message(999, 'привет'), api);
    expect(sent.at(-1)!.text).toContain('Подключить Telegram');
  });

  it('на сервере с HTTPS задача открывается кнопкой внутри Telegram, в разработке — ссылкой в тексте', () => {
    const notice = { title: 'WEB-4 назначена на вас', body: 'Отчёт', actorName: 'Автор', issueKey: 'WEB-4' };

    const deployed = formatNotice(notice, 'https://analysium.space');
    expect(deployed.button).toEqual({ text: 'Открыть задачу', url: 'https://analysium.space/issue/WEB-4' });
    expect(deployed.text).not.toContain('<a ');

    const local = formatNotice(notice, 'http://localhost:5173');
    expect(local.button).toBeUndefined();
    expect(local.text).toContain('<a href="http://localhost:5173/issue/WEB-4">Открыть задачу</a>');

    expect(formatNotice({ ...notice, issueKey: null }, 'https://analysium.space').button).toEqual({
      text: 'Открыть входящие',
      url: 'https://analysium.space/inbox',
    });
  });

  it('сообщение рассказывает о задаче: чья часть, проект, статус, срок и кто что сделал', async () => {
    const now = new Date('2026-10-13T08:00:00.000Z');
    const read = { timezone: 'Europe/Moscow', now };
    const issue = {
      title: 'МИР',
      project: 'CRM',
      parent: { issueKey: 'CRM-4', title: 'Запуск по регионам' },
      status: 'К выполнению',
      closed: false,
      priority: 'HIGH',
      dueDate: new Date('2026-10-15T12:00:00.000Z'),
      dueHasTime: false,
      assignee: 'Мария Чен',
    };
    const assigned = formatNotice(
      { title: 'CRM-4.1 назначена на вас', body: 'МИР', actorName: 'Ризванов Р.О.', issueKey: 'CRM-4.1', type: 'ISSUE_ASSIGNED', issue },
      'https://analysium.space',
      read,
    ).text;
    expect(assigned.split('\n')).toEqual([
      '<b>CRM-4.1 назначена на вас</b>',
      'МИР',
      // A part's own title rarely says what it is a part of.
      '<i>подзадача в CRM-4 «Запуск по регионам»</i>',
      '',
      'Проект: CRM',
      'Статус: К выполнению',
      'Срок: 15 октября — через 2 дня',
      'Приоритет: высокий',
      '',
      '<i>Назначил(а): Ризванов Р.О.</i>',
    ]);

    // A comment is somebody's words: set apart as a quote, with the task named above it.
    const commented = formatNotice(
      {
        title: 'Новый комментарий в CRM-4',
        body: 'Нужен <отчёт> до пятницы',
        actorName: 'Автор',
        issueKey: 'CRM-4',
        type: 'ISSUE_COMMENTED',
        quote: true,
        issue: { ...issue, title: 'Запуск по регионам', parent: null, priority: 'NONE' },
      },
      'https://analysium.space',
      read,
    ).text;
    expect(commented).toContain('Запуск по регионам\n<blockquote>Нужен &lt;отчёт&gt; до пятницы</blockquote>');
    expect(commented).toContain('Исполнитель: Мария Чен');
    expect(commented).not.toContain('Приоритет');
    expect(commented).toContain('<i>Написал(а): Автор</i>');

    // How far the deadline is, by the reader's own calendar; a time is shown on their clock.
    const due = (dueDate: string, dueHasTime: boolean, closed = false, timezone = 'Europe/Moscow') =>
      formatNotice(
        {
          title: 'x',
          body: null,
          actorName: null,
          issueKey: 'CRM-4',
          type: 'ISSUE_DUE_SOON',
          issue: { ...issue, dueDate: new Date(dueDate), dueHasTime, closed },
        },
        'https://analysium.space',
        { timezone, now },
      )
        .text.split('\n')
        .find((line) => line.startsWith('Срок:'));
    expect(due('2026-10-13T12:00:00.000Z', false)).toBe('Срок: 13 октября — сегодня');
    expect(due('2026-10-14T12:00:00.000Z', false)).toBe('Срок: 14 октября — завтра');
    expect(due('2026-10-08T12:00:00.000Z', false)).toBe('Срок: 8 октября — просрочен на 5 дней');
    expect(due('2026-10-12T12:00:00.000Z', false)).toBe('Срок: 12 октября — просрочен на 1 день');
    // 21:30 UTC on the 13th is half past midnight on the 14th in Moscow — tomorrow there, today in UTC.
    expect(due('2026-10-13T21:30:00.000Z', true)).toBe('Срок: 14 октября, 00:30 — завтра');
    expect(due('2026-10-13T21:30:00.000Z', true, false, 'UTC')).toBe('Срок: 13 октября, 21:30 — сегодня');
    // A finished task is not late for anything; another year is named.
    expect(due('2026-10-08T12:00:00.000Z', false, true)).toBe('Срок: 8 октября');
    expect(due('2027-01-10T12:00:00.000Z', false)).toMatch(/^Срок: 10 января 2027 г\. — через \d+ дн/);
    // A zone the server does not know reads as UTC rather than failing the message.
    expect(due('2026-10-14T12:00:00.000Z', false, false, 'Nowhere/Land')).toBe('Срок: 14 октября — завтра');

    // The deadline taken away is said in the details; the body that only repeated the title is not.
    const cleared = formatNotice(
      {
        title: 'Изменился срок у CRM-4',
        body: 'Срок снят — МИР',
        actorName: 'Автор',
        issueKey: 'CRM-4',
        type: 'ISSUE_DUE_DATE_CHANGED',
        issue: { ...issue, dueDate: null },
      },
      'https://analysium.space',
      read,
    ).text;
    expect(cleared).toContain('Срок: снят');
    expect(cleared).not.toContain('Срок снят — МИР');
    expect(cleared).toContain('<i>Изменил(а) срок: Автор</i>');
  });

  it('уведомление уходит в мессенджер с задачей, какой она стала после изменения', async () => {
    const parent = await createIssue(app, owner, projectId, { title: 'Большая задача' });
    const part = await createIssue(app, owner, projectId, {
      title: 'Её часть',
      parentId: parent.id,
      type: 'SUBTASK',
      assigneeId: member.id,
      priority: 'URGENT',
      dueDate: '2031-03-15T12:00:00.000Z',
    });
    const { telegramNotices } = await import('../../src/modules/notifications/service');
    const [notice] = await telegramNotices([{ id: 'n1', userId: member.id }], {
      actorId: owner.id,
      issueId: part.id,
      commentId: null,
      title: `${part.issueKey} назначена на вас`,
      body: 'Её часть',
      type: 'ISSUE_ASSIGNED',
    });
    expect(notice).toMatchObject({
      issueKey: part.issueKey,
      actorName: owner.name,
      type: 'ISSUE_ASSIGNED',
      quote: false,
      issue: {
        title: 'Её часть',
        parent: { issueKey: parent.issueKey, title: 'Большая задача' },
        closed: false,
        priority: 'URGENT',
        dueHasTime: false,
        assignee: member.name,
      },
    });
    expect(notice!.issue!.project).toBeTruthy();
    expect(notice!.issue!.dueDate?.toISOString()).toBe('2031-03-15T12:00:00.000Z');
    // A notification that is not about a task carries none.
    const [plain] = await telegramNotices([{ id: 'n2', userId: member.id }], {
      actorId: null,
      issueId: null,
      commentId: null,
      title: 'Спринт начался',
      body: null,
      type: 'SPRINT_STARTED',
    });
    expect(plain).toMatchObject({ issue: null, issueKey: null, actorName: null });
  });

  it('изнутри Telegram аккаунт подключается одним нажатием — по данным, подписанным Telegram', async () => {
    const token = '123456:TEST-TOKEN';
    const sign = (telegramUserId: number, botToken: string) => {
      const fields: Record<string, string> = {
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: telegramUserId, first_name: 'Мария' }),
      };
      const dataCheckString = Object.keys(fields).sort().map((key) => `${key}=${fields[key]}`).join('\n');
      const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
      const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
      return new URLSearchParams({ ...fields, hash }).toString();
    };

    // Signed with some other bot's token: not Telegram's word about this bot's user.
    expect(await linkFromApp(member.id, sign(4242, 'чужой:токен'), token)).toBe(false);
    expect(await linked(member)).toBe(false);

    expect(await linkFromApp(member.id, sign(4242, token), token)).toBe(true);
    expect((await prisma.user.findUnique({ where: { id: member.id } }))!.telegramChatId).toBe('4242');

    // The same Telegram connected by someone else moves over: one chat, one account.
    expect(await linkFromApp(owner.id, sign(4242, token), token)).toBe(true);
    expect(await linked(member)).toBe(false);
    expect(await linked(owner)).toBe(true);
  });

  it('срок со временем приходит по часам того, кто открывал приложение, пока пояс не выбран вручную', async () => {
    const reader = await registerUser(app, { name: 'Читатель Из Москвы' });
    await prisma.user.update({ where: { id: reader.id }, data: { telegramChatId: '9300' } });
    const session = (zone: string) =>
      app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: reader.cookie, 'x-time-zone': zone } });
    const send = async () => {
      const { api, sent } = fakeTelegram();
      await deliverToTelegram(
        [
          {
            id: 'due-at-930',
            userId: reader.id,
            title: 'Срок задачи',
            body: null,
            actorName: null,
            issueKey: 'WEB-1',
            issue: {
              title: 'Созвон',
              project: null,
              parent: null,
              status: 'К выполнению',
              closed: false,
              priority: 'NONE',
              // 9:30 in Moscow.
              dueDate: new Date('2030-03-05T06:30:00.000Z'),
              dueHasTime: true,
              assignee: null,
            },
          },
        ],
        api,
      );
      return sent[0]!.text;
    };

    // The UTC default, nobody has opened the app yet: the server can only guess.
    expect(await send()).toContain('06:30');

    await session('Europe/Moscow');
    expect(await send()).toContain('09:30');

    // A zone picked in the settings is kept, whatever browser the person opens the app in.
    const picked = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie: reader.cookie },
      payload: { name: reader.name, timezone: 'Asia/Yekaterinburg' },
    });
    expect(picked.statusCode).toBe(200);
    await session('Europe/Moscow');
    expect((await session('Europe/Moscow')).json().user.timezone).toBe('Asia/Yekaterinburg');
    expect(await send()).toContain('11:30');
  });

  it('без токена бота ссылка не выдаётся, а отключение безвредно', async () => {
    const link = await app.inject({ method: 'POST', url: '/api/v1/me/telegram/link', headers: { cookie: member.cookie } });
    expect(link.statusCode).toBe(400);
    const fromApp = await app.inject({
      method: 'POST',
      url: '/api/v1/me/telegram/link-app',
      headers: { cookie: member.cookie },
      payload: { initData: 'user=%7B%22id%22%3A1%7D&hash=00' },
    });
    expect(fromApp.statusCode).toBe(400);
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData: 'user=%7B%22id%22%3A1%7D&hash=00' },
    });
    expect(signIn.statusCode).toBe(401);
    const off = await app.inject({ method: 'DELETE', url: '/api/v1/me/telegram', headers: { cookie: member.cookie } });
    expect(off.statusCode).toBe(204);
    const config = (await app.inject({ method: 'GET', url: '/api/v1/auth/config' })).json();
    expect(config.telegramEnabled).toBe(false);
  });
});
