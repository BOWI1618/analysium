/**
 * Domain enumerations shared by API and web client.
 * Kept as const-objects (not TS `enum`) so they are erasable and tree-shakeable.
 */

export const WorkspaceRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
  GUEST: 'GUEST',
} as const;
export type WorkspaceRole = (typeof WorkspaceRole)[keyof typeof WorkspaceRole];
export const WORKSPACE_ROLES = Object.values(WorkspaceRole);

/** Ordered from most to least privileged — used for role comparison. */
export const WORKSPACE_ROLE_RANK: Record<WorkspaceRole, number> = {
  OWNER: 40,
  ADMIN: 30,
  MEMBER: 20,
  GUEST: 10,
};

export const ProjectRole = {
  LEAD: 'LEAD',
  CONTRIBUTOR: 'CONTRIBUTOR',
  VIEWER: 'VIEWER',
} as const;
export type ProjectRole = (typeof ProjectRole)[keyof typeof ProjectRole];
export const PROJECT_ROLES = Object.values(ProjectRole);

export const ProjectType = {
  KANBAN: 'KANBAN',
  SCRUM: 'SCRUM',
  SIMPLE: 'SIMPLE',
} as const;
export type ProjectType = (typeof ProjectType)[keyof typeof ProjectType];
export const PROJECT_TYPES = Object.values(ProjectType);

export const IssueType = {
  TASK: 'TASK',
  BUG: 'BUG',
  STORY: 'STORY',
  EPIC: 'EPIC',
  SUBTASK: 'SUBTASK',
} as const;
export type IssueType = (typeof IssueType)[keyof typeof IssueType];
export const ISSUE_TYPES = Object.values(IssueType);

export const IssuePriority = {
  URGENT: 'URGENT',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  NONE: 'NONE',
} as const;
export type IssuePriority = (typeof IssuePriority)[keyof typeof IssuePriority];
export const ISSUE_PRIORITIES = Object.values(IssuePriority);

/** Sort weight for priority (higher = more urgent). */
export const PRIORITY_WEIGHT: Record<IssuePriority, number> = {
  URGENT: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  NONE: 0,
};

/**
 * Status categories. Project owners may create arbitrary named statuses,
 * but every status maps onto one of these categories so that cross-project
 * logic (velocity, "done", burndown) stays well defined.
 */
export const StatusCategory = {
  BACKLOG: 'BACKLOG',
  UNSTARTED: 'UNSTARTED',
  STARTED: 'STARTED',
  COMPLETED: 'COMPLETED',
  CANCELED: 'CANCELED',
} as const;
export type StatusCategory = (typeof StatusCategory)[keyof typeof StatusCategory];
export const STATUS_CATEGORIES = Object.values(StatusCategory);

/** Precedence relations between two scheduled issues. */
export const DependencyType = {
  FINISH_TO_START: 'FINISH_TO_START',
  START_TO_START: 'START_TO_START',
  FINISH_TO_FINISH: 'FINISH_TO_FINISH',
  START_TO_FINISH: 'START_TO_FINISH',
} as const;
export type DependencyType = (typeof DependencyType)[keyof typeof DependencyType];
export const DEPENDENCY_TYPES = Object.values(DependencyType);

/** Timeline zoom levels offered by the Gantt view. */
export const GanttScale = {
  DAY: 'DAY',
  WEEK: 'WEEK',
  MONTH: 'MONTH',
  QUARTER: 'QUARTER',
} as const;
export type GanttScale = (typeof GanttScale)[keyof typeof GanttScale];
export const GANTT_SCALES = Object.values(GanttScale);

export const SprintStatus = {
  PLANNED: 'PLANNED',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
} as const;
export type SprintStatus = (typeof SprintStatus)[keyof typeof SprintStatus];

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  INVITED: 'INVITED',
  DEACTIVATED: 'DEACTIVATED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const NotificationType = {
  ISSUE_ASSIGNED: 'ISSUE_ASSIGNED',
  ISSUE_MENTIONED: 'ISSUE_MENTIONED',
  ISSUE_STATUS_CHANGED: 'ISSUE_STATUS_CHANGED',
  ISSUE_COMMENTED: 'ISSUE_COMMENTED',
  ISSUE_DUE_SOON: 'ISSUE_DUE_SOON',
  ISSUE_DUE_DATE_CHANGED: 'ISSUE_DUE_DATE_CHANGED',
  ISSUE_UNASSIGNED: 'ISSUE_UNASSIGNED',
  SPRINT_STARTED: 'SPRINT_STARTED',
  SPRINT_COMPLETED: 'SPRINT_COMPLETED',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const ActivityType = {
  ISSUE_CREATED: 'ISSUE_CREATED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  ASSIGNEE_CHANGED: 'ASSIGNEE_CHANGED',
  PRIORITY_CHANGED: 'PRIORITY_CHANGED',
  TITLE_CHANGED: 'TITLE_CHANGED',
  DESCRIPTION_CHANGED: 'DESCRIPTION_CHANGED',
  TYPE_CHANGED: 'TYPE_CHANGED',
  LABEL_ADDED: 'LABEL_ADDED',
  LABEL_REMOVED: 'LABEL_REMOVED',
  DUE_DATE_CHANGED: 'DUE_DATE_CHANGED',
  STORY_POINTS_CHANGED: 'STORY_POINTS_CHANGED',
  EPIC_CHANGED: 'EPIC_CHANGED',
  SPRINT_CHANGED: 'SPRINT_CHANGED',
  PARENT_CHANGED: 'PARENT_CHANGED',
  SUBTASK_CREATED: 'SUBTASK_CREATED',
  COMMENT_ADDED: 'COMMENT_ADDED',
  COMMENT_DELETED: 'COMMENT_DELETED',
  ATTACHMENT_ADDED: 'ATTACHMENT_ADDED',
  ATTACHMENT_REMOVED: 'ATTACHMENT_REMOVED',
  ISSUE_ARCHIVED: 'ISSUE_ARCHIVED',
  PROJECT_CHANGED: 'PROJECT_CHANGED',
} as const;
export type ActivityType = (typeof ActivityType)[keyof typeof ActivityType];

export const AuditAction = {
  USER_LOGIN: 'USER_LOGIN',
  USER_LOGOUT: 'USER_LOGOUT',
  USER_REGISTERED: 'USER_REGISTERED',
  WORKSPACE_CREATED: 'WORKSPACE_CREATED',
  WORKSPACE_UPDATED: 'WORKSPACE_UPDATED',
  WORKSPACE_DELETED: 'WORKSPACE_DELETED',
  MEMBER_INVITED: 'MEMBER_INVITED',
  MEMBER_JOINED: 'MEMBER_JOINED',
  MEMBER_ROLE_CHANGED: 'MEMBER_ROLE_CHANGED',
  MEMBER_REMOVED: 'MEMBER_REMOVED',
  MEMBER_PASSWORD_RESET: 'MEMBER_PASSWORD_RESET',
  USER_PASSWORD_SET: 'USER_PASSWORD_SET',
  PROJECT_CREATED: 'PROJECT_CREATED',
  PROJECT_UPDATED: 'PROJECT_UPDATED',
  PROJECT_ARCHIVED: 'PROJECT_ARCHIVED',
  PROJECT_DELETED: 'PROJECT_DELETED',
  WORKFLOW_UPDATED: 'WORKFLOW_UPDATED',
  ISSUE_DELETED: 'ISSUE_DELETED',
  SPRINT_STARTED: 'SPRINT_STARTED',
  SPRINT_COMPLETED: 'SPRINT_COMPLETED',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const ViewLayout = {
  BOARD: 'BOARD',
  LIST: 'LIST',
  CALENDAR: 'CALENDAR',
} as const;
export type ViewLayout = (typeof ViewLayout)[keyof typeof ViewLayout];
