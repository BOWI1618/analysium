import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import { useSession } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import { useMembers } from '~/features/members/hooks';
import { useProject, useProjects } from '~/features/projects/hooks';
import { flattenPages, useAssigneeStats, useIssueList } from '~/features/issues/hooks';
import { useFilterState } from '~/features/issues/useFilterState';
import { viewSearchParams } from '~/features/views/viewState';
import { SavedViews } from '~/components/SavedViews';
import type { IssueFilters } from '~/features/issues/types';
import { Topbar } from '~/components/Topbar';
import { FilterBar } from '~/components/FilterBar';
import { IssueRow, IssueRowHeader, listMinStyle, type ListColumn } from '~/components/IssueRow';
import { UserPicker } from '~/components/Pickers';
import { Avatar } from '~/ui/Avatar';
import { Badge } from '~/ui/Badge';
import { Button } from '~/ui/Button';
import { EmptyState, ErrorState, SkeletonRows, StaleNotice } from '~/ui/Feedback';
import { pluralize } from '~/lib/format';

type View = 'active' | 'overdue' | 'done' | 'all';

const VIEWS: { value: View; label: string }[] = [
  { value: 'active', label: 'Активные' },
  { value: 'overdue', label: 'Просроченные' },
  { value: 'done', label: 'Завершённые' },
  { value: 'all', label: 'Все' },
];

const isView = (value: string | null): value is View => VIEWS.some((item) => item.value === value);

const EMPTY: Record<View, { title: string; description: string }> = {
  active: { title: 'Активных задач нет', description: 'На этого человека сейчас ничего не назначено — или фильтры скрыли всё.' },
  overdue: { title: 'Просроченных задач нет', description: 'Со сроками всё в порядке.' },
  done: { title: 'Завершённых задач нет', description: 'Здесь соберутся закрытые задачи, свежие сверху.' },
  all: { title: 'Задач нет', description: 'На этого человека ничего не назначено в доступных вам проектах.' },
};

/**
 * Everything assigned to one person across the projects the viewer may open.
 *
 * The person is chosen in the header and named in it — the same list used to
 * be reachable only through a filter on «Мои задачи», under a heading that
 * still said the tasks were the viewer's own.
 */
export function EmployeeWorkPage() {
  const { user, workspace } = useSession();
  const openIssue = useUiStore((s) => s.openIssue);
  const workspaceId = workspace?.id ?? '';

  // Person, view and filters all live in the address: a link to «просроченные
  // задачи Марии в проекте X» can be sent to someone as it is.
  const [searchParams, setSearchParams] = useSearchParams();
  const setParam = (key: string, value: string | null) =>
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        if (value) params.set(key, value);
        else params.delete(key);
        return params;
      },
      { replace: true },
    );

  const { data: members } = useMembers(workspaceId);
  const { data: projects } = useProjects(workspaceId);
  const people = useMemo(() => (members ?? []).map((member) => member.user), [members]);

  const userId = searchParams.get('user') || user?.id || '';
  const person = people.find((candidate) => candidate.id === userId);
  const isMe = userId === user?.id;
  const viewParam = searchParams.get('view');
  const view: View = isView(viewParam) ? viewParam : 'active';

  const [barFilters, setBarFilters] = useFilterState();
  // Whose tasks these are is decided by the header alone; an assignee left in
  // the address by another screen must not quietly swap the person.
  const chosen = useMemo(() => {
    const rest: IssueFilters = { ...barFilters };
    delete rest.assigneeId;
    delete rest.sort;
    delete rest.order;
    return rest;
  }, [barFilters]);

  // Statuses belong to a project, so a particular one can be picked only once
  // the list is narrowed to a single project; across projects it is the state.
  const onlyProjectId = chosen.projectId?.length === 1 ? chosen.projectId[0] : undefined;
  const { data: onlyProject } = useProject(onlyProjectId);

  const listFilters = useMemo<IssueFilters>(() => {
    const base: IssueFilters = { ...chosen, assigneeId: [userId], includeSubtasks: true, sort: 'dueDate', order: 'asc' };
    switch (view) {
      case 'active':
        return { ...base, includeDone: false };
      case 'overdue':
        return { ...base, isOverdue: true };
      case 'done': {
        // «Завершённые» within the chosen states: nothing, if those leave the
        // finished ones out — an unknown state narrows the list to empty.
        const states = chosen.statusCategory;
        const finished = !states?.length || states.includes('COMPLETED');
        return { ...base, statusCategory: [finished ? 'COMPLETED' : 'NONE'], sort: 'updated', order: 'desc' };
      }
      case 'all':
        return base;
    }
  }, [chosen, userId, view]);

  const query = useIssueList({ workspaceId }, listFilters, { enabled: Boolean(userId) });
  const {
    data: stats,
    error: statsError,
    refetch: refetchStats,
  } = useAssigneeStats(workspaceId, userId ? [userId] : [], chosen);
  const figures = stats?.get(userId);

  // A subtask stands on its own only when its parent is not in the list: with
  // the parent here it sits one click away under the parent's fold arrow.
  const issues = useMemo(() => {
    const all = flattenPages(query.data);
    const listed = new Set(all.map((issue) => issue.id));
    return all.filter((issue) => !issue.parent || !listed.has(issue.parent.id));
  }, [query.data]);

  // The estimate column appears only where estimates are actually used.
  const columns = useMemo<ListColumn[]>(
    () => [
      'status',
      'priority',
      'project',
      'dueDate',
      ...(issues.some((issue) => issue.storyPoints !== null) ? (['storyPoints'] as const) : []),
    ],
    [issues],
  );

  const countFor: Record<View, number | undefined> = {
    active: figures?.active,
    overdue: figures?.overdue,
    done: figures?.done,
    all: undefined,
  };
  const total = countFor[view];

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'Задачи сотрудника' }]} />

      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b-2 border-border-strong bg-surface px-3 py-3 sm:px-4">
        <Avatar user={person ?? null} size="lg" />
        {/* Asks for room of its own, so on a phone the figures wrap under the name instead of squeezing it. */}
        <div className="min-w-0 flex-1 basis-56">
          <p className="fd-eyebrow">Задачи сотрудника</p>
          <h1 className="flex flex-wrap items-center gap-2 text-lg leading-tight font-bold">
            <span className="truncate">{person?.name ?? (members ? 'Сотрудник не найден' : 'Загружаем…')}</span>
            {isMe && <Badge>это вы</Badge>}
          </h1>
        </div>

        {figures ? (
          <p className="fd-num text-2xs text-text-subtle">
            Срок в ближайшие 7 дней: <span className="font-bold text-text">{figures.dueSoon}</span>
          </p>
        ) : (
          // The list and its figures load apart; a figure that did not arrive
          // is said to be missing rather than left to look like nothing is due.
          statsError && (
            <p className="text-2xs text-danger" role="status">
              Счётчики не загрузились.{' '}
              <button type="button" className="font-bold underline" onClick={() => void refetchStats()}>
                Повторить
              </button>
            </p>
          )
        )}

        <div className="flex items-center gap-2">
          {person && (
            <Link to={`/people/${person.id}`} className="text-xs font-bold text-accent hover:underline">
              Профиль
            </Link>
          )}
          <UserPicker
            users={people}
            value={userId}
            // The viewer's own list is the address without a person in it.
            onChange={(next) => next && setParam('user', next === user?.id ? null : next)}
            allowUnassigned={false}
            label="Сотрудника"
            align="end"
          >
            <Button size="sm" variant="secondary" iconRight={<ChevronDown className="size-3.5" />}>
              Выбрать сотрудника
            </Button>
          </UserPicker>
        </div>
      </header>

      {/* On a phone the four tabs share the width in two lines each, name over
          figure. In one row they were wider than the screen, and «Все» sat past
          its edge with no scrollbar to say so. */}
      <div className="grid grid-cols-4 border-b-2 border-border-strong bg-bg-subtle sm:flex sm:items-stretch sm:overflow-x-auto no-scrollbar">
        {VIEWS.map((item, index) => {
          const count = countFor[item.value];
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => setParam('view', item.value === 'active' ? null : item.value)}
              aria-current={view === item.value ? 'page' : undefined}
              className={clsx(
                'flex min-w-0 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-bold whitespace-nowrap transition-colors',
                'sm:inline-flex sm:flex-row sm:gap-1.5 sm:px-3.5 sm:py-2 sm:text-sm',
                index > 0 && 'border-l-2 border-border-strong',
                view === item.value
                  ? 'relative bg-surface text-text after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-accent'
                  : 'text-text-muted hover:bg-surface-hover hover:text-text',
              )}
            >
              <span className="max-w-full truncate">{item.label}</span>
              {count !== undefined && (
                <span
                  className={clsx(
                    'fd-num text-2xs',
                    item.value === 'overdue' && count > 0 ? 'font-bold text-danger' : 'font-normal text-text-subtle',
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <FilterBar
        filters={chosen}
        onChange={setBarFilters}
        currentUserId={user?.id ?? ''}
        projects={projects ?? []}
        statuses={onlyProject?.statuses}
        stateFacet
        dueRange
        hideAssignee
        hideDoneOption={false}
        sortOptions={false}
        views={
          <SavedViews
            layout="EMPLOYEE"
            current={{
              filters: chosen as Record<string, unknown>,
              // The person is written down even when it is the viewer: «Неделя
              // Ивана» has to stay Ivan's week for whoever opens it.
              display: { params: { ...(userId ? { user: userId } : {}), ...(view !== 'active' ? { view } : {}) } },
            }}
            onApply={(saved) => setSearchParams(viewSearchParams(saved), { replace: true })}
            saves="В вид войдут сотрудник, вкладка и фильтры."
          />
        }
      />

      <StaleNotice query={query} />
      <div className="min-h-0 flex-1 overflow-auto bg-surface scrollbar-thin">
        <div
          className="sm:min-w-[var(--list-min)] xl:min-w-[var(--list-min-xl)]"
          style={listMinStyle(columns, false)}
        >
          {query.error && !query.data ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : members && !person ? (
            <EmptyState
              title="Сотрудник не найден"
              description="Возможно, этого человека больше нет в пространстве. Выберите другого."
            />
          ) : query.isLoading ? (
            <SkeletonRows rows={10} />
          ) : issues.length === 0 ? (
            <EmptyState title={EMPTY[view].title} description={EMPTY[view].description} />
          ) : (
            <>
              <IssueRowHeader columns={columns} selectable={false} />
              {issues.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  columns={columns}
                  selected={false}
                  onToggleSelect={() => undefined}
                  selectable={false}
                  onOpen={() => openIssue(issue.id)}
                />
              ))}
            </>
          )}

          {issues.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-3 p-3">
              {total !== undefined && (
                <span className="fd-num text-2xs text-text-subtle">
                  Загружено {flattenPages(query.data).length} из {pluralize(total, ['задачи', 'задач', 'задач'])}
                </span>
              )}
              {query.hasNextPage && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  Загрузить ещё
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
