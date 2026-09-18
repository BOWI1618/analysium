import type { FastifyInstance } from 'fastify';
import {
  Permission,
  bulkUpdateSchema,
  createIssueRequestSchema,
  duplicateIssueSchema,
  issueFilterSchema,
  moveIssueSchema,
  transferIssueSchema,
  updateIssueSchema,
  watchIssueSchema,
} from '@flowdesk/contracts';
import { setWatching } from '../notifications/service';
import { parse } from '../../lib/validate';
import { assertCan, issueContext, projectContext, workspaceContext } from '../../lib/context';
import { ensureSystemProject } from '../projects/service';
import { currentUser, requireAuth } from '../../plugins/auth';
import * as service from './service';
import { transferIssue } from './transfer';
import { duplicateIssue } from './duplicate';
import { exportIssuesCsv } from './exportCsv';

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

  /** The list as a table file: every task matching the filters, subtasks included. */
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/issues/export', async (req, reply) => {
    const user = currentUser(req);
    const { actor, project } = await projectContext(user.id, req.params.projectId);
    const filter = parse(issueFilterSchema, { ...(req.query as object), projectId: req.params.projectId });
    const csv = await exportIssuesCsv(actor, filter, user.timezone);
    const filename = `${project.key}-задачи-${new Date().toISOString().slice(0, 10)}.csv`;
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .send(csv);
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

  /** To another project: new key, statuses and labels matched in the target. */
  app.post<{ Params: IssueParams }>('/issues/:issueId/transfer', async (req) => {
    const { projectId } = parse(transferIssueSchema, req.body);
    return transferIssue(currentUser(req).id, req.params.issueId, projectId);
  });

  /** A copy in the same project, with the parts chosen in the dialog. */
  app.post<{ Params: IssueParams }>('/issues/:issueId/duplicate', async (req, reply) => {
    const input = parse(duplicateIssueSchema, req.body);
    const issue = await duplicateIssue(currentUser(req).id, req.params.issueId, input);
    return reply.status(201).send(issue);
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

  /** Anyone who can open the task may follow it or stop hearing about it. */
  app.post<{ Params: IssueParams }>('/issues/:issueId/watch', async (req) => {
    const { actor } = await issueContext(currentUser(req).id, req.params.issueId);
    const { watching } = parse(watchIssueSchema, req.body);
    await setWatching(req.params.issueId, actor.userId, watching);
    return { watching };
  });

  app.get<{ Params: IssueParams }>('/issues/:issueId/activity', async (req) => {
    const { actor } = await issueContext(currentUser(req).id, req.params.issueId);
    return service.getActivity(actor, req.params.issueId);
  });
}
