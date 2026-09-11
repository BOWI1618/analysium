import type { FastifyInstance } from 'fastify';
import { completeSprintSchema, createSprintSchema, updateSprintSchema } from '@flowdesk/contracts';
import { parse } from '../../lib/validate';
import { projectContext, workspaceContext } from '../../lib/context';
import { currentUser, requireAuth } from '../../plugins/auth';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../lib/errors';
import * as service from './service';

/** Resolves the workspace that owns a sprint so permissions can be checked. */
async function actorForSprint(userId: string, sprintId: string) {
  const sprint = await prisma.sprint.findUnique({
    where: { id: sprintId },
    select: { project: { select: { workspaceId: true, id: true } } },
  });
  if (!sprint) throw notFound('Спринт');
  const { actor } = await projectContext(userId, sprint.project.id);
  return actor;
}

export async function sprintRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/sprints', async (req) => {
    await projectContext(currentUser(req).id, req.params.projectId);
    return service.listSprints(req.params.projectId);
  });

  app.post<{ Params: { projectId: string } }>('/projects/:projectId/sprints', async (req, reply) => {
    const { actor } = await projectContext(currentUser(req).id, req.params.projectId);
    const input = parse(createSprintSchema, req.body);
    const sprint = await service.createSprint(actor, req.params.projectId, input);
    return reply.status(201).send(sprint);
  });

  app.patch<{ Params: { sprintId: string } }>('/sprints/:sprintId', async (req) => {
    const actor = await actorForSprint(currentUser(req).id, req.params.sprintId);
    const patch = parse(updateSprintSchema, req.body);
    return service.updateSprint(actor, req.params.sprintId, patch);
  });

  app.post<{ Params: { sprintId: string } }>('/sprints/:sprintId/start', async (req) => {
    const actor = await actorForSprint(currentUser(req).id, req.params.sprintId);
    return service.startSprint(actor, req.params.sprintId);
  });

  app.post<{ Params: { sprintId: string } }>('/sprints/:sprintId/complete', async (req) => {
    const actor = await actorForSprint(currentUser(req).id, req.params.sprintId);
    const { moveUnfinishedTo } = parse(completeSprintSchema, req.body ?? {});
    return service.completeSprint(actor, req.params.sprintId, moveUnfinishedTo);
  });

  app.delete<{ Params: { sprintId: string } }>('/sprints/:sprintId', async (req, reply) => {
    const actor = await actorForSprint(currentUser(req).id, req.params.sprintId);
    await service.deleteSprint(actor, req.params.sprintId);
    return reply.status(204).send();
  });

  void workspaceContext;
}
