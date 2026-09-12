import type { FastifyInstance } from 'fastify';
import { loginSchema, registerSchema, AuditAction } from '@flowdesk/contracts';
import { env } from '../../config/env';
import { parse } from '../../lib/validate';
import { forbidden } from '../../lib/errors';
import { audit } from '../../lib/audit';
import {
  clearSessionCookie,
  createSession,
  currentUser,
  destroySession,
  requireAuth,
  setSessionCookie,
} from '../../plugins/auth';
import { buildSession, login, register } from './service';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Credential endpoints get a much tighter budget than the global limit.
  const strictLimit = {
    config: { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: '5 minutes' } },
  };

  app.post('/auth/register', strictLimit, async (req, reply) => {
    if (!env.ALLOW_PUBLIC_REGISTRATION) {
      throw forbidden('Регистрация закрыта. Попросите приглашение у администратора пространства.');
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

  app.post('/auth/login', strictLimit, async (req, reply) => {
    const input = parse(loginSchema, req.body);
    const user = await login(input, req.ip);
    const { token, expiresAt } = await createSession(user.id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    setSessionCookie(reply, token, expiresAt);
    return reply.send(await buildSession(user.id));
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
