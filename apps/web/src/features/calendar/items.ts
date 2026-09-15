/**
 * How tasks sit in the calendar, kept apart from the views so the rules are
 * written once.
 *
 * A task is placed by its dates, the way Weeek places it:
 *   - a period — start and due on different days — spans those days;
 *   - a date without a time belongs to the whole day;
 *   - a date with a time is a slot in that day: start–due when both are timed,
 *     otherwise the half hour leading up to the deadline.
 */
import { format } from 'date-fns';
import type { IssueSummaryDto, StatusDto, UpdateIssueInput } from '@flowdesk/contracts';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export interface CalendarItem {
  issue: IssueSummaryDto;
  /** Visual interval. For whole-day items the edges are the dates themselves. */
  start: Date;
  end: Date;
  /** Placed by time of day. */
  timed: boolean;
  /** Spans more than one day. */
  period: boolean;
  startKey: string;
  endKey: string;
  done: boolean;
}

export const dayKey = (date: Date): string => format(date, 'yyyy-MM-dd');

export function toItem(issue: IssueSummaryDto): CalendarItem | null {
  const due = issue.dueDate ? new Date(issue.dueDate) : null;
  const start = issue.startDate ? new Date(issue.startDate) : null;
  if (!due && !start) return null;

  const from = start ?? due!;
  const to = due ?? start!;
  const period = dayKey(from) !== dayKey(to);
  const timed = !period && (due ? issue.dueHasTime : issue.startHasTime);
  const done = issue.status.category === 'COMPLETED' || issue.status.category === 'CANCELED';

  let visualStart = from;
  let visualEnd = to;
  if (timed) {
    const bothTimed = Boolean(start && due && issue.startHasTime && issue.dueHasTime);
    if (!bothTimed) {
      // Only a deadline time: the half hour before it. Only a start time: the half hour after.
      visualStart = due ? new Date(to.getTime() - 30 * MINUTE) : from;
      visualEnd = due ? to : new Date(from.getTime() + 30 * MINUTE);
    }
    if (visualEnd.getTime() - visualStart.getTime() < 15 * MINUTE) {
      visualEnd = new Date(visualStart.getTime() + 15 * MINUTE);
    }
  }

  return { issue, start: visualStart, end: visualEnd, timed, period, startKey: dayKey(from), endKey: dayKey(to), done };
}

/** «10:00–12:00», «до 12:00», «с 10:00» — how a timed task reads on a card. */
export function timeLabel(issue: IssueSummaryDto): string {
  const hhmm = (value: string) => format(new Date(value), 'HH:mm');
  if (issue.startDate && issue.startHasTime && issue.dueDate && issue.dueHasTime) {
    return `${hhmm(issue.startDate)}–${hhmm(issue.dueDate)}`;
  }
  if (issue.dueDate && issue.dueHasTime) return `до ${hhmm(issue.dueDate)}`;
  if (issue.startDate && issue.startHasTime) return `с ${hhmm(issue.startDate)}`;
  return '';
}

/** Whole-day dates are stored at noon UTC: the same date in every Russian zone. */
export const wholeDay = (day: Date): string => new Date(`${dayKey(day)}T12:00:00.000Z`).toISOString();

/**
 * Moves a task to another day, keeping its times and the length of its period.
 * A task without dates lands on that day as a whole-day deadline.
 */
export function moveToDay(issue: IssueSummaryDto, from: string | null, to: Date): UpdateIssueInput {
  if (!issue.dueDate && !issue.startDate) return { dueDate: wholeDay(to), dueHasTime: false };
  const days = from ? Math.round((new Date(`${dayKey(to)}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / DAY) : 0;
  const shift = (value: string | null) => (value ? new Date(new Date(value).getTime() + days * DAY).toISOString() : null);
  return {
    startDate: shift(issue.startDate),
    dueDate: shift(issue.dueDate),
    startHasTime: issue.startHasTime,
    dueHasTime: issue.dueHasTime,
  };
}

/** Puts a task at a time of day. A timed task keeps its duration; anything else gets an hour. */
export function placeAt(item: CalendarItem | null, issue: IssueSummaryDto, day: Date, minutes: number): UpdateIssueInput {
  const duration =
    item?.timed && issue.startDate && issue.startHasTime && issue.dueDate && issue.dueHasTime
      ? item.end.getTime() - item.start.getTime()
      : 60 * MINUTE;
  const start = new Date(day);
  start.setHours(0, minutes, 0, 0);
  return {
    startDate: start.toISOString(),
    dueDate: new Date(start.getTime() + duration).toISOString(),
    startHasTime: true,
    dueHasTime: true,
  };
}

/** Takes a task off the clock: a whole-day deadline on that day. */
export function makeWholeDay(day: Date): UpdateIssueInput {
  return { startDate: null, startHasTime: false, dueDate: wholeDay(day), dueHasTime: false };
}

/** The status a checkbox moves a task to, and back. */
export function doneStatusId(statuses: StatusDto[]): string | undefined {
  return statuses.find((s) => s.category === 'COMPLETED')?.id;
}
export function reopenStatusId(statuses: StatusDto[]): string | undefined {
  return (
    statuses.find((s) => s.category === 'UNSTARTED')?.id ??
    statuses.find((s) => s.category !== 'COMPLETED' && s.category !== 'CANCELED')?.id
  );
}

/** Side-by-side lanes for timed items that overlap within one day. */
export function layoutTimed(items: CalendarItem[]): { item: CalendarItem; lane: number; lanes: number }[] {
  const sorted = [...items].sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime());
  const result: { item: CalendarItem; lane: number; lanes: number }[] = [];
  let cluster: { item: CalendarItem; lane: number }[] = [];
  let clusterEnd = 0;

  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) result.push({ ...c, lanes });
    cluster = [];
  };

  for (const item of sorted) {
    if (cluster.length && item.start.getTime() >= clusterEnd) flush();
    const laneEnds = new Map<number, number>();
    for (const c of cluster) laneEnds.set(c.lane, Math.max(laneEnds.get(c.lane) ?? 0, c.item.end.getTime()));
    let lane = 0;
    while ((laneEnds.get(lane) ?? 0) > item.start.getTime()) lane += 1;
    cluster.push({ item, lane });
    clusterEnd = Math.max(clusterEnd, item.end.getTime());
  }
  if (cluster.length) flush();
  return result;
}

/** Rows for period bars across a run of days: each bar takes the first row free over its span. */
export function layoutPeriods(
  items: CalendarItem[],
  dayKeys: string[],
): { item: CalendarItem; row: number; from: number; to: number }[] {
  const first = dayKeys[0]!;
  const last = dayKeys[dayKeys.length - 1]!;
  const visible = items
    .filter((item) => item.startKey <= last && item.endKey >= first)
    .sort((a, b) => a.startKey.localeCompare(b.startKey) || b.endKey.localeCompare(a.endKey));
  const rows: number[][] = [];
  const placed: { item: CalendarItem; row: number; from: number; to: number }[] = [];

  for (const item of visible) {
    // Days hidden from view (weekends switched off) are skipped over.
    let from = dayKeys.findIndex((key) => key >= item.startKey);
    let to = -1;
    for (let i = dayKeys.length - 1; i >= 0; i -= 1) {
      if (dayKeys[i]! <= item.endKey) {
        to = i;
        break;
      }
    }
    if (from === -1 || to === -1 || from > to) continue;
    from = Math.max(0, from);
    let row = 0;
    while (rows[row]?.some((index) => index >= from && index <= to)) row += 1;
    rows[row] = [...(rows[row] ?? []), ...Array.from({ length: to - from + 1 }, (_, i) => from + i)];
    placed.push({ item, row, from, to });
  }
  return placed;
}
