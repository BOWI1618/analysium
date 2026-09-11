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

export function useMarkAllRead(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ updated: number }>(`/workspaces/${workspaceId}/notifications/read-all`),
    onSettled: () =>
      void queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'notifications'] }),
  });
}
