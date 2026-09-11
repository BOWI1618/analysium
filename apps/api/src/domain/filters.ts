/**
 * Translates a validated filter object into a Prisma `where` clause.
 *
 * Isolated and pure so the whole filter surface can be unit-tested without a
 * database, and so no route handler ever hand-rolls a query — which is how
 * scoping bugs (and IDOR) creep in.
 */
import type { Prisma } from '@prisma/client';
import type { IssueFilterInput, SortKey } from '@flowdesk/contracts';
import { StatusCategory } from '@flowdesk/contracts';

export interface FilterScope {
  workspaceId: string;
  /** `'ALL'` for full-workspace access, or the explicit list a guest may read. */
  allowedProjectIds: string[] | 'ALL';
  /** Resolves `@me` in assignee/reporter filters. */
  currentUserId: string;
}

const enumIn = <T extends string>(values: string[] | undefined, allowed: readonly string[]): T[] | undefined => {
  if (!values?.length) return undefined;
  const filtered = values.filter((v) => allowed.includes(v)) as T[];
  return filtered.length ? filtered : undefined;
};

function resolveUsers(values: string[] | undefined, currentUserId: string) {
  if (!values?.length) return undefined;
  const ids = values.map((v) => (v === '@me' ? currentUserId : v));
  const includeUnassigned = ids.includes('none') || ids.includes('unassigned');
  const realIds = ids.filter((id) => id !== 'none' && id !== 'unassigned');
  return { realIds, includeUnassigned };
}

export function buildIssueWhere(
  filter: Partial<IssueFilterInput>,
  scope: FilterScope,
  opts: { priorities: readonly string[]; types: readonly string[] },
): Prisma.IssueWhereInput {
  const and: Prisma.IssueWhereInput[] = [];

  // --- project scoping: the security-relevant part, applied unconditionally
  const projectFilter: Prisma.ProjectWhereInput = { workspaceId: scope.workspaceId };
  and.push({ project: projectFilter });

  if (scope.allowedProjectIds !== 'ALL') {
    and.push({ projectId: { in: scope.allowedProjectIds } });
  }

  if (filter.projectId) {
    const ids = Array.isArray(filter.projectId) ? filter.projectId : [filter.projectId];
    and.push({ projectId: { in: ids } });
  }

  // --- archived issues are hidden unless explicitly requested
  and.push({ archivedAt: null });

  if (filter.statusId?.length) and.push({ statusId: { in: filter.statusId } });

  const categories = enumIn(filter.statusCategory, Object.values(StatusCategory));
  if (categories) and.push({ status: { category: { in: categories as never } } });

  const assignee = resolveUsers(filter.assigneeId, scope.currentUserId);
  if (assignee) {
    const or: Prisma.IssueWhereInput[] = [];
    if (assignee.realIds.length) or.push({ assigneeId: { in: assignee.realIds } });
    if (assignee.includeUnassigned) or.push({ assigneeId: null });
    if (or.length) and.push({ OR: or });
  }

  const reporter = resolveUsers(filter.reporterId, scope.currentUserId);
  if (reporter?.realIds.length) and.push({ reporterId: { in: reporter.realIds } });

  const priorities = enumIn(filter.priority, opts.priorities);
  if (priorities) and.push({ priority: { in: priorities as never } });

  const types = enumIn(filter.type, opts.types);
  if (types) and.push({ type: { in: types as never } });

  if (filter.labelId?.length) {
    // AND semantics: an issue must carry every selected label.
    for (const labelId of filter.labelId) {
      and.push({ labels: { some: { labelId } } });
    }
  }

  if (filter.sprintId?.length) {
    const hasNone = filter.sprintId.includes('none');
    const ids = filter.sprintId.filter((s) => s !== 'none');
    const or: Prisma.IssueWhereInput[] = [];
    if (ids.length) or.push({ sprintId: { in: ids } });
    if (hasNone) or.push({ sprintId: null });
    if (or.length) and.push({ OR: or });
  }

  if (filter.noSprint) and.push({ sprintId: null });

  if (filter.epicId?.length) {
    const hasNone = filter.epicId.includes('none');
    const ids = filter.epicId.filter((s) => s !== 'none');
    const or: Prisma.IssueWhereInput[] = [];
    if (ids.length) or.push({ epicId: { in: ids } });
    if (hasNone) or.push({ epicId: null });
    if (or.length) and.push({ OR: or });
  }

  if (filter.parentId) and.push({ parentId: filter.parentId });
  // Subtasks are shown inside their parent, so top-level lists exclude them.
  else if (!filter.includeSubtasks) and.push({ parentId: null });

  if (filter.search) {
    const q = filter.search.trim();
    and.push({
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { descriptionText: { contains: q, mode: 'insensitive' } },
        { issueKey: { contains: q.toUpperCase() } },
      ],
    });
  }

  if (filter.dueBefore) and.push({ dueDate: { lte: new Date(filter.dueBefore) } });
  if (filter.dueAfter) and.push({ dueDate: { gte: new Date(filter.dueAfter) } });
  if (filter.createdBefore) and.push({ createdAt: { lte: new Date(filter.createdBefore) } });
  if (filter.createdAfter) and.push({ createdAt: { gte: new Date(filter.createdAfter) } });
  if (filter.updatedAfter) and.push({ updatedAt: { gte: new Date(filter.updatedAfter) } });

  if (filter.isOverdue) {
    and.push({ dueDate: { lt: new Date() } });
    and.push({ status: { category: { notIn: [StatusCategory.COMPLETED, StatusCategory.CANCELED] as never } } });
  }

  if (filter.includeDone === false) {
    and.push({ status: { category: { notIn: [StatusCategory.COMPLETED, StatusCategory.CANCELED] as never } } });
  }

  return and.length === 1 ? and[0]! : { AND: and };
}

/** Prisma ordering matching `compareIssues`, with `id` as a stable tiebreaker. */
export function orderByFor(sort: SortKey, order: 'asc' | 'desc'): Prisma.IssueOrderByWithRelationInput[] {
  const dir = order;
  switch (sort) {
    case 'created':
      return [{ createdAt: dir }, { id: dir }];
    case 'updated':
      return [{ updatedAt: dir }, { id: dir }];
    case 'priority':
      // Enum order in the schema is URGENT → NONE, so ascending == most urgent.
      return [{ priority: dir === 'asc' ? 'asc' : 'desc' }, { rank: 'asc' }, { id: 'asc' }];
    case 'dueDate':
      return [{ dueDate: { sort: dir, nulls: 'last' } }, { id: 'asc' }];
    case 'title':
      return [{ title: dir }, { id: 'asc' }];
    case 'status':
      return [{ status: { position: dir } }, { rank: 'asc' }, { id: 'asc' }];
    case 'rank':
    default:
      return [{ rank: dir }, { id: 'asc' }];
  }
}

/** Field a cursor encodes for a given sort key. */
export function cursorFieldFor(sort: SortKey): 'rank' | 'createdAt' | 'updatedAt' | 'title' | 'dueDate' | 'priority' {
  switch (sort) {
    case 'created':
      return 'createdAt';
    case 'updated':
      return 'updatedAt';
    case 'title':
      return 'title';
    case 'dueDate':
      return 'dueDate';
    case 'priority':
      return 'priority';
    default:
      return 'rank';
  }
}
