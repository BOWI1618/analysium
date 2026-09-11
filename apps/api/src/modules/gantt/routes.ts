import type { FastifyInstance } from 'fastify';
import {
  createDependencySchema,
  ganttQuerySchema,
  rescheduleIssueSchema,
} from '@flowdesk/contracts';
import { parse } from '../../lib/validate';
import { issueContext, projectContext } from '../../lib/context';
import { currentUser, requireAuth } from '../../plugins/auth';
import { prisma } from '../../lib/prisma';
import { toIssueSummary, issueSummarySelect } from '../../lib/serialize';
import * as service from './service';

export async function ganttRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/gantt', async (req) => {
    const { actor } = await projectContext(currentUser(req).id, req.params.projectId);
    const query = parse(ganttQuerySchema, req.query);
    return service.getGantt(actor, req.params.projectId, query);
  });

  /** Drag or resize on the timeline. Separate from PATCH /issues/:id because it
   *  also reports the knock-on effect on dependent work. */
  app.post<{ Params: { issueId: string } }>('/issues/:issueId/reschedule', async (req) => {
    const { actor } = await issueContext(currentUser(req).id, req.params.issueId);
    const input = parse(rescheduleIssueSchema, req.body);
    const result = await service.rescheduleIssue(actor, req.params.issueId, input);

    const issue = await prisma.issue.findUniqueOrThrow({
      where: { id: req.params.issueId },
      select: issueSummarySelect,
    });

    return { issue: toIssueSummary(issue), ...result };
  });

  app.post<{ Params: { projectId: string } }>(
    '/projects/:projectId/dependencies',
    async (req, reply) => {
      const { actor } = await projectContext(currentUser(req).id, req.params.projectId);
      const input = parse(createDependencySchema, req.body);
      const dependency = await service.createDependency(actor, req.params.projectId, input);
      return reply.status(201).send(dependency);
    },
  );

  app.delete<{ Params: { dependencyId: string } }>(
    '/dependencies/:dependencyId',
    async (req, reply) => {
      const workspaceId = await resolveWorkspace(req.params.dependencyId);
      const { workspaceContext } = await import('../../lib/context');
      const actor = await workspaceContext(currentUser(req).id, workspaceId);
      await service.deleteDependency(actor, req.params.dependencyId);
      return reply.status(204).send();
    },
  );
}

/** Resolves the owning workspace so the actor can be scoped before any write. */
async function resolveWorkspace(dependencyId: string): Promise<string> {
  const { notFound } = await import('../../lib/errors');
  const row = await prisma.issueDependency.findUnique({
    where: { id: dependencyId },
    select: { predecessor: { select: { project: { select: { workspaceId: true } } } } },
  });
  if (!row) throw notFound('Связь');
  return row.predecessor.project.workspaceId;
}
