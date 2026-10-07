import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  IssuePriority,
  IssueRecurrence,
  IssueTemplateDto,
  IssueTemplateListDto,
  IssueType,
} from '@flowdesk/contracts';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { useToast } from '~/app/toast';

/** Templates of the workspace: everyone uses them, its administrators keep them. */
export function useIssueTemplates(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.issueTemplates(workspaceId ?? ''),
    queryFn: ({ signal }) => api.get<IssueTemplateListDto>(`/workspaces/${workspaceId}/issue-templates`, { signal }),
    enabled: enabled && Boolean(workspaceId),
    staleTime: 60_000,
  });
}

export interface IssueTemplateForm {
  /** Absent for a new template. */
  id?: string;
  name: string;
  title: string;
  description: unknown;
  type: IssueType;
  priority: IssuePriority;
  /** Days from the day the task is created to its deadline; `null` — no deadline. */
  dueInDays: number | null;
  storyPoints: number | null;
  recurrence: IssueRecurrence | null;
  subtasks: string[];
  watcherIds: string[];
}

export function useSaveIssueTemplate(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...body }: IssueTemplateForm) =>
      id
        ? api.patch<IssueTemplateDto>(`/issue-templates/${id}`, body)
        : api.post<IssueTemplateDto>(`/workspaces/${workspaceId}/issue-templates`, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.issueTemplates(workspaceId) }),
    // Whoever calls decides how to say it: the form shows a taken name at its field.
  });
}

export function useDeleteIssueTemplate(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (template: { id: string; name: string }) => api.delete<void>(`/issue-templates/${template.id}`),
    onSuccess: (_data, template) => {
      void queryClient.invalidateQueries({ queryKey: qk.issueTemplates(workspaceId) });
      toast.success(`Шаблон «${template.name}» удалён`);
    },
    onError: (error) => toast.error(error, 'Не удалось удалить шаблон'),
  });
}
