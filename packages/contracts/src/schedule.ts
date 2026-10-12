/**
 * Where a task is taken to begin when nobody set a start: the day it was
 * created.
 *
 * A task with only a deadline used to be drawn on the Gantt chart as one day —
 * the deadline — so a month of work read as its last day. Nothing is stored
 * for this: a start set by hand is the start, and taking it away brings the
 * day of creation back. The chart is built on the server and the task's card
 * in the browser, so the rule lives here, where both read it.
 *
 * Only a task whose deadline is on or after that day has such a start; a
 * milestone is a point in time and has none. The day is a calendar day in
 * `timezone` (the machine's own when none is given), written the way whole
 * days are stored: at noon UTC.
 */
export function impliedStartDate(
  task: {
    startDate: string | Date | null;
    dueDate: string | Date | null;
    dueHasTime: boolean;
    isMilestone?: boolean;
    createdAt: string | Date;
  },
  timezone?: string,
): Date | null {
  if (task.startDate || !task.dueDate || task.isMilestone) return null;
  const created = wholeDay(new Date(task.createdAt), timezone);
  // A whole-day deadline already is its day at noon UTC; a timed one is a
  // moment, and which day it falls on depends on the zone.
  const dueDay = wholeDay(new Date(task.dueDate), task.dueHasTime ? timezone : 'UTC');
  return created.getTime() <= dueDay.getTime() ? created : null;
}

function wholeDay(moment: Date, timezone?: string): Date {
  let local: string;
  try {
    local = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(moment);
  } catch {
    // An unknown zone reads as UTC, as everywhere else a zone is asked for.
    local = moment.toISOString().slice(0, 10);
  }
  return new Date(`${local}T12:00:00.000Z`);
}
