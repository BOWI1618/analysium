/**
 * Session authentication.
 *
 * Sessions are opaque random tokens stored as SHA-256 digests, delivered in an
 * httpOnly + SameSite=Lax cookie. That combination gives revocable sessions
 * (unlike stateless JWTs) and blocks cross-site form CSRF; an explicit Origin
 * check below covers the remaining cross-origin cases.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma';
import { hashToken, generateToken } from '../lib/password';
import { unauthorized, forbidden } from '../lib/errors';
import { env, isProd, allowedOrigins } from '../config/env';

export const SESSION_COOKIE = 'fd_session';

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  timezone: string;
  status: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: AuthenticatedUser;
    sessionId?: string;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Rejects state-changing requests whose Origin is not an allowed front-end. */
export function assertSameOrigin(req: FastifyRequest): void {
  if (SAFE_METHODS.has(req.method)) return;
  const origin = req.headers.origin;
  if (!origin) return; // same-origin fetches and server-to-server calls omit it
  if (!allowedOrigins.includes(origin)) {
    throw forbidden('Межсайтовый запрос заблокирован');
  }
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string; ip?: string },
): Promise<{ token: string; expiresAt: Date }> {
  const { token, hash } = generateToken();
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hash,
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      ip: meta.ip ?? null,
    },
  });
  return { token, expiresAt };
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function destroySession(sessionId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

/** Resolves the session cookie into a user; returns null when unauthenticated. */
async function resolveUser(req: FastifyRequest): Promise<{ user: AuthenticatedUser; sessionId: string } | null> {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (!raw) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(raw) },
    select: {
      id: true,
      expiresAt: true,
      user: {
        select: { id: true, name: true, email: true, avatarUrl: true, timezone: true, status: true },
      },
    },
  });

  if (!session || session.expiresAt.getTime() < Date.now()) return null;
  if (session.user.status === 'DEACTIVATED') return null;

  return { user: session.user, sessionId: session.id };
}

/** Throttles `lastActiveAt` writes to at most one per user per few minutes. */
const lastTouch = new Map<string, number>();
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

function touchUser(userId: string, sessionId: string): void {
  const now = Date.now();
  if ((lastTouch.get(userId) ?? 0) + TOUCH_INTERVAL_MS > now) return;
  lastTouch.set(userId, now);
  // `updateMany` rather than `update`: the session can be revoked between the
  // request being served and this fire-and-forget write landing, and a missing
  // row is not an error worth logging.
  void prisma.user
    .updateMany({ where: { id: userId }, data: { lastActiveAt: new Date() } })
    .catch(() => undefined);
  void prisma.session
    .updateMany({ where: { id: sessionId }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
}

export async function authPlugin(app: FastifyInstance): Promise<void> {
  // Populate req.currentUser for every request; individual routes decide
  // whether authentication is required via `requireAuth`.
  app.addHook('preHandler', async (req) => {
    assertSameOrigin(req);
    const resolved = await resolveUser(req);
    if (resolved) {
      req.currentUser = resolved.user;
      req.sessionId = resolved.sessionId;
      touchUser(resolved.user.id, resolved.sessionId);
    }
  });
}

/** Route-level guard. Use as `{ preHandler: requireAuth }`. */
export async function requireAuth(req: FastifyRequest): Promise<void> {
  if (!req.currentUser) throw unauthorized();
}

export function currentUser(req: FastifyRequest): AuthenticatedUser {
  if (!req.currentUser) throw unauthorized();
  return req.currentUser;
}
