import type { FastifyInstance } from 'fastify';
import {
  joinWithCodeSchema,
  loginSchema,
  registerSchema,
  setNewPasswordSchema,
  telegramLoginSchema,
  AuditAction,
} from '@flowdesk/contracts';
import { env } from '../../config/env';
import { telegramEnabled } from '../../lib/telegram';
import { verifyInitData } from '../../domain/telegramAuth';
import { parse } from '../../lib/validate';
import { forbidden, unauthorized } from '../../lib/errors';
import { audit } from '../../lib/audit';
import {
  clearSessionCookie,
  createSession,
  currentUser,
  destroySession,
  requireAuth,
  setSessionCookie,
} from '../../plugins/auth';
import { buildSession, login, register, setNewPassword } from './service';
import { prisma } from '../../lib/prisma';
import { joinWithCode } from './join';
import { registrationOpen } from './access';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Credential endpoints get a much tighter budget than the global limit.
  const strictLimit = {
    config: { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: '5 minutes' } },
  };

  // What the sign-in screens need to know before anyone is signed in: whether
  // there is a sign-up form at all. There is one only until the first account
  // exists; after that people get in by an owner's link.
  app.get('/auth/config', async () => ({
    registrationOpen: await registrationOpen(),
    telegramEnabled,
  }));

  app.post('/auth/register', strictLimit, async (req, reply) => {
    if (!(await registrationOpen())) {
      throw forbidden('Регистрация закрыта. Доступ выдаёт владелец пространства — попросите у него ссылку.');
    }
    const input = parse(registerSchema, req.body);
    const user = await register(input, req.ip);

    const { token, expiresAt } = await createSession(user.id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    setSessionCookie(reply, token, expiresAt);
    return reply.status(201).send(await buildSession(user.id));
  });

  app.post('/auth/join', strictLimit, async (req, reply) => {
    const input = parse(joinWithCodeSchema, req.body);
    const { user } = await joinWithCode(input, req.ip);

    const { token, expiresAt } = await createSession(user.id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    setSessionCookie(reply, token, expiresAt);
    return reply.status(201).send(await buildSession(user.id));
  });

  app.post('/auth/login', strictLimit, async (req, reply) => {
    const input = parse(loginSchema, req.body);
    const result = await login(input, req.ip);
    // A reset is pending: no session until a new password is chosen.
    if (result.reset) return reply.send(result.reset);
    const { user } = result;
    const { token, expiresAt } = await createSession(user.id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    setSessionCookie(reply, token, expiresAt);
    return reply.send(await buildSession(user.id));
  });

  /**
   * Sign-in for Analysium opened inside Telegram. The launch data is signed by
   * Telegram, so it proves which Telegram account opened the app; the account
   * that connected that Telegram in its settings is let in without a password.
   */
  app.post('/auth/telegram', strictLimit, async (req, reply) => {
    const { initData } = parse(telegramLoginSchema, req.body);
    const telegramId = telegramEnabled ? verifyInitData(initData, env.TELEGRAM_BOT_TOKEN ?? '') : null;
    if (!telegramId) throw unauthorized('Не удалось подтвердить вход через Telegram');

    const user = await prisma.user.findUnique({
      where: { telegramChatId: telegramId },
      select: { id: true, status: true },
    });
    if (!user) {
      throw unauthorized('Этот Telegram не подключён к аккаунту. Войдите по логину и паролю и подключите его в настройках.');
    }
    if (user.status === 'DEACTIVATED') throw unauthorized('Этот аккаунт отключён');

    audit({ actorId: user.id, action: AuditAction.USER_LOGIN, entityType: 'User', entityId: user.id, ip: req.ip });
    const { token, expiresAt } = await createSession(user.id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    setSessionCookie(reply, token, expiresAt);
    return reply.send(await buildSession(user.id));
  });

  app.post('/auth/set-password', strictLimit, async (req, reply) => {
    const input = parse(setNewPasswordSchema, req.body);
    const { id } = await setNewPassword(input, req.ip);
    const { token, expiresAt } = await createSession(id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    setSessionCookie(reply, token, expiresAt);
    return reply.send(await buildSession(id));
  });

  app.post('/auth/logout', { preHandler: requireAuth }, async (req, reply) => {
    const user = currentUser(req);
    if (req.sessionId) await destroySession(req.sessionId);
    clearSessionCookie(reply);
    audit({ actorId: user.id, action: AuditAction.USER_LOGOUT, entityType: 'User', entityId: user.id, ip: req.ip });
    return reply.status(204).send();
  });

  app.get('/auth/session', async (req, reply) => {
    if (!req.currentUser) return reply.status(200).send({ user: null, workspaces: [], activeWorkspaceId: null });
    return reply.send(await buildSession(req.currentUser.id));
  });
}
