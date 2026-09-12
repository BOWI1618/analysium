import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RealtimeEventType, type RealtimeEvent } from '@flowdesk/contracts';
import { API_BASE, CLIENT_ID } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { useSession } from './session';

export type ConnectionState = 'connecting' | 'open' | 'closed';

interface RealtimeContextValue {
  state: ConnectionState;
  onlineUserIds: string[];
}

const RealtimeContext = createContext<RealtimeContextValue>({ state: 'closed', onlineUserIds: [] });

/**
 * Subscribes to the workspace event stream and translates typed events into
 * targeted cache invalidations. Only the affected queries refetch, so a
 * teammate's edit updates the board without a full reload or a flash.
 *
 * Reconnection uses exponential backoff; EventSource also retries on its own,
 * so a dropped connection heals without user action.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { workspace, user } = useSession();
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConnectionState>('closed');
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const retryRef = useRef(0);

  const workspaceId = workspace?.id;
  const userId = user?.id;

  useEffect(() => {
    if (!workspaceId || !userId) {
      setState('closed');
      return undefined;
    }

    let source: EventSource | null = null;
    let reconnectTimer: number | undefined;
    let disposed = false;

    const handle = (event: RealtimeEvent) => {
      // Skip only this tab's own echo — it already applied the change
      // optimistically. Every other client refreshes, including another tab or
      // device of the same person, which is why this compares the tab id and
      // not the user id.
      const isOwnEcho = event.clientId !== undefined && event.clientId === CLIENT_ID;

      switch (event.type) {
        case RealtimeEventType.ISSUE_CREATED:
        case RealtimeEventType.ISSUE_DELETED:
        case RealtimeEventType.ISSUE_UPDATED:
        case RealtimeEventType.ISSUE_STATUS_CHANGED:
        case RealtimeEventType.ISSUE_MOVED: {
          if (isOwnEcho) break;
          void queryClient.invalidateQueries({ queryKey: ['project', event.payload.projectId] });
          void queryClient.invalidateQueries({ queryKey: ['issues'] });
          void queryClient.invalidateQueries({ queryKey: qk.issue(event.payload.issueId) });
          void queryClient.invalidateQueries({ queryKey: qk.issuesByKey });
          break;
        }
        case RealtimeEventType.COMMENT_CREATED:
        case RealtimeEventType.COMMENT_UPDATED:
        case RealtimeEventType.COMMENT_DELETED: {
          if (isOwnEcho) break;
          void queryClient.invalidateQueries({ queryKey: qk.issueComments(event.payload.issueId) });
          void queryClient.invalidateQueries({ queryKey: qk.issueActivity(event.payload.issueId) });
          void queryClient.invalidateQueries({ queryKey: qk.issue(event.payload.issueId) });
          break;
        }
        case RealtimeEventType.NOTIFICATION_CREATED: {
          void queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'notifications'] });
          break;
        }
        case RealtimeEventType.SPRINT_UPDATED: {
          if (isOwnEcho) break;
          void queryClient.invalidateQueries({ queryKey: qk.sprints(event.payload.projectId) });
          void queryClient.invalidateQueries({ queryKey: ['project', event.payload.projectId] });
          break;
        }
        case RealtimeEventType.PROJECT_UPDATED: {
          if (isOwnEcho) break;
          void queryClient.invalidateQueries({ queryKey: qk.project(event.payload.projectId) });
          void queryClient.invalidateQueries({ queryKey: qk.projects(workspaceId) });
          break;
        }
        case RealtimeEventType.MEMBER_UPDATED: {
          void queryClient.invalidateQueries({ queryKey: qk.members(workspaceId) });
          break;
        }
        case RealtimeEventType.PRESENCE_CHANGED: {
          setOnlineUserIds(event.payload.online);
          break;
        }
      }
    };

    const connect = () => {
      if (disposed) return;
      setState('connecting');
      source = new EventSource(`${API_BASE}/workspaces/${workspaceId}/stream`, { withCredentials: true });

      source.addEventListener('ready', () => {
        retryRef.current = 0;
        setState('open');
      });

      for (const type of Object.values(RealtimeEventType)) {
        source.addEventListener(type, (message) => {
          try {
            handle(JSON.parse((message as MessageEvent).data) as RealtimeEvent);
          } catch {
            /* malformed frame — skip it rather than tearing down the stream */
          }
        });
      }

      source.onerror = () => {
        source?.close();
        setState('closed');
        if (disposed) return;
        retryRef.current = Math.min(retryRef.current + 1, 6);
        const delay = Math.min(1000 * 2 ** retryRef.current, 30_000);
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      source?.close();
      setState('closed');
    };
  }, [workspaceId, userId, queryClient]);

  const value = useMemo(() => ({ state, onlineUserIds }), [state, onlineUserIds]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext);
}
