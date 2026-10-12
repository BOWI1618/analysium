import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateRoleInput, RoleDto, UpdateRoleInput } from '@flowdesk/contracts';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { useToast } from '~/app/toast';

/** Roles of the workspace's own making — next to the built-in ones, which are not stored. */
export function useRoles(workspaceId: string) {
  return useQuery({
    queryKey: qk.roles(workspaceId),
    queryFn: () => api.get<RoleDto[]>(`/workspaces/${workspaceId}/roles`),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });
}

/**
 * A change to a role is a change for everyone who holds it: what they may do,
 * and with «только свои проекты» how far they see. Everything that shows a
 * role or depends on one is asked again.
 */
function useAfterRoleChange(workspaceId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.roles(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: qk.members(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: qk.inviteCodes(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: qk.session });
    void queryClient.invalidateQueries({ queryKey: ['project'] });
  };
}

export function useCreateRole(workspaceId: string) {
  const toast = useToast();
  const after = useAfterRoleChange(workspaceId);
  return useMutation({
    mutationFn: (input: CreateRoleInput) => api.post<RoleDto>(`/workspaces/${workspaceId}/roles`, input),
    onSuccess: (role) => {
      after();
      toast.success(`Роль «${role.name}» создана`, 'Теперь её можно выдать в списке участников.');
    },
    onError: (error) => toast.error(error, 'Не удалось создать роль'),
  });
}

export function useUpdateRole(workspaceId: string) {
  const toast = useToast();
  const after = useAfterRoleChange(workspaceId);
  return useMutation({
    mutationFn: ({ roleId, patch }: { roleId: string; patch: UpdateRoleInput }) =>
      api.patch<RoleDto>(`/workspaces/${workspaceId}/roles/${roleId}`, patch),
    onSuccess: (role) => {
      after();
      toast.success(`Роль «${role.name}» сохранена`, role.memberCount > 0 ? 'Изменения уже действуют для всех, у кого она есть.' : undefined);
    },
    onError: (error) => toast.error(error, 'Не удалось сохранить роль'),
  });
}

export function useDeleteRole(workspaceId: string) {
  const toast = useToast();
  const after = useAfterRoleChange(workspaceId);
  return useMutation({
    mutationFn: (roleId: string) => api.delete<void>(`/workspaces/${workspaceId}/roles/${roleId}`),
    onSuccess: () => {
      after();
      toast.success('Роль удалена');
    },
    onError: (error) => toast.error(error, 'Не удалось удалить роль'),
  });
}
