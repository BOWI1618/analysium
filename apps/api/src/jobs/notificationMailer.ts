/**
 * Background job: e-mails notifications nobody has read in the app.
 *
 * Mail is a fallback for being away, not a second copy of the inbox. A
 * notification goes out only after it has sat unread for a while — read it in
 * the app and no letter follows — and everything waiting for one person is
 * gathered into a single digest. Digests to one person are spaced out, so a
 * busy afternoon costs a handful of letters, which is also what keeps a team
 * well inside a personal mailbox's daily sending limit.
 */
import { prisma } from '../lib/prisma';
import { sendMail, type Mail } from '../lib/mailer';
import { appOrigin, env } from '../config/env';
import { log } from '../lib/logger';

const INTERVAL_MS = 2 * 60 * 1000;
/** How long a notification may stay unread in the app before it is mailed. */
export const UNREAD_DELAY_MS = 10 * 60 * 1000;
/** Shortest gap between two digests to the same person. */
export const DIGEST_GAP_MS = 30 * 60 * 1000;
/** Older than this, a notification is history, not news — it is never mailed. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Items listed in one letter; the rest are counted and wait in the inbox. */
const MAX_ITEMS = 15;

interface PendingNotification {
  id: string;
  title: string;
  body: string | null;
  createdAt: Date;
  actor: { name: string } | null;
  issue: { issueKey: string } | null;
}

/**
 * Sends every digest that is due. Returns how many letters went out.
 * `send` is injectable so tests can capture letters without an SMTP server.
 */
export async function sendNotificationDigests(
  now = new Date(),
  send: (mail: Mail) => Promise<boolean> = sendMail,
): Promise<number> {
  const pending = await prisma.notification.findMany({
    where: {
      readAt: null,
      emailedAt: null,
      createdAt: { lte: new Date(now.getTime() - UNREAD_DELAY_MS), gte: new Date(now.getTime() - MAX_AGE_MS) },
      user: {
        emailNotifications: true,
        status: 'ACTIVE',
        OR: [
          { lastNotificationEmailAt: null },
          { lastNotificationEmailAt: { lte: new Date(now.getTime() - DIGEST_GAP_MS) } },
        ],
      },
    },
    orderBy: { createdAt: 'asc' },
    take: 500,
    select: {
      id: true,
      userId: true,
      title: true,
      body: true,
      createdAt: true,
      actor: { select: { name: true } },
      issue: { select: { issueKey: true } },
      user: { select: { name: true, email: true, timezone: true } },
    },
  });

  const byUser = new Map<string, { user: (typeof pending)[number]['user']; items: PendingNotification[] }>();
  for (const { userId, user, ...item } of pending) {
    const entry = byUser.get(userId) ?? { user, items: [] };
    entry.items.push(item);
    byUser.set(userId, entry);
  }

  let sent = 0;
  for (const [userId, { user, items }] of byUser) {
    const ok = await send(composeDigest(user, items));
    // A failed send leaves everything unmarked: the next cycle tries again.
    if (!ok) continue;
    await prisma.$transaction([
      prisma.notification.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { emailedAt: now } }),
      prisma.user.update({ where: { id: userId }, data: { lastNotificationEmailAt: now } }),
    ]);
    sent += 1;
  }
  return sent;
}

export function composeDigest(
  user: { name: string; email: string; timezone: string },
  items: PendingNotification[],
): Mail {
  const shown = items.slice(0, MAX_ITEMS);
  const hidden = items.length - shown.length;

  const lines = [`${user.name}, здравствуйте.`, '', 'Пока вас не было в Analysium:', ''];
  for (const item of shown) {
    lines.push(`• ${item.title}${item.body ? ` — ${item.body}` : ''}`);
    lines.push(`  ${[item.actor?.name, formatTime(item.createdAt, user.timezone)].filter(Boolean).join(' · ')}`);
    if (item.issue) lines.push(`  ${appOrigin}/issue/${item.issue.issueKey}`);
    lines.push('');
  }
  if (hidden > 0) lines.push(`И ещё ${hidden} — во «Входящих».`, '');
  lines.push(
    `Все уведомления: ${appOrigin}/inbox`,
    '',
    '—',
    'Письмо приходит, только если уведомление не прочитано в Analysium за 10 минут.',
    `Отключить письма: ${appOrigin}/settings/account`,
  );

  const subject =
    items.length === 1 ? shown[0]!.title : `${items.length} ${plural(items.length)} в Analysium`;
  return { to: user.email, subject, text: lines.join('\n') };
}

function plural(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'новое уведомление';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'новых уведомления';
  return 'новых уведомлений';
}

/** The time as the reader's clock shows it, falling back to Moscow for an unknown zone. */
function formatTime(date: Date, timezone: string): string {
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' };
  try {
    return date.toLocaleString('ru-RU', { ...options, timeZone: timezone });
  } catch {
    return date.toLocaleString('ru-RU', { ...options, timeZone: 'Europe/Moscow' });
  }
}

export function startNotificationMailer(): () => void {
  // Without mail every cycle would be a no-op that still queries the table.
  if (!env.MAIL_ENABLED) return () => undefined;

  // In-flight guard, as in the other jobs: a slow cycle must never overlap the
  // next one, or the same digest would go out twice.
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void sendNotificationDigests()
      .catch((error) => log.error({ err: error }, 'notification digest failed'))
      .finally(() => {
        running = false;
      });
  }, INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
