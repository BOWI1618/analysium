import { describe, expect, it } from 'vitest';
import { ISSUE_PRIORITIES, ISSUE_TYPES } from '@flowdesk/contracts';
import { buildIssueWhere, isPastDue, overdueWhere, viewerDayStart } from '../../src/domain/filters';

describe('просрочка по дню того, кто смотрит', () => {
  // 7 октября, 01:30 в Москве — и ещё 6 октября, 22:30, по UTC.
  const now = new Date('2026-10-06T22:30:00.000Z');
  const dueYesterdayInMoscow = new Date('2026-10-06T12:00:00.000Z');

  it('день начинается в полночь зоны смотрящего', () => {
    expect(viewerDayStart('Europe/Moscow', now).toISOString()).toBe('2026-10-07T00:00:00.000Z');
    expect(viewerDayStart('UTC', now).toISOString()).toBe('2026-10-06T00:00:00.000Z');
    // An unknown zone reads as UTC instead of failing the request.
    expect(viewerDayStart('Mars/Olympus', now).toISOString()).toBe('2026-10-06T00:00:00.000Z');
  });

  it('срок без времени: в Москве уже просрочен, по UTC — ещё нет', () => {
    expect(isPastDue(dueYesterdayInMoscow, false, now.getTime(), 'Europe/Moscow')).toBe(true);
    expect(isPastDue(dueYesterdayInMoscow, false, now.getTime(), 'UTC')).toBe(false);
    // Due today is never overdue while the day lasts, wherever the viewer is.
    expect(isPastDue(new Date('2026-10-07T12:00:00.000Z'), false, now.getTime(), 'Europe/Moscow')).toBe(false);
  });

  it('срок со временем просрочен с этой минуты, зона ни при чём', () => {
    const passed = new Date('2026-10-06T22:00:00.000Z');
    const ahead = new Date('2026-10-06T23:00:00.000Z');
    for (const zone of ['UTC', 'Europe/Moscow']) {
      expect(isPastDue(passed, true, now.getTime(), zone)).toBe(true);
      expect(isPastDue(ahead, true, now.getTime(), zone)).toBe(false);
    }
  });

  it('условие выборки и проверка одной задачи — одно правило', () => {
    expect(overdueWhere(now, 'Europe/Moscow')).toEqual({
      OR: [
        { dueHasTime: true, dueDate: { lt: now } },
        { dueHasTime: false, dueDate: { lt: new Date('2026-10-07T00:00:00.000Z') } },
      ],
    });
    const where = buildIssueWhere(
      { isOverdue: true },
      { workspaceId: 'w1', allowedProjectIds: 'ALL', currentUserId: 'me', timezone: 'Europe/Moscow' },
      { priorities: ISSUE_PRIORITIES, types: ISSUE_TYPES },
    );
    expect(JSON.stringify(where)).toContain('dueHasTime');
  });
});
