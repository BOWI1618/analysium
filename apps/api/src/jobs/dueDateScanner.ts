/**
 * Background job: warns assignees about issues due within 24 hours.
 *
 * Deliberately idempotent — it only notifies once per issue per day by
 * checking for an existing notification of the same type created today.
 */
import { NotificationType } from '@flowdesk/contracts';
import { prisma } from '../lib/prisma';
import { notify } from '../modules/notifications/service';

const INTERVAL_MS = 30 * 60 * 1000;

export async function scanDueSoon(now = new Date()): Promise<number> {
  const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const issues = await prisma.issue.findMany({
    where: {
      archivedAt: null,
      assigneeId: { not: null },
      dueDate: { gte: now, lte: soon },
      status: { category: { notIn: ['COMPLETED', 'CANCELED'] } },
    },
    select: {
      id: true,
      issueKey: true,
      title: true,
      assigneeId: true,
      dueDate: true,
      project: { select: { workspaceId: true } },
      notifications: {
        where: { type: NotificationType.ISSUE_DUE_SOON, createdAt: { gte: startOfDay } },
        select: { id: true },
      },
    },
    take: 500,
  });

  const pending = issues.filter((i) => i.notifications.length === 0);

  for (const issue of pending) {
    await notify({
      userIds: [issue.assigneeId!],
      workspaceId: issue.project.workspaceId,
      // System-generated: no human actor, so nothing is suppressed as an echo.
      actorId: null,
      type: NotificationType.ISSUE_DUE_SOON,
      title: `${issue.issueKey} is due soon`,
      body: issue.title,
      issueId: issue.id,
    });
  }

  return pending.length;
}

export function startDueDateScanner(): () => void {
  const timer = setInterval(() => {
    void scanDueSoon().catch(() => undefined);
  }, INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
