/**
 * Pure business rules for issues. No Prisma, no Fastify — everything here is a
 * function of its arguments, which is what makes the rules unit-testable and
 * keeps them out of both the HTTP layer and the React components.
 */
import type { IssuePriority, IssueType, StatusCategory } from '@flowdesk/contracts';
import { ActivityType, StatusCategory as SC, IssueType as IT } from '@flowdesk/contracts';

export interface StatusLike {
  id: string;
  name: string;
  category: StatusCategory;
  wipLimit?: number | null;
}

/**
 * Starter workflow for a new project. Names are editable by the project lead;
 * the `category` is what cross-project logic (done, velocity, burndown) reads,
 * so renaming a column never breaks a report.
 */
export const DEFAULT_STATUSES: { name: string; category: StatusCategory; color: string; wipLimit?: number }[] = [
  { name: 'Бэклог', category: SC.BACKLOG, color: '#94a3b8' },
  { name: 'К выполнению', category: SC.UNSTARTED, color: '#64748b' },
  { name: 'В работе', category: SC.STARTED, color: '#3b82f6', wipLimit: 5 },
  { name: 'На ревью', category: SC.STARTED, color: '#a855f7' },
  { name: 'Готово', category: SC.COMPLETED, color: '#22c55e' },
];

export const DEFAULT_LABELS: { name: string; color: string }[] = [
  { name: 'фронтенд', color: '#3b82f6' },
  { name: 'бэкенд', color: '#8b5cf6' },
  { name: 'дизайн', color: '#ec4899' },
  { name: 'инфраструктура', color: '#f59e0b' },
  { name: 'техдолг', color: '#64748b' },
  { name: 'от клиента', color: '#14b8a6' },
];

/** `completedAt` is derived from the status category, never set by the client. */
export function nextCompletedAt(
  category: StatusCategory,
  current: Date | null,
  now: Date = new Date(),
): Date | null {
  const isDone = category === SC.COMPLETED;
  if (isDone) return current ?? now;
  return null;
}

export function isDoneCategory(category: StatusCategory): boolean {
  return category === SC.COMPLETED;
}

export function isClosedCategory(category: StatusCategory): boolean {
  return category === SC.COMPLETED || category === SC.CANCELED;
}

export function formatIssueKey(projectKey: string, number: number): string {
  return `${projectKey}-${number}`;
}

/**
 * Structural rules for the issue hierarchy:
 *  - an EPIC cannot be a subtask and cannot itself belong to an epic;
 *  - a SUBTASK must have a parent, and that parent may not be a subtask;
 *  - nothing may be its own parent (or its own epic).
 */
export interface HierarchyInput {
  issueId?: string | null;
  type: IssueType;
  parentId?: string | null;
  parentType?: IssueType | null;
  epicId?: string | null;
  epicType?: IssueType | null;
}

export type HierarchyError =
  | 'EPIC_CANNOT_HAVE_PARENT'
  | 'EPIC_CANNOT_HAVE_EPIC'
  | 'SUBTASK_REQUIRES_PARENT'
  | 'PARENT_CANNOT_BE_SUBTASK'
  | 'SELF_REFERENCE'
  | 'EPIC_MUST_BE_EPIC_TYPE'
  | 'PARENT_MUST_NOT_BE_EPIC'
  // Detected by walking the stored ancestor chain (wouldCreateParentCycle),
  // never returned by validateHierarchy itself.
  | 'PARENT_CYCLE';

export function validateHierarchy(input: HierarchyInput): HierarchyError | null {
  const { issueId, type, parentId, parentType, epicId, epicType } = input;

  if (issueId && (parentId === issueId || epicId === issueId)) return 'SELF_REFERENCE';

  if (type === IT.EPIC) {
    if (parentId) return 'EPIC_CANNOT_HAVE_PARENT';
    if (epicId) return 'EPIC_CANNOT_HAVE_EPIC';
    return null;
  }

  if (type === IT.SUBTASK && !parentId) return 'SUBTASK_REQUIRES_PARENT';

  if (parentId) {
    if (parentType === IT.SUBTASK) return 'PARENT_CANNOT_BE_SUBTASK';
    if (parentType === IT.EPIC) return 'PARENT_MUST_NOT_BE_EPIC';
  }

  if (epicId && epicType && epicType !== IT.EPIC) return 'EPIC_MUST_BE_EPIC_TYPE';

  return null;
}

export const HIERARCHY_MESSAGES: Record<HierarchyError, string> = {
  EPIC_CANNOT_HAVE_PARENT: 'Эпик не может быть подзадачей другой задачи',
  EPIC_CANNOT_HAVE_EPIC: 'Эпик не может входить в другой эпик',
  SUBTASK_REQUIRES_PARENT: 'У подзадачи должна быть родительская задача',
  PARENT_CANNOT_BE_SUBTASK: 'У подзадачи не может быть своих подзадач',
  SELF_REFERENCE: 'Задача не может ссылаться сама на себя',
  EPIC_MUST_BE_EPIC_TYPE: 'Выбранная задача не является эпиком',
  PARENT_MUST_NOT_BE_EPIC: 'Чтобы связать задачу с эпиком, используйте поле «Эпик»',
  PARENT_CYCLE: 'Нельзя установить родителя: образуется цикл в иерархии задач',
};

/**
 * Guards against cycles that already exist in the data — the walk must
 * terminate even on corrupt input, not spin forever.
 */
const MAX_ANCESTOR_DEPTH = 100;

/**
 * True when making `parentId` the parent of `issueId` would close a cycle,
 * i.e. issueId is reachable from parentId by walking the ancestor chain.
 * `loadParent` supplies the next ancestor one level at a time; the chain is
 * explored iteratively and bounded by MAX_ANCESTOR_DEPTH.
 */
export async function wouldCreateParentCycle(
  issueId: string,
  parentId: string,
  loadParent: (id: string) => Promise<string | null>,
): Promise<boolean> {
  let cursor: string | null = parentId;
  for (let depth = 0; cursor !== null && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    if (cursor === issueId) return true;
    cursor = await loadParent(cursor);
  }
  return false;
}

/**
 * WIP limits are advisory for existing cards but enforced on entry: moving a
 * new card into a full column is rejected, while cards already there are left
 * alone (a limit lowered after the fact must not freeze the board).
 */
export function exceedsWipLimit(status: StatusLike, currentCount: number, isEntering: boolean): boolean {
  if (!isEntering) return false;
  if (status.wipLimit === null || status.wipLimit === undefined || status.wipLimit <= 0) return false;
  return currentCount >= status.wipLimit;
}

/* --------------------------------------------------------------- history */

export interface FieldChange {
  type: ActivityType;
  field: string;
  fromValue: string | null;
  toValue: string | null;
  metadata?: Record<string, unknown>;
}

interface IssueSnapshot {
  title: string;
  statusId: string;
  priority: IssuePriority;
  type: IssueType;
  assigneeId: string | null;
  epicId: string | null;
  sprintId: string | null;
  parentId: string | null;
  storyPoints: number | null;
  dueDate: Date | null;
  descriptionText: string | null;
}

const FIELD_ACTIVITY: Record<string, ActivityType> = {
  title: ActivityType.TITLE_CHANGED,
  statusId: ActivityType.STATUS_CHANGED,
  priority: ActivityType.PRIORITY_CHANGED,
  type: ActivityType.TYPE_CHANGED,
  assigneeId: ActivityType.ASSIGNEE_CHANGED,
  epicId: ActivityType.EPIC_CHANGED,
  sprintId: ActivityType.SPRINT_CHANGED,
  parentId: ActivityType.PARENT_CHANGED,
  storyPoints: ActivityType.STORY_POINTS_CHANGED,
  dueDate: ActivityType.DUE_DATE_CHANGED,
  descriptionText: ActivityType.DESCRIPTION_CHANGED,
};

function normalize(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * Diffs two issue snapshots into activity entries. Returning a list (rather
 * than writing rows) keeps this pure and lets the caller persist them inside
 * the same transaction as the update.
 */
export function diffIssue(before: IssueSnapshot, after: Partial<IssueSnapshot>): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const [field, activityType] of Object.entries(FIELD_ACTIVITY)) {
    if (!(field in after)) continue;
    const from = normalize(before[field as keyof IssueSnapshot]);
    const to = normalize(after[field as keyof IssueSnapshot]);
    if (from === to) continue;

    // Description bodies are large; record that it changed, not the content.
    if (field === 'descriptionText') {
      changes.push({ type: activityType, field: 'description', fromValue: null, toValue: null });
      continue;
    }
    changes.push({ type: activityType, field, fromValue: from, toValue: to });
  }

  return changes;
}

/* --------------------------------------------------------------- sorting */

import { PRIORITY_WEIGHT } from '@flowdesk/contracts';

export type SortKey = 'rank' | 'created' | 'updated' | 'priority' | 'dueDate' | 'title' | 'status';

export interface SortableIssue {
  rank: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  priority: IssuePriority;
  dueDate: Date | string | null;
  title: string;
  status?: { position: number };
}

/**
 * Comparator used for in-memory sorting (board columns after an optimistic
 * update, grouped My Work lists). The database applies the same ordering via
 * `orderByFor`, so client and server agree.
 */
export function compareIssues(a: SortableIssue, b: SortableIssue, key: SortKey, order: 'asc' | 'desc' = 'asc'): number {
  const dir = order === 'asc' ? 1 : -1;
  const time = (v: Date | string | null) => (v ? new Date(v).getTime() : null);

  let result = 0;
  switch (key) {
    case 'rank':
      result = a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
      break;
    case 'created':
      result = (time(a.createdAt) ?? 0) - (time(b.createdAt) ?? 0);
      break;
    case 'updated':
      result = (time(a.updatedAt) ?? 0) - (time(b.updatedAt) ?? 0);
      break;
    case 'priority':
      // Higher weight first when ascending — "most urgent at the top" is what
      // users mean by sorting by priority.
      result = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
      break;
    case 'dueDate': {
      const ta = time(a.dueDate);
      const tb = time(b.dueDate);
      // Issues without a due date always sink to the bottom, both directions.
      if (ta === null && tb === null) result = 0;
      else if (ta === null) return 1;
      else if (tb === null) return -1;
      else result = ta - tb;
      break;
    }
    case 'title':
      result = a.title.localeCompare(b.title);
      break;
    case 'status':
      result = (a.status?.position ?? 0) - (b.status?.position ?? 0);
      break;
  }

  if (result === 0) return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
  return result * dir;
}
