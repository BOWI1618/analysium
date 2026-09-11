import type { FastifyInstance } from 'fastify';
import { createCommentSchema, updateCommentSchema } from '@flowdesk/contracts';
import { parse } from '../../lib/validate';
import { issueContext, workspaceContext } from '../../lib/context';
import { currentUser, requireAuth } from '../../plugins/auth';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../lib/errors';
import * as service from './service';

export async function commentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get<{ Params: { issueId: string } }>('/issues/:issueId/comments', async (req) => {
    const { actor } = await issueContext(currentUser(req).id, req.params.issueId);
    return service.listComments(actor, req.params.issueId);
  });

  app.post<{ Params: { issueId: string } }>('/issues/:issueId/comments', async (req, reply) => {
    const { actor } = await issueContext(currentUser(req).id, req.params.issueId);
    const { body } = parse(createCommentSchema, req.body);
    const issue = await prisma.issue.findUniqueOrThrow({
      where: { id: req.params.issueId },
      select: { id: true, issueKey: true, projectId: true, title: true },
    });
    const comment = await service.createComment(actor, issue, body);
    return reply.status(201).send(comment);
  });

  app.patch<{ Params: { commentId: string } }>('/comments/:commentId', async (req) => {
    const comment = await prisma.comment.findUnique({
      where: { id: req.params.commentId },
      select: { issue: { select: { project: { select: { workspaceId: true } } } } },
    });
    if (!comment) throw notFound('Комментарий');
    const actor = await workspaceContext(currentUser(req).id, comment.issue.project.workspaceId);
    const { body } = parse(updateCommentSchema, req.body);
    return service.updateComment(actor, req.params.commentId, body);
  });

  app.delete<{ Params: { commentId: string } }>('/comments/:commentId', async (req, reply) => {
    const comment = await prisma.comment.findUnique({
      where: { id: req.params.commentId },
      select: { issue: { select: { project: { select: { workspaceId: true } } } } },
    });
    if (!comment) throw notFound('Комментарий');
    const actor = await workspaceContext(currentUser(req).id, comment.issue.project.workspaceId);
    await service.deleteComment(actor, req.params.commentId);
    return reply.status(204).send();
  });
}
