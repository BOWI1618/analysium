/**
 * Response shapes returned by the API. Declared by hand (rather than derived
 * from Prisma) so the wire format is an explicit, stable contract and internal
 * columns like passwordHash can never leak by accident.
 */
import type {
  ActivityType,
  DependencyType,
  IssuePriority,
  IssueRecurrence,
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

/** The signed-in person, with the settings only they can see. */
export interface SessionUserDto extends UserDto {
  /** Notifications left unread in the app are sent on by e-mail. */
  emailNotifications: boolean;
  /** The account is connected to the Telegram bot; notifications go there at once. */
  telegramLinked: boolean;
}

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
  /** The status a new task lands in when none is chosen — not necessarily the first column. */
  isDefault?: boolean;
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
  /** Set on a subproject: the project it is shown under in the navigation. */
  parentId: string | null;
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
  /** Set on a recurring task: closing it creates the next one. */
  recurrence: IssueRecurrence | null;
  rank: string;
  commentCount: number;
  attachmentCount: number;
  subtaskCount: number;
  subtaskDoneCount: number;
  /** Checklist items in the description: ticked and in all. */
  checklistDone: number;
  checklistTotal: number;
  /** Set for a subtask, so a list that shows it on its own can say whose part it is. */
  parent: { id: string; issueKey: string; title: string } | null;
  /**
   * Unfinished tasks this one cannot start before («окончание — начало» in the
   * Gantt chart). Why a task sits still is then visible in a list, not only
   * on the chart.
   */
  blockedBy: { id: string; issueKey: string; title: string }[];
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
  /** Whether the viewer hears about status, due date and comment changes. */
  watching: boolean;
  /** How many people hear about them in all — those who can open the task. */
  watcherCount: number;
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
  /** The project has more issues than the chart loads at once: what is drawn is not all of it. */
  truncated: boolean;
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

export type SavedViewLayout = 'BOARD' | 'LIST' | 'CALENDAR' | 'MY_WORK' | 'EMPLOYEE' | 'PLANNING' | 'DEPARTMENT';

/** What a view remembers besides the filters. */
export interface SavedViewDisplay {
  /** The page's own address parameters: whose tasks, which period, which department. */
  params?: Record<string, string>;
  columns?: string[];
  groupBy?: string;
}

export interface SavedViewDto {
  id: string;
  name: string;
  projectId: string | null;
  layout: SavedViewLayout;
  filters: Record<string, unknown>;
  display: SavedViewDisplay | null;
  /** Shown to the whole team; otherwise only its author sees it. */
  isShared: boolean;
  ownerId: string;
  ownerName: string;
  /** Whether the viewer may rename, change or delete it: the author, or an administrator for a shared one. */
  canManage: boolean;
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
  user: SessionUserDto;
  workspaces: WorkspaceDto[];
  activeWorkspaceId: string | null;
}

export interface DashboardDto {
  /**
   * The project as it stands now. `open` and `unassigned` count work still
   * to be done: neither includes completed or cancelled tasks.
   */
  totals: { total: number; completed: number; canceled: number; open: number; overdue: number; unassigned: number };
  /** What happened within the chosen period — the only figures the period changes. */
  period: { days: number; created: number; completed: number };
  byStatus: { statusId: string; name: string; color: string; category: StatusCategory; count: number }[];
  byPriority: { priority: IssuePriority; count: number }[];
  /** Per person: all their tasks ever, the completed ones, and what is on them now. */
  byAssignee: { user: UserSummaryDto | null; count: number; completed: number; active: number; overdue: number }[];
  byType: { type: IssueType; count: number }[];
  activity: { date: string; created: number; completed: number }[];
  sprint: (SprintDto & { burndown: { date: string; remaining: number | null; ideal: number }[] }) | null;
  velocity: { sprintId: string; name: string; committed: number; completed: number }[];
}

/**
 * A department of the workspace: who leads it and who is in it. The list is
 * kept by administrators; it says nothing about access to projects or tasks.
 */
/** One person's place in a department: a title and an immediate manager, both optional. */
export interface DepartmentPlaceDto {
  userId: string;
  /** «Главный специалист», «Ведущий специалист»… A title, not a role. */
  position: string | null;
  /** User id of the immediate manager — another member of the same department. */
  managerId: string | null;
}

export interface DepartmentDto {
  id: string;
  name: string;
  lead: UserSummaryDto | null;
  members: UserSummaryDto[];
  /** Who is what and who reports to whom, one entry per member. */
  structure: DepartmentPlaceDto[];
}

/** A person as the distribution screen shows them. */
export interface CascadePersonDto {
  user: UserSummaryDto;
  position: string | null;
}

/**
 * Task figures of one person or of a whole branch, over what the viewer may
 * read. A task has one assignee, so a branch counts each task once.
 */
export interface CascadeFiguresDto {
  /** Status category BACKLOG: handed over, not yet taken into work. */
  backlog: number;
  /** Not completed and not cancelled — the backlog included. */
  active: number;
  overdue: number;
}

export interface CascadeReportDto extends CascadePersonDto {
  /** The person's own tasks. */
  own: CascadeFiguresDto;
  /** Tasks of everyone below them, themselves excluded: what they have passed on and what their people took. */
  below: CascadeFiguresDto;
  /** Everyone below them, by user id — for a list of «передано дальше». Empty for someone with no reports. */
  belowUserIds: string[];
}

/** What the distribution screen stands on: a person, the line down to them, and their direct reports. */
export interface CascadeDto {
  /** Whose pool is shown: the viewer, or someone of the viewer's branch. */
  person: CascadePersonDto;
  department: { id: string; name: string } | null;
  /** From the viewer down to `person`; just the viewer for one's own pool. */
  chain: CascadePersonDto[];
  /** The person's immediate manager, if the register names one. */
  manager: CascadePersonDto | null;
  own: CascadeFiguresDto;
  /** The person's own tasks and those of everyone below them, each counted once. */
  branch: CascadeFiguresDto;
  /** How many people the branch holds, the person included. */
  branchSize: number;
  reports: CascadeReportDto[];
}

export interface DepartmentListDto {
  /** Every department for an administrator; for anyone else, those they lead. */
  items: DepartmentDto[];
  /** Whether the viewer may create, change and delete departments. */
  canManage: boolean;
}

/** Why someone hears about a task: by their part in it, or because they subscribed. */
export type WatcherReason = 'ASSIGNEE' | 'REPORTER' | 'COMMENTER' | 'SUBSCRIBED';

export interface WatcherDto {
  user: UserSummaryDto;
  reasons: WatcherReason[];
}

export interface IssueWatchersDto {
  items: WatcherDto[];
  /** Whether the viewer may subscribe other people and take their subscriptions away. */
  canManage: boolean;
}

/**
 * One person's tasks in figures, counted by the server over everything the
 * viewer may read — never over the rows a page happened to load.
 * Active: not completed and not cancelled. Due soon: active, not overdue, due
 * within the next seven days including today, in the viewer's time zone.
 */
export interface AssigneeStatsDto {
  userId: string;
  active: number;
  overdue: number;
  dueSoon: number;
  done: number;
  /** Story points of the active tasks: a relative estimate, never hours or a share of someone's time. */
  activePoints: number;
}

/** A task filled in advance: picked in the create form, changed there as needed. */
export interface IssueTemplateDto {
  id: string;
  /** What it is called in the list of templates: «Совещание». */
  name: string;
  /** The title a task made from it starts with. */
  title: string;
  description: unknown | null;
  type: IssueType;
  priority: IssuePriority;
  /** Days from the day the task is created to its deadline; `null` — no deadline. */
  dueInDays: number | null;
  storyPoints: number | null;
  recurrence: IssueRecurrence | null;
  /** Titles of the subtasks created together with the task. */
  subtasks: string[];
  /** Subscribed from the start; only people still in the workspace. */
  watchers: UserSummaryDto[];
}

export interface IssueTemplateListDto {
  items: IssueTemplateDto[];
  /** Whether the viewer may create, change and delete templates. */
  canManage: boolean;
}

/** One person's active work: in all, and by when it falls due. */
export interface WorkloadRowDto {
  userId: string;
  active: number;
  /** Also counted in the week its date falls into: every figure opens a list of exactly its tasks. */
  overdue: number;
  noDueDate: number;
  /** Due after the last week shown. */
  later: number;
  /** Active tasks without an estimate. */
  unestimated: number;
  /** Story points of the active tasks. A task split into estimated subtasks adds nothing of its own. */
  points: number;
  weeks: { count: number; points: number }[];
}

/**
 * Active work of several people over the coming weeks. Counts and relative
 * estimates only — never hours or a share of anyone's time.
 */
export interface WorkloadDto {
  /** The weeks as they were asked for: a task belongs to one when `start <= dueDate < end`. */
  weeks: { start: string; end: string }[];
  rows: WorkloadRowDto[];
  /** Whether any of the counted tasks carries an estimate; without one the estimate columns mean nothing. */
  usesEstimates: boolean;
  /** More active tasks than the calculation takes: the figures are incomplete. */
  truncated: boolean;
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
