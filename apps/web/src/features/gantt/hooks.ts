import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateDependencyInput,
  DependencyDto,
  GanttDto,
  IssueLinksDto,
  RescheduleResultDto,
} from '@flowdesk/contracts';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { useToast } from '~/app/toast';

export interface GanttFilters {
  includeDone?: boolean;
  assigneeId?: string[];
}

export function useGantt(projectId: string, filters: GanttFilters = {}) {
  return useQuery({
    queryKey: qk.gantt(projectId, filters),
    queryFn: () =>
      api.get<GanttDto>(`/projects/${projectId}/gantt`, {
        query: {
          includeDone: filters.includeDone ?? true,
          ...(filters.assigneeId?.length ? { assigneeId: filters.assigneeId.join(',') } : {}),
        },
      }),
    enabled: Boolean(projectId),
    staleTime: 10_000,
  });
}

/** Invalidates every view that shows scheduling, not just the chart. */
function invalidateSchedule(queryClient: ReturnType<typeof useQueryClient>, projectId: string) {
  void queryClient.invalidateQueries({ queryKey: qk.ganttRoot(projectId) });
  void queryClient.invalidateQueries({ queryKey: ['issues'] });
  void queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
  // The links listed in issue cards.
  void queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] === 'issue' && query.queryKey[2] === 'links',
  });
}

/** Dependencies of one issue, both directions, for its card. */
export function useIssueLinks(issueId: string) {
  return useQuery({
    queryKey: qk.issueLinks(issueId),
    queryFn: () => api.get<IssueLinksDto>(`/issues/${issueId}/links`),
    staleTime: 10_000,
  });
}

export function useRescheduleIssue(projectId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({
      issueId,
      startDate,
      dueDate,
      cascade,
    }: {
      issueId: string;
      startDate: string | null;
      dueDate: string | null;
      cascade?: boolean;
    }) =>
      api.post<RescheduleResultDto>(`/issues/${issueId}/reschedule`, {
        startDate,
        dueDate,
        cascade: cascade ?? false,
      }),
    onSuccess: (result) => {
      invalidateSchedule(queryClient, projectId);
      void queryClient.invalidateQueries({ queryKey: qk.issue(result.issue.id) });
      void queryClient.invalidateQueries({ queryKey: qk.issueActivity(result.issue.id) });
    },
    onError: (error) => toast.error(error, 'Не удалось перенести задачу'),
  });
}

export function useCreateDependency(projectId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: CreateDependencyInput) =>
      api.post<DependencyDto>(`/projects/${projectId}/dependencies`, input),
    onSuccess: () => {
      invalidateSchedule(queryClient, projectId);
      toast.success('Связь создана');
    },
    onError: (error) => toast.error(error, 'Не удалось создать связь'),
  });
}

export function useDeleteDependency(projectId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (dependencyId: string) => api.delete<void>(`/dependencies/${dependencyId}`),
    onSuccess: () => {
      invalidateSchedule(queryClient, projectId);
      toast.success('Связь удалена');
    },
    onError: (error) => toast.error(error, 'Не удалось удалить связь'),
  });
}
