import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CommentDto } from '@flowdesk/contracts';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { useToast } from '~/app/toast';

export function useComments(issueId: string | null | undefined) {
  return useQuery({
    queryKey: qk.issueComments(issueId ?? ''),
    queryFn: () => api.get<CommentDto[]>(`/issues/${issueId}/comments`),
    enabled: Boolean(issueId),
    staleTime: 5_000,
  });
}

export function useCreateComment(issueId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (body: unknown) => api.post<CommentDto>(`/issues/${issueId}/comments`, { body }),
    onSuccess: (comment) => {
      queryClient.setQueryData<CommentDto[]>(qk.issueComments(issueId), (list) => [...(list ?? []), comment]);
      void queryClient.invalidateQueries({ queryKey: qk.issueActivity(issueId) });
      void queryClient.invalidateQueries({ queryKey: qk.issue(issueId) });
    },
    onError: (error) => toast.error(error, 'Не удалось отправить комментарий'),
  });
}

export function useUpdateComment(issueId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ commentId, body }: { commentId: string; body: unknown }) =>
      api.patch<CommentDto>(`/comments/${commentId}`, { body }),
    onSuccess: (comment) => {
      queryClient.setQueryData<CommentDto[]>(qk.issueComments(issueId), (list) =>
        list?.map((c) => (c.id === comment.id ? comment : c)),
      );
    },
    onError: (error) => toast.error(error, 'Не удалось сохранить комментарий'),
  });
}

export function useDeleteComment(issueId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (commentId: string) => api.delete<void>(`/comments/${commentId}`),
    onMutate: async (commentId) => {
      await queryClient.cancelQueries({ queryKey: qk.issueComments(issueId) });
      const previous = queryClient.getQueryData<CommentDto[]>(qk.issueComments(issueId));
      queryClient.setQueryData<CommentDto[]>(qk.issueComments(issueId), (list) =>
        list?.filter((c) => c.id !== commentId),
      );
      return { previous };
    },
    onError: (error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(qk.issueComments(issueId), context.previous);
      toast.error(error, 'Не удалось удалить комментарий');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.issueComments(issueId) });
      void queryClient.invalidateQueries({ queryKey: qk.issueActivity(issueId) });
    },
  });
}
