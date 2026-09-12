import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateSprintInput, SprintDto } from '@flowdesk/contracts';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { pluralize } from '~/lib/format';
import { useToast } from '~/app/toast';

export function useSprints(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.sprints(projectId ?? ''),
    queryFn: () => api.get<SprintDto[]>(`/projects/${projectId}/sprints`),
    enabled: Boolean(projectId),
    staleTime: 20_000,
  });
}

function useSprintMutation<TInput, TResult>(
  projectId: string,
  mutationFn: (input: TInput) => Promise<TResult>,
  messages: { success?: (result: TResult) => string; error: string },
) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['issues'] });
      if (messages.success) toast.success(messages.success(result));
    },
    onError: (error) => toast.error(error, messages.error),
  });
}

export function useCreateSprint(projectId: string) {
  return useSprintMutation(
    projectId,
    (input: CreateSprintInput) => api.post<SprintDto>(`/projects/${projectId}/sprints`, input),
    { success: (sprint) => `Спринт «${sprint.name}» создан`, error: 'Не удалось создать спринт' },
  );
}

export function useStartSprint(projectId: string) {
  return useSprintMutation(
    projectId,
    (sprintId: string) => api.post<SprintDto>(`/sprints/${sprintId}/start`),
    { success: (sprint) => `Спринт «${sprint.name}» запущен`, error: 'Не удалось запустить спринт' },
  );
}

export function useCompleteSprint(projectId: string) {
  return useSprintMutation(
    projectId,
    ({ sprintId, moveUnfinishedTo }: { sprintId: string; moveUnfinishedTo: string }) =>
      api.post<{ sprint: SprintDto; movedCount: number }>(`/sprints/${sprintId}/complete`, {
        moveUnfinishedTo,
      }),
    {
      success: (result) =>
        result.movedCount > 0
          ? `Спринт «${result.sprint.name}» завершён — перенесено ${pluralize(result.movedCount, ['задача', 'задачи', 'задач'])}`
          : `Спринт «${result.sprint.name}» завершён`,
      error: 'Не удалось завершить спринт',
    },
  );
}

export function useDeleteSprint(projectId: string) {
  return useSprintMutation(projectId, (sprintId: string) => api.delete<void>(`/sprints/${sprintId}`), {
    success: () => 'Спринт удалён',
    error: 'Не удалось удалить спринт',
  });
}
