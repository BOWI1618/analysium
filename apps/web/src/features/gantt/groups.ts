import type { GanttRowDto, IssuePriority } from '@flowdesk/contracts';
import { ISSUE_PRIORITIES } from '@flowdesk/contracts';
import { PRIORITY_META } from '~/components/IssueMeta';

export type GanttGroupBy = 'none' | 'status' | 'assignee' | 'priority';

export const GANTT_GROUP_LABELS: Record<GanttGroupBy, string> = {
  none: 'Без групп',
  status: 'Статус',
  assignee: 'Исполнитель',
  priority: 'Приоритет',
};

/** A line of the chart: a group's heading or a task. */
export type GanttLine =
  | { kind: 'group'; key: string; label: string; accent?: string; count: number; collapsed: boolean }
  | { kind: 'issue'; row: GanttRowDto };

/** Collapsed groups share the chart's collapsed set under this prefix. */
export const groupCollapseKey = (key: string) => `group:${key}`;

/**
 * The rows as lines on screen: grouped by a property of each top-level task
 * (subtasks stay under their parent), with folded tasks and groups left out.
 */
export function ganttLines(rows: GanttRowDto[], groupBy: GanttGroupBy, collapsed: Set<string>): GanttLine[] {
  const byId = new Map(rows.map((r) => [r.id, r]));

  const isHidden = (row: GanttRowDto): boolean => {
    let parentId = row.parentId;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      if (collapsed.has(parentId)) return true;
      seen.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    return false;
  };

  if (groupBy === 'none') {
    return rows.filter((row) => !isHidden(row)).map((row) => ({ kind: 'issue', row }));
  }

  const rootOf = (row: GanttRowDto) => {
    let current = row;
    const seen = new Set<string>();
    while (current.parentId && byId.has(current.parentId) && !seen.has(current.parentId)) {
      seen.add(current.parentId);
      current = byId.get(current.parentId)!;
    }
    return current;
  };

  const groups = new Map<string, { key: string; label: string; accent?: string; order: number; rows: GanttRowDto[]; count: number }>();
  for (const row of rows) {
    const root = rootOf(row);
    const [key, label, accent, order] =
      groupBy === 'status'
        ? [root.status.id, root.status.name, root.status.color, root.status.position]
        : groupBy === 'assignee'
          ? [root.assignee?.id ?? 'none', root.assignee?.name ?? 'Без исполнителя', undefined, root.assignee ? 0 : 1]
          : [root.priority, PRIORITY_META[root.priority as IssuePriority].label, undefined, ISSUE_PRIORITIES.indexOf(root.priority)];
    const group = groups.get(key) ?? { key, label, accent, order, rows: [], count: 0 };
    group.rows.push(row);
    if (root === row) group.count += 1;
    groups.set(key, group);
  }

  return [...groups.values()]
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'ru'))
    .flatMap((group) => {
      const folded = collapsed.has(groupCollapseKey(group.key));
      const heading: GanttLine = {
        kind: 'group',
        key: group.key,
        label: group.label,
        accent: group.accent,
        count: group.count,
        collapsed: folded,
      };
      return folded
        ? [heading]
        : [heading, ...group.rows.filter((row) => !isHidden(row)).map((row): GanttLine => ({ kind: 'issue', row }))];
    });
}
