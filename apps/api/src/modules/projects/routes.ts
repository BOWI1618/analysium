import type { FastifyInstance } from 'fastify';
import {
  createLabelSchema,
  createProjectSchema,
  createStatusSchema,
  projectMemberSchema,
  reorderStatusesSchema,
  updateProjectSchema,
  updateStatusSchema,
  type ProjectRole,
} from '@flowdesk/contracts';
import { parse } from '../../lib/validate';
import { projectContext, workspaceContext } from '../../lib/context';
import { currentUser, requireAuth } from '../../plugins/auth';
import * as service from './service';

type P = { projectId: string };

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get<{ Params: { workspaceId: string }; Querystring: { includeArchived?: string } }>(
    '/workspaces/:workspaceId/projects',
    async (req) => {
      const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
      return service.listProjects(actor, { includeArchived: req.query.includeArchived === 'true' });
    },
  );

  app.post<{ Params: { workspaceId: string } }>('/workspaces/:workspaceId/projects', async (req, reply) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    const input = parse(createProjectSchema, req.body);
    const project = await service.createProject(actor, input, req.ip);
    return reply.status(201).send(project);
  });

  app.get<{ Params: P }>('/projects/:projectId', async (req) => {
    const { actor } = await projectContext(currentUser(req).id, req.params.projectId);
    return service.getProject(actor, req.params.projectId);
  });

  app.patch<{ Params: P }>('/projects/:projectId', async (req) => {
    const { actor } = await projectContext(currentUser(req).id, req.params.projectId);
    const patch = parse(updateProjectSchema, req.body);
    return service.updateProject(actor, req.params.projectId, patch, req.ip);
  });

  app.delete<{ Params: P }>('/projects/:projectId', async (req, reply) => {
    const { actor } = await projectContext(currentUser(req).id, req.params.projectId);
    await service.deleteProject(actor, req.params.projectId, req.ip);
    return reply.status(204).send();
  });

  app.post<{ Params: P }>('/projects/:projectId/favorite', async (req) => {
    await projectContext(currentUser(req).id, req.params.projectId);
    const isFavorite = await service.toggleFavorite(currentUser(req).id, req.params.projectId);
    return { isFavorite };
  });

  /* ------------------------------------------------------------ statuses */

  app.post<{ Params: P }>('/projects/:projectId/statuses', async (req, reply) => {
    const { actor } = await projectContext(currentUser(req).id, req.params.projectId);
    const input = parse(createStatusSchema, req.body);
    const status = await service.createStatus(actor, req.params.projectId, input);
    return reply.status(201).send(status);
  });

  app.patch<{ Params: P & { statusId: string } }>('/projects/:projectId/statuses/:statusId', async (req) => {
    const { actor } = await projectContext(currentUser(req).id, req.params.projectId);
    const patch = parse(updateStatusSchema, req.body);
    return service.updateStatus(actor, req.params.projectId, req.params.statusId, patch);
  });

  app.delete<{ Params: P & { statusId: string }; Querystring: { moveTo?: string } }>(
    '/projects/:projectId/statuses/:statusId',
    async (req, reply) => {
      const { actor } = await projectContext(currentUser(req).id, req.params.projectId);
      await service.deleteStatus(actor, req.params.projectId, req.params.statusId, req.query.moveTo);
      return reply.status(204).send();
    },
  );

  app.post<{ Params: P }>('/projects/:projectId/statuses/reorder', async (req, reply) => {
    const { actor } = await projectContext(currentUser(req).id, req.params.projectId);
    const { statusIds } = parse(reorderStatusesSchema, req.body);
    await service.reorderStatuses(actor, req.params.projectId, statusIds);
    return reply.status(204).send();
  });

  /* -------------------------------------------------------------- labels */

  app.get<{ Params: P }>('/projects/:projectId/labels', async (req) => {
    await projectContext(currentUser(req).id, req.params.projectId);
    return service.listLabels(req.params.projectId);
  });

  app.post<{ Params: P }>('/projects/:projectId/labels', async (req, reply) => {
    const { actor } = await projectContext(currentUser(req).id, req.params.projectId);
    const input = parse(createLabelSchema, req.body);
    const label = await service.createLabel(actor, req.params.projectId, input);
    return reply.status(201).send(label);
  });

  app.patch<{ Params: P & { labelId: string } }>('/projects/:projectId/labels/:labelId', async (req) => {
    const { actor } = await projectContext(currentUser(req).id, req.params.projectId);
    const patch = parse(createLabelSchema.partial(), req.body);
    return service.updateLabel(actor, req.params.projectId, req.params.labelId, patch);
  });

  app.delete<{ Params: P & { labelId: string } }>('/projects/:projectId/labels/:labelId', async (req, reply) => {
    const { actor } = await projectContext(currentUser(req).id, req.params.projectId);
    await service.deleteLabel(actor, req.params.projectId, req.params.labelId);
    return reply.status(204).send();
  });

  /* ------------------------------------------------------------- members */

  app.post<{ Params: P }>('/projects/:projectId/members', async (req, reply) => {
    const { actor } = await projectContext(currentUser(req).id, req.params.projectId);
    const input = parse(projectMemberSchema, req.body);
    await service.addProjectMember(actor, req.params.projectId, {
      userId: input.userId,
      role: input.role as ProjectRole,
    });
    return reply.status(204).send();
  });

  app.delete<{ Params: P & { userId: string } }>('/projects/:projectId/members/:userId', async (req, reply) => {
    const { actor } = await projectContext(currentUser(req).id, req.params.projectId);
    await service.removeProjectMember(actor, req.params.projectId, req.params.userId);
    return reply.status(204).send();
  });
}
