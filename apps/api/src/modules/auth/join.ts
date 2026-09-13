/**
 * Redeeming a join code: a new account created straight into a workspace.
 *
 * This is registration with an entry ticket. It deliberately ignores
 * ALLOW_PUBLIC_REGISTRATION — once the public form is closed, a code from an
 * admin is the way in, and it must not depend on that flag.
 */
import type { JoinWithCodeInput } from '@flowdesk/contracts';
import { AuditAction } from '@flowdesk/contracts';
import { prisma } from '../../lib/prisma';
import { hashPassword } from '../../lib/password';
import { badRequest, conflict } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { env } from '../../config/env';
import { hashCode } from '../workspaces/inviteCodes';

export async function joinWithCode(input: JoinWithCodeInput, ip?: string) {
  // One message for wrong, spent and expired alike: which of those applies is
  // not something to tell a person trying codes at random.
  const invalid = badRequest('Код не подходит или устарел. Попросите новый у администратора.', {
    code: 'Код не подходит',
  });

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashCode(input.code) },
    select: { id: true, workspaceId: true, role: true, acceptedAt: true, expiresAt: true },
  });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) throw invalid;

  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) {
    throw conflict('Аккаунт с такой почтой уже есть. Войдите в него или укажите другую почту.', {
      email: 'Эта почта уже зарегистрирована',
    });
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.$transaction(async (tx) => {
    // Claimed first and conditionally, so two people typing the same code at
    // the same moment cannot both get in: only one update matches.
    const claimed = await tx.invitation.updateMany({
      where: { id: invitation.id, acceptedAt: null, expiresAt: { gt: new Date() } },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count !== 1) throw invalid;

    const created = await tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        lastActiveAt: new Date(),
        // Same rule as registration: without mail there is no way to prove the
        // address, so it is not asked for.
        emailVerifiedAt: env.MAIL_ENABLED ? null : new Date(),
      },
    });

    await tx.workspaceMember.create({
      data: { workspaceId: invitation.workspaceId, userId: created.id, role: invitation.role },
    });
    await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedById: created.id } });

    return created;
  });

  audit({
    workspaceId: invitation.workspaceId,
    actorId: user.id,
    action: AuditAction.MEMBER_JOINED,
    entityType: 'User',
    entityId: user.id,
    metadata: { role: invitation.role, via: 'code' },
    ip,
  });

  return { user, workspaceId: invitation.workspaceId };
}
