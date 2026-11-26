import type { FastifyInstance } from 'fastify';
import { dayPlanDateSchema, saveDayPlanSchema, unpublishDayPlanSchema } from '@flowdesk/contracts';
import { workspaceContext } from '../../lib/context';
import { parse } from '../../lib/validate';
import { currentUser, requireAuth } from '../../plugins/auth';
import { listDayPlans, saveDayPlan, unpublishDayPlan } from './service';

export async function dayPlanRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);
  const path = '/workspaces/:workspaceId/day-plans/:date';
  type Request = { Params: { workspaceId: string; date: string } };

  app.get<Request>(path, async (req) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    return listDayPlans(actor, parse(dayPlanDateSchema, req.params.date));
  });

  app.patch<Request>(path, async (req) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    return saveDayPlan(actor, parse(dayPlanDateSchema, req.params.date), parse(saveDayPlanSchema, req.body));
  });

  app.post<Request>(`${path}/unpublish`, async (req) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    const { revision } = parse(unpublishDayPlanSchema, req.body);
    return unpublishDayPlan(actor, parse(dayPlanDateSchema, req.params.date), revision);
  });
}
