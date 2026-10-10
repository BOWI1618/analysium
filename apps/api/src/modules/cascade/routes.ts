import type { FastifyInstance } from 'fastify';
import { handoffSchema } from '@flowdesk/contracts';
import { parse } from '../../lib/validate';
import { workspaceContext } from '../../lib/context';
import { currentUser, requireAuth } from '../../plugins/auth';
import * as service from './service';

export async function cascadeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /** A pool with the people right below it: the caller's own, or — with `userId` — one from the caller's branch. */
  app.get<{ Params: { workspaceId: string }; Querystring: { userId?: string } }>(
    '/workspaces/:workspaceId/cascade',
    async (req) => {
      const user = currentUser(req);
      const actor = await workspaceContext(user.id, req.params.workspaceId);
      const viewed = typeof req.query.userId === 'string' && req.query.userId ? req.query.userId : undefined;
      return service.getCascade(actor, user.viewerTimezone, viewed);
    },
  );

  /** Tasks one step along the reporting line: down, sideways between direct reports, or back to oneself. */
  app.post<{ Params: { workspaceId: string } }>('/workspaces/:workspaceId/cascade/handoff', async (req) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    return service.handoff(actor, parse(handoffSchema, req.body));
  });
}
