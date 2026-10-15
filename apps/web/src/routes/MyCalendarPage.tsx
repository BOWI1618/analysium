import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { addDays, eachDayOfInterval, format, isSameMonth, isSameYear, startOfDay, startOfWeek } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { IssueSummaryDto, ProjectDetailDto, UpdateIssueInput } from '@flowdesk/contracts';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSession } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { useLocalStorage } from '~/lib/hooks/useLocalStorage';
import { flattenPages, useIssueList, usePatchIssue } from '~/features/issues/hooks';
import { TimeGridView } from '~/features/calendar/TimeGridView';
import type { CalendarDrag, CardFields } from '~/features/calendar/CalendarCard';
import { doneStatusId, placeAt, reopenStatusId, toItem, type CalendarItem } from '~/features/calendar/items';
import { Topbar } from '~/components/Topbar';
import { Button, IconButton } from '~/ui/Button';
import { SegmentedControl } from '~/ui/Tabs';
import { ErrorState, SkeletonRows, StaleNotice } from '~/ui/Feedback';

type Mode = 'day' | 'workweek' | 'week';

const MODES: { value: Mode; label: string }[] = [
  { value: 'day', label: 'День' },
  { value: 'workweek', label: '5 дней' },
  { value: 'week', label: 'Неделя' },
];

/** Pages of 200 loaded for one period before the page says the picture is incomplete. */
const PERIOD_PAGES_MAX = 10;
const FIELDS: CardFields = { assignee: false, priority: true, labels: false };

/**
 * A slot of the day: the task starts and ends at a set time on the same date.
 * Periods over several days and dates without a time are planned elsewhere —
 * here they would only crowd the hours.
 */
function isSlot(item: CalendarItem | null): item is CalendarItem {
  if (!item?.timed) return false;
  const { issue } = item;
  return Boolean(issue.startDate && issue.startHasTime && issue.dueDate && issue.dueHasTime);
}

/**
 * «Календарь»: one's own day by the hour across every project, the way Weeek
 * shows it — a day, the working days, or the whole week. Only tasks set from
 * one time to another within a day are on it.
 */
export function MyCalendarPage() {
  const { user, workspace } = useSession();
  const workspaceId = workspace?.id ?? '';
  const userId = user?.id ?? '';
  const openIssue = useUiStore((s) => s.openIssue);
  const openCreateIssue = useUiStore((s) => s.openCreateIssue);
  const queryClient = useQueryClient();
  const patchIssue = usePatchIssue();

  const [mode, setMode] = useLocalStorage<Mode>('flowdesk.my-calendar-mode', 'week');
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [drag, setDrag] = useState<CalendarDrag | null>(null);

  const days = useMemo(() => {
    if (mode === 'day') return [anchor];
    const monday = startOfWeek(anchor, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: monday, end: addDays(monday, mode === 'week' ? 6 : 4) });
  }, [anchor, mode]);
  const first = days[0]!;
  const last = days[days.length - 1]!;

  const query = useIssueList(
    { workspaceId },
    {
      assigneeId: ['@me'],
      includeSubtasks: true,
      overlapsFrom: startOfDay(first).toISOString(),
      overlapsTo: new Date(addDays(startOfDay(last), 1).getTime() - 1).toISOString(),
      sort: 'dueDate',
      order: 'asc',
    },
    { limit: 200, enabled: Boolean(workspaceId) },
  );

  // An empty hour must mean a free hour: the rest of the period is fetched as
  // soon as it is known there is more, up to a bound the page then admits to.
  const periodPages = query.data?.pages.length ?? 0;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && periodPages < PERIOD_PAGES_MAX) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, periodPages, fetchNextPage]);
  const incomplete = Boolean(hasNextPage) && periodPages >= PERIOD_PAGES_MAX;

  const issues = useMemo(() => flattenPages(query.data), [query.data]);
  const items = useMemo(() => issues.map(toItem).filter(isSlot), [issues]);

  const findIssue = (id: string): IssueSummaryDto | undefined => issues.find((issue) => issue.id === id);
  const patch = (issueId: string, values: UpdateIssueInput) => patchIssue.mutate({ issueId, patch: values });

  const dropAt = (day: Date, minutes: number) => {
    const issue = drag && findIssue(drag.issueId);
    if (!drag || !issue) return;
    patch(issue.id, placeAt(toItem(issue), issue, day, minutes));
    setDrag(null);
  };

  // Tasks come from many projects, each with statuses of its own: the project
  // is read when a task is closed, not in advance for all of them.
  const toggleDone = async (item: CalendarItem) => {
    const projectId = item.issue.project.id;
    const project = await queryClient.fetchQuery({
      queryKey: qk.project(projectId),
      queryFn: () => api.get<ProjectDetailDto>(`/projects/${projectId}`),
      staleTime: 20_000,
    });
    const statusId = item.done ? reopenStatusId(project.statuses) : doneStatusId(project.statuses);
    if (statusId) patch(item.issue.id, { statusId });
  };

  const createAt = (day: Date, minutes: number) => {
    const start = new Date(day);
    start.setHours(0, minutes, 0, 0);
    openCreateIssue({
      assigneeId: userId,
      startDate: start.toISOString(),
      startHasTime: true,
      dueDate: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
      dueHasTime: true,
    });
  };

  const step = (direction: 1 | -1) => setAnchor((prev) => addDays(prev, (mode === 'day' ? 1 : 7) * direction));

  const title =
    mode === 'day'
      ? format(anchor, 'EEEE, d MMMM yyyy', { locale: ru })
      : isSameMonth(first, last)
        ? `${format(first, 'd')} – ${format(last, 'd MMMM yyyy', { locale: ru })}`
        : `${format(first, isSameYear(first, last) ? 'd MMMM' : 'd MMMM yyyy', { locale: ru })} – ${format(last, 'd MMMM yyyy', { locale: ru })}`;

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'Календарь' }]} />
      <div className="flex min-h-0 flex-1 flex-col">
        <StaleNotice query={query} />
        <div className="flex flex-wrap items-center gap-2 border-b-2 border-border-strong bg-surface px-3 py-2">
          <IconButton label="Назад" size="sm" onClick={() => step(-1)}>
            <ChevronLeft className="size-4" />
          </IconButton>
          <IconButton label="Вперёд" size="sm" onClick={() => step(1)}>
            <ChevronRight className="size-4" />
          </IconButton>
          <Button size="xs" variant="ghost" onClick={() => setAnchor(startOfDay(new Date()))}>
            Сегодня
          </Button>
          <input
            type="date"
            aria-label="Перейти к дате"
            value={format(anchor, 'yyyy-MM-dd')}
            onChange={(event) => event.target.value && setAnchor(startOfDay(new Date(`${event.target.value}T00:00:00`)))}
            className="h-7 border-2 border-border-strong bg-surface px-1.5 text-xs"
          />
          <h1 className="ml-1 text-sm font-semibold first-letter:uppercase">{title}</h1>
          {hasNextPage && !incomplete && <span className="text-2xs text-text-subtle">Загружаем остальные задачи…</span>}
          {incomplete && (
            <span role="status" className="border-2 border-border-strong bg-marker px-2 py-0.5 text-2xs font-bold text-ink">
              Показаны не все задачи периода
            </span>
          )}
          {!query.isLoading && !hasNextPage && items.length === 0 && (
            <span className="text-2xs text-text-subtle">
              Нет задач со временем начала и окончания — здесь показываются только такие.
            </span>
          )}
          <div className="ml-auto">
            <SegmentedControl label="Период календаря" value={mode} onChange={setMode} options={MODES} />
          </div>
        </div>

        {query.error && !query.data ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : query.isLoading ? (
          <SkeletonRows rows={10} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col bg-surface">
            <TimeGridView
              days={days}
              items={items}
              fields={FIELDS}
              canEdit
              dayStartsAt={8}
              drag={drag}
              onDragChange={setDrag}
              onOpen={openIssue}
              onToggleDone={(item) => void toggleDone(item)}
              onDropAt={dropAt}
              onResize={(item, end) =>
                patch(item.issue.id, {
                  startDate: item.start.toISOString(),
                  startHasTime: true,
                  dueDate: end.toISOString(),
                  dueHasTime: true,
                })
              }
              onCreateAt={createAt}
            />
          </div>
        )}
      </div>
    </>
  );
}
