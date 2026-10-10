/**
 * Issue service — the heart of the product.
 *
 * All writes go through here so that four invariants always hold together:
 *   1. permissions are checked server-side;
 *   2. the issue hierarchy stays valid (domain/issueRules);
 *   3. every meaningful change appends to the activity history;
 *   4. watchers get notified and a realtime event is published.
 */
import type {
  ActorContext,
  AssigneeStatsDto,
  BulkUpdateInput,
  CreateIssueInput,
  IssueDetailDto,
  IssueFilterInput,
  IssueSummaryDto,
  MoveIssueInput,
  Paginated,
  UpdateIssueInput,
} from '@flowdesk/contracts';
import {
  ActivityType,
  ISSUE_PRIORITIES,
  ISSUE_TYPES,
  NotificationType,
  Permission,
  RealtimeEventType,
  collectMentions,
  docToText,
  permissionsFor,
  rankBetween,
  sanitizeDoc,
} from '@flowdesk/contracts';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { assertCan, usersWithProjectAccess, visibleProjectIds } from '../../lib/context';
import { badRequest, conflict, notFound, AppError } from '../../lib/errors';
import { log } from '../../lib/logger';
import { emit } from '../../realtime/eventBus';
import { audit } from '../../lib/audit';
import { buildIssueWhere, dueSoonUntil, orderByFor, overdueWhere } from '../../domain/filters';
import { nextOccurrenceDates } from '../../domain/recurrence';
import {
  HIERARCHY_MESSAGES,
  diffIssue,
  exceedsWipLimit,
  formatIssueKey,
  nextCompletedAt,
  validateHierarchy,
  wouldCreateParentCycle,
} from '../../domain/issueRules';
import { issueSummarySelect, toIssueSummary, toAttachment, attachmentSelect, toSprint, sprintInclude } from '../../lib/serialize';
import { filterWorkspaceMembers, issueWatchers, notify } from '../notifications/service';

/* ----------------------------------------------------------------- read */

export async function listIssues(
  actor: ActorContext,
  filter: IssueFilterInput,
  timezone?: string,
): Promise<Paginated<IssueSummaryDto>> {
  const allowedProjectIds = await visibleProjectIds(actor);
  const where = buildIssueWhere(filter, {
    workspaceId: actor.workspaceId,
    allowedProjectIds,
    currentUserId: actor.userId,
    timezone,
  }, { priorities: ISSUE_PRIORITIES, types: ISSUE_TYPES });

  const orderBy = orderByFor(filter.sort, filter.order);

  const rows = await prisma.issue.findMany({
    where,
    orderBy,
    take: filter.limit + 1,
    ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    select: issueSummarySelect,
  });

  const hasMore = rows.length > filter.limit;
  const items = hasMore ? rows.slice(0, filter.limit) : rows;

  return {
    items: items.map(toIssueSummary),
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
  };
}

export async function countIssues(actor: ActorContext, filter: IssueFilterInput, timezone?: string): Promise<number> {
  const allowedProjectIds = await visibleProjectIds(actor);
  const where = buildIssueWhere(filter, {
    workspaceId: actor.workspaceId,
    allowedProjectIds,
    currentUserId: actor.userId,
    timezone,
  }, { priorities: ISSUE_PRIORITIES, types: ISSUE_TYPES });
  return prisma.issue.count({ where });
}

const ACTIVE_CATEGORIES = ['BACKLOG', 'UNSTARTED', 'STARTED'];

/**
 * Per person: active, overdue, due soon and done — the figures a lead looks
 * at first. Every other filter applies as given; the view switches themselves
 * (status categories by «активные/завершённые», overdue) are what is being
 * counted, so the caller leaves them out. Subtasks count: they are assigned
 * to people on their own, often to someone other than the parent's assignee.
 */
export async function assigneeStats(
  actor: ActorContext,
  filter: IssueFilterInput,
  timezone: string,
  now = new Date(),
): Promise<AssigneeStatsDto[]> {
  const ids = [
    ...new Set((filter.assigneeId ?? []).map((id) => (id === '@me' ? actor.userId : id))),
  ].filter((id) => id !== 'none' && id !== 'unassigned');
  if (ids.length === 0) return [];

  const allowedProjectIds = await visibleProjectIds(actor);
  const base = buildIssueWhere(
    { ...filter, assigneeId: ids, includeSubtasks: true, isOverdue: undefined, includeDone: undefined },
    { workspaceId: actor.workspaceId, allowedProjectIds, currentUserId: actor.userId },
    { priorities: ISSUE_PRIORITIES, types: ISSUE_TYPES },
  );
  const active: Prisma.IssueWhereInput = { status: { category: { in: ACTIVE_CATEGORIES as never } } };
  const overdue = overdueWhere(now, timezone);
  const wheres: Record<'active' | 'overdue' | 'dueSoon' | 'done', Prisma.IssueWhereInput> = {
    active: { AND: [base, active] },
    overdue: { AND: [base, active, overdue] },
    dueSoon: { AND: [base, active, { dueDate: { lte: dueSoonUntil(timezone, now) } }, { NOT: overdue }] },
    done: { AND: [base, { status: { category: 'COMPLETED' } }] },
  };

  const counted = await Promise.all(
    Object.entries(wheres).map(async ([key, where]) => {
      const rows = await prisma.issue.groupBy({ by: ['assigneeId'], where, _count: { _all: true } });
      return [key, new Map(rows.map((row) => [row.assigneeId, row._count._all]))] as const;
    }),
  );
  // A task split into estimated subtasks is measured by its parts: its own
  // estimate on top of theirs would count the same work twice.
  const estimated = await prisma.issue.groupBy({
    by: ['assigneeId'],
    where: {
      AND: [wheres.active, { NOT: { subtasks: { some: { storyPoints: { not: null }, archivedAt: null } } } }],
    },
    _sum: { storyPoints: true },
  });
  const points = new Map<string | null, number>(estimated.map((row) => [row.assigneeId, row._sum.storyPoints ?? 0]));
  const byKey = Object.fromEntries(counted) as Record<keyof typeof wheres, Map<string | null, number>>;
  return ids.map((userId) => ({
    userId,
    active: byKey.active.get(userId) ?? 0,
    overdue: byKey.overdue.get(userId) ?? 0,
    dueSoon: byKey.dueSoon.get(userId) ?? 0,
    done: byKey.done.get(userId) ?? 0,
    activePoints: points.get(userId) ?? 0,
  }));
}

export interface BoardColumn {
  status: { id: string; name: string; category: string; color: string; position: number; wipLimit: number | null };
  issues: IssueSummaryDto[];
  total: number;
  hasMore: boolean;
}

/**
 * Board data. Each column is fetched with its own LIMIT so a project with
 * thousands of done issues still renders instantly; the client loads more of a
 * column on demand.
 */
export async function getBoard(
  actor: ActorContext,
  projectId: string,
  filter: Partial<IssueFilterInput> & { perColumn?: number },
  timezone?: string,
): Promise<{ columns: BoardColumn[] }> {
  const statuses = await prisma.workflowStatus.findMany({
    where: { projectId },
    orderBy: { position: 'asc' },
    select: { id: true, name: true, category: true, color: true, position: true, wipLimit: true },
  });

  const perColumn = Math.min(filter.perColumn ?? 60, 200);
  const baseWhere = buildIssueWhere(
    { ...filter, projectId, sort: 'rank', order: 'asc', limit: perColumn },
    { workspaceId: actor.workspaceId, allowedProjectIds: 'ALL', currentUserId: actor.userId, timezone },
    { priorities: ISSUE_PRIORITIES, types: ISSUE_TYPES },
  );

  const columns = await Promise.all(
    statuses.map(async (status) => {
      const where: Prisma.IssueWhereInput = { AND: [baseWhere, { statusId: status.id }] };
      const [rows, total] = await Promise.all([
        prisma.issue.findMany({
          where,
          orderBy: [{ rank: 'asc' }, { id: 'asc' }],
          take: perColumn + 1,
          select: issueSummarySelect,
        }),
        prisma.issue.count({ where }),
      ]);
      const hasMore = rows.length > perColumn;
      return {
        status,
        issues: (hasMore ? rows.slice(0, perColumn) : rows).map(toIssueSummary),
        total,
        hasMore,
      };
    }),
  );

  return { columns };
}

export async function getIssue(actor: ActorContext, issueId: string): Promise<IssueDetailDto> {
  const issue = await prisma.issue.findFirst({
    where: { id: issueId, project: { workspaceId: actor.workspaceId } },
    select: {
      ...issueSummarySelect,
      description: true,
      parent: { select: { id: true, issueKey: true, title: true } },
      sprint: { include: sprintInclude },
      attachments: { orderBy: { createdAt: 'asc' }, select: attachmentSelect },
    },
  });
  if (!issue) throw notFound('Задача');

  const [subtasks, watchers] = await Promise.all([
    prisma.issue.findMany({
      where: { parentId: issueId, archivedAt: null },
      // In the order they were added, oldest first — a checklist, not a board
      // column where new cards land on top.
      orderBy: [{ subNumber: 'asc' }],
      select: issueSummarySelect,
    }),
    issueWatchers(issueId),
  ]);
  // Counted the way they are notified: only those who can still open the task.
  const audience = await usersWithProjectAccess(actor.workspaceId, issue.projectId, watchers);

  return {
    ...toIssueSummary(issue),
    description: issue.description,
    parent: issue.parent,
    sprint: issue.sprint ? toSprint(issue.sprint) : null,
    subtasks: subtasks.map(toIssueSummary),
    attachments: issue.attachments.map(toAttachment),
    permissions: permissionsFor(actor),
    watching: watchers.includes(actor.userId),
    watcherCount: audience.length,
  };
}

export async function getIssueByKey(actor: ActorContext, issueKey: string) {
  const key = issueKey.toUpperCase();
  let issue = await prisma.issue.findFirst({
    where: { issueKey: key, project: { workspaceId: actor.workspaceId } },
    select: { id: true, projectId: true },
  });
  // A key the issue had before it moved to another project: old links keep
  // opening it. The newest move wins if a key was ever reused.
  if (!issue) {
    const moved = await prisma.activityEvent.findFirst({
      where: {
        type: { in: [ActivityType.PROJECT_CHANGED, ActivityType.KEY_CHANGED] },
        fromValue: key,
        issue: { project: { workspaceId: actor.workspaceId } },
      },
      orderBy: { createdAt: 'desc' },
      select: { issue: { select: { id: true, projectId: true } } },
    });
    issue = moved?.issue ?? null;
  }
  if (!issue) throw notFound('Задача');

  // The lookup above is workspace-wide, so a guest could resolve any issue
  // key; hide issues in projects the actor cannot see.
  const allowed = await visibleProjectIds(actor);
  if (allowed !== 'ALL' && !allowed.includes(issue.projectId)) throw notFound('Задача');

  return getIssue(actor, issue.id);
}

export async function getActivity(actor: ActorContext, issueId: string, limit = 100) {
  const issue = await prisma.issue.findFirst({
    where: { id: issueId, project: { workspaceId: actor.workspaceId } },
    select: { id: true },
  });
  if (!issue) throw notFound('Задача');

  const { activitySelect, toActivity } = await import('../../lib/serialize');
  const rows = await prisma.activityEvent.findMany({
    where: { issueId },
    // Newest first — the timeline reads top-down like a chat.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    select: activitySelect,
  });
  return rows.map(toActivity);
}

/* ---------------------------------------------------------------- write */

/** Resolves the status an issue should land in, defaulting to the project's. */
async function resolveStatus(projectId: string, statusId?: string) {
  if (statusId) {
    const status = await prisma.workflowStatus.findFirst({
      where: { id: statusId, projectId },
      select: { id: true, category: true, name: true, wipLimit: true },
    });
    if (!status) throw badRequest('Неизвестный статус для этого проекта');
    return status;
  }
  const fallback = await prisma.workflowStatus.findFirst({
    where: { projectId },
    orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
    select: { id: true, category: true, name: true, wipLimit: true },
  });
  if (!fallback) throw badRequest('В проекте не настроены статусы');
  return fallback;
}

/** Validates parent/epic references, loading their types in one query. */
async function checkHierarchy(
  projectId: string,
  input: { issueId?: string; type: string; parentId?: string | null; epicId?: string | null },
) {
  const ids = [input.parentId, input.epicId].filter((v): v is string => Boolean(v));
  const related = ids.length
    ? await prisma.issue.findMany({
        where: { id: { in: ids }, projectId },
        select: { id: true, type: true },
      })
    : [];

  if (ids.length !== related.length) throw badRequest('Связанная задача должна быть в том же проекте');

  // One level of subtasks: a subtask's number is built from its parent's
  // (WEB-4.1), so a parent must itself be a task, and a task that already has
  // subtasks cannot become someone's subtask.
  if (input.parentId) {
    const parent = await prisma.issue.findUnique({ where: { id: input.parentId }, select: { parentId: true } });
    if (parent?.parentId) throw badRequest(HIERARCHY_MESSAGES.PARENT_CANNOT_BE_SUBTASK);
    if (input.issueId && (await prisma.issue.count({ where: { parentId: input.issueId } })) > 0) {
      throw badRequest('У задачи есть свои подзадачи — она не может стать подзадачей');
    }
  }

  const error = validateHierarchy({
    issueId: input.issueId ?? null,
    type: input.type as never,
    parentId: input.parentId ?? null,
    parentType: (related.find((r) => r.id === input.parentId)?.type ?? null) as never,
    epicId: input.epicId ?? null,
    epicType: (related.find((r) => r.id === input.epicId)?.type ?? null) as never,
  });
  if (error) throw badRequest(HIERARCHY_MESSAGES[error]);

  // The static rules cannot see stored ancestors — walk the chain to reject
  // cycles (A under B while B is already under A).
  if (input.issueId && input.parentId) {
    if (await wouldCreateParentCycle(input.issueId, input.parentId, loadParentId)) {
      throw badRequest(HIERARCHY_MESSAGES.PARENT_CYCLE);
    }
  }
}

/** Supplies the parent of an issue, one ancestor level per call. */
async function loadParentId(id: string): Promise<string | null> {
  return (await prisma.issue.findUnique({ where: { id }, select: { parentId: true } }))?.parentId ?? null;
}

async function validateLabels(projectId: string, labelIds: string[]): Promise<void> {
  if (!labelIds.length) return;
  const count = await prisma.label.count({ where: { projectId, id: { in: labelIds } } });
  if (count !== labelIds.length) throw badRequest('Неизвестная метка для этого проекта');
}

/**
 * The assignee must be able to open the issue. Workspace membership alone was
 * not enough: a guest outside the project could be handed work in a project
 * they cannot see.
 */
async function validateAssignee(
  workspaceId: string,
  projectId: string,
  assigneeId: string | null | undefined,
): Promise<void> {
  if (!assigneeId) return;
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: assigneeId } },
    select: { role: true, user: { select: { projectRoles: { where: { projectId }, select: { id: true } } } } },
  });
  if (!member) throw badRequest('Исполнитель не состоит в этом пространстве');
  if (member.role === 'GUEST' && member.user.projectRoles.length === 0) {
    throw badRequest('Гость не добавлен в этот проект и не может быть исполнителем');
  }
}

async function validateSprint(projectId: string, sprintId: string | null | undefined): Promise<void> {
  if (!sprintId) return;
  const sprint = await prisma.sprint.findFirst({ where: { id: sprintId, projectId }, select: { id: true } });
  if (!sprint) throw badRequest('Неизвестный спринт для этого проекта');
}

export async function createIssue(
  actor: ActorContext,
  input: CreateIssueInput,
  projectKey: string,
): Promise<IssueDetailDto> {
  assertCan(actor, Permission.ISSUE_CREATE);

  const status = await resolveStatus(input.projectId, input.statusId);
  await checkHierarchy(input.projectId, {
    type: input.type,
    parentId: input.parentId,
    epicId: input.epicId,
  });
  await Promise.all([
    validateLabels(input.projectId, input.labelIds ?? []),
    validateAssignee(actor.workspaceId, input.projectId, input.assigneeId),
    validateSprint(input.projectId, input.sprintId),
  ]);

  // Watchers named in the form. Checked before anything is written, and saved
  // in the same transaction as the task: a task never appears with half of them.
  const watcherIds = [...new Set(input.watcherIds ?? [])];
  if (watcherIds.some((id) => id !== actor.userId)) {
    assertCan(actor, Permission.ISSUE_UPDATE, 'Добавлять наблюдателей может тот, кто вправе изменять задачи');
  }
  if (watcherIds.length) {
    const readable = await usersWithProjectAccess(actor.workspaceId, input.projectId, watcherIds);
    if (readable.length !== watcherIds.length) {
      throw badRequest('Не у всех выбранных наблюдателей есть доступ к этому проекту', {
        watcherIds: 'Уберите людей, у которых нет доступа к проекту',
      });
    }
  }

  const description = input.description ? sanitizeDoc(input.description) : null;
  const descriptionText = description ? docToText(description) : null;

  const issue = await prisma.$transaction(async (tx) => {
    // Serialize concurrent creators on the column so two new cards never
    // compute the same top-of-column rank.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${status.id}))`;

    // New cards land at the top of their column.
    const first = await tx.issue.findFirst({
      where: { projectId: input.projectId, statusId: status.id },
      orderBy: { rank: 'asc' },
      select: { rank: true },
    });
    const rank = rankBetween(null, first?.rank ?? null);

    // Reserve the next number atomically so two concurrent creates cannot
    // produce the same issue key. A subtask is numbered after its parent
    // (WEB-4.1) and leaves the project's task numbers alone.
    let number: number;
    let subNumber = 0;
    if (input.parentId) {
      const parent = await tx.issue.update({
        where: { id: input.parentId },
        data: { subtaskCounter: { increment: 1 } },
        select: { number: true, subtaskCounter: true },
      });
      number = parent.number;
      subNumber = parent.subtaskCounter;
    } else {
      const project = await tx.project.update({
        where: { id: input.projectId },
        data: { issueCounter: { increment: 1 } },
        select: { issueCounter: true },
      });
      number = project.issueCounter;
    }

    const created = await tx.issue.create({
      data: {
        projectId: input.projectId,
        number,
        subNumber,
        issueKey: formatIssueKey(projectKey, number, subNumber),
        title: input.title,
        description: description as never,
        descriptionText,
        type: input.type as never,
        statusId: status.id,
        priority: input.priority as never,
        reporterId: actor.userId,
        assigneeId: input.assigneeId ?? null,
        parentId: input.parentId ?? null,
        epicId: input.epicId ?? null,
        sprintId: input.sprintId ?? null,
        storyPoints: input.storyPoints ?? null,
        startDate: input.startDate ? new Date(input.startDate) : null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        startHasTime: Boolean(input.startDate && input.startHasTime),
        dueHasTime: Boolean(input.dueDate && input.dueHasTime),
        isMilestone: input.isMilestone ?? false,
        // A subtask comes back with its parent, never on its own.
        recurrence: input.parentId ? null : ((input.recurrence ?? null) as never),
        rank,
        completedAt: nextCompletedAt(status.category as never, null),
        ...(input.labelIds?.length
          ? { labels: { create: input.labelIds.map((labelId) => ({ labelId })) } }
          : {}),
      },
      select: { id: true, issueKey: true, projectId: true, parentId: true },
    });

    await tx.activityEvent.create({
      data: { issueId: created.id, actorId: actor.userId, type: ActivityType.ISSUE_CREATED },
    });

    if (watcherIds.length) {
      await tx.issueSubscription.createMany({
        data: watcherIds.map((userId) => ({ issueId: created.id, userId, subscribed: true })),
      });
    }

    if (created.parentId) {
      await tx.activityEvent.create({
        data: {
          issueId: created.parentId,
          actorId: actor.userId,
          type: ActivityType.SUBTASK_CREATED,
          toValue: created.issueKey,
          metadata: { subtaskId: created.id, title: input.title },
        },
      });
    }

    return created;
  });

  emit(RealtimeEventType.ISSUE_CREATED, {
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    payload: { issueId: issue.id, issueKey: issue.issueKey, projectId: issue.projectId },
  });

  try {
    await fanoutCreate(actor, issue.id, issue.issueKey, input);
  } catch (error) {
    // A failed notification must not fail the create — the client would retry
    // and duplicate the issue.
    log.warn(error, 'issue create fan-out failed');
  }

  return getIssue(actor, issue.id);
}

/**
 * Closing a recurring task brings the next one, as Weeek does: the same
 * title, description, assignee, labels and subtasks, back in the project's
 * first column, with its dates moved forward by the rule. The rule moves over
 * to the new task and is claimed before anything is created, so closing the
 * old one again — or two people closing it at once — never makes two copies.
 */
async function continueRecurrence(actor: ActorContext, issueId: string): Promise<void> {
  const source = await prisma.issue.findUnique({
    where: { id: issueId },
    select: {
      projectId: true,
      parentId: true,
      recurrence: true,
      title: true,
      description: true,
      type: true,
      priority: true,
      assigneeId: true,
      epicId: true,
      storyPoints: true,
      startDate: true,
      dueDate: true,
      startHasTime: true,
      dueHasTime: true,
      labels: { select: { labelId: true } },
      project: { select: { key: true } },
      subtasks: {
        where: { archivedAt: null },
        orderBy: { subNumber: 'asc' },
        select: {
          title: true,
          description: true,
          priority: true,
          assigneeId: true,
          labels: { select: { labelId: true } },
        },
      },
    },
  });
  if (!source?.recurrence || source.parentId) return;

  const claimed = await prisma.issue.updateMany({
    where: { id: issueId, recurrence: { not: null } },
    data: { recurrence: null },
  });
  if (claimed.count === 0) return;

  const rule = source.recurrence;
  const dates = nextOccurrenceDates(rule, { startDate: source.startDate, dueDate: source.dueDate }, new Date());
  try {
    const next = await createIssue(
      actor,
      {
        projectId: source.projectId,
        title: source.title,
        description: (source.description as Record<string, unknown> | null) ?? null,
        type: source.type,
        priority: source.priority,
        assigneeId: source.assigneeId,
        epicId: source.epicId,
        storyPoints: source.storyPoints,
        startDate: dates.startDate?.toISOString() ?? null,
        dueDate: dates.dueDate?.toISOString() ?? null,
        startHasTime: source.startHasTime,
        dueHasTime: source.dueHasTime,
        recurrence: rule,
        labelIds: source.labels.map((l) => l.labelId),
      },
      source.project.key,
    );
    for (const subtask of source.subtasks) {
      await createIssue(
        actor,
        {
          projectId: source.projectId,
          title: subtask.title,
          description: (subtask.description as Record<string, unknown> | null) ?? null,
          type: 'SUBTASK',
          priority: subtask.priority,
          assigneeId: subtask.assigneeId,
          parentId: next.id,
          labelIds: subtask.labels.map((l) => l.labelId),
        },
        source.project.key,
      );
    }
  } catch (error) {
    // No copy was made (the assignee left the project, say): the rule goes
    // back where it was, so closing the task again tries once more.
    await prisma.issue.update({ where: { id: issueId }, data: { recurrence: rule } });
    throw error;
  }
}

/** Runs `continueRecurrence` without letting its failure fail the status change. */
async function continueRecurrenceSafely(actor: ActorContext, issueId: string): Promise<void> {
  try {
    await continueRecurrence(actor, issueId);
  } catch (error) {
    log.warn(error, 'recurring task was not continued');
  }
}

async function fanoutCreate(
  actor: ActorContext,
  issueId: string,
  issueKey: string,
  input: CreateIssueInput,
): Promise<void> {
  const jobs: Promise<void>[] = [];

  if (input.assigneeId) {
    jobs.push(
      notify({
        userIds: [input.assigneeId],
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        type: NotificationType.ISSUE_ASSIGNED,
        title: `${issueKey} назначена на вас`,
        body: input.title,
        issueId,
      }),
    );
  }

  const mentions = collectMentions(input.description);
  if (mentions.length) {
    jobs.push(
      filterWorkspaceMembers(actor.workspaceId, mentions).then((ids) =>
        notify({
          userIds: ids,
          workspaceId: actor.workspaceId,
          actorId: actor.userId,
          type: NotificationType.ISSUE_MENTIONED,
          title: `Вас упомянули в ${issueKey}`,
          body: input.title,
          issueId,
        }),
      ),
    );
  }

  await Promise.all(jobs);
}

export async function updateIssue(
  actor: ActorContext,
  issueId: string,
  patch: UpdateIssueInput,
): Promise<IssueDetailDto> {
  assertCan(actor, Permission.ISSUE_UPDATE);

  const before = await prisma.issue.findFirst({
    where: { id: issueId, project: { workspaceId: actor.workspaceId } },
    select: {
      id: true,
      projectId: true,
      issueKey: true,
      title: true,
      statusId: true,
      priority: true,
      type: true,
      assigneeId: true,
      epicId: true,
      sprintId: true,
      parentId: true,
      storyPoints: true,
      startDate: true,
      dueDate: true,
      isMilestone: true,
      descriptionText: true,
      completedAt: true,
      status: { select: { id: true, name: true, category: true } },
      labels: { select: { labelId: true } },
      project: { select: { key: true } },
    },
  });
  if (!before) throw notFound('Задача');

  if (patch.assigneeId !== undefined && patch.assigneeId !== before.assigneeId) {
    assertCan(actor, Permission.ISSUE_ASSIGN);
  }

  const nextType = (patch.type ?? before.type) as string;
  if (patch.parentId !== undefined || patch.epicId !== undefined || patch.type !== undefined) {
    await checkHierarchy(before.projectId, {
      issueId,
      type: nextType,
      parentId: patch.parentId !== undefined ? patch.parentId : before.parentId,
      epicId: patch.epicId !== undefined ? patch.epicId : before.epicId,
    });
  }

  await Promise.all([
    patch.labelIds ? validateLabels(before.projectId, patch.labelIds) : Promise.resolve(),
    validateAssignee(actor.workspaceId, before.projectId, patch.assigneeId),
    validateSprint(before.projectId, patch.sprintId),
  ]);

  const data: Prisma.IssueUpdateInput = {};
  const after: Record<string, unknown> = {};

  if (patch.title !== undefined) {
    data.title = patch.title;
    after.title = patch.title;
  }
  if (patch.description !== undefined) {
    const doc = patch.description ? sanitizeDoc(patch.description) : null;
    data.description = doc as never;
    data.descriptionText = doc ? docToText(doc) : null;
    after.descriptionText = data.descriptionText;
  }
  if (patch.type !== undefined) {
    data.type = patch.type as never;
    after.type = patch.type;
  }
  if (patch.priority !== undefined) {
    data.priority = patch.priority as never;
    after.priority = patch.priority;
  }
  if (patch.storyPoints !== undefined) {
    data.storyPoints = patch.storyPoints;
    after.storyPoints = patch.storyPoints;
  }
  // A new date without a word about its time is a whole-day date; the flag can
  // also change on its own (a time added to or removed from the same day).
  if (patch.dueDate !== undefined) {
    data.dueDate = patch.dueDate ? new Date(patch.dueDate) : null;
    after.dueDate = data.dueDate;
    data.dueHasTime = Boolean(patch.dueDate && patch.dueHasTime);
    // A deadline set by hand starts the carry-over count again.
    data.carriedOverDays = 0;
  } else if (patch.dueHasTime !== undefined) {
    data.dueHasTime = patch.dueHasTime;
  }
  if (patch.startDate !== undefined) {
    data.startDate = patch.startDate ? new Date(patch.startDate) : null;
    after.startDate = data.startDate;
    data.startHasTime = Boolean(patch.startDate && patch.startHasTime);
  } else if (patch.startHasTime !== undefined) {
    data.startHasTime = patch.startHasTime;
  }
  if (patch.isMilestone !== undefined) {
    data.isMilestone = patch.isMilestone;
  }
  if (patch.recurrence !== undefined) {
    if (patch.recurrence && (patch.parentId !== undefined ? patch.parentId : before.parentId)) {
      throw badRequest('Подзадача повторяется вместе с родительской задачей');
    }
    data.recurrence = (patch.recurrence ?? null) as never;
  }
  if (patch.setBaseline) {
    // Freeze the plan as it stands right now, so the chart can show drift.
    const start = patch.startDate !== undefined ? data.startDate : before.startDate;
    const end = patch.dueDate !== undefined ? data.dueDate : before.dueDate;
    data.baselineStartDate = (start ?? null) as Date | null;
    data.baselineDueDate = (end ?? null) as Date | null;
  }
  if (patch.assigneeId !== undefined) {
    data.assignee = patch.assigneeId ? { connect: { id: patch.assigneeId } } : { disconnect: true };
    after.assigneeId = patch.assigneeId;
  }
  if (patch.parentId !== undefined) {
    data.parent = patch.parentId ? { connect: { id: patch.parentId } } : { disconnect: true };
    after.parentId = patch.parentId;
  }
  if (patch.epicId !== undefined) {
    data.epic = patch.epicId ? { connect: { id: patch.epicId } } : { disconnect: true };
    after.epicId = patch.epicId;
  }
  if (patch.sprintId !== undefined) {
    data.sprint = patch.sprintId ? { connect: { id: patch.sprintId } } : { disconnect: true };
    after.sprintId = patch.sprintId;
  }

  let newStatus: { id: string; name: string; category: string } | null = null;
  if (patch.statusId !== undefined && patch.statusId !== before.statusId) {
    const status = await resolveStatus(before.projectId, patch.statusId);
    newStatus = status;
    data.status = { connect: { id: status.id } };
    data.completedAt = nextCompletedAt(status.category as never, before.completedAt);
    after.statusId = status.id;
  }

  const changes = diffIssue(before as never, after as never);

  // `diffIssue` covers the shared field map; startDate is Gantt-specific and is
  // recorded here so the timeline and the activity feed never disagree.
  if (patch.startDate !== undefined) {
    const from = before.startDate ? before.startDate.toISOString() : null;
    const to = data.startDate ? (data.startDate as Date).toISOString() : null;
    if (from !== to) {
      changes.push({
        type: ActivityType.DUE_DATE_CHANGED,
        field: 'startDate',
        fromValue: from,
        toValue: to,
      });
    }
  }

  // Label changes are diffed separately since they live in a join table.
  const labelChanges: { added: string[]; removed: string[] } = { added: [], removed: [] };
  if (patch.labelIds) {
    const currentIds = before.labels.map((l) => l.labelId);
    labelChanges.added = patch.labelIds.filter((id) => !currentIds.includes(id));
    labelChanges.removed = currentIds.filter((id) => !patch.labelIds!.includes(id));
  }

  const parentChanged = patch.parentId !== undefined && patch.parentId !== before.parentId;
  let issueKey = before.issueKey;

  await prisma.$transaction(async (tx) => {
    // A new parent means a new number: WEB-4.1 under WEB-4, and back to a
    // task number of its own when the issue stops being a subtask.
    if (parentChanged) {
      let number: number;
      let subNumber = 0;
      if (patch.parentId) {
        const parent = await tx.issue.update({
          where: { id: patch.parentId },
          data: { subtaskCounter: { increment: 1 } },
          select: { number: true, subtaskCounter: true },
        });
        number = parent.number;
        subNumber = parent.subtaskCounter;
      } else {
        const project = await tx.project.update({
          where: { id: before.projectId },
          data: { issueCounter: { increment: 1 } },
          select: { issueCounter: true },
        });
        number = project.issueCounter;
      }
      issueKey = formatIssueKey(before.project.key, number, subNumber);
      data.number = number;
      data.subNumber = subNumber;
      data.issueKey = issueKey;
    }

    if (Object.keys(data).length > 0) {
      await tx.issue.update({ where: { id: issueId }, data });
    }

    if (issueKey !== before.issueKey) {
      await tx.activityEvent.create({
        data: {
          issueId,
          actorId: actor.userId,
          type: ActivityType.KEY_CHANGED,
          field: 'issueKey',
          fromValue: before.issueKey,
          toValue: issueKey,
        },
      });
    }

    if (patch.labelIds) {
      if (labelChanges.removed.length) {
        await tx.issueLabel.deleteMany({ where: { issueId, labelId: { in: labelChanges.removed } } });
      }
      if (labelChanges.added.length) {
        await tx.issueLabel.createMany({
          data: labelChanges.added.map((labelId) => ({ issueId, labelId })),
          skipDuplicates: true,
        });
      }
    }

    const rows: Prisma.ActivityEventCreateManyInput[] = changes.map((c) => ({
      issueId,
      actorId: actor.userId,
      type: c.type,
      field: c.field,
      fromValue: c.fromValue,
      toValue: c.toValue,
      metadata: (c.metadata ?? null) as never,
    }));

    if (labelChanges.added.length || labelChanges.removed.length) {
      const labels = await tx.label.findMany({
        where: { id: { in: [...labelChanges.added, ...labelChanges.removed] } },
        select: { id: true, name: true },
      });
      const nameOf = new Map(labels.map((l) => [l.id, l.name]));
      for (const id of labelChanges.added) {
        rows.push({ issueId, actorId: actor.userId, type: ActivityType.LABEL_ADDED, field: 'labels', toValue: nameOf.get(id) ?? id });
      }
      for (const id of labelChanges.removed) {
        rows.push({ issueId, actorId: actor.userId, type: ActivityType.LABEL_REMOVED, field: 'labels', fromValue: nameOf.get(id) ?? id });
      }
    }

    if (rows.length) await tx.activityEvent.createMany({ data: rows });
  });

  emit(RealtimeEventType.ISSUE_UPDATED, {
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    payload: {
      issueId,
      issueKey,
      projectId: before.projectId,
      patch: after as Record<string, unknown>,
    },
  });

  if (newStatus) {
    emit(RealtimeEventType.ISSUE_STATUS_CHANGED, {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      payload: {
        issueId,
        issueKey: before.issueKey,
        projectId: before.projectId,
        fromStatusId: before.statusId,
        toStatusId: newStatus.id,
      },
    });
  }

  try {
    await fanoutUpdate(actor, { ...before, newStatus }, patch);
  } catch (error) {
    // A failed notification must not fail the update — the client would retry
    // and repeat the change.
    log.warn(error, 'issue update fan-out failed');
  }

  if (newStatus?.category === 'COMPLETED' && before.status.category !== 'COMPLETED') {
    await continueRecurrenceSafely(actor, issueId);
  }

  return getIssue(actor, issueId);
}

/** What actually changed on one issue, as far as the people following it care. */
interface IssueChanges {
  /** Only when the assignee really changed; `to: null` means the task was left without one. */
  assignee?: { from: string | null; to: string | null };
  /** The status the issue has just entered. */
  status?: { name: string };
  /** Only when the deadline really moved; `to: null` means it was removed. */
  dueDate?: { to: Date | null };
}

const sameInstant = (a: Date | null | undefined, b: Date | null | undefined): boolean =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * One notice per event and per person. Shared by the card and the selection
 * bar, so a change made to twenty tasks at once is heard exactly like the
 * same change made to each of them.
 */
async function announceChanges(
  actor: ActorContext,
  issue: { id: string; issueKey: string; title: string },
  changes: IssueChanges,
): Promise<void> {
  const common = { workspaceId: actor.workspaceId, actorId: actor.userId, body: issue.title, issueId: issue.id };
  const jobs: Promise<void>[] = [];

  if (changes.assignee) {
    const { from, to } = changes.assignee;
    if (to) {
      jobs.push(
        notify({ ...common, userIds: [to], type: NotificationType.ISSUE_ASSIGNED, title: `${issue.issueKey} назначена на вас` }),
      );
    }
    // Everyone following the task — and the person it was just taken from —
    // hears who has it now. The new assignee got the personal notice above
    // and is left out here, so being both assignee and watcher is one ping.
    jobs.push(
      Promise.all([
        issueWatchers(issue.id, [from]),
        to ? prisma.user.findUnique({ where: { id: to }, select: { name: true } }) : null,
      ]).then(([watchers, assignee]) =>
        notify({
          ...common,
          userIds: watchers.filter((id) => id !== to),
          type: to ? NotificationType.ISSUE_ASSIGNED : NotificationType.ISSUE_UNASSIGNED,
          title: to
            ? `${issue.issueKey}: исполнитель — ${assignee?.name ?? 'другой участник'}`
            : `${issue.issueKey}: исполнитель снят`,
        }),
      ),
    );
  }

  if (changes.status || changes.dueDate) {
    jobs.push(
      issueWatchers(issue.id).then(async (watchers) => {
        if (changes.status) {
          await notify({
            ...common,
            userIds: watchers,
            type: NotificationType.ISSUE_STATUS_CHANGED,
            title: `${issue.issueKey} → ${changes.status.name}`,
          });
        }
        if (changes.dueDate) {
          const due = changes.dueDate.to;
          await notify({
            ...common,
            userIds: watchers,
            type: NotificationType.ISSUE_DUE_DATE_CHANGED,
            title: `Изменился срок у ${issue.issueKey}`,
            // The product is Russian throughout, so the date in a notification
            // is written the way the rest of the interface writes dates.
            body: due
              ? `${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(due)} — ${issue.title}`
              : `Срок снят — ${issue.title}`,
          });
        }
      }),
    );
  }

  await Promise.all(jobs);
}

async function fanoutUpdate(
  actor: ActorContext,
  before: {
    id: string;
    issueKey: string;
    title: string;
    assigneeId: string | null;
    dueDate: Date | null;
    status: { name: string };
    newStatus: { name: string } | null;
  },
  patch: UpdateIssueInput,
): Promise<void> {
  const jobs: Promise<void>[] = [];
  const nextDue = patch.dueDate ? new Date(patch.dueDate) : null;

  // Saving the same value is not news: only real changes are announced.
  jobs.push(
    announceChanges(
      actor,
      { id: before.id, issueKey: before.issueKey, title: patch.title ?? before.title },
      {
        assignee:
          patch.assigneeId !== undefined && (patch.assigneeId ?? null) !== before.assigneeId
            ? { from: before.assigneeId, to: patch.assigneeId ?? null }
            : undefined,
        status: before.newStatus ?? undefined,
        dueDate: patch.dueDate !== undefined && !sameInstant(before.dueDate, nextDue) ? { to: nextDue } : undefined,
      },
    ),
  );

  if (patch.description !== undefined) {
    const mentions = collectMentions(patch.description);
    if (mentions.length) {
      jobs.push(
        filterWorkspaceMembers(actor.workspaceId, mentions).then((ids) =>
          notify({
            userIds: ids,
            workspaceId: actor.workspaceId,
            actorId: actor.userId,
            type: NotificationType.ISSUE_MENTIONED,
            title: `Вас упомянули в ${before.issueKey}`,
            body: patch.title ?? before.title,
            issueId: before.id,
          }),
        ),
      );
    }
  }

  await Promise.all(jobs);
}

/**
 * Drag & drop. The client sends the neighbours it dropped between; the server
 * recomputes the rank so two concurrent drags cannot corrupt the ordering.
 */
export async function moveIssue(
  actor: ActorContext,
  issueId: string,
  input: MoveIssueInput,
): Promise<IssueSummaryDto> {
  assertCan(actor, Permission.ISSUE_MOVE);

  const issue = await prisma.issue.findFirst({
    where: { id: issueId, project: { workspaceId: actor.workspaceId } },
    select: {
      id: true,
      projectId: true,
      issueKey: true,
      statusId: true,
      sprintId: true,
      completedAt: true,
      title: true,
      status: { select: { name: true, category: true } },
    },
  });
  if (!issue) throw notFound('Задача');

  const targetStatusId = input.statusId ?? issue.statusId;
  const status = await resolveStatus(issue.projectId, targetStatusId);
  const isEntering = targetStatusId !== issue.statusId;

  if (isEntering) {
    const count = await prisma.issue.count({
      where: { projectId: issue.projectId, statusId: status.id, archivedAt: null, parentId: null },
    });
    if (exceedsWipLimit({ id: status.id, name: status.name, category: status.category as never, wipLimit: status.wipLimit }, count, true)) {
      throw conflict(`"${status.name}" has reached its WIP limit of ${status.wipLimit}`);
    }
  }

  if (input.sprintId !== undefined) await validateSprint(issue.projectId, input.sprintId);

  const data: Prisma.IssueUpdateInput = {};
  if (isEntering) {
    data.status = { connect: { id: status.id } };
    data.completedAt = nextCompletedAt(status.category as never, issue.completedAt);
  }
  if (input.sprintId !== undefined) {
    data.sprint = input.sprintId ? { connect: { id: input.sprintId } } : { disconnect: true };
  }

  const rank = await prisma.$transaction(async (tx) => {
    // Serialize rank recomputation per column so concurrent moves cannot
    // compute the same rank between the same neighbours. A move touching two
    // columns locks both, in a deterministic order, to avoid deadlocks.
    const lockKeys = [...new Set([issue.statusId, status.id])].sort();
    for (const key of lockKeys) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    }

    const neighbours = await tx.issue.findMany({
      where: {
        id: { in: [input.beforeId, input.afterId].filter((v): v is string => Boolean(v)) },
        // Neighbours must belong to the target column; a neighbour from
        // another column (or a stale id) is ignored, falling back to the edge.
        statusId: status.id,
      },
      select: { id: true, rank: true },
    });
    const beforeRank = neighbours.find((n) => n.id === input.beforeId)?.rank ?? null;
    const afterRank = neighbours.find((n) => n.id === input.afterId)?.rank ?? null;

    let rank: string;
    try {
      rank = rankBetween(beforeRank, afterRank);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      // Neighbours arrived out of order (stale client state) — append instead of failing.
      const last = await tx.issue.findFirst({
        where: { projectId: issue.projectId, statusId: status.id },
        orderBy: { rank: 'desc' },
        select: { rank: true },
      });
      rank = rankBetween(last?.rank ?? null, null);
    }

    await tx.issue.update({ where: { id: issueId }, data: { ...data, rank } });

    if (isEntering) {
      await tx.activityEvent.create({
        data: {
          issueId,
          actorId: actor.userId,
          type: ActivityType.STATUS_CHANGED,
          field: 'statusId',
          fromValue: issue.statusId,
          toValue: status.id,
          metadata: { from: issue.status.name, to: status.name },
        },
      });
    }

    // A sprint change via drag & drop is recorded just like the PATCH path.
    if (input.sprintId !== undefined && input.sprintId !== issue.sprintId) {
      await tx.activityEvent.create({
        data: {
          issueId,
          actorId: actor.userId,
          type: ActivityType.SPRINT_CHANGED,
          field: 'sprintId',
          fromValue: issue.sprintId,
          toValue: input.sprintId,
        },
      });
    }

    return rank;
  });

  emit(RealtimeEventType.ISSUE_MOVED, {
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    payload: {
      issueId,
      issueKey: issue.issueKey,
      projectId: issue.projectId,
      statusId: status.id,
      rank,
    },
  });

  if (isEntering) {
    try {
      await announceChanges(actor, { id: issueId, issueKey: issue.issueKey, title: issue.title }, { status: { name: status.name } });
    } catch (error) {
      // A failed notification must not fail the move.
      log.warn(error, 'move notification failed');
    }
  }

  if (isEntering && status.category === 'COMPLETED' && issue.status.category !== 'COMPLETED') {
    await continueRecurrenceSafely(actor, issueId);
  }

  const updated = await prisma.issue.findUniqueOrThrow({ where: { id: issueId }, select: issueSummarySelect });
  return toIssueSummary(updated);
}

const handedOnMessage = (keys: string[]) =>
  `${keys.join(', ')}: пока вы передавали, задачу изменили или уже передали другому. Список обновлён — проверьте и повторите.`;

export async function bulkUpdate(
  actor: ActorContext,
  issueIds: string[],
  patch: BulkUpdateInput['patch'],
  options: {
    onlyUnassigned?: boolean;
    /**
     * Handing tasks over: the assignee — and, where given, the version — the
     * sender saw for each task. A task that has since moved on fails the
     * whole batch instead of having someone else's assignment overwritten.
     */
    expected?: Map<string, { assigneeId: string | null; updatedAt?: Date }>;
  } = {},
): Promise<{ updated: number }> {
  const ids = [...new Set(issueIds)];

  // Scope to issues the caller can actually reach — never trust the id list.
  const allowed = await visibleProjectIds(actor);
  const issues = await prisma.issue.findMany({
    where: {
      id: { in: ids },
      project: { workspaceId: actor.workspaceId },
      ...(allowed === 'ALL' ? {} : { projectId: { in: allowed } }),
    },
    select: {
      id: true,
      projectId: true,
      statusId: true,
      issueKey: true,
      title: true,
      completedAt: true,
      type: true,
      parentId: true,
      priority: true,
      assigneeId: true,
      sprintId: true,
      epicId: true,
      dueDate: true,
      dueHasTime: true,
      status: { select: { name: true, category: true } },
      labels: { select: { labelId: true } },
    },
  });
  // All or nothing, and without naming what is missing: an id that does not
  // resolve may be a task the caller must not learn anything about, and
  // quietly changing the rest would leave a half-applied batch nobody chose.
  if (issues.length !== ids.length) {
    throw new AppError('NOT_FOUND', 'Часть выбранных задач удалена или недоступна. Обновите список и выберите снова.');
  }

  const projectIds = [...new Set(issues.map((i) => i.projectId))];
  const nextAssignee = patch.assigneeId === undefined ? undefined : (patch.assigneeId ?? null);

  // Permissions per project, exactly as the card checks them: a project role
  // can grant what the workspace role does not — a guest who contributes to
  // one project — and the workspace role alone used to refuse such a person
  // here while the card let them make the very same change.
  const projectRoles = await prisma.projectMember.findMany({
    where: { userId: actor.userId, projectId: { in: projectIds } },
    select: { projectId: true, role: true },
  });
  const roleIn = new Map(projectRoles.map((r) => [r.projectId, r.role]));
  for (const projectId of projectIds) {
    const projectActor: ActorContext = { ...actor, projectRole: (roleIn.get(projectId) ?? null) as never };
    assertCan(projectActor, Permission.ISSUE_UPDATE);
    const reassigns =
      nextAssignee !== undefined && issues.some((i) => i.projectId === projectId && i.assigneeId !== nextAssignee);
    if (reassigns) assertCan(projectActor, Permission.ISSUE_ASSIGN);
  }

  if (options.expected && nextAssignee !== undefined) {
    const moved = issues.filter((i) => {
      const seen = options.expected!.get(i.id);
      return seen !== undefined && seen.assigneeId !== i.assigneeId;
    });
    if (moved.length) throw conflict(handedOnMessage(moved.map((i) => i.issueKey)));
  }

  if (options.onlyUnassigned && nextAssignee !== undefined) {
    const taken = issues.filter((i) => i.assigneeId && i.assigneeId !== nextAssignee);
    if (taken.length) {
      throw conflict(
        `Уже назначены другим людям: ${taken.map((i) => i.issueKey).join(', ')}. Обновите список и выберите снова.`,
      );
    }
  }

  if (patch.statusId && projectIds.length > 1) {
    throw badRequest('Массово менять статус можно только в пределах одного проекта');
  }

  const status = patch.statusId ? await resolveStatus(projectIds[0]!, patch.statusId) : null;
  // Per project: a guest may belong to one of the selected issues' projects and not another.
  if (nextAssignee) {
    await Promise.all(projectIds.map((pid) => validateAssignee(actor.workspaceId, pid, nextAssignee)));
  }

  // Reject cross-project links exactly like single-issue updates do: sprints
  // and labels per project, hierarchy per issue.
  const touchedLabelIds = [...(patch.addLabelIds ?? []), ...(patch.removeLabelIds ?? [])];
  for (const projectId of projectIds) {
    await validateSprint(projectId, patch.sprintId);
    await validateLabels(projectId, touchedLabelIds);
  }
  if (patch.epicId !== undefined) {
    for (const issue of issues) {
      try {
        await checkHierarchy(issue.projectId, {
          issueId: issue.id,
          type: issue.type,
          parentId: issue.parentId,
          epicId: patch.epicId,
        });
      } catch (error) {
        // Say which row failed so the caller can find it in the selection.
        if (error instanceof AppError) throw badRequest(`${issue.issueKey}: ${error.message}`);
        throw error;
      }
    }
  }

  // WIP limits are enforced on entry, like moveIssue. The count is not atomic
  // against concurrent moves — a known, accepted limitation (same as moveIssue).
  if (status) {
    const entering = issues.filter((i) => i.statusId !== status.id).length;
    if (entering > 0) {
      const current = await prisma.issue.count({
        where: { projectId: projectIds[0]!, statusId: status.id, archivedAt: null, parentId: null },
      });
      if (
        exceedsWipLimit(
          { id: status.id, name: status.name, category: status.category as never, wipLimit: status.wipLimit },
          current + entering - 1,
          true,
        )
      ) {
        throw conflict(`"${status.name}" has reached its WIP limit of ${status.wipLimit}`);
      }
    }
  }

  const nextDue = patch.dueDate === undefined ? undefined : patch.dueDate ? new Date(patch.dueDate) : null;
  const nextDueHasTime = Boolean(patch.dueDate && patch.dueHasTime);

  const now = new Date();
  const announcements: { issue: (typeof issues)[number]; changes: IssueChanges }[] = [];
  let changed = 0;

  await prisma.$transaction(async (tx) => {
    for (const issue of issues) {
      const data: Prisma.IssueUpdateInput = {};
      // The same field map the card uses, so the history of a task does not
      // depend on whether it was changed alone or together with others.
      const after: Record<string, unknown> = {};
      const changes: IssueChanges = {};

      if (status && status.id !== issue.statusId) {
        data.status = { connect: { id: status.id } };
        data.completedAt = nextCompletedAt(status.category as never, issue.completedAt, now);
        after.statusId = status.id;
        changes.status = { name: status.name };
      }
      if (patch.priority && patch.priority !== issue.priority) {
        data.priority = patch.priority as never;
        after.priority = patch.priority;
      }
      if (nextAssignee !== undefined && nextAssignee !== issue.assigneeId) {
        const seen = options.expected?.get(issue.id);
        if (seen) {
          // Claimed under the row lock against what the sender saw: a task
          // reassigned or edited a moment ago fails the batch, nothing is saved.
          const claimed = await tx.issue.updateMany({
            where: {
              id: issue.id,
              assigneeId: seen.assigneeId,
              ...(seen.updatedAt ? { updatedAt: seen.updatedAt } : {}),
            },
            data: { assigneeId: nextAssignee },
          });
          if (claimed.count === 0) throw conflict(handedOnMessage([issue.issueKey]));
        } else if (options.onlyUnassigned) {
          // Claimed under the row lock: if someone took the task after the
          // check above, nothing in this batch is saved.
          const claimed = await tx.issue.updateMany({
            where: { id: issue.id, assigneeId: null },
            data: { assigneeId: nextAssignee },
          });
          if (claimed.count === 0) {
            throw conflict(`Задачу ${issue.issueKey} уже назначили. Обновите список и выберите снова.`);
          }
        } else {
          data.assignee = nextAssignee ? { connect: { id: nextAssignee } } : { disconnect: true };
        }
        after.assigneeId = nextAssignee;
        changes.assignee = { from: issue.assigneeId, to: nextAssignee };
      }
      if (patch.sprintId !== undefined && (patch.sprintId ?? null) !== issue.sprintId) {
        data.sprint = patch.sprintId ? { connect: { id: patch.sprintId } } : { disconnect: true };
        after.sprintId = patch.sprintId;
      }
      if (patch.epicId !== undefined && (patch.epicId ?? null) !== issue.epicId) {
        data.epic = patch.epicId ? { connect: { id: patch.epicId } } : { disconnect: true };
        after.epicId = patch.epicId;
      }
      if (nextDue !== undefined && (!sameInstant(issue.dueDate, nextDue) || issue.dueHasTime !== nextDueHasTime)) {
        data.dueDate = nextDue;
        data.dueHasTime = nextDueHasTime;
        // A deadline set by hand starts the carry-over count again, as in the card.
        data.carriedOverDays = 0;
        after.dueDate = nextDue;
        if (!sameInstant(issue.dueDate, nextDue)) changes.dueDate = { to: nextDue };
      }

      const activity: Prisma.ActivityEventCreateManyInput[] = diffIssue(issue as never, after as never).map((c) => ({
        issueId: issue.id,
        actorId: actor.userId,
        type: c.type,
        field: c.field,
        fromValue: c.fromValue,
        toValue: c.toValue,
        metadata: (c.type === ActivityType.STATUS_CHANGED && status
          ? { from: issue.status.name, to: status.name }
          : (c.metadata ?? null)) as never,
      }));

      const current = new Set(issue.labels.map((l) => l.labelId));
      const removed = (patch.removeLabelIds ?? []).filter((id) => current.has(id));
      const added = (patch.addLabelIds ?? []).filter((id) => !current.has(id) && !removed.includes(id));
      if (removed.length) await tx.issueLabel.deleteMany({ where: { issueId: issue.id, labelId: { in: removed } } });
      if (added.length) {
        await tx.issueLabel.createMany({ data: added.map((labelId) => ({ issueId: issue.id, labelId })), skipDuplicates: true });
      }
      if (added.length || removed.length) {
        const labels = await tx.label.findMany({ where: { id: { in: [...added, ...removed] } }, select: { id: true, name: true } });
        const nameOf = new Map(labels.map((l) => [l.id, l.name]));
        for (const id of added) {
          activity.push({ issueId: issue.id, actorId: actor.userId, type: ActivityType.LABEL_ADDED, field: 'labels', toValue: nameOf.get(id) ?? id });
        }
        for (const id of removed) {
          activity.push({ issueId: issue.id, actorId: actor.userId, type: ActivityType.LABEL_REMOVED, field: 'labels', fromValue: nameOf.get(id) ?? id });
        }
      }

      if (Object.keys(data).length) await tx.issue.update({ where: { id: issue.id }, data });
      if (activity.length) await tx.activityEvent.createMany({ data: activity });
      if (activity.length || Object.keys(data).length) {
        changed += 1;
        announcements.push({ issue, changes });
      }
    }
  });

  for (const { issue } of announcements) {
    emit(RealtimeEventType.ISSUE_UPDATED, {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      payload: { issueId: issue.id, issueKey: issue.issueKey, projectId: issue.projectId },
    });
  }

  for (const { issue, changes } of announcements) {
    try {
      await announceChanges(actor, issue, changes);
    } catch (error) {
      // A failed notification must not fail a batch that is already saved.
      log.warn(error, 'bulk update fan-out failed');
    }
  }

  if (status?.category === 'COMPLETED') {
    for (const { issue } of announcements) {
      if (issue.status.category !== 'COMPLETED') await continueRecurrenceSafely(actor, issue.id);
    }
  }

  return { updated: changed };
}

export async function deleteIssue(actor: ActorContext, issueId: string, ip?: string): Promise<void> {
  assertCan(actor, Permission.ISSUE_DELETE);
  const issue = await prisma.issue.findFirst({
    where: { id: issueId, project: { workspaceId: actor.workspaceId } },
    select: { id: true, issueKey: true, projectId: true },
  });
  if (!issue) throw notFound('Задача');

  await prisma.issue.delete({ where: { id: issueId } });

  audit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: 'ISSUE_DELETED',
    entityType: 'Issue',
    entityId: issueId,
    metadata: { issueKey: issue.issueKey },
    ip,
  });

  emit(RealtimeEventType.ISSUE_DELETED, {
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    payload: { issueId, issueKey: issue.issueKey, projectId: issue.projectId },
  });
}
