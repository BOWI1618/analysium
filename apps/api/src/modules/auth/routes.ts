import type { FastifyInstance } from 'fastify';
import {
  acceptInviteSchema,
  joinWithCodeSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  setNewPasswordSchema,
  verifyEmailSchema,
  AuditAction,
} from '@flowdesk/contracts';
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
import { buildSession, login, register, setNewPassword } from './service';
import { acceptInvite, sendVerificationEmail, verificationRequired, verifyEmail } from './verification';
import { prisma } from '../../lib/prisma';
import { joinWithCode } from './join';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Credential endpoints get a much tighter budget than the global limit.
  const strictLimit = {
    config: { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: '5 minutes' } },
  };

  // What the sign-in screens need to know before anyone is signed in: whether
  // to offer "create an account" at all, or only joining with a code.
  app.get('/auth/config', async () => ({
    registrationOpen: env.ALLOW_PUBLIC_REGISTRATION,
    // Lets the settings page say plainly that letters are off on this server,
    // instead of offering a switch that does nothing.
    mailEnabled: env.MAIL_ENABLED,
  }));

  app.post('/auth/register', strictLimit, async (req, reply) => {
    if (!env.ALLOW_PUBLIC_REGISTRATION) {
      throw forbidden('Регистрация закрыта. Попросите у администратора пространства код приглашения.');
    }
    const input = parse(registerSchema, req.body);
    const user = await register(input, req.ip);

    // With mail on, the account exists but cannot sign in yet: the person gets
    // a link and comes back. No session cookie is issued, otherwise the check
    // on the next sign-in would be pointless.
    if (verificationRequired()) {
      await sendVerificationEmail(user);
      return reply.status(201).send({ verificationRequired: true, email: user.email });
    }

    const { token, expiresAt } = await createSession(user.id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    setSessionCookie(reply, token, expiresAt);
    return reply.status(201).send(await buildSession(user.id));
  });

  app.post('/auth/verify-email', strictLimit, async (req, reply) => {
    const { token } = parse(verifyEmailSchema, req.body);
    await verifyEmail(token);
    return reply.status(204).send();
  });

  app.post('/auth/join', strictLimit, async (req, reply) => {
    const input = parse(joinWithCodeSchema, req.body);
    const { user } = await joinWithCode(input, req.ip);

    // Same fork as registration: with mail on the address has to be proven
    // before a session exists; with it off the person is simply in.
    if (verificationRequired()) {
      await sendVerificationEmail(user);
      return reply.status(201).send({ verificationRequired: true, email: user.email });
    }

    const { token, expiresAt } = await createSession(user.id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    setSessionCookie(reply, token, expiresAt);
    return reply.status(201).send(await buildSession(user.id));
  });

  app.post('/auth/accept-invite', strictLimit, async (req, reply) => {
    const input = parse(acceptInviteSchema, req.body);
    const { id } = await acceptInvite(input);

    // Straight into a session: the link already proved the address, so making
    // them type the password they just chose would be pure friction.
    const { token, expiresAt } = await createSession(id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    setSessionCookie(reply, token, expiresAt);
    return reply.status(200).send(await buildSession(id));
  });

  app.post('/auth/resend-verification', strictLimit, async (req, reply) => {
    const { email } = parse(resendVerificationSchema, req.body);
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, emailVerifiedAt: true },
    });

    // Answers the same way whether or not the address is registered: the reply
    // must not be a way to find out who has an account here.
    if (user && !user.emailVerifiedAt && verificationRequired()) {
      await sendVerificationEmail(user);
    }
    return reply.status(202).send({ sent: true });
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
