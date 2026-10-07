import type { ActorContext, IssueFilterInput, WorkloadDto, WorkloadRowDto } from '@flowdesk/contracts';
import { ISSUE_PRIORITIES, ISSUE_TYPES } from '@flowdesk/contracts';
import { prisma } from '../../lib/prisma';
import { visibleProjectIds } from '../../lib/context';
import { buildIssueWhere, isPastDue } from '../../domain/filters';

/** More active tasks than this on the chosen people, and the table says it is not the whole picture. */
const ROW_LIMIT = 5000;

/**
 * The active work of several people, spread over the coming weeks.
 *
 * Counts and relative estimates only. There is no share of anyone's time here:
 * the system knows neither hours nor calendars, and a made-up percentage would
 * be read as a real one.
 *
 * The weeks are given by the client as instants — the Mondays of the viewer's
 * own calendar — so that a cell and the list it opens are cut along exactly
 * the same lines: a cell counts due dates in `[bounds[i], bounds[i + 1])`.
 *
 * Every figure is counted over what the viewer may read, like the lists.
 */
export async function workload(
  actor: ActorContext,
  filter: IssueFilterInput,
  bounds: Date[],
  timezone: string,
  now = new Date(),
): Promise<WorkloadDto> {
  const ids = [...new Set((filter.assigneeId ?? []).map((id) => (id === '@me' ? actor.userId : id)))].filter(
    (id) => id !== 'none' && id !== 'unassigned',
  );
  const weeks = bounds.slice(0, -1).map((start, index) => ({
    start: start.toISOString(),
    end: bounds[index + 1]!.toISOString(),
  }));
  if (ids.length === 0) return { weeks, rows: [], usesEstimates: false, truncated: false };

  const allowedProjectIds = await visibleProjectIds(actor);
  const where = buildIssueWhere(
    // Subtasks are someone's work too; finished and cancelled tasks are nobody's load.
    { ...filter, assigneeId: ids, includeSubtasks: true, isOverdue: undefined, includeDone: false },
    { workspaceId: actor.workspaceId, allowedProjectIds, currentUserId: actor.userId, timezone },
    { priorities: ISSUE_PRIORITIES, types: ISSUE_TYPES },
  );

  const issues = await prisma.issue.findMany({
    where,
    select: {
      assigneeId: true,
      dueDate: true,
      dueHasTime: true,
      storyPoints: true,
      _count: { select: { subtasks: { where: { storyPoints: { not: null }, archivedAt: null } } } },
    },
    take: ROW_LIMIT + 1,
  });

  const rows = new Map<string, WorkloadRowDto>(
    ids.map((userId) => [
      userId,
      {
        userId,
        active: 0,
        overdue: 0,
        noDueDate: 0,
        later: 0,
        unestimated: 0,
        points: 0,
        weeks: weeks.map(() => ({ count: 0, points: 0 })),
      },
    ]),
  );
  const edges = bounds.map((bound) => bound.getTime());
  const horizon = edges[edges.length - 1]!;
  let usesEstimates = false;

  for (const issue of issues.slice(0, ROW_LIMIT)) {
    const row = issue.assigneeId ? rows.get(issue.assigneeId) : undefined;
    if (!row) continue;

    if (issue.storyPoints !== null) usesEstimates = true;
    // A task split into estimated subtasks is measured by its parts: adding
    // its own estimate on top would count the same work twice.
    const points = issue._count.subtasks > 0 ? 0 : (issue.storyPoints ?? 0);

    row.active += 1;
    row.points += points;
    if (issue.storyPoints === null) row.unestimated += 1;

    if (!issue.dueDate) {
      row.noDueDate += 1;
      continue;
    }
    // Overdue is said in its own column and does not take the task out of
    // its week: each cell opens a list of exactly the tasks it counted.
    if (isPastDue(issue.dueDate, issue.dueHasTime, now.getTime(), timezone)) row.overdue += 1;

    const at = issue.dueDate.getTime();
    if (at >= horizon) {
      row.later += 1;
      continue;
    }
    for (let index = 0; index < weeks.length; index += 1) {
      if (at >= edges[index]! && at < edges[index + 1]!) {
        row.weeks[index]!.count += 1;
        row.weeks[index]!.points += points;
        break;
      }
    }
  }

  return { weeks, rows: ids.map((id) => rows.get(id)!), usesEstimates, truncated: issues.length > ROW_LIMIT };
}

/**
 * The week boundaries of a request: «2026-10-05T21:00:00.000Z,2026-10-12T21:00:00.000Z,…».
 * Returns `null` for anything that is not two to fourteen instants in order.
 */
export function parseBounds(raw: unknown): Date[] | null {
  if (typeof raw !== 'string') return null;
  const bounds = raw.split(',').map((part) => new Date(part));
  if (bounds.length < 2 || bounds.length > 14) return null;
  if (bounds.some((bound) => Number.isNaN(bound.getTime()))) return null;
  for (let index = 1; index < bounds.length; index += 1) {
    if (bounds[index]!.getTime() <= bounds[index - 1]!.getTime()) return null;
  }
  return bounds;
}
