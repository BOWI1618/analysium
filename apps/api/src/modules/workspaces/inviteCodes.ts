/**
 * Access links: how people get into a workspace.
 *
 * The owner makes a link for a role and passes it on by any channel. The
 * person opens it, gives the name, login and password they want, and lands in
 * the workspace with that role. There is no other way in, and nobody but the
 * owner makes links.
 *
 * What the link carries is a short code — short enough to be read out if a
 * link cannot be sent. The safety comes from the rest: only a hash is stored,
 * each code works once, it expires, and redeeming is behind the strict
 * authentication rate limit. At 31^8 possible codes and a handful of attempts
 * per minute, guessing one is not a practical attack.
 */
import { createHash, randomInt } from 'node:crypto';
import type { ActorContext, CreatedInviteCodeDto, InviteCodeDto } from '@flowdesk/contracts';
import { AuditAction, WorkspaceRole } from '@flowdesk/contracts';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { env } from '../../config/env';
import { assertGrantsAccess } from '../auth/access';

/** No 0/O or 1/I/L: a code read aloud or copied by hand must not be ambiguous. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 8;

function generateCode(): string {
  let raw = '';
  for (let i = 0; i < LENGTH; i += 1) raw += ALPHABET[randomInt(ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** Case and separators are forgiven: `abcd efgh`, `ABCD-EFGH` and `abcdefgh` are one code. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashCode(input: string): string {
  return createHash('sha256').update(normalizeCode(input)).digest('hex');
}

const codeSelect = {
  id: true,
  role: true,
  createdAt: true,
  expiresAt: true,
  invitedById: true,
} as const;

async function withCreators(
  rows: { id: string; role: WorkspaceRole; createdAt: Date; expiresAt: Date; invitedById: string }[],
): Promise<InviteCodeDto[]> {
  const creators = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.invitedById))] } },
    select: { id: true, name: true },
  });
  const byId = new Map(creators.map((u) => [u.id, u]));
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    createdBy: byId.get(r.invitedById) ?? null,
  }));
}

export async function createInviteCode(
  actor: ActorContext,
  role: WorkspaceRole,
  ip?: string,
): Promise<CreatedInviteCodeDto> {
  assertGrantsAccess(actor);
  if (role === WorkspaceRole.OWNER) throw badRequest('У пространства может быть только один владелец');

  const code = generateCode();
  const row = await prisma.invitation.create({
    data: {
      workspaceId: actor.workspaceId,
      role,
      tokenHash: hashCode(code),
      invitedById: actor.userId,
      expiresAt: new Date(Date.now() + env.INVITE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
    select: codeSelect,
  });

  audit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: AuditAction.MEMBER_INVITED,
    entityType: 'Invitation',
    entityId: row.id,
    metadata: { role, via: 'code' },
    ip,
  });

  const [dto] = await withCreators([row]);
  return { ...dto!, code };
}

/** Codes still waiting to be used. Spent and expired ones are not worth showing. */
export async function listInviteCodes(actor: ActorContext): Promise<InviteCodeDto[]> {
  assertGrantsAccess(actor);
  const rows = await prisma.invitation.findMany({
    where: { workspaceId: actor.workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: codeSelect,
  });
  return withCreators(rows);
}

export async function revokeInviteCode(actor: ActorContext, id: string): Promise<void> {
  assertGrantsAccess(actor);
  const { count } = await prisma.invitation.deleteMany({
    where: { id, workspaceId: actor.workspaceId, acceptedAt: null },
  });
  if (count === 0) throw notFound('Ссылка для входа');
}
