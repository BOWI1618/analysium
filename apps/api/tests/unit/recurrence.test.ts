import { describe, expect, it } from 'vitest';
import { nextDueDate, nextOccurrenceDates } from '../../src/domain/recurrence';

const noon = (date: string) => new Date(`${date}T12:00:00.000Z`);
const day = (date: Date) => date.toISOString().slice(0, 10);

describe('следующая дата повторяющейся задачи', () => {
  // Friday, 18 September 2026.
  const now = new Date('2026-09-18T09:00:00.000Z');

  it('каждый день — на следующий день после срока', () => {
    expect(day(nextDueDate('DAILY', noon('2026-09-18'), now))).toBe('2026-09-19');
  });

  it('закрытая с опозданием возвращается на сегодня, а не в прошлое', () => {
    expect(day(nextDueDate('DAILY', noon('2026-09-14'), now))).toBe('2026-09-18');
    // Weekly keeps its weekday: Monday the 7th comes back on Monday the 21st.
    expect(day(nextDueDate('WEEKLY', noon('2026-09-07'), now))).toBe('2026-09-21');
  });

  it('по будням — с пятницы на понедельник', () => {
    expect(day(nextDueDate('WEEKDAYS', noon('2026-09-18'), now))).toBe('2026-09-21');
  });

  it('каждый месяц — 31-е падает на последний день короткого месяца и возвращается', () => {
    const jan = new Date('2026-01-31T12:00:00.000Z');
    const early = new Date('2026-01-01T00:00:00.000Z');
    const feb = nextDueDate('MONTHLY', jan, early);
    expect(day(feb)).toBe('2026-02-28');
    // Counted from the original 31st, not from the shortened 28th.
    expect(day(nextDueDate('MONTHLY', jan, new Date('2026-03-01T00:00:00.000Z')))).toBe('2026-03-31');
  });

  it('без срока считается от сегодня', () => {
    expect(day(nextDueDate('DAILY', null, now))).toBe('2026-09-19');
  });

  it('время срока сохраняется, начало сдвигается вместе со сроком', () => {
    const next = nextOccurrenceDates(
      'WEEKLY',
      { startDate: new Date('2026-09-16T07:00:00.000Z'), dueDate: new Date('2026-09-18T15:30:00.000Z') },
      now,
    );
    expect(next.dueDate?.toISOString()).toBe('2026-09-25T15:30:00.000Z');
    expect(next.startDate?.toISOString()).toBe('2026-09-23T07:00:00.000Z');
  });
});
