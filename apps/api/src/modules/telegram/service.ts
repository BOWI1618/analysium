/**
 * Telegram: connecting an account to the bot, and delivering notifications.
 *
 * Connecting works through a one-time code. The account settings hand out a
 * link that opens the bot with that code; when the person presses «Запустить»,
 * the bot receives `/start <code>` and the chat it came from becomes that
 * account's. Nobody types a phone number or a password into a chat, and a
 * leaked code is useless after fifteen minutes or one use.
 */
import { createHash, randomBytes } from 'node:crypto';
import { TokenPurpose } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { appOrigin } from '../../config/env';
import { log } from '../../lib/logger';
import { verifyInitData } from '../../domain/telegramAuth';
import { viewerDayStart } from '../../domain/filters';
import { TelegramError, escapeHtml, type TelegramApi, type TelegramUpdate } from '../../lib/telegram';

const LINK_TTL_MS = 15 * 60 * 1000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** A fresh link that opens the bot and connects this account. Earlier unused links stop working. */
export async function createLinkUrl(userId: string, api: TelegramApi): Promise<{ url: string; expiresAt: string }> {
  await prisma.verificationToken.deleteMany({
    where: { userId, purpose: TokenPurpose.TELEGRAM_LINK, usedAt: null },
  });
  // 24 random bytes as base64url: 32 characters from the set Telegram allows in a start parameter.
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + LINK_TTL_MS);
  await prisma.verificationToken.create({
    data: { userId, tokenHash: hash(token), purpose: TokenPurpose.TELEGRAM_LINK, expiresAt },
  });
  return { url: `https://t.me/${await api.username()}?start=${token}`, expiresAt: expiresAt.toISOString() };
}

export async function unlinkTelegram(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { telegramChatId: null } });
}

/** Answers one message sent to the bot. Only private chats: the bot is personal, not a group member. */
export async function handleUpdate(update: TelegramUpdate, api: TelegramApi): Promise<void> {
  const message = update.message;
  if (!message?.text || message.chat.type !== 'private') return;
  const chatId = String(message.chat.id);
  const [command, argument] = message.text.trim().split(/\s+/, 2);

  if (command === '/start' && argument) {
    await api.sendMessage(chatId, await connect(chatId, argument));
    return;
  }

  const linked = await prisma.user.findUnique({ where: { telegramChatId: chatId }, select: { id: true, name: true } });

  if (command === '/stop') {
    if (linked) await unlinkTelegram(linked.id);
    await api.sendMessage(
      chatId,
      linked
        ? 'Telegram отключён — уведомления сюда больше не придут. Подключить снова можно в настройках аккаунта Analysium.'
        : 'Этот чат и не был подключён к Analysium.',
    );
    return;
  }

  await api.sendMessage(
    chatId,
    linked
      ? `Этот чат подключён к аккаунту <b>${escapeHtml(linked.name)}</b>. Сюда приходят уведомления о задачах.\n\nОтключить — команда /stop.`
      : `Чтобы получать здесь уведомления, откройте в Analysium «Настройки аккаунта» и нажмите «Подключить Telegram».\n\n${appOrigin}/settings/account`,
  );
}

/** Redeems a link code for the chat it was sent from; returns the reply to send. */
async function connect(chatId: string, token: string): Promise<string> {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: hash(token) },
    select: { id: true, purpose: true, expiresAt: true, usedAt: true, user: { select: { id: true, name: true } } },
  });
  if (!record || record.purpose !== TokenPurpose.TELEGRAM_LINK || record.usedAt || record.expiresAt < new Date()) {
    return 'Ссылка устарела или уже использована. Откройте «Настройки аккаунта» в Analysium и нажмите «Подключить Telegram» ещё раз.';
  }

  await prisma.$transaction([
    prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ...linkChat(record.user.id, chatId),
  ]);
  return `Готово, ${escapeHtml(record.user.name)}! Telegram подключён.\n\nСюда будут приходить уведомления Analysium: назначения, упоминания, комментарии и сроки. Отключить — команда /stop.`;
}

/** One chat belongs to one account: connecting it here takes it away from wherever it was. */
function linkChat(userId: string, chatId: string) {
  return [
    prisma.user.updateMany({ where: { telegramChatId: chatId, NOT: { id: userId } }, data: { telegramChatId: null } }),
    prisma.user.update({ where: { id: userId }, data: { telegramChatId: chatId } }),
  ];
}

/**
 * Connects the Telegram account that has Analysium open as a Mini App.
 *
 * No trip to the bot and no code: the launch data is Telegram's signed word on
 * who is looking at the page, and the person is signed in here already. In a
 * private chat the chat id is the user's own id, and a Mini App is reached
 * from the bot's chat — so the bot may write to that id.
 */
export async function linkFromApp(userId: string, initData: string, botToken: string): Promise<boolean> {
  const telegramId = verifyInitData(initData, botToken);
  if (!telegramId) return false;
  await prisma.$transaction(linkChat(userId, telegramId));
  return true;
}

export interface TelegramNotice {
  id: string;
  userId: string;
  title: string;
  body: string | null;
  actorName: string | null;
  issueKey: string | null;
  /** What happened — it words the line about who did it and picks the details worth showing. */
  type?: string | null;
  /** The body is somebody's own words (a comment) and is set apart as a quote. */
  quote?: boolean;
  /** The task as it stands now, so the message can be acted on without opening it. */
  issue?: TelegramIssue | null;
}

/** What a message says about its task. */
export interface TelegramIssue {
  title: string;
  /** Null for a task without a project. */
  project: string | null;
  /** Set for a subtask: its own title often means nothing on its own. */
  parent: { issueKey: string; title: string } | null;
  status: string;
  /** Finished or cancelled: its deadline is no longer something to be late for. */
  closed: boolean;
  priority: string;
  dueDate: Date | null;
  dueHasTime: boolean;
  assignee: string | null;
}

/**
 * Sends notifications to those of their recipients who connected Telegram.
 *
 * A delivered notification is marked as sent — in the column named after the
 * mail digest it was first made for. A chat that blocked the bot is
 * disconnected; the person can connect again, and until then their
 * notifications wait in the app.
 */
export async function deliverToTelegram(notices: TelegramNotice[], api: TelegramApi): Promise<number> {
  if (notices.length === 0) return 0;
  const recipients = await prisma.user.findMany({
    where: { id: { in: [...new Set(notices.map((n) => n.userId))] }, telegramChatId: { not: null }, status: 'ACTIVE' },
    select: { id: true, telegramChatId: true, timezone: true },
  });
  const chatOf = new Map(recipients.map((user) => [user.id, user.telegramChatId!]));
  // «Завтра» and «просрочен» are counted by the calendar of the person who reads the message.
  const zoneOf = new Map(recipients.map((user) => [user.id, user.timezone]));

  const delivered: string[] = [];
  for (const notice of notices) {
    const chatId = chatOf.get(notice.userId);
    if (!chatId) continue;
    try {
      const message = formatNotice(notice, appOrigin, { timezone: zoneOf.get(notice.userId) });
      await api.sendMessage(chatId, message.text, message.button);
      delivered.push(notice.id);
    } catch (error) {
      if (error instanceof TelegramError && error.code === 403) {
        await unlinkTelegram(notice.userId);
        chatOf.delete(notice.userId);
      } else {
        log.warn({ err: error }, 'telegram delivery failed');
      }
    }
  }

  if (delivered.length > 0) {
    await prisma.notification.updateMany({ where: { id: { in: delivered } }, data: { emailedAt: new Date() } });
  }
  return delivered.length;
}

const PRIORITY_LABEL: Record<string, string> = {
  URGENT: 'срочный',
  HIGH: 'высокий',
  MEDIUM: 'средний',
  LOW: 'низкий',
};

/** Who did it, said as what they did. */
const ACTOR_VERB: Record<string, string> = {
  ISSUE_ASSIGNED: 'Назначил(а)',
  ISSUE_UNASSIGNED: 'Снял(а) исполнителя',
  ISSUE_STATUS_CHANGED: 'Изменил(а) статус',
  ISSUE_DUE_DATE_CHANGED: 'Изменил(а) срок',
  ISSUE_COMMENTED: 'Написал(а)',
  ISSUE_MENTIONED: 'Упомянул(а)',
};

const ABOUT_ASSIGNEE = new Set(['ISSUE_ASSIGNED', 'ISSUE_UNASSIGNED', 'ISSUE_DUE_SOON']);

const DAY_MS = 24 * 60 * 60 * 1000;

function daysWord(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return `${count} дней`;
  if (ones === 1) return `${count} день`;
  if (ones >= 2 && ones <= 4) return `${count} дня`;
  return `${count} дней`;
}

/**
 * The deadline as a date and as a distance: «15 октября, 18:00 — через 2 дня».
 *
 * A deadline without a time is a whole day, the same date for everyone; one
 * with a time is a moment, shown on the reader's clock. How far away it is is
 * counted in the reader's calendar days — and not at all for a closed task.
 */
function dueText(issue: Pick<TelegramIssue, 'dueDate' | 'dueHasTime' | 'closed'>, timezone: string, now: Date): string {
  const due = issue.dueDate!;
  let zone = issue.dueHasTime ? timezone : 'UTC';
  let today: Date;
  try {
    today = viewerDayStart(timezone, now);
    new Intl.DateTimeFormat('ru-RU', { timeZone: zone });
  } catch {
    // A zone the server does not know reads as UTC, as everywhere else.
    zone = 'UTC';
    today = viewerDayStart('UTC', now);
  }

  const sameYear = due.getUTCFullYear() === now.getUTCFullYear();
  let text = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: zone,
  }).format(due);
  if (issue.dueHasTime) {
    text += `, ${new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(due)}`;
  }
  if (issue.closed) return text;

  const dueDay = viewerDayStart(zone, due);
  const distance = Math.round((dueDay.getTime() - today.getTime()) / DAY_MS);
  const how =
    distance < 0
      ? `просрочен на ${daysWord(-distance)}`
      : distance === 0
        ? 'сегодня'
        : distance === 1
          ? 'завтра'
          : `через ${daysWord(distance)}`;
  return `${text} — ${how}`;
}

/**
 * A notification as a Telegram message.
 *
 * It is read on a phone, between other things, so it says enough to decide
 * whether to open the task at all: what the task is and whose part it is,
 * where it stands, when it is due and who did what. A comment comes as a
 * quote. Notifications that are not about a task keep their two lines.
 *
 * On the deployed server the way to the task is a button that opens it inside
 * Telegram, as a Mini App, where a connected person is already signed in.
 * Telegram takes only HTTPS addresses for such a button, so in development the
 * address goes into the text as an ordinary link instead.
 */
export function formatNotice(
  notice: Omit<TelegramNotice, 'id' | 'userId'>,
  origin: string = appOrigin,
  reader: { timezone?: string | null; now?: Date } = {},
): { text: string; button?: { text: string; url: string } } {
  const lines = [`<b>${escapeHtml(notice.title)}</b>`];
  const issue = notice.issue ?? null;

  if (issue) {
    lines.push(escapeHtml(issue.title));
    if (issue.parent) {
      lines.push(`<i>подзадача в ${escapeHtml(issue.parent.issueKey)} «${escapeHtml(issue.parent.title)}»</i>`);
    }
  }
  if (notice.body && notice.quote) {
    lines.push(`<blockquote>${escapeHtml(notice.body)}</blockquote>`);
  } else if (notice.body && !(issue && notice.body.includes(issue.title))) {
    // With the task described above, a body that only repeats its title says nothing new.
    lines.push(escapeHtml(notice.body));
  }

  if (issue) {
    const details: string[] = [];
    if (issue.project) details.push(`Проект: ${escapeHtml(issue.project)}`);
    details.push(`Статус: ${escapeHtml(issue.status)}`);
    if (issue.dueDate) {
      details.push(`Срок: ${dueText(issue, reader.timezone ?? 'UTC', reader.now ?? new Date())}`);
    } else if (notice.type === 'ISSUE_DUE_DATE_CHANGED') {
      details.push('Срок: снят');
    }
    const priority = PRIORITY_LABEL[issue.priority];
    if (priority) details.push(`Приоритет: ${priority}`);
    // Left out where the message is itself about who has the task, or goes to that person.
    if (issue.assignee && !ABOUT_ASSIGNEE.has(notice.type ?? '')) {
      details.push(`Исполнитель: ${escapeHtml(issue.assignee)}`);
    }
    lines.push('', ...details);
  }

  if (notice.actorName) {
    const verb = ACTOR_VERB[notice.type ?? ''];
    const line = verb ? `${verb}: ${escapeHtml(notice.actorName)}` : escapeHtml(notice.actorName);
    lines.push(...(issue ? [''] : []), `<i>${line}</i>`);
  }

  const target = notice.issueKey
    ? { text: 'Открыть задачу', url: `${origin}/issue/${notice.issueKey}` }
    : { text: 'Открыть входящие', url: `${origin}/inbox` };
  if (origin.startsWith('https://')) return { text: lines.join('\n'), button: target };

  lines.push('', `<a href="${target.url}">${target.text}</a>`);
  return { text: lines.join('\n') };
}
