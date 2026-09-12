import Fastify, { type FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { env, allowedOrigins, isTest, trustProxy } from './config/env';
import { authPlugin, SESSION_COOKIE } from './plugins/auth';
import { registerErrorHandler } from './plugins/errorHandler';
import { runWithRequestContext } from './lib/requestContext';
import { authRoutes } from './modules/auth/routes';
import { workspaceRoutes } from './modules/workspaces/routes';
import { projectRoutes } from './modules/projects/routes';
import { issueRoutes } from './modules/issues/routes';
import { commentRoutes } from './modules/comments/routes';
import { sprintRoutes } from './modules/sprints/routes';
import { ganttRoutes } from './modules/gantt/routes';
import { notificationRoutes } from './modules/notifications/routes';
import { searchRoutes } from './modules/search/routes';
import { dashboardRoutes } from './modules/dashboard/routes';
import { attachmentRoutes } from './modules/attachments/routes';
import { savedViewRoutes } from './modules/views/routes';
import { userRoutes } from './modules/users/routes';
import { realtimeRoutes } from './realtime/routes';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isTest
      ? false
      : {
          // Per-request access lines are logged at `info`. In production the
          // reverse proxy already records them, so the default level is raised
          // to `warn` there and only real problems reach the log.
          level: env.NODE_ENV === 'production' ? 'warn' : env.LOG_LEVEL,
          transport:
            env.NODE_ENV === 'development'
              ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
              : undefined,
        },
    // The runtime accepts a hop count here, but Fastify's public type omits
    // `number` — trustProxy may be boolean | number | string[] from env.
    trustProxy: trustProxy as boolean | string | string[],
    bodyLimit: 2 * 1024 * 1024,
  });

  registerErrorHandler(app);

  // Registered before every other onRequest hook so the whole request — plugins
  // and handlers alike — runs inside the context. A tab identifies itself here
  // once, and realtime events carry it back so that tab can skip its own echo.
  app.addHook('onRequest', (req, _reply, done) => {
    const header = req.headers['x-client-id'];
    const clientId = typeof header === 'string' && header.length <= 64 ? header : undefined;
    runWithRequestContext({ clientId }, done);
  });

  await app.register(cors, {
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  await app.register(cookie, { secret: env.SESSION_SECRET });

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    // The limiter runs at onRequest, before the auth hook fills
    // req.currentUser at preHandler — so the account key is derived from the
    // raw session cookie header; cookieless traffic falls back to the IP.
    keyGenerator: (req) => {
      const match = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(req.headers.cookie ?? '');
      const token = match?.[1];
      if (token) return `acct:${createHash('sha256').update(token).digest('hex').slice(0, 8)}`;
      return `ip:${req.ip}`;
    },
    enableDraftSpec: true,
  });

  await app.register(multipart, {
    limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 10 },
  });

  // Called directly rather than through `register`: a registered plugin gets
  // its own encapsulation context, and its preHandler hook would then never
  // run for sibling route plugins.
  await authPlugin(app);

  app.get('/health', { config: { rateLimit: false } }, async () => ({
    status: 'ok',
    uptime: Math.round(process.uptime()),
  }));

  // Everything the product exposes lives under one versioned prefix.
  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(workspaceRoutes);
      await api.register(projectRoutes);
      await api.register(issueRoutes);
      await api.register(commentRoutes);
      await api.register(sprintRoutes);
      await api.register(ganttRoutes);
      await api.register(notificationRoutes);
      await api.register(searchRoutes);
      await api.register(dashboardRoutes);
      await api.register(attachmentRoutes);
      await api.register(savedViewRoutes);
      await api.register(userRoutes);
      await api.register(realtimeRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
