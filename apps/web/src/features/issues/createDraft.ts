import type { IssuePriority, IssueRecurrence, IssueType } from '@flowdesk/contracts';

/**
 * The text of the «Новая задача» form, kept in the browser until the task is made.
 *
 * A reload, a closed tab or a phone that put the browser to sleep used to cost
 * everything typed into the form. The draft is written while the form has text
 * in it and thrown away the moment the task is created or the form is closed
 * on purpose: it is a safety net, not a second place to keep tasks.
 */
export interface IssueDraft {
  savedAt: number;
  /** A subtask's draft belongs to its parent and is offered only there. */
  parentId: string | null;
  projectId: string;
  title: string;
  description: unknown;
  type: IssueType;
  priority: IssuePriority;
  statusId?: string;
  assigneeId: string | null;
  labelIds: string[];
  watcherIds: string[];
  sprintId: string | null;
  epicId: string | null;
  dueDate: string | null;
  dueHasTime: boolean;
  startDate: string | null;
  startHasTime: boolean;
  storyPoints: number | null;
  recurrence: IssueRecurrence | null;
}

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Per person and per workspace: a shared computer must not hand one person's
// half-written task to the next one who signs in.
const key = (userId: string, workspaceId: string) => `flowdesk.issue-draft.${userId}.${workspaceId}`;

export function readIssueDraft(userId: string, workspaceId: string, now = Date.now()): IssueDraft | null {
  try {
    const raw = window.localStorage.getItem(key(userId, workspaceId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as IssueDraft;
    if (typeof draft?.savedAt !== 'number' || typeof draft.title !== 'string') return null;
    // A week-old draft is about something long done or forgotten.
    if (now - draft.savedAt > MAX_AGE_MS) return null;
    return draft;
  } catch {
    return null;
  }
}

export function writeIssueDraft(userId: string, workspaceId: string, draft: IssueDraft): void {
  try {
    window.localStorage.setItem(key(userId, workspaceId), JSON.stringify(draft));
  } catch {
    /* private mode or a full storage: the form simply works without the net */
  }
}

export function clearIssueDraft(userId: string, workspaceId: string): void {
  try {
    window.localStorage.removeItem(key(userId, workspaceId));
  } catch {
    /* nothing to clear where nothing could be written */
  }
}
