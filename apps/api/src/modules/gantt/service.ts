/**
 * Gantt service — assembles the schedule view and guards its invariants.
 *
 * Everything that could be computed without a database lives in
 * `domain/gantt.ts`; this file is the thin layer that loads rows, checks
 * permissions and writes changes through the same paths the rest of the app
 * uses, so history and realtime behave identically to any other edit.
 */
import type {
  IssueLinksDto,
  ActorContext,
  DependencyDto,
  GanttDto,
  GanttQueryInput,
  GanttRowDto,
  ScheduleShiftDto,
} from '@flowdesk/contracts';
import { ActivityType, Permission, RealtimeEventType, permissionsFor } from '@flowdesk/contracts';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { isPastDue } from '../../domain/filters';
import { assertCan } from '../../lib/context';
import { badRequest, notFound } from '../../lib/errors';
import { emit } from '../../realtime/eventBus';
import { statusSelect, toStatus, toUserSummary } from '../../lib/serialize';
import {
  criticalPath,
  findCycle,
  isSelfDependency,
  rollUpSchedule,
  suggestDependentShifts,
  validateWindow,
  type ScheduleEdge,
  type ScheduleNode,
} from '../../domain/gantt';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const ganttIssueSelect = {
  id: true,
  issueKey: true,
  title: true,
  type: true,
  priority: true,
  parentId: true,
  storyPoints: true,
  startDate: true,
  dueDate: true,
  startHasTime: true,
  dueHasTime: true,
  isMilestone: true,
  baselineStartDate: true,
  baselineDueDate: true,
  completedAt: true,
  status: { select: { id: true, name: true, category: true, color: true, position: true, wipLimit: true } },
  assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
} satisfies Prisma.IssueSelect;

type GanttIssueRow = Prisma.IssueGetPayload<{ select: typeof ganttIssueSelect }>;

/**
 * Builds the whole chart in two queries — issues and dependencies — rather than
 * walking the tree, so a deep hierarchy costs the same as a flat one.
 */
export async function getGantt(
  actor: ActorContext,
  projectId: string,
  query: GanttQueryInput,
): Promise<GanttDto> {
  const where: Prisma.IssueWhereInput = {
    projectId,
    archivedAt: null,
    ...(query.includeDone ? {} : { status: { category: { notIn: ['COMPLETED', 'CANCELED'] } } }),
  };

  if (query.assigneeId) {
    const ids = Array.isArray(query.assigneeId) ? query.assigneeId : [query.assigneeId];
    const resolved = ids.map((id) => (id === '@me' ? actor.userId : id));
    where.assigneeId = { in: resolved };
  }

  if (query.from || query.to) {
    // Scheduled issues are clipped to those overlapping the requested window;
    // unscheduled ones are always returned — the client needs them for
    // planning. A single date pins the issue to that day on the timeline.
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;
    // The column is chosen by the caller's object key, so one window filter
    // serves both dates.
    const span: Prisma.DateTimeFilter = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
    where.AND = [
      {
        OR: [
          { startDate: null, dueDate: null },
          { AND: [{ startDate: span }, { dueDate: span }] },
          { AND: [{ startDate: null }, { dueDate: span }] },
          { AND: [{ dueDate: null }, { startDate: span }] },
        ],
      },
    ];
  }

  // Deliberate cap: the chart stops being readable long before this, and the
  // from/to window is what keeps huge projects queryable.
  const issues = await prisma.issue.findMany({
    where,
    orderBy: [{ startDate: { sort: 'asc', nulls: 'last' } }, { rank: 'asc' }],
    select: ganttIssueSelect,
    take: 2000,
  });

  const idSet = new Set(issues.map((i) => i.id));
  const dependencyRows = idSet.size
    ? await prisma.issueDependency.findMany({
        where: { predecessorId: { in: [...idSet] }, successorId: { in: [...idSet] } },
        select: { id: true, predecessorId: true, successorId: true, type: true, lagDays: true },
      })
    : [];

  const nodes: ScheduleNode[] = issues.map((issue) => ({
    id: issue.id,
    // A parent outside the filtered set must not orphan its child's indentation.
    parentId: issue.parentId && idSet.has(issue.parentId) ? issue.parentId : null,
    startDate: issue.startDate,
    dueDate: issue.dueDate,
    isMilestone: issue.isMilestone,
    storyPoints: issue.storyPoints,
    isComplete: issue.status.category === 'COMPLETED',
  }));

  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));

  const edges: ScheduleEdge[] = dependencyRows.map((d) => ({
    predecessorId: d.predecessorId,
    successorId: d.successorId,
    type: d.type,
    lagDays: d.lagDays,
  }));

  const bars = rollUpSchedule(nodes);
  const cp = criticalPath(bars, edges);

  const childCount = new Map<string, number>();
  for (const n of nodes) {
    if (n.parentId) childCount.set(n.parentId, (childCount.get(n.parentId) ?? 0) + 1);
  }

  const depthOf = buildDepths(nodes);
  const now = Date.now();

  const rows: GanttRowDto[] = orderForDisplay(issues, nodes, depthOf).map((issue) => {
    const bar = bars.get(issue.id)!;
    const path = cp.get(issue.id);
    const isDone = issue.status.category === 'COMPLETED' || issue.status.category === 'CANCELED';

    return {
      id: issue.id,
      issueKey: issue.issueKey,
      title: issue.title,
      type: issue.type,
      priority: issue.priority,
      status: toStatus(issue.status),
      assignee: toUserSummary(issue.assignee),
      parentId: parentOf.get(issue.id) ?? null,
      depth: depthOf.get(issue.id) ?? 0,
      hasChildren: (childCount.get(issue.id) ?? 0) > 0,
      storyPoints: issue.storyPoints,
      start: iso(bar.start),
      end: iso(bar.end),
      // A summary bar spans its children's days; only a task's own edges carry a time.
      startHasTime: !bar.isSummary && issue.startHasTime,
      endHasTime: !bar.isSummary && issue.dueHasTime,
      isSummary: bar.isSummary,
      isMilestone: issue.isMilestone,
      progress: Number(bar.progress.toFixed(4)),
      baselineStart: iso(issue.baselineStartDate),
      baselineEnd: iso(issue.baselineDueDate),
      slackDays: path?.slackDays ?? null,
      isCritical: path?.isCritical ?? false,
      isOverdue: !isDone && isPastDue(bar.end, !bar.isSummary && issue.dueHasTime, now),
    };
  });

  // An issue with only a due date is still on the timeline — it renders as a
  // deadline marker — so the range must account for one-sided bars too.
  const boundaries = rows.flatMap((r) => [r.start, r.end].filter((v): v is string => v !== null));
  const range = boundaries.length
    ? {
        start: boundaries.reduce((a, b) => (a < b ? a : b)),
        end: boundaries.reduce((a, b) => (a > b ? a : b)),
      }
    : null;

  const dependencies: DependencyDto[] = dependencyRows.map((d) => ({
    id: d.id,
    predecessorId: d.predecessorId,
    successorId: d.successorId,
    type: d.type,
    lagDays: d.lagDays,
  }));

  return {
    rows,
    dependencies,
    range,
    unscheduledCount: rows.filter((r) => !r.start && !r.end).length,
    permissions: permissionsFor(actor),
  };
}

/** Depth of each node in the parent chain, capped so bad data cannot loop. */
function buildDepths(nodes: ScheduleNode[]): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depths = new Map<string, number>();

  for (const node of nodes) {
    let depth = 0;
    let current = node.parentId;
    const seen = new Set<string>([node.id]);

    while (current && byId.has(current) && !seen.has(current) && depth < 10) {
      seen.add(current);
      depth += 1;
      current = byId.get(current)!.parentId;
    }
    depths.set(node.id, depth);
  }
  return depths;
}

/**
 * Flattens the hierarchy depth-first so the client can render rows in order
 * without building a tree: a child always directly follows its parent.
 */
function orderForDisplay(
  issues: GanttIssueRow[],
  nodes: ScheduleNode[],
  depths: Map<string, number>,
): GanttIssueRow[] {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  const children = new Map<string | null, string[]>();

  for (const issue of issues) {
    const parent = parentOf.get(issue.id) ?? null;
    children.set(parent, [...(children.get(parent) ?? []), issue.id]);
  }

  const ordered: GanttIssueRow[] = [];
  const orderedIds = new Set<string>();
  const visit = (id: string) => {
    const issue = byId.get(id);
    if (!issue || orderedIds.has(id)) return;
    ordered.push(issue);
    orderedIds.add(id);
    for (const childId of children.get(id) ?? []) visit(childId);
  };

  for (const id of children.get(null) ?? []) visit(id);
  // Anything unreachable from a root (filtered-out parent) still gets rendered.
  for (const issue of issues) if (!orderedIds.has(issue.id)) visit(issue.id);

  void depths;
  return ordered;
}

/* ------------------------------------------------------------ reschedule */

export async function rescheduleIssue(
  actor: ActorContext,
  issueId: string,
  input: { startDate: string | null; dueDate: string | null; startHasTime?: boolean; dueHasTime?: boolean; cascade: boolean },
): Promise<{ suggestedShifts: ScheduleShiftDto[]; appliedShifts: number }> {
  assertCan(actor, Permission.ISSUE_UPDATE);

  const issue = await prisma.issue.findFirst({
    where: { id: issueId, project: { workspaceId: actor.workspaceId } },
    select: { id: true, projectId: true, issueKey: true, startDate: true, dueDate: true, title: true },
  });
  if (!issue) throw notFound('Задача');

  const nextStart = input.startDate ? new Date(input.startDate) : null;
  const nextEnd = input.dueDate ? new Date(input.dueDate) : null;
  if (!validateWindow(nextStart, nextEnd)) {
    throw badRequest('Дата начала должна быть не позже даты окончания', {
      startDate: 'Позже даты окончания',
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.issue.update({
      where: { id: issueId },
      data: {
        startDate: nextStart,
        dueDate: nextEnd,
        ...(input.startHasTime !== undefined ? { startHasTime: nextStart ? input.startHasTime : false } : {}),
        ...(input.dueHasTime !== undefined ? { dueHasTime: nextEnd ? input.dueHasTime : false } : {}),
      },
    });

    const entries: Prisma.ActivityEventCreateManyInput[] = [];
    if (iso(issue.startDate) !== iso(nextStart)) {
      entries.push({
        issueId,
        actorId: actor.userId,
        type: ActivityType.DUE_DATE_CHANGED,
        field: 'startDate',
        fromValue: iso(issue.startDate),
        toValue: iso(nextStart),
      });
    }
    if (iso(issue.dueDate) !== iso(nextEnd)) {
      entries.push({
        issueId,
        actorId: actor.userId,
        type: ActivityType.DUE_DATE_CHANGED,
        field: 'dueDate',
        fromValue: iso(issue.dueDate),
        toValue: iso(nextEnd),
      });
    }
    if (entries.length) await tx.activityEvent.createMany({ data: entries });
  });

  // Recompute against the saved state so the suggestion reflects reality.
  const { bars, edges, rowsById } = await loadSchedule(issue.projectId);
  const shifts = suggestDependentShifts(bars, edges, issueId);

  let appliedShifts = 0;
  if (input.cascade && shifts.length > 0) {
    const applied = shifts.map((shift) => {
      const row = rowsById.get(shift.issueId)!;
      const delta = shift.toStart.getTime() - shift.fromStart.getTime();
      return {
        shift,
        row,
        nextStart: shift.toStart,
        nextDue: row.dueDate ? new Date(row.dueDate.getTime() + delta) : null,
      };
    });

    await prisma.$transaction(async (tx) => {
      const entries: Prisma.ActivityEventCreateManyInput[] = [];
      for (const { shift, row, nextStart, nextDue } of applied) {
        await tx.issue.update({
          where: { id: shift.issueId },
          data: { startDate: nextStart, dueDate: nextDue },
        });
        // History mirrors rescheduleIssue: one event per changed date field.
        if (iso(row.startDate) !== iso(nextStart)) {
          entries.push({
            issueId: shift.issueId,
            actorId: actor.userId,
            type: ActivityType.DUE_DATE_CHANGED,
            field: 'startDate',
            fromValue: iso(row.startDate),
            toValue: iso(nextStart),
          });
        }
        if (iso(row.dueDate) !== iso(nextDue)) {
          entries.push({
            issueId: shift.issueId,
            actorId: actor.userId,
            type: ActivityType.DUE_DATE_CHANGED,
            field: 'dueDate',
            fromValue: iso(row.dueDate),
            toValue: iso(nextDue),
          });
        }
      }
      if (entries.length) await tx.activityEvent.createMany({ data: entries });
    });
    appliedShifts = shifts.length;

    for (const { shift, row, nextStart, nextDue } of applied) {
      emit(RealtimeEventType.ISSUE_UPDATED, {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        payload: {
          issueId: shift.issueId,
          issueKey: row.issueKey,
          projectId: issue.projectId,
          patch: { startDate: iso(nextStart), dueDate: iso(nextDue) },
        },
      });
    }
  }

  emit(RealtimeEventType.ISSUE_UPDATED, {
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    payload: {
      issueId,
      issueKey: issue.issueKey,
      projectId: issue.projectId,
      patch: { startDate: iso(nextStart), dueDate: iso(nextEnd) },
    },
  });

  const suggestedShifts: ScheduleShiftDto[] = appliedShifts
    ? []
    : shifts.map((shift) => {
        const row = rowsById.get(shift.issueId)!;
        return {
          issueId: shift.issueId,
          issueKey: row.issueKey,
          title: row.title,
          fromStart: shift.fromStart.toISOString(),
          toStart: shift.toStart.toISOString(),
          days: shift.days,
        };
      });

  return { suggestedShifts, appliedShifts };
}

async function loadSchedule(projectId: string) {
  const issues = await prisma.issue.findMany({
    where: { projectId, archivedAt: null },
    select: {
      id: true,
      issueKey: true,
      title: true,
      parentId: true,
      startDate: true,
      dueDate: true,
      isMilestone: true,
      storyPoints: true,
      status: { select: { category: true } },
    },
  });

  const dependencies = await prisma.issueDependency.findMany({
    where: { predecessorId: { in: issues.map((i) => i.id) } },
    select: { predecessorId: true, successorId: true, type: true, lagDays: true },
  });

  const bars = rollUpSchedule(
    issues.map((i) => ({
      id: i.id,
      parentId: i.parentId,
      startDate: i.startDate,
      dueDate: i.dueDate,
      isMilestone: i.isMilestone,
      storyPoints: i.storyPoints,
      isComplete: i.status.category === 'COMPLETED',
    })),
  );

  return {
    bars,
    edges: dependencies as ScheduleEdge[],
    rowsById: new Map(issues.map((i) => [i.id, i])),
  };
}

/* ----------------------------------------------------------- dependencies */

/** Links of one issue for its card, with the issue at the other end of each. */
export async function getIssueLinks(issueId: string): Promise<IssueLinksDto> {
  const other = { select: { id: true, issueKey: true, title: true, status: { select: statusSelect } } };
  const [dependsOn, blocks] = await Promise.all([
    prisma.issueDependency.findMany({
      where: { successorId: issueId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, type: true, lagDays: true, predecessor: other },
    }),
    prisma.issueDependency.findMany({
      where: { predecessorId: issueId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, type: true, lagDays: true, successor: other },
    }),
  ]);
  const toLink = (row: { id: string; type: string; lagDays: number }, issue: (typeof dependsOn)[number]['predecessor']) => ({
    dependencyId: row.id,
    type: row.type as never,
    lagDays: row.lagDays,
    issue: { id: issue.id, issueKey: issue.issueKey, title: issue.title, status: toStatus(issue.status) },
  });
  return {
    dependsOn: dependsOn.map((row) => toLink(row, row.predecessor)),
    blocks: blocks.map((row) => toLink(row, row.successor)),
  };
}

export async function createDependency(
  actor: ActorContext,
  projectId: string,
  input: { predecessorId: string; successorId: string; type: string; lagDays: number },
): Promise<DependencyDto> {
  assertCan(actor, Permission.ISSUE_UPDATE);

  if (isSelfDependency({ ...input, type: input.type as never })) {
    throw badRequest('Задача не может зависеть сама от себя');
  }

  const issues = await prisma.issue.findMany({
    where: { id: { in: [input.predecessorId, input.successorId] }, projectId },
    select: { id: true, issueKey: true },
  });
  if (issues.length !== 2) throw badRequest('Обе задачи должны быть в одном проекте');

  // Check and insert in one transaction: the row locks on both issues
  // serialize concurrent creates, so the cycle re-check inside the transaction
  // sees every edge a competing request may have just committed.
  const created = await prisma.$transaction(async (tx) => {
    const [first, second] = [input.predecessorId, input.successorId].sort();
    await tx.$queryRaw`SELECT id FROM "issues" WHERE id IN (${first}, ${second}) FOR UPDATE`;

    const existing = await tx.issueDependency.findMany({
      where: { predecessor: { projectId } },
      select: { predecessorId: true, successorId: true, type: true, lagDays: true },
    });

    const cycle = findCycle(existing as ScheduleEdge[], {
      predecessorId: input.predecessorId,
      successorId: input.successorId,
      type: input.type as never,
      lagDays: input.lagDays,
    });
    if (cycle) {
      const keys = cycle
        .map((id) => issues.find((i) => i.id === id)?.issueKey)
        .filter(Boolean)
        .join(' → ');
      throw badRequest(
        keys
          ? `Связь образует цикл: ${keys}`
          : 'Связь образует цикл — задача в итоге зависела бы сама от себя',
      );
    }

    return tx.issueDependency.create({
      data: {
        predecessorId: input.predecessorId,
        successorId: input.successorId,
        type: input.type as never,
        lagDays: input.lagDays,
        createdById: actor.userId,
      },
      select: { id: true, predecessorId: true, successorId: true, type: true, lagDays: true },
    });
  });

  emit(RealtimeEventType.ISSUE_UPDATED, {
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    payload: {
      issueId: input.successorId,
      issueKey: issues.find((i) => i.id === input.successorId)?.issueKey ?? '',
      projectId,
    },
  });

  return created;
}

export async function deleteDependency(actor: ActorContext, dependencyId: string): Promise<void> {
  assertCan(actor, Permission.ISSUE_UPDATE);

  const dependency = await prisma.issueDependency.findFirst({
    where: { id: dependencyId, predecessor: { project: { workspaceId: actor.workspaceId } } },
    select: { id: true, successorId: true, predecessor: { select: { projectId: true, issueKey: true } } },
  });
  if (!dependency) throw notFound('Связь');

  await prisma.issueDependency.delete({ where: { id: dependencyId } });

  emit(RealtimeEventType.ISSUE_UPDATED, {
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    payload: {
      issueId: dependency.successorId,
      issueKey: dependency.predecessor.issueKey,
      projectId: dependency.predecessor.projectId,
    },
  });
}
