/**
 * Scheduling maths for the Gantt view.
 *
 * Pure functions only — no Prisma, no Fastify. The critical-path calculation,
 * the summary rollup and the cycle check are the parts most likely to be wrong
 * in subtle ways, so they are kept testable without a database.
 */

export const DependencyType = {
  FINISH_TO_START: 'FINISH_TO_START',
  START_TO_START: 'START_TO_START',
  FINISH_TO_FINISH: 'FINISH_TO_FINISH',
  START_TO_FINISH: 'START_TO_FINISH',
} as const;
export type DependencyType = (typeof DependencyType)[keyof typeof DependencyType];

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface ScheduleNode {
  id: string;
  parentId: string | null;
  /** Explicitly scheduled dates. Either may be missing. */
  startDate: Date | null;
  dueDate: Date | null;
  isMilestone: boolean;
  /** Weight used when rolling progress up to a summary row. */
  storyPoints: number | null;
  isComplete: boolean;
}

export interface ScheduleEdge {
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagDays: number;
}

/* ------------------------------------------------------------ hierarchy */

export interface RolledUpBar {
  id: string;
  start: Date | null;
  end: Date | null;
  /** 0–1. Weighted by story points when present, by count otherwise. */
  progress: number;
  /** True when the dates were derived from children rather than set directly. */
  isSummary: boolean;
  /** Number of leaf descendants, used for the progress denominator. */
  leafCount: number;
}

/**
 * Computes each row's bar from its own dates and its children's.
 *
 * A parent with its own dates keeps them — a lead may deliberately plan a phase
 * wider than the sum of its parts. A parent without dates spans its children.
 */
export function rollUpSchedule(nodes: ScheduleNode[]): Map<string, RolledUpBar> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();

  for (const node of nodes) {
    if (node.parentId && byId.has(node.parentId)) {
      const list = children.get(node.parentId) ?? [];
      list.push(node.id);
      children.set(node.parentId, list);
    }
  }

  const result = new Map<string, RolledUpBar>();
  const visiting = new Set<string>();

  const resolve = (id: string): RolledUpBar => {
    const cached = result.get(id);
    if (cached) return cached;

    const node = byId.get(id)!;

    // A malformed parent chain must not hang the request.
    if (visiting.has(id)) {
      const fallback: RolledUpBar = {
        id,
        start: node.startDate,
        end: node.dueDate,
        progress: node.isComplete ? 1 : 0,
        isSummary: false,
        leafCount: 1,
      };
      result.set(id, fallback);
      return fallback;
    }
    visiting.add(id);

    const childIds = children.get(id) ?? [];
    if (childIds.length === 0) {
      const bar: RolledUpBar = {
        id,
        start: node.startDate,
        end: node.dueDate ?? node.startDate,
        progress: node.isComplete ? 1 : 0,
        isSummary: false,
        leafCount: 1,
      };
      visiting.delete(id);
      result.set(id, bar);
      return bar;
    }

    const childBars = childIds.map(resolve);

    const childStarts = childBars.map((b) => b.start).filter((d): d is Date => d !== null);
    const childEnds = childBars.map((b) => b.end).filter((d): d is Date => d !== null);

    const derivedStart = childStarts.length
      ? new Date(Math.min(...childStarts.map((d) => d.getTime())))
      : null;
    const derivedEnd = childEnds.length
      ? new Date(Math.max(...childEnds.map((d) => d.getTime())))
      : null;

    // Weight by story points when the team estimates, by leaf count when it does not.
    const weightOf = (childId: string): number => {
      const child = byId.get(childId)!;
      const bar = result.get(childId)!;
      return child.storyPoints && child.storyPoints > 0 ? child.storyPoints : bar.leafCount;
    };

    const totalWeight = childIds.reduce((sum, childId) => sum + weightOf(childId), 0);
    const doneWeight = childIds.reduce(
      (sum, childId) => sum + weightOf(childId) * result.get(childId)!.progress,
      0,
    );

    const bar: RolledUpBar = {
      id,
      start: node.startDate ?? derivedStart,
      end: node.dueDate ?? derivedEnd,
      progress: totalWeight > 0 ? doneWeight / totalWeight : node.isComplete ? 1 : 0,
      isSummary: true,
      leafCount: childBars.reduce((sum, b) => sum + b.leafCount, 0),
    };

    visiting.delete(id);
    result.set(id, bar);
    return bar;
  };

  for (const node of nodes) resolve(node.id);
  return result;
}

/* ----------------------------------------------------------- dependencies */

/**
 * Returns the cycle an edge would close, or null when it is safe to add.
 * Returned as the path so the error message can name the issues involved.
 */
export function findCycle(edges: ScheduleEdge[], candidate?: ScheduleEdge): string[] | null {
  const all = candidate ? [...edges, candidate] : edges;

  const outgoing = new Map<string, string[]>();
  for (const edge of all) {
    const list = outgoing.get(edge.predecessorId) ?? [];
    list.push(edge.successorId);
    outgoing.set(edge.predecessorId, list);
  }

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    colour.set(id, GREY);
    stack.push(id);

    for (const next of outgoing.get(id) ?? []) {
      const state = colour.get(next) ?? WHITE;
      if (state === GREY) {
        // Found a back edge: the cycle is the stack from `next` onwards.
        return [...stack.slice(stack.indexOf(next)), next];
      }
      if (state === WHITE) {
        const cycle = visit(next);
        if (cycle) return cycle;
      }
    }

    stack.pop();
    colour.set(id, BLACK);
    return null;
  };

  for (const id of outgoing.keys()) {
    if ((colour.get(id) ?? WHITE) === WHITE) {
      const cycle = visit(id);
      if (cycle) return cycle;
    }
  }
  return null;
}

/** A self-dependency is a cycle of length one and is never valid. */
export function isSelfDependency(edge: ScheduleEdge): boolean {
  return edge.predecessorId === edge.successorId;
}

/* ------------------------------------------------------- critical path */

export interface CriticalPathEntry {
  id: string;
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  /** Days of delay the task can absorb without pushing the project end. */
  slackDays: number;
  isCritical: boolean;
}

/**
 * Critical path method over the scheduled bars.
 *
 * Times are day offsets from the earliest start in the project, which keeps the
 * arithmetic in plain numbers and avoids timezone drift. Tasks with no dates
 * are skipped: they cannot constrain a schedule they are not on.
 */
export function criticalPath(
  bars: Map<string, RolledUpBar>,
  edges: ScheduleEdge[],
): Map<string, CriticalPathEntry> {
  const scheduled = [...bars.values()].filter(
    (b): b is RolledUpBar & { start: Date; end: Date } => b.start !== null && b.end !== null,
  );
  const result = new Map<string, CriticalPathEntry>();
  if (scheduled.length === 0) return result;

  const origin = Math.min(...scheduled.map((b) => b.start.getTime()));
  const toDay = (date: Date) => Math.round((date.getTime() - origin) / DAY_MS);

  const duration = new Map<string, number>();
  for (const bar of scheduled) {
    duration.set(bar.id, Math.max(0, toDay(bar.end) - toDay(bar.start)));
  }

  const ids = new Set(scheduled.map((b) => b.id));
  const relevant = edges.filter((e) => ids.has(e.predecessorId) && ids.has(e.successorId));

  const incoming = new Map<string, ScheduleEdge[]>();
  const outgoing = new Map<string, ScheduleEdge[]>();
  for (const edge of relevant) {
    incoming.set(edge.successorId, [...(incoming.get(edge.successorId) ?? []), edge]);
    outgoing.set(edge.predecessorId, [...(outgoing.get(edge.predecessorId) ?? []), edge]);
  }

  const order = topologicalOrder([...ids], relevant);

  // Forward pass — earliest each task can start given its predecessors.
  const earlyStart = new Map<string, number>();
  const earlyFinish = new Map<string, number>();

  for (const id of order) {
    const bar = bars.get(id)!;
    const ownStart = toDay(bar.start!);
    let start = ownStart;

    for (const edge of incoming.get(id) ?? []) {
      const predStart = earlyStart.get(edge.predecessorId) ?? 0;
      const predFinish = earlyFinish.get(edge.predecessorId) ?? 0;
      const lag = edge.lagDays;

      const constraint =
        edge.type === DependencyType.FINISH_TO_START
          ? predFinish + lag
          : edge.type === DependencyType.START_TO_START
            ? predStart + lag
            : edge.type === DependencyType.FINISH_TO_FINISH
              ? predFinish + lag - (duration.get(id) ?? 0)
              : predStart + lag - (duration.get(id) ?? 0);

      start = Math.max(start, constraint);
    }

    earlyStart.set(id, start);
    earlyFinish.set(id, start + (duration.get(id) ?? 0));
  }

  const projectFinish = Math.max(...[...earlyFinish.values()]);

  // Backward pass — latest each task can finish without moving the project end.
  const lateFinish = new Map<string, number>();
  const lateStart = new Map<string, number>();

  for (const id of [...order].reverse()) {
    let finish = projectFinish;
    const successors = outgoing.get(id) ?? [];

    if (successors.length > 0) {
      finish = Math.min(
        ...successors.map((edge) => {
          const succStart = lateStart.get(edge.successorId) ?? projectFinish;
          const succFinish = lateFinish.get(edge.successorId) ?? projectFinish;
          const lag = edge.lagDays;

          switch (edge.type) {
            case DependencyType.FINISH_TO_START:
              return succStart - lag;
            case DependencyType.START_TO_START:
              return succStart - lag + (duration.get(id) ?? 0);
            case DependencyType.FINISH_TO_FINISH:
              return succFinish - lag;
            default:
              return succFinish - lag + (duration.get(id) ?? 0);
          }
        }),
      );
    }

    lateFinish.set(id, finish);
    lateStart.set(id, finish - (duration.get(id) ?? 0));
  }

  for (const id of ids) {
    const es = earlyStart.get(id) ?? 0;
    const ef = earlyFinish.get(id) ?? 0;
    const ls = lateStart.get(id) ?? 0;
    const lf = lateFinish.get(id) ?? 0;
    const slack = ls - es;

    result.set(id, {
      id,
      earlyStart: es,
      earlyFinish: ef,
      lateStart: ls,
      lateFinish: lf,
      slackDays: slack,
      isCritical: slack <= 0,
    });
  }

  return result;
}

/** Kahn's algorithm; nodes in a cycle are appended so nothing is dropped. */
function topologicalOrder(ids: string[], edges: ScheduleEdge[]): string[] {
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>();

  for (const edge of edges) {
    indegree.set(edge.successorId, (indegree.get(edge.successorId) ?? 0) + 1);
    outgoing.set(edge.predecessorId, [...(outgoing.get(edge.predecessorId) ?? []), edge.successorId]);
  }

  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  if (order.length < ids.length) {
    for (const id of ids) if (!order.includes(id)) order.push(id);
  }
  return order;
}

/* --------------------------------------------------- dependency shifting */

export interface SuggestedShift {
  issueId: string;
  fromStart: Date;
  toStart: Date;
  days: number;
}

/**
 * When a task moves, its successors may be violated. This reports the shifts
 * needed to restore the constraints — it never applies them, because silently
 * rescheduling someone else's work is exactly the behaviour teams hate in
 * planning tools.
 */
export function suggestDependentShifts(
  bars: Map<string, RolledUpBar>,
  edges: ScheduleEdge[],
  movedId: string,
): SuggestedShift[] {
  const shifts: SuggestedShift[] = [];
  const seen = new Set<string>([movedId]);
  const queue: string[] = [movedId];
  // Virtual shift accumulated by each task the cascade has already moved.
  // Successors must be measured against these shifted dates, not the stored
  // ones, or a chain a→b→c would leave b→c violated after applying the shifts.
  const deltaMs = new Map<string, number>([[movedId, 0]]);

  const outgoing = new Map<string, ScheduleEdge[]>();
  for (const edge of edges) {
    outgoing.set(edge.predecessorId, [...(outgoing.get(edge.predecessorId) ?? []), edge]);
  }

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const current = bars.get(currentId);
    const currentDelta = deltaMs.get(currentId) ?? 0;
    if (!current?.start || !current.end) continue;

    for (const edge of outgoing.get(currentId) ?? []) {
      if (seen.has(edge.successorId)) continue;

      const successor = bars.get(edge.successorId);
      if (!successor?.start || !successor.end) continue;

      const required =
        edge.type === DependencyType.FINISH_TO_START
          ? current.end.getTime() + currentDelta + edge.lagDays * DAY_MS
          : edge.type === DependencyType.START_TO_START
            ? current.start.getTime() + currentDelta + edge.lagDays * DAY_MS
            : null;

      // Only the two relations that constrain the successor's *start* produce a
      // concrete suggestion; the others are reported by the critical path.
      if (required === null) continue;
      if (successor.start.getTime() >= required) continue;

      const days = Math.round((required - successor.start.getTime()) / DAY_MS);
      shifts.push({
        issueId: edge.successorId,
        fromStart: successor.start,
        toStart: new Date(required),
        days,
      });

      deltaMs.set(edge.successorId, required - successor.start.getTime());
      seen.add(edge.successorId);
      queue.push(edge.successorId);
    }
  }

  return shifts;
}

/** Guards the invariant that a bar cannot end before it starts. */
export function validateWindow(start: Date | null, end: Date | null): boolean {
  if (!start || !end) return true;
  return start.getTime() <= end.getTime();
}
