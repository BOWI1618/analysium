import type { FastifyInstance } from 'fastify';
import { createDepartmentSchema, issueFilterSchema, updateDepartmentSchema } from '@flowdesk/contracts';
import { parse } from '../../lib/validate';
import { prisma } from '../../lib/prisma';
import { workspaceContext } from '../../lib/context';
import { notFound } from '../../lib/errors';
import { currentUser, requireAuth } from '../../plugins/auth';
import * as service from './service';

type DepartmentParams = { departmentId: string };

export async function departmentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /** The caller's place in the workspace a department belongs to; an outsider learns nothing of it. */
  const actorFor = async (userId: string, departmentId: string) => {
    const department = await prisma.department.findUnique({
      where: { id: departmentId },
      select: { workspaceId: true },
    });
    if (!department) throw notFound('Отдел');
    try {
      return await workspaceContext(userId, department.workspaceId);
    } catch {
      throw notFound('Отдел');
    }
  };

  app.get<{ Params: { workspaceId: string } }>('/workspaces/:workspaceId/departments', async (req) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    return service.listDepartments(actor);
  });

  app.post<{ Params: { workspaceId: string } }>('/workspaces/:workspaceId/departments', async (req, reply) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    const input = parse(createDepartmentSchema, req.body);
    return reply.status(201).send(await service.createDepartment(actor, input));
  });

  app.patch<{ Params: DepartmentParams }>('/departments/:departmentId', async (req) => {
    const actor = await actorFor(currentUser(req).id, req.params.departmentId);
    const input = parse(updateDepartmentSchema, req.body);
    return service.updateDepartment(actor, req.params.departmentId, input);
  });

  app.delete<{ Params: DepartmentParams }>('/departments/:departmentId', async (req, reply) => {
    const actor = await actorFor(currentUser(req).id, req.params.departmentId);
    await service.deleteDepartment(actor, req.params.departmentId);
    return reply.status(204).send();
  });

  /** Tasks of the department's people, within the projects the caller may open. */
  app.get<{ Params: DepartmentParams }>('/departments/:departmentId/issues', async (req) => {
    const actor = await actorFor(currentUser(req).id, req.params.departmentId);
    const filter = parse(issueFilterSchema, req.query);
    return service.departmentIssues(actor, req.params.departmentId, filter);
  });

  /** Figures per person of the department, over the same tasks. */
  app.get<{ Params: DepartmentParams }>('/departments/:departmentId/stats', async (req) => {
    const user = currentUser(req);
    const actor = await actorFor(user.id, req.params.departmentId);
    const filter = parse(issueFilterSchema, req.query);
    return { items: await service.departmentStats(actor, req.params.departmentId, filter, user.timezone) };
  });
}
