import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { GANTT_SCALES, Permission, type GanttScale } from '@flowdesk/contracts';
import { CalendarClock, GitBranch, Layers, Plus, Settings2 } from 'lucide-react';
import { useSession } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import {
  useCreateDependency,
  useDeleteDependency,
  useGantt,
  useRescheduleIssue,
} from '~/features/gantt/hooks';
import { GanttChart } from '~/features/gantt/GanttChart';
import { SCALE_LABEL } from '~/features/gantt/scale';
import { GANTT_GROUP_LABELS, type GanttGroupBy } from '~/features/gantt/groups';
import { useProject } from '~/features/projects/hooks';
import { useFilterState } from '~/features/issues/useFilterState';
import { FilterBar } from '~/components/FilterBar';
import { Button, IconButton } from '~/ui/Button';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from '~/ui/Menu';
import { SegmentedControl } from '~/ui/Tabs';
import { Dialog } from '~/ui/Dialog';
import { EmptyState, ErrorState, Skeleton } from '~/ui/Feedback';
import { useLocalStorage } from '~/lib/hooks/useLocalStorage';
import type { ScheduleShiftDto } from '@flowdesk/contracts';

interface GanttSettings {
  baseline: boolean;
  overdue: boolean;
  assignee: boolean;
}

const DEFAULT_GANTT_SETTINGS: GanttSettings = { baseline: false, overdue: true, assignee: true };

/**
 * Gantt view: the project's work broken down, scheduled and linked. As in
 * Weeek it takes the same filters as the board, groups tasks by status,
 * assignee or priority, and a task without dates is put on the chart by
 * clicking a day on its row.
 *
 * Dates are written through a dedicated endpoint that also reports which
 * dependent work the move would break — the user decides whether to cascade,
 * because silently rescheduling someone else's task is not acceptable.
 */
export function GanttPage() {
  const { projectId = '' } = useParams();
  const { user } = useSession();
  const openIssue = useUiStore((s) => s.openIssue);
  const openCreateIssue = useUiStore((s) => s.openCreateIssue);

  const [scale, setScale] = useLocalStorage<GanttScale>('flowdesk.gantt-scale', 'WEEK');
  const [storedSettings, setSettings] = useLocalStorage<GanttSettings>('flowdesk.gantt-settings', DEFAULT_GANTT_SETTINGS);
  const settings: GanttSettings = { ...DEFAULT_GANTT_SETTINGS, ...storedSettings };
  const update = (next: Partial<GanttSettings>) => setSettings({ ...settings, ...next });
  const [groupBy, setGroupBy] = useLocalStorage<GanttGroupBy>('flowdesk.gantt-group', 'none');
  const [filters, setFilters] = useFilterState();
  const { data: project } = useProject(projectId);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pendingShifts, setPendingShifts] = useState<{
    issueId: string;
    start: string;
    end: string;
    shifts: ScheduleShiftDto[];
  } | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useGantt(projectId, filters);

  const reschedule = useRescheduleIssue(projectId);
  const createDependency = useCreateDependency(projectId);
  const deleteDependency = useDeleteDependency(projectId);

  const editable = data?.permissions.includes(Permission.ISSUE_UPDATE) ?? false;

  const toggleCollapse = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleReschedule = (issueId: string, start: string, end: string) => {
    reschedule.mutate(
      { issueId, startDate: start, dueDate: end, cascade: false },
      {
        onSuccess: (result) => {
          // Only interrupt when the move actually broke something downstream.
          if (result.suggestedShifts.length > 0) {
            // Remember the dates we sent — the cache may not have them
            // refetched yet when the user confirms the cascade.
            setPendingShifts({ issueId, start, end, shifts: result.suggestedShifts });
          }
        },
      },
    );
  };

  // Tasks without any dates still get a timeline to be placed on.
  const range = useMemo(() => {
    if (data?.range || !data?.rows.length) return data?.range ?? null;
    const start = new Date();
    start.setDate(start.getDate() - 7);
    const end = new Date();
    end.setDate(end.getDate() + 60);
    return { start: start.toISOString(), end: end.toISOString() };
  }, [data]);

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const option = (label: string, checked: boolean, onChange: () => void) => (
    <MenuItem key={label} keepOpen selected={checked} onSelect={onChange}>
      {label}
    </MenuItem>
  );

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

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <SegmentedControl
          label="Масштаб"
          value={scale}
          onChange={(value) => setScale(value as GanttScale)}
          options={GANTT_SCALES.map((value) => ({ value, label: SCALE_LABEL[value] }))}
        />


        <Menu>
          <MenuTrigger>
            <Button size="xs" variant="ghost" iconLeft={<Layers className="size-3" />}>
              {groupBy === 'none' ? 'Группировка' : `Группы: ${GANTT_GROUP_LABELS[groupBy].toLowerCase()}`}
            </Button>
          </MenuTrigger>
          <MenuContent width={200} label="Группировать задачи">
            <MenuLabel>Группировать по</MenuLabel>
            {(Object.keys(GANTT_GROUP_LABELS) as GanttGroupBy[]).map((value) => (
              <MenuItem key={value} selected={groupBy === value} onSelect={() => setGroupBy(value)}>
                {GANTT_GROUP_LABELS[value]}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>

        <div className="ml-auto flex items-center gap-2">
          {isFetching && <span className="text-2xs text-text-subtle">Обновляем…</span>}
          {data && data.unscheduledCount > 0 && (
            <span className="fd-num inline-flex items-center gap-1 border-2 border-border-strong bg-surface-active px-2 py-0.5 text-2xs text-text-muted">
              <CalendarClock className="size-3" />
              Без дат: {data.unscheduledCount}
            </span>
          )}
          {editable && (
            <Button
              size="xs"
              variant="secondary"
              iconLeft={<Plus className="size-3" />}
              onClick={() => openCreateIssue({ projectId })}
            >
              Задача
            </Button>
          )}
          <Menu>
            <MenuTrigger>
              <IconButton label="Настройки диаграммы" size="sm">
                <Settings2 className="size-4" />
              </IconButton>
            </MenuTrigger>
            <MenuContent align="end" width={240} label="Настройки диаграммы">
              <MenuLabel>Показывать</MenuLabel>
              {option('Просроченные красным', settings.overdue, () => update({ overdue: !settings.overdue }))}
              {option('Исполнителя', settings.assignee, () => update({ assignee: !settings.assignee }))}
              {option('Базовый план', settings.baseline, () => update({ baseline: !settings.baseline }))}
            </MenuContent>
          </Menu>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="flex min-h-0 flex-1 gap-3 p-3">
          <div className="w-64 space-y-2 sm:w-80">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
          <Skeleton className="flex-1" />
        </div>
      ) : !range ? (
        <EmptyState
          icon={<GitBranch className="size-6" />}
          title="Нечего показать на диаграмме"
          description={
            data.rows.length > 0
              ? 'Ни у одной задачи нет дат. Укажите даты начала и окончания — и работа появится на шкале.'
              : 'В проекте пока нет задач.'
          }
          action={
            editable ? (
              <Button
                size="sm"
                variant="primary"
                iconLeft={<Plus className="size-3.5" />}
                onClick={() => openCreateIssue({ projectId })}
              >
                Создать задачу
              </Button>
            ) : undefined
          }
        />
      ) : (
        <GanttChart
          rows={data.rows}
          dependencies={data.dependencies}
          range={range}
          scale={scale}
          editable={editable}
          showBaseline={settings.baseline}
          showOverdue={settings.overdue}
          showAssignee={settings.assignee}
          groupBy={groupBy}
          onSchedule={(issueId, day) => {
            const iso = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 12)).toISOString();
            reschedule.mutate({ issueId, startDate: iso, dueDate: iso, startHasTime: false, dueHasTime: false, cascade: false });
          }}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          onOpenIssue={openIssue}
          onReschedule={handleReschedule}
          onCreateDependency={(predecessorId, successorId) =>
            createDependency.mutate({
              predecessorId,
              successorId,
              type: 'FINISH_TO_START',
              lagDays: 0,
            })
          }
          onDeleteDependency={(id) => deleteDependency.mutate(id)}
        />
      )}

      {/* Legend */}
      {range && (
        <div className="fd-eyebrow flex items-center gap-4 overflow-x-auto border-t-2 border-border-strong bg-surface px-3 py-2 whitespace-nowrap no-scrollbar">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 border-2 border-border-strong bg-accent" />
            Критический путь
          </span>
          {settings.overdue && (
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 border-2 border-border-strong bg-danger" />
              Просрочено
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 border-2 border-border-strong bg-surface" />
            План
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 border-2 border-border-strong bg-success" />
            Готово
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rotate-45 border-2 border-border-strong bg-marker" />
            Веха
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0 w-4 border-t-2 border-dashed border-text-subtle/60" />
            Запас
          </span>
          {settings.baseline && (
            <span className="flex items-center gap-1.5">
              <span className="h-0 w-4 border-t-2 border-dashed border-border-strong" />
              Базовый план
            </span>
          )}
          {editable && (
            <span className="ml-auto hidden normal-case tracking-normal lg:inline">
              Перетащите полосу, чтобы сдвинуть · потяните за край, чтобы изменить длительность · у задачи без дат щёлкните день на её строке
            </span>
          )}
        </div>
      )}

      <CascadeDialog
        pending={pendingShifts}
        onClose={() => setPendingShifts(null)}
        onApply={() => {
          if (!pendingShifts) return;
          // Use the dates captured at reschedule time — re-reading the cache
          // here could send stale dates and undo the move we just made.
          reschedule.mutate({
            issueId: pendingShifts.issueId,
            startDate: pendingShifts.start,
            dueDate: pendingShifts.end,
            cascade: true,
          });
          setPendingShifts(null);
        }}
        pendingMutation={reschedule.isPending}
      />
    </div>
  );
}

/** Asks before moving work that belongs to someone else's plan. */
function CascadeDialog({
  pending,
  onClose,
  onApply,
  pendingMutation,
}: {
  pending: { issueId: string; shifts: ScheduleShiftDto[] } | null;
  onClose: () => void;
  onApply: () => void;
  pendingMutation: boolean;
}) {
  if (!pending) return null;

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Сдвинуть зависимые задачи?"
      description="Перенос нарушил связи. Эти задачи начинаются раньше, чем заканчивается предшественник."
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Оставить как есть
          </Button>
          <Button size="sm" variant="primary" loading={pendingMutation} onClick={onApply}>
            Сдвинуть {pending.shifts.length}
          </Button>
        </>
      }
    >
      <ul className="divide-y divide-border rounded-md border border-border">
        {pending.shifts.map((shift) => (
          <li key={shift.issueId} className="flex items-center gap-2 p-2">
            <span className="fd-key shrink-0">{shift.issueKey}</span>
            <span className="min-w-0 flex-1 truncate text-xs">{shift.title}</span>
            <span className="fd-num shrink-0 text-2xs text-warning">+{shift.days} дн</span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
