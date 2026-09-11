/**
 * Notification fan-out.
 *
 * Kept as a service (not inline in the issue code) so that adding an email or
 * push transport later is a change in exactly one place: `deliver`.
 */
import type { NotificationType } from '@flowdesk/contracts';
import { RealtimeEventType } from '@flowdesk/contracts';
import { prisma } from '../../lib/prisma';
import { emit } from '../../realtime/eventBus';

export interface NotifyInput {
  userIds: string[];
  workspaceId: string;
  /** `null` for system-generated notifications (no human actor). */
  actorId: string | null;
  type: NotificationType;
  title: string;
  body?: string | null;
  issueId?: string | null;
  commentId?: string | null;
}

/**
 * Creates notifications for everyone except the actor (nobody wants to be
 * told about their own action) and pushes them over the realtime channel.
 */
export async function notify(input: NotifyInput): Promise<void> {
  const recipients = [...new Set(input.userIds)].filter((id) => id && id !== input.actorId);
  if (recipients.length === 0) return;

  const created = await prisma.$transaction(
    recipients.map((userId) =>
      prisma.notification.create({
        data: {
          userId,
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          issueId: input.issueId ?? null,
          commentId: input.commentId ?? null,
        },
        select: { id: true, userId: true },
      }),
    ),
  );

  for (const n of created) {
    emit(RealtimeEventType.NOTIFICATION_CREATED, {
      workspaceId: input.workspaceId,
      actorId: input.actorId ?? 'system',
      payload: { notificationId: n.id, recipientId: n.userId },
    });
  }
}

/** Everyone who should hear about activity on an issue. */
export async function issueWatchers(issueId: string): Promise<string[]> {
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: {
      assigneeId: true,
      reporterId: true,
      comments: { select: { authorId: true }, distinct: ['authorId'], take: 50 },
    },
  });
  if (!issue) return [];
  return [
    ...new Set(
      [issue.assigneeId, issue.reporterId, ...issue.comments.map((c) => c.authorId)].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ];
}

/** Restricts mention targets to users who are actually workspace members. */
export async function filterWorkspaceMembers(workspaceId: string, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId, userId: { in: userIds } },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}
