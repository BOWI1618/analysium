import type {
  LoginInput,
  PasswordResetRequired,
  RegisterInput,
  SessionDto,
  SetNewPasswordInput,
  WorkspaceDto,
} from '@flowdesk/contracts';
import { AuditAction, WorkspaceRole, permissionsFor } from '@flowdesk/contracts';
import { prisma } from '../../lib/prisma';
import { generateToken, hashPassword, hashToken, verifyPassword } from '../../lib/password';
import { badRequest, conflict, unauthorized } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { slugify, uniqueSlug } from '../workspaces/slug';
import { grantsOf } from '../../lib/context';

export async function register(input: RegisterInput, ip?: string) {
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw conflict('Аккаунт с таким логином уже существует', { email: 'Этот логин уже занят' });

  const passwordHash = await hashPassword(input.password);
  const workspaceName = input.workspaceName?.trim() || `Пространство ${input.name.split(' ')[0]}`;
  const slug = await uniqueSlug(slugify(workspaceName));

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        lastActiveAt: new Date(),
      },
    });

    const workspace = await tx.workspace.create({
      data: { name: workspaceName, slug, ownerId: created.id },
    });

    await tx.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: created.id, role: WorkspaceRole.OWNER },
    });

    return created;
  });

  audit({ actorId: user.id, action: AuditAction.USER_REGISTERED, entityType: 'User', entityId: user.id, ip });
  return user;
}

export async function login(
  input: LoginInput,
  ip?: string,
): Promise<{ user: { id: string }; reset?: undefined } | { user?: undefined; reset: PasswordResetRequired }> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // An admin reset the password: the login alone lets the person in, but only
  // as far as choosing a new password. Whatever was typed as a password is
  // ignored — the old one no longer exists.
  const resetPending = Boolean(user?.passwordResetExpiresAt && user.passwordResetExpiresAt.getTime() > Date.now());
  if (user && resetPending && user.status !== 'DEACTIVATED') {
    const { token, hash } = generateToken();
    await prisma.user.update({ where: { id: user.id }, data: { passwordResetTokenHash: hash } });
    return { reset: { passwordResetRequired: true, token } };
  }

  // Always run a verification so timing does not reveal whether the login exists.
  const ok = await verifyPassword(input.password, user?.passwordHash ?? null);
  if (user && !user.passwordHash && user.passwordResetExpiresAt) {
    throw unauthorized('Сброс пароля истёк. Попросите администратора сбросить пароль ещё раз.');
  }
  if (!user || !ok) throw unauthorized('Неверный логин или пароль');
  if (user.status === 'DEACTIVATED') throw unauthorized('Этот аккаунт отключён');

  audit({ actorId: user.id, action: AuditAction.USER_LOGIN, entityType: 'User', entityId: user.id, ip });
  return { user };
}

/** The new password after an admin's reset. Signs out anything left and returns the user to sign in. */
export async function setNewPassword(input: SetNewPasswordInput, ip?: string): Promise<{ id: string }> {
  const user = await prisma.user.findUnique({
    where: { passwordResetTokenHash: hashToken(input.token) },
    select: { id: true, status: true, passwordResetExpiresAt: true },
  });
  if (
    !user ||
    user.status === 'DEACTIVATED' ||
    !user.passwordResetExpiresAt ||
    user.passwordResetExpiresAt.getTime() <= Date.now()
  ) {
    throw badRequest('Ссылка на смену пароля устарела. Войдите по логину ещё раз.');
  }

  const passwordHash = await hashPassword(input.password);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordResetExpiresAt: null, passwordResetTokenHash: null, lastActiveAt: new Date() },
    }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);
  audit({ actorId: user.id, action: AuditAction.USER_PASSWORD_SET, entityType: 'User', entityId: user.id, ip });
  return user;
}

export async function buildSession(userId: string): Promise<SessionDto> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      status: true,
      timezone: true,
      lastActiveAt: true,
      telegramChatId: true,
    },
  });

  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    orderBy: { joinedAt: 'asc' },
    select: {
      role: true,
      customRole: { select: { id: true, name: true, scope: true, permissions: true } },
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

  const workspaces: WorkspaceDto[] = memberships.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    slug: m.workspace.slug,
    logo: m.workspace.logo,
    carryOverTasks: m.workspace.carryOverTasks,
    ownerId: m.workspace.ownerId,
    role: m.role,
    customRole: m.customRole ? { id: m.customRole.id, name: m.customRole.name } : null,
    // The page decides what to offer by this list, so it is the same answer the server gives.
    permissions: permissionsFor({
      userId,
      workspaceId: m.workspace.id,
      workspaceRole: m.role,
      workspaceGrants: grantsOf(m.customRole),
    }),
    memberCount: m.workspace._count.members,
    projectCount: m.workspace._count.projects,
    createdAt: m.workspace.createdAt.toISOString(),
  }));

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      status: user.status,
      timezone: user.timezone,
      lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
      telegramLinked: Boolean(user.telegramChatId),
    },
    workspaces,
    activeWorkspaceId: workspaces[0]?.id ?? null,
  };
}
