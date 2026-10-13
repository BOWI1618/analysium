import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { NotificationDto } from '@flowdesk/contracts';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';

interface NotificationPage {
  items: NotificationDto[];
  nextCursor: string | null;
  unreadCount: number;
}

export function useNotifications(workspaceId: string, unreadOnly = false) {
  return useInfiniteQuery({
    queryKey: qk.notifications(workspaceId, unreadOnly),
    queryFn: ({ pageParam }) =>
      api.get<NotificationPage>(`/workspaces/${workspaceId}/notifications`, {
        query: { unreadOnly: unreadOnly || undefined, cursor: pageParam, limit: 25 },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(workspaceId),
    // Realtime pushes updates; this is a safety net for a dropped stream.
    refetchInterval: 120_000,
    staleTime: 20_000,
  });
}

export function useUnreadCount(workspaceId: string): number {
  const { data } = useNotifications(workspaceId, false);
  return data?.pages[0]?.unreadCount ?? 0;
}

export function useMarkRead(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notificationId: string) => api.post<void>(`/notifications/${notificationId}/read`),
    onMutate: async (notificationId) => {
      const keys = [qk.notifications(workspaceId, false), qk.notifications(workspaceId, true)];
      for (const key of keys) {
        queryClient.setQueryData<{ pages: NotificationPage[]; pageParams: unknown[] }>(key, (data) =>
          data
            ? {
                ...data,
                pages: data.pages.map((page, index) => ({
                  ...page,
                  unreadCount: index === 0 ? Math.max(0, page.unreadCount - 1) : page.unreadCount,
                  items: page.items.map((n) =>
                    n.id === notificationId && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n,
                  ),
                })),
              }
            : data,
        );
      }
    },
    onSettled: () =>
      void queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'notifications'] }),
  });
}

const subscribeToVisibility = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
};

/**
 * Opening a task reads its notifications.
 *
 * A notification says «look at this task»; once the task is on the screen
 * that has happened, whichever way the person came to it — from the bell, the
 * board, a link. It used to stay lit until it was clicked in the list itself,
 * so an answer already read in the task went on asking to be read.
 *
 * Asked once when the task opens — an older notification may lie beyond the
 * pages of the list that are loaded — and again when one arrives while the
 * task is open. Not while the tab is in the background: a page nobody is
 * looking at has not been read.
 */
export function useReadIssueNotifications(workspaceId: string, issueId: string | undefined) {
  const queryClient = useQueryClient();
  const { data } = useNotifications(workspaceId);
  const visible = useSyncExternalStore(subscribeToVisibility, () => !document.hidden, () => true);
  const unreadHere = issueId
    ? (data?.pages ?? []).reduce(
        (count, page) => count + page.items.filter((item) => item.issue?.id === issueId && !item.readAt).length,
        0,
      )
    : 0;

  // The task that was asked about, and the one a failed request gave up on.
  const asked = useRef<string | null>(null);
  const gaveUp = useRef<string | null>(null);

  const { mutate, isPending } = useMutation({
    mutationFn: (id: string) => api.post<{ updated: number }>(`/issues/${id}/notifications/read`),
    onMutate: (id) => {
      const now = new Date().toISOString();
      for (const key of [qk.notifications(workspaceId, false), qk.notifications(workspaceId, true)]) {
        queryClient.setQueryData<{ pages: NotificationPage[]; pageParams: unknown[] }>(key, (list) => {
          if (!list) return list;
          const read = list.pages.reduce(
            (count, page) => count + page.items.filter((item) => item.issue?.id === id && !item.readAt).length,
            0,
          );
          if (read === 0) return list;
          return {
            ...list,
            pages: list.pages.map((page, index) => ({
              ...page,
              unreadCount: index === 0 ? Math.max(0, page.unreadCount - read) : page.unreadCount,
              items: page.items.map((item) => (item.issue?.id === id && !item.readAt ? { ...item, readAt: now } : item)),
            })),
          };
        });
      }
    },
    onSuccess: ({ updated }) => {
      if (updated > 0) void queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'notifications'] });
    },
    onError: (_error, id) => {
      // Not asked again for this task: a request that keeps failing must not be repeated in a loop.
      gaveUp.current = id;
      void queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'notifications'] });
    },
  });

  useEffect(() => {
    if (!workspaceId || !issueId || !visible || isPending || gaveUp.current === issueId) return;
    if (asked.current === issueId && unreadHere === 0) return;
    asked.current = issueId;
    mutate(issueId);
  }, [workspaceId, issueId, visible, unreadHere, isPending, mutate]);
}

export function useMarkAllRead(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ updated: number }>(`/workspaces/${workspaceId}/notifications/read-all`),
    onSettled: () =>
      void queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'notifications'] }),
  });
}
