import type { ActorContext, CommentDto } from '@flowdesk/contracts';
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
import { emit } from '../../realtime/eventBus';
import { commentSelect, toComment } from '../../lib/serialize';
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
      title: `You were mentioned in ${issue.issueKey}`,
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
      title: `New comment on ${issue.issueKey}`,
      body: docToText(doc).slice(0, 160),
      issueId: issue.id,
      commentId: comment.id,
    }),
  ]);

  return toComment(comment, { canEdit: true, canDelete: true });
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

  return toComment(comment, { canEdit: true, canDelete: true });
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
