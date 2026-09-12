import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SavedViewDto } from '@flowdesk/contracts';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { useToast } from '~/app/toast';

export function useSavedViews(workspaceId: string | undefined, projectId?: string) {
  return useQuery({
    queryKey: [...qk.views(workspaceId ?? ''), projectId ?? 'all'],
    queryFn: () =>
      api.get<SavedViewDto[]>(`/workspaces/${workspaceId}/views`, { query: { projectId } }),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  });
}

export function useCreateSavedView(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: {
      name: string;
      projectId?: string | null;
      layout: string;
      filters: Record<string, unknown>;
      isShared: boolean;
    }) => api.post<SavedViewDto>(`/workspaces/${workspaceId}/views`, input),
    onSuccess: (view) => {
      void queryClient.invalidateQueries({ queryKey: qk.views(workspaceId) });
      toast.success(`Вид «${view.name}» сохранён`);
    },
    onError: (error) => toast.error(error, 'Не удалось сохранить вид'),
  });
}
