import { useMemo, useState } from 'react';
import type { IssueWatchersDto, UserSummaryDto, WatcherReason } from '@flowdesk/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Users, X } from 'lucide-react';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { useToast } from '~/app/toast';
import { Avatar } from '~/ui/Avatar';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '~/ui/Menu';

const REASON_LABEL: Record<WatcherReason, string> = {
  ASSIGNEE: 'исполнитель',
  REPORTER: 'автор',
  COMMENTER: 'участвует в обсуждении',
  SUBSCRIBED: 'подписан(а)',
};

export function useIssueWatchers(issueId: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.issueWatchers(issueId),
    queryFn: () => api.get<IssueWatchersDto>(`/issues/${issueId}/watchers`),
    enabled,
    staleTime: 10_000,
  });
}

/** Adds someone to the watchers of a task or takes their subscription away. */
export function useSetWatcher(issueId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: { userId: string; watching: boolean }) =>
      api.post<IssueWatchersDto>(`/issues/${issueId}/watchers`, input),
    onSuccess: (watchers) => {
      queryClient.setQueryData(qk.issueWatchers(issueId), watchers);
      // The card shows the count and whether the viewer is among them.
      void queryClient.invalidateQueries({ queryKey: qk.issue(issueId), exact: true });
      // The standalone task page reads through its own key.
      void queryClient.invalidateQueries({ queryKey: qk.issuesByKey });
    },
    onError: (error) => toast.error(error, 'Не удалось изменить наблюдателей'),
  });
}

/**
 * Who hears about the task, next to the eye that follows it for oneself.
 *
 * The list is everyone a change is announced to — the assignee, the author
 * and commenters as well as those who subscribed — so there is no second,
 * hidden audience. Only a subscription can be taken away from someone else:
 * the assignee hears about their own task whatever a colleague thinks.
 */
export function WatchersButton({
  issueId,
  count,
  candidates,
}: {
  issueId: string;
  count: number;
  /** People who can open the task: only they can be added. */
  candidates: UserSummaryDto[];
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const { data, isLoading } = useIssueWatchers(issueId, open);
  const setWatcher = useSetWatcher(issueId);

  const watching = useMemo(() => new Set((data?.items ?? []).map((item) => item.user.id)), [data]);
  const addable = useMemo(() => {
    const q = term.trim().toLowerCase();
    return candidates.filter(
      (user) =>
        !watching.has(user.id) && (!q || user.name.toLowerCase().includes(q) || user.email.toLowerCase().includes(q)),
    );
  }, [candidates, watching, term]);

  return (
    <Menu
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setTerm('');
      }}
    >
      <MenuTrigger>
        <button
          type="button"
          aria-label={`Наблюдатели: ${count}`}
          title="Наблюдатели: кто получает уведомления о задаче"
          className="inline-flex h-7 items-center gap-1 px-1.5 text-xs font-bold text-text-muted hover:bg-surface-hover hover:text-text"
        >
          <Users className="size-4" />
          <span className="fd-num">{count}</span>
        </button>
      </MenuTrigger>
      <MenuContent align="end" width={300} label="Наблюдатели задачи">
        <MenuLabel>Наблюдатели</MenuLabel>
        {isLoading || !data ? (
          <p className="px-2 py-3 text-center text-xs text-text-subtle">Загружаем…</p>
        ) : data.items.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-text-subtle">За задачей пока никто не следит</p>
        ) : (
          <ul aria-label="Кто следит за задачей">
            {data.items.map((item) => (
              <li key={item.user.id} className="flex items-center gap-2 px-2 py-1.5">
                <Avatar user={item.user} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.user.name}</span>
                  <span className="block truncate text-2xs text-text-subtle">
                    {item.reasons.map((reason) => REASON_LABEL[reason]).join(', ')}
                  </span>
                </span>
                {data.canManage && item.reasons.includes('SUBSCRIBED') && (
                  <button
                    type="button"
                    aria-label={`Убрать из наблюдателей: ${item.user.name}`}
                    disabled={setWatcher.isPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      setWatcher.mutate({ userId: item.user.id, watching: false });
                    }}
                    className="shrink-0 p-1 text-text-subtle hover:bg-surface-active hover:text-text"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {data?.canManage && (
          <>
            <MenuSeparator />
            <div className="mb-1 flex items-center gap-1.5 rounded-md border-2 border-border-strong bg-surface-sunken px-2 py-1">
              <Search className="size-3.5 shrink-0 text-text-subtle" />
              <input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Добавить наблюдателя…"
                aria-label="Добавить наблюдателя"
                className="w-full bg-transparent text-sm outline-none placeholder:text-text-subtle"
              />
            </div>
            {addable.length === 0 ? (
              <p className="px-2 py-2 text-center text-xs text-text-subtle">
                {term.trim() ? 'Никого не найдено' : 'Все, у кого есть доступ, уже следят'}
              </p>
            ) : (
              addable.slice(0, 8).map((user) => (
                <MenuItem
                  key={user.id}
                  keepOpen
                  icon={<Avatar user={user} size="sm" />}
                  disabled={setWatcher.isPending}
                  onSelect={() => setWatcher.mutate({ userId: user.id, watching: true })}
                >
                  {user.name}
                </MenuItem>
              ))
            )}
          </>
        )}
      </MenuContent>
    </Menu>
  );
}
