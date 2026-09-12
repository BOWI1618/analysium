/**
 * Typed realtime event envelope.
 *
 * Events are published on the server's EventBus and streamed to clients over
 * SSE, scoped to a workspace. The union below is exhaustive: the client's
 * reducer switches on `type` and TypeScript enforces that every case is
 * handled, so adding an event breaks the build until the UI handles it.
 */

export const RealtimeEventType = {
  ISSUE_CREATED: 'issue.created',
  ISSUE_UPDATED: 'issue.updated',
  ISSUE_DELETED: 'issue.deleted',
  ISSUE_STATUS_CHANGED: 'issue.status_changed',
  ISSUE_MOVED: 'issue.moved',
  COMMENT_CREATED: 'comment.created',
  COMMENT_UPDATED: 'comment.updated',
  COMMENT_DELETED: 'comment.deleted',
  NOTIFICATION_CREATED: 'notification.created',
  SPRINT_UPDATED: 'sprint.updated',
  PROJECT_UPDATED: 'project.updated',
  MEMBER_UPDATED: 'member.updated',
  PRESENCE_CHANGED: 'presence.changed',
} as const;
export type RealtimeEventType = (typeof RealtimeEventType)[keyof typeof RealtimeEventType];

interface BaseEvent<T extends RealtimeEventType, P> {
  id: string;
  type: T;
  workspaceId: string;
  /** User who caused the event. */
  actorId: string;
  /**
   * The browser tab that caused it, when the event came from a request.
   *
   * A tab skips only the echo of its *own* action, because it already applied
   * that change optimistically. Filtering by `actorId` instead would be wrong:
   * the same person's second tab or phone is a different client and must still
   * refresh. Absent for events raised outside a request — background jobs and
   * presence — which every client should act on.
   */
  clientId?: string;
  at: string;
  payload: P;
}

export type IssueEventPayload = {
  issueId: string;
  issueKey: string;
  projectId: string;
  /** Partial issue projection; clients merge it into their cache. */
  patch?: Record<string, unknown>;
};

export type RealtimeEvent =
  | BaseEvent<typeof RealtimeEventType.ISSUE_CREATED, IssueEventPayload>
  | BaseEvent<typeof RealtimeEventType.ISSUE_UPDATED, IssueEventPayload>
  | BaseEvent<typeof RealtimeEventType.ISSUE_DELETED, IssueEventPayload>
  | BaseEvent<typeof RealtimeEventType.ISSUE_STATUS_CHANGED, IssueEventPayload & { fromStatusId: string; toStatusId: string }>
  | BaseEvent<typeof RealtimeEventType.ISSUE_MOVED, IssueEventPayload & { statusId: string; rank: string }>
  | BaseEvent<typeof RealtimeEventType.COMMENT_CREATED, { issueId: string; commentId: string; projectId: string }>
  | BaseEvent<typeof RealtimeEventType.COMMENT_UPDATED, { issueId: string; commentId: string; projectId: string }>
  | BaseEvent<typeof RealtimeEventType.COMMENT_DELETED, { issueId: string; commentId: string; projectId: string }>
  | BaseEvent<typeof RealtimeEventType.NOTIFICATION_CREATED, { notificationId: string; recipientId: string }>
  | BaseEvent<typeof RealtimeEventType.SPRINT_UPDATED, { sprintId: string; projectId: string }>
  | BaseEvent<typeof RealtimeEventType.PROJECT_UPDATED, { projectId: string }>
  | BaseEvent<typeof RealtimeEventType.MEMBER_UPDATED, { memberId: string; userId: string }>
  | BaseEvent<typeof RealtimeEventType.PRESENCE_CHANGED, { online: string[] }>;

export type RealtimeEventOf<T extends RealtimeEventType> = Extract<RealtimeEvent, { type: T }>;

/** Events carrying a recipient are only delivered to that user's streams. */
export function eventRecipient(event: RealtimeEvent): string | null {
  return event.type === RealtimeEventType.NOTIFICATION_CREATED ? event.payload.recipientId : null;
}
