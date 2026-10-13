import type { ActorContext, CommentDto, CommentReactionDto } from '@flowdesk/contracts';
import {
  ActivityType,
  NotificationType,
  Permission,
  RealtimeEventType,
  canDeleteComment,
  canEditComment,
  collectMentions,
  docToText,
  isDocEmpty,
  sanitizeDoc,
} from '@flowdesk/contracts';
import { prisma } from '../../lib/prisma';
import { assertCan } from '../../lib/context';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { log } from '../../lib/logger';
import { emit } from '../../realtime/eventBus';
import { commentSelect, toComment, toReactions } from '../../lib/serialize';
import { filterWorkspaceMembers, issueWatchers, notify } from '../notifications/service';

export async function listComments(actor: ActorContext, issueId: string): Promise<CommentDto[]> {
  const rows = await prisma.comment.findMany({
    where: { issueId },
    orderBy: { createdAt: 'asc' },
    select: commentSelect,
  });
  return rows.map((c) =>
    toComment(c, {
      canEdit: canEditComment(actor, c.author.id),
      canDelete: canDeleteComment(actor, c.author.id),
      viewerId: actor.userId,
    }),
  );
}

export async function createComment(
  actor: ActorContext,
  issue: { id: string; issueKey: string; projectId: string; title: string },
  body: unknown,
): Promise<CommentDto> {
  assertCan(actor, Permission.COMMENT_CREATE);

  const doc = sanitizeDoc(body);
  if (isDocEmpty(doc)) throw badRequest('Комментарий не может быть пустым', { body: 'Сначала напишите текст' });

  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: { issueId: issue.id, authorId: actor.userId, body: doc as never, bodyText: docToText(doc) },
      select: commentSelect,
    });
    await tx.activityEvent.create({
      data: {
        issueId: issue.id,
        actorId: actor.userId,
        type: ActivityType.COMMENT_ADDED,
        metadata: { commentId: created.id },
      },
    });
    return created;
  });

  emit(RealtimeEventType.COMMENT_CREATED, {
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    payload: { issueId: issue.id, commentId: comment.id, projectId: issue.projectId },
  });

  try {
    const [watchers, mentioned] = await Promise.all([
      issueWatchers(issue.id),
      filterWorkspaceMembers(actor.workspaceId, collectMentions(doc)),
    ]);

    const mentionedSet = new Set(mentioned);
    await Promise.all([
      notify({
        userIds: mentioned,
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        type: NotificationType.ISSUE_MENTIONED,
        title: `Вас упомянули в ${issue.issueKey}`,
        body: docToText(doc).slice(0, 160),
        issueId: issue.id,
        commentId: comment.id,
      }),
      // A mention already notified them — don't send a second "commented" ping.
      notify({
        userIds: watchers.filter((id) => !mentionedSet.has(id)),
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        type: NotificationType.ISSUE_COMMENTED,
        title: `Новый комментарий в ${issue.issueKey}`,
        body: docToText(doc).slice(0, 160),
        issueId: issue.id,
        commentId: comment.id,
      }),
    ]);
  } catch (error) {
    // A failed notification must not fail the comment — the client would retry
    // and duplicate it.
    log.warn(error, 'comment notification fan-out failed');
  }

  return toComment(comment, { canEdit: true, canDelete: true, viewerId: actor.userId });
}

/**
 * Puts a reaction on a comment, or takes it off if this person has already
 * put the same one — one press either way, as in a messenger.
 *
 * It is a way of taking part in the discussion, so it asks for what writing a
 * comment asks for. Nobody is notified: a reaction is there to be seen next
 * to the comment, not to interrupt.
 */
export async function toggleReaction(actor: ActorContext, commentId: string, emoji: string): Promise<CommentReactionDto[]> {
  assertCan(actor, Permission.COMMENT_CREATE, 'Реакции ставят те, кто может комментировать');
  const comment = await prisma.comment.findFirst({
    where: { id: commentId, issue: { project: { workspaceId: actor.workspaceId } } },
    select: { id: true, issueId: true, issue: { select: { projectId: true } } },
  });
  if (!comment) throw notFound('Комментарий');

  const key = { commentId, userId: actor.userId, emoji };
  // Taken off if it is there; put on otherwise. Two presses at once end as one or the other, never as an error.
  const removed = await prisma.commentReaction.deleteMany({ where: key });
  if (removed.count === 0) {
    await prisma.commentReaction.createMany({ data: [key], skipDuplicates: true });
  }

  emit(RealtimeEventType.COMMENT_UPDATED, {
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    payload: { issueId: comment.issueId, commentId, projectId: comment.issue.projectId },
  });

  const rows = await prisma.commentReaction.findMany({
    where: { commentId },
    orderBy: { createdAt: 'asc' },
    select: { emoji: true, userId: true, user: { select: { name: true } } },
  });
  return toReactions(rows, actor.userId);
}

export async function updateComment(actor: ActorContext, commentId: string, body: unknown): Promise<CommentDto> {
  const existing = await prisma.comment.findFirst({
    where: { id: commentId, issue: { project: { workspaceId: actor.workspaceId } } },
    select: { id: true, authorId: true, issueId: true, issue: { select: { projectId: true } } },
  });
  if (!existing) throw notFound('Комментарий');
  if (!canEditComment(actor, existing.authorId)) throw forbidden('Редактировать можно только свои комментарии');

  const doc = sanitizeDoc(body);
  if (isDocEmpty(doc)) throw badRequest('Комментарий не может быть пустым', { body: 'Сначала напишите текст' });

  const comment = await prisma.comment.update({
    where: { id: commentId },
    data: { body: doc as never, bodyText: docToText(doc), editedAt: new Date() },
    select: commentSelect,
  });

  emit(RealtimeEventType.COMMENT_UPDATED, {
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    payload: { issueId: existing.issueId, commentId, projectId: existing.issue.projectId },
  });

  return toComment(comment, { canEdit: true, canDelete: true, viewerId: actor.userId });
}

export async function deleteComment(actor: ActorContext, commentId: string): Promise<void> {
  const existing = await prisma.comment.findFirst({
    where: { id: commentId, issue: { project: { workspaceId: actor.workspaceId } } },
    select: { id: true, authorId: true, issueId: true, issue: { select: { projectId: true } } },
  });
  if (!existing) throw notFound('Комментарий');
  if (!canDeleteComment(actor, existing.authorId)) throw forbidden('Вы не можете удалить этот комментарий');

  await prisma.$transaction(async (tx) => {
    await tx.comment.delete({ where: { id: commentId } });
    await tx.activityEvent.create({
      data: { issueId: existing.issueId, actorId: actor.userId, type: ActivityType.COMMENT_DELETED },
    });
  });

  emit(RealtimeEventType.COMMENT_DELETED, {
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    payload: { issueId: existing.issueId, commentId, projectId: existing.issue.projectId },
  });
}
