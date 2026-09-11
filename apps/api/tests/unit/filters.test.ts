import { describe, expect, it } from 'vitest';
import { ISSUE_PRIORITIES, ISSUE_TYPES } from '@flowdesk/contracts';
import { buildIssueWhere, cursorFieldFor, orderByFor } from '../../src/domain/filters';
import type { FilterScope } from '../../src/domain/filters';

const opts = { priorities: ISSUE_PRIORITIES, types: ISSUE_TYPES };
const scope: FilterScope = { workspaceId: 'w1', allowedProjectIds: 'ALL', currentUserId: 'me' };

/** Flattens the nested AND tree so assertions can look for one clause. */
function clauses(where: Record<string, unknown>): Record<string, unknown>[] {
  const list = (where.AND as Record<string, unknown>[] | undefined) ?? [where];
  return list.flatMap((c) => ((c.AND as Record<string, unknown>[] | undefined) ? clauses(c) : [c]));
}

describe('workspace scoping', () => {
  it('always constrains to the caller’s workspace', () => {
    const where = buildIssueWhere({}, scope, opts);
    expect(clauses(where)).toContainEqual({ project: { workspaceId: 'w1' } });
  });

  it('restricts a guest to their explicit project list', () => {
    const where = buildIssueWhere({}, { ...scope, allowedProjectIds: ['p1', 'p2'] }, opts);
    expect(clauses(where)).toContainEqual({ projectId: { in: ['p1', 'p2'] } });
  });

  it('produces an empty-list clause for a guest with no projects', () => {
    // An empty `in` must still be emitted — dropping it would widen the query.
    const where = buildIssueWhere({}, { ...scope, allowedProjectIds: [] }, opts);
    expect(clauses(where)).toContainEqual({ projectId: { in: [] } });
  });

  it('hides archived issues by default', () => {
    expect(clauses(buildIssueWhere({}, scope, opts))).toContainEqual({ archivedAt: null });
  });

  it('excludes subtasks from top-level lists unless asked for', () => {
    expect(clauses(buildIssueWhere({}, scope, opts))).toContainEqual({ parentId: null });
    expect(clauses(buildIssueWhere({ includeSubtasks: true }, scope, opts))).not.toContainEqual({ parentId: null });
  });
});

describe('facet filters', () => {
  it('resolves @me to the current user', () => {
    const where = buildIssueWhere({ assigneeId: ['@me'] }, scope, opts);
    expect(clauses(where)).toContainEqual({ OR: [{ assigneeId: { in: ['me'] } }] });
  });

  it('supports an explicit unassigned bucket alongside real users', () => {
    const where = buildIssueWhere({ assigneeId: ['u1', 'none'] }, scope, opts);
    expect(clauses(where)).toContainEqual({
      OR: [{ assigneeId: { in: ['u1'] } }, { assigneeId: null }],
    });
  });

  it('requires every selected label (AND, not OR)', () => {
    const flat = clauses(buildIssueWhere({ labelId: ['l1', 'l2'] }, scope, opts));
    expect(flat).toContainEqual({ labels: { some: { labelId: 'l1' } } });
    expect(flat).toContainEqual({ labels: { some: { labelId: 'l2' } } });
  });

  it('drops enum values that are not part of the contract', () => {
    const where = buildIssueWhere({ priority: ['URGENT', 'DROP TABLE'] }, scope, opts);
    expect(clauses(where)).toContainEqual({ priority: { in: ['URGENT'] } });
  });

  it('ignores an enum filter whose values are all invalid', () => {
    const where = buildIssueWhere({ type: ['nope'] }, scope, opts);
    expect(clauses(where).some((c) => 'type' in c)).toBe(false);
  });

  it('searches title, description text and key together', () => {
    const where = buildIssueWhere({ search: 'login' }, scope, opts);
    const search = clauses(where).find((c) => Array.isArray(c.OR) && JSON.stringify(c.OR).includes('title'));
    expect(JSON.stringify(search)).toContain('"contains":"login"');
    expect(JSON.stringify(search)).toContain('LOGIN');
  });

  it('treats overdue as past due and not yet closed', () => {
    const flat = clauses(buildIssueWhere({ isOverdue: true }, scope, opts));
    expect(flat.some((c) => JSON.stringify(c).includes('"lt"'))).toBe(true);
    expect(flat.some((c) => JSON.stringify(c).includes('COMPLETED'))).toBe(true);
  });

  it('filters the backlog to issues with no sprint', () => {
    expect(clauses(buildIssueWhere({ noSprint: true }, scope, opts))).toContainEqual({ sprintId: null });
  });

  it('hides completed work when includeDone is false', () => {
    const flat = clauses(buildIssueWhere({ includeDone: false }, scope, opts));
    expect(flat.some((c) => JSON.stringify(c).includes('notIn'))).toBe(true);
  });
});

describe('ordering', () => {
  it('always ends with a stable tiebreaker', () => {
    for (const sort of ['rank', 'created', 'updated', 'priority', 'dueDate', 'title', 'status'] as const) {
      const order = orderByFor(sort, 'asc');
      const last = JSON.stringify(order[order.length - 1]);
      expect(last === '{"id":"asc"}' || last === '{"id":"desc"}').toBe(true);
    }
  });

  it('sends issues with no due date to the end', () => {
    expect(JSON.stringify(orderByFor('dueDate', 'asc'))).toContain('"nulls":"last"');
  });

  it('maps each sort key to the column its cursor encodes', () => {
    expect(cursorFieldFor('created')).toBe('createdAt');
    expect(cursorFieldFor('updated')).toBe('updatedAt');
    expect(cursorFieldFor('rank')).toBe('rank');
    expect(cursorFieldFor('title')).toBe('title');
  });
});
