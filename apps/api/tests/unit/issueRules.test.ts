import { describe, expect, it } from 'vitest';
import { ActivityType, IssueType, StatusCategory } from '@flowdesk/contracts';
import {
  compareIssues,
  diffIssue,
  exceedsWipLimit,
  formatIssueKey,
  isClosedCategory,
  isDoneCategory,
  nextCompletedAt,
  validateHierarchy,
} from '../../src/domain/issueRules';

describe('completedAt derivation', () => {
  const now = new Date('2026-03-01T10:00:00.000Z');

  it('stamps a completion time when entering a completed status', () => {
    expect(nextCompletedAt(StatusCategory.COMPLETED, null, now)).toEqual(now);
  });

  it('keeps the original completion time on a second completed status', () => {
    const earlier = new Date('2026-02-01T00:00:00.000Z');
    expect(nextCompletedAt(StatusCategory.COMPLETED, earlier, now)).toEqual(earlier);
  });

  it('clears the completion time when reopened', () => {
    const earlier = new Date('2026-02-01T00:00:00.000Z');
    expect(nextCompletedAt(StatusCategory.STARTED, earlier, now)).toBeNull();
    expect(nextCompletedAt(StatusCategory.BACKLOG, earlier, now)).toBeNull();
  });

  it('does not treat cancelled work as completed', () => {
    expect(nextCompletedAt(StatusCategory.CANCELED, null, now)).toBeNull();
    expect(isDoneCategory(StatusCategory.CANCELED)).toBe(false);
    expect(isClosedCategory(StatusCategory.CANCELED)).toBe(true);
  });
});

describe('issue keys', () => {
  it('joins the project key and number', () => {
    expect(formatIssueKey('WEB', 42)).toBe('WEB-42');
  });
});

describe('hierarchy rules', () => {
  it('accepts a plain task with no links', () => {
    expect(validateHierarchy({ type: IssueType.TASK })).toBeNull();
  });

  it('refuses to nest an epic', () => {
    expect(validateHierarchy({ type: IssueType.EPIC, parentId: 'p1' })).toBe('EPIC_CANNOT_HAVE_PARENT');
    expect(validateHierarchy({ type: IssueType.EPIC, epicId: 'e1' })).toBe('EPIC_CANNOT_HAVE_EPIC');
  });

  it('requires a subtask to have a parent', () => {
    expect(validateHierarchy({ type: IssueType.SUBTASK })).toBe('SUBTASK_REQUIRES_PARENT');
    expect(
      validateHierarchy({ type: IssueType.SUBTASK, parentId: 'p1', parentType: IssueType.TASK }),
    ).toBeNull();
  });

  it('stops the hierarchy at one level of subtasks', () => {
    expect(
      validateHierarchy({ type: IssueType.SUBTASK, parentId: 'p1', parentType: IssueType.SUBTASK }),
    ).toBe('PARENT_CANNOT_BE_SUBTASK');
  });

  it('routes epic membership through the epic field, not the parent field', () => {
    expect(
      validateHierarchy({ type: IssueType.TASK, parentId: 'p1', parentType: IssueType.EPIC }),
    ).toBe('PARENT_MUST_NOT_BE_EPIC');
  });

  it('requires the epic field to point at an actual epic', () => {
    expect(
      validateHierarchy({ type: IssueType.TASK, epicId: 'e1', epicType: IssueType.TASK }),
    ).toBe('EPIC_MUST_BE_EPIC_TYPE');
    expect(
      validateHierarchy({ type: IssueType.TASK, epicId: 'e1', epicType: IssueType.EPIC }),
    ).toBeNull();
  });

  it('rejects self-references', () => {
    expect(validateHierarchy({ issueId: 'i1', type: IssueType.TASK, parentId: 'i1' })).toBe('SELF_REFERENCE');
    expect(validateHierarchy({ issueId: 'i1', type: IssueType.TASK, epicId: 'i1' })).toBe('SELF_REFERENCE');
  });
});

describe('WIP limits', () => {
  const status = { id: 's1', name: 'In Progress', category: StatusCategory.STARTED, wipLimit: 3 };

  it('blocks a card entering a full column', () => {
    expect(exceedsWipLimit(status, 3, true)).toBe(true);
    expect(exceedsWipLimit(status, 4, true)).toBe(true);
  });

  it('allows a card entering a column with room', () => {
    expect(exceedsWipLimit(status, 2, true)).toBe(false);
  });

  it('never blocks reordering inside a column', () => {
    // A limit lowered after the fact must not freeze the cards already there.
    expect(exceedsWipLimit(status, 10, false)).toBe(false);
  });

  it('ignores absent or zero limits', () => {
    expect(exceedsWipLimit({ ...status, wipLimit: null }, 99, true)).toBe(false);
    expect(exceedsWipLimit({ ...status, wipLimit: 0 }, 99, true)).toBe(false);
  });
});

describe('diffIssue', () => {
  const before = {
    title: 'Old title',
    statusId: 's1',
    priority: 'MEDIUM' as const,
    type: IssueType.TASK,
    assigneeId: null,
    epicId: null,
    sprintId: null,
    parentId: null,
    storyPoints: null,
    dueDate: null,
    descriptionText: null,
  };

  it('records only fields that are present and actually changed', () => {
    const changes = diffIssue(before, { title: 'New title', priority: 'MEDIUM' });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      type: ActivityType.TITLE_CHANGED,
      field: 'title',
      fromValue: 'Old title',
      toValue: 'New title',
    });
  });

  it('ignores fields that were not part of the patch', () => {
    expect(diffIssue(before, {})).toEqual([]);
  });

  it('records assignment and unassignment', () => {
    const assigned = diffIssue(before, { assigneeId: 'u2' });
    expect(assigned[0]).toMatchObject({ type: ActivityType.ASSIGNEE_CHANGED, fromValue: null, toValue: 'u2' });

    const unassigned = diffIssue({ ...before, assigneeId: 'u2' }, { assigneeId: null });
    expect(unassigned[0]).toMatchObject({ type: ActivityType.ASSIGNEE_CHANGED, fromValue: 'u2', toValue: null });
  });

  it('notes that the description changed without copying its contents', () => {
    const changes = diffIssue(before, { descriptionText: 'a very long body' });
    expect(changes[0]).toMatchObject({
      type: ActivityType.DESCRIPTION_CHANGED,
      field: 'description',
      fromValue: null,
      toValue: null,
    });
  });

  it('normalises dates before comparing', () => {
    const date = new Date('2026-04-01T00:00:00.000Z');
    const unchanged = diffIssue({ ...before, dueDate: date }, { dueDate: new Date(date) });
    expect(unchanged).toEqual([]);
  });
});

describe('compareIssues', () => {
  const base = {
    rank: 'M',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    priority: 'MEDIUM' as const,
    dueDate: null,
    title: 'b',
  };

  it('sorts the most urgent first when sorting by priority', () => {
    const urgent = { ...base, rank: 'Z', priority: 'URGENT' as const };
    const low = { ...base, rank: 'A', priority: 'LOW' as const };
    expect(compareIssues(urgent, low, 'priority', 'asc')).toBeLessThan(0);
  });

  it('always sinks issues without a due date, in both directions', () => {
    const withDate = { ...base, dueDate: '2026-02-01T00:00:00.000Z' };
    const without = { ...base, dueDate: null };
    expect(compareIssues(without, withDate, 'dueDate', 'asc')).toBeGreaterThan(0);
    expect(compareIssues(without, withDate, 'dueDate', 'desc')).toBeGreaterThan(0);
  });

  it('falls back to rank when the primary key ties', () => {
    const a = { ...base, rank: 'A', title: 'same' };
    const b = { ...base, rank: 'B', title: 'same' };
    expect(compareIssues(a, b, 'title', 'asc')).toBeLessThan(0);
  });

  it('reverses order for descending sorts', () => {
    const older = { ...base, createdAt: '2026-01-01T00:00:00.000Z' };
    const newer = { ...base, createdAt: '2026-06-01T00:00:00.000Z' };
    expect(compareIssues(older, newer, 'created', 'asc')).toBeLessThan(0);
    expect(compareIssues(older, newer, 'created', 'desc')).toBeGreaterThan(0);
  });

  it('produces a stable total order when used to sort a list', () => {
    const issues = [
      { ...base, rank: 'C', priority: 'LOW' as const },
      { ...base, rank: 'A', priority: 'URGENT' as const },
      { ...base, rank: 'B', priority: 'URGENT' as const },
    ];
    const sorted = [...issues].sort((x, y) => compareIssues(x, y, 'priority', 'asc'));
    expect(sorted.map((i) => i.rank)).toEqual(['A', 'B', 'C']);
  });
});
