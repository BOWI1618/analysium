import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { env, allowedOrigins, isTest } from './config/env';
import { authPlugin } from './plugins/auth';
import { registerErrorHandler } from './plugins/errorHandler';
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
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  registerErrorHandler(app);

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
    // Authenticated users are limited per account, anonymous traffic per IP.
    keyGenerator: (req) => req.currentUser?.id ?? req.ip,
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
