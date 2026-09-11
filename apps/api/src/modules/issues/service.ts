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
import { assertCan, visibleProjectIds } from '../../lib/context';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { emit } from '../../realtime/eventBus';
import { audit } from '../../lib/audit';
import { buildIssueWhere, cursorFieldFor, orderByFor } from '../../domain/filters';
import {
  HIERARCHY_MESSAGES,
  diffIssue,
  exceedsWipLimit,
  formatIssueKey,
  nextCompletedAt,
  validateHierarchy,
} from '../../domain/issueRules';
import { issueSummarySelect, toIssueSummary, toAttachment, attachmentSelect, toSprint, sprintInclude } from '../../lib/serialize';
import { filterWorkspaceMembers, issueWatchers, notify } from '../notifications/service';

/* ----------------------------------------------------------------- read */

export async function listIssues(
  actor: ActorContext,
  filter: IssueFilterInput,
): Promise<Paginated<IssueSummaryDto>> {
  const allowedProjectIds = await visibleProjectIds(actor);
  const where = buildIssueWhere(filter, {
    workspaceId: actor.workspaceId,
    allowedProjectIds,
    currentUserId: actor.userId,
  }, { priorities: ISSUE_PRIORITIES, types: ISSUE_TYPES });

  const orderBy = orderByFor(filter.sort, filter.order);
  const cursorField = cursorFieldFor(filter.sort);

  const rows = await prisma.issue.findMany({
    where,
    orderBy,
    take: filter.limit + 1,
    ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    select: issueSummarySelect,
  });

  const hasMore = rows.length > filter.limit;
  const items = hasMore ? rows.slice(0, filter.limit) : rows;
  void cursorField;

  return {
    items: items.map(toIssueSummary),
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
  };
}

export async function countIssues(actor: ActorContext, filter: IssueFilterInput): Promise<number> {
  const allowedProjectIds = await visibleProjectIds(actor);
  const where = buildIssueWhere(filter, {
    workspaceId: actor.workspaceId,
    allowedProjectIds,
    currentUserId: actor.userId,
  }, { priorities: ISSUE_PRIORITIES, types: ISSUE_TYPES });
  return prisma.issue.count({ where });
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
): Promise<{ columns: BoardColumn[] }> {
  const statuses = await prisma.workflowStatus.findMany({
    where: { projectId },
    orderBy: { position: 'asc' },
    select: { id: true, name: true, category: true, color: true, position: true, wipLimit: true },
  });

  const perColumn = Math.min(filter.perColumn ?? 60, 200);
  const baseWhere = buildIssueWhere(
    { ...filter, projectId, sort: 'rank', order: 'asc', limit: perColumn },
    { workspaceId: actor.workspaceId, allowedProjectIds: 'ALL', currentUserId: actor.userId },
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

  const subtasks = await prisma.issue.findMany({
    where: { parentId: issueId, archivedAt: null },
    orderBy: [{ rank: 'asc' }],
    select: issueSummarySelect,
  });

  return {
    ...toIssueSummary(issue),
    description: issue.description,
    parent: issue.parent,
    sprint: issue.sprint ? toSprint(issue.sprint) : null,
    subtasks: subtasks.map(toIssueSummary),
    attachments: issue.attachments.map(toAttachment),
    permissions: permissionsFor(actor),
  };
}

export async function getIssueByKey(actor: ActorContext, issueKey: string) {
  const issue = await prisma.issue.findFirst({
    where: { issueKey: issueKey.toUpperCase(), project: { workspaceId: actor.workspaceId } },
    select: { id: true },
  });
  if (!issue) throw notFound('Задача');
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
    orderBy: { createdAt: 'asc' },
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

  const error = validateHierarchy({
    issueId: input.issueId ?? null,
    type: input.type as never,
    parentId: input.parentId ?? null,
    parentType: (related.find((r) => r.id === input.parentId)?.type ?? null) as never,
    epicId: input.epicId ?? null,
    epicType: (related.find((r) => r.id === input.epicId)?.type ?? null) as never,
  });
  if (error) throw badRequest(HIERARCHY_MESSAGES[error]);
}

async function validateLabels(projectId: string, labelIds: string[]): Promise<void> {
  if (!labelIds.length) return;
  const count = await prisma.label.count({ where: { projectId, id: { in: labelIds } } });
  if (count !== labelIds.length) throw badRequest('Неизвестная метка для этого проекта');
}

async function validateAssignee(workspaceId: string, assigneeId: string | null | undefined): Promise<void> {
  if (!assigneeId) return;
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: assigneeId } },
    select: { id: true },
  });
  if (!member) throw badRequest('Исполнитель не состоит в этом пространстве');
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
    validateAssignee(actor.workspaceId, input.assigneeId),
    validateSprint(input.projectId, input.sprintId),
  ]);

  const description = input.description ? sanitizeDoc(input.description) : null;
  const descriptionText = description ? docToText(description) : null;

  // New cards land at the top of their column.
  const first = await prisma.issue.findFirst({
    where: { projectId: input.projectId, statusId: status.id },
    orderBy: { rank: 'asc' },
    select: { rank: true },
  });
  const rank = rankBetween(null, first?.rank ?? null);

  const issue = await prisma.$transaction(async (tx) => {
    // Reserve the next number atomically so two concurrent creates cannot
    // produce the same issue key.
    const project = await tx.project.update({
      where: { id: input.projectId },
      data: { issueCounter: { increment: 1 } },
      select: { issueCounter: true },
    });

    const created = await tx.issue.create({
      data: {
        projectId: input.projectId,
        number: project.issueCounter,
        issueKey: formatIssueKey(projectKey, project.issueCounter),
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
        isMilestone: input.isMilestone ?? false,
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

  await fanoutCreate(actor, issue.id, issue.issueKey, input);

  return getIssue(actor, issue.id);
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
        title: `${issueKey} was assigned to you`,
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
          title: `You were mentioned in ${issueKey}`,
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
    validateAssignee(actor.workspaceId, patch.assigneeId),
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
  if (patch.dueDate !== undefined) {
    data.dueDate = patch.dueDate ? new Date(patch.dueDate) : null;
    after.dueDate = data.dueDate;
  }
  if (patch.startDate !== undefined) {
    data.startDate = patch.startDate ? new Date(patch.startDate) : null;
    after.startDate = data.startDate;
  }
  if (patch.isMilestone !== undefined) {
    data.isMilestone = patch.isMilestone;
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

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.issue.update({ where: { id: issueId }, data });
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
      issueKey: before.issueKey,
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

  await fanoutUpdate(actor, { ...before, newStatus }, patch);

  return getIssue(actor, issueId);
}

async function fanoutUpdate(
  actor: ActorContext,
  before: {
    id: string;
    issueKey: string;
    title: string;
    assigneeId: string | null;
    status: { name: string };
    newStatus: { name: string } | null;
  },
  patch: UpdateIssueInput,
): Promise<void> {
  const jobs: Promise<void>[] = [];

  if (patch.assigneeId !== undefined && patch.assigneeId && patch.assigneeId !== before.assigneeId) {
    jobs.push(
      notify({
        userIds: [patch.assigneeId],
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        type: NotificationType.ISSUE_ASSIGNED,
        title: `${before.issueKey} was assigned to you`,
        body: patch.title ?? before.title,
        issueId: before.id,
      }),
    );
  }

  if (before.newStatus) {
    jobs.push(
      issueWatchers(before.id).then((watchers) =>
        notify({
          userIds: watchers,
          workspaceId: actor.workspaceId,
          actorId: actor.userId,
          type: NotificationType.ISSUE_STATUS_CHANGED,
          title: `${before.issueKey} moved to ${before.newStatus!.name}`,
          body: patch.title ?? before.title,
          issueId: before.id,
        }),
      ),
    );
  }

  if (patch.dueDate !== undefined) {
    jobs.push(
      issueWatchers(before.id).then((watchers) =>
        notify({
          userIds: watchers,
          workspaceId: actor.workspaceId,
          actorId: actor.userId,
          type: NotificationType.ISSUE_DUE_DATE_CHANGED,
          title: `Due date changed on ${before.issueKey}`,
          body: patch.dueDate ? new Date(patch.dueDate).toDateString() : 'Срок снят',
          issueId: before.id,
        }),
      ),
    );
  }

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
            title: `You were mentioned in ${before.issueKey}`,
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

  const neighbours = await prisma.issue.findMany({
    where: { id: { in: [input.beforeId, input.afterId].filter((v): v is string => Boolean(v)) } },
    select: { id: true, rank: true, statusId: true },
  });
  const beforeRank = neighbours.find((n) => n.id === input.beforeId)?.rank ?? null;
  const afterRank = neighbours.find((n) => n.id === input.afterId)?.rank ?? null;

  let rank: string;
  try {
    rank = rankBetween(beforeRank, afterRank);
  } catch {
    // Neighbours arrived out of order (stale client state) — append instead of failing.
    const last = await prisma.issue.findFirst({
      where: { projectId: issue.projectId, statusId: status.id },
      orderBy: { rank: 'desc' },
      select: { rank: true },
    });
    rank = rankBetween(last?.rank ?? null, null);
  }

  const data: Prisma.IssueUpdateInput = { rank };
  if (isEntering) {
    data.status = { connect: { id: status.id } };
    data.completedAt = nextCompletedAt(status.category as never, issue.completedAt);
  }
  if (input.sprintId !== undefined) {
    await validateSprint(issue.projectId, input.sprintId);
    data.sprint = input.sprintId ? { connect: { id: input.sprintId } } : { disconnect: true };
  }

  await prisma.$transaction(async (tx) => {
    await tx.issue.update({ where: { id: issueId }, data });
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
    const watchers = await issueWatchers(issueId);
    await notify({
      userIds: watchers,
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      type: NotificationType.ISSUE_STATUS_CHANGED,
      title: `${issue.issueKey} moved to ${status.name}`,
      body: issue.title,
      issueId,
    });
  }

  const updated = await prisma.issue.findUniqueOrThrow({ where: { id: issueId }, select: issueSummarySelect });
  return toIssueSummary(updated);
}

export async function bulkUpdate(
  actor: ActorContext,
  issueIds: string[],
  patch: {
    statusId?: string;
    priority?: string;
    assigneeId?: string | null;
    sprintId?: string | null;
    epicId?: string | null;
    addLabelIds?: string[];
    removeLabelIds?: string[];
  },
): Promise<{ updated: number }> {
  assertCan(actor, Permission.ISSUE_UPDATE);

  // Scope to issues the caller can actually reach — never trust the id list.
  const allowed = await visibleProjectIds(actor);
  const issues = await prisma.issue.findMany({
    where: {
      id: { in: issueIds },
      project: { workspaceId: actor.workspaceId },
      ...(allowed === 'ALL' ? {} : { projectId: { in: allowed } }),
    },
    select: { id: true, projectId: true, statusId: true, issueKey: true, completedAt: true },
  });
  if (!issues.length) return { updated: 0 };

  const projectIds = [...new Set(issues.map((i) => i.projectId))];
  if (patch.statusId && projectIds.length > 1) {
    throw badRequest('Массово менять статус можно только в пределах одного проекта');
  }

  const status = patch.statusId ? await resolveStatus(projectIds[0]!, patch.statusId) : null;
  if (patch.assigneeId !== undefined) await validateAssignee(actor.workspaceId, patch.assigneeId);

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    for (const issue of issues) {
      const data: Prisma.IssueUpdateInput = {};
      const activity: Prisma.ActivityEventCreateManyInput[] = [];

      if (status && status.id !== issue.statusId) {
        data.status = { connect: { id: status.id } };
        data.completedAt = nextCompletedAt(status.category as never, issue.completedAt, now);
        activity.push({
          issueId: issue.id,
          actorId: actor.userId,
          type: ActivityType.STATUS_CHANGED,
          field: 'statusId',
          fromValue: issue.statusId,
          toValue: status.id,
        });
      }
      if (patch.priority) {
        data.priority = patch.priority as never;
        activity.push({
          issueId: issue.id,
          actorId: actor.userId,
          type: ActivityType.PRIORITY_CHANGED,
          field: 'priority',
          toValue: patch.priority,
        });
      }
      if (patch.assigneeId !== undefined) {
        data.assignee = patch.assigneeId ? { connect: { id: patch.assigneeId } } : { disconnect: true };
        activity.push({
          issueId: issue.id,
          actorId: actor.userId,
          type: ActivityType.ASSIGNEE_CHANGED,
          field: 'assigneeId',
          toValue: patch.assigneeId,
        });
      }
      if (patch.sprintId !== undefined) {
        data.sprint = patch.sprintId ? { connect: { id: patch.sprintId } } : { disconnect: true };
        activity.push({
          issueId: issue.id,
          actorId: actor.userId,
          type: ActivityType.SPRINT_CHANGED,
          field: 'sprintId',
          toValue: patch.sprintId,
        });
      }
      if (patch.epicId !== undefined) {
        data.epic = patch.epicId ? { connect: { id: patch.epicId } } : { disconnect: true };
        activity.push({
          issueId: issue.id,
          actorId: actor.userId,
          type: ActivityType.EPIC_CHANGED,
          field: 'epicId',
          toValue: patch.epicId,
        });
      }

      if (Object.keys(data).length) await tx.issue.update({ where: { id: issue.id }, data });
      if (patch.removeLabelIds?.length) {
        await tx.issueLabel.deleteMany({ where: { issueId: issue.id, labelId: { in: patch.removeLabelIds } } });
      }
      if (patch.addLabelIds?.length) {
        await tx.issueLabel.createMany({
          data: patch.addLabelIds.map((labelId) => ({ issueId: issue.id, labelId })),
          skipDuplicates: true,
        });
      }
      if (activity.length) await tx.activityEvent.createMany({ data: activity });
    }
  });

  for (const issue of issues) {
    emit(RealtimeEventType.ISSUE_UPDATED, {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      payload: { issueId: issue.id, issueKey: issue.issueKey, projectId: issue.projectId },
    });
  }

  return { updated: issues.length };
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
