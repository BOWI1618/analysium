import type { ActorContext, CreateSprintInput, SprintDto } from '@flowdesk/contracts';
import { AuditAction, NotificationType, Permission, RealtimeEventType } from '@flowdesk/contracts';
import { prisma } from '../../lib/prisma';
import { assertCan } from '../../lib/context';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { emit } from '../../realtime/eventBus';
import { sprintInclude, toSprint } from '../../lib/serialize';
import { SPRINT_MOVE_MESSAGES, validateSprintMove } from '../../domain/sprintRules';
import { notify } from '../notifications/service';

export async function listSprints(projectId: string): Promise<SprintDto[]> {
  const sprints = await prisma.sprint.findMany({
    where: { projectId },
    orderBy: [{ status: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
    include: sprintInclude,
  });
  return sprints.map(toSprint);
}

export async function createSprint(
  actor: ActorContext,
  projectId: string,
  input: CreateSprintInput,
): Promise<SprintDto> {
  assertCan(actor, Permission.SPRINT_MANAGE);

  if (input.startDate && input.endDate && new Date(input.startDate) > new Date(input.endDate)) {
    throw badRequest('Дата начала спринта должна быть раньше даты окончания', { endDate: 'Must be after the start date' });
  }

  const last = await prisma.sprint.findFirst({
    where: { projectId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  const sprint = await prisma.sprint.create({
    data: {
      projectId,
      name: input.name,
      goal: input.goal ?? null,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
      position: (last?.position ?? -1) + 1,
    },
    include: sprintInclude,
  });

  emitSprint(actor, sprint.id, projectId);
  return toSprint(sprint);
}

export async function updateSprint(
  actor: ActorContext,
  sprintId: string,
  patch: Partial<CreateSprintInput>,
): Promise<SprintDto> {
  assertCan(actor, Permission.SPRINT_MANAGE);
  const existing = await requireSprint(actor, sprintId);

  const sprint = await prisma.sprint.update({
    where: { id: sprintId },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.goal !== undefined ? { goal: patch.goal } : {}),
      ...(patch.startDate !== undefined ? { startDate: patch.startDate ? new Date(patch.startDate) : null } : {}),
      ...(patch.endDate !== undefined ? { endDate: patch.endDate ? new Date(patch.endDate) : null } : {}),
    },
    include: sprintInclude,
  });

  emitSprint(actor, sprintId, existing.projectId);
  return toSprint(sprint);
}

/**
 * Starting a sprint snapshots the committed story points — velocity must be
 * measured against what the team signed up for, not what was added later.
 */
export async function startSprint(actor: ActorContext, sprintId: string): Promise<SprintDto> {
  assertCan(actor, Permission.SPRINT_MANAGE);
  const sprint = await requireSprint(actor, sprintId);

  if (sprint.status === 'COMPLETED') throw badRequest('Спринт уже завершён');
  if (sprint.status === 'ACTIVE') throw badRequest('Спринт уже активен');

  const { updated, issues, committedPoints } = await prisma.$transaction(async (tx) => {
    // Serialize concurrent starts within the project — the conditional update
    // alone can still pass at READ COMMITTED when both transactions snapshot
    // before either one commits.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sprint.projectId}))`;

    const issues = await tx.issue.findMany({
      where: { sprintId },
      select: { storyPoints: true, assigneeId: true },
    });
    const committedPoints = issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);

    // Check-and-act in a single conditional update: either this sprint is still
    // PLANNED with no ACTIVE sibling, or nothing is updated.
    const started = await tx.sprint.updateMany({
      where: {
        id: sprintId,
        status: 'PLANNED',
        project: { sprints: { none: { status: 'ACTIVE' } } },
      },
      data: {
        status: 'ACTIVE',
        committedPoints,
        startDate: sprint.startDate ?? new Date(),
        endDate: sprint.endDate ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    });
    if (started.count !== 1) {
      const active = await tx.sprint.findFirst({
        where: { projectId: sprint.projectId, status: 'ACTIVE' },
        select: { name: true },
      });
      if (active) throw conflict(`Спринт «${active.name}» ещё активен — сначала завершите его`);
      throw badRequest('Спринт уже завершён');
    }

    const updated = await tx.sprint.findUniqueOrThrow({ where: { id: sprintId }, include: sprintInclude });
    return { updated, issues, committedPoints };
  });

  audit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: AuditAction.SPRINT_STARTED,
    entityType: 'Sprint',
    entityId: sprintId,
    metadata: { committedPoints, issueCount: issues.length },
  });

  await notify({
    userIds: issues.map((i) => i.assigneeId).filter((id): id is string => Boolean(id)),
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    type: NotificationType.SPRINT_STARTED,
    title: `Sprint "${updated.name}" started`,
    body: updated.goal,
  });

  emitSprint(actor, sprintId, sprint.projectId);
  return toSprint(updated);
}

/**
 * Completing a sprint moves everything unfinished somewhere explicit — either
 * back to the backlog or forward into another sprint. Nothing is silently lost.
 */
export async function completeSprint(
  actor: ActorContext,
  sprintId: string,
  moveUnfinishedTo: string,
): Promise<{ sprint: SprintDto; movedCount: number }> {
  assertCan(actor, Permission.SPRINT_MANAGE);
  const sprint = await requireSprint(actor, sprintId);
  if (sprint.status !== 'ACTIVE') throw badRequest('Завершить можно только активный спринт');

  const targetSprintId = moveUnfinishedTo === 'backlog' ? null : moveUnfinishedTo;
  const moveError = validateSprintMove(sprintId, targetSprintId);
  if (moveError) throw badRequest(SPRINT_MOVE_MESSAGES[moveError]);
  if (targetSprintId) {
    const target = await prisma.sprint.findFirst({
      where: { id: targetSprintId, projectId: sprint.projectId, status: { not: 'COMPLETED' } },
      select: { id: true },
    });
    if (!target) throw badRequest('Целевой спринт недоступен');
  }

  const unfinished = await prisma.issue.findMany({
    where: { sprintId, status: { category: { notIn: ['COMPLETED', 'CANCELED'] } } },
    select: { id: true, assigneeId: true },
  });

  const updated = await prisma.$transaction(async (tx) => {
    if (unfinished.length) {
      await tx.issue.updateMany({
        where: { id: { in: unfinished.map((i) => i.id) } },
        data: { sprintId: targetSprintId },
      });
    }
    return tx.sprint.update({
      where: { id: sprintId },
      data: { status: 'COMPLETED', completedAt: new Date() },
      include: sprintInclude,
    });
  });

  audit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: AuditAction.SPRINT_COMPLETED,
    entityType: 'Sprint',
    entityId: sprintId,
    metadata: { movedCount: unfinished.length, movedTo: moveUnfinishedTo },
  });

  await notify({
    userIds: unfinished.map((i) => i.assigneeId).filter((id): id is string => Boolean(id)),
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    type: NotificationType.SPRINT_COMPLETED,
    title: `Sprint "${updated.name}" completed`,
    body: unfinished.length ? `${unfinished.length} unfinished issue(s) were moved` : null,
  });

  emitSprint(actor, sprintId, sprint.projectId);
  return { sprint: toSprint(updated), movedCount: unfinished.length };
}

export async function deleteSprint(actor: ActorContext, sprintId: string): Promise<void> {
  assertCan(actor, Permission.SPRINT_MANAGE);
  const sprint = await requireSprint(actor, sprintId);
  if (sprint.status === 'ACTIVE') throw badRequest('Сначала завершите спринт, потом удаляйте');

  // Issues survive their sprint — they simply return to the backlog.
  await prisma.$transaction(async (tx) => {
    await tx.issue.updateMany({ where: { sprintId }, data: { sprintId: null } });
    await tx.sprint.delete({ where: { id: sprintId } });
  });

  emitSprint(actor, sprintId, sprint.projectId);
}

async function requireSprint(actor: ActorContext, sprintId: string) {
  const sprint = await prisma.sprint.findFirst({
    where: { id: sprintId, project: { workspaceId: actor.workspaceId } },
    select: { id: true, projectId: true, status: true, startDate: true, endDate: true },
  });
  if (!sprint) throw notFound('Спринт');
  return sprint;
}

function emitSprint(actor: ActorContext, sprintId: string, projectId: string): void {
  emit(RealtimeEventType.SPRINT_UPDATED, {
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    payload: { sprintId, projectId },
  });
}
