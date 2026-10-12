/**
 * Roles of a workspace's own making.
 *
 * Next to the built-in roles the owner can make more: a name and a set of
 * permissions picked in the table from packages/contracts (roles.ts). Such a
 * role is given the same way a built-in one is — to a member of the workspace
 * or of a project — and what its holder may do is read from it on every
 * request, so a change to the role is a change for everyone who holds it.
 *
 * Only the owner makes and changes roles: a role is a way of handing out
 * rights, and that stays with the one person the installation answers to.
 */
import type { ActorContext, CreateRoleInput, RoleDto, UpdateRoleInput } from '@flowdesk/contracts';
import {
  AuditAction,
  Permission,
  ProjectRole,
  RealtimeEventType,
  RoleScope,
  WorkspaceRole,
  builtInGrants,
  can,
  normalizeRolePermissions,
} from '@flowdesk/contracts';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { grantsOf } from '../../lib/context';
import { emit } from '../../realtime/eventBus';

function assertOwner(actor: ActorContext): void {
  if (actor.workspaceRole !== WorkspaceRole.OWNER) {
    throw forbidden('Роли создаёт и меняет только владелец пространства');
  }
}

const roleSelect = {
  id: true,
  scope: true,
  name: true,
  permissions: true,
  allProjects: true,
  _count: { select: { workspaceMembers: true, projectMembers: true } },
} satisfies Prisma.RoleSelect;

type RoleRow = Prisma.RoleGetPayload<{ select: typeof roleSelect }>;

function toRole(row: RoleRow): RoleDto {
  return {
    id: row.id,
    scope: row.scope,
    name: row.name,
    // Read through the table again: a permission the table no longer offers is not handed out.
    permissions: normalizeRolePermissions(row.scope, row.permissions),
    allProjects: row.allProjects,
    memberCount: row._count.workspaceMembers + row._count.projectMembers,
  };
}

/** Open sessions hold what their person may do; tell them it may have changed. */
function announce(actor: ActorContext): void {
  emit(RealtimeEventType.MEMBER_UPDATED, {
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    payload: { memberId: '', userId: '' },
  });
}

export async function listRoles(actor: ActorContext): Promise<RoleDto[]> {
  const rows = await prisma.role.findMany({
    where: { workspaceId: actor.workspaceId },
    orderBy: [{ scope: 'asc' }, { createdAt: 'asc' }],
    select: roleSelect,
  });
  return rows.map(toRole);
}

const nameTaken = () => conflict('Роль с таким названием уже есть', { name: 'Такое название уже занято' });

/**
 * Asked before writing, so the usual case is answered in words rather than by
 * a failed insert in the log; the unique index still catches two people
 * saving the same name at the same moment.
 */
async function assertNameFree(workspaceId: string, scope: RoleScope, name: string, exceptId?: string): Promise<void> {
  const twin = await prisma.role.findFirst({
    where: { workspaceId, scope, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (twin) throw nameTaken();
}

export async function createRole(actor: ActorContext, input: CreateRoleInput, ip?: string): Promise<RoleDto> {
  assertOwner(actor);
  const scope = input.scope as RoleScope;
  await assertNameFree(actor.workspaceId, scope, input.name);
  try {
    const row = await prisma.role.create({
      data: {
        workspaceId: actor.workspaceId,
        scope,
        name: input.name,
        permissions: normalizeRolePermissions(scope, input.permissions),
        // How far a person sees is a question for the workspace; in a project it has no meaning.
        allProjects: scope === RoleScope.WORKSPACE ? (input.allProjects ?? true) : true,
      },
      select: roleSelect,
    });
    audit({
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      action: AuditAction.ROLE_CREATED,
      entityType: 'Role',
      entityId: row.id,
      metadata: { name: row.name },
      ip,
    });
    return toRole(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw nameTaken();
    throw error;
  }
}

export async function updateRole(
  actor: ActorContext,
  roleId: string,
  patch: UpdateRoleInput,
  ip?: string,
): Promise<RoleDto> {
  assertOwner(actor);
  const role = await prisma.role.findFirst({
    where: { id: roleId, workspaceId: actor.workspaceId },
    select: { id: true, scope: true, name: true, allProjects: true },
  });
  if (!role) throw notFound('Роль');

  const allProjects =
    role.scope === RoleScope.WORKSPACE && patch.allProjects !== undefined ? patch.allProjects : role.allProjects;
  if (patch.name !== undefined) await assertNameFree(actor.workspaceId, role.scope, patch.name, role.id);

  try {
    const row = await prisma.$transaction(async (tx) => {
      // How far its holders see is kept on their memberships, where everything
      // that asks «is this a guest?» reads it; it follows the role.
      if (allProjects !== role.allProjects) {
        await tx.workspaceMember.updateMany({
          where: { customRoleId: role.id },
          data: { role: allProjects ? WorkspaceRole.MEMBER : WorkspaceRole.GUEST },
        });
        await tx.invitation.updateMany({
          where: { customRoleId: role.id, acceptedAt: null },
          data: { role: allProjects ? WorkspaceRole.MEMBER : WorkspaceRole.GUEST },
        });
      }
      return tx.role.update({
        where: { id: role.id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.permissions !== undefined
            ? { permissions: normalizeRolePermissions(role.scope, patch.permissions) }
            : {}),
          allProjects,
        },
        select: roleSelect,
      });
    });
    audit({
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      action: AuditAction.ROLE_UPDATED,
      entityType: 'Role',
      entityId: row.id,
      metadata: { name: row.name },
      ip,
    });
    announce(actor);
    return toRole(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw nameTaken();
    throw error;
  }
}

export async function deleteRole(actor: ActorContext, roleId: string, ip?: string): Promise<void> {
  assertOwner(actor);
  const role = await prisma.role.findFirst({
    where: { id: roleId, workspaceId: actor.workspaceId },
    select: { id: true, name: true, _count: { select: { workspaceMembers: true, projectMembers: true } } },
  });
  if (!role) throw notFound('Роль');

  // Taking a role away from under people would leave them with whatever lies
  // beneath it — possibly more than the role allowed. They are given another first.
  const inUse = (holders: number) =>
    conflict(`Роль «${role.name}» сейчас выдана людям: ${holders}. Сначала дайте им другую роль.`);
  const holders = role._count.workspaceMembers + role._count.projectMembers;
  if (holders > 0) throw inUse(holders);

  // Deleted only if still held by nobody — in the one statement, so a role
  // given to someone a moment ago is not taken from them. Links made for the
  // role go with it.
  const { count } = await prisma.role.deleteMany({
    where: { id: role.id, workspaceMembers: { none: {} }, projectMembers: { none: {} } },
  });
  if (count === 0) {
    // Given to someone between the look and the delete — or already gone.
    const now = await prisma.role.findUnique({
      where: { id: role.id },
      select: { _count: { select: { workspaceMembers: true, projectMembers: true } } },
    });
    if (!now) throw notFound('Роль');
    throw inUse(now._count.workspaceMembers + now._count.projectMembers);
  }
  audit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: AuditAction.ROLE_DELETED,
    entityType: 'Role',
    entityId: role.id,
    metadata: { name: role.name },
    ip,
  });
}

/* ------------------------------------------------------------- giving a role */

export interface RoleRef {
  /** A built-in role by its name… */
  role?: string;
  /** …or one of the workspace's own by its id. */
  roleId?: string;
}

interface ResolvedRole<R> {
  /** What goes into the membership's enum. */
  role: R;
  customRoleId: string | null;
  /** What the role lets its holder do. */
  permissions: Permission[];
}

async function ownRole(workspaceId: string, roleId: string, scope: RoleScope) {
  const role = await prisma.role.findFirst({
    where: { id: roleId, workspaceId, scope },
    select: { id: true, scope: true, permissions: true, allProjects: true },
  });
  if (!role) throw badRequest('Такой роли в пространстве нет', { roleId: 'Роль не найдена' });
  return role;
}

/** The role meant for a member of the workspace, built-in or the workspace's own. */
export async function resolveWorkspaceRole(workspaceId: string, ref: RoleRef): Promise<ResolvedRole<WorkspaceRole>> {
  if (ref.roleId) {
    const role = await ownRole(workspaceId, ref.roleId, RoleScope.WORKSPACE);
    return {
      role: role.allProjects ? WorkspaceRole.MEMBER : WorkspaceRole.GUEST,
      customRoleId: role.id,
      permissions: grantsOf(role)!,
    };
  }
  const role = ref.role as WorkspaceRole;
  return { role, customRoleId: null, permissions: builtInGrants('workspace', role) };
}

/** The role meant for a member of a project. */
export async function resolveProjectRole(workspaceId: string, ref: RoleRef): Promise<ResolvedRole<ProjectRole>> {
  if (ref.roleId) {
    const role = await ownRole(workspaceId, ref.roleId, RoleScope.PROJECT);
    // The enum beneath is the least there is: nothing reads more out of it than the role gives.
    return { role: ProjectRole.VIEWER, customRoleId: role.id, permissions: grantsOf(role)! };
  }
  const role = ref.role as ProjectRole;
  return { role, customRoleId: null, permissions: builtInGrants('project', role) };
}

/**
 * Nobody hands out what they do not have: a role may be given only by someone
 * who can do everything it allows. The owner can do everything, so this never
 * stops them.
 */
export function assertMayGive(actor: ActorContext, permissions: Permission[]): void {
  if (!permissions.every((permission) => can(actor, permission))) {
    throw forbidden('Нельзя выдать роль с правами, которых нет у вас');
  }
}
