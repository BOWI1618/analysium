/**
 * Background job: «Переносить задачи на следующий день», as in Weeek. In a
 * workspace that turned it on, an unfinished task whose day has passed moves
 * to today, and the task counts the days it was carried so the delay is not
 * lost. Days are counted by the calendar in UTC, as whole-day dates are
 * stored.
 *
 * A one-day task moves whole, start and deadline; a period keeps its start
 * and stretches to today. Idempotent: a task already on today is not touched.
 */
import { RealtimeEventType } from '@flowdesk/contracts';
import { prisma } from '../lib/prisma';
import { emit } from '../realtime/eventBus';

const INTERVAL_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const utcDay = (date: Date) => Math.floor(date.getTime() / DAY_MS);

export async function carryOverTasks(now = new Date()): Promise<number> {
  const todayStart = new Date(utcDay(now) * DAY_MS);

  const issues = await prisma.issue.findMany({
    where: {
      archivedAt: null,
      dueDate: { lt: todayStart },
      status: { category: { notIn: ['COMPLETED', 'CANCELED'] } },
      project: { workspace: { carryOverTasks: true } },
    },
    select: {
      id: true,
      issueKey: true,
      projectId: true,
      startDate: true,
      dueDate: true,
      project: { select: { workspaceId: true } },
    },
    take: 1000,
  });

  for (const issue of issues) {
    const due = issue.dueDate!;
    const days = utcDay(now) - utcDay(due);
    if (days <= 0) continue;

    const dueDate = new Date(due.getTime() + days * DAY_MS);
    const oneDay = issue.startDate !== null && utcDay(issue.startDate) === utcDay(due);
    const startDate = oneDay ? new Date(issue.startDate!.getTime() + days * DAY_MS) : issue.startDate;

    await prisma.issue.update({
      where: { id: issue.id },
      data: { dueDate, startDate, carriedOverDays: { increment: days } },
    });

    emit(RealtimeEventType.ISSUE_UPDATED, {
      workspaceId: issue.project.workspaceId,
      actorId: 'system',
      payload: {
        issueId: issue.id,
        issueKey: issue.issueKey,
        projectId: issue.projectId,
        patch: { startDate: startDate?.toISOString() ?? null, dueDate: dueDate.toISOString() },
      },
    });
  }

  return issues.length;
}

export function startCarryOver(): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void carryOverTasks()
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  };
  // Right after a restart too, so a deploy at night does not skip a day.
  const first = setTimeout(tick, 30_000);
  const timer = setInterval(tick, INTERVAL_MS);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
