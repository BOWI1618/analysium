/** Fire-and-forget audit trail. Never blocks or fails the originating request. */
import type { AuditAction } from '@flowdesk/contracts';
import { prisma } from './prisma';

export interface AuditInput {
  workspaceId?: string | null;
  actorId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

export function audit(input: AuditInput): void {
  void prisma.auditLog
    .create({
      data: {
        workspaceId: input.workspaceId ?? null,
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: (input.metadata ?? null) as never,
        ip: input.ip ?? null,
      },
    })
    .catch(() => undefined);
}
