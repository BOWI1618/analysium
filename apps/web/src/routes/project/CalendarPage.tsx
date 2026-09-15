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
  isWeekend,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { Permission, type IssueSummaryDto, type UpdateIssueInput } from '@flowdesk/contracts';
import { CalendarX2, ChevronLeft, ChevronRight, Settings2 } from 'lucide-react';
import { useSession } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import { useProject } from '~/features/projects/hooks';
import { useIssueList, usePatchIssue, flattenPages } from '~/features/issues/hooks';
import { useFilterState } from '~/features/issues/useFilterState';
import { FilterBar } from '~/components/FilterBar';
import { Button, IconButton } from '~/ui/Button';
import { SegmentedControl } from '~/ui/Tabs';
import { ErrorState, Skeleton } from '~/ui/Feedback';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '~/ui/Menu';
import { useLocalStorage } from '~/lib/hooks/useLocalStorage';
import { CalendarCard, startCardDrag, type CalendarDrag, type CardFields } from '~/features/calendar/CalendarCard';
import { WeekView } from '~/features/calendar/WeekView';
import { DayView } from '~/features/calendar/DayView';
import { MonthView } from '~/features/calendar/MonthView';
import {
  doneStatusId,
  makeWholeDay,
  moveToDay,
  placeAt,
  reopenStatusId,
  toItem,
  wholeDay,
  type CalendarItem,
} from '~/features/calendar/items';

type CalendarMode = 'month' | 'week' | 'day';

interface CalendarSettings {
  /** A week from Monday, or seven days from today. */
  weekStart: 'monday' | 'today';
  weekends: boolean;
  periods: boolean;
  fields: CardFields;
  /** Where a day by the hour opens when it is not today. */
  dayStartsAt: number;
}

const DEFAULT_SETTINGS: CalendarSettings = {
  weekStart: 'monday',
  weekends: true,
  periods: true,
  fields: { assignee: true, priority: true, labels: false },
  dayStartsAt: 8,
};

/**
 * The project calendar, arranged the way Weeek arranges one: a week of day
 * columns with periods across the top, a day by the hour, and a month. Tasks
 * are dragged between days and hours, closed with a checkbox, and added right
 * where they should land; tasks with no dates wait on the side to be placed.
 */
export function CalendarPage() {
  const { projectId = '' } = useParams();
  const { user } = useSession();
  const openIssue = useUiStore((s) => s.openIssue);
  const openCreateIssue = useUiStore((s) => s.openCreateIssue);

  const [filters, setFilters] = useFilterState();
  const [mode, setMode] = useLocalStorage<CalendarMode>('flowdesk.calendar-mode', 'week');
  const [stored, setSettings] = useLocalStorage<CalendarSettings>('flowdesk.calendar-settings', DEFAULT_SETTINGS);
  const settings: CalendarSettings = {
    ...DEFAULT_SETTINGS,
    ...stored,
    fields: { ...DEFAULT_SETTINGS.fields, ...stored?.fields },
  };
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [drag, setDrag] = useState<CalendarDrag | null>(null);
  const [unscheduledOpen, setUnscheduledOpen] = useLocalStorage('flowdesk.calendar-unscheduled', false);

  const { data: project } = useProject(projectId);
  const patchIssue = usePatchIssue();
  const canEdit = project?.permissions.includes(Permission.ISSUE_UPDATE) ?? false;

  const update = (next: Partial<CalendarSettings>) => setSettings({ ...settings, ...next });

  /* ---------------------------------------------------------- the period */

  const { days, weeks } = useMemo(() => {
    const visible = (list: Date[]) => (settings.weekends ? list : list.filter((d) => !isWeekend(d)));
    if (mode === 'day') return { days: [anchor], weeks: [] as Date[][] };
    if (mode === 'week') {
      const start = settings.weekStart === 'today' ? anchor : startOfWeek(anchor, { weekStartsOn: 1 });
      return { days: visible(eachDayOfInterval({ start, end: addDays(start, 6) })), weeks: [] as Date[][] };
    }
    const all = eachDayOfInterval({
      start: startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 }),
      end: endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 }),
    });
    const grouped: Date[][] = [];
    for (let i = 0; i < all.length; i += 7) grouped.push(visible(all.slice(i, i + 7)));
    return { days: visible(all), weeks: grouped };
  }, [anchor, mode, settings.weekStart, settings.weekends]);

  const rangeStart = days[0] ?? anchor;
  const rangeEnd = days[days.length - 1] ?? anchor;

  const query = useIssueList(
    { projectId },
    {
      ...filters,
      overlapsFrom: startOfDay(rangeStart).toISOString(),
      overlapsTo: new Date(startOfDay(rangeEnd).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString(),
      sort: 'dueDate',
      order: 'asc',
    },
    { limit: 200 },
  );
  const unscheduledQuery = useIssueList(
    { projectId },
    { ...filters, noDates: true, sort: 'updated', order: 'desc' },
    { limit: 100, enabled: unscheduledOpen },
  );

  const issues = useMemo(() => flattenPages(query.data), [query.data]);
  const unscheduled = useMemo(() => flattenPages(unscheduledQuery.data), [unscheduledQuery.data]);
  const items = useMemo(() => issues.map(toItem).filter((item): item is CalendarItem => item !== null), [issues]);

  /* -------------------------------------------------------------- actions */

  const findIssue = (id: string): IssueSummaryDto | undefined =>
    issues.find((i) => i.id === id) ?? unscheduled.find((i) => i.id === id);

  const patch = (issueId: string, values: UpdateIssueInput) => patchIssue.mutate({ issueId, patch: values });

  const dropOnDay = (day: Date) => {
    const issue = drag && findIssue(drag.issueId);
    if (!drag || !issue) return;
    patch(issue.id, moveToDay(issue, drag.fromKey, day));
    setDrag(null);
  };

  const dropAtTime = (minutes: number) => {
    const issue = drag && findIssue(drag.issueId);
    if (!drag || !issue) return;
    patch(issue.id, placeAt(toItem(issue), issue, anchor, minutes));
    setDrag(null);
  };

  const dropWholeDay = () => {
    const issue = drag && findIssue(drag.issueId);
    if (!drag || !issue) return;
    const item = toItem(issue);
    // A task already on the whole day of some date simply moves; one with a time loses it.
    patch(issue.id, item && !item.timed ? moveToDay(issue, drag.fromKey, anchor) : makeWholeDay(anchor));
    setDrag(null);
  };

  const toggleDone = (item: CalendarItem) => {
    const statuses = project?.statuses ?? [];
    const statusId = item.done ? reopenStatusId(statuses) : doneStatusId(statuses);
    if (statusId) patch(item.issue.id, { statusId });
  };

  const createOnDay = (day: Date) => openCreateIssue({ projectId, dueDate: wholeDay(day), dueHasTime: false });
  const createAt = (minutes: number) => {
    const start = new Date(anchor);
    start.setHours(0, minutes, 0, 0);
    openCreateIssue({
      projectId,
      startDate: start.toISOString(),
      startHasTime: true,
      dueDate: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
      dueHasTime: true,
    });
  };

  const openDay = (day: Date) => {
    setAnchor(startOfDay(day));
    setMode('day');
  };

  const step = (direction: 1 | -1) => {
    if (mode === 'month') setAnchor((prev) => (direction === 1 ? addMonths(prev, 1) : subMonths(prev, 1)));
    else if (mode === 'week') setAnchor((prev) => addDays(prev, 7 * direction));
    else setAnchor((prev) => addDays(prev, direction));
  };

  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const title =
    mode === 'day'
      ? format(anchor, 'EEEE, d MMMM yyyy', { locale: ru })
      : mode === 'week'
        ? `${format(rangeStart, 'd MMM', { locale: ru })} – ${format(rangeEnd, 'd MMM yyyy', { locale: ru })}`
        : format(anchor, 'LLLL yyyy', { locale: ru });

  const option = (label: string, checked: boolean, onChange: () => void) => (
    <MenuItem key={label} keepOpen selected={checked} onSelect={onChange}>
      {label}
    </MenuItem>
  );

  const viewProps = {
    items,
    fields: settings.fields,
    canEdit,
    drag,
    onDragChange: setDrag,
    onOpen: openIssue,
    onToggleDone: toggleDone,
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
        <h2 className="ml-1 text-sm font-semibold first-letter:uppercase">{title}</h2>

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="xs"
            variant={unscheduledOpen ? 'secondary' : 'ghost'}
            iconLeft={<CalendarX2 className="size-3.5" />}
            aria-pressed={unscheduledOpen}
            onClick={() => setUnscheduledOpen(!unscheduledOpen)}
          >
            Без срока
          </Button>

          <Menu>
            <MenuTrigger>
              <IconButton label="Настройки календаря" size="sm">
                <Settings2 className="size-4" />
              </IconButton>
            </MenuTrigger>
            <MenuContent align="end" width={240} label="Настройки календаря">
              <MenuLabel>Неделя</MenuLabel>
              {option('С понедельника', settings.weekStart === 'monday', () => update({ weekStart: 'monday' }))}
              {option('С сегодняшнего дня', settings.weekStart === 'today', () => update({ weekStart: 'today' }))}
              {option('Показывать выходные', settings.weekends, () => update({ weekends: !settings.weekends }))}
              <MenuSeparator />
              <MenuLabel>Задачи</MenuLabel>
              {option('Задачи с периодом', settings.periods, () => update({ periods: !settings.periods }))}
              <MenuSeparator />
              <MenuLabel>На карточке</MenuLabel>
              {option('Исполнитель', settings.fields.assignee, () =>
                update({ fields: { ...settings.fields, assignee: !settings.fields.assignee } }),
              )}
              {option('Приоритет', settings.fields.priority, () =>
                update({ fields: { ...settings.fields, priority: !settings.fields.priority } }),
              )}
              {option('Метки', settings.fields.labels, () =>
                update({ fields: { ...settings.fields, labels: !settings.fields.labels } }),
              )}
              <MenuSeparator />
              <MenuLabel>День по часам открывается с</MenuLabel>
              {[7, 8, 9, 10].map((hour) =>
                option(`${String(hour).padStart(2, '0')}:00`, settings.dayStartsAt === hour, () =>
                  update({ dayStartsAt: hour }),
                ),
              )}
            </MenuContent>
          </Menu>

          <SegmentedControl
            label="Период календаря"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'day', label: 'День' },
              { value: 'week', label: 'Неделя' },
              { value: 'month', label: 'Месяц' },
            ]}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className={clsx('min-h-0 min-w-0 flex-1 bg-surface', mode === 'day' ? 'flex flex-col' : 'overflow-auto scrollbar-thin')}>
          {query.isLoading ? (
            <div className="grid grid-cols-7 gap-px bg-border">
              {Array.from({ length: 14 }).map((_, i) => (
                <Skeleton key={i} className="h-40 rounded-none" />
              ))}
            </div>
          ) : mode === 'day' ? (
            <DayView
              {...viewProps}
              day={anchor}
              dayStartsAt={settings.dayStartsAt}
              onDropAtTime={dropAtTime}
              onDropWholeDay={dropWholeDay}
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
          ) : mode === 'week' ? (
            <WeekView
              {...viewProps}
              days={days}
              showPeriods={settings.periods}
              onDropOnDay={dropOnDay}
              onCreate={createOnDay}
              onOpenDay={openDay}
            />
          ) : (
            <MonthView
              {...viewProps}
              weeks={weeks}
              anchor={anchor}
              showPeriods={settings.periods}
              onDropOnDay={dropOnDay}
              onCreate={createOnDay}
              onOpenDay={openDay}
            />
          )}
        </div>

        {unscheduledOpen && (
          <aside
            aria-label="Задачи без срока"
            className="flex w-64 shrink-0 flex-col border-l-2 border-border-strong bg-surface-sunken"
          >
            <div className="border-b-2 border-border-strong px-3 py-2">
              <h3 className="fd-eyebrow">Без срока · {unscheduled.length}</h3>
              <p className="mt-0.5 text-2xs text-text-subtle">
                {canEdit ? 'Перетащите задачу на день или на час, чтобы запланировать.' : 'Задачи, у которых нет дат.'}
              </p>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2 scrollbar-thin">
              {unscheduledQuery.isLoading ? (
                <Skeleton className="h-24" />
              ) : unscheduled.length === 0 ? (
                <p className="px-1 py-4 text-center text-2xs text-text-subtle">Все задачи уже с датами.</p>
              ) : (
                unscheduled.map((issue) => {
                  // No place in time yet: the card needs only the task's look.
                  const item: CalendarItem = {
                    issue,
                    start: new Date(0),
                    end: new Date(0),
                    timed: false,
                    period: false,
                    startKey: '',
                    endKey: '',
                    done: issue.status.category === 'COMPLETED' || issue.status.category === 'CANCELED',
                  };
                  return (
                    <CalendarCard
                      key={issue.id}
                      item={item}
                      fields={settings.fields}
                      canEdit={canEdit}
                      dragging={drag?.issueId === issue.id}
                      onOpen={() => openIssue(issue.id)}
                      onToggleDone={() => toggleDone(item)}
                      onDragStart={(event) => setDrag(startCardDrag(event, null, issue.id, null))}
                      onDragEnd={() => setDrag(null)}
                    />
                  );
                })
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
