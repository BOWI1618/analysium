/**
 * Prisma select fragments + DTO mappers.
 *
 * Declaring the selects once means every endpoint returns the same shape, and
 * — more importantly — columns that must never leave the server (passwordHash,
 * tokenHash, storageKey) are simply not selectable through these helpers.
 */
import type { Prisma } from '@prisma/client';
import type {
  ActivityDto,
  AttachmentDto,
  CommentDto,
  IssueSummaryDto,
  LabelDto,
  SprintDto,
  StatusDto,
  UserSummaryDto,
} from '@flowdesk/contracts';
import { PREVIEWABLE_MIME } from './storage';

export const userSummarySelect = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
} satisfies Prisma.UserSelect;

export const statusSelect = {
  id: true,
  name: true,
  category: true,
  color: true,
  position: true,
  wipLimit: true,
} satisfies Prisma.WorkflowStatusSelect;

export const labelSelect = { id: true, name: true, color: true } satisfies Prisma.LabelSelect;

export const issueSummarySelect = {
  id: true,
  issueKey: true,
  title: true,
  type: true,
  priority: true,
  statusId: true,
  projectId: true,
  sprintId: true,
  storyPoints: true,
  startDate: true,
  dueDate: true,
  startHasTime: true,
  dueHasTime: true,
  carriedOverDays: true,
  isMilestone: true,
  recurrence: true,
  rank: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  status: { select: statusSelect },
  project: { select: { id: true, key: true, name: true, color: true, icon: true } },
  assignee: { select: userSummarySelect },
  reporter: { select: userSummarySelect },
  labels: { select: { label: { select: labelSelect } } },
  epic: { select: { id: true, issueKey: true, title: true, project: { select: { color: true } } } },
  _count: { select: { comments: true, attachments: true } },
  subtasks: { select: { id: true, status: { select: { category: true } } } },
  parent: { select: { id: true, issueKey: true, title: true } },
} satisfies Prisma.IssueSelect;

type IssueRow = Prisma.IssueGetPayload<{ select: typeof issueSummarySelect }>;

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function toUserSummary(u: {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
} | null): UserSummaryDto | null {
  return u ? { id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl } : null;
}

export function toStatus(s: Prisma.WorkflowStatusGetPayload<{ select: typeof statusSelect }>): StatusDto {
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    color: s.color,
    position: s.position,
    wipLimit: s.wipLimit,
  };
}

export function toLabel(l: { id: string; name: string; color: string }): LabelDto {
  return { id: l.id, name: l.name, color: l.color };
}

export function toIssueSummary(issue: IssueRow): IssueSummaryDto {
  const subtasks = issue.subtasks ?? [];
  return {
    id: issue.id,
    issueKey: issue.issueKey,
    title: issue.title,
    type: issue.type,
    priority: issue.priority,
    statusId: issue.statusId,
    status: toStatus(issue.status),
    projectId: issue.projectId,
    project: issue.project,
    assignee: toUserSummary(issue.assignee),
    reporter: toUserSummary(issue.reporter),
    labels: issue.labels.map((l) => toLabel(l.label)),
    epic: issue.epic
      ? {
          id: issue.epic.id,
          issueKey: issue.epic.issueKey,
          title: issue.epic.title,
          color: issue.epic.project.color,
        }
      : null,
    sprintId: issue.sprintId,
    storyPoints: issue.storyPoints,
    startDate: iso(issue.startDate),
    dueDate: iso(issue.dueDate),
    startHasTime: issue.startHasTime,
    dueHasTime: issue.dueHasTime,
    carriedOverDays: issue.carriedOverDays,
    isMilestone: issue.isMilestone,
    recurrence: issue.recurrence,
    rank: issue.rank,
    commentCount: issue._count.comments,
    attachmentCount: issue._count.attachments,
    subtaskCount: subtasks.length,
    subtaskDoneCount: subtasks.filter((s) => s.status.category === 'COMPLETED').length,
    parent: issue.parent ?? null,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
    completedAt: iso(issue.completedAt),
  };
}

export const attachmentSelect = {
  id: true,
  filename: true,
  mimeType: true,
  size: true,
  createdAt: true,
  uploader: { select: userSummarySelect },
} satisfies Prisma.AttachmentSelect;

export function toAttachment(
  a: Prisma.AttachmentGetPayload<{ select: typeof attachmentSelect }>,
): AttachmentDto {
  return {
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    size: a.size,
    url: `/api/v1/attachments/${a.id}/content`,
    uploadedBy: toUserSummary(a.uploader)!,
    createdAt: a.createdAt.toISOString(),
    isImage: PREVIEWABLE_MIME.has(a.mimeType) && a.mimeType.startsWith('image/'),
  };
}

export const commentSelect = {
  id: true,
  issueId: true,
  body: true,
  createdAt: true,
  updatedAt: true,
  editedAt: true,
  author: { select: userSummarySelect },
  attachments: { select: attachmentSelect },
} satisfies Prisma.CommentSelect;

export function toComment(
  c: Prisma.CommentGetPayload<{ select: typeof commentSelect }>,
  perms: { canEdit: boolean; canDelete: boolean },
): CommentDto {
  return {
    id: c.id,
    issueId: c.issueId,
    body: c.body,
    author: toUserSummary(c.author)!,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    editedAt: iso(c.editedAt),
    attachments: c.attachments.map(toAttachment),
    canEdit: perms.canEdit,
    canDelete: perms.canDelete,
  };
}

export const activitySelect = {
  id: true,
  type: true,
  field: true,
  fromValue: true,
  toValue: true,
  metadata: true,
  createdAt: true,
  actor: { select: userSummarySelect },
} satisfies Prisma.ActivityEventSelect;

export function toActivity(
  a: Prisma.ActivityEventGetPayload<{ select: typeof activitySelect }>,
): ActivityDto {
  return {
    id: a.id,
    type: a.type,
    actor: toUserSummary(a.actor) ?? { id: 'system', name: 'Система', email: '', avatarUrl: null },
    field: a.field,
    fromValue: a.fromValue,
    toValue: a.toValue,
    metadata: (a.metadata ?? null) as Record<string, unknown> | null,
    createdAt: a.createdAt.toISOString(),
  };
}

export interface SprintAggregate {
  id: string;
  projectId: string;
  name: string;
  goal: string | null;
  status: 'PLANNED' | 'ACTIVE' | 'COMPLETED';
  startDate: Date | null;
  endDate: Date | null;
  completedAt: Date | null;
  issues?: { storyPoints: number | null; status: { category: string } }[];
}

export function toSprint(s: SprintAggregate): SprintDto {
  const issues = s.issues ?? [];
  const done = issues.filter((i) => i.status.category === 'COMPLETED');
  return {
    id: s.id,
    projectId: s.projectId,
    name: s.name,
    goal: s.goal,
    status: s.status,
    startDate: iso(s.startDate),
    endDate: iso(s.endDate),
    completedAt: iso(s.completedAt),
    issueCount: issues.length,
    completedIssueCount: done.length,
    totalPoints: issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0),
    completedPoints: done.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0),
  };
}

export const sprintInclude = {
  issues: { select: { storyPoints: true, status: { select: { category: true } } } },
} satisfies Prisma.SprintInclude;
