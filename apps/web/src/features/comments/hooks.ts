import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CommentDto, CommentReactionDto } from '@flowdesk/contracts';
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
    mutationFn: ({ body, replyToId }: { body: unknown; replyToId?: string }) =>
      api.post<CommentDto>(`/issues/${issueId}/comments`, { body, replyToId }),
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

/**
 * Puts a reaction on a comment or takes it off. Shown at once — a press that
 * answers a second later does not feel like a reaction — and set right by the
 * server's answer, which also knows what others have pressed meanwhile.
 */
export function useToggleReaction(issueId: string, viewerName: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = qk.issueComments(issueId);
  const setReactions = (commentId: string, change: (reactions: CommentReactionDto[]) => CommentReactionDto[]) =>
    queryClient.setQueryData<CommentDto[]>(key, (list) =>
      list?.map((comment) => (comment.id === commentId ? { ...comment, reactions: change(comment.reactions) } : comment)),
    );

  return useMutation({
    mutationFn: ({ commentId, emoji }: { commentId: string; emoji: string }) =>
      api.post<{ reactions: CommentReactionDto[] }>(`/comments/${commentId}/reactions`, { emoji }),
    onMutate: async ({ commentId, emoji }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CommentDto[]>(key);
      setReactions(commentId, (reactions) => {
        const existing = reactions.find((reaction) => reaction.emoji === emoji);
        if (!existing) return [...reactions, { emoji, count: 1, mine: true, users: [viewerName] }];
        if (!existing.mine) {
          return reactions.map((reaction) =>
            reaction.emoji === emoji
              ? { ...reaction, count: reaction.count + 1, mine: true, users: [...reaction.users, viewerName] }
              : reaction,
          );
        }
        // Taken off; a sign nobody holds any more goes from the row.
        const own = existing.users.lastIndexOf(viewerName);
        return reactions
          .map((reaction) =>
            reaction.emoji === emoji
              ? {
                  ...reaction,
                  count: reaction.count - 1,
                  mine: false,
                  users: reaction.users.filter((_name, index) => index !== own),
                }
              : reaction,
          )
          .filter((reaction) => reaction.count > 0);
      });
      return { previous };
    },
    onSuccess: ({ reactions }, { commentId }) => setReactions(commentId, () => reactions),
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toast.error(error, 'Не удалось поставить реакцию');
    },
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
