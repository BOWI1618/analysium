import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';
import { CalendarDays, ListChecks, PanelRightOpen, Pencil } from 'lucide-react';
import {
  dayPlanDateSchema,
  docToText,
  EMPTY_DOC,
  Permission,
  sanitizeDoc,
  type DayPlanDraftDto,
  type DayPlansDto,
  type IssueSummaryDto,
  type RichDoc,
} from '@flowdesk/contracts';
import { useSession, useWorkspaceCan } from '~/app/session';
import { useToast } from '~/app/toast';
import { useUiStore } from '~/app/uiStore';
import { RichTextEditor, RichTextViewer } from '~/components/RichText';
import { issueByKeyQuery } from '~/features/issues/hooks';
import { useMembers } from '~/features/members/hooks';
import { useSearch } from '~/features/search/hooks';
import { api } from '~/lib/api';
import { useLeavePageGuard } from '~/lib/hooks/useLeavePageGuard';
import { Avatar } from '~/ui/Avatar';
import { Button } from '~/ui/Button';
import { EmptyState, ErrorState, SkeletonText } from '~/ui/Feedback';
import { Input } from '~/ui/Input';
import { Popover } from '~/ui/Popover';

const dateValue = (offset: number) => format(addDays(new Date(), offset), 'yyyy-MM-dd');
const planQueryKey = (workspaceId: string, date: string) => ['day-plans', workspaceId, date] as const;
const planEndpoint = (workspaceId: string, date: string) => `/workspaces/${workspaceId}/day-plans/${date}`;
const documentKey = (content: RichDoc) => JSON.stringify(sanitizeDoc(content));

function taskKeyFromLink(href: string) {
  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return;
    const key = /^\/issue\/([^/]+)\/?$/.exec(url.pathname)?.[1];
    if (key) return decodeURIComponent(key);
  } catch {
    return;
  }
}

export function DayPlanPage({ compose = false }: { compose?: boolean }) {
  const { user, workspace, workspaces, switchWorkspace } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const openIssue = useUiStore((state) => state.openIssue);
  const canWrite = useWorkspaceCan(Permission.ISSUE_ASSIGN);
  const [params, setParams] = useSearchParams();
  const requested = compose ? null : params.get('workspace');
  const workspaceId = requested ? workspaces.find(({ id }) => id === requested)?.id : workspace?.id;
  const dateParam = dayPlanDateSchema.safeParse(params.get('date'));
  const date = dateParam.success ? dateParam.data : dateValue(compose ? 1 : 0);
  const selectedId = params.get('plan');

  const openTaskLink = (href: string) => {
    const key = taskKeyFromLink(href);
    if (!workspaceId || !key) return false;
    void queryClient.fetchQuery(issueByKeyQuery(workspaceId, key)).then(
      (issue) => openIssue(issue.id),
      (error: unknown) => toast.error(error, 'Не удалось открыть задачу'),
    );
    return true;
  };

  useEffect(() => {
    if (requested && workspaceId && workspaceId !== workspace?.id) switchWorkspace(workspaceId);
  }, [requested, workspaceId, workspace?.id, switchWorkspace]);

  const query = useQuery({
    queryKey: planQueryKey(workspaceId ?? '', date),
    queryFn: ({ signal }) => api.get<DayPlansDto>(planEndpoint(workspaceId!, date), { signal }),
    enabled: Boolean(workspaceId),
    refetchInterval: compose ? false : 30_000,
  });

  const chooseDate = (next: string) => {
    if (next === date || !dayPlanDateSchema.safeParse(next).success) return;
    setParams((current) => {
      const changed = new URLSearchParams(current);
      changed.set('date', next);
      changed.delete('plan');
      return changed;
    });
  };

  const plans = query.data?.plans ?? [];
  const selected = plans.find((plan) => plan.id === selectedId);
  const visible = selected ? [selected, ...plans.filter((plan) => plan.id !== selected.id)] : plans;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-bg scrollbar-thin">
      <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="flex items-center gap-2 text-xl font-bold text-text">
            <CalendarDays className="size-5 text-accent" />
            План на день
          </h1>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-40">
              <Input label="Дата плана" type="date" value={date} onChange={(event) => chooseDate(event.target.value)} />
            </div>
            <Button variant={date === dateValue(0) ? 'subtle' : 'outline'} onClick={() => chooseDate(dateValue(0))}>Сегодня</Button>
            <Button variant={date === dateValue(1) ? 'subtle' : 'outline'} onClick={() => chooseDate(dateValue(1))}>Завтра</Button>
          </div>
        </header>

        {!workspaceId ? (
          <EmptyState title="Пространство недоступно" />
        ) : query.isPending ? (
          <SkeletonText lines={5} />
        ) : query.isError && !query.data ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <>
            {compose && canWrite && (
              <DayPlanEditor
                key={`${workspaceId}:${date}`}
                workspaceId={workspaceId}
                date={date}
                draft={query.data?.draft ?? null}
                openTaskLink={openTaskLink}
              />
            )}
            {selectedId && !selected && <p className="text-sm text-text-muted">Этот план больше недоступен.</p>}
            {visible.length === 0 && (
              <EmptyState icon={<CalendarDays className="size-5" />} title="На эту дату пока нет опубликованных планов" />
            )}
            {visible.map((plan) => (
              <article key={plan.id} className="border-2 border-border-strong bg-surface shadow-sm">
                <header className="flex items-center gap-2 border-b-2 border-border-strong bg-surface-raised px-4 py-2.5 text-sm font-bold">
                  <Avatar user={plan.author} size="sm" />
                  {plan.author.id === user?.id ? 'Мой опубликованный план' : plan.author.name}
                </header>
                <RichTextViewer value={plan.content} className="px-4 py-3" onLinkClick={openTaskLink} />
              </article>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function DayPlanEditor({ workspaceId, date, draft, openTaskLink }: {
  workspaceId: string;
  date: string;
  draft: DayPlanDraftDto | null;
  openTaskLink: (href: string) => boolean;
}) {
  const { data: members } = useMembers(workspaceId);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [edit, setEdit] = useState<{ content: RichDoc; revision: number | null } | null>(null);
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const saved = draft?.content ?? EMPTY_DOC;
  const content = edit?.content ?? saved;
  const contentKey = documentKey(content);
  const dirty = contentKey !== documentKey(saved);
  const changedSincePublication = !draft?.publishedContent || contentKey !== documentKey(draft.publishedContent);
  const canPublish = changedSincePublication && Boolean(docToText(content));
  const showEditor = expanded ?? changedSincePublication;
  const guard = useLeavePageGuard(dirty, true);

  const save = useMutation({
    onMutate: () => queryClient.cancelQueries({ queryKey: planQueryKey(workspaceId, date) }),
    mutationFn: (publish: boolean) => api.patch<DayPlanDraftDto>(planEndpoint(workspaceId, date), {
      content,
      revision: edit ? edit.revision : draft?.revision ?? null,
      publish,
    }),
    onSuccess: (result, publish) => {
      const key = planQueryKey(workspaceId, date);
      queryClient.setQueryData<DayPlansDto>(key, (data) => ({ plans: data?.plans ?? [], draft: result }));
      setEdit(null);
      if (publish) setExpanded(false);
      void queryClient.invalidateQueries({ queryKey: key });
      toast.success(publish ? 'План опубликован' : 'Черновик сохранён');
    },
    onError: (error) => toast.error(error, 'Не удалось сохранить план'),
  });

  if (!showEditor) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {dirty && <span className="text-xs text-text-muted">Есть несохранённые изменения</span>}
        <Button variant="outline" iconLeft={<Pencil className="size-3.5" />} onClick={() => setExpanded(true)}>
          {draft?.publishedContent && !changedSincePublication ? 'Изменить план' : 'Продолжить редактирование'}
        </Button>
        {guard.dialog}
      </div>
    );
  }

  return (
    <section className="space-y-3 border-2 border-border-strong bg-surface p-3 shadow-sm sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold">Мой план</h2>
          <p className="mt-1 text-xs text-text-muted">Пишите план списком или абзацами. Время можно добавить прямо в текст. Выберите человека через @, чтобы он получил уведомление при публикации.</p>
        </div>
        {draft?.publishedContent && (
          <Button variant="ghost" size="sm" disabled={save.isPending} onClick={() => setExpanded(false)}>Свернуть</Button>
        )}
      </div>
      <RichTextEditor
        value={content}
        onChange={(value) => setEdit((current) => ({ content: value as RichDoc, revision: current ? current.revision : draft?.revision ?? null }))}
        placeholder="Напишите план на выбранный день…"
        editorLabel="Текст плана"
        users={members?.map((member) => member.user)}
        minHeight="10rem"
        formatByLine
        onLinkClick={openTaskLink}
        autoFocus={expanded === true}
        editable={!save.isPending}
        renderLinkTool={(insert) => <TaskLinkPicker workspaceId={workspaceId} insert={insert} />}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={!dirty || save.isPending} onClick={() => save.mutate(false)}>Сохранить черновик</Button>
        <Button variant="primary" disabled={!canPublish || save.isPending} onClick={() => save.mutate(true)}>
          {draft?.publishedContent ? 'Опубликовать изменения' : 'Опубликовать'}
        </Button>
      </div>
      {guard.dialog}
    </section>
  );
}

function TaskLinkPicker({ workspaceId, insert }: { workspaceId: string; insert: (label: string, href: string) => void }) {
  const openIssue = useUiStore((state) => state.openIssue);
  return (
    <Popover
      label="Ссылка на задачу"
      width={280}
      trigger={({ open, toggle }) => (
        <Button variant="ghost" size="xs" onMouseDown={(event) => event.preventDefault()} onClick={toggle} aria-expanded={open}>
          <ListChecks className="size-3.5" /> Задача
        </Button>
      )}
    >
      {({ close }) => (
        <TaskLinkResults
          workspaceId={workspaceId}
          select={(issue) => {
            close();
            insert(issue.title, `/issue/${encodeURIComponent(issue.issueKey)}`);
          }}
          preview={(id) => {
            close();
            openIssue(id);
          }}
        />
      )}
    </Popover>
  );
}

function TaskLinkResults({ workspaceId, select, preview }: {
  workspaceId: string;
  select: (issue: IssueSummaryDto) => void;
  preview: (id: string) => void;
}) {
  const [term, setTerm] = useState('');
  const search = useSearch(workspaceId, term);
  const results = search.isTyping ? [] : search.data?.issues ?? [];

  return (
    <div className="space-y-2">
      <Input autoFocus label="Поиск задачи" placeholder="Номер или название" value={term} onChange={(event) => setTerm(event.target.value)} />
      {term.trim() && (
        <ul className="max-h-48 overflow-y-auto">
          {search.isError ? <li className="px-1 text-xs text-danger">Не удалось найти задачи</li> :
            search.isFetching || search.isTyping ? <li className="px-1 text-xs text-text-muted">Ищем…</li> :
              results.length === 0 ? <li className="px-1 text-xs text-text-muted">Задачи не найдены</li> :
                results.map((issue) => (
                  <li key={issue.id} className="flex items-center gap-1">
                    <button type="button" title={issue.title} onClick={() => select(issue)} className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-xs hover:bg-surface-hover">
                      {issue.title}
                    </button>
                    <button
                      type="button"
                      aria-label={`Открыть карточку: ${issue.title}`}
                      title="Открыть карточку"
                      onClick={() => preview(issue.id)}
                      className="shrink-0 p-1.5 text-text-muted hover:bg-surface-hover hover:text-text"
                    >
                      <PanelRightOpen className="size-3.5" />
                    </button>
                  </li>
                ))}
        </ul>
      )}
    </div>
  );
}
