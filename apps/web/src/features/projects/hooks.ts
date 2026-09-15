import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateProjectInput,
  CreateStatusInput,
  LabelDto,
  ProjectDetailDto,
  ProjectDto,
  StatusDto,
} from '@flowdesk/contracts';
import { Permission } from '@flowdesk/contracts';
import { api } from '~/lib/api';
import { useWorkspaceCan } from '~/app/session';
import { qk } from '~/lib/queryKeys';
import { useToast } from '~/app/toast';

/**
 * Projects of a workspace.
 *
 * The list of tasks without a project comes back from the API alongside the
 * projects but is filtered out here unless asked for: it is not a project to
 * anyone, and every place that lists or counts projects would otherwise have
 * to remember to drop it. Only the sidebar and quick-create ask for it.
 */
export function useProjects(workspaceId: string, includeArchived = false, options: { includeSystem?: boolean } = {}) {
  const includeSystem = options.includeSystem ?? false;
  return useQuery({
    queryKey: [...qk.projects(workspaceId), includeArchived],
    queryFn: () =>
      api.get<ProjectDto[]>(`/workspaces/${workspaceId}/projects`, {
        query: { includeArchived: includeArchived || undefined },
      }),
    select: includeSystem ? undefined : (projects) => projects.filter((p) => !p.isSystem),
    staleTime: 30_000,
  });
}

export function useProject(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.project(projectId ?? ''),
    queryFn: () => api.get<ProjectDetailDto>(`/projects/${projectId}`),
    enabled: Boolean(projectId),
    staleTime: 20_000,
  });
}

/**
 * Whether «create task» should be offered: anywhere for members, and inside a
 * project where a guest has been given a role that allows it. Guests used to
 * get the button everywhere and an error on submit.
 */
export function useCanCreateIssue(projectId?: string): boolean {
  const workspaceCan = useWorkspaceCan(Permission.ISSUE_CREATE);
  const { data: project } = useProject(workspaceCan ? undefined : projectId);
  return workspaceCan || Boolean(project?.permissions.includes(Permission.ISSUE_CREATE));
}

export function useCreateProject(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      api.post<ProjectDetailDto>(`/workspaces/${workspaceId}/projects`, input),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: qk.projects(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: qk.session });
      toast.success(`Проект «${project.name}» создан`, `Ключ проекта: ${project.key}`);
    },
    onError: (error) => toast.error(error, 'Не удалось создать проект'),
  });
}

export function useUpdateProject(projectId: string, workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api.patch<ProjectDetailDto>(`/projects/${projectId}`, patch),
    onSuccess: (project) => {
      queryClient.setQueryData(qk.project(projectId), project);
      void queryClient.invalidateQueries({ queryKey: qk.projects(workspaceId) });
    },
    onError: (error) => toast.error(error, 'Не удалось обновить проект'),
  });
}

export function useDeleteProject(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (projectId: string) => api.delete<void>(`/projects/${projectId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.projects(workspaceId) });
      toast.success('Проект удалён');
    },
    onError: (error) => toast.error(error, 'Не удалось удалить проект'),
  });
}

export function useToggleFavorite(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) =>
      api.post<{ isFavorite: boolean }>(`/projects/${projectId}/favorite`),
    // Optimistic: starring should feel instant.
    onMutate: async (projectId) => {
      await queryClient.cancelQueries({ queryKey: qk.projects(workspaceId) });
      const previous = queryClient.getQueriesData<ProjectDto[]>({ queryKey: qk.projects(workspaceId) });
      queryClient.setQueriesData<ProjectDto[]>({ queryKey: qk.projects(workspaceId) }, (list) =>
        list?.map((p) => (p.id === projectId ? { ...p, isFavorite: !p.isFavorite } : p)),
      );
      return { previous };
    },
    onError: (_error, _projectId, context) => {
      context?.previous?.forEach(([key, value]) => queryClient.setQueryData(key, value));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: qk.projects(workspaceId) }),
  });
}

/* --------------------------------------------------------------- workflow */

export function useCreateStatus(projectId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: CreateStatusInput) => api.post<StatusDto>(`/projects/${projectId}/statuses`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      toast.success('Статус добавлен');
    },
    onError: (error) => toast.error(error, 'Не удалось добавить статус'),
  });
}

export function useUpdateStatus(projectId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ statusId, patch }: { statusId: string; patch: Record<string, unknown> }) =>
      api.patch<StatusDto>(`/projects/${projectId}/statuses/${statusId}`, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
    onError: (error) => toast.error(error, 'Не удалось обновить статус'),
  });
}

export function useDeleteStatus(projectId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ statusId, moveTo }: { statusId: string; moveTo?: string }) =>
      api.delete<void>(`/projects/${projectId}/statuses/${statusId}`, { query: { moveTo } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      toast.success('Статус удалён', 'Задачи перенесены в другую колонку');
    },
    onError: (error) => toast.error(error, 'Не удалось удалить статус'),
  });
}

export function useReorderStatuses(projectId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (statusIds: string[]) =>
      api.post<void>(`/projects/${projectId}/statuses/reorder`, { statusIds }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
    onError: (error) => toast.error(error, 'Не удалось изменить порядок статусов'),
  });
}

/* ----------------------------------------------------------------- labels */

export function useCreateLabel(projectId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: { name: string; color: string }) =>
      api.post<LabelDto>(`/projects/${projectId}/labels`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.labels(projectId) });
      void queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
    },
    onError: (error) => toast.error(error, 'Не удалось создать метку'),
  });
}

/** A label for tasks without a project; their list is created if it does not exist yet. */
export function useCreateProjectlessLabel(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: { name: string; color: string }) =>
      api.post<LabelDto & { projectId: string }>(`/workspaces/${workspaceId}/projectless/labels`, input),
    onSuccess: (label) => {
      void queryClient.invalidateQueries({ queryKey: qk.projects(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: qk.labels(label.projectId) });
      void queryClient.invalidateQueries({ queryKey: qk.project(label.projectId) });
    },
    onError: (error) => toast.error(error, 'Не удалось создать метку'),
  });
}

const LABEL_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#14b8a6', '#ef4444', '#22c55e', '#64748b'];

/** Colour for a label added from the label list: the next one not yet in use. */
export function nextLabelColor(existing: { color: string }[]): string {
  const used = new Set(existing.map((l) => l.color.toLowerCase()));
  return LABEL_COLORS.find((c) => !used.has(c)) ?? LABEL_COLORS[existing.length % LABEL_COLORS.length]!;
}

export function useUpdateLabel(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ labelId, patch }: { labelId: string; patch: { name?: string; color?: string } }) =>
      api.patch<LabelDto>(`/projects/${projectId}/labels/${labelId}`, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.labels(projectId) });
      void queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
    },
  });
}

export function useDeleteLabel(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (labelId: string) => api.delete<void>(`/projects/${projectId}/labels/${labelId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.labels(projectId) });
      void queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
    },
  });
}

/* ---------------------------------------------------------- project members */

export function useAddProjectMember(projectId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: { userId: string; role: string }) =>
      api.post<void>(`/projects/${projectId}/members`, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.project(projectId) }),
    onError: (error) => toast.error(error, 'Не удалось добавить участника'),
  });
}

export function useRemoveProjectMember(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.delete<void>(`/projects/${projectId}/members/${userId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.project(projectId) }),
  });
}
