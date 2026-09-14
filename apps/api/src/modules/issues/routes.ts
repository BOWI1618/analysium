import type { FastifyInstance } from 'fastify';
import {
  Permission,
  bulkUpdateSchema,
  createIssueRequestSchema,
  issueFilterSchema,
  moveIssueSchema,
  updateIssueSchema,
} from '@flowdesk/contracts';
import { parse } from '../../lib/validate';
import { assertCan, issueContext, projectContext, workspaceContext } from '../../lib/context';
import { ensureSystemProject } from '../projects/service';
import { currentUser, requireAuth } from '../../plugins/auth';
import * as service from './service';

type IssueParams = { issueId: string };

export async function issueRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /** Cross-project queries: My Work, calendar, saved views. */
  app.get<{ Params: { workspaceId: string } }>('/workspaces/:workspaceId/issues', async (req) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    const filter = parse(issueFilterSchema, req.query);
    return service.listIssues(actor, filter);
  });

  app.get<{ Params: { workspaceId: string } }>('/workspaces/:workspaceId/issues/count', async (req) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    const filter = parse(issueFilterSchema, req.query);
    return { count: await service.countIssues(actor, filter) };
  });

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/issues', async (req) => {
    const { actor } = await projectContext(currentUser(req).id, req.params.projectId);
    const filter = parse(issueFilterSchema, { ...(req.query as object), projectId: req.params.projectId });
    return service.listIssues(actor, filter);
  });

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/board', async (req) => {
    const { actor } = await projectContext(currentUser(req).id, req.params.projectId);
    const filter = parse(issueFilterSchema.partial(), req.query);
    return service.getBoard(actor, req.params.projectId, filter);
  });

  app.post('/issues', async (req, reply) => {
    const { workspaceId, projectId: requestedProjectId, ...fields } = parse(createIssueRequestSchema, req.body);
    const userId = currentUser(req).id;

    // No project: the task goes to the workspace's list of tasks without one.
    // Permission is checked before that list is created, so someone who may not
    // create tasks cannot make it appear as a side effect.
    let projectId = requestedProjectId;
    if (!projectId) {
      const workspaceActor = await workspaceContext(userId, workspaceId!);
      assertCan(workspaceActor, Permission.ISSUE_CREATE);
      projectId = (await ensureSystemProject(workspaceActor.workspaceId)).id;
    }

    const { actor, project } = await projectContext(userId, projectId);
    const issue = await service.createIssue(actor, { ...fields, projectId }, project.key);
    return reply.status(201).send(issue);
  });

  app.get<{ Params: IssueParams }>('/issues/:issueId', async (req) => {
    const { actor } = await issueContext(currentUser(req).id, req.params.issueId);
    return service.getIssue(actor, req.params.issueId);
  });

  /** Lets deep links like /issue/WEB-42 resolve without knowing the id. */
  app.get<{ Params: { workspaceId: string; issueKey: string } }>(
    '/workspaces/:workspaceId/issues/by-key/:issueKey',
    async (req) => {
      const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
      return service.getIssueByKey(actor, req.params.issueKey);
    },
  );

  app.patch<{ Params: IssueParams }>('/issues/:issueId', async (req) => {
    const { actor } = await issueContext(currentUser(req).id, req.params.issueId);
    const patch = parse(updateIssueSchema, req.body);
    return service.updateIssue(actor, req.params.issueId, patch);
  });

  app.post<{ Params: IssueParams }>('/issues/:issueId/move', async (req) => {
    const { actor } = await issueContext(currentUser(req).id, req.params.issueId);
    const input = parse(moveIssueSchema, req.body);
    return service.moveIssue(actor, req.params.issueId, input);
  });

  app.post<{ Params: { workspaceId: string } }>('/workspaces/:workspaceId/issues/bulk', async (req) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    const { issueIds, patch } = parse(bulkUpdateSchema, req.body);
    return service.bulkUpdate(actor, issueIds, patch);
  });

  app.delete<{ Params: IssueParams }>('/issues/:issueId', async (req, reply) => {
    const { actor } = await issueContext(currentUser(req).id, req.params.issueId);
    await service.deleteIssue(actor, req.params.issueId, req.ip);
    return reply.status(204).send();
  });

  app.get<{ Params: IssueParams }>('/issues/:issueId/activity', async (req) => {
    const { actor } = await issueContext(currentUser(req).id, req.params.issueId);
    return service.getActivity(actor, req.params.issueId);
  });
}
