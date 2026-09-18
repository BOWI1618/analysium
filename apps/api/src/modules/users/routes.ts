import type { FastifyInstance } from 'fastify';
import { changePasswordSchema, updateProfileSchema } from '@flowdesk/contracts';
import { parse } from '../../lib/validate';
import { prisma } from '../../lib/prisma';
import { workspaceContext, visibleProjectIds } from '../../lib/context';
import { currentUser, requireAuth } from '../../plugins/auth';
import { hashPassword, verifyPassword } from '../../lib/password';
import { badRequest, notFound } from '../../lib/errors';
import { issueSummarySelect, toIssueSummary } from '../../lib/serialize';
import { storage } from '../../lib/storage';

/** Photos only, and never SVG — it can carry script. */
const AVATAR_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.patch('/me', async (req) => {
    const user = currentUser(req);
    const patch = parse(updateProfileSchema, req.body);
    // An address given by hand replaces an uploaded photo, whose file goes.
    const replacedPhoto =
      patch.avatarUrl !== undefined
        ? (await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { avatarKey: true } })).avatarKey
        : null;
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { ...patch, ...(replacedPhoto ? { avatarKey: null, avatarMime: null } : {}) },
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        timezone: true,
        status: true,
        emailNotifications: true,
      },
    });
    if (replacedPhoto) await storage.remove(replacedPhoto);
    return updated;
  });

  /**
   * A profile photo uploaded from the computer. The address changes with every
   * upload, so browsers that cached the old picture fetch the new one.
   */
  app.post('/me/avatar', async (req) => {
    const user = currentUser(req);
    const file = await req.file({ limits: { fileSize: AVATAR_MAX_BYTES } });
    if (!file) throw badRequest('Файл не был загружен');
    const mimeType = (file.mimetype || '').toLowerCase();
    if (!AVATAR_MIME.has(mimeType)) throw badRequest('Подойдёт картинка PNG, JPG, WebP или GIF');

    const { key } = await storage.save(file.file, { filename: 'avatar', mimeType });
    if (file.file.truncated) {
      await storage.remove(key);
      throw badRequest('Фото больше 2 МБ — выберите поменьше');
    }

    const previous = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { avatarKey: true } });
    const avatarUrl = `/api/v1/users/${user.id}/avatar?v=${Date.now().toString(36)}`;
    await prisma.user.update({
      where: { id: user.id },
      data: { avatarKey: key, avatarMime: mimeType, avatarUrl },
    });
    if (previous.avatarKey) await storage.remove(previous.avatarKey);
    return { avatarUrl };
  });

  app.delete('/me/avatar', async (req, reply) => {
    const user = currentUser(req);
    const previous = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { avatarKey: true } });
    await prisma.user.update({
      where: { id: user.id },
      data: { avatarKey: null, avatarMime: null, avatarUrl: null },
    });
    if (previous.avatarKey) await storage.remove(previous.avatarKey);
    return reply.status(204).send();
  });

  /** Any signed-in person may see a photo: it is shown wherever the name is. */
  app.get<{ Params: { userId: string } }>('/users/:userId/avatar', async (req, reply) => {
    const owner = await prisma.user.findUnique({
      where: { id: req.params.userId },
      select: { avatarKey: true, avatarMime: true },
    });
    if (!owner?.avatarKey || !owner.avatarMime) throw notFound('Фото');
    return reply
      .header('Content-Type', owner.avatarMime)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      // The address carries a version, so a long cache is safe.
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .send(storage.read(owner.avatarKey));
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

      const allowed = await visibleProjectIds(actor);
      const scope = {
        project: { workspaceId: actor.workspaceId },
        archivedAt: null,
        ...(allowed === 'ALL' ? {} : { projectId: { in: allowed } }),
      };
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
          where: {
            actorId: req.params.userId,
            issue: {
              project: {
                workspaceId: actor.workspaceId,
                ...(allowed === 'ALL' ? {} : { id: { in: allowed } }),
              },
            },
          },
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
