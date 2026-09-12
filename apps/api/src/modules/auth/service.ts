import type { LoginInput, RegisterInput, SessionDto, WorkspaceDto } from '@flowdesk/contracts';
import { AuditAction, WorkspaceRole } from '@flowdesk/contracts';
import { prisma } from '../../lib/prisma';
import { hashPassword, verifyPassword } from '../../lib/password';
import { AppError, conflict, unauthorized } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { slugify, uniqueSlug } from '../workspaces/slug';
import { env } from '../../config/env';
import { verificationRequired } from './verification';

export async function register(input: RegisterInput, ip?: string) {
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw conflict('Аккаунт с такой почтой уже существует', { email: 'Эта почта уже зарегистрирована' });

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
        // The moment and the wording agreed to. Without mail configured there
        // is no way to prove the address, so it counts as verified rather than
        // leaving an account nobody can ever activate.
        consentAcceptedAt: new Date(),
        consentVersion: env.PRIVACY_POLICY_VERSION,
        emailVerifiedAt: env.MAIL_ENABLED ? null : new Date(),
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

export async function login(input: LoginInput, ip?: string) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Always run a verification so timing does not reveal whether the email exists.
  const ok = await verifyPassword(input.password, user?.passwordHash ?? null);
  if (!user || !ok) throw unauthorized('Неверная почта или пароль');
  if (user.status === 'DEACTIVATED') throw unauthorized('Этот аккаунт отключён');

  // Distinct code so the sign-in form can offer to resend the link instead of
  // showing "wrong password" for an account whose password is perfectly right.
  if (verificationRequired() && !user.emailVerifiedAt) {
    throw new AppError('EMAIL_NOT_VERIFIED', 'Почта не подтверждена. Откройте ссылку из письма.');
  }

  audit({ actorId: user.id, action: AuditAction.USER_LOGIN, entityType: 'User', entityId: user.id, ip });
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
    },
  });

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
          ownerId: true,
          createdAt: true,
          _count: { select: { members: true, projects: true } },
        },
      },
    },
  });

  const workspaces: WorkspaceDto[] = memberships.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    slug: m.workspace.slug,
    logo: m.workspace.logo,
    ownerId: m.workspace.ownerId,
    role: m.role,
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
    },
    workspaces,
    activeWorkspaceId: workspaces[0]?.id ?? null,
  };
}
