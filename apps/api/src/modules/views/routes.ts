import type { FastifyInstance } from 'fastify';
import type { ActorContext, SavedViewDto } from '@flowdesk/contracts';
import { SAVED_VIEW_LAYOUTS, savedViewSchema } from '@flowdesk/contracts';
import { Prisma } from '@prisma/client';
import { parse } from '../../lib/validate';
import { prisma } from '../../lib/prisma';
import { visibleProjectIds, workspaceContext } from '../../lib/context';
import { currentUser, requireAuth } from '../../plugins/auth';
import { badRequest, forbidden, notFound } from '../../lib/errors';

/** More than this is a list nobody reads; it also keeps one person from filling the table. */
const VIEWS_PER_PERSON = 50;

const viewSelect = {
  id: true,
  name: true,
  projectId: true,
  layout: true,
  filters: true,
  display: true,
  isShared: true,
  ownerId: true,
  createdAt: true,
  owner: { select: { name: true } },
} as const;

type ViewRow = {
  id: string;
  name: string;
  projectId: string | null;
  layout: string;
  filters: unknown;
  display: unknown;
  isShared: boolean;
  ownerId: string;
  createdAt: Date;
  owner: { name: string };
};

/**
 * A view is its author's. One shown to the whole team is also the
 * administrators' to tidy up: its author may have left, and a shared list of
 * views with dead entries nobody can remove is worse than none.
 */
const canManage = (actor: ActorContext, view: { ownerId: string; isShared: boolean }) =>
  view.ownerId === actor.userId ||
  (view.isShared && (actor.workspaceRole === 'OWNER' || actor.workspaceRole === 'ADMIN'));

const toDto = (v: ViewRow, actor: ActorContext): SavedViewDto => ({
  id: v.id,
  name: v.name,
  projectId: v.projectId,
  layout: v.layout as SavedViewDto['layout'],
  filters: (v.filters ?? {}) as Record<string, unknown>,
  display: (v.display ?? null) as SavedViewDto['display'],
  isShared: v.isShared,
  ownerId: v.ownerId,
  ownerName: v.owner.name,
  canManage: canManage(actor, v),
  createdAt: v.createdAt.toISOString(),
});

/** A view of a project is only for those who can open the project. */
async function assertProjectVisible(actor: ActorContext, projectId: string | null | undefined): Promise<void> {
  if (!projectId) return;
  const allowed = await visibleProjectIds(actor);
  if (allowed !== 'ALL' && !allowed.includes(projectId)) throw notFound('Проект');
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId: actor.workspaceId },
    select: { id: true },
  });
  if (!project) throw notFound('Проект');
}

/** The view, if the actor may see it at all: their own, or one shared with the team. */
async function readableView(userId: string, viewId: string) {
  const existing = await prisma.savedView.findUnique({ where: { id: viewId }, select: { ...viewSelect, workspaceId: true } });
  if (!existing) throw notFound('Вид');
  const actor = await workspaceContext(userId, existing.workspaceId);
  // Someone else's personal view does not exist as far as this person is concerned.
  if (existing.ownerId !== actor.userId && !existing.isShared) throw notFound('Вид');
  return { existing, actor };
}

export async function savedViewRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get<{ Params: { workspaceId: string }; Querystring: { projectId?: string; layout?: string } }>(
    '/workspaces/:workspaceId/views',
    async (req) => {
      const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
      const allowed = await visibleProjectIds(actor);
      const layout = (SAVED_VIEW_LAYOUTS as readonly string[]).includes(req.query.layout ?? '') ? req.query.layout : undefined;
      const views = await prisma.savedView.findMany({
        where: {
          workspaceId: actor.workspaceId,
          // Own views plus anything a teammate shared.
          OR: [{ ownerId: actor.userId }, { isShared: true }],
          // A shared view of a project the person cannot open would give away
          // at least its name.
          ...(allowed === 'ALL' ? {} : { AND: [{ OR: [{ projectId: null }, { projectId: { in: allowed } }] }] }),
          ...(req.query.projectId ? { projectId: req.query.projectId } : {}),
          ...(layout ? { layout } : {}),
        },
        orderBy: { createdAt: 'asc' },
        select: viewSelect,
      });
      return views.map((view) => toDto(view, actor));
    },
  );

  app.post<{ Params: { workspaceId: string } }>('/workspaces/:workspaceId/views', async (req, reply) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    const input = parse(savedViewSchema, req.body);
    await assertProjectVisible(actor, input.projectId);

    const owned = await prisma.savedView.count({ where: { workspaceId: actor.workspaceId, ownerId: actor.userId } });
    if (owned >= VIEWS_PER_PERSON) {
      throw badRequest(`Сохранённых видов уже ${VIEWS_PER_PERSON} — удалите ненужные, прежде чем добавлять новые`);
    }

    const view = await prisma.savedView.create({
      data: {
        workspaceId: actor.workspaceId,
        ownerId: actor.userId,
        name: input.name,
        projectId: input.projectId ?? null,
        layout: input.layout,
        filters: input.filters as never,
        display: (input.display ?? undefined) as never,
        isShared: input.isShared,
      },
      select: viewSelect,
    });
    return reply.status(201).send(toDto(view, actor));
  });

  app.patch<{ Params: { viewId: string } }>('/views/:viewId', async (req) => {
    const { existing, actor } = await readableView(currentUser(req).id, req.params.viewId);
    if (!canManage(actor, existing)) throw forbidden('Изменить общий вид может его автор или администратор');

    const input = parse(savedViewSchema.partial(), req.body);
    const view = await prisma.savedView.update({
      where: { id: req.params.viewId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.filters !== undefined ? { filters: input.filters as never } : {}),
        ...(input.display !== undefined ? { display: (input.display ?? Prisma.DbNull) as never } : {}),
        ...(input.isShared !== undefined ? { isShared: input.isShared } : {}),
      },
      select: viewSelect,
    });
    return toDto(view, actor);
  });

  app.delete<{ Params: { viewId: string } }>('/views/:viewId', async (req, reply) => {
    const { existing, actor } = await readableView(currentUser(req).id, req.params.viewId);
    if (!canManage(actor, existing)) throw forbidden('Удалить общий вид может его автор или администратор');
    await prisma.savedView.delete({ where: { id: req.params.viewId } });
    return reply.status(204).send();
  });
}
