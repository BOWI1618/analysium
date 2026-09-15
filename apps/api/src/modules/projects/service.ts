import type {
  ActorContext,
  CreateProjectInput,
  ProjectDetailDto,
  ProjectDto,
  ProjectRole,
} from '@flowdesk/contracts';
import { AuditAction, Permission, RealtimeEventType, permissionsFor } from '@flowdesk/contracts';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { assertCan, projectContext, visibleProjectIds } from '../../lib/context';
import { conflict, forbidden, notFound, badRequest } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { emit } from '../../realtime/eventBus';
import { DEFAULT_STATUSES, isDoneCategory, nextCompletedAt } from '../../domain/issueRules';
import { uniqueProjectKey } from './key';
import { labelSelect, statusSelect, toLabel, toSprint, toStatus, toUserSummary, sprintInclude } from '../../lib/serialize';

const projectSelect = {
  id: true,
  workspaceId: true,
  name: true,
  key: true,
  description: true,
  icon: true,
  color: true,
  projectType: true,
  isArchived: true,
  isSystem: true,
  createdAt: true,
  updatedAt: true,
  lead: { select: { id: true, name: true, email: true, avatarUrl: true } },
};

export async function listProjects(
  actor: ActorContext,
  opts: { includeArchived?: boolean } = {},
): Promise<ProjectDto[]> {
  const allowed = await visibleProjectIds(actor);

  const projects = await prisma.project.findMany({
    where: {
      workspaceId: actor.workspaceId,
      ...(opts.includeArchived ? {} : { isArchived: false }),
      ...(allowed === 'ALL' ? {} : { id: { in: allowed } }),
    },
    orderBy: [{ isSystem: 'desc' }, { isArchived: 'asc' }, { name: 'asc' }],
    select: {
      ...projectSelect,
      members: { where: { userId: actor.userId }, select: { role: true } },
      // Same population as openIssueCount below: the UI subtracts one from the
      // other to show progress, so a total that counted archived issues would
      // silently inflate "готово".
      _count: { select: { issues: { where: { archivedAt: null } } } },
    },
  });

  const [favorites, openCounts] = await Promise.all([
    prisma.favorite.findMany({
      where: { userId: actor.userId, entityType: 'project' },
      select: { entityId: true },
    }),
    prisma.issue.groupBy({
      by: ['projectId'],
      where: {
        projectId: { in: projects.map((p) => p.id) },
        archivedAt: null,
        status: { category: { notIn: ['COMPLETED', 'CANCELED'] } },
      },
      _count: { _all: true },
    }),
  ]);

  const favoriteIds = new Set(favorites.map((f) => f.entityId));
  const openByProject = new Map(openCounts.map((c) => [c.projectId, c._count._all]));

  return projects.map((p) => ({
    id: p.id,
    workspaceId: p.workspaceId,
    name: p.name,
    key: p.key,
    description: p.description,
    icon: p.icon,
    color: p.color,
    projectType: p.projectType,
    isArchived: p.isArchived,
    isSystem: p.isSystem,
    lead: toUserSummary(p.lead),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    isFavorite: favoriteIds.has(p.id),
    openIssueCount: openByProject.get(p.id) ?? 0,
    totalIssueCount: p._count.issues,
    myRole: p.members[0]?.role ?? null,
  }));
}

export async function createProject(
  actor: ActorContext,
  input: CreateProjectInput,
  ip?: string,
): Promise<ProjectDetailDto> {
  assertCan(actor, Permission.PROJECT_CREATE);

  let key = input.key;
  if (key) {
    const existing = await prisma.project.findUnique({
      where: { workspaceId_key: { workspaceId: actor.workspaceId, key } },
      select: { id: true },
    });
    if (existing) throw conflict('Такой ключ проекта уже занят', { key: 'Такой ключ уже занят' });
  } else {
    // Archived projects and the list of tasks without a project keep their
    // keys too, so every key in the workspace counts as taken.
    const taken = await prisma.project.findMany({ where: { workspaceId: actor.workspaceId }, select: { key: true } });
    key = uniqueProjectKey(input.name, new Set(taken.map((p) => p.key)));
  }
  if (input.leadId) await assertLeadIsMember(actor.workspaceId, input.leadId);

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        workspaceId: actor.workspaceId,
        name: input.name,
        key,
        description: input.description ?? null,
        icon: input.icon ?? '📦',
        color: input.color ?? '#6366f1',
        projectType: input.projectType as never,
        leadId: input.leadId ?? actor.userId,
      },
    });

    // Every project starts with a usable workflow — an empty board is useless.
    await tx.workflowStatus.createMany({
      data: DEFAULT_STATUSES.map((s, index) => ({
        projectId: created.id,
        name: s.name,
        category: s.category as never,
        color: s.color,
        position: index,
        wipLimit: s.wipLimit ?? null,
        isDefault: index === 1,
      })),
    });

    // No starter labels: every team names its own, from the label list.
    await tx.projectMember.create({
      data: { projectId: created.id, userId: input.leadId ?? actor.userId, role: 'LEAD' },
    });

    return created;
  });

  audit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: AuditAction.PROJECT_CREATED,
    entityType: 'Project',
    entityId: project.id,
    metadata: { key: project.key, name: project.name },
    ip,
  });

  return getProject({ ...actor, projectRole: 'LEAD' }, project.id);
}

/**
 * People who can see a project: non-guest workspace members, plus guests who
 * were added to it. The same rule `canAccessProject` applies to reading, so
 * nobody is offered as an assignee who could not open the issue.
 */
export async function projectAssignees(workspaceId: string, projectId: string) {
  const rows = await prisma.workspaceMember.findMany({
    where: {
      workspaceId,
      user: { status: { not: 'DEACTIVATED' } },
      OR: [{ role: { not: 'GUEST' } }, { user: { projectRoles: { some: { projectId } } } }],
    },
    select: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    orderBy: { user: { name: 'asc' } },
  });
  return rows.map((r) => toUserSummary(r.user)!);
}

export async function getProject(actor: ActorContext, projectId: string): Promise<ProjectDetailDto> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId: actor.workspaceId },
    select: {
      ...projectSelect,
      statuses: { orderBy: { position: 'asc' }, select: statusSelect },
      labels: { orderBy: { name: 'asc' }, select: labelSelect },
      members: {
        select: { userId: true, role: true, user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      },
      sprints: {
        where: { status: 'ACTIVE' },
        take: 1,
        include: sprintInclude,
      },
      // Same population as openIssueCount below: the UI subtracts one from the
      // other to show progress, so a total that counted archived issues would
      // silently inflate "готово".
      _count: { select: { issues: { where: { archivedAt: null } } } },
    },
  });
  if (!project) throw notFound('Проект');

  const [favorite, openCount, statusCounts] = await Promise.all([
    prisma.favorite.findUnique({
      where: {
        userId_entityType_entityId: { userId: actor.userId, entityType: 'project', entityId: projectId },
      },
      select: { id: true },
    }),
    prisma.issue.count({
      where: { projectId, archivedAt: null, status: { category: { notIn: ['COMPLETED', 'CANCELED'] } } },
    }),
    prisma.issue.groupBy({
      by: ['statusId'],
      where: { projectId, archivedAt: null, parentId: null },
      _count: { _all: true },
    }),
  ]);

  const countByStatus = new Map(statusCounts.map((c) => [c.statusId, c._count._all]));
  const activeSprint = project.sprints[0];

  return {
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    key: project.key,
    description: project.description,
    icon: project.icon,
    color: project.color,
    projectType: project.projectType,
    isArchived: project.isArchived,
    isSystem: project.isSystem,
    lead: toUserSummary(project.lead),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    isFavorite: Boolean(favorite),
    openIssueCount: openCount,
    totalIssueCount: project._count.issues,
    myRole: actor.projectRole ?? null,
    statuses: project.statuses.map((s) => ({ ...toStatus(s), issueCount: countByStatus.get(s.id) ?? 0 })),
    labels: project.labels.map(toLabel),
    members: project.members.map((m) => ({
      userId: m.userId,
      role: m.role,
      user: toUserSummary(m.user)!,
    })),
    assignees: await projectAssignees(project.workspaceId, project.id),
    activeSprint: activeSprint ? toSprint(activeSprint) : null,
    permissions: permissionsFor(actor),
  };
}

async function assertNotSystem(projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { isSystem: true } });
  if (project?.isSystem) {
    throw badRequest('Это общий список задач без проекта — его нельзя переименовать, архивировать или удалить');
  }
}

/** Name and key of the list of tasks without a project. */
export const SYSTEM_PROJECT_NAME = 'Без проекта';
const SYSTEM_PROJECT_KEYS = ['TASK', 'TSK', 'TODO', 'ZAD'];

/**
 * The workspace's list of tasks without a project, created on first use.
 *
 * Deliberately not a permission-gated action: creating a task without a
 * project must not require the right to create projects. Two people creating
 * the first such task at the same moment race on the unique key; the loser
 * simply reads what the winner created.
 */
export async function ensureSystemProject(workspaceId: string): Promise<{ id: string; key: string }> {
  const existing = await prisma.project.findFirst({
    where: { workspaceId, isSystem: true },
    select: { id: true, key: true },
  });
  if (existing) return existing;

  const taken = new Set(
    (await prisma.project.findMany({ where: { workspaceId }, select: { key: true } })).map((p) => p.key),
  );
  const key = SYSTEM_PROJECT_KEYS.find((k) => !taken.has(k)) ?? `T${Date.now().toString(36).slice(-4).toUpperCase()}`;

  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          workspaceId,
          name: SYSTEM_PROJECT_NAME,
          key,
          description: 'Задачи, не привязанные к проекту.',
          icon: 'package',
          color: '#7c88a1',
          projectType: 'SIMPLE',
          isSystem: true,
        },
        select: { id: true, key: true },
      });
      await tx.workflowStatus.createMany({
        data: DEFAULT_STATUSES.map((s, index) => ({
          projectId: created.id,
          name: s.name,
          category: s.category as never,
          color: s.color,
          position: index,
          wipLimit: null,
          isDefault: index === 1,
        })),
      });
      return created;
    });
  } catch (error) {
    const winner = await prisma.project.findFirst({
      where: { workspaceId, isSystem: true },
      select: { id: true, key: true },
    });
    if (winner) return winner;
    throw error;
  }
}

export async function updateProject(
  actor: ActorContext,
  projectId: string,
  patch: Record<string, unknown>,
  ip?: string,
): Promise<ProjectDetailDto> {
  assertCan(actor, Permission.PROJECT_UPDATE);
  await assertNotSystem(projectId);
  if (typeof patch.leadId === 'string') await assertLeadIsMember(actor.workspaceId, patch.leadId);
  await prisma.project.update({ where: { id: projectId }, data: patch as never });
  audit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: patch.isArchived ? AuditAction.PROJECT_ARCHIVED : AuditAction.PROJECT_UPDATED,
    entityType: 'Project',
    entityId: projectId,
    metadata: patch,
    ip,
  });
  emit(RealtimeEventType.PROJECT_UPDATED, {
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    payload: { projectId },
  });
  return getProject(actor, projectId);
}

export async function deleteProject(actor: ActorContext, projectId: string, ip?: string): Promise<void> {
  assertCan(actor, Permission.PROJECT_DELETE);
  await assertNotSystem(projectId);
  await prisma.project.delete({ where: { id: projectId } });
  audit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: AuditAction.PROJECT_DELETED,
    entityType: 'Project',
    entityId: projectId,
    ip,
  });
}

/* -------------------------------------------------------------- workflow */

export async function createStatus(
  actor: ActorContext,
  projectId: string,
  input: { name: string; category: string; color?: string; wipLimit?: number | null },
) {
  assertCan(actor, Permission.PROJECT_MANAGE_WORKFLOW);
  const last = await prisma.workflowStatus.findFirst({
    where: { projectId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  const status = await prisma.workflowStatus.create({
    data: {
      projectId,
      name: input.name,
      category: input.category as never,
      color: input.color ?? '#94a3b8',
      wipLimit: input.wipLimit ?? null,
      position: (last?.position ?? -1) + 1,
    },
    select: statusSelect,
  });
  auditWorkflow(actor, projectId, { created: status.name });
  return toStatus(status);
}

export async function updateStatus(
  actor: ActorContext,
  projectId: string,
  statusId: string,
  patch: Record<string, unknown>,
) {
  assertCan(actor, Permission.PROJECT_MANAGE_WORKFLOW);
  const existing = await prisma.workflowStatus.findFirst({
    where: { id: statusId, projectId },
    select: { id: true, category: true },
  });
  if (!existing) throw notFound('Статус');
  const status = await prisma.workflowStatus.update({
    where: { id: statusId },
    data: patch as never,
    select: statusSelect,
  });
  // The category drives completedAt — resync the column's issues like issue
  // moves do, so done timestamps never survive a category change.
  if (patch.category !== undefined && patch.category !== existing.category) {
    const category = patch.category as never;
    if (isDoneCategory(category)) {
      await prisma.issue.updateMany({
        where: { statusId, completedAt: null },
        data: { completedAt: nextCompletedAt(category, null) },
      });
    } else {
      await prisma.issue.updateMany({ where: { statusId }, data: { completedAt: null } });
    }
  }
  auditWorkflow(actor, projectId, { updated: status.name, patch });
  return toStatus(status);
}

/**
 * Deleting a status must not orphan issues, so the caller supplies a
 * replacement column; if none is given we fall back to the project default.
 */
export async function deleteStatus(
  actor: ActorContext,
  projectId: string,
  statusId: string,
  moveToStatusId?: string,
) {
  assertCan(actor, Permission.PROJECT_MANAGE_WORKFLOW);

  const statuses = await prisma.workflowStatus.findMany({
    where: { projectId },
    orderBy: { position: 'asc' },
    select: { id: true, name: true, category: true, isDefault: true },
  });
  if (statuses.length <= 1) throw badRequest('В проекте должен остаться хотя бы один статус');

  const target = statuses.find((s) => s.id === statusId);
  if (!target) throw notFound('Статус');

  const fallback =
    statuses.find((s) => s.id === moveToStatusId && s.id !== statusId) ??
    statuses.find((s) => s.isDefault && s.id !== statusId) ??
    statuses.find((s) => s.id !== statusId)!;

  await prisma.$transaction(async (tx) => {
    await tx.issue.updateMany({ where: { statusId }, data: { statusId: fallback.id } });
    // The replacement column's category re-derives completedAt for the moved
    // issues — exactly what an issue move through the same column would do.
    if (isDoneCategory(fallback.category as never)) {
      await tx.issue.updateMany({
        where: { statusId: fallback.id, completedAt: null },
        data: { completedAt: nextCompletedAt(fallback.category as never, null) },
      });
    } else {
      await tx.issue.updateMany({ where: { statusId: fallback.id }, data: { completedAt: null } });
    }
    await tx.workflowStatus.delete({ where: { id: statusId } });
  });

  auditWorkflow(actor, projectId, { deleted: target.name, movedTo: fallback.name });
}

export async function reorderStatuses(actor: ActorContext, projectId: string, statusIds: string[]) {
  assertCan(actor, Permission.PROJECT_MANAGE_WORKFLOW);
  const owned = await prisma.workflowStatus.findMany({ where: { projectId }, select: { id: true } });
  const ownedIds = new Set(owned.map((s) => s.id));
  if (statusIds.some((id) => !ownedIds.has(id))) throw badRequest('В запросе на переупорядочивание неизвестный статус');

  await prisma.$transaction(
    statusIds.map((id, index) => prisma.workflowStatus.update({ where: { id }, data: { position: index } })),
  );
  auditWorkflow(actor, projectId, { reordered: statusIds.length });
}

function auditWorkflow(actor: ActorContext, projectId: string, metadata: Record<string, unknown>): void {
  audit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: AuditAction.WORKFLOW_UPDATED,
    entityType: 'Project',
    entityId: projectId,
    metadata,
  });
}

/* ---------------------------------------------------------------- labels */

export async function listLabels(projectId: string) {
  const labels = await prisma.label.findMany({
    where: { projectId },
    orderBy: { name: 'asc' },
    select: { ...labelSelect, _count: { select: { issues: true } } },
  });
  return labels.map((l) => ({ ...toLabel(l), issueCount: l._count.issues }));
}

export async function createLabel(
  actor: ActorContext,
  projectId: string,
  input: { name: string; color: string },
) {
  // Adding a label is part of tagging a task, so whoever may edit tasks may add
  // one from the label list. Renaming and deleting stay with project managers:
  // those change every task that already carries the label.
  assertCan(actor, Permission.ISSUE_UPDATE);
  const label = await prisma.label.create({
    data: { projectId, name: input.name, color: input.color },
    select: labelSelect,
  });
  return toLabel(label);
}

export async function updateLabel(
  actor: ActorContext,
  projectId: string,
  labelId: string,
  patch: { name?: string; color?: string },
) {
  assertCan(actor, Permission.PROJECT_UPDATE);
  const existing = await prisma.label.findFirst({ where: { id: labelId, projectId }, select: { id: true } });
  if (!existing) throw notFound('Метка');
  const label = await prisma.label.update({ where: { id: labelId }, data: patch, select: labelSelect });
  return toLabel(label);
}

export async function deleteLabel(actor: ActorContext, projectId: string, labelId: string) {
  assertCan(actor, Permission.PROJECT_UPDATE);
  const existing = await prisma.label.findFirst({ where: { id: labelId, projectId }, select: { id: true } });
  if (!existing) throw notFound('Метка');
  await prisma.label.delete({ where: { id: labelId } });
}

/* -------------------------------------------------------- project members */

/** The lead must be a workspace member — the same rule as addProjectMember. */
async function assertLeadIsMember(workspaceId: string, leadId: string): Promise<void> {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: leadId } },
    select: { id: true },
  });
  if (!member) throw badRequest('Этот пользователь не состоит в пространстве');
}

export async function addProjectMember(
  actor: ActorContext,
  projectId: string,
  input: { userId: string; role: ProjectRole },
) {
  assertCan(actor, Permission.PROJECT_MANAGE_MEMBERS);
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId: input.userId } },
    select: { id: true },
  });
  if (!member) throw badRequest('Этот пользователь не состоит в пространстве');

  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId, userId: input.userId } },
    create: { projectId, userId: input.userId, role: input.role as never },
    update: { role: input.role as never },
  });
}

export async function removeProjectMember(actor: ActorContext, projectId: string, userId: string) {
  assertCan(actor, Permission.PROJECT_MANAGE_MEMBERS);
  await prisma.projectMember.deleteMany({ where: { projectId, userId } });
}

/* ------------------------------------------------------------- favorites */

export async function toggleFavorite(userId: string, projectId: string): Promise<boolean> {
  const key = { userId, entityType: 'project', entityId: projectId };
  // deleteMany-then-create makes the toggle idempotent under concurrency: two
  // racing toggles collapse into one (either both delete, or one create wins
  // and the loser's P2002 is resolved by deleting) — no 409, final state off.
  const removed = await prisma.favorite.deleteMany({ where: key });
  if (removed.count > 0) return false;
  try {
    await prisma.favorite.create({ data: key });
    return true;
  } catch (error) {
    // A concurrent toggle inserted the row first — delete it instead.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      await prisma.favorite.deleteMany({ where: key });
      return false;
    }
    throw error;
  }
}

export { projectContext, forbidden };
