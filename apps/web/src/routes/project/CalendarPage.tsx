import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { Permission, type IssueSummaryDto } from '@flowdesk/contracts';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useSession } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import { useProject } from '~/features/projects/hooks';
import { useIssueList, usePatchIssue, flattenPages } from '~/features/issues/hooks';
import { useFilterState } from '~/features/issues/useFilterState';
import { FilterBar } from '~/components/FilterBar';
import { IssueTypeIcon, PriorityIcon } from '~/components/IssueMeta';
import { Avatar } from '~/ui/Avatar';
import { Button, IconButton } from '~/ui/Button';
import { SegmentedControl } from '~/ui/Tabs';
import { ErrorState, Skeleton } from '~/ui/Feedback';
import { useToast } from '~/app/toast';

type CalendarMode = 'month' | 'week' | 'day';

/**
 * Due-date calendar. Dragging an issue onto another day rewrites its due date
 * through the same PATCH the issue panel uses, so history stays consistent.
 */
export function CalendarPage() {
  const { projectId = '' } = useParams();
  const { user } = useSession();
  const openIssue = useUiStore((s) => s.openIssue);
  const openCreateIssue = useUiStore((s) => s.openCreateIssue);
  const toast = useToast();

  const [filters, setFilters] = useFilterState();
  const [mode, setMode] = useState<CalendarMode>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [dragIssueId, setDragIssueId] = useState<string | null>(null);

  const { data: project } = useProject(projectId);
  const patchIssue = usePatchIssue();

  const range = useMemo(() => {
    if (mode === 'day') return { start: anchor, end: anchor };
    if (mode === 'week') {
      return { start: startOfWeek(anchor, { weekStartsOn: 1 }), end: endOfWeek(anchor, { weekStartsOn: 1 }) };
    }
    return {
      start: startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 }),
      end: endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 }),
    };
  }, [anchor, mode]);

  const query = useIssueList(
    { projectId },
    {
      ...filters,
      dueAfter: new Date(new Date(range.start).setHours(0, 0, 0, 0)).toISOString(),
      dueBefore: new Date(new Date(range.end).setHours(23, 59, 59, 999)).toISOString(),
      sort: 'dueDate',
      order: 'asc',
    },
    { limit: 200 },
  );

  const issues = useMemo(() => flattenPages(query.data), [query.data]);
  const days = useMemo(() => eachDayOfInterval({ start: range.start, end: range.end }), [range]);

  const byDay = useMemo(() => {
    const map = new Map<string, IssueSummaryDto[]>();
    for (const issue of issues) {
      if (!issue.dueDate) continue;
      const key = format(new Date(issue.dueDate), 'yyyy-MM-dd');
      const list = map.get(key) ?? [];
      list.push(issue);
      map.set(key, list);
    }
    return map;
  }, [issues]);

  const canEdit = project?.permissions.includes(Permission.ISSUE_UPDATE) ?? false;

  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const title =
    mode === 'day'
      ? format(anchor, 'EEEE, d MMMM yyyy', { locale: ru })
      : mode === 'week'
        ? `${format(range.start, 'd MMM', { locale: ru })} – ${format(range.end, 'd MMM yyyy', { locale: ru })}`
        : format(anchor, 'LLLL yyyy', { locale: ru });

  const step = (direction: 1 | -1) => {
    if (mode === 'month') setAnchor((prev) => (direction === 1 ? addMonths(prev, 1) : subMonths(prev, 1)));
    else if (mode === 'week') setAnchor((prev) => addDays(prev, 7 * direction));
    else setAnchor((prev) => addDays(prev, direction));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilterBar
        filters={filters}
        onChange={setFilters}
        statuses={project?.statuses}
        labels={project?.labels}
        members={project?.assignees}
        currentUserId={user?.id ?? ''}
        sortOptions={false}
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <IconButton label="Назад" size="sm" onClick={() => step(-1)}>
          <ChevronLeft className="size-4" />
        </IconButton>
        <IconButton label="Вперёд" size="sm" onClick={() => step(1)}>
          <ChevronRight className="size-4" />
        </IconButton>
        <Button size="xs" variant="ghost" onClick={() => setAnchor(new Date())}>
          Сегодня
        </Button>
        <h2 className="ml-1 text-sm font-semibold">{title}</h2>

        <SegmentedControl
          className="ml-auto"
          label="Период календаря"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'month', label: 'Месяц' },
            { value: 'week', label: 'Неделя' },
            { value: 'day', label: 'День' },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-surface scrollbar-thin">
        {mode !== 'day' && (
          <div className="sticky top-0 z-10 grid grid-cols-7 border-b border-border bg-surface-sunken">
            {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((label) => (
              <div key={label} className="px-2 py-1.5 text-2xs font-semibold tracking-wide text-text-subtle uppercase">
                {label}
              </div>
            ))}
          </div>
        )}

        {query.isLoading ? (
          <div className="grid grid-cols-7 gap-px bg-border">
            {Array.from({ length: 35 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-none" />
            ))}
          </div>
        ) : (
          <div
            className={clsx(
              'grid gap-px bg-border',
              mode === 'day' ? 'grid-cols-1' : 'grid-cols-7',
            )}
          >
            {days.map((day) => {
              const key = format(day, 'yyyy-MM-dd');
              const dayIssues = byDay.get(key) ?? [];
              const outside = mode === 'month' && !isSameMonth(day, anchor);

              return (
                <div
                  key={key}
                  onDragOver={(event) => {
                    if (canEdit && dragIssueId) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (!dragIssueId || !canEdit) return;
                    const issue = issues.find((i) => i.id === dragIssueId);
                    setDragIssueId(null);
                    if (!issue || isSameDay(new Date(issue.dueDate ?? 0), day)) return;
                    // Noon UTC keeps the date stable across time zones.
                    const dueDate = new Date(`${key}T12:00:00.000Z`).toISOString();
                    patchIssue.mutate(
                      { issueId: issue.id, patch: { dueDate } },
                      { onSuccess: () => toast.success(`Срок ${issue.issueKey}: ${format(day, 'd MMM', { locale: ru })}`) },
                    );
                  }}
                  className={clsx(
                    'min-h-24 bg-surface p-1.5',
                    mode === 'day' && 'min-h-[60vh]',
                    mode === 'week' && 'min-h-[50vh]',
                    outside && 'bg-surface-sunken',
                  )}
                >
                  <div className="mb-1 flex items-center gap-1">
                    <span
                      className={clsx(
                        'fd-num inline-flex size-5 items-center justify-center text-2xs font-bold',
                        isToday(day)
                          ? 'bg-accent text-accent-fg'
                          : outside
                            ? 'text-text-subtle'
                            : 'text-text-muted',
                      )}
                    >
                      {format(day, 'd')}
                    </span>
                    {dayIssues.length > 0 && (
                      <span className="fd-num text-2xs text-text-subtle">{dayIssues.length}</span>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() =>
                          // Noon UTC, as on drop: the date stays the same in every time zone.
                          openCreateIssue({ projectId, dueDate: new Date(`${key}T12:00:00.000Z`).toISOString() })
                        }
                        aria-label={`Добавить задачу со сроком ${format(day, 'd MMMM', { locale: ru })}`}
                        className="ml-auto rounded-sm p-0.5 text-text-subtle opacity-0 hover:bg-surface-hover hover:text-text focus:opacity-100 [div:hover>&]:opacity-100 [@media(hover:none)]:hidden"
                      >
                        <Plus className="size-3" />
                      </button>
                    )}
                  </div>

                  {/* A phone-width month cell is ~50px: chips there showed an icon
                      and a clipped avatar, never a title. Phones get a dot per
                      task instead, and tapping the day opens it in day view. */}
                  {mode === 'month' && dayIssues.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setAnchor(day);
                        setMode('day');
                      }}
                      aria-label={`Задачи на ${format(day, 'd MMMM', { locale: ru })}: ${dayIssues.length}`}
                      className="flex w-full flex-wrap gap-1 py-1 sm:hidden"
                    >
                      {dayIssues.slice(0, 8).map((issue) => (
                        <span key={issue.id} className="size-1.5 bg-accent" aria-hidden="true" />
                      ))}
                    </button>
                  )}

                  {mode === 'day' && dayIssues.length === 0 && (
                    <p className="px-1 py-6 text-center text-sm text-text-subtle">
                      На этот день задач со сроком нет.
                    </p>
                  )}

                  <ul className={clsx('space-y-1', mode === 'month' && 'hidden sm:block')}>
                    {dayIssues.map((issue) => (
                      <li key={issue.id}>
                        <button
                          type="button"
                          draggable={canEdit}
                          onDragStart={() => setDragIssueId(issue.id)}
                          onDragEnd={() => setDragIssueId(null)}
                          onClick={() => openIssue(issue.id)}
                          className={clsx(
                            'flex w-full items-center gap-1 rounded-md border border-border bg-surface-sunken px-1.5 py-1 text-left',
                            'hover:border-border-strong hover:bg-surface-hover',
                            canEdit && 'cursor-grab active:cursor-grabbing',
                            dragIssueId === issue.id && 'opacity-40',
                          )}
                        >
                          <IssueTypeIcon type={issue.type} withTooltip={false} className="size-3 shrink-0" />
                          <span className="min-w-0 flex-1 truncate text-2xs">{issue.title}</span>
                          {issue.priority !== 'NONE' && (
                            <PriorityIcon priority={issue.priority} withTooltip={false} className="size-3 shrink-0" />
                          )}
                          <Avatar user={issue.assignee} size="xs" showEmpty={false} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
