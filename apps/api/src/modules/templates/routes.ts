/**
 * Task templates: what a «совещание» or a «согласование» consists of every
 * time, written down once.
 *
 * A template is a form filled in advance — a title, a description with its
 * checklist, subtasks, a deadline counted from the day the task is made, who
 * watches it. It creates nothing by itself: the create form takes it as a
 * starting point, and the task is then made like any other, with the same
 * checks.
 *
 * Templates belong to the workspace, not to a project: «совещание» is the
 * same thing wherever it is held. They are kept by those who may change the
 * workspace and used by everyone who can create a task.
 */
import type { FastifyInstance } from 'fastify';
import type { ActorContext, IssueTemplateDto, IssueTemplateListDto } from '@flowdesk/contracts';
import {
  Permission,
  can,
  issueTemplateSchema,
  sanitizeDoc,
  updateIssueTemplateSchema,
} from '@flowdesk/contracts';
import { Prisma } from '@prisma/client';
import { parse } from '../../lib/validate';
import { prisma } from '../../lib/prisma';
import { assertCan, workspaceContext } from '../../lib/context';
import { currentUser, requireAuth } from '../../plugins/auth';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { toUserSummary, userSummarySelect } from '../../lib/serialize';

/** A list longer than this is not a list of typical work any more. */
const TEMPLATES_PER_WORKSPACE = 50;

const canManage = (actor: ActorContext): boolean => can(actor, Permission.WORKSPACE_UPDATE);
const REFUSAL = 'Шаблоны задач ведут владелец и администраторы пространства';

type TemplateRow = Prisma.IssueTemplateGetPayload<Record<string, never>>;

async function toDtos(workspaceId: string, rows: TemplateRow[]): Promise<IssueTemplateDto[]> {
  const ids = [...new Set(rows.flatMap((row) => row.watcherIds))];
  const members = ids.length
    ? await prisma.workspaceMember.findMany({
        where: { workspaceId, userId: { in: ids } },
        select: { user: { select: userSummarySelect } },
      })
    : [];
  const byId = new Map(members.map((member) => [member.user.id, toUserSummary(member.user)!]));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    title: row.title,
    description: row.description ?? null,
    type: row.type,
    priority: row.priority,
    dueInDays: row.dueInDays,
    storyPoints: row.storyPoints,
    recurrence: row.recurrence,
    subtasks: row.subtasks,
    // Someone who has left the workspace drops out without a word: a
    // template must not subscribe a stranger to every new task.
    watchers: row.watcherIds.flatMap((id) => byId.get(id) ?? []),
  }));
}

/** Watchers named in a template have to be people of this workspace. */
async function assertMembers(workspaceId: string, userIds: string[] | undefined): Promise<void> {
  const ids = [...new Set(userIds ?? [])];
  if (ids.length === 0) return;
  const found = await prisma.workspaceMember.count({ where: { workspaceId, userId: { in: ids } } });
  if (found !== ids.length) {
    throw badRequest('Не все выбранные наблюдатели состоят в пространстве', {
      watcherIds: 'Уберите людей, которых нет в пространстве',
    });
  }
}

/** A taken name is said at the field it was typed in. */
const nameTaken = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
    ? conflict('Шаблон с таким названием уже есть', { name: 'Такое название уже занято' })
    : error;

export async function issueTemplateRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /** The caller's place in the workspace a template belongs to; an outsider learns nothing of it. */
  const find = async (userId: string, templateId: string) => {
    const template = await prisma.issueTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw notFound('Шаблон');
    try {
      return { template, actor: await workspaceContext(userId, template.workspaceId) };
    } catch {
      throw notFound('Шаблон');
    }
  };

  app.get<{ Params: { workspaceId: string } }>('/workspaces/:workspaceId/issue-templates', async (req) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    const rows = await prisma.issueTemplate.findMany({
      where: { workspaceId: actor.workspaceId },
      orderBy: { name: 'asc' },
    });
    const list: IssueTemplateListDto = { items: await toDtos(actor.workspaceId, rows), canManage: canManage(actor) };
    return list;
  });

  app.post<{ Params: { workspaceId: string } }>('/workspaces/:workspaceId/issue-templates', async (req, reply) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    assertCan(actor, Permission.WORKSPACE_UPDATE, REFUSAL);
    const input = parse(issueTemplateSchema, req.body);
    await assertMembers(actor.workspaceId, input.watcherIds);

    const existing = await prisma.issueTemplate.count({ where: { workspaceId: actor.workspaceId } });
    if (existing >= TEMPLATES_PER_WORKSPACE) {
      throw badRequest(`Шаблонов уже ${TEMPLATES_PER_WORKSPACE} — удалите ненужные, прежде чем добавлять новые`);
    }

    try {
      const row = await prisma.issueTemplate.create({
        data: {
          workspaceId: actor.workspaceId,
          name: input.name,
          title: input.title,
          description: input.description ? (sanitizeDoc(input.description) as never) : undefined,
          type: input.type as never,
          priority: input.priority as never,
          dueInDays: input.dueInDays ?? null,
          storyPoints: input.storyPoints ?? null,
          recurrence: (input.recurrence ?? null) as never,
          subtasks: input.subtasks,
          watcherIds: [...new Set(input.watcherIds)],
        },
      });
      return reply.status(201).send((await toDtos(actor.workspaceId, [row]))[0]);
    } catch (error) {
      throw nameTaken(error);
    }
  });

  app.patch<{ Params: { templateId: string } }>('/issue-templates/:templateId', async (req) => {
    const { template, actor } = await find(currentUser(req).id, req.params.templateId);
    assertCan(actor, Permission.WORKSPACE_UPDATE, REFUSAL);
    const input = parse(updateIssueTemplateSchema, req.body);
    await assertMembers(actor.workspaceId, input.watcherIds);

    try {
      const row = await prisma.issueTemplate.update({
        where: { id: template.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined
            ? { description: input.description ? (sanitizeDoc(input.description) as never) : Prisma.DbNull }
            : {}),
          ...(input.type !== undefined ? { type: input.type as never } : {}),
          ...(input.priority !== undefined ? { priority: input.priority as never } : {}),
          ...(input.dueInDays !== undefined ? { dueInDays: input.dueInDays } : {}),
          ...(input.storyPoints !== undefined ? { storyPoints: input.storyPoints } : {}),
          ...(input.recurrence !== undefined ? { recurrence: input.recurrence as never } : {}),
          ...(input.subtasks !== undefined ? { subtasks: input.subtasks } : {}),
          ...(input.watcherIds !== undefined ? { watcherIds: [...new Set(input.watcherIds)] } : {}),
        },
      });
      return (await toDtos(actor.workspaceId, [row]))[0];
    } catch (error) {
      throw nameTaken(error);
    }
  });

  app.delete<{ Params: { templateId: string } }>('/issue-templates/:templateId', async (req, reply) => {
    const { template, actor } = await find(currentUser(req).id, req.params.templateId);
    assertCan(actor, Permission.WORKSPACE_UPDATE, REFUSAL);
    await prisma.issueTemplate.delete({ where: { id: template.id } });
    return reply.status(204).send();
  });
}
