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
  endOfDay,
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
  /**
   * The day zoom: one calendar day split into hours, positioned by exact
   * moments rather than whole days.
   */
  hourly: boolean;
  /** Pixels per hour in the hourly view; 0 otherwise. */
  hourWidth: number;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * One day in hours, for the day zoom. At least as wide as the viewport, never
 * narrower than a readable hour.
 */
export function buildHourTimeline(day: Date, minWidthPx = 0): Timeline {
  const start = startOfDay(day);
  const hourWidth = Math.max(56, Math.floor(minWidthPx / 24));
  const totalWidth = hourWidth * 24;
  const now = new Date();
  const isThisDay = startOfDay(now).getTime() === start.getTime();

  return {
    start,
    end: endOfDay(day),
    dayWidth: totalWidth,
    totalWidth,
    hourly: true,
    hourWidth,
    majorTicks: [
      {
        key: `d-${start.toISOString()}`,
        label: format(start, 'EEEE, d MMMM yyyy', { locale: ru }),
        x: 0,
        width: totalWidth,
        isWeekend: false,
        isToday: false,
      },
    ],
    minorTicks: Array.from({ length: 24 }, (_, hour) => ({
      key: `h-${hour}`,
      label: `${String(hour).padStart(2, '0')}:00`,
      x: hour * hourWidth,
      width: hourWidth,
      isWeekend: hour < 8 || hour >= 20,
      isToday: isThisDay && now.getHours() === hour,
    })),
    todayX: isThisDay ? ((now.getTime() - start.getTime()) / HOUR_MS) * hourWidth : null,
  };
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
  const cell = (key: string, label: string, cellStart: Date, cellEnd: Date, markToday = false): TimelineTick => {
    const x = Math.max(0, xFor(cellStart));
    const right = Math.min(totalWidth, (differenceInCalendarDays(startOfDay(cellEnd), start) + 1) * dayWidth);
    const width = Math.max(0, right - x);
    // A cell clipped to a sliver at the edge keeps its place but not its label,
    // which would otherwise spill over the next month's name.
    const fits = width >= label.length * 8 + 16;
    const holdsToday = markToday && today >= startOfDay(cellStart) && today <= startOfDay(cellEnd);
    return { key, label: fits ? label : '', x, width, isWeekend: false, isToday: holdsToday };
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
            // The week that holds today is marked in the header, where the
            // red rule below meets it.
            isToday: today >= d && today < addDays(d, 7),
          }))
        : eachMonthOfInterval({ start, end }).map((d) =>
            cell(d.toISOString(), format(d, 'LLL', { locale: ru }), d, endOfMonth(d), true),
          );

  return {
    start,
    end,
    dayWidth,
    totalWidth,
    majorTicks,
    minorTicks,
    todayX,
    hourly: false,
    hourWidth: 0,
  };
}

/** Horizontal position of a date on the timeline, in pixels. */
export function xForDate(timeline: Timeline, date: Date): number {
  if (timeline.hourly) return ((date.getTime() - timeline.start.getTime()) / HOUR_MS) * timeline.hourWidth;
  return differenceInCalendarDays(startOfDay(date), timeline.start) * timeline.dayWidth;
}

/**
 * Where an edge of a bar falls. A whole-day date covers its day, so as an end
 * it reaches the day's close; a date with a time is that exact moment (on the
 * day-and-wider zooms it still occupies its whole day column).
 */
export function edgeX(timeline: Timeline, value: string, hasTime: boolean, edge: 'start' | 'end'): number {
  const date = new Date(value);
  if (timeline.hourly) {
    if (hasTime) return xForDate(timeline, date);
    return edge === 'start' ? xForDate(timeline, startOfDay(date)) : xForDate(timeline, endOfDay(date)) + 1;
  }
  return xForDate(timeline, date) + (edge === 'end' ? timeline.dayWidth : 0);
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
  startHasTime = false,
  endHasTime = false,
): BarGeometry | null {
  if (!start && !end) return null;

  if (timeline.hourly) {
    // Clipped to the day on screen; work that does not touch it has no bar.
    const from = start ?? end!;
    const to = end ?? start!;
    const left = edgeX(timeline, from, start ? startHasTime : endHasTime, 'start');
    let right = edgeX(timeline, to, end ? endHasTime : startHasTime, 'end');
    // A single moment (only one timed edge) still needs something to grab.
    if (right - left < 8) right = left + 8;
    if (right <= 0 || left >= timeline.totalWidth) return null;
    const x = Math.max(0, left);
    return { x, width: Math.min(timeline.totalWidth, right) - x };
  }

  const from = start ? new Date(start) : new Date(end!);
  const to = end ? new Date(end) : new Date(start!);

  const x = xForDate(timeline, from);
  const days = Math.max(1, differenceInCalendarDays(startOfDay(to), startOfDay(from)) + 1);

  return { x, width: days * timeline.dayWidth };
}

/** Weekend bands drawn behind the bars; only legible at the day zoom. */
export function weekendBands(timeline: Timeline): { x: number; width: number }[] {
  // In hours the night is shaded instead, through the header ticks' `isWeekend`.
  if (timeline.hourly) {
    return timeline.minorTicks.filter((tick) => tick.isWeekend).map((tick) => ({ x: tick.x, width: tick.width }));
  }
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
