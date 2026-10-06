import { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { addDays, differenceInCalendarDays, format } from 'date-fns';
import { ChevronDown } from 'lucide-react';
import { Permission, type IssueSummaryDto } from '@flowdesk/contracts';
import { useSession, useWorkspaceCan } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import { useMembers } from '~/features/members/hooks';
import { useProjects } from '~/features/projects/hooks';
import {
  flattenPages,
  useAssigneeStats,
  useBulkUpdate,
  useIssueCount,
  useIssueList,
  usePatchIssue,
} from '~/features/issues/hooks';
import { useFilterState } from '~/features/issues/useFilterState';
import type { IssueFilters } from '~/features/issues/types';
import { Topbar } from '~/components/Topbar';
import { FilterBar } from '~/components/FilterBar';
import { BulkActionBar } from '~/components/BulkActionBar';
import { IssueRow, IssueRowHeader, listMinWidth, type ListColumn } from '~/components/IssueRow';
import { DueDateChip } from '~/components/IssueMeta';
import { UserPicker } from '~/components/Pickers';
import { Avatar } from '~/ui/Avatar';
import { Button } from '~/ui/Button';
import { SegmentedControl } from '~/ui/Tabs';
import { EmptyState, ErrorState, SkeletonRows } from '~/ui/Feedback';
import { pluralize, shortDate } from '~/lib/format';

type Period = '7' | '30' | 'all';

const PERIODS: { value: Period; label: string }[] = [
  { value: '7', label: '7 дней' },
  { value: '30', label: '30 дней' },
  { value: 'all', label: 'Все сроки' },
];

const isPeriod = (value: string | null): value is Period => PERIODS.some((item) => item.value === value);

/**
 * Handing out work: the tasks nobody has yet on the left, the person about to
 * receive them — with what they already carry — on the right.
 *
 * The right side shows counts and dates, and story points where they are used.
 * It does not show a percentage of load: the system knows neither hours nor
 * anyone's calendar, and a made-up figure would be read as a real one.
 */
export function PlanningPage() {
  const { user, workspace } = useSession();
  const openIssue = useUiStore((s) => s.openIssue);
  const workspaceId = workspace?.id ?? '';
  const canAssign = useWorkspaceCan(Permission.ISSUE_ASSIGN);

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
  // A guest can be given work only in the projects they were added to; the
  // people offered right in a row are those any task here can go to.
  const assignable = useMemo(
    () => (members ?? []).filter((member) => member.role !== 'GUEST').map((member) => member.user),
    [members],
  );

  const userId = searchParams.get('user') ?? '';
  const person = people.find((candidate) => candidate.id === userId);
  const periodParam = searchParams.get('period');
  const period: Period = isPeriod(periodParam) ? periodParam : '7';

  /* ------------------------------------------------------------- the pool */

  const [barFilters, setBarFilters] = useFilterState();
  const chosen = useMemo(() => {
    const rest: IssueFilters = { ...barFilters };
    delete rest.assigneeId;
    delete rest.sort;
    delete rest.order;
    return rest;
  }, [barFilters]);

  const poolFilters = useMemo<IssueFilters>(
    () => ({ ...chosen, assigneeId: ['none'], includeDone: false, includeSubtasks: true, sort: 'dueDate', order: 'asc' }),
    [chosen],
  );
  const pool = useIssueList({ workspaceId }, poolFilters);
  const poolIssues = useMemo(() => flattenPages(pool.data), [pool.data]);
  const { data: poolTotal } = useIssueCount(workspaceId, poolFilters);

  const columns = useMemo<ListColumn[]>(
    () => [
      'status',
      'priority',
      'project',
      'dueDate',
      ...(poolIssues.some((issue) => issue.storyPoints !== null) ? (['storyPoints'] as const) : []),
      'assignee',
    ],
    [poolIssues],
  );

  // A task that has left the pool — assigned here or by someone else — leaves
  // the selection with it: an id nobody can see must not ride along in a batch.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selected = useMemo(() => {
    const inPool = new Set(poolIssues.map((issue) => issue.id));
    return selectedIds.filter((id) => inPool.has(id));
  }, [selectedIds, poolIssues]);

  const lastClicked = useRef<string | null>(null);
  const toggleSelect = useCallback(
    (issueId: string, event: { shiftKey: boolean }) => {
      // Shift-click selects the range since the previous click, like a file manager.
      if (event.shiftKey && lastClicked.current) {
        const from = poolIssues.findIndex((issue) => issue.id === lastClicked.current);
        const to = poolIssues.findIndex((issue) => issue.id === issueId);
        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from];
          const range = poolIssues.slice(start, end + 1).map((issue) => issue.id);
          setSelectedIds((previous) => [...new Set([...previous, ...range])]);
          return;
        }
      }
      lastClicked.current = issueId;
      setSelectedIds((previous) =>
        previous.includes(issueId) ? previous.filter((id) => id !== issueId) : [...previous, issueId],
      );
    },
    [poolIssues],
  );

  const bulkUpdate = useBulkUpdate(workspaceId);
  const patchIssue = usePatchIssue();

  /* ----------------------------------------------------------- the person */

  const periodEnd = useMemo(
    () => (period === 'all' ? null : new Date(`${format(addDays(new Date(), Number(period) - 1), 'yyyy-MM-dd')}T23:59:59.999`)),
    [period],
  );
  const personIds = useMemo(() => (userId ? [userId] : []), [userId]);
  const { data: overall } = useAssigneeStats(workspaceId, personIds);
  const { data: withinPeriod } = useAssigneeStats(
    workspaceId,
    personIds,
    useMemo(() => (periodEnd ? { dueBefore: periodEnd.toISOString() } : {}), [periodEnd]),
  );
  const { data: undated } = useAssigneeStats(workspaceId, personIds, NO_DUE_DATE);
  const figures = overall?.get(userId);

  const personTasks = useIssueList(
    { workspaceId },
    useMemo<IssueFilters>(
      () => ({ assigneeId: personIds, includeDone: false, includeSubtasks: true, sort: 'dueDate', order: 'asc' }),
      [personIds],
    ),
    { enabled: Boolean(userId), limit: 100 },
  );
  const groups = useMemo(() => groupByPeriod(flattenPages(personTasks.data), period), [personTasks.data, period]);

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'Распределение задач' }]} />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* On a phone the person comes first: who gets the work is decided before what. */}
        <aside className="order-first flex max-h-[45vh] min-h-0 w-full shrink-0 flex-col overflow-y-auto border-b-2 border-border-strong bg-surface scrollbar-thin lg:order-last lg:max-h-none lg:w-96 lg:border-b-0 lg:border-l-2">
          <div className="border-b-2 border-border-strong p-3">
            <p className="fd-eyebrow pb-1.5">Кому назначаем</p>
            <UserPicker
              users={people}
              value={userId || null}
              onChange={(next) => setParam('user', next)}
              allowUnassigned={false}
              label="Сотрудника"
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 border-2 border-border-strong bg-surface px-2 py-1.5 text-left text-sm font-bold hover:bg-surface-hover hover:shadow-xs"
              >
                <Avatar user={person ?? null} size="md" />
                <span className="min-w-0 flex-1 truncate">{person?.name ?? 'Выберите сотрудника'}</span>
                <ChevronDown className="size-3.5 shrink-0 text-text-subtle" />
              </button>
            </UserPicker>
          </div>

          {!person ? (
            <EmptyState
              compact
              title="Сотрудник не выбран"
              description="Выберите человека — покажем, что на нём уже есть и на какие сроки, прежде чем назначать новое."
            />
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-2 border-b-2 border-border-strong p-3">
                <Figure label="Активные" value={figures?.active} />
                <Figure label="Просрочено" value={figures?.overdue} alarm />
                <Figure
                  label={periodEnd ? `Срок до ${shortDate(periodEnd.toISOString())}` : 'Со сроком'}
                  value={
                    periodEnd
                      ? withinPeriod?.get(userId)?.active
                      : figures && undated?.get(userId) !== undefined
                        ? figures.active - undated.get(userId)!.active
                        : undefined
                  }
                />
                <Figure label="Без срока" value={undated?.get(userId)?.active} />
                {figures && figures.activePoints > 0 && (
                  <p className="col-span-2 text-2xs text-text-subtle">
                    Оценка активных задач: <span className="fd-num font-bold text-text">{figures.activePoints}</span> в
                    баллах. Это относительная оценка, а не часы и не занятость.
                  </p>
                )}
              </dl>

              <div className="flex items-center justify-between gap-2 border-b-2 border-border-strong px-3 py-2">
                <span className="fd-eyebrow">Период</span>
                {/* Only groups what is shown here; it never changes a task's date. */}
                <SegmentedControl
                  label="Период планирования"
                  value={period}
                  onChange={(next) => setParam('period', next === '7' ? null : next)}
                  options={PERIODS}
                />
              </div>

              {personTasks.error ? (
                <ErrorState compact error={personTasks.error} onRetry={() => void personTasks.refetch()} />
              ) : personTasks.isLoading ? (
                <SkeletonRows rows={5} />
              ) : groups.length === 0 ? (
                <EmptyState compact title="Активных задач нет" description="На этом человеке сейчас ничего не висит." />
              ) : (
                groups.map((group) => (
                  <section key={group.key}>
                    <header className="flex items-center gap-2 border-b-2 border-border-strong bg-surface-sunken px-3 py-1.5">
                      <h2 className="fd-eyebrow">{group.label}</h2>
                      <span className="fd-num text-2xs text-text-subtle">{group.issues.length}</span>
                    </header>
                    <ul>
                      {group.issues.map((issue) => (
                        <li key={issue.id}>
                          <button
                            type="button"
                            onClick={() => openIssue(issue.id)}
                            className="flex w-full items-center gap-2 border-b-2 border-border-strong px-3 py-1.5 text-left hover:bg-surface-hover"
                          >
                            <span className="fd-key shrink-0">{issue.issueKey}</span>
                            <span className="min-w-0 flex-1 truncate text-xs font-bold">{issue.title}</span>
                            {issue.dueDate && (
                              <DueDateChip value={issue.dueDate} hasTime={issue.dueHasTime} carriedDays={issue.carriedOverDays} />
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))
              )}
              {personTasks.hasNextPage && (
                <div className="flex justify-center p-2">
                  <Button
                    size="xs"
                    variant="secondary"
                    loading={personTasks.isFetchingNextPage}
                    onClick={() => void personTasks.fetchNextPage()}
                  >
                    Загрузить ещё
                  </Button>
                </div>
              )}
            </>
          )}
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Задачи без исполнителя">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b-2 border-border-strong bg-surface px-3 py-2">
            <h1 className="text-sm font-bold">Без исполнителя</h1>
            {poolTotal !== undefined && (
              <span className="fd-num text-2xs text-text-subtle">
                {pluralize(poolTotal, ['задача', 'задачи', 'задач'])}
              </span>
            )}
            {poolIssues.length > 0 && (
              <Button
                size="xs"
                variant="ghost"
                className="ml-auto"
                onClick={() =>
                  setSelectedIds(selected.length === poolIssues.length ? [] : poolIssues.map((issue) => issue.id))
                }
              >
                {selected.length === poolIssues.length ? 'Снять выбор' : 'Выбрать все на экране'}
              </Button>
            )}
          </div>

          <FilterBar
            filters={chosen}
            onChange={setBarFilters}
            currentUserId={user?.id ?? ''}
            projects={projects ?? []}
            stateFacet
            dueRange
            hideAssignee
            hideDoneOption={false}
            sortOptions={false}
          />

          <div className="min-h-0 flex-1 overflow-auto bg-surface scrollbar-thin">
            {/* Room under the last rows, so the floating bar never covers them. */}
            <div
              className="pb-20 sm:min-w-[var(--list-min)]"
              style={{ '--list-min': `${listMinWidth(columns, true)}px` } as React.CSSProperties}
            >
              {pool.error ? (
                <ErrorState error={pool.error} onRetry={() => void pool.refetch()} />
              ) : pool.isLoading ? (
                <SkeletonRows rows={10} />
              ) : poolIssues.length === 0 ? (
                <EmptyState
                  title="Все задачи розданы"
                  description="Задач без исполнителя нет — или их скрыли фильтры."
                />
              ) : (
                <>
                  <IssueRowHeader columns={columns} />
                  {poolIssues.map((issue) => (
                    <IssueRow
                      key={issue.id}
                      issue={issue}
                      columns={columns}
                      selected={selected.includes(issue.id)}
                      onToggleSelect={(event) => toggleSelect(issue.id, event)}
                      onOpen={() => openIssue(issue.id)}
                      // One task is handed out right in its row.
                      editable={canAssign}
                      members={assignable}
                      onPatch={(patch) => patchIssue.mutate({ issueId: issue.id, patch })}
                    />
                  ))}
                </>
              )}

              {pool.hasNextPage && (
                <div className="flex justify-center p-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={pool.isFetchingNextPage}
                    onClick={() => void pool.fetchNextPage()}
                  >
                    Загрузить ещё
                  </Button>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <BulkActionBar
        count={selected.length}
        onClear={() => setSelectedIds([])}
        // A deadline or a priority leaves the tasks in the pool and selected:
        // the usual next step is to hand the same tasks to someone.
        onApply={(patch) => bulkUpdate.mutate({ issueIds: selected, patch })}
        pending={bulkUpdate.isPending}
        primary={
          <Button
            size="xs"
            variant="primary"
            disabled={!person || !canAssign || bulkUpdate.isPending}
            title={!person ? 'Сначала выберите сотрудника справа' : undefined}
            onClick={() =>
              person &&
              bulkUpdate.mutate(
                // From the pool only: if someone took one of these meanwhile,
                // the server refuses the batch instead of taking it back.
                { issueIds: selected, patch: { assigneeId: person.id }, onlyUnassigned: true },
                { onSuccess: () => setSelectedIds([]) },
              )
            }
          >
            {person ? `Назначить: ${person.name}` : 'Выберите сотрудника'}
          </Button>
        }
      />
    </>
  );
}

const NO_DUE_DATE: IssueFilters = { noDueDate: true };

function Figure({ label, value, alarm }: { label: string; value: number | undefined; alarm?: boolean }) {
  return (
    <div className="border-2 border-border-strong bg-surface-sunken px-2.5 py-1.5">
      <dd className={`fd-num text-lg leading-tight font-semibold ${alarm && value ? 'text-danger' : ''}`}>{value ?? '—'}</dd>
      <dt className="text-2xs text-text-subtle">{label}</dt>
    </div>
  );
}

interface TaskGroup {
  key: string;
  label: string;
  issues: IssueSummaryDto[];
}

/** The person's tasks in the order a planner reads them: late, inside the period, after it, undated. */
function groupByPeriod(issues: IssueSummaryDto[], period: Period): TaskGroup[] {
  const days = period === 'all' ? Infinity : Number(period);
  const groups: TaskGroup[] = [
    { key: 'overdue', label: 'Просрочено', issues: [] },
    { key: 'within', label: period === 'all' ? 'Со сроком' : `В ближайшие ${days} дней`, issues: [] },
    { key: 'later', label: 'Позже', issues: [] },
    { key: 'undated', label: 'Без срока', issues: [] },
  ];
  const today = new Date();
  for (const issue of issues) {
    if (!issue.dueDate) {
      groups[3]!.issues.push(issue);
      continue;
    }
    // Calendar days, as the due chip counts them: due at noon today is «сегодня», not late.
    const ahead = differenceInCalendarDays(new Date(issue.dueDate), today);
    groups[ahead < 0 ? 0 : ahead < days ? 1 : 2]!.issues.push(issue);
  }
  return groups.filter((group) => group.issues.length > 0);
}
