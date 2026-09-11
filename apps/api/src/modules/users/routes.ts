import type { FastifyInstance } from 'fastify';
import { changePasswordSchema, updateProfileSchema } from '@flowdesk/contracts';
import { parse } from '../../lib/validate';
import { prisma } from '../../lib/prisma';
import { workspaceContext } from '../../lib/context';
import { currentUser, requireAuth } from '../../plugins/auth';
import { hashPassword, verifyPassword } from '../../lib/password';
import { badRequest, notFound } from '../../lib/errors';
import { issueSummarySelect, toIssueSummary } from '../../lib/serialize';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.patch('/me', async (req) => {
    const user = currentUser(req);
    const patch = parse(updateProfileSchema, req.body);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: patch,
      select: { id: true, name: true, email: true, avatarUrl: true, timezone: true, status: true },
    });
    return updated;
  });

  app.post('/me/password', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const user = currentUser(req);
    const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);

    const record = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    const ok = await verifyPassword(currentPassword, record.passwordHash);
    if (!ok) throw badRequest('Текущий пароль неверен', { currentPassword: 'Incorrect password' });

    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } });
    // Signing out other devices is the expected behaviour after a password change.
    await prisma.session.deleteMany({ where: { userId: user.id, NOT: { id: req.sessionId } } });
    return reply.status(204).send();
  });

  /** Public-within-workspace profile: identity plus their work. */
  app.get<{ Params: { workspaceId: string; userId: string } }>(
    '/workspaces/:workspaceId/users/:userId',
    async (req) => {
      const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);

      const member = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId: req.params.userId } },
        select: {
          role: true,
          joinedAt: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
              timezone: true,
              status: true,
              lastActiveAt: true,
              createdAt: true,
            },
          },
        },
      });
      if (!member) throw notFound('Пользователь');

      const scope = { project: { workspaceId: actor.workspaceId }, archivedAt: null };
      const [assigned, created, completedCount, recentActivity] = await Promise.all([
        prisma.issue.findMany({
          where: { ...scope, assigneeId: req.params.userId, status: { category: { notIn: ['COMPLETED', 'CANCELED'] } } },
          orderBy: { updatedAt: 'desc' },
          take: 20,
          select: issueSummarySelect,
        }),
        prisma.issue.findMany({
          where: { ...scope, reporterId: req.params.userId },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: issueSummarySelect,
        }),
        prisma.issue.count({ where: { ...scope, assigneeId: req.params.userId, completedAt: { not: null } } }),
        prisma.activityEvent.findMany({
          where: { actorId: req.params.userId, issue: { project: { workspaceId: actor.workspaceId } } },
          orderBy: { createdAt: 'desc' },
          take: 25,
          select: {
            id: true,
            type: true,
            field: true,
            fromValue: true,
            toValue: true,
            createdAt: true,
            issue: { select: { id: true, issueKey: true, title: true } },
          },
        }),
      ]);

      return {
        user: {
          ...member.user,
          lastActiveAt: member.user.lastActiveAt?.toISOString() ?? null,
          createdAt: member.user.createdAt.toISOString(),
        },
        role: member.role,
        joinedAt: member.joinedAt.toISOString(),
        stats: { assigned: assigned.length, created: created.length, completed: completedCount },
        assignedIssues: assigned.map(toIssueSummary),
        createdIssues: created.map(toIssueSummary),
        activity: recentActivity.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
      };
    },
  );
}
