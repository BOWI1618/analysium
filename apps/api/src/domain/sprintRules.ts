/**
 * Pure business rules for sprints. No Prisma, no Fastify — same philosophy as
 * issueRules: a function of its arguments, which keeps it unit-testable.
 */

/**
 * Completing a sprint must not move its unfinished issues into the sprint
 * being completed — they would be "resurrected" in a column that is being
 * closed. The backlog (null target) is always allowed.
 */
export type SprintMoveError = 'MOVE_TO_SELF';

export function validateSprintMove(sprintId: string, targetSprintId: string | null): SprintMoveError | null {
  return targetSprintId !== null && targetSprintId === sprintId ? 'MOVE_TO_SELF' : null;
}

export const SPRINT_MOVE_MESSAGES: Record<SprintMoveError, string> = {
  MOVE_TO_SELF: 'Нельзя перенести незавершённые задачи в завершаемый спринт',
};
