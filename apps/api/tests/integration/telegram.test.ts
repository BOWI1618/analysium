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
import { UNREAD_DELAY_MS, sendNotificationDigests } from '../../src/jobs/notificationMailer';
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

    // Seen in the messenger — the e-mail digest leaves it out.
    const letters: unknown[] = [];
    const later = new Date(Date.now() + UNREAD_DELAY_MS + 60_000);
    await sendNotificationDigests(later, async (mail) => {
      letters.push(mail);
      return true;
    });
    expect(letters).toHaveLength(0);
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
