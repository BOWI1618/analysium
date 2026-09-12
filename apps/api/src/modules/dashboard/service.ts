import type { ActorContext, DashboardDto, IssuePriority, IssueType } from '@flowdesk/contracts';
import { ISSUE_PRIORITIES, ISSUE_TYPES, StatusCategory } from '@flowdesk/contracts';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { toSprint, sprintInclude, toUserSummary } from '../../lib/serialize';

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Project dashboard. All widgets are computed from grouped queries rather than
 * loading issues into memory, so the numbers stay cheap on large projects.
 */
export async function projectDashboard(
  actor: ActorContext,
  projectId: string,
  days = 30,
): Promise<DashboardDto> {
  const since = new Date(Date.now() - days * DAY_MS);
  const base = { projectId, archivedAt: null };

  const [statuses, byStatus, byPriority, byType, totals, overdue, unassigned, members, activeSprint, recentSprints] =
    await Promise.all([
      prisma.workflowStatus.findMany({
        where: { projectId },
        orderBy: { position: 'asc' },
        select: { id: true, name: true, color: true, category: true },
      }),
      prisma.issue.groupBy({ by: ['statusId'], where: base, _count: { _all: true } }),
      prisma.issue.groupBy({ by: ['priority'], where: base, _count: { _all: true } }),
      prisma.issue.groupBy({ by: ['type'], where: base, _count: { _all: true } }),
      prisma.issue.count({ where: base }),
      prisma.issue.count({
        where: { ...base, dueDate: { lt: new Date() }, status: { category: { notIn: ['COMPLETED', 'CANCELED'] } } },
      }),
      prisma.issue.count({ where: { ...base, assigneeId: null } }),
      prisma.issue.groupBy({ by: ['assigneeId'], where: base, _count: { _all: true } }),
      prisma.sprint.findFirst({ where: { projectId, status: 'ACTIVE' }, include: sprintInclude }),
      prisma.sprint.findMany({
        where: { projectId, status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
        take: 6,
        include: sprintInclude,
      }),
    ]);

  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const completedStatusIds = statuses.filter((s) => s.category === 'COMPLETED').map((s) => s.id);
  const completed = byStatus
    .filter((s) => completedStatusIds.includes(s.statusId))
    .reduce((sum, s) => sum + s._count._all, 0);

  // Assignee breakdown needs both totals and completed counts per person.
  const completedByAssignee = await prisma.issue.groupBy({
    by: ['assigneeId'],
    where: { ...base, status: { category: 'COMPLETED' } },
    _count: { _all: true },
  });
  const completedMap = new Map(completedByAssignee.map((c) => [c.assigneeId, c._count._all]));

  const assigneeIds = members.map((m) => m.assigneeId).filter((id): id is string => Boolean(id));
  const users = assigneeIds.length
    ? await prisma.user.findMany({
        where: { id: { in: assigneeIds } },
        select: { id: true, name: true, email: true, avatarUrl: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  // Created vs completed per day for the activity chart.
  const [createdRows, completedRows] = await Promise.all([
    prisma.issue.findMany({
      where: { ...base, createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    prisma.issue.findMany({
      where: { ...base, completedAt: { gte: since } },
      select: { completedAt: true },
    }),
  ]);

  const activityMap = new Map<string, { created: number; completed: number }>();
  for (let i = days - 1; i >= 0; i -= 1) {
    activityMap.set(dayKey(new Date(Date.now() - i * DAY_MS)), { created: 0, completed: 0 });
  }
  for (const row of createdRows) {
    const entry = activityMap.get(dayKey(row.createdAt));
    if (entry) entry.created += 1;
  }
  for (const row of completedRows) {
    if (!row.completedAt) continue;
    const entry = activityMap.get(dayKey(row.completedAt));
    if (entry) entry.completed += 1;
  }

  return {
    totals: {
      total: totals,
      completed,
      open: totals - completed,
      overdue,
      unassigned,
    },
    byStatus: byStatus
      .map((s) => {
        const status = statusById.get(s.statusId);
        return status
          ? {
              statusId: s.statusId,
              name: status.name,
              color: status.color,
              category: status.category,
              count: s._count._all,
            }
          : null;
      })
      .filter((v): v is NonNullable<typeof v> => v !== null),
    byPriority: ISSUE_PRIORITIES.map((priority) => ({
      priority: priority as IssuePriority,
      count: byPriority.find((p) => p.priority === priority)?._count._all ?? 0,
    })),
    byType: ISSUE_TYPES.map((type) => ({
      type: type as IssueType,
      count: byType.find((t) => t.type === type)?._count._all ?? 0,
    })),
    byAssignee: members
      .map((m) => ({
        user: m.assigneeId ? toUserSummary(userById.get(m.assigneeId) ?? null) : null,
        count: m._count._all,
        completed: completedMap.get(m.assigneeId) ?? 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    activity: [...activityMap.entries()].map(([date, v]) => ({ date, ...v })),
    sprint: activeSprint ? { ...toSprint(activeSprint), burndown: await burndown(activeSprint.id) } : null,
    velocity: recentSprints.reverse().map((s) => {
      const dto = toSprint(s);
      return {
        sprintId: s.id,
        name: s.name,
        committed: s.committedPoints ?? dto.totalPoints,
        completed: dto.completedPoints,
      };
    }),
  };
}

/**
 * Burndown for the active sprint: remaining points per day against the ideal
 * straight line. Derived from `completedAt`, so it stays correct even if an
 * issue is completed and then reopened.
 */
async function burndown(sprintId: string): Promise<{ date: string; remaining: number | null; ideal: number }[]> {
  const sprint = await prisma.sprint.findUnique({
    where: { id: sprintId },
    select: {
      startDate: true,
      endDate: true,
      issues: { select: { storyPoints: true, completedAt: true } },
    },
  });
  if (!sprint?.startDate || !sprint.endDate) return [];

  const start = new Date(sprint.startDate);
  const end = new Date(sprint.endDate);
  const totalPoints = sprint.issues.reduce((sum, i) => sum + (i.storyPoints ?? 1), 0);
  const dayCount = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY_MS));

  const points: { date: string; remaining: number | null; ideal: number }[] = [];
  for (let i = 0; i <= dayCount; i += 1) {
    const day = new Date(start.getTime() + i * DAY_MS);
    if (day.getTime() > Date.now() + DAY_MS) {
      // Future days have no observable value — the contract carries null.
      points.push({ date: dayKey(day), remaining: null, ideal: totalPoints * (1 - i / dayCount) });
      continue;
    }
    const burned = sprint.issues
      .filter((issue) => issue.completedAt && issue.completedAt.getTime() <= day.getTime() + DAY_MS - 1)
      .reduce((sum, issue) => sum + (issue.storyPoints ?? 1), 0);
    points.push({
      date: dayKey(day),
      remaining: totalPoints - burned,
      ideal: Math.max(0, totalPoints * (1 - i / dayCount)),
    });
  }
  return points;
}

/** Aggregated counts for the "My Work" page. */
export async function myWorkSummary(actor: ActorContext) {
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * DAY_MS);
  const open: Prisma.WorkflowStatusWhereInput = {
    category: { notIn: [StatusCategory.COMPLETED, StatusCategory.CANCELED] },
  };
  const scope = { project: { workspaceId: actor.workspaceId }, archivedAt: null };

  const [assigned, created, overdue, upcoming, completedThisWeek] = await Promise.all([
    prisma.issue.count({ where: { ...scope, assigneeId: actor.userId, status: open } }),
    prisma.issue.count({ where: { ...scope, reporterId: actor.userId, status: open } }),
    prisma.issue.count({
      where: { ...scope, assigneeId: actor.userId, dueDate: { lt: now }, status: open },
    }),
    prisma.issue.count({
      where: { ...scope, assigneeId: actor.userId, dueDate: { gte: now, lte: soon }, status: open },
    }),
    prisma.issue.count({
      where: {
        ...scope,
        assigneeId: actor.userId,
        completedAt: { gte: new Date(now.getTime() - 7 * DAY_MS) },
      },
    }),
  ]);

  return { assigned, created, overdue, upcoming, completedThisWeek };
}
