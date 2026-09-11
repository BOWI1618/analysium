import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { GANTT_SCALES, Permission, type GanttScale } from '@flowdesk/contracts';
import { CalendarClock, GitBranch, Plus } from 'lucide-react';
import { useSession } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import { useProject } from '~/features/projects/hooks';
import {
  useCreateDependency,
  useDeleteDependency,
  useGantt,
  useRescheduleIssue,
} from '~/features/gantt/hooks';
import { GanttChart } from '~/features/gantt/GanttChart';
import { SCALE_LABEL } from '~/features/gantt/scale';
import { Button } from '~/ui/Button';
import { Checkbox } from '~/ui/Input';
import { SegmentedControl } from '~/ui/Tabs';
import { Dialog } from '~/ui/Dialog';
import { EmptyState, ErrorState, Skeleton } from '~/ui/Feedback';
import { useLocalStorage } from '~/lib/hooks/useLocalStorage';
import type { ScheduleShiftDto } from '@flowdesk/contracts';

/**
 * Gantt view: the project's work broken down, scheduled and linked.
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
  const [showBaseline, setShowBaseline] = useLocalStorage('flowdesk.gantt-baseline', false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [includeDone, setIncludeDone] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pendingShifts, setPendingShifts] = useState<{
    issueId: string;
    shifts: ScheduleShiftDto[];
  } | null>(null);

  const filters = useMemo(
    () => ({ includeDone, ...(onlyMine && user ? { assigneeId: ['@me'] } : {}) }),
    [includeDone, onlyMine, user],
  );

  const { data: project } = useProject(projectId);
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
            setPendingShifts({ issueId, shifts: result.suggestedShifts });
          }
        },
      },
    );
  };

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <SegmentedControl
          label="Масштаб"
          value={scale}
          onChange={(value) => setScale(value as GanttScale)}
          options={GANTT_SCALES.map((value) => ({ value, label: SCALE_LABEL[value] }))}
        />

        <div className="hidden flex-wrap items-center gap-2 md:flex">
          <Checkbox
            checked={showBaseline}
            onChange={(event) => setShowBaseline(event.target.checked)}
            label={<span className="text-xs text-text-muted">Базовый план</span>}
          />
          <Checkbox
            checked={onlyMine}
            onChange={(event) => setOnlyMine(event.target.checked)}
            label={<span className="text-xs text-text-muted">Только мои</span>}
          />
          <Checkbox
            checked={includeDone}
            onChange={(event) => setIncludeDone(event.target.checked)}
            label={<span className="text-xs text-text-muted">С завершёнными</span>}
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          {isFetching && <span className="text-2xs text-text-subtle">Обновляем…</span>}
          {data && data.unscheduledCount > 0 && (
            <span className="fd-num inline-flex items-center gap-1 rounded-full bg-surface-active px-2 py-0.5 text-2xs text-text-muted">
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
      ) : !data.range ? (
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
          range={data.range}
          scale={scale}
          editable={editable}
          showBaseline={showBaseline}
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
      {data?.range && (
        <div className="flex items-center gap-4 overflow-x-auto border-t border-border bg-surface px-3 py-1.5 text-2xs whitespace-nowrap text-text-subtle no-scrollbar">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-xs border border-danger-border bg-danger-subtle" />
            Критический путь
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-xs border border-warning-border bg-warning-subtle" />
            Просрочено
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rotate-45 rounded-xs bg-accent" />
            Веха
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0 w-4 border-t border-dashed border-text-subtle/60" />
            Запас
          </span>
          {showBaseline && (
            <span className="flex items-center gap-1.5">
              <span className="h-0 w-4 border-t border-dashed border-border-strong" />
              Базовый план
            </span>
          )}
          {editable && (
            <span className="ml-auto hidden lg:inline">
              Перетащите полосу, чтобы сдвинуть · потяните за край, чтобы изменить длительность
            </span>
          )}
        </div>
      )}

      <CascadeDialog
        pending={pendingShifts}
        onClose={() => setPendingShifts(null)}
        onApply={() => {
          if (!pendingShifts) return;
          const row = data?.rows.find((r) => r.id === pendingShifts.issueId);
          if (row?.start && row.end) {
            reschedule.mutate({
              issueId: pendingShifts.issueId,
              startDate: row.start,
              dueDate: row.end,
              cascade: true,
            });
          }
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
