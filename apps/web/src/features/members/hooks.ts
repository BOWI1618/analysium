import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MemberDto, WorkspaceDto } from '@flowdesk/contracts';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { ROLE_LABEL } from '~/lib/labels';
import { useToast } from '~/app/toast';

export function useMembers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: qk.members(workspaceId ?? ''),
    queryFn: () => api.get<MemberDto[]>(`/workspaces/${workspaceId}/members`),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  });
}

export function useInviteMember(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: { email: string; role: string }) =>
      api.post<MemberDto>(`/workspaces/${workspaceId}/members`, input),
    onSuccess: (member) => {
      void queryClient.invalidateQueries({ queryKey: qk.members(workspaceId) });
      toast.success(`${member.user.email} добавлен(а)`, `Роль: ${ROLE_LABEL[member.role] ?? member.role}`);
    },
    onError: (error) => toast.error(error, 'Не удалось добавить участника'),
  });
}

export function useUpdateMemberRole(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: string }) =>
      api.patch<void>(`/workspaces/${workspaceId}/members/${memberId}`, { role }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.members(workspaceId) });
      toast.success('Роль обновлена');
    },
    onError: (error) => toast.error(error, 'Не удалось изменить роль'),
  });
}

export function useRemoveMember(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (memberId: string) => api.delete<void>(`/workspaces/${workspaceId}/members/${memberId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.members(workspaceId) });
      toast.success('Участник удалён');
    },
    onError: (error) => toast.error(error, 'Не удалось удалить участника'),
  });
}

export function useUpdateWorkspace(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (patch: { name?: string; logo?: string | null }) =>
      api.patch<WorkspaceDto>(`/workspaces/${workspaceId}`, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.session });
      void queryClient.invalidateQueries({ queryKey: qk.workspaces });
      toast.success('Пространство обновлено');
    },
    onError: (error) => toast.error(error, 'Не удалось обновить пространство'),
  });
}
