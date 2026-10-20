/**
 * Background job: reminds assignees of their deadlines, on their own clock.
 *
 * Three reminders, each sent once:
 *   - the morning of the due day, from 9:00 — «срок сегодня»;
 *   - an hour before a deadline with a time — «срок через час»;
 *   - the morning after a missed deadline — «срок прошёл вчера».
 *
 * The earlier version warned «within 24 hours» and once per UTC day: a
 * whole-day task (stored at noon UTC) was announced the afternoon before, and
 * again at 3:00 Moscow time when the UTC day turned. Here the morning ones go
 * out only between 9:00 and 12:00 of the assignee's zone — late enough not to
 * wake anyone, early enough to plan the day — and every reminder carries a key
 * of the deadline it is about, so it is never repeated and a moved deadline
 * gets reminders of its own.
 */
import { NotificationType } from '@flowdesk/contracts';
import { prisma } from '../lib/prisma';
import { notify } from '../modules/notifications/service';

const INTERVAL_MS = 5 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Morning reminders go out from this hour of the assignee's day… */
const MORNING_FROM = 9;
/** …until this one; a server down at 9:00 still catches up before noon. */
const MORNING_UNTIL = 12;

interface Local {
  /** Calendar date, YYYY-MM-DD. */
  date: string;
  hour: number;
}

function localOf(moment: Date, timezone: string): Local {
  const parts = (zone: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(moment);
  let list: Intl.DateTimeFormatPart[];
  try {
    list = parts(timezone);
  } catch {
    // A zone the server does not know reads as UTC, as everywhere else.
    list = parts('UTC');
  }
  const get = (type: string) => list.find((part) => part.type === type)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

function timeOf(moment: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(moment);
  } catch {
    return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(moment);
  }
}

const dayAfter = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

interface Reminder {
  key: string;
  type: NotificationType;
  title: string;
}

/** What is due to be said about one task to its assignee right now, if anything. */
export function remindersFor(
  issue: { issueKey: string; dueDate: Date; dueHasTime: boolean },
  timezone: string,
  now: Date,
): Reminder[] {
  const due = issue.dueDate;
  const stamp = due.toISOString();
  // A whole day is the same date everywhere; a time is a moment, on the reader's calendar.
  const dueDay = issue.dueHasTime ? localOf(due, timezone).date : stamp.slice(0, 10);
  const today = localOf(now, timezone);
  const morning = today.hour >= MORNING_FROM && today.hour < MORNING_UNTIL;
  const at = issue.dueHasTime ? ` в ${timeOf(due, timezone)}` : '';
  const passed = issue.dueHasTime ? due.getTime() <= now.getTime() : today.date > dueDay;
  const withinHour = issue.dueHasTime && !passed && due.getTime() - now.getTime() <= HOUR_MS;
  const result: Reminder[] = [];

  // A deadline at 10:00 would get both at 9:05; «через час» says more.
  if (morning && today.date === dueDay && !passed && !withinHour) {
    result.push({ key: `today:${stamp}`, type: NotificationType.ISSUE_DUE_SOON, title: `${issue.issueKey}: срок сегодня${at}` });
  }
  if (withinHour) {
    result.push({ key: `hour:${stamp}`, type: NotificationType.ISSUE_DUE_SOON, title: `${issue.issueKey}: срок через час${at}` });
  }
  if (morning && today.date === dayAfter(dueDay) && passed) {
    result.push({ key: `overdue:${stamp}`, type: NotificationType.ISSUE_OVERDUE, title: `${issue.issueKey}: срок прошёл вчера${at}` });
  }
  return result;
}

export async function scanDueDates(now = new Date()): Promise<number> {
  const issues = await prisma.issue.findMany({
    where: {
      archivedAt: null,
      assigneeId: { not: null },
      // Wide enough for any zone: yesterday's deadline in Kamchatka to tomorrow's in Kaliningrad.
      dueDate: { gte: new Date(now.getTime() - 3 * DAY_MS), lte: new Date(now.getTime() + 2 * DAY_MS) },
      status: { category: { notIn: ['COMPLETED', 'CANCELED'] } },
    },
    select: {
      id: true,
      issueKey: true,
      title: true,
      dueDate: true,
      dueHasTime: true,
      assigneeId: true,
      assignee: { select: { timezone: true } },
      project: { select: { workspaceId: true } },
      notifications: { where: { reminderKey: { not: null } }, select: { userId: true, reminderKey: true } },
    },
    take: 2000,
  });

  let sent = 0;
  for (const issue of issues) {
    const assigneeId = issue.assigneeId!;
    const already = new Set(issue.notifications.filter((n) => n.userId === assigneeId).map((n) => n.reminderKey));
    const due = remindersFor({ issueKey: issue.issueKey, dueDate: issue.dueDate!, dueHasTime: issue.dueHasTime }, issue.assignee?.timezone ?? 'UTC', now);
    for (const reminder of due.filter((r) => !already.has(r.key))) {
      await notify({
        userIds: [assigneeId],
        workspaceId: issue.project.workspaceId,
        // System-generated: no human actor, so nothing is suppressed as an echo.
        actorId: null,
        type: reminder.type,
        title: reminder.title,
        body: null,
        issueId: issue.id,
        reminderKey: reminder.key,
      });
      sent += 1;
    }
  }
  return sent;
}

export function startDueDateScanner(): () => void {
  // In-flight guard: never let a slow cycle overlap the next tick — in the
  // single-instance deployment that is what would duplicate notifications.
  let scanning = false;
  const timer = setInterval(() => {
    if (scanning) return;
    scanning = true;
    void scanDueDates()
      .catch(() => undefined)
      .finally(() => {
        scanning = false;
      });
  }, INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
