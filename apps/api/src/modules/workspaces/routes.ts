import type { FastifyInstance } from 'fastify';
import {
  createWorkspaceSchema,
  createInviteCodeSchema,
  inviteMemberSchema,
  paginationSchema,
  updateMemberSchema,
  updateWorkspaceSchema,
  type WorkspaceRole,
} from '@flowdesk/contracts';
import { parse } from '../../lib/validate';
import { workspaceContext } from '../../lib/context';
import { currentUser, requireAuth } from '../../plugins/auth';
import * as service from './service';
import * as inviteCodes from './inviteCodes';

interface WorkspaceParams {
  workspaceId: string;
}

export async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/workspaces', async (req) => service.listWorkspaces(currentUser(req).id));

  app.post('/workspaces', async (req, reply) => {
    const input = parse(createWorkspaceSchema, req.body);
    const ws = await service.createWorkspace(currentUser(req).id, input, req.ip);
    return reply.status(201).send(ws);
  });

  app.get<{ Params: WorkspaceParams }>('/workspaces/:workspaceId', async (req) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    return service.getWorkspace(actor);
  });

  app.patch<{ Params: WorkspaceParams }>('/workspaces/:workspaceId', async (req) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    const patch = parse(updateWorkspaceSchema, req.body);
    return service.updateWorkspace(actor, patch, req.ip);
  });

  app.delete<{ Params: WorkspaceParams }>('/workspaces/:workspaceId', async (req, reply) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    await service.deleteWorkspace(actor, req.ip);
    return reply.status(204).send();
  });

  /* ------------------------------------------------------------- members */

  app.get<{ Params: WorkspaceParams }>('/workspaces/:workspaceId/members', async (req) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    return service.listMembers(actor);
  });

  app.get<{ Params: WorkspaceParams }>('/workspaces/:workspaceId/invite-codes', async (req) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    return inviteCodes.listInviteCodes(actor);
  });

  app.post<{ Params: WorkspaceParams }>('/workspaces/:workspaceId/invite-codes', async (req, reply) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    const { role } = parse(createInviteCodeSchema, req.body);
    const created = await inviteCodes.createInviteCode(actor, role as WorkspaceRole, req.ip);
    return reply.status(201).send(created);
  });

  app.delete<{ Params: WorkspaceParams & { codeId: string } }>(
    '/workspaces/:workspaceId/invite-codes/:codeId',
    async (req, reply) => {
      const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
      await inviteCodes.revokeInviteCode(actor, req.params.codeId);
      return reply.status(204).send();
    },
  );

  app.post<{ Params: WorkspaceParams }>('/workspaces/:workspaceId/members', async (req, reply) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    const input = parse(inviteMemberSchema, req.body);
    const member = await service.inviteMember(actor, input, req.ip);
    return reply.status(201).send(member);
  });

  app.patch<{ Params: WorkspaceParams & { memberId: string } }>(
    '/workspaces/:workspaceId/members/:memberId',
    async (req, reply) => {
      const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
      const { role } = parse(updateMemberSchema, req.body);
      await service.updateMemberRole(actor, req.params.memberId, role as WorkspaceRole, req.ip);
      return reply.status(204).send();
    },
  );

  app.delete<{ Params: WorkspaceParams & { memberId: string } }>(
    '/workspaces/:workspaceId/members/:memberId',
    async (req, reply) => {
      const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
      await service.removeMember(actor, req.params.memberId, req.ip);
      return reply.status(204).send();
    },
  );

  app.post<{ Params: WorkspaceParams & { memberId: string } }>(
    '/workspaces/:workspaceId/members/:memberId/reset-password',
    async (req) => {
      const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
      return service.resetMemberPassword(actor, req.params.memberId, req.ip);
    },
  );

  /* ---------------------------------------------------------- audit log */

  app.get<{ Params: WorkspaceParams }>('/workspaces/:workspaceId/audit-logs', async (req) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    const { limit, cursor } = parse(paginationSchema, req.query);
    return service.listAuditLogs(actor, limit, cursor);
  });
}
