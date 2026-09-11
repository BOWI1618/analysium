import type { FastifyInstance } from 'fastify';
import type { NotificationDto } from '@flowdesk/contracts';
import { notificationQuerySchema } from '@flowdesk/contracts';
import { parse } from '../../lib/validate';
import { prisma } from '../../lib/prisma';
import { workspaceContext } from '../../lib/context';
import { currentUser, requireAuth } from '../../plugins/auth';
import { notFound } from '../../lib/errors';

const notificationSelect = {
  id: true,
  type: true,
  title: true,
  body: true,
  readAt: true,
  createdAt: true,
  workspaceId: true,
  actor: { select: { id: true, name: true, email: true, avatarUrl: true } },
  issue: { select: { id: true, issueKey: true, title: true, projectId: true } },
};

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get<{ Params: { workspaceId: string } }>('/workspaces/:workspaceId/notifications', async (req) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    const { unreadOnly, limit, cursor } = parse(notificationQuerySchema, req.query);

    const rows = await prisma.notification.findMany({
      where: {
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        ...(unreadOnly ? { readAt: null } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: notificationSelect,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    const unreadCount = await prisma.notification.count({
      where: { userId: actor.userId, workspaceId: actor.workspaceId, readAt: null },
    });

    const mapped: NotificationDto[] = items.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
      actor: n.actor,
      issue: n.issue,
      workspaceId: n.workspaceId,
    }));

    return { items: mapped, nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null, unreadCount };
  });

  app.post<{ Params: { notificationId: string } }>('/notifications/:notificationId/read', async (req, reply) => {
    const user = currentUser(req);
    // Scoped by userId so one user can never mark another's notification read.
    const result = await prisma.notification.updateMany({
      where: { id: req.params.notificationId, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count === 0) {
      const exists = await prisma.notification.findFirst({
        where: { id: req.params.notificationId, userId: user.id },
        select: { id: true },
      });
      if (!exists) throw notFound('Уведомление');
    }
    return reply.status(204).send();
  });

  app.post<{ Params: { workspaceId: string } }>(
    '/workspaces/:workspaceId/notifications/read-all',
    async (req) => {
      const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
      const result = await prisma.notification.updateMany({
        where: { userId: actor.userId, workspaceId: actor.workspaceId, readAt: null },
        data: { readAt: new Date() },
      });
      return { updated: result.count };
    },
  );

  app.delete<{ Params: { notificationId: string } }>('/notifications/:notificationId', async (req, reply) => {
    const user = currentUser(req);
    await prisma.notification.deleteMany({ where: { id: req.params.notificationId, userId: user.id } });
    return reply.status(204).send();
  });
}
