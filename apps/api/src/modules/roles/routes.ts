import type { FastifyInstance } from 'fastify';
import { createRoleSchema, updateRoleSchema } from '@flowdesk/contracts';
import { parse } from '../../lib/validate';
import { workspaceContext } from '../../lib/context';
import { currentUser, requireAuth } from '../../plugins/auth';
import * as service from './service';

interface Params {
  workspaceId: string;
}

export async function roleRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // Everyone in the workspace reads the roles: their names stand next to people.
  app.get<{ Params: Params }>('/workspaces/:workspaceId/roles', async (req) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    return service.listRoles(actor);
  });

  app.post<{ Params: Params }>('/workspaces/:workspaceId/roles', async (req, reply) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    const input = parse(createRoleSchema, req.body);
    return reply.status(201).send(await service.createRole(actor, input, req.ip));
  });

  app.patch<{ Params: Params & { roleId: string } }>('/workspaces/:workspaceId/roles/:roleId', async (req) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    const patch = parse(updateRoleSchema, req.body);
    return service.updateRole(actor, req.params.roleId, patch, req.ip);
  });

  app.delete<{ Params: Params & { roleId: string } }>(
    '/workspaces/:workspaceId/roles/:roleId',
    async (req, reply) => {
      const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
      await service.deleteRole(actor, req.params.roleId, req.ip);
      return reply.status(204).send();
    },
  );
}
