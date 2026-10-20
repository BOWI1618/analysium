import { describe, expect, it } from 'vitest';
import { remindersFor } from '../../src/jobs/dueDateScanner';

const MSK = 'Europe/Moscow';
const at = (iso: string) => new Date(iso);
const kinds = (list: { key: string }[]) => list.map((r) => r.key.split(':')[0]);

describe('напоминания о сроке', () => {
  const wholeDay = { issueKey: 'WEB-1', dueDate: at('2026-10-21T12:00:00.000Z'), dueHasTime: false };
  const timed = { issueKey: 'WEB-2', dueDate: at('2026-10-21T12:00:00.000Z'), dueHasTime: true }; // 15:00 МСК

  it('задача на весь день: утром в день срока, не накануне и не ночью', () => {
    expect(remindersFor(wholeDay, MSK, at('2026-10-20T12:30:00Z'))).toEqual([]); // накануне 15:30
    expect(remindersFor(wholeDay, MSK, at('2026-10-21T00:30:00Z'))).toEqual([]); // 3:30 ночи
    const morning = remindersFor(wholeDay, MSK, at('2026-10-21T06:05:00Z')); // 9:05
    expect(morning).toEqual([expect.objectContaining({ type: 'ISSUE_DUE_SOON', title: 'WEB-1: срок сегодня' })]);
    expect(remindersFor(wholeDay, MSK, at('2026-10-21T10:00:00Z'))).toEqual([]); // 13:00 — утро прошло
  });

  it('задача со временем: утром с часом, за час до срока, после срока — ничего до утра', () => {
    expect(remindersFor(timed, MSK, at('2026-10-21T06:05:00Z'))[0]!.title).toBe('WEB-2: срок сегодня в 15:00');
    const hour = remindersFor(timed, MSK, at('2026-10-21T11:05:00Z')); // 14:05
    expect(hour).toEqual([expect.objectContaining({ title: 'WEB-2: срок через час в 15:00' })]);
    expect(remindersFor(timed, MSK, at('2026-10-21T12:30:00Z'))).toEqual([]);
  });

  it('срок в 10:00 утром — одно напоминание «через час», а не два', () => {
    const early = { issueKey: 'WEB-3', dueDate: at('2026-10-21T07:00:00.000Z'), dueHasTime: true }; // 10:00 МСК
    expect(kinds(remindersFor(early, MSK, at('2026-10-21T06:05:00Z')))).toEqual(['hour']);
  });

  it('просрочка — утром следующего дня, один раз за этот срок', () => {
    const overdue = remindersFor(wholeDay, MSK, at('2026-10-22T06:10:00Z'));
    expect(overdue).toEqual([expect.objectContaining({ type: 'ISSUE_OVERDUE', title: 'WEB-1: срок прошёл вчера' })]);
    expect(overdue[0]!.key).toBe('overdue:2026-10-21T12:00:00.000Z');
    expect(remindersFor(wholeDay, MSK, at('2026-10-23T06:10:00Z'))).toEqual([]);
  });

  it('по часам исполнителя: во Владивостоке утро наступает раньше', () => {
    // 9:05 во Владивостоке — ещё 2:05 в Москве.
    expect(kinds(remindersFor(wholeDay, 'Asia/Vladivostok', at('2026-10-20T23:05:00Z')))).toEqual(['today']);
    expect(remindersFor(wholeDay, MSK, at('2026-10-20T23:05:00Z'))).toEqual([]);
  });
});
