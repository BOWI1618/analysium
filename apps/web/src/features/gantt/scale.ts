/**
 * Timeline geometry.
 *
 * Kept apart from the components so the pixel maths — which is where a Gantt
 * usually goes subtly wrong — can be reasoned about and tested on its own.
 */
import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  eachMonthOfInterval,
  eachWeekOfInterval,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  format,
  isWeekend,
  startOfDay,
  startOfMonth,
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

/**
 * Pads the data range so bars never touch the edge and there is room to drag
 * work later than anything currently planned.
 */
export function buildTimeline(
  rangeStart: Date,
  rangeEnd: Date,
  scale: GanttScale,
): Timeline {
  const dayWidth = DAY_WIDTH[scale];

  const padDays = scale === 'DAY' ? 3 : scale === 'WEEK' ? 7 : 21;
  const start = startOfDay(
    scale === 'MONTH' || scale === 'QUARTER'
      ? startOfMonth(addDays(rangeStart, -padDays))
      : startOfWeek(addDays(rangeStart, -padDays), { weekStartsOn: 1 }),
  );
  const end = startOfDay(
    scale === 'MONTH' || scale === 'QUARTER'
      ? endOfMonth(addDays(rangeEnd, padDays))
      : endOfWeek(addDays(rangeEnd, padDays), { weekStartsOn: 1 }),
  );

  const totalDays = Math.max(1, differenceInCalendarDays(end, start) + 1);
  const xFor = (date: Date) => differenceInCalendarDays(startOfDay(date), start) * dayWidth;

  const today = startOfDay(new Date());
  const todayX = today >= start && today <= end ? xFor(today) : null;

  const majorTicks: TimelineTick[] =
    scale === 'QUARTER'
      ? eachMonthOfInterval({ start, end })
          .filter((d) => d.getMonth() % 3 === 0)
          .map((d) => {
            const qEnd = endOfQuarter(d);
            return {
              key: `q-${d.toISOString()}`,
              label: `${Math.floor(d.getMonth() / 3) + 1} кв. ${format(d, 'yyyy')}`,
              x: xFor(d),
              width: (differenceInCalendarDays(qEnd, d) + 1) * dayWidth,
              isWeekend: false,
              isToday: false,
            };
          })
      : eachMonthOfInterval({ start, end }).map((d) => {
          const mEnd = endOfMonth(d);
          return {
            key: `m-${d.toISOString()}`,
            label: format(d, 'LLLL yyyy', { locale: ru }),
            x: xFor(d),
            width: (differenceInCalendarDays(mEnd, d) + 1) * dayWidth,
            isWeekend: false,
            isToday: false,
          };
        });

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
        : eachMonthOfInterval({ start, end }).map((d) => ({
            key: d.toISOString(),
            label: format(d, 'LLL', { locale: ru }),
            x: xFor(d),
            width: (differenceInCalendarDays(endOfMonth(d), d) + 1) * dayWidth,
            isWeekend: false,
            isToday: false,
          }));

  return {
    start,
    end,
    dayWidth,
    totalWidth: totalDays * dayWidth,
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
