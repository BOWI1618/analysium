/**
 * Opening an access link: a new account created straight into a workspace.
 *
 * This is the way in. The link carries a one-time code made by the owner of
 * the workspace; the person says who they are and how they will sign in.
 */
import type { JoinWithCodeInput } from '@flowdesk/contracts';
import { AuditAction, RealtimeEventType } from '@flowdesk/contracts';
import { emit } from '../../realtime/eventBus';
import { prisma } from '../../lib/prisma';
import { hashPassword } from '../../lib/password';
import { badRequest, conflict } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { hashCode } from '../workspaces/inviteCodes';

export async function joinWithCode(input: JoinWithCodeInput, ip?: string) {
  // One message for wrong, spent and expired alike: which of those applies is
  // not something to tell a person trying codes at random.
  const invalid = badRequest('Ссылка не подходит или устарела. Попросите новую у владельца пространства.', {
    code: 'Ссылка не подходит',
  });

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashCode(input.code) },
    select: { id: true, workspaceId: true, role: true, acceptedAt: true, expiresAt: true },
  });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) throw invalid;

  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) {
    throw conflict('Такой логин уже занят. Придумайте другой.', {
      email: 'Этот логин уже занят',
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
      },
    });

    const member = await tx.workspaceMember.create({
      data: { workspaceId: invitation.workspaceId, userId: created.id, role: invitation.role },
      select: { id: true },
    });
    await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedById: created.id } });

    return { ...created, memberId: member.id };
  });

  // Open sessions keep the list of people for their pickers. Without a word
  // from here a colleague who has just joined could not be chosen or given a
  // task until everyone reloaded the page.
  emit(RealtimeEventType.MEMBER_UPDATED, {
    workspaceId: invitation.workspaceId,
    actorId: user.id,
    payload: { memberId: user.memberId, userId: user.id },
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
