import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssigneeStatsDto,
  DepartmentDto,
  DepartmentListDto,
  DepartmentPlaceDto,
  IssueSummaryDto,
  Paginated,
} from '@flowdesk/contracts';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { useToast } from '~/app/toast';
import { filtersToQuery, type IssueFilters } from '~/features/issues/types';

/** Departments the viewer may see: all of them for an administrator, otherwise the ones they lead. */
export function useDepartments(workspaceId: string | undefined) {
  return useQuery({
    queryKey: qk.departments(workspaceId ?? ''),
    queryFn: () => api.get<DepartmentListDto>(`/workspaces/${workspaceId}/departments`),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });
}

export interface DepartmentForm {
  /** Absent for a new department. */
  id?: string;
  name: string;
  leadId: string | null;
  memberIds: string[];
  /** Who is what and who reports to whom, by user id. */
  structure: DepartmentPlaceDto[];
}

export function useSaveDepartment(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ id, ...body }: DepartmentForm) =>
      id
        ? api.patch<DepartmentDto>(`/departments/${id}`, body)
        : api.post<DepartmentDto>(`/workspaces/${workspaceId}/departments`, body),
    onSuccess: (department, form) => {
      void queryClient.invalidateQueries({ queryKey: qk.departments(workspaceId) });
      // Lists and figures of a department follow who is in it — and so does
      // the distribution screen, which is built on who reports to whom.
      void queryClient.invalidateQueries({ queryKey: ['issues'] });
      toast.success(form.id ? `Отдел «${department.name}» сохранён` : `Отдел «${department.name}» создан`);
    },
    // The form shows the reason next to the field; a toast would say it twice.
  });
}

export function useDeleteDepartment(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (department: { id: string; name: string }) => api.delete<void>(`/departments/${department.id}`),
    onSuccess: (_data, department) => {
      void queryClient.invalidateQueries({ queryKey: qk.departments(workspaceId) });
      toast.success(`Отдел «${department.name}» удалён`);
    },
    onError: (error) => toast.error(error, 'Не удалось удалить отдел'),
  });
}

const PAGE_SIZE = 50;

/**
 * Tasks of a department's people, cut by the viewer's own project access. The
 * keys sit under the `issues` root, so whatever refreshes task lists — a
 * change made here, or one arriving over the realtime channel — refreshes them.
 */
export function useDepartmentIssues(departmentId: string | undefined, filters: IssueFilters) {
  return useInfiniteQuery({
    queryKey: ['issues', 'department', departmentId, 'list', filters],
    queryFn: ({ pageParam, signal }) =>
      api.get<Paginated<IssueSummaryDto>>(`/departments/${departmentId}/issues`, {
        query: { ...filtersToQuery(filters), limit: PAGE_SIZE, cursor: pageParam },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(departmentId),
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });
}

/** Active, overdue and due-soon figures for each person of the department. */
export function useDepartmentStats(departmentId: string | undefined, filters: IssueFilters = {}) {
  return useQuery({
    queryKey: ['issues', 'department', departmentId, 'stats', filters],
    queryFn: ({ signal }) =>
      api.get<{ items: AssigneeStatsDto[] }>(`/departments/${departmentId}/stats`, {
        query: filtersToQuery(filters),
        signal,
      }),
    enabled: Boolean(departmentId),
    staleTime: 10_000,
    placeholderData: (prev) => prev,
    select: (data) => new Map(data.items.map((item) => [item.userId, item])),
  });
}
