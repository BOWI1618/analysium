import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SavedViewDisplay, SavedViewDto, SavedViewLayout } from '@flowdesk/contracts';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { useToast } from '~/app/toast';

export interface SavedViewInput {
  name: string;
  projectId?: string | null;
  layout: SavedViewLayout;
  filters: Record<string, unknown>;
  display?: SavedViewDisplay | null;
  isShared: boolean;
}

/** The viewer's own views and those shared with the team; narrowed to one screen where asked. */
export function useSavedViews(
  workspaceId: string | undefined,
  scope: { projectId?: string; layout?: SavedViewLayout } = {},
) {
  return useQuery({
    queryKey: [...qk.views(workspaceId ?? ''), scope.projectId ?? 'all', scope.layout ?? 'all'],
    queryFn: ({ signal }) =>
      api.get<SavedViewDto[]>(`/workspaces/${workspaceId}/views`, {
        query: { projectId: scope.projectId, layout: scope.layout },
        signal,
      }),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  });
}

export function useCreateSavedView(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: SavedViewInput) => api.post<SavedViewDto>(`/workspaces/${workspaceId}/views`, input),
    onSuccess: (view) => {
      void queryClient.invalidateQueries({ queryKey: qk.views(workspaceId) });
      toast.success(`Вид «${view.name}» сохранён`);
    },
    onError: (error) => toast.error(error, 'Не удалось сохранить вид'),
  });
}

export function useUpdateSavedView(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ viewId, patch }: { viewId: string; patch: Partial<Omit<SavedViewInput, 'layout' | 'projectId'>> }) =>
      api.patch<SavedViewDto>(`/views/${viewId}`, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.views(workspaceId) }),
    onError: (error) => toast.error(error, 'Не удалось изменить вид'),
  });
}

export function useDeleteSavedView(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (view: { id: string; name: string }) => api.delete<void>(`/views/${view.id}`),
    onSuccess: (_data, view) => {
      void queryClient.invalidateQueries({ queryKey: qk.views(workspaceId) });
      toast.success(`Вид «${view.name}» удалён`);
    },
    onError: (error) => toast.error(error, 'Не удалось удалить вид'),
  });
}
