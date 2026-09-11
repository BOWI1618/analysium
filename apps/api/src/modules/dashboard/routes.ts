import type { FastifyInstance } from 'fastify';
import { projectContext, workspaceContext } from '../../lib/context';
import { currentUser, requireAuth } from '../../plugins/auth';
import * as service from './service';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get<{ Params: { projectId: string }; Querystring: { days?: string } }>(
    '/projects/:projectId/dashboard',
    async (req) => {
      const { actor } = await projectContext(currentUser(req).id, req.params.projectId);
      const days = Math.min(Math.max(Number(req.query.days ?? 30) || 30, 7), 90);
      return service.projectDashboard(actor, req.params.projectId, days);
    },
  );

  app.get<{ Params: { workspaceId: string } }>('/workspaces/:workspaceId/my-work/summary', async (req) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    return service.myWorkSummary(actor);
  });
}
