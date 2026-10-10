import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { CascadeDto, CascadeFiguresDto, CascadeReportDto, IssueSummaryDto } from '@flowdesk/contracts';
import { ArrowLeft, ChevronRight, CornerUpLeft, Eye, Network, Plus, Send } from 'lucide-react';
import { ApiError } from '~/lib/api';
import { useSession } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import { useToast } from '~/app/toast';
import { useProjects } from '~/features/projects/hooks';
import { flattenPages, useIssueCount, useIssueList } from '~/features/issues/hooks';
import { useFilterState } from '~/features/issues/useFilterState';
import type { IssueFilters } from '~/features/issues/types';
import { useCascade, useHandoff } from '~/features/cascade/hooks';
import { FilterBar } from '~/components/FilterBar';
import { DueDateChip, IssueTypeIcon, PriorityIcon, StatusPill } from '~/components/IssueMeta';
import { isClosedStatus } from '~/components/DoneToggle';
import { Avatar } from '~/ui/Avatar';
import { Button } from '~/ui/Button';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '~/ui/Menu';
import { SegmentedControl } from '~/ui/Tabs';
import { EmptyState, ErrorState, Skeleton, SkeletonRows, StaleNotice } from '~/ui/Feedback';
import { ProjectIcon } from '~/ui/ProjectIcon';
import { pluralize } from '~/lib/format';

/* ------------------------------------------------------------------ states */

type StateKey = 'backlog' | 'todo' | 'doing' | 'done' | 'all';

/**
 * The states a pool is looked at by. They are status categories, not status
 * names: every project calls its columns its own way, and the card shows the
 * project's own name. Switching changes what is listed, never a task.
 */
const STATES: { value: StateKey; label: string; filters: IssueFilters; empty: string }[] = [
  { value: 'backlog', label: 'Бэклог', filters: { statusCategory: ['BACKLOG'] }, empty: 'В бэклоге пусто' },
  { value: 'todo', label: 'К выполнению', filters: { statusCategory: ['UNSTARTED'] }, empty: 'Нет задач к выполнению' },
  { value: 'doing', label: 'В работе', filters: { statusCategory: ['STARTED'] }, empty: 'В работе ничего нет' },
  { value: 'done', label: 'Завершённые', filters: { statusCategory: ['COMPLETED'] }, empty: 'Завершённых задач нет' },
  { value: 'all', label: 'Все', filters: {}, empty: 'Задач нет' },
];
const stateOf = (value: string | null) => STATES.find((item) => item.value === value) ?? STATES[0]!;

const dropId = (userId: string) => `person:${userId}`;
const TASKS = ['задача', 'задачи', 'задач'] as [string, string, string];

/* ------------------------------------------------------------------ screen */

/**
 * «Мой пул и подчинённые»: one's own tasks in the middle, the people right
 * below on the sides, and a task handed from one to the other.
 *
 * A handover changes who holds the task and nothing else. It goes one step
 * along the reporting line kept in the register of departments; the server
 * holds that rule, this screen only offers the moves it allows.
 *
 * Looking into a subordinate's branch is a mode of its own, marked as such
 * and read-only: nothing here is ever done on someone else's behalf.
 */
export function PlanningCascade() {
  const { user, workspace } = useSession();
  const workspaceId = workspace?.id ?? '';
  const userId = user?.id ?? '';
  const openIssue = useUiStore((s) => s.openIssue);
  const openCreateIssue = useUiStore((s) => s.openCreateIssue);
  const toast = useToast();
  const queryClient = useQueryClient();

  const [searchParams, setSearchParams] = useSearchParams();
  const setParams = (patch: Record<string, string | null>) =>
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        for (const [key, value] of Object.entries(patch)) {
          if (value) params.set(key, value);
          else params.delete(key);
        }
        return params;
      },
      { replace: true },
    );

  // Whose pool is on the screen. One's own is where things are done; anyone
  // else's is looked at.
  const viewParam = searchParams.get('view');
  const viewedId = viewParam && viewParam !== userId ? viewParam : undefined;
  const acting = !viewedId;
  const cascade = useCascade(workspaceId, viewedId);
  const data = cascade.data;
  const personId = data?.person.user.id ?? '';
  const reports = useMemo(() => data?.reports ?? [], [data]);

  const state = stateOf(searchParams.get('state'));

  const [barFilters, setBarFilters] = useFilterState();
  // Whose tasks and in what state is decided by the columns and the switch;
  // a person or a status left in the address by another screen must not fight them.
  const chosen = useMemo(() => {
    const rest: IssueFilters = { ...barFilters };
    delete rest.assigneeId;
    delete rest.statusId;
    delete rest.statusCategory;
    delete rest.sort;
    delete rest.order;
    return rest;
  }, [barFilters]);
  const { data: projects } = useProjects(workspaceId);

  /* --------------------------------------------------------------- center */

  const centerFilters = useMemo<IssueFilters>(
    () => ({ ...chosen, ...state.filters, assigneeId: [personId], includeSubtasks: true, sort: 'dueDate', order: 'asc' }),
    [chosen, state, personId],
  );
  const center = useIssueList({ workspaceId }, centerFilters, { enabled: Boolean(personId) });
  const centerIssues = useMemo(() => flattenPages(center.data), [center.data]);
  const { data: centerTotal } = useIssueCount(workspaceId, centerFilters, Boolean(personId));

  /* -------------------------------------------------------------- handover */

  const handoff = useHandoff(workspaceId);
  // Tasks on their way: hidden where they were until the server has answered
  // and the lists are read again. A refusal takes them out of here at once,
  // and the card is back in its column.
  const [sent, setSent] = useState<Map<string, string | null>>(new Map());
  const onItsWay = (issue: IssueSummaryDto) => sent.has(issue.id) && sent.get(issue.id) === (issue.assignee?.id ?? null);

  const recipients = useMemo(() => new Map(reports.map((report) => [report.user.id, report])), [reports]);
  const recipientName = (toUserId: string) => (toUserId === userId ? 'вам' : (recipients.get(toUserId)?.user.name ?? 'сотруднику'));

  const send = async (issues: IssueSummaryDto[], toUserId: string) => {
    // What the server would refuse is not sent: a finished task, a task already there.
    const items = issues.filter((issue) => (issue.assignee?.id ?? null) !== toUserId && !isClosedStatus(issue.status));
    if (items.length === 0) return;

    const mark = (present: boolean) =>
      setSent((current) => {
        const next = new Map(current);
        for (const issue of items) {
          if (present) next.set(issue.id, issue.assignee?.id ?? null);
          else next.delete(issue.id);
        }
        return next;
      });

    mark(true);
    try {
      const result = await handoff.mutateAsync({
        toUserId,
        items: items.map((issue) => ({
          issueId: issue.id,
          expectedAssigneeId: issue.assignee?.id ?? null,
          expectedUpdatedAt: issue.updatedAt,
        })),
      });
      toast.success(
        toUserId === userId
          ? `Возвращено вам: ${pluralize(result.updated, TASKS)}`
          : items.length === 1
            ? `${items[0]!.issueKey} передана: ${recipientName(toUserId)}`
            : `Передано ${pluralize(result.updated, TASKS)}: ${recipientName(toUserId)}`,
      );
      setSelectedIds([]);
      // The cards stay hidden until the lists show the new holder.
      await queryClient.invalidateQueries({ queryKey: ['issues'] });
    } catch (error) {
      toast.error(
        error,
        error instanceof ApiError && error.isConflict ? 'Не передано: задача уже изменилась' : 'Не удалось передать',
      );
    } finally {
      mark(false);
    }
  };

  /* -------------------------------------------------------------- selection */

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Only what the pool still shows stays selected: a filter or a switch of
  // state must never leave tasks nobody sees in a batch.
  const selected = useMemo(() => {
    const listed = new Set(centerIssues.filter((issue) => !isClosedStatus(issue.status)).map((issue) => issue.id));
    return acting ? selectedIds.filter((id) => listed.has(id)) : [];
  }, [selectedIds, centerIssues, acting]);
  const toggle = (issueId: string) =>
    setSelectedIds((current) => (current.includes(issueId) ? current.filter((id) => id !== issueId) : [...current, issueId]));

  /* ------------------------------------------------------------------- drag */

  // The mouse only: on a touch screen a drag is a scroll, and «Передать»
  // does the same thing there — and from the keyboard.
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }));
  const [dragged, setDragged] = useState<IssueSummaryDto | null>(null);
  const draggedGroup = (issue: IssueSummaryDto) =>
    selected.includes(issue.id) ? centerIssues.filter((candidate) => selected.includes(candidate.id)) : [issue];

  const onDragStart = (event: DragStartEvent) => setDragged((event.active.data.current?.issue as IssueSummaryDto) ?? null);
  const onDragEnd = (event: DragEndEvent) => {
    setDragged(null);
    const issue = event.active.data.current?.issue as IssueSummaryDto | undefined;
    const target = typeof event.over?.id === 'string' ? event.over.id.replace(/^person:/, '') : '';
    if (!issue || !target || target === (issue.assignee?.id ?? null)) return;
    void send(draggedGroup(issue), target);
  };

  /* ------------------------------------------------------------ side columns */

  const left = reports.find((report) => report.user.id === searchParams.get('l')) ?? reports[0];
  const right =
    reports.find((report) => report.user.id === searchParams.get('r') && report.user.id !== left?.user.id) ??
    reports.find((report) => report.user.id !== left?.user.id);
  // On a phone: one thing at a time.
  const [pane, setPane] = useState<'pool' | 'reports'>('pool');

  if (cascade.error && !data) {
    return <ErrorState error={cascade.error} onRetry={() => void cascade.refetch()} />;
  }

  const sideColumn = (report: CascadeReportDto | undefined, side: 'l' | 'r') =>
    report && (
      <PersonColumn
        key={`${side}-${report.user.id}`}
        workspaceId={workspaceId}
        report={report}
        everyone={reports}
        otherSideId={(side === 'l' ? right : left)?.user.id}
        // Choosing the person shown in the other column swaps the two.
        onPick={(nextId) =>
          setParams(
            nextId === (side === 'l' ? right : left)?.user.id
              ? { [side]: nextId, [side === 'l' ? 'r' : 'l']: report.user.id }
              : { [side]: nextId },
          )
        }
        chosen={chosen}
        acting={acting}
        isOnItsWay={onItsWay}
        onOpen={openIssue}
        onView={() => setParams({ view: report.user.id, l: null, r: null })}
        actions={(issue) =>
          acting && !isClosedStatus(issue.status) ? (
            <HandMenu
              label={`Передать ${issue.issueKey}`}
              recipients={reports.filter((candidate) => candidate.user.id !== report.user.id)}
              onPick={(toUserId) => void send([issue], toUserId)}
              onTakeBack={() => void send([issue], userId)}
            />
          ) : null
        }
      />
    );

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex min-h-0 flex-1 flex-col">
        <StaleNotice query={cascade} />

        {/* Someone else's work: said in so many words, with the way back. */}
        {!acting && data && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b-2 border-border-strong bg-marker-subtle px-3 py-2 text-xs"
          >
            <Eye className="size-3.5 shrink-0" />
            <nav aria-label="Цепочка подчинённости" className="flex min-w-0 flex-wrap items-center gap-1">
              {data.chain.map((link, index) => {
                const last = index === data.chain.length - 1;
                return (
                  <span key={link.user.id} className="flex items-center gap-1">
                    {index > 0 && <ChevronRight className="size-3 text-text-subtle" aria-hidden="true" />}
                    {last ? (
                      <b>{link.user.name}</b>
                    ) : (
                      <button
                        type="button"
                        className="underline-offset-2 hover:text-accent hover:underline"
                        onClick={() => setParams({ view: index === 0 ? null : link.user.id, l: null, r: null })}
                      >
                        {index === 0 ? 'Вы' : link.user.name}
                      </button>
                    )}
                  </span>
                );
              })}
            </nav>
            <span className="min-w-0 flex-1 text-text-muted">
              Просмотр работ сотрудника. Передавать и менять задачи можно только из своего пула.
            </span>
            <Button
              size="xs"
              variant="secondary"
              iconLeft={<ArrowLeft className="size-3" />}
              onClick={() => setParams({ view: null, l: null, r: null })}
            >
              К моему пулу
            </Button>
          </div>
        )}

        <FilterBar
          filters={chosen}
          onChange={setBarFilters}
          currentUserId={userId}
          projects={projects ?? []}
          dueRange
          hideAssignee
          hideDoneOption={false}
          sortOptions={false}
        />

        {reports.length > 0 && (
          <div className="border-b-2 border-border-strong bg-surface px-3 py-2 lg:hidden">
            <SegmentedControl
              label="Что показать"
              value={pane}
              onChange={setPane}
              options={[
                { value: 'pool', label: acting ? 'Мой пул' : 'Пул сотрудника' },
                { value: 'reports', label: `Подчинённые · ${reports.length}` },
              ]}
            />
          </div>
        )}

        <div
          className={clsx(
            'grid min-h-0 flex-1 grid-cols-1',
            right
              ? 'lg:grid-cols-[minmax(15rem,1fr)_minmax(22rem,1.7fr)_minmax(15rem,1fr)]'
              : left && 'lg:grid-cols-[minmax(15rem,1fr)_minmax(22rem,1.7fr)]',
          )}
        >
          {left && (
            <div className={clsx('min-h-0 border-border-strong lg:flex lg:border-r-2', pane === 'reports' ? 'flex' : 'hidden')}>
              {sideColumn(left, 'l')}
            </div>
          )}

          {/* ------------------------------------------------------- the pool */}
          <CenterColumn
            className={clsx(pane === 'pool' || reports.length === 0 ? 'flex' : 'hidden', 'lg:flex', !left && 'mx-auto w-full max-w-4xl')}
            droppableId={acting && personId ? dropId(personId) : undefined}
            header={
              !data ? (
                <Skeleton className="h-14 w-full" />
              ) : (
                <PoolHeader
                  data={data}
                  acting={acting}
                  total={centerTotal}
                  onCreate={() => openCreateIssue({ assigneeId: userId, statusCategory: 'BACKLOG' })}
                />
              )
            }
            controls={
              <>
                <div className="overflow-x-auto no-scrollbar">
                  <SegmentedControl
                    label="Состояние задач"
                    value={state.value}
                    onChange={(next) => setParams({ state: next === 'backlog' ? null : next })}
                    options={STATES.map((item) => ({ value: item.value, label: item.label }))}
                  />
                </div>
                {selected.length > 0 && (
                  <div
                    role="region"
                    aria-label="Передача выбранных задач"
                    className="flex flex-wrap items-center gap-2 border-2 border-border-strong bg-surface-sunken px-2 py-1.5 text-xs"
                  >
                    <b className="fd-num">Выбрано: {selected.length}</b>
                    <HandMenu
                      label="Передать выбранные"
                      text="Передать выбранные"
                      recipients={reports}
                      onPick={(toUserId) =>
                        void send(
                          centerIssues.filter((issue) => selected.includes(issue.id)),
                          toUserId,
                        )
                      }
                    />
                    <Button size="xs" variant="ghost" onClick={() => setSelectedIds([])}>
                      Снять выделение
                    </Button>
                  </div>
                )}
              </>
            }
          >
            <StaleNotice query={center} className="border-2" />
            {center.error && !center.data ? (
              <ErrorState compact error={center.error} onRetry={() => void center.refetch()} />
            ) : center.isLoading || !data ? (
              <SkeletonRows rows={6} />
            ) : centerIssues.length === 0 ? (
              <EmptyState
                compact
                title={state.empty}
                description={
                  acting && state.value === 'backlog'
                    ? 'Сюда попадают задачи, которые передали вам, и те, что вы создали себе.'
                    : undefined
                }
                action={
                  acting && state.value === 'backlog' ? (
                    <Button
                      size="sm"
                      variant="primary"
                      iconLeft={<Plus className="size-3.5" />}
                      onClick={() => openCreateIssue({ assigneeId: userId, statusCategory: 'BACKLOG' })}
                    >
                      Создать себе задачу
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="space-y-2" aria-label={acting ? 'Мой пул задач' : 'Пул задач сотрудника'}>
                {centerIssues
                  .filter((issue) => !onItsWay(issue))
                  .map((issue) => {
                    const movable = acting && !isClosedStatus(issue.status);
                    return (
                      <li key={issue.id}>
                        <TaskCard
                          issue={issue}
                          draggable={movable && reports.length > 0}
                          selected={selected.includes(issue.id)}
                          onToggle={movable && reports.length > 0 ? () => toggle(issue.id) : undefined}
                          onOpen={() => openIssue(issue.id)}
                          actions={
                            movable && reports.length > 0 ? (
                              <HandMenu
                                label={`Передать ${issue.issueKey}`}
                                recipients={reports}
                                onPick={(toUserId) => void send([issue], toUserId)}
                              />
                            ) : null
                          }
                        />
                      </li>
                    );
                  })}
              </ul>
            )}
            <ListFooter query={center} shown={centerIssues.length} total={centerTotal} />
          </CenterColumn>

          {right && (
            <div className={clsx('min-h-0 border-border-strong lg:flex lg:border-l-2', 'hidden')}>{sideColumn(right, 'r')}</div>
          )}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragged && (
          <div className="relative w-72 rotate-1">
            <TaskCard issue={dragged} onOpen={() => undefined} overlay />
            {draggedGroup(dragged).length > 1 && (
              <span className="fd-num absolute -top-2 -right-2 border-2 border-border-strong bg-ink px-1.5 py-0.5 text-2xs font-bold text-text-inverted">
                +{draggedGroup(dragged).length - 1}
              </span>
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/* ----------------------------------------------------------------- columns */

function CenterColumn({
  className,
  droppableId,
  header,
  controls,
  children,
}: {
  className?: string;
  /** Present on one's own pool: a task of a direct report can be dragged back in. */
  droppableId?: string;
  header: ReactNode;
  controls: ReactNode;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: droppableId ?? 'pool:view', disabled: !droppableId });
  return (
    <section
      ref={setNodeRef}
      aria-label="Пул задач"
      className={clsx('min-h-0 min-w-0 flex-col bg-surface', isOver && 'outline outline-2 -outline-offset-2 outline-accent', className)}
    >
      <div className="space-y-2 border-b-2 border-border-strong p-3">
        {header}
        {controls}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin">{children}</div>
    </section>
  );
}

function Figures({ title, figures, note }: { title: string; figures: CascadeFiguresDto; note?: string }) {
  return (
    <div className="min-w-0">
      <p className="fd-eyebrow">{title}</p>
      <p className="fd-num mt-0.5 text-xs">
        бэклог <b>{figures.backlog}</b> · активные <b>{figures.active}</b>
        {figures.overdue > 0 && (
          <>
            {' '}
            · <b className="text-danger">просрочено {figures.overdue}</b>
          </>
        )}
        {note && <span className="text-text-subtle"> · {note}</span>}
      </p>
    </div>
  );
}

function PoolHeader({
  data,
  acting,
  total,
  onCreate,
}: {
  data: CascadeDto;
  acting: boolean;
  total: number | undefined;
  onCreate: () => void;
}) {
  const { person } = data;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Avatar user={person.user} size="md" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm leading-tight font-bold">
            {acting ? 'Мой пул задач' : `Пул задач: ${person.user.name}`}
            {total !== undefined && <span className="fd-num ml-2 text-2xs font-normal text-text-subtle">{pluralize(total, TASKS)}</span>}
          </h1>
          <p className="truncate text-2xs text-text-subtle">
            {acting ? `${person.user.name} · ` : ''}
            {person.position ?? 'должность не указана'}
            {data.department ? ` · ${data.department.name}` : ''}
          </p>
        </div>
        {acting && (
          <Button size="sm" variant="primary" iconLeft={<Plus className="size-3.5" />} onClick={onCreate}>
            Создать себе задачу
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Figures title="Личные задачи" figures={data.own} />
        {data.reports.length > 0 && (
          <Figures
            title="Задачи ветки"
            figures={data.branch}
            note={`вместе с личными, ${pluralize(data.branchSize, ['человек', 'человека', 'человек'])}`}
          />
        )}
      </div>

      {!data.department && (
        <p className="text-2xs text-text-subtle">
          Вас нет в справочнике отделов, поэтому подчинённых здесь нет. Справочник ведёт администратор: «Настройки
          пространства → Отделы».
        </p>
      )}
    </div>
  );
}

/**
 * One direct report: their own backlog by default, other states on request,
 * and — apart from that — what the people below them hold: the tasks they
 * passed on, and whatever those people took or made themselves.
 */
function PersonColumn({
  workspaceId,
  report,
  everyone,
  otherSideId,
  onPick,
  chosen,
  acting,
  isOnItsWay,
  onOpen,
  onView,
  actions,
}: {
  workspaceId: string;
  report: CascadeReportDto;
  /** All direct reports: with more than two, the column chooses whom to show. */
  everyone: CascadeReportDto[];
  otherSideId: string | undefined;
  onPick: (userId: string) => void;
  chosen: IssueFilters;
  acting: boolean;
  isOnItsWay: (issue: IssueSummaryDto) => boolean;
  onOpen: (issueId: string) => void;
  onView: () => void;
  actions: (issue: IssueSummaryDto) => ReactNode;
}) {
  const [scope, setScope] = useState<'own' | 'below'>('own');
  const [stateKey, setStateKey] = useState<StateKey>('backlog');
  const state = stateOf(stateKey);
  const hasBranch = report.belowUserIds.length > 0;

  const filters = useMemo<IssueFilters>(
    () => ({
      ...chosen,
      ...state.filters,
      assigneeId: scope === 'own' ? [report.user.id] : report.belowUserIds,
      includeSubtasks: true,
      sort: 'dueDate',
      order: 'asc',
    }),
    [chosen, state, scope, report],
  );
  const enabled = scope === 'own' || hasBranch;
  const query = useIssueList({ workspaceId }, filters, { enabled });
  const issues = useMemo(() => flattenPages(query.data), [query.data]);
  const { data: total } = useIssueCount(workspaceId, filters, enabled);

  // A task lands in the person's own tasks, so only that view takes a drop.
  const { setNodeRef, isOver } = useDroppable({ id: dropId(report.user.id), disabled: !acting });

  return (
    <section
      ref={setNodeRef}
      aria-label={`Задачи сотрудника: ${report.user.name}`}
      className={clsx(
        'flex min-h-0 min-w-0 flex-1 flex-col bg-bg-subtle',
        isOver && 'outline outline-2 -outline-offset-2 outline-accent',
      )}
    >
      <div className="space-y-2 border-b-2 border-border-strong p-3">
        <div className="flex items-center gap-2">
          <Avatar user={report.user} size="md" />
          <div className="min-w-0 flex-1">
            {/* Two reports stand side by side on a wide screen and need no choosing;
                on a phone there is one column, so even two are chosen between. */}
            {everyone.length > 1 && (
              <select
                value={report.user.id}
                onChange={(event) => onPick(event.target.value)}
                aria-label="Чьи задачи показать в колонке"
                className={clsx(
                  'h-7 w-full border-2 border-border-strong bg-surface px-1.5 text-sm font-bold focus:border-accent focus:outline-none',
                  everyone.length === 2 && 'lg:hidden',
                )}
              >
                {everyone.map((candidate) => (
                  <option key={candidate.user.id} value={candidate.user.id}>
                    {candidate.user.name}
                    {candidate.user.id === otherSideId ? ' (в соседней колонке)' : ''}
                  </option>
                ))}
              </select>
            )}
            <h2
              className={clsx(
                'truncate text-sm leading-tight font-bold',
                everyone.length > 2 ? 'sr-only' : everyone.length === 2 && 'hidden lg:block',
              )}
            >
              {report.user.name}
            </h2>
            <p className="truncate text-2xs text-text-subtle">{report.position ?? 'должность не указана'}</p>
          </div>
        </div>

        <Figures title="Личные задачи" figures={report.own} />
        {hasBranch && <Figures title="Задачи ниже по ветке" figures={report.below} />}

        <div className="flex flex-wrap items-center gap-1.5">
          {hasBranch && (
            <SegmentedControl
              label="Чьи задачи"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'own', label: 'Личные' },
                { value: 'below', label: 'Ниже по ветке' },
              ]}
            />
          )}
          <select
            value={stateKey}
            onChange={(event) => setStateKey(event.target.value as StateKey)}
            aria-label={`Состояние задач: ${report.user.name}`}
            className="h-7 border-2 border-border-strong bg-surface px-1.5 text-xs focus:border-accent focus:outline-none"
          >
            {STATES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs">
          <button
            type="button"
            onClick={onView}
            className="inline-flex items-center gap-1 font-bold underline-offset-2 hover:text-accent hover:underline"
          >
            <Network className="size-3" />
            Работы и ветка
          </button>
          <Link to={`/employee-work?user=${report.user.id}`} className="text-text-subtle underline-offset-2 hover:text-accent hover:underline">
            все задачи списком
          </Link>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5 scrollbar-thin">
        <StaleNotice query={query} className="border-2" />
        {!enabled ? (
          <EmptyState compact title="Ниже по ветке никого нет" />
        ) : query.error && !query.data ? (
          <ErrorState compact error={query.error} onRetry={() => void query.refetch()} />
        ) : query.isLoading ? (
          <SkeletonRows rows={4} />
        ) : issues.length === 0 ? (
          <EmptyState compact title={state.empty} />
        ) : (
          <ul className="space-y-2" aria-label={`Задачи: ${report.user.name}`}>
            {issues
              .filter((issue) => !isOnItsWay(issue))
              .map((issue) => (
                <li key={issue.id}>
                  <TaskCard
                    issue={issue}
                    compact
                    // What a report has passed on is theirs to move, not their manager's.
                    draggable={acting && scope === 'own' && !isClosedStatus(issue.status)}
                    holder={scope === 'below' ? issue.assignee?.name : undefined}
                    onOpen={() => onOpen(issue.id)}
                    actions={scope === 'own' ? actions(issue) : null}
                  />
                </li>
              ))}
          </ul>
        )}
        <ListFooter query={query} shown={issues.length} total={total} />
      </div>
    </section>
  );
}

/** «Shown X of Y» and the rest of the list: every column pages on its own. */
function ListFooter({
  query,
  shown,
  total,
}: {
  query: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown };
  shown: number;
  total: number | undefined;
}) {
  if (!query.hasNextPage) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 pt-3">
      {total !== undefined && (
        <span className="fd-num text-2xs text-text-subtle">
          Показано {shown} из {total}
        </span>
      )}
      <Button size="xs" variant="secondary" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
        Загрузить ещё
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------- cards */

function TaskCard({
  issue,
  compact,
  draggable = false,
  overlay = false,
  selected,
  onToggle,
  holder,
  onOpen,
  actions,
}: {
  issue: IssueSummaryDto;
  compact?: boolean;
  draggable?: boolean;
  /** The copy that follows the pointer while dragging. */
  overlay?: boolean;
  selected?: boolean;
  /** Present where tasks can be picked for a batch. */
  onToggle?: () => void;
  /** Named where the list is not one person's: who holds the task now. */
  holder?: string;
  onOpen: () => void;
  actions?: ReactNode;
}) {
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: overlay ? `overlay:${issue.id}` : issue.id,
    data: { issue },
    disabled: !draggable || overlay,
  });
  const closed = isClosedStatus(issue.status);

  return (
    <article
      ref={setNodeRef}
      {...(draggable ? listeners : {})}
      className={clsx(
        'border-2 border-border-strong bg-surface p-2.5 shadow-sm',
        draggable && 'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-40',
        selected && 'bg-marker-subtle',
        overlay && 'shadow-lg',
      )}
    >
      <div className="flex items-start gap-2">
        {onToggle && (
          <input
            type="checkbox"
            checked={Boolean(selected)}
            onChange={onToggle}
            aria-label={`Выбрать ${issue.issueKey}`}
            className="mt-0.5 size-4 shrink-0 cursor-pointer border-2 border-border-strong accent-[var(--accent)]"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <IssueTypeIcon type={issue.type} className="size-3.5 shrink-0" />
            <span className="fd-key shrink-0">{issue.issueKey}</span>
            <span className="inline-flex min-w-0 items-center gap-1 text-2xs text-text-subtle" title={`Проект: ${issue.project.name}`}>
              <ProjectIcon icon={issue.project.icon} color={issue.project.color} size="sm" />
              <span className="truncate">{issue.project.name}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={onOpen}
            className={clsx(
              'mt-1 block w-full text-left text-sm font-bold break-words hover:text-accent',
              compact && 'line-clamp-2',
              closed && 'text-text-subtle line-through',
            )}
          >
            {issue.title}
          </button>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {/* The project's own name of the status, whatever category it was listed by. */}
            <StatusPill status={issue.status} size="sm" />
            <PriorityIcon priority={issue.priority} className="size-3.5" />
            {issue.dueDate && (
              <DueDateChip value={issue.dueDate} hasTime={issue.dueHasTime} carriedDays={issue.carriedOverDays} done={closed} />
            )}
            {issue.storyPoints !== null && (
              <span className="fd-num text-2xs text-text-subtle" title="Оценка в баллах, не в часах">
                {issue.storyPoints} б.
              </span>
            )}
            {holder && <span className="text-2xs text-text-subtle">у: {holder}</span>}
          </div>
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    </article>
  );
}

/**
 * «Передать»: the same move as a drag, for the keyboard and the phone. It
 * lists the direct reports and nobody else — the only people a task can go to
 * from here.
 */
function HandMenu({
  label,
  text,
  recipients,
  onPick,
  onTakeBack,
}: {
  label: string;
  /** Words on the button; without them it is an icon with the label for a name. */
  text?: string;
  recipients: CascadeReportDto[];
  onPick: (userId: string) => void;
  /** Offered on a direct report's task: back into one's own pool. */
  onTakeBack?: () => void;
}) {
  return (
    <Menu>
      <MenuTrigger>
        <button
          type="button"
          aria-label={label}
          title={text ? undefined : 'Передать'}
          // A press on the button is not the start of a drag of its card.
          onMouseDown={(event) => event.stopPropagation()}
          className="inline-flex h-7 items-center gap-1.5 border-2 border-border-strong bg-surface px-1.5 text-xs font-bold hover:bg-surface-hover hover:shadow-xs"
        >
          <Send className="size-3.5" />
          {text}
        </button>
      </MenuTrigger>
      <MenuContent align="end" width={260} label="Кому передать">
        <MenuLabel>{recipients.length > 0 ? 'Передать подчинённому' : 'Передать'}</MenuLabel>
        {recipients.map((report) => (
          <MenuItem
            key={report.user.id}
            icon={<Avatar user={report.user} size="sm" />}
            shortcut={<span className="fd-num text-2xs">{report.own.backlog}</span>}
            onSelect={() => onPick(report.user.id)}
          >
            {report.user.name}
          </MenuItem>
        ))}
        {onTakeBack && (
          <>
            {recipients.length > 0 && <MenuSeparator />}
            <MenuItem icon={<CornerUpLeft className="size-3.5" />} onSelect={onTakeBack}>
              Вернуть себе
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}
