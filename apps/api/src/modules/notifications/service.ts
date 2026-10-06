/**
 * Notification fan-out.
 *
 * Kept as a service (not inline in the issue code) so that adding an email or
 * push transport later is a change in exactly one place: `deliver`.
 */
import type { ActorContext, NotificationType } from '@flowdesk/contracts';
import { RealtimeEventType } from '@flowdesk/contracts';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { usersWithProjectAccess, visibleProjectIds } from '../../lib/context';
import { log } from '../../lib/logger';
import { telegram, telegramEnabled } from '../../lib/telegram';
import { emit } from '../../realtime/eventBus';
import { deliverToTelegram } from '../telegram/service';

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
  let recipients = [...new Set(input.userIds)].filter((id) => id && id !== input.actorId);
  if (recipients.length === 0) return;

  // Whoever is on the list was put there earlier: a subscriber, a commenter, a
  // mention typed by hand. None of that proves they may still open the task —
  // a guest taken off the project used to keep receiving its comments, text
  // included. The check sits here, in the one door every notification about a
  // task goes through, so no caller can forget it.
  if (input.issueId) {
    const issue = await prisma.issue.findUnique({ where: { id: input.issueId }, select: { projectId: true } });
    if (!issue) return;
    recipients = await usersWithProjectAccess(input.workspaceId, issue.projectId, recipients);
    if (recipients.length === 0) return;
  }

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

  // Telegram goes out at once but in the background: a slow or unreachable
  // messenger must not hold up — let alone fail — the change that caused it.
  if (telegramEnabled) {
    void sendToTelegram(created, input).catch((error) => log.warn({ err: error }, 'telegram fan-out failed'));
  }
}

async function sendToTelegram(created: { id: string; userId: string }[], input: NotifyInput): Promise<void> {
  const [actor, issue] = await Promise.all([
    input.actorId ? prisma.user.findUnique({ where: { id: input.actorId }, select: { name: true } }) : null,
    input.issueId ? prisma.issue.findUnique({ where: { id: input.issueId }, select: { issueKey: true } }) : null,
  ]);
  await deliverToTelegram(
    created.map((n) => ({
      id: n.id,
      userId: n.userId,
      title: input.title,
      body: input.body ?? null,
      actorName: actor?.name ?? null,
      issueKey: issue?.issueKey ?? null,
    })),
    telegram,
  );
}

/**
 * Everyone who should hear about activity on an issue: its author, assignee
 * and commenters, plus whoever subscribed — minus whoever asked not to hear.
 * Only the fan-out follows this; a mention or an assignment is addressed to a
 * person and reaches them either way.
 *
 * `also` adds people tied to one particular event — the assignee a task has
 * just been taken from is no longer on the issue, but should hear about it —
 * and they are still subject to their own choice not to hear.
 */
export async function issueWatchers(issueId: string, also: (string | null | undefined)[] = []): Promise<string[]> {
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: {
      assigneeId: true,
      reporterId: true,
      comments: { select: { authorId: true }, distinct: ['authorId'], take: 50 },
      subscriptions: { select: { userId: true, subscribed: true } },
    },
  });
  if (!issue) return [];
  const muted = new Set(issue.subscriptions.filter((s) => !s.subscribed).map((s) => s.userId));
  const participants = [
    issue.assigneeId,
    issue.reporterId,
    ...issue.comments.map((c) => c.authorId),
    ...issue.subscriptions.filter((s) => s.subscribed).map((s) => s.userId),
    ...also,
  ];
  return [...new Set(participants.filter((id): id is string => Boolean(id) && !muted.has(id!)))];
}

/**
 * What a person's inbox may show: their notifications in this workspace, minus
 * those about tasks in projects they can no longer open. A notification keeps
 * the task's key, title and often a comment's text, so one written while the
 * reader had access must disappear together with that access — and come back
 * if access is returned.
 */
export async function readableNotificationsWhere(actor: ActorContext): Promise<Prisma.NotificationWhereInput> {
  const allowed = await visibleProjectIds(actor);
  return {
    userId: actor.userId,
    workspaceId: actor.workspaceId,
    ...(allowed === 'ALL' ? {} : { OR: [{ issueId: null }, { issue: { projectId: { in: allowed } } }] }),
  };
}

/** Records someone's choice to hear, or not to hear, about an issue. */
export async function setWatching(issueId: string, userId: string, watching: boolean): Promise<void> {
  await prisma.issueSubscription.upsert({
    where: { issueId_userId: { issueId, userId } },
    create: { issueId, userId, subscribed: watching },
    update: { subscribed: watching },
  });
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
