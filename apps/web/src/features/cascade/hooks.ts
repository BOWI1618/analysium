import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CascadeDto } from '@flowdesk/contracts';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';

/**
 * A pool and the people right below it: the viewer's own, or — with
 * `viewedUserId` — that of someone in the viewer's branch.
 *
 * The key sits under the `issues` root, so anything that refreshes task lists
 * — a handover made here, a change arriving over the realtime channel —
 * refreshes these figures with them.
 */
export function useCascade(workspaceId: string, viewedUserId?: string) {
  return useQuery({
    queryKey: ['issues', workspaceId, 'cascade', viewedUserId ?? 'me'],
    queryFn: ({ signal }) =>
      api.get<CascadeDto>(`/workspaces/${workspaceId}/cascade`, { query: { userId: viewedUserId }, signal }),
    enabled: Boolean(workspaceId),
    staleTime: 10_000,
  });
}

export interface HandoffItem {
  issueId: string;
  /** Who held the task when the sender looked at it, and its version then. */
  expectedAssigneeId: string | null;
  expectedUpdatedAt?: string;
}

/**
 * Hands tasks one step along the reporting line. No toasts here: the page
 * knows the names and words the result itself. Whatever the outcome, the lists
 * are read again — after a refusal the screen may be showing what is no
 * longer so.
 */
export function useHandoff(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { toUserId: string; items: HandoffItem[] }) =>
      api.post<{ updated: number }>(`/workspaces/${workspaceId}/cascade/handoff`, input),
    onSettled: (_result, _error, input) => {
      void queryClient.invalidateQueries({ queryKey: ['issues'] });
      void queryClient.invalidateQueries({ queryKey: qk.issuesByKey });
      for (const item of input.items) void queryClient.invalidateQueries({ queryKey: qk.issue(item.issueId) });
    },
  });
}
