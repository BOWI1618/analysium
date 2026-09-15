/**
 * Moving an issue to another project of the same workspace — for example a
 * task created without a project that turned out to belong to one.
 *
 * Everything project-scoped is translated rather than dropped where it can be:
 *   - the issue gets the next number of the target project (TASK-3 → AS-7),
 *     its subtasks are numbered after it (AS-7.1, AS-7.2); old keys keep
 *     resolving through the activity history;
 *   - the status is matched by name, then by category, then the default;
 *   - labels are matched by name, and missing ones are created in the target;
 *   - subtasks move along; a subtask moved on its own becomes a plain task;
 *   - sprint and epic belong to the old project and are cleared, as are
 *     dependencies to issues that stay behind;
 *   - an assignee who cannot open the target project is unassigned.
 */
import type { IssueDetailDto } from '@flowdesk/contracts';
import { ActivityType, Permission, RealtimeEventType, rankBetween } from '@flowdesk/contracts';
import { prisma } from '../../lib/prisma';
import { assertCan, issueContext, projectContext } from '../../lib/context';
import { badRequest, notFound } from '../../lib/errors';
import { emit } from '../../realtime/eventBus';
import { formatIssueKey, nextCompletedAt } from '../../domain/issueRules';
import { getIssue } from './service';

export async function transferIssue(userId: string, issueId: string, targetProjectId: string): Promise<IssueDetailDto> {
  const { actor, issue, project: source } = await issueContext(userId, issueId);
  assertCan(actor, Permission.ISSUE_UPDATE);

  if (issue.projectId === targetProjectId) throw badRequest('Задача уже в этом проекте');
  // A guest outside the target, or a project of another workspace, reads as
  // missing rather than forbidden.
  const target = await projectContext(userId, targetProjectId);
  if (target.project.workspaceId !== actor.workspaceId) throw notFound('Проект');
  assertCan(target.actor, Permission.ISSUE_CREATE, 'Недостаточно прав, чтобы добавлять задачи в этот проект');
  if (target.project.isArchived) throw badRequest('Проект в архиве — перенести в него задачу нельзя');

  const root = await prisma.issue.findUniqueOrThrow({
    where: { id: issueId },
    select: { id: true, type: true, parentId: true },
  });
  const subtasks = await prisma.issue.findMany({
    where: { parentId: root.id },
    orderBy: { subNumber: 'asc' },
    select: { id: true },
  });
  const movedIds = [root.id, ...subtasks.map((s) => s.id)];

  const result = await prisma.$transaction(async (tx) => {
    // One transfer into a project at a time keeps numbers and ranks consistent.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${targetProjectId}))`;

    const [targetStatuses, targetLabels, moved] = await Promise.all([
      tx.workflowStatus.findMany({
        where: { projectId: targetProjectId },
        orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
        select: { id: true, name: true, category: true },
      }),
      tx.label.findMany({ where: { projectId: targetProjectId }, select: { id: true, name: true } }),
      tx.issue.findMany({
        where: { id: { in: movedIds } },
        select: {
          id: true,
          issueKey: true,
          assigneeId: true,
          completedAt: true,
          status: { select: { name: true, category: true } },
          labels: { select: { label: { select: { name: true, color: true } } } },
        },
      }),
    ]);
    if (targetStatuses.length === 0) throw badRequest('В проекте не настроены статусы');

    const statusFor = (from: { name: string; category: string }) =>
      targetStatuses.find((s) => s.name.toLowerCase() === from.name.toLowerCase()) ??
      targetStatuses.find((s) => s.category === from.category) ??
      targetStatuses[0]!;

    // Labels by name; the ones the target lacks are created there.
    const labelIdByName = new Map(targetLabels.map((l) => [l.name.toLowerCase(), l.id]));
    for (const { label } of moved.flatMap((m) => m.labels)) {
      if (labelIdByName.has(label.name.toLowerCase())) continue;
      const created = await tx.label.create({
        data: { projectId: targetProjectId, name: label.name, color: label.color },
        select: { id: true },
      });
      labelIdByName.set(label.name.toLowerCase(), created.id);
    }

    // Assignees who cannot open the target project: guests not added to it.
    const assigneeIds = [...new Set(moved.map((m) => m.assigneeId).filter((id): id is string => Boolean(id)))];
    const allowedAssignees = new Set(
      (
        await tx.workspaceMember.findMany({
          where: {
            workspaceId: actor.workspaceId,
            userId: { in: assigneeIds },
            OR: [{ role: { not: 'GUEST' } }, { user: { projectRoles: { some: { projectId: targetProjectId } } } }],
          },
          select: { userId: true },
        })
      ).map((m) => m.userId),
    );

    // The moved task takes the target's next number; its subtasks follow it
    // as .1, .2, … in their existing order.
    const { issueCounter: rootNumber } = await tx.project.update({
      where: { id: targetProjectId },
      data: { issueCounter: { increment: 1 } },
      select: { issueCounter: true },
    });

    const keys: { id: string; from: string; to: string }[] = [];
    for (const [index, id] of movedIds.entries()) {
      const current = moved.find((m) => m.id === id)!;
      const status = statusFor(current.status);
      const first = await tx.issue.findFirst({
        where: { projectId: targetProjectId, statusId: status.id },
        orderBy: { rank: 'asc' },
        select: { rank: true },
      });
      const isRoot = id === root.id;
      const subNumber = isRoot ? 0 : index;
      const issueKey = formatIssueKey(target.project.key, rootNumber, subNumber);

      await tx.issueLabel.deleteMany({ where: { issueId: id } });
      await tx.issue.update({
        where: { id },
        data: {
          projectId: targetProjectId,
          number: rootNumber,
          subNumber,
          ...(isRoot ? { subtaskCounter: subtasks.length } : {}),
          issueKey,
          statusId: status.id,
          rank: rankBetween(null, first?.rank ?? null),
          completedAt: nextCompletedAt(status.category as never, current.completedAt),
          sprintId: null,
          epicId: null,
          assigneeId: current.assigneeId && allowedAssignees.has(current.assigneeId) ? current.assigneeId : null,
          // A subtask moved on its own leaves its parent behind.
          ...(isRoot && root.parentId ? { parentId: null, type: 'TASK' as never } : {}),
          labels: {
            create: [...new Set(current.labels.map(({ label }) => labelIdByName.get(label.name.toLowerCase())!))].map(
              (labelId) => ({ labelId }),
            ),
          },
        },
      });
      await tx.activityEvent.create({
        data: {
          issueId: id,
          actorId: actor.userId,
          type: ActivityType.PROJECT_CHANGED,
          field: 'project',
          fromValue: current.issueKey,
          toValue: issueKey,
          metadata: { fromProject: source.name, toProject: target.project.name },
        },
      });
      keys.push({ id, from: current.issueKey, to: issueKey });
    }

    // Links that only make sense inside one project.
    if (root.type === 'EPIC') {
      await tx.issue.updateMany({ where: { epicId: root.id, id: { notIn: movedIds } }, data: { epicId: null } });
    }
    await tx.issueDependency.deleteMany({
      where: {
        OR: [
          { predecessorId: { in: movedIds }, successorId: { notIn: movedIds } },
          { successorId: { in: movedIds }, predecessorId: { notIn: movedIds } },
        ],
      },
    });

    return keys;
  });

  for (const key of result) {
    emit(RealtimeEventType.ISSUE_DELETED, {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      payload: { issueId: key.id, issueKey: key.from, projectId: source.id },
    });
    emit(RealtimeEventType.ISSUE_CREATED, {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      payload: { issueId: key.id, issueKey: key.to, projectId: targetProjectId },
    });
  }

  return getIssue(target.actor, issueId);
}
