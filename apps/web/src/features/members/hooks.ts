import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreatedInviteCodeDto, InviteCodeDto, MemberDto, WorkspaceDto } from '@flowdesk/contracts';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { useToast } from '~/app/toast';

export function useMembers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: qk.members(workspaceId ?? ''),
    queryFn: () => api.get<MemberDto[]>(`/workspaces/${workspaceId}/members`),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  });
}

export function useInviteCodes(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.inviteCodes(workspaceId ?? ''),
    queryFn: () => api.get<InviteCodeDto[]>(`/workspaces/${workspaceId}/invite-codes`),
    enabled: Boolean(workspaceId) && enabled,
  });
}

export function useCreateInviteCode(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (role: string) =>
      api.post<CreatedInviteCodeDto>(`/workspaces/${workspaceId}/invite-codes`, { role }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.inviteCodes(workspaceId) }),
    onError: (error) => toast.error(error, 'Не удалось создать код'),
  });
}

export function useRevokeInviteCode(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (codeId: string) => api.delete<void>(`/workspaces/${workspaceId}/invite-codes/${codeId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.inviteCodes(workspaceId) });
      toast.success('Код отозван', 'Войти по нему больше нельзя.');
    },
    onError: (error) => toast.error(error, 'Не удалось отозвать код'),
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
