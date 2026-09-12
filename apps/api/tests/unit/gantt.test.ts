import { describe, expect, it } from 'vitest';
import {
  DependencyType,
  criticalPath,
  findCycle,
  isSelfDependency,
  rollUpSchedule,
  suggestDependentShifts,
  validateWindow,
  type ScheduleEdge,
  type ScheduleNode,
} from '../../src/domain/gantt';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const node = (over: Partial<ScheduleNode> & { id: string }): ScheduleNode => ({
  parentId: null,
  startDate: null,
  dueDate: null,
  isMilestone: false,
  storyPoints: null,
  isComplete: false,
  ...over,
});

const edge = (
  predecessorId: string,
  successorId: string,
  type: ScheduleEdge['type'] = DependencyType.FINISH_TO_START,
  lagDays = 0,
): ScheduleEdge => ({ predecessorId, successorId, type, lagDays });

/* ------------------------------------------------------------- rollup */

describe('rollUpSchedule', () => {
  it('leaves a leaf issue with its own dates', () => {
    const bars = rollUpSchedule([node({ id: 'a', startDate: d('2026-03-01'), dueDate: d('2026-03-05') })]);
    expect(bars.get('a')).toMatchObject({ start: d('2026-03-01'), end: d('2026-03-05'), isSummary: false });
  });

  it('spans a parent across its children when the parent has no dates', () => {
    const bars = rollUpSchedule([
      node({ id: 'epic' }),
      node({ id: 'a', parentId: 'epic', startDate: d('2026-03-10'), dueDate: d('2026-03-12') }),
      node({ id: 'b', parentId: 'epic', startDate: d('2026-03-02'), dueDate: d('2026-03-20') }),
    ]);
    expect(bars.get('epic')).toMatchObject({
      start: d('2026-03-02'),
      end: d('2026-03-20'),
      isSummary: true,
    });
  });

  it('keeps a parent’s own dates when it has them', () => {
    // A lead may deliberately plan a phase wider than the sum of its parts.
    const bars = rollUpSchedule([
      node({ id: 'epic', startDate: d('2026-03-01'), dueDate: d('2026-03-31') }),
      node({ id: 'a', parentId: 'epic', startDate: d('2026-03-10'), dueDate: d('2026-03-12') }),
    ]);
    expect(bars.get('epic')).toMatchObject({ start: d('2026-03-01'), end: d('2026-03-31') });
  });

  it('weights progress by story points when the team estimates', () => {
    const bars = rollUpSchedule([
      node({ id: 'epic' }),
      node({ id: 'big', parentId: 'epic', storyPoints: 8, isComplete: true }),
      node({ id: 'small', parentId: 'epic', storyPoints: 2, isComplete: false }),
    ]);
    expect(bars.get('epic')!.progress).toBeCloseTo(0.8, 5);
  });

  it('falls back to counting leaves when nothing is estimated', () => {
    const bars = rollUpSchedule([
      node({ id: 'epic' }),
      node({ id: 'a', parentId: 'epic', isComplete: true }),
      node({ id: 'b', parentId: 'epic', isComplete: false }),
      node({ id: 'c', parentId: 'epic', isComplete: false }),
    ]);
    expect(bars.get('epic')!.progress).toBeCloseTo(1 / 3, 5);
  });

  it('rolls progress through three levels', () => {
    const bars = rollUpSchedule([
      node({ id: 'epic' }),
      node({ id: 'task', parentId: 'epic' }),
      node({ id: 'sub1', parentId: 'task', isComplete: true }),
      node({ id: 'sub2', parentId: 'task', isComplete: false }),
    ]);
    expect(bars.get('task')!.progress).toBeCloseTo(0.5, 5);
    expect(bars.get('epic')!.progress).toBeCloseTo(0.5, 5);
    expect(bars.get('epic')!.leafCount).toBe(2);
  });

  it('reports no dates for a parent whose children are all unscheduled', () => {
    const bars = rollUpSchedule([node({ id: 'epic' }), node({ id: 'a', parentId: 'epic' })]);
    expect(bars.get('epic')).toMatchObject({ start: null, end: null });
  });

  it('does not hang on a parent cycle', () => {
    // Corrupt data must degrade, not spin forever.
    const bars = rollUpSchedule([
      node({ id: 'a', parentId: 'b' }),
      node({ id: 'b', parentId: 'a' }),
    ]);
    expect(bars.size).toBe(2);
  });
});

/* --------------------------------------------------------- dependencies */

describe('findCycle', () => {
  it('accepts a straight chain', () => {
    expect(findCycle([edge('a', 'b'), edge('b', 'c')])).toBeNull();
  });

  it('accepts a diamond', () => {
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];
    expect(findCycle(edges)).toBeNull();
  });

  it('detects a direct two-node cycle', () => {
    expect(findCycle([edge('a', 'b'), edge('b', 'a')])).not.toBeNull();
  });

  it('detects the cycle a candidate edge would close', () => {
    const existing = [edge('a', 'b'), edge('b', 'c')];
    expect(findCycle(existing, edge('c', 'a'))).not.toBeNull();
    expect(findCycle(existing, edge('a', 'c'))).toBeNull();
  });

  it('returns the path so the error can name the issues', () => {
    const cycle = findCycle([edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]);
    expect(cycle).toContain('a');
    expect(cycle).toContain('b');
    expect(cycle).toContain('c');
  });

  it('rejects a self-dependency', () => {
    expect(isSelfDependency(edge('a', 'a'))).toBe(true);
    expect(isSelfDependency(edge('a', 'b'))).toBe(false);
  });
});

/* -------------------------------------------------------- critical path */

describe('criticalPath', () => {
  it('marks a single chain entirely critical', () => {
    const bars = rollUpSchedule([
      node({ id: 'a', startDate: d('2026-03-01'), dueDate: d('2026-03-03') }),
      node({ id: 'b', startDate: d('2026-03-03'), dueDate: d('2026-03-06') }),
    ]);
    const cp = criticalPath(bars, [edge('a', 'b')]);
    expect(cp.get('a')!.isCritical).toBe(true);
    expect(cp.get('b')!.isCritical).toBe(true);
    expect(cp.get('a')!.slackDays).toBe(0);
  });

  it('gives the shorter parallel branch slack', () => {
    //   a ─┬─> long(6d) ─┬─> end
    //      └─> short(1d) ┘
    const bars = rollUpSchedule([
      node({ id: 'a', startDate: d('2026-03-01'), dueDate: d('2026-03-02') }),
      node({ id: 'long', startDate: d('2026-03-02'), dueDate: d('2026-03-08') }),
      node({ id: 'short', startDate: d('2026-03-02'), dueDate: d('2026-03-03') }),
      node({ id: 'end', startDate: d('2026-03-08'), dueDate: d('2026-03-09') }),
    ]);
    const cp = criticalPath(bars, [
      edge('a', 'long'),
      edge('a', 'short'),
      edge('long', 'end'),
      edge('short', 'end'),
    ]);

    expect(cp.get('long')!.isCritical).toBe(true);
    expect(cp.get('short')!.isCritical).toBe(false);
    expect(cp.get('short')!.slackDays).toBeGreaterThan(0);
  });

  it('accounts for lag on a finish-to-start link', () => {
    const bars = rollUpSchedule([
      node({ id: 'a', startDate: d('2026-03-01'), dueDate: d('2026-03-03') }),
      node({ id: 'b', startDate: d('2026-03-03'), dueDate: d('2026-03-05') }),
    ]);
    const withLag = criticalPath(bars, [edge('a', 'b', DependencyType.FINISH_TO_START, 2)]);
    // The successor cannot start before the predecessor finishes plus the lag.
    expect(withLag.get('b')!.earlyStart).toBe(4);
  });

  it('handles start-to-start links', () => {
    const bars = rollUpSchedule([
      node({ id: 'a', startDate: d('2026-03-01'), dueDate: d('2026-03-10') }),
      node({ id: 'b', startDate: d('2026-03-01'), dueDate: d('2026-03-04') }),
    ]);
    const cp = criticalPath(bars, [edge('a', 'b', DependencyType.START_TO_START)]);
    expect(cp.get('b')!.earlyStart).toBe(0);
  });

  it('ignores issues that have no dates', () => {
    const bars = rollUpSchedule([
      node({ id: 'a', startDate: d('2026-03-01'), dueDate: d('2026-03-03') }),
      node({ id: 'unscheduled' }),
    ]);
    const cp = criticalPath(bars, [edge('a', 'unscheduled')]);
    expect(cp.has('unscheduled')).toBe(false);
    expect(cp.has('a')).toBe(true);
  });

  it('returns nothing for an empty schedule', () => {
    expect(criticalPath(new Map(), []).size).toBe(0);
  });

  it('does not hang when the graph contains a cycle', () => {
    const bars = rollUpSchedule([
      node({ id: 'a', startDate: d('2026-03-01'), dueDate: d('2026-03-02') }),
      node({ id: 'b', startDate: d('2026-03-02'), dueDate: d('2026-03-03') }),
    ]);
    const cp = criticalPath(bars, [edge('a', 'b'), edge('b', 'a')]);
    expect(cp.size).toBe(2);
  });
});

/* ------------------------------------------------------------- shifting */

describe('suggestDependentShifts', () => {
  it('suggests moving a successor that now overlaps its predecessor', () => {
    const bars = rollUpSchedule([
      node({ id: 'a', startDate: d('2026-03-01'), dueDate: d('2026-03-10') }),
      node({ id: 'b', startDate: d('2026-03-05'), dueDate: d('2026-03-08') }),
    ]);
    const shifts = suggestDependentShifts(bars, [edge('a', 'b')], 'a');
    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.issueId).toBe('b');
    expect(shifts[0]!.days).toBe(5);
  });

  it('suggests nothing when the constraint already holds', () => {
    const bars = rollUpSchedule([
      node({ id: 'a', startDate: d('2026-03-01'), dueDate: d('2026-03-03') }),
      node({ id: 'b', startDate: d('2026-03-05'), dueDate: d('2026-03-08') }),
    ]);
    expect(suggestDependentShifts(bars, [edge('a', 'b')], 'a')).toEqual([]);
  });

  it('cascades down a chain, measuring each link against the shifted dates', () => {
    const bars = rollUpSchedule([
      node({ id: 'a', startDate: d('2026-03-01'), dueDate: d('2026-03-10') }),
      node({ id: 'b', startDate: d('2026-03-02'), dueDate: d('2026-03-04') }),
      node({ id: 'c', startDate: d('2026-03-03'), dueDate: d('2026-03-05') }),
    ]);
    const shifts = suggestDependentShifts(bars, [edge('a', 'b'), edge('b', 'c')], 'a');
    expect(shifts.map((s) => s.issueId)).toEqual(['b', 'c']);
    // b moves off a's new finish; c must be measured against b's shifted
    // finish, so the b→c constraint still holds once the shifts are applied.
    expect(shifts[0]).toMatchObject({ issueId: 'b', days: 8, toStart: d('2026-03-10') });
    expect(shifts[1]).toMatchObject({ issueId: 'c', days: 9, toStart: d('2026-03-12') });
  });

  it('does not revisit a node twice in a diamond', () => {
    const bars = rollUpSchedule([
      node({ id: 'a', startDate: d('2026-03-01'), dueDate: d('2026-03-10') }),
      node({ id: 'b', startDate: d('2026-03-02'), dueDate: d('2026-03-04') }),
      node({ id: 'c', startDate: d('2026-03-02'), dueDate: d('2026-03-04') }),
      node({ id: 'd', startDate: d('2026-03-03'), dueDate: d('2026-03-06') }),
    ]);
    const shifts = suggestDependentShifts(
      bars,
      [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')],
      'a',
    );
    expect(shifts.filter((s) => s.issueId === 'd')).toHaveLength(1);
  });
});

describe('validateWindow', () => {
  it('accepts a window where the start precedes the end', () => {
    expect(validateWindow(d('2026-03-01'), d('2026-03-02'))).toBe(true);
    expect(validateWindow(d('2026-03-01'), d('2026-03-01'))).toBe(true);
  });

  it('rejects an inverted window', () => {
    expect(validateWindow(d('2026-03-05'), d('2026-03-01'))).toBe(false);
  });

  it('accepts a half-open window', () => {
    expect(validateWindow(d('2026-03-01'), null)).toBe(true);
    expect(validateWindow(null, d('2026-03-01'))).toBe(true);
  });
});
