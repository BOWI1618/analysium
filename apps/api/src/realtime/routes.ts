/**
 * Server-Sent Events transport.
 *
 * SSE is chosen over WebSockets because the traffic here is one-directional
 * (server → client) and SSE reconnects automatically, works through ordinary
 * HTTP proxies, and needs no extra protocol handling.
 */
import type { FastifyInstance } from 'fastify';
import { RealtimeEventType, eventRecipient, type RealtimeEvent } from '@flowdesk/contracts';
import { eventBus, emit } from './eventBus';
import { presence } from './presence';
import { workspaceContext, visibleProjectIds } from '../lib/context';
import { currentUser, requireAuth } from '../plugins/auth';

const HEARTBEAT_MS = 25_000;
/** How long a guest's visible-project list is cached on the connection. */
const GUEST_PROJECTS_TTL_MS = 30_000;

export async function realtimeRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { workspaceId: string } }>(
    '/workspaces/:workspaceId/stream',
    { preHandler: requireAuth, config: { rateLimit: false } },
    async (req, reply) => {
      const user = currentUser(req);
      const actor = await workspaceContext(user.id, req.params.workspaceId);

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const write = (event: string, data: unknown, id?: string) => {
        if (reply.raw.writableEnded) return;
        if (id) reply.raw.write(`id: ${id}\n`);
        reply.raw.write(`event: ${event}\n`);
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      write('ready', { workspaceId: actor.workspaceId, userId: user.id });

      // Guests may only receive events for projects they belong to. The list
      // is cached on the connection and refreshed periodically; until the
      // first load completes no project-scoped event is sent.
      const isGuest = actor.workspaceRole === 'GUEST';
      let guestProjectIds = new Set<string>();
      const refreshGuestProjects = async () => {
        const allowed = await visibleProjectIds(actor);
        guestProjectIds = new Set(allowed === 'ALL' ? [] : allowed);
      };
      if (isGuest) void refreshGuestProjects();
      const guestRefresh = isGuest ? setInterval(() => void refreshGuestProjects(), GUEST_PROJECTS_TTL_MS) : null;

      const unsubscribe = eventBus.subscribe(actor.workspaceId, (event: RealtimeEvent) => {
        // Notifications are private: only their recipient may see them.
        const recipient = eventRecipient(event);
        if (recipient && recipient !== user.id) return;
        // Project-scoped events (issue, comment, sprint, project) must not
        // leak across projects to guests.
        const projectId = 'projectId' in event.payload ? event.payload.projectId : null;
        if (isGuest && projectId && !guestProjectIds.has(projectId)) return;
        write(event.type, event, event.id);
      });

      const heartbeat = setInterval(() => {
        if (reply.raw.writableEnded) return;
        reply.raw.write(': ping\n\n');
      }, HEARTBEAT_MS);

      const becameOnline = presence.add(actor.workspaceId, user.id);
      if (becameOnline) {
        emit(RealtimeEventType.PRESENCE_CHANGED, {
          workspaceId: actor.workspaceId,
          actorId: user.id,
          payload: { online: presence.list(actor.workspaceId) },
        });
      }

      let cleaned = false;
      const cleanup = () => {
        // Both 'close' and 'error' can fire for one connection — run once.
        if (cleaned) return;
        cleaned = true;
        clearInterval(heartbeat);
        if (guestRefresh) clearInterval(guestRefresh);
        unsubscribe();
        const wentOffline = presence.remove(actor.workspaceId, user.id);
        if (wentOffline) {
          emit(RealtimeEventType.PRESENCE_CHANGED, {
            workspaceId: actor.workspaceId,
            actorId: user.id,
            payload: { online: presence.list(actor.workspaceId) },
          });
        }
      };

      req.raw.on('close', cleanup);
      // A dead socket (EPIPE) surfaces as an 'error' on the raw stream; without
      // a listener it would become an uncaught exception.
      reply.raw.on('error', cleanup);
      req.raw.on('error', cleanup);

      // Returning the reply object would end the response — keep it open.
      return reply;
    },
  );

  app.get<{ Params: { workspaceId: string } }>(
    '/workspaces/:workspaceId/presence',
    { preHandler: requireAuth },
    async (req) => {
      const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
      return { online: presence.list(actor.workspaceId) };
    },
  );
}
