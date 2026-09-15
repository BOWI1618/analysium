/**
 * Timeline geometry.
 *
 * Kept apart from the components so the pixel maths — which is where a Gantt
 * usually goes subtly wrong — can be reasoned about and tested on its own.
 */
import {
  addDays,
  addMonths,
  addQuarters,
  addWeeks,
  differenceInCalendarDays,
  eachDayOfInterval,
  eachMonthOfInterval,
  eachQuarterOfInterval,
  eachWeekOfInterval,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  format,
  isWeekend,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import type { GanttScale } from '@flowdesk/contracts';

/** Pixels per day at each zoom level. */
export const DAY_WIDTH: Record<GanttScale, number> = {
  DAY: 36,
  WEEK: 14,
  MONTH: 5,
  QUARTER: 2,
};

export const ROW_HEIGHT = 36;

export interface TimelineTick {
  key: string;
  label: string;
  /** Offset in pixels from the start of the timeline. */
  x: number;
  width: number;
  isWeekend: boolean;
  isToday: boolean;
}

export interface Timeline {
  start: Date;
  end: Date;
  dayWidth: number;
  totalWidth: number;
  /** Coarse header row: months, or quarters at the widest zoom. */
  majorTicks: TimelineTick[];
  /** Fine header row: days or weeks depending on zoom. */
  minorTicks: TimelineTick[];
  todayX: number | null;
}

/** How far past the planned work (or today) the chart reaches at each zoom. */
const FUTURE_ROOM: Record<GanttScale, (date: Date) => Date> = {
  DAY: (d) => addDays(d, 14),
  WEEK: (d) => addWeeks(d, 8),
  MONTH: (d) => addMonths(d, 6),
  QUARTER: (d) => addQuarters(d, 2),
};

/** Snaps a date to the start / end of the unit the header is drawn in. */
const alignStart = (scale: GanttScale, d: Date) =>
  scale === 'QUARTER' ? startOfQuarter(d) : scale === 'MONTH' ? startOfMonth(d) : startOfWeek(d, { weekStartsOn: 1 });
const alignEnd = (scale: GanttScale, d: Date) =>
  scale === 'QUARTER' ? endOfQuarter(d) : scale === 'MONTH' ? endOfMonth(d) : endOfWeek(d, { weekStartsOn: 1 });
const nextUnit = (scale: GanttScale, d: Date) =>
  scale === 'QUARTER' ? addQuarters(d, 1) : scale === 'MONTH' ? addMonths(d, 1) : addWeeks(d, 1);

/**
 * The visible span: the planned work and today, padded so bars never touch the
 * edge, with room ahead to drag work later, and never narrower than the
 * viewport — a chart that stops short leaves an unexplained blank area.
 * Edges snap to whole weeks, months or quarters, so every header cell is
 * complete and labelled (a quarter view starting in August used to have no
 * label for the current quarter at all).
 */
export function buildTimeline(
  rangeStart: Date,
  rangeEnd: Date,
  scale: GanttScale,
  minWidthPx = 0,
): Timeline {
  const dayWidth = DAY_WIDTH[scale];
  const today = startOfDay(new Date());

  const from = rangeStart < today ? rangeStart : today;
  const to = rangeEnd > today ? rangeEnd : today;

  const padBefore = scale === 'DAY' ? 3 : scale === 'WEEK' ? 7 : 14;
  const start = startOfDay(alignStart(scale, addDays(from, -padBefore)));
  let end = startOfDay(alignEnd(scale, FUTURE_ROOM[scale](to)));
  while ((differenceInCalendarDays(end, start) + 1) * dayWidth < minWidthPx) {
    end = startOfDay(alignEnd(scale, nextUnit(scale, end)));
  }

  const totalDays = Math.max(1, differenceInCalendarDays(end, start) + 1);
  const totalWidth = totalDays * dayWidth;
  const xFor = (date: Date) => differenceInCalendarDays(startOfDay(date), start) * dayWidth;

  const todayX = today >= start && today <= end ? xFor(today) : null;

  /** A header cell from `cellStart` to `cellEnd`, clipped to the timeline. */
  const cell = (key: string, label: string, cellStart: Date, cellEnd: Date): TimelineTick => {
    const x = Math.max(0, xFor(cellStart));
    const right = Math.min(totalWidth, (differenceInCalendarDays(startOfDay(cellEnd), start) + 1) * dayWidth);
    return { key, label, x, width: Math.max(0, right - x), isWeekend: false, isToday: false };
  };

  const majorTicks: TimelineTick[] =
    scale === 'QUARTER'
      ? eachQuarterOfInterval({ start, end }).map((d) =>
          cell(`q-${d.toISOString()}`, `${Math.floor(d.getMonth() / 3) + 1} кв. ${format(d, 'yyyy')}`, d, endOfQuarter(d)),
        )
      : eachMonthOfInterval({ start, end }).map((d) =>
          cell(`m-${d.toISOString()}`, format(d, 'LLLL yyyy', { locale: ru }), d, endOfMonth(d)),
        );

  const minorTicks: TimelineTick[] =
    scale === 'DAY'
      ? eachDayOfInterval({ start, end }).map((d) => ({
          key: d.toISOString(),
          label: format(d, 'd'),
          x: xFor(d),
          width: dayWidth,
          isWeekend: isWeekend(d),
          isToday: startOfDay(d).getTime() === today.getTime(),
        }))
      : scale === 'WEEK'
        ? eachWeekOfInterval({ start, end }, { weekStartsOn: 1 }).map((d) => ({
            key: d.toISOString(),
            label: format(d, 'd MMM', { locale: ru }),
            x: xFor(d),
            width: 7 * dayWidth,
            isWeekend: false,
            isToday: false,
          }))
        : eachMonthOfInterval({ start, end }).map((d) =>
            cell(d.toISOString(), format(d, 'LLL', { locale: ru }), d, endOfMonth(d)),
          );

  return {
    start,
    end,
    dayWidth,
    totalWidth,
    majorTicks,
    minorTicks,
    todayX,
  };
}

/** Horizontal position of a date on the timeline, in pixels. */
export function xForDate(timeline: Timeline, date: Date): number {
  return differenceInCalendarDays(startOfDay(date), timeline.start) * timeline.dayWidth;
}

/** Inverse of `xForDate`, used when a drag finishes. */
export function dateForX(timeline: Timeline, x: number): Date {
  return addDays(timeline.start, Math.round(x / timeline.dayWidth));
}

export interface BarGeometry {
  x: number;
  width: number;
}

/**
 * Bars are inclusive of their end day, so a one-day task is one column wide
 * rather than zero. A bar with only one date collapses to a marker.
 */
export function barGeometry(
  timeline: Timeline,
  start: string | null,
  end: string | null,
): BarGeometry | null {
  if (!start && !end) return null;

  const from = start ? new Date(start) : new Date(end!);
  const to = end ? new Date(end) : new Date(start!);

  const x = xForDate(timeline, from);
  const days = Math.max(1, differenceInCalendarDays(startOfDay(to), startOfDay(from)) + 1);

  return { x, width: days * timeline.dayWidth };
}

/** Weekend bands drawn behind the bars; only legible at the day zoom. */
export function weekendBands(timeline: Timeline): { x: number; width: number }[] {
  if (timeline.dayWidth < 10) return [];
  return eachDayOfInterval({ start: timeline.start, end: timeline.end })
    .filter((d) => isWeekend(d))
    .map((d) => ({ x: xForDate(timeline, d), width: timeline.dayWidth }));
}

export const SCALE_LABEL: Record<GanttScale, string> = {
  DAY: 'День',
  WEEK: 'Неделя',
  MONTH: 'Месяц',
  QUARTER: 'Квартал',
};
