/**
 * Request/response contracts. Every mutating endpoint parses its body through
 * one of these schemas *on the server* — the client uses the inferred types so
 * the two can never drift apart.
 */
import { z } from 'zod';

/**
 * Validation messages are user-facing, so they are written in Russian here —
 * the same strings the API returns and the forms render under each field.
 * A shared error map covers the built-in checks (required, min, max, email)
 * so individual schemas only spell out messages that need extra context.
 */
const errorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') {
        return { message: 'Обязательное поле' };
      }
      return { message: 'Некорректное значение' };
    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') {
        return issue.minimum === 1
          ? { message: 'Обязательное поле' }
          : { message: `Минимум ${issue.minimum} символов` };
      }
      return { message: `Минимальное значение — ${issue.minimum}` };
    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `Не больше ${issue.maximum} символов` };
      return { message: `Максимальное значение — ${issue.maximum}` };
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: 'Введите корректный адрес почты' };
      if (issue.validation === 'url') return { message: 'Введите корректную ссылку' };
      if (issue.validation === 'datetime') return { message: 'Некорректная дата' };
      return { message: 'Некорректный формат' };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: 'Недопустимое значение' };
    default:
      return { message: ctx.defaultError };
  }
};

z.setErrorMap(errorMap);
import {
  DEPENDENCY_TYPES,
  ISSUE_PRIORITIES,
  ISSUE_TYPES,
  PROJECT_ROLES,
  PROJECT_TYPES,
  STATUS_CATEGORIES,
  WORKSPACE_ROLES,
} from './enums';

export const cuidLike = z.string().min(6).max(40).regex(/^[A-Za-z0-9_-]+$/, 'Некорректный идентификатор');
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Ожидается цвет в формате #rrggbb');
const richDoc = z.record(z.unknown()).nullable().optional();

/* ------------------------------------------------------------------ auth */

export const passwordSchema = z
  .string()
  .min(8, 'Пароль должен быть не короче 8 символов')
  .max(200)
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), 'Пароль должен содержать букву и цифру');

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  password: passwordSchema,
  /** Optional: name for the workspace bootstrapped with the account. */
  workspaceName: z.string().trim().min(2).max(60).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  avatarUrl: z
    .string()
    .url()
    .regex(/^https?:\/\//, 'Только http(s) URL')
    .max(500)
    .nullable()
    .optional(),
  timezone: z.string().max(60).optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

/* ------------------------------------------------------------- workspace */

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(60),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Только строчные латинские буквы, цифры и дефисы')
    .optional(),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  logo: z.string().max(500).nullable().optional(),
});

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  role: z.enum(WORKSPACE_ROLES as [string, ...string[]]).default('MEMBER'),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const updateMemberSchema = z.object({
  role: z.enum(WORKSPACE_ROLES as [string, ...string[]]),
});

/* --------------------------------------------------------------- project */

export const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(80),
  key: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(6)
    .regex(/^[A-Z][A-Z0-9]+$/, '2–6 заглавных латинских букв или цифр, первая — буква'),
  description: z.string().trim().max(2000).optional(),
  icon: z.string().max(8).optional(),
  color: hexColor.optional(),
  projectType: z.enum(PROJECT_TYPES as [string, ...string[]]).default('KANBAN'),
  leadId: cuidLike.nullable().optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  icon: z.string().max(8).optional(),
  color: hexColor.optional(),
  projectType: z.enum(PROJECT_TYPES as [string, ...string[]]).optional(),
  leadId: cuidLike.nullable().optional(),
  isArchived: z.boolean().optional(),
});

export const projectMemberSchema = z.object({
  userId: cuidLike,
  role: z.enum(PROJECT_ROLES as [string, ...string[]]).default('CONTRIBUTOR'),
});

/* -------------------------------------------------------------- workflow */

export const createStatusSchema = z.object({
  name: z.string().trim().min(1).max(40),
  category: z.enum(STATUS_CATEGORIES as [string, ...string[]]),
  color: hexColor.optional(),
  wipLimit: z.number().int().min(0).max(999).nullable().optional(),
});
export type CreateStatusInput = z.infer<typeof createStatusSchema>;

export const updateStatusSchema = createStatusSchema.partial().extend({
  position: z.number().int().min(0).max(999).optional(),
});

export const reorderStatusesSchema = z.object({
  statusIds: z.array(cuidLike).min(1).max(50),
});

export const createLabelSchema = z.object({
  name: z.string().trim().min(1).max(30),
  color: hexColor,
});

/* ----------------------------------------------------------------- issue */

export const createIssueSchema = z.object({
  projectId: cuidLike,
  title: z.string().trim().min(1, 'Укажите название').max(300),
  description: richDoc,
  type: z.enum(ISSUE_TYPES as [string, ...string[]]).default('TASK'),
  statusId: cuidLike.optional(),
  priority: z.enum(ISSUE_PRIORITIES as [string, ...string[]]).default('MEDIUM'),
  assigneeId: cuidLike.nullable().optional(),
  parentId: cuidLike.nullable().optional(),
  epicId: cuidLike.nullable().optional(),
  sprintId: cuidLike.nullable().optional(),
  storyPoints: z.number().int().min(0).max(100).nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  isMilestone: z.boolean().optional(),
  labelIds: z.array(cuidLike).max(20).optional(),
});
export type CreateIssueInput = z.infer<typeof createIssueSchema>;

export const updateIssueSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: richDoc,
    type: z.enum(ISSUE_TYPES as [string, ...string[]]).optional(),
    statusId: cuidLike.optional(),
    priority: z.enum(ISSUE_PRIORITIES as [string, ...string[]]).optional(),
    assigneeId: cuidLike.nullable().optional(),
    parentId: cuidLike.nullable().optional(),
    epicId: cuidLike.nullable().optional(),
    sprintId: cuidLike.nullable().optional(),
    storyPoints: z.number().int().min(0).max(100).nullable().optional(),
    startDate: z.string().datetime().nullable().optional(),
    dueDate: z.string().datetime().nullable().optional(),
    isMilestone: z.boolean().optional(),
    /** Captures the current dates as the baseline the Gantt compares against. */
    setBaseline: z.boolean().optional(),
    labelIds: z.array(cuidLike).max(20).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Нет полей для обновления')
  .refine(
    (v) =>
      !v.startDate ||
      !v.dueDate ||
      new Date(v.startDate).getTime() <= new Date(v.dueDate).getTime(),
    { message: 'Дата начала должна быть не позже даты окончания', path: ['startDate'] },
  );
export type UpdateIssueInput = z.infer<typeof updateIssueSchema>;

export const moveIssueSchema = z.object({
  statusId: cuidLike.optional(),
  sprintId: cuidLike.nullable().optional(),
  /** Neighbours in the target column; the server computes the rank between. */
  beforeId: cuidLike.nullable().optional(),
  afterId: cuidLike.nullable().optional(),
});
export type MoveIssueInput = z.infer<typeof moveIssueSchema>;

export const bulkUpdateSchema = z.object({
  issueIds: z.array(cuidLike).min(1).max(200),
  patch: z.object({
    statusId: cuidLike.optional(),
    priority: z.enum(ISSUE_PRIORITIES as [string, ...string[]]).optional(),
    assigneeId: cuidLike.nullable().optional(),
    sprintId: cuidLike.nullable().optional(),
    epicId: cuidLike.nullable().optional(),
    addLabelIds: z.array(cuidLike).max(20).optional(),
    removeLabelIds: z.array(cuidLike).max(20).optional(),
  }),
});
export type BulkUpdateInput = z.infer<typeof bulkUpdateSchema>;

/* --------------------------------------------------------------- filters */

const csv = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean));

export const issueFilterSchema = z.object({
  projectId: z.union([cuidLike, z.array(cuidLike)]).optional(),
  statusId: csv.optional(),
  statusCategory: csv.optional(),
  assigneeId: csv.optional(),
  reporterId: csv.optional(),
  priority: csv.optional(),
  type: csv.optional(),
  labelId: csv.optional(),
  sprintId: csv.optional(),
  epicId: csv.optional(),
  parentId: cuidLike.optional(),
  search: z.string().trim().max(200).optional(),
  dueBefore: z.string().datetime().optional(),
  dueAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
  createdAfter: z.string().datetime().optional(),
  updatedAfter: z.string().datetime().optional(),
  /** `true` → only issues with no sprint; used by the backlog view. */
  noSprint: z.coerce.boolean().optional(),
  includeSubtasks: z.coerce.boolean().optional(),
  includeDone: z.coerce.boolean().optional(),
  isOverdue: z.coerce.boolean().optional(),
  sort: z
    .enum(['rank', 'created', 'updated', 'priority', 'dueDate', 'title', 'status'])
    .default('rank'),
  order: z.enum(['asc', 'desc']).default('asc'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});
export type IssueFilterInput = z.infer<typeof issueFilterSchema>;
/** Sort keys accepted by list/board endpoints. */
export type SortKey = IssueFilterInput['sort'];
export type SortOrder = IssueFilterInput['order'];

export const savedViewSchema = z.object({
  name: z.string().trim().min(1).max(60),
  projectId: cuidLike.nullable().optional(),
  layout: z.enum(['BOARD', 'LIST', 'CALENDAR']).default('LIST'),
  filters: z.record(z.unknown()),
  isShared: z.boolean().default(false),
});

/* -------------------------------------------------------------- comments */

export const createCommentSchema = z.object({
  body: z.record(z.unknown()),
});
export const updateCommentSchema = createCommentSchema;

/* ----------------------------------------------------------------- gantt */

export const ganttQuerySchema = z.object({
  /** Optional window: scheduled issues are clipped to those overlapping [from, to]; unscheduled ones are always returned for planning. */
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  includeDone: z.coerce.boolean().default(true),
  assigneeId: z.union([z.string(), z.array(z.string())]).optional(),
});
export type GanttQueryInput = z.infer<typeof ganttQuerySchema>;

export const createDependencySchema = z.object({
  predecessorId: cuidLike,
  successorId: cuidLike,
  type: z.enum(DEPENDENCY_TYPES as [string, ...string[]]).default('FINISH_TO_START'),
  lagDays: z.number().int().min(-365).max(365).default(0),
});
export type CreateDependencyInput = z.infer<typeof createDependencySchema>;

/** Drag/resize on the timeline. Both edges move together when the bar is dragged. */
export const rescheduleIssueSchema = z
  .object({
    startDate: z.string().datetime().nullable(),
    dueDate: z.string().datetime().nullable(),
    /** Apply the shifts the server suggests for dependent issues. */
    cascade: z.boolean().default(false),
  })
  .refine(
    (v) =>
      !v.startDate ||
      !v.dueDate ||
      new Date(v.startDate).getTime() <= new Date(v.dueDate).getTime(),
    { message: 'Дата начала должна быть не позже даты окончания', path: ['startDate'] },
  );
export type RescheduleIssueInput = z.infer<typeof rescheduleIssueSchema>;

/* --------------------------------------------------------------- sprints */

export const createSprintSchema = z.object({
  name: z.string().trim().min(1).max(80),
  goal: z.string().trim().max(500).nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  endDate: z.string().datetime().nullable().optional(),
});
export type CreateSprintInput = z.infer<typeof createSprintSchema>;

export const updateSprintSchema = createSprintSchema
  .partial()
  .refine(
    (v) =>
      !v.startDate || !v.endDate || new Date(v.startDate).getTime() <= new Date(v.endDate).getTime(),
    { message: 'Дата начала должна быть не позже даты окончания', path: ['startDate'] },
  );

export const completeSprintSchema = z.object({
  /** Where unfinished issues go: back to backlog or into another sprint. */
  moveUnfinishedTo: z.union([z.literal('backlog'), cuidLike]).default('backlog'),
});

/* --------------------------------------------------------- notifications */

export const notificationQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(200).optional(),
});

/* ---------------------------------------------------------------- search */

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(30).default(8),
});

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});
