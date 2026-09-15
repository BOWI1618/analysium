/**
 * Response shapes returned by the API. Declared by hand (rather than derived
 * from Prisma) so the wire format is an explicit, stable contract and internal
 * columns like passwordHash can never leak by accident.
 */
import type {
  ActivityType,
  DependencyType,
  IssuePriority,
  IssueType,
  NotificationType,
  ProjectRole,
  ProjectType,
  SprintStatus,
  StatusCategory,
  UserStatus,
  WorkspaceRole,
} from './enums';
import type { Permission } from './permissions';

export interface UserDto {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  status: UserStatus;
  timezone: string;
  lastActiveAt: string | null;
}

export type UserSummaryDto = Pick<UserDto, 'id' | 'name' | 'avatarUrl' | 'email'>;

export interface WorkspaceDto {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  ownerId: string;
  role: WorkspaceRole;
  memberCount: number;
  projectCount: number;
  createdAt: string;
  /** Unfinished tasks move to the next day on their own. */
  carryOverTasks: boolean;
}

export interface MemberDto {
  id: string;
  role: WorkspaceRole;
  joinedAt: string;
  user: UserSummaryDto & { status: UserStatus; lastActiveAt: string | null };
  /**
   * Present only in the reply to an invitation, and only for a person without
   * an account. The link is handed to the admin as well as mailed, so an
   * invitation still works when mail is off or a message never arrives — it can
   * be passed on through any messenger.
   */
  invite?: { url: string; emailSent: boolean };
  /**
   * Until when the person may sign in without a password after an admin reset
   * it. Only people who manage members see it; for everyone else it is null.
   */
  passwordResetExpiresAt: string | null;
}

/** Sign-in answer while an admin's password reset is pending: no session yet,
 *  only a token that is good for choosing the new password. */
export interface PasswordResetRequired {
  passwordResetRequired: true;
  token: string;
}

/** An unused join code as the admin sees it. The code itself is never listed:
 *  only its hash is stored, so it is shown exactly once, when created. */
export interface InviteCodeDto {
  id: string;
  role: WorkspaceRole;
  createdAt: string;
  expiresAt: string;
  createdBy: { id: string; name: string } | null;
}

/** Returned once, at creation — the only moment the plain code exists. */
export interface CreatedInviteCodeDto extends InviteCodeDto {
  code: string;
}

export interface StatusDto {
  id: string;
  name: string;
  category: StatusCategory;
  color: string;
  position: number;
  wipLimit: number | null;
  issueCount?: number;
}

export interface LabelDto {
  id: string;
  name: string;
  color: string;
  issueCount?: number;
}

export interface ProjectDto {
  id: string;
  workspaceId: string;
  name: string;
  key: string;
  description: string | null;
  icon: string;
  color: string;
  projectType: ProjectType;
  isArchived: boolean;
  /** The workspace's list of tasks without a project — not a project to people. */
  isSystem: boolean;
  lead: UserSummaryDto | null;
  createdAt: string;
  updatedAt: string;
  isFavorite: boolean;
  openIssueCount?: number;
  totalIssueCount?: number;
  myRole?: ProjectRole | null;
}

export interface ProjectDetailDto extends ProjectDto {
  statuses: StatusDto[];
  labels: LabelDto[];
  /** Explicit project roles (lead, member). Not the list of people who can work here — see `assignees`. */
  members: { userId: string; role: ProjectRole; user: UserSummaryDto }[];
  /**
   * Everyone who can see this project and so can be assigned or mentioned:
   * every non-guest member of the workspace, plus guests added to the project.
   * The explicit role list above is far shorter — a fresh project holds only
   * its lead — and offering that list made teammates impossible to assign.
   */
  assignees: UserSummaryDto[];
  activeSprint: SprintDto | null;
  permissions: Permission[];
}

export interface IssueSummaryDto {
  id: string;
  issueKey: string;
  title: string;
  type: IssueType;
  priority: IssuePriority;
  statusId: string;
  status: StatusDto;
  projectId: string;
  project: { id: string; key: string; name: string; color: string; icon: string };
  assignee: UserSummaryDto | null;
  reporter: UserSummaryDto | null;
  labels: LabelDto[];
  epic: { id: string; issueKey: string; title: string; color: string } | null;
  sprintId: string | null;
  storyPoints: number | null;
  startDate: string | null;
  dueDate: string | null;
  /** Whether a time of day was set; without one the date is the whole day. */
  startHasTime: boolean;
  dueHasTime: boolean;
  /** Days the task was carried over to the next day unfinished. */
  carriedOverDays: number;
  isMilestone: boolean;
  rank: string;
  commentCount: number;
  attachmentCount: number;
  subtaskCount: number;
  subtaskDoneCount: number;
  /** Set for a subtask, so a list that shows it on its own can say whose part it is. */
  parent: { id: string; issueKey: string; title: string } | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface IssueDetailDto extends IssueSummaryDto {
  description: unknown;
  parent: { id: string; issueKey: string; title: string } | null;
  sprint: SprintDto | null;
  subtasks: IssueSummaryDto[];
  attachments: AttachmentDto[];
  permissions: Permission[];
}

export interface CommentDto {
  id: string;
  issueId: string;
  body: unknown;
  author: UserSummaryDto;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  attachments: AttachmentDto[];
  canEdit: boolean;
  canDelete: boolean;
}

export interface AttachmentDto {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  uploadedBy: UserSummaryDto;
  createdAt: string;
  isImage: boolean;
}

export interface ActivityDto {
  id: string;
  type: ActivityType;
  actor: UserSummaryDto;
  field: string | null;
  fromValue: string | null;
  toValue: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface SprintDto {
  id: string;
  projectId: string;
  name: string;
  goal: string | null;
  status: SprintStatus;
  startDate: string | null;
  endDate: string | null;
  completedAt: string | null;
  issueCount: number;
  completedIssueCount: number;
  totalPoints: number;
  completedPoints: number;
}

/* ----------------------------------------------------------------- gantt */

export interface DependencyDto {
  id: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagDays: number;
}

/** One link as seen from an issue: the dependency and the issue at its other end. */
export interface IssueLinkDto {
  dependencyId: string;
  type: DependencyType;
  lagDays: number;
  issue: { id: string; issueKey: string; title: string; status: StatusDto };
}

/** The links of one issue, split by direction. */
export interface IssueLinksDto {
  /** Issues this one waits for — its predecessors. */
  dependsOn: IssueLinkDto[];
  /** Issues waiting for this one — its successors. */
  blocks: IssueLinkDto[];
}

/** One row of the work-breakdown tree on the left of the chart. */
export interface GanttRowDto {
  id: string;
  issueKey: string;
  title: string;
  type: IssueType;
  priority: IssuePriority;
  status: StatusDto;
  assignee: UserSummaryDto | null;
  parentId: string | null;
  /** 0 for a top-level row; used to indent without re-walking the tree. */
  depth: number;
  hasChildren: boolean;
  storyPoints: number | null;
  /** Scheduled window. Null when the issue has no dates at all. */
  start: string | null;
  end: string | null;
  /** Whether the edge is an exact time rather than a whole day. */
  startHasTime: boolean;
  endHasTime: boolean;
  /** Dates rolled up from children rather than set on the issue itself. */
  isSummary: boolean;
  isMilestone: boolean;
  /** 0–1, weighted by story points where the team estimates. */
  progress: number;
  baselineStart: string | null;
  baselineEnd: string | null;
  /** Days of float before this issue delays the project end. */
  slackDays: number | null;
  isCritical: boolean;
  isOverdue: boolean;
}

export interface GanttDto {
  rows: GanttRowDto[];
  dependencies: DependencyDto[];
  /** Full span of scheduled work, so the client can size the timeline once. */
  range: { start: string; end: string } | null;
  /** Issues with no dates at all — shown in a separate "unscheduled" tray. */
  unscheduledCount: number;
  permissions: Permission[];
}

/** Returned by a reschedule so the UI can offer to move dependent work. */
export interface ScheduleShiftDto {
  issueId: string;
  issueKey: string;
  title: string;
  fromStart: string;
  toStart: string;
  days: number;
}

export interface RescheduleResultDto {
  issue: IssueSummaryDto;
  /** Empty when nothing downstream is violated. */
  suggestedShifts: ScheduleShiftDto[];
  appliedShifts: number;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
  actor: UserSummaryDto | null;
  issue: { id: string; issueKey: string; title: string; projectId: string } | null;
  workspaceId: string;
}

export interface SavedViewDto {
  id: string;
  name: string;
  projectId: string | null;
  layout: 'BOARD' | 'LIST' | 'CALENDAR';
  filters: Record<string, unknown>;
  isShared: boolean;
  ownerId: string;
  createdAt: string;
}

export interface AuditLogDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: UserSummaryDto | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

export interface SessionDto {
  user: UserDto;
  workspaces: WorkspaceDto[];
  activeWorkspaceId: string | null;
}

export interface DashboardDto {
  totals: { total: number; completed: number; open: number; overdue: number; unassigned: number };
  byStatus: { statusId: string; name: string; color: string; category: StatusCategory; count: number }[];
  byPriority: { priority: IssuePriority; count: number }[];
  byAssignee: { user: UserSummaryDto | null; count: number; completed: number }[];
  byType: { type: IssueType; count: number }[];
  activity: { date: string; created: number; completed: number }[];
  sprint: (SprintDto & { burndown: { date: string; remaining: number | null; ideal: number }[] }) | null;
  velocity: { sprintId: string; name: string; committed: number; completed: number }[];
}

export interface SearchResultsDto {
  issues: (IssueSummaryDto & { snippet?: string })[];
  projects: { id: string; name: string; key: string; icon: string; color: string }[];
  users: UserSummaryDto[];
  epics: { id: string; issueKey: string; title: string; projectId: string; color: string }[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Field-level messages for form rendering. */
    fields?: Record<string, string>;
    requestId?: string;
  };
}
