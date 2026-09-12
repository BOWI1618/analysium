import { describe, expect, it } from 'vitest';
import { SPRINT_MOVE_MESSAGES, validateSprintMove } from '../../src/domain/sprintRules';

describe('sprint move target', () => {
  it('allows carrying unfinished issues into another sprint', () => {
    expect(validateSprintMove('s1', 's2')).toBeNull();
  });

  it('allows returning unfinished issues to the backlog', () => {
    expect(validateSprintMove('s1', null)).toBeNull();
  });

  it('refuses to move unfinished issues into the sprint being completed', () => {
    expect(validateSprintMove('s1', 's1')).toBe('MOVE_TO_SELF');
    expect(SPRINT_MOVE_MESSAGES.MOVE_TO_SELF).toBe('Нельзя перенести незавершённые задачи в завершаемый спринт');
  });
});
