import type { ActorContext, MemberDto, WorkspaceDto } from '@flowdesk/contracts';
import { AuditAction, Permission, WorkspaceRole, can, outranks } from '@flowdesk/contracts';
import { prisma } from '../../lib/prisma';
import { assertCan, workspaceContext } from '../../lib/context';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { slugify, uniqueSlug } from './slug';
import { sendInviteEmail } from '../auth/verification';

export async function listWorkspaces(userId: string): Promise<WorkspaceDto[]> {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    orderBy: { joinedAt: 'asc' },
    select: {
      role: true,
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true,
          logo: true,
          carryOverTasks: true,
          ownerId: true,
          createdAt: true,
          _count: { select: { members: true, projects: { where: { isSystem: false } } } },
        },
      },
    },
  });

  return memberships.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    slug: m.workspace.slug,
    logo: m.workspace.logo,
    carryOverTasks: m.workspace.carryOverTasks,
    ownerId: m.workspace.ownerId,
    role: m.role,
    memberCount: m.workspace._count.members,
    projectCount: m.workspace._count.projects,
    createdAt: m.workspace.createdAt.toISOString(),
  }));
}

export async function createWorkspace(
  userId: string,
  input: { name: string; slug?: string },
  ip?: string,
): Promise<WorkspaceDto> {
  const slug = input.slug ? slugify(input.slug) : await uniqueSlug(slugify(input.name));

  if (input.slug) {
    const taken = await prisma.workspace.findUnique({ where: { slug }, select: { id: true } });
    if (taken) throw conflict('Такой адрес пространства занят', { slug: 'Already in use' });
  }

  const workspace = await prisma.$transaction(async (tx) => {
    const ws = await tx.workspace.create({ data: { name: input.name, slug, ownerId: userId } });
    await tx.workspaceMember.create({
      data: { workspaceId: ws.id, userId, role: WorkspaceRole.OWNER },
    });
    return ws;
  });

  audit({
    workspaceId: workspace.id,
    actorId: userId,
    action: AuditAction.WORKSPACE_CREATED,
    entityType: 'Workspace',
    entityId: workspace.id,
    metadata: { name: workspace.name },
    ip,
  });

  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    logo: workspace.logo,
    carryOverTasks: workspace.carryOverTasks,
    ownerId: workspace.ownerId,
    role: WorkspaceRole.OWNER,
    memberCount: 1,
    projectCount: 0,
    createdAt: workspace.createdAt.toISOString(),
  };
}

export async function getWorkspace(actor: ActorContext): Promise<WorkspaceDto> {
  const ws = await prisma.workspace.findUnique({
    where: { id: actor.workspaceId },
    select: {
      id: true,
      name: true,
      slug: true,
      logo: true,
      carryOverTasks: true,
      ownerId: true,
      createdAt: true,
      _count: { select: { members: true, projects: { where: { isSystem: false } } } },
    },
  });
  if (!ws) throw notFound('Пространство');
  return {
    id: ws.id,
    name: ws.name,
    slug: ws.slug,
    logo: ws.logo,
    carryOverTasks: ws.carryOverTasks,
    ownerId: ws.ownerId,
    role: actor.workspaceRole,
    memberCount: ws._count.members,
    projectCount: ws._count.projects,
    createdAt: ws.createdAt.toISOString(),
  };
}

export async function updateWorkspace(
  actor: ActorContext,
  patch: { name?: string; logo?: string | null; carryOverTasks?: boolean },
  ip?: string,
): Promise<WorkspaceDto> {
  assertCan(actor, Permission.WORKSPACE_UPDATE);
  await prisma.workspace.update({ where: { id: actor.workspaceId }, data: patch });
  audit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: AuditAction.WORKSPACE_UPDATED,
    entityType: 'Workspace',
    entityId: actor.workspaceId,
    metadata: patch,
    ip,
  });
  return getWorkspace(actor);
}

export async function deleteWorkspace(actor: ActorContext, ip?: string): Promise<void> {
  assertCan(actor, Permission.WORKSPACE_DELETE);
  await prisma.workspace.delete({ where: { id: actor.workspaceId } });
  audit({
    actorId: actor.userId,
    action: AuditAction.WORKSPACE_DELETED,
    entityType: 'Workspace',
    entityId: actor.workspaceId,
    ip,
  });
}

/* ---------------------------------------------------------------- members */

export async function listMembers(actor: ActorContext): Promise<MemberDto[]> {
  const canManage = can(actor, Permission.WORKSPACE_MANAGE_MEMBERS);
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: actor.workspaceId },
    orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    select: {
      id: true,
      role: true,
      joinedAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
          status: true,
          lastActiveAt: true,
          passwordResetExpiresAt: true,
        },
      },
    },
  });
  const now = Date.now();

  return members.map((m) => ({
    id: m.id,
    role: m.role,
    joinedAt: m.joinedAt.toISOString(),
    user: {
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      avatarUrl: m.user.avatarUrl,
      status: m.user.status,
      lastActiveAt: m.user.lastActiveAt?.toISOString() ?? null,
    },
    passwordResetExpiresAt:
      canManage && m.user.passwordResetExpiresAt && m.user.passwordResetExpiresAt.getTime() > now
        ? m.user.passwordResetExpiresAt.toISOString()
        : null,
  }));
}

/**
 * Adds a member by email. In a deployment with mail configured this would send
 * an invitation; without it, an existing user is added immediately and an
 * unknown address creates an INVITED placeholder account that activates on
 * first sign-up with that address.
 */
export async function inviteMember(
  actor: ActorContext,
  input: { email: string; role: string },
  ip?: string,
): Promise<MemberDto> {
  assertCan(actor, Permission.WORKSPACE_MANAGE_MEMBERS);

  const role = input.role as WorkspaceRole;
  if (role === WorkspaceRole.OWNER) throw badRequest('У пространства может быть только один владелец');
  if (!outranks(actor.workspaceRole, role) && actor.workspaceRole !== WorkspaceRole.OWNER) {
    throw forbidden('Нельзя выдать роль, равную вашей или выше');
  }

  let user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, passwordHash: true },
  });
  if (!user) {
    user = await prisma.user.create({
      data: { email: input.email, name: input.email.split('@')[0] ?? input.email, status: 'INVITED' },
      select: { id: true, passwordHash: true },
    });
  }

  const existing = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId: user.id } },
    select: { id: true },
  });
  // Someone who is already a member but has never set a password is an
  // invitation that did not arrive — a lost letter, a typo in the SMTP
  // settings, a spam filter. Repeating the invite has to send a new link
  // instead of refusing, otherwise the only way out is removing the person and
  // adding them again, which nobody guesses.
  if (existing && user.passwordHash) {
    throw conflict('Этот человек уже участник', { email: 'Уже в пространстве' });
  }

  const memberSelect = {
    id: true,
    role: true,
    joinedAt: true,
    user: {
      select: { id: true, name: true, email: true, avatarUrl: true, status: true, lastActiveAt: true },
    },
  } as const;

  const member = existing
    ? await prisma.workspaceMember.update({
        where: { id: existing.id },
        data: { role },
        select: memberSelect,
      })
    : await prisma.workspaceMember.create({
        data: { workspaceId: actor.workspaceId, userId: user.id, role },
        select: memberSelect,
      });

  // The membership alone does not let anybody in: an account created here has
  // no password. The link in this message is the only way to get one, so an
  // invitation that is not delivered is not an invitation.
  // Someone who already has an account is simply in — there is no password to
  // set, so a "set your password" link would only confuse them.
  let invite: { url: string; emailSent: boolean } | undefined;
  if (!user.passwordHash) {
    const [workspace, inviter] = await Promise.all([
      prisma.workspace.findUniqueOrThrow({ where: { id: actor.workspaceId }, select: { name: true } }),
      prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { name: true } }),
    ]);
    invite = await sendInviteEmail({
      user: { id: user.id, email: input.email },
      workspaceName: workspace.name,
      invitedByName: inviter.name,
    });
  }

  audit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: AuditAction.MEMBER_INVITED,
    entityType: 'WorkspaceMember',
    entityId: member.id,
    metadata: { email: input.email, role },
    ip,
  });

  return {
    id: member.id,
    role: member.role,
    joinedAt: member.joinedAt.toISOString(),
    passwordResetExpiresAt: null,
    user: {
      id: member.user.id,
      name: member.user.name,
      email: member.user.email,
      avatarUrl: member.user.avatarUrl,
      status: member.user.status,
      lastActiveAt: member.user.lastActiveAt?.toISOString() ?? null,
    },
    ...(invite ? { invite } : {}),
  };
}

export async function updateMemberRole(
  actor: ActorContext,
  memberId: string,
  role: WorkspaceRole,
  ip?: string,
): Promise<void> {
  assertCan(actor, Permission.WORKSPACE_MANAGE_MEMBERS);

  const member = await prisma.workspaceMember.findFirst({
    where: { id: memberId, workspaceId: actor.workspaceId },
    select: { id: true, role: true, userId: true },
  });
  if (!member) throw notFound('Участник');

  if (member.role === WorkspaceRole.OWNER) throw forbidden('Роль владельца здесь изменить нельзя');
  if (role === WorkspaceRole.OWNER) throw badRequest('Передайте владение в настройках пространства');
  // An admin must not be able to promote someone to their own level or above.
  if (!outranks(actor.workspaceRole, role) && actor.workspaceRole !== WorkspaceRole.OWNER) {
    throw forbidden('Нельзя выдать роль, равную вашей или выше');
  }
  if (!outranks(actor.workspaceRole, member.role) && actor.workspaceRole !== WorkspaceRole.OWNER) {
    throw forbidden('Нельзя менять роль участника вашего уровня');
  }

  await prisma.workspaceMember.update({ where: { id: memberId }, data: { role } });
  audit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: AuditAction.MEMBER_ROLE_CHANGED,
    entityType: 'WorkspaceMember',
    entityId: memberId,
    metadata: { from: member.role, to: role, userId: member.userId },
    ip,
  });
}

export async function removeMember(actor: ActorContext, memberId: string, ip?: string): Promise<void> {
  const member = await prisma.workspaceMember.findFirst({
    where: { id: memberId, workspaceId: actor.workspaceId },
    select: { id: true, role: true, userId: true },
  });
  if (!member) throw notFound('Участник');

  const isSelf = member.userId === actor.userId;
  if (!isSelf) assertCan(actor, Permission.WORKSPACE_MANAGE_MEMBERS);
  if (member.role === WorkspaceRole.OWNER) throw forbidden('Владельца пространства нельзя исключить');
  if (!isSelf && !outranks(actor.workspaceRole, member.role)) {
    throw forbidden('Нельзя исключить участника вашего уровня или выше');
  }

  await prisma.workspaceMember.delete({ where: { id: memberId } });
  audit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: AuditAction.MEMBER_REMOVED,
    entityType: 'WorkspaceMember',
    entityId: memberId,
    metadata: { userId: member.userId, self: isSelf },
    ip,
  });
}

/** How long a reset password lets the person in with the address alone. */
export const PASSWORD_RESET_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * An admin's password reset for someone who forgot theirs. The old password
 * stops working and every device is signed out; for a day the person can sign
 * in with the address alone and is made to choose a new password first.
 *
 * The same ladder as changing roles: an owner resets anyone but themselves, an
 * admin only people below them. An account is shared across workspaces, so it
 * cannot be reset from here if it runs another workspace that other people
 * work in: that would hand this workspace's admin the keys to someone else's.
 * A personal workspace nobody else is in does not count.
 */
export async function resetMemberPassword(
  actor: ActorContext,
  memberId: string,
  ip?: string,
): Promise<{ expiresAt: string }> {
  assertCan(actor, Permission.WORKSPACE_MANAGE_MEMBERS);

  const member = await prisma.workspaceMember.findFirst({
    where: { id: memberId, workspaceId: actor.workspaceId },
    select: { id: true, role: true, userId: true, user: { select: { status: true } } },
  });
  if (!member) throw notFound('Участник');
  if (member.userId === actor.userId) throw badRequest('Свой пароль меняется в профиле');
  if (member.role === WorkspaceRole.OWNER || !outranks(actor.workspaceRole, member.role)) {
    throw forbidden('Нельзя сбросить пароль участнику вашего уровня или выше');
  }
  if (member.user.status !== 'ACTIVE') {
    throw badRequest('Этот человек ещё не входил — пароля у него пока нет');
  }

  const managesElsewhere = await prisma.workspaceMember.count({
    where: {
      userId: member.userId,
      workspaceId: { not: actor.workspaceId },
      role: { in: [WorkspaceRole.OWNER, WorkspaceRole.ADMIN] },
      workspace: { members: { some: { userId: { not: member.userId } } } },
    },
  });
  if (managesElsewhere > 0) {
    throw forbidden('Этот человек управляет другим пространством — пароль он может сменить только сам');
  }

  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: member.userId },
      data: { passwordHash: null, passwordResetExpiresAt: expiresAt, passwordResetTokenHash: null },
    }),
    prisma.session.deleteMany({ where: { userId: member.userId } }),
  ]);

  audit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: AuditAction.MEMBER_PASSWORD_RESET,
    entityType: 'User',
    entityId: member.userId,
    metadata: { memberId: member.id },
    ip,
  });
  return { expiresAt: expiresAt.toISOString() };
}

export async function listAuditLogs(actor: ActorContext, limit: number, cursor?: string) {
  assertCan(actor, Permission.WORKSPACE_VIEW_AUDIT);
  const rows = await prisma.auditLog.findMany({
    where: { workspaceId: actor.workspaceId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      metadata: true,
      createdAt: true,
      actor: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: items.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      actor: r.actor,
      metadata: (r.metadata ?? null) as Record<string, unknown> | null,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
  };
}

export { workspaceContext };
