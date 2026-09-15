/**
 * «Дублировать задачу», as Weeek does it: a copy in the same project and the
 * same column, with the parts the user chose — description, subtasks,
 * assignee, labels and dates. History, comments and files stay with the
 * original. A copied subtask stays under the same parent.
 */
import type { DuplicateIssueInput, IssueDetailDto } from '@flowdesk/contracts';
import { Permission } from '@flowdesk/contracts';
import { prisma } from '../../lib/prisma';
import { assertCan, issueContext } from '../../lib/context';
import { createIssue, getIssue } from './service';

const copySelect = {
  id: true,
  title: true,
  description: true,
  type: true,
  statusId: true,
  priority: true,
  assigneeId: true,
  parentId: true,
  epicId: true,
  sprintId: true,
  storyPoints: true,
  startDate: true,
  dueDate: true,
  startHasTime: true,
  dueHasTime: true,
  isMilestone: true,
  labels: { select: { labelId: true } },
} as const;

export async function duplicateIssue(userId: string, issueId: string, input: DuplicateIssueInput): Promise<IssueDetailDto> {
  const { actor, project } = await issueContext(userId, issueId);
  assertCan(actor, Permission.ISSUE_CREATE);

  const source = await prisma.issue.findUniqueOrThrow({ where: { id: issueId }, select: copySelect });
  const subtasks = input.subtasks
    ? await prisma.issue.findMany({
        where: { parentId: issueId, archivedAt: null },
        orderBy: { subNumber: 'asc' },
        select: copySelect,
      })
    : [];

  const copyOf = (issue: typeof source, title: string, parentId: string | null) => ({
    projectId: project.id,
    title,
    description: input.description ? ((issue.description as Record<string, unknown> | null) ?? null) : null,
    type: issue.type,
    statusId: issue.statusId,
    priority: issue.priority,
    assigneeId: input.assignee ? issue.assigneeId : null,
    parentId,
    epicId: issue.epicId,
    sprintId: issue.sprintId,
    storyPoints: issue.storyPoints,
    startDate: input.dates ? (issue.startDate?.toISOString() ?? null) : null,
    dueDate: input.dates ? (issue.dueDate?.toISOString() ?? null) : null,
    startHasTime: input.dates ? issue.startHasTime : false,
    dueHasTime: input.dates ? issue.dueHasTime : false,
    isMilestone: issue.isMilestone,
    labelIds: input.labels ? issue.labels.map((l) => l.labelId) : [],
  });

  const copy = await createIssue(actor, copyOf(source, input.title, source.parentId), project.key);
  for (const subtask of subtasks) {
    await createIssue(actor, copyOf(subtask, subtask.title, copy.id), project.key);
  }

  return getIssue(actor, copy.id);
}
