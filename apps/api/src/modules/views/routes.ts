import type { FastifyInstance } from 'fastify';
import type { SavedViewDto } from '@flowdesk/contracts';
import { savedViewSchema } from '@flowdesk/contracts';
import { parse } from '../../lib/validate';
import { prisma } from '../../lib/prisma';
import { workspaceContext } from '../../lib/context';
import { currentUser, requireAuth } from '../../plugins/auth';
import { forbidden, notFound } from '../../lib/errors';

const toDto = (v: {
  id: string;
  name: string;
  projectId: string | null;
  layout: string;
  filters: unknown;
  isShared: boolean;
  ownerId: string;
  createdAt: Date;
}): SavedViewDto => ({
  id: v.id,
  name: v.name,
  projectId: v.projectId,
  layout: v.layout as SavedViewDto['layout'],
  filters: (v.filters ?? {}) as Record<string, unknown>,
  isShared: v.isShared,
  ownerId: v.ownerId,
  createdAt: v.createdAt.toISOString(),
});

export async function savedViewRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get<{ Params: { workspaceId: string }; Querystring: { projectId?: string } }>(
    '/workspaces/:workspaceId/views',
    async (req) => {
      const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
      const views = await prisma.savedView.findMany({
        where: {
          workspaceId: actor.workspaceId,
          // Own views plus anything a teammate shared.
          OR: [{ ownerId: actor.userId }, { isShared: true }],
          ...(req.query.projectId ? { projectId: req.query.projectId } : {}),
        },
        orderBy: { createdAt: 'asc' },
      });
      return views.map(toDto);
    },
  );

  app.post<{ Params: { workspaceId: string } }>('/workspaces/:workspaceId/views', async (req, reply) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    const input = parse(savedViewSchema, req.body);
    const view = await prisma.savedView.create({
      data: {
        workspaceId: actor.workspaceId,
        ownerId: actor.userId,
        name: input.name,
        projectId: input.projectId ?? null,
        layout: input.layout,
        filters: input.filters as never,
        isShared: input.isShared,
      },
    });
    return reply.status(201).send(toDto(view));
  });

  app.patch<{ Params: { viewId: string } }>('/views/:viewId', async (req) => {
    const existing = await prisma.savedView.findUnique({ where: { id: req.params.viewId } });
    if (!existing) throw notFound('Вид');
    const actor = await workspaceContext(currentUser(req).id, existing.workspaceId);
    if (existing.ownerId !== actor.userId) throw forbidden('Изменить вид может только его автор');

    const input = parse(savedViewSchema.partial(), req.body);
    const view = await prisma.savedView.update({
      where: { id: req.params.viewId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.layout !== undefined ? { layout: input.layout } : {}),
        ...(input.filters !== undefined ? { filters: input.filters as never } : {}),
        ...(input.isShared !== undefined ? { isShared: input.isShared } : {}),
      },
    });
    return toDto(view);
  });

  app.delete<{ Params: { viewId: string } }>('/views/:viewId', async (req, reply) => {
    const existing = await prisma.savedView.findUnique({ where: { id: req.params.viewId } });
    if (!existing) throw notFound('Вид');
    const actor = await workspaceContext(currentUser(req).id, existing.workspaceId);
    if (existing.ownerId !== actor.userId) throw forbidden('Удалить вид может только его автор');
    await prisma.savedView.delete({ where: { id: req.params.viewId } });
    return reply.status(204).send();
  });
}
