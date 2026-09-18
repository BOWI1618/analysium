import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import type {
  CreateIssueRequest,
  DuplicateIssueInput,
  IssueDetailDto,
  IssueSummaryDto,
  MoveIssueInput,
  Paginated,
  UpdateIssueInput,
} from '@flowdesk/contracts';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { pluralize } from '~/lib/format';
import { useToast } from '~/app/toast';
import { filtersToQuery, type BoardDto, type IssueFilters } from './types';

const PAGE_SIZE = 50;

/* ------------------------------------------------------------------ read */

export function useBoard(projectId: string | undefined, filters: IssueFilters) {
  return useQuery({
    queryKey: qk.board(projectId ?? '', filters),
    queryFn: () =>
      api.get<BoardDto>(`/projects/${projectId}/board`, { query: filtersToQuery(filters) }),
    enabled: Boolean(projectId),
    staleTime: 10_000,
    // Keeps the previous board visible while a filter change loads.
    placeholderData: (prev) => prev,
  });
}

/** Paginated issue list — used by List view, backlog and My Work. */
export function useIssueList(
  scope: { workspaceId?: string; projectId?: string },
  filters: IssueFilters,
  options: { enabled?: boolean; limit?: number; refetchInterval?: number | false } = {},
) {
  const path = scope.projectId
    ? `/projects/${scope.projectId}/issues`
    : `/workspaces/${scope.workspaceId}/issues`;
  const scopeKey = scope.projectId ?? scope.workspaceId ?? '';

  return useInfiniteQuery({
    queryKey: qk.issues(scopeKey, filters),
    queryFn: ({ pageParam }) =>
      api.get<Paginated<IssueSummaryDto>>(path, {
        query: { ...filtersToQuery(filters), limit: options.limit ?? PAGE_SIZE, cursor: pageParam },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: (options.enabled ?? true) && Boolean(scopeKey),
    staleTime: 10_000,
    refetchInterval: options.refetchInterval,
    placeholderData: (prev) => prev,
  });
}

/** Flattens infinite-query pages into one array. */
export function flattenPages(data: InfiniteData<Paginated<IssueSummaryDto>> | undefined): IssueSummaryDto[] {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

export function useIssue(issueId: string | null | undefined) {
  return useQuery({
    queryKey: qk.issue(issueId ?? ''),
    queryFn: () => api.get<IssueDetailDto>(`/issues/${issueId}`),
    enabled: Boolean(issueId),
    staleTime: 5_000,
  });
}

export function useIssueByKey(workspaceId: string, issueKey: string | undefined) {
  return useQuery({
    queryKey: qk.issueByKey(workspaceId, issueKey),
    queryFn: () => api.get<IssueDetailDto>(`/workspaces/${workspaceId}/issues/by-key/${issueKey}`),
    enabled: Boolean(issueKey),
  });
}

export function useIssueActivity(issueId: string | null | undefined) {
  return useQuery({
    queryKey: qk.issueActivity(issueId ?? ''),
    queryFn: () => api.get<import('@flowdesk/contracts').ActivityDto[]>(`/issues/${issueId}/activity`),
    enabled: Boolean(issueId),
    staleTime: 5_000,
  });
}

/* ----------------------------------------------------------------- write */

/** Invalidates everything that can display an issue. */
function invalidateIssueViews(queryClient: ReturnType<typeof useQueryClient>, projectId?: string) {
  void queryClient.invalidateQueries({ queryKey: ['issues'] });
  // The /issue/:key page hangs off its own root and is easy to forget; without
  // this the tab that made the change is the one left showing stale data,
  // because it skips its own realtime echo by design.
  void queryClient.invalidateQueries({ queryKey: qk.issuesByKey });
  if (projectId) void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
  else void queryClient.invalidateQueries({ queryKey: ['project'] });
}

export function useCreateIssue() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: CreateIssueRequest) => api.post<IssueDetailDto>('/issues', input),
    onSuccess: (issue) => {
      queryClient.setQueryData(qk.issue(issue.id), issue);
      invalidateIssueViews(queryClient, issue.projectId);
      if (issue.parent) void queryClient.invalidateQueries({ queryKey: qk.issue(issue.parent.id), exact: true });
      // The first task without a project creates that list on the server; the
      // sidebar learns about it (and its count moves) through the project list.
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'workspace' && query.queryKey[2] === 'projects',
      });
    },
    onError: (error) => toast.error(error, 'Не удалось создать задачу'),
  });
}

/** Moves an issue, with its subtasks, to another project; it gets a new key there. */
export function useTransferIssue(issueId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (projectId: string) => api.post<IssueDetailDto>(`/issues/${issueId}/transfer`, { projectId }),
    onSuccess: (issue) => {
      const before = queryClient.getQueryData<IssueDetailDto>(qk.issue(issueId));
      queryClient.setQueryData(qk.issue(issueId), issue);
      if (before) invalidateIssueViews(queryClient, before.projectId);
      invalidateIssueViews(queryClient, issue.projectId);
      void queryClient.invalidateQueries({ queryKey: qk.issueActivity(issueId) });
      // Open-issue counts in the sidebar move with it.
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'workspace' && query.queryKey[2] === 'projects',
      });
      toast.success(`Задача перенесена в «${issue.project.name}»`, `Новый номер: ${issue.issueKey}`);
    },
    onError: (error) => toast.error(error, 'Не удалось перенести задачу'),
  });
}

/** Follow a task, or stop hearing about one you take part in. */
export function useWatchIssue(issueId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (watching: boolean) => api.post<{ watching: boolean }>(`/issues/${issueId}/watch`, { watching }),
    onSuccess: ({ watching }) => {
      queryClient.setQueryData<IssueDetailDto>(qk.issue(issueId), (issue) => (issue ? { ...issue, watching } : issue));
      toast.success(
        watching ? 'Вы следите за задачей' : 'Вы больше не следите за задачей',
        watching
          ? 'Придут уведомления о статусе, сроке и комментариях.'
          : 'Упоминания и назначения на вас по-прежнему придут.',
      );
    },
    onError: (error) => toast.error(error, 'Не удалось изменить подписку'),
  });
}

/** «Дублировать задачу»: a copy in the same project; opens once it exists. */
export function useDuplicateIssue(issueId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: DuplicateIssueInput) => api.post<IssueDetailDto>(`/issues/${issueId}/duplicate`, input),
    onSuccess: (copy) => {
      queryClient.setQueryData(qk.issue(copy.id), copy);
      invalidateIssueViews(queryClient, copy.projectId);
      if (copy.parent) void queryClient.invalidateQueries({ queryKey: qk.issue(copy.parent.id), exact: true });
      toast.success('Задача продублирована', `Копия: ${copy.issueKey}`);
    },
    onError: (error) => toast.error(error, 'Не удалось продублировать задачу'),
  });
}

/**
 * Inline field edits. Applies an optimistic patch to the cached issue detail,
 * then reconciles with the server response; board and list views catch up
 * through the invalidation in onSuccess.
 */
export function useUpdateIssue(issueId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (patch: UpdateIssueInput) => api.patch<IssueDetailDto>(`/issues/${issueId}`, patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: qk.issue(issueId) });
      const previous = queryClient.getQueryData<IssueDetailDto>(qk.issue(issueId));

      if (previous) {
        queryClient.setQueryData<IssueDetailDto>(qk.issue(issueId), {
          ...previous,
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.priority !== undefined ? { priority: patch.priority as never } : {}),
          ...(patch.type !== undefined ? { type: patch.type as never } : {}),
          ...(patch.storyPoints !== undefined ? { storyPoints: patch.storyPoints } : {}),
          ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate, dueHasTime: Boolean(patch.dueDate && patch.dueHasTime) } : {}),
          ...(patch.startDate !== undefined
            ? { startDate: patch.startDate, startHasTime: Boolean(patch.startDate && patch.startHasTime) }
            : {}),
        });
      }

      return { previous };
    },
    onError: (error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(qk.issue(issueId), context.previous);
      toast.error(error, 'Не удалось сохранить изменение');
    },
    onSuccess: (issue, _patch, context) => {
      queryClient.setQueryData(qk.issue(issue.id), issue);
      invalidateIssueViews(queryClient, issue.projectId);
      void queryClient.invalidateQueries({ queryKey: qk.issueActivity(issue.id) });
      // The parent's detail lists this subtask — in its panel and unfolded in
      // lists. Both parents when it was moved or detached.
      for (const parent of [issue.parent, context?.previous?.parent]) {
        if (parent) void queryClient.invalidateQueries({ queryKey: qk.issue(parent.id), exact: true });
      }
    },
  });
}

/**
 * Drag & drop move. The board cache is rewritten immediately so the card stays
 * under the cursor; a failure rolls the whole board back and explains why.
 */
export function useMoveIssue(projectId: string, filters: IssueFilters) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const boardKey = qk.board(projectId, filters);

  return useMutation({
    mutationFn: ({ issueId, ...input }: MoveIssueInput & { issueId: string }) =>
      api.post<IssueSummaryDto>(`/issues/${issueId}/move`, input),

    onMutate: async ({ issueId, statusId, beforeId, afterId }) => {
      await queryClient.cancelQueries({ queryKey: boardKey });
      const previous = queryClient.getQueryData<BoardDto>(boardKey);
      if (!previous) return { previous };

      const source = previous.columns.find((c) => c.issues.some((i) => i.id === issueId));
      const issue = source?.issues.find((i) => i.id === issueId);
      if (!issue || !source) return { previous };

      const targetStatusId = statusId ?? issue.statusId;

      const columns = previous.columns.map((column) => {
        if (column.status.id === source.status.id && column.status.id !== targetStatusId) {
          return {
            ...column,
            issues: column.issues.filter((i) => i.id !== issueId),
            total: column.total - 1,
          };
        }
        if (column.status.id !== targetStatusId) return column;

        const withoutIssue = column.issues.filter((i) => i.id !== issueId);
        const moved: IssueSummaryDto = { ...issue, statusId: targetStatusId, status: column.status };

        // Reinsert at the drop position implied by the neighbour ids.
        let index = withoutIssue.length;
        if (afterId) {
          const at = withoutIssue.findIndex((i) => i.id === afterId);
          if (at >= 0) index = at;
        } else if (beforeId) {
          const at = withoutIssue.findIndex((i) => i.id === beforeId);
          if (at >= 0) index = at + 1;
        } else {
          index = 0;
        }

        const next = [...withoutIssue];
        next.splice(index, 0, moved);
        return {
          ...column,
          issues: next,
          total: column.status.id === source.status.id ? column.total : column.total + 1,
        };
      });

      queryClient.setQueryData<BoardDto>(boardKey, { columns });
      return { previous };
    },

    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(boardKey, context.previous);
      toast.error(error, 'Не удалось переместить задачу');
    },

    onSuccess: (issue) => {
      queryClient.setQueryData(qk.issue(issue.id), (old: IssueDetailDto | undefined) =>
        old ? { ...old, ...issue } : old,
      );
      void queryClient.invalidateQueries({ queryKey: qk.issueActivity(issue.id) });
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['issues'] });
    },
  });
}

/**
 * Patches an arbitrary issue by id. Drag-and-drop handlers cannot call a hook
 * per issue, so views that mutate many different issues (calendar, list rows)
 * use this single mutation and pass the id in.
 */
export function usePatchIssue() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ issueId, patch }: { issueId: string; patch: UpdateIssueInput }) =>
      api.patch<IssueDetailDto>(`/issues/${issueId}`, patch),
    onSuccess: (issue) => {
      queryClient.setQueryData(qk.issue(issue.id), issue);
      invalidateIssueViews(queryClient, issue.projectId);
      void queryClient.invalidateQueries({ queryKey: qk.issueActivity(issue.id) });
      // The parent's detail lists this subtask — in its panel and unfolded in lists.
      if (issue.parent) void queryClient.invalidateQueries({ queryKey: qk.issue(issue.parent.id), exact: true });
    },
    onError: (error) => toast.error(error, 'Не удалось сохранить изменение'),
  });
}

export function useBulkUpdate(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: {
      issueIds: string[];
      patch: Record<string, unknown>;
    }) => api.post<{ updated: number }>(`/workspaces/${workspaceId}/issues/bulk`, input),
    onSuccess: (result) => {
      invalidateIssueViews(queryClient);
      toast.success(`Обновлено ${pluralize(result.updated, ['задача', 'задачи', 'задач'])}`);
    },
    onError: (error) => toast.error(error, 'Не удалось обновить задачи'),
  });
}

export function useDeleteIssue() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (issue: { id: string; projectId: string; issueKey: string }) =>
      api.delete<void>(`/issues/${issue.id}`),
    onSuccess: (_data, issue) => {
      queryClient.removeQueries({ queryKey: qk.issue(issue.id) });
      invalidateIssueViews(queryClient, issue.projectId);
      toast.success(`${issue.issueKey} удалена`);
    },
    onError: (error) => toast.error(error, 'Не удалось удалить задачу'),
  });
}

/* ----------------------------------------------------------- attachments */

export function useUploadAttachment(issueId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.upload<import('@flowdesk/contracts').AttachmentDto>(
        `/issues/${issueId}/attachments`,
        formData,
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.issue(issueId) });
      void queryClient.invalidateQueries({ queryKey: qk.issueActivity(issueId) });
    },
    onError: (error) => toast.error(error, 'Не удалось загрузить файл'),
  });
}

export function useDeleteAttachment(issueId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (attachmentId: string) => api.delete<void>(`/attachments/${attachmentId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.issue(issueId) });
      void queryClient.invalidateQueries({ queryKey: qk.issueActivity(issueId) });
    },
    onError: (error) => toast.error(error, 'Не удалось удалить файл'),
  });
}
