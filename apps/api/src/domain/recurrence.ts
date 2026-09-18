/**
 * Dates of the next occurrence of a recurring task.
 *
 * The next one never lands in the past: a daily task closed three days late
 * comes back today, not three days ago, while a weekly one keeps its weekday
 * and a monthly one its day of the month — the 31st falls back to the last day
 * of a shorter month and returns to the 31st after it.
 *
 * Days are counted in UTC, like the dates themselves: a date without a time is
 * stored at noon UTC, which is the same calendar day in every Russian zone.
 */
export type Recurrence = 'DAILY' | 'WEEKDAYS' | 'WEEKLY' | 'MONTHLY';

const DAY_MS = 24 * 60 * 60 * 1000;

const dayNumber = (date: Date) => Math.floor(date.getTime() / DAY_MS);

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Same time of day, `months` later, on `anchorDay` or the month's last day. */
function addMonths(date: Date, months: number, anchorDay: number): Date {
  const next = new Date(date);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(anchorDay, lastDay));
  return next;
}

function step(rule: Recurrence, date: Date, anchorDay: number): Date {
  switch (rule) {
    case 'DAILY':
      return addDays(date, 1);
    case 'WEEKDAYS': {
      let next = addDays(date, 1);
      while (next.getUTCDay() === 0 || next.getUTCDay() === 6) next = addDays(next, 1);
      return next;
    }
    case 'WEEKLY':
      return addDays(date, 7);
    case 'MONTHLY':
      return addMonths(date, 1, anchorDay);
  }
}

/**
 * The next due date after `due`, no earlier than today. A task without a date
 * counts from today, so «каждый день» without a deadline comes back tomorrow.
 */
export function nextDueDate(rule: Recurrence, due: Date | null, now: Date): Date {
  const base = due ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
  const anchorDay = base.getUTCDate();
  let next = step(rule, base, anchorDay);
  while (dayNumber(next) < dayNumber(now)) next = step(rule, next, anchorDay);
  return next;
}

/**
 * Both dates of the next occurrence: the deadline moves by the rule and the
 * start moves with it, so the planned duration stays the same.
 */
export function nextOccurrenceDates(
  rule: Recurrence,
  dates: { startDate: Date | null; dueDate: Date | null },
  now: Date,
): { startDate: Date | null; dueDate: Date | null } {
  const anchor = dates.dueDate ?? dates.startDate;
  const moved = nextDueDate(rule, anchor, now);
  const shift = anchor ? moved.getTime() - anchor.getTime() : 0;
  return {
    dueDate: dates.dueDate || !dates.startDate ? moved : null,
    startDate: dates.startDate ? new Date(dates.startDate.getTime() + shift) : null,
  };
}
