import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import clsx from 'clsx';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine } from 'lucide-react';
import {
  compareByPriorityAndDue,
  StatusCategory,
  type IssueSummaryDto,
  type ProjectDetailDto,
} from '@flowdesk/contracts';
import { useToast } from '~/app/toast';
import { usePatchIssue } from '~/features/issues/hooks';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { IssueCard } from './IssueCard';
import { doneStatusId, isClosedStatus, reopenStatusId } from './DoneToggle';
import { EmptyState } from '~/ui/Feedback';

/**
 * Stages every project's statuses fall into. Tasks from many projects share
 * no statuses, but each status belongs to one of these, so a board across
 * projects is laid out by them.
 */
const STAGES: { category: StatusCategory; label: string; color: string }[] = [
  { category: StatusCategory.BACKLOG, label: 'Бэклог', color: '#d97706' },
  { category: StatusCategory.UNSTARTED, label: 'К выполнению', color: '#7c88a1' },
  { category: StatusCategory.STARTED, label: 'В работе', color: '#0083ca' },
  { category: StatusCategory.COMPLETED, label: 'Готово', color: '#22c55e' },
  { category: StatusCategory.CANCELED, label: 'Отменено', color: '#9fb0c6' },
];

/**
 * Kanban across projects — «Мои задачи», «Задачи сотрудника». A card dropped
 * into a stage takes the first status of that stage in its own project;
 * cards in a column stand by priority, then deadline, like everywhere else.
 */
export function StageBoard({
  issues,
  onOpenIssue,
  footer,
}: {
  issues: IssueSummaryDto[];
  onOpenIssue: (issueId: string) => void;
  /** Under the columns: how many are loaded, «Загрузить ещё». */
  footer?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const patchIssue = usePatchIssue();
  const [dragging, setDragging] = useState<IssueSummaryDto | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  // Where a card was dropped, shown at once and kept until the list comes back
  // from the server with the task in that stage — or the change fails.
  const [moved, setMoved] = useState<Record<string, StatusCategory>>({});

  useEffect(() => {
    setMoved((current) => {
      const next = { ...current };
      for (const issue of issues) if (next[issue.id] === issue.status.category) delete next[issue.id];
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [issues]);

  const stageOf = (issue: IssueSummaryDto) => moved[issue.id] ?? issue.status.category;

  const columns = useMemo(() => {
    const byStage = new Map<string, IssueSummaryDto[]>();
    for (const issue of issues) {
      const stage = moved[issue.id] ?? issue.status.category;
      byStage.set(stage, [...(byStage.get(stage) ?? []), issue]);
    }
    return STAGES
      // «Отменено» only when something is there: it is rarely a place to put a task.
      .filter((stage) => stage.category !== StatusCategory.CANCELED || byStage.has(stage.category))
      .map((stage) => ({ ...stage, issues: [...(byStage.get(stage.category) ?? [])].sort(compareByPriorityAndDue) }));
  }, [issues, moved]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const moveTo = async (issue: IssueSummaryDto, category: StatusCategory) => {
    let project: ProjectDetailDto;
    try {
      project = await queryClient.fetchQuery({
        queryKey: qk.project(issue.projectId),
        queryFn: () => api.get<ProjectDetailDto>(`/projects/${issue.projectId}`),
        staleTime: 20_000,
      });
    } catch (error) {
      toast.error(error, 'Не удалось сменить статус');
      return;
    }
    const statuses = [...project.statuses].sort((a, b) => a.position - b.position);
    const statusId =
      category === StatusCategory.COMPLETED
        ? doneStatusId(statuses)
        : category === StatusCategory.UNSTARTED && isClosedStatus(issue.status)
          ? reopenStatusId(statuses)
          : statuses.find((s) => s.category === category)?.id;
    const stage = STAGES.find((s) => s.category === category)!;
    if (!statusId) {
      toast.toast({ tone: 'error', title: `В проекте «${project.name}» нет статуса для стадии «${stage.label}»` });
      return;
    }
    setMoved((current) => ({ ...current, [issue.id]: category }));
    patchIssue.mutate(
      { issueId: issue.id, patch: { statusId } },
      {
        onError: () =>
          setMoved((current) => {
            const next = { ...current };
            delete next[issue.id];
            return next;
          }),
      },
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    setOverStage(null);
    const issue = issues.find((i) => i.id === String(event.active.id));
    const category = event.over ? (String(event.over.id) as StatusCategory) : null;
    if (!issue || !category || stageOf(issue) === category) return;
    void moveTo(issue, category);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(event) => setDragging(issues.find((i) => i.id === String(event.active.id)) ?? null)}
      onDragOver={(event) => setOverStage(event.over ? String(event.over.id) : null)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setDragging(null);
        setOverStage(null);
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col bg-bg">
        <div className="min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden scroll-px-4 scrollbar-thin sm:snap-none">
          <div className="flex h-full min-w-max items-stretch gap-4 p-4 pt-6">
            {columns.map((column) => (
              <StageColumn
                key={column.category}
                column={column}
                dropTarget={Boolean(dragging) && overStage === column.category && stageOf(dragging!) !== column.category}
                onOpenIssue={onOpenIssue}
                onToggleDone={(issue) =>
                  void moveTo(issue, isClosedStatus(issue.status) ? StatusCategory.UNSTARTED : StatusCategory.COMPLETED)
                }
              />
            ))}
          </div>
        </div>
        {footer}
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }}>
        {dragging && (
          <div className="w-72 rotate-1" style={{ boxShadow: 'var(--shadow-drag)' }}>
            <IssueCard issue={dragging} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function StageColumn({
  column,
  dropTarget,
  onOpenIssue,
  onToggleDone,
}: {
  column: { category: StatusCategory; label: string; color: string; issues: IssueSummaryDto[] };
  dropTarget: boolean;
  onOpenIssue: (issueId: string) => void;
  onToggleDone: (issue: IssueSummaryDto) => void;
}) {
  const { setNodeRef } = useDroppable({ id: column.category });
  // As on a project's board: the work in hand is printed in the accent.
  const isActive = column.category === StatusCategory.STARTED;

  return (
    <section
      ref={setNodeRef}
      aria-label={`Колонка «${column.label}»`}
      className={clsx(
        'relative flex w-[min(18rem,calc(100vw-3rem))] shrink-0 snap-start flex-col border-2 sm:w-72',
        'transition-[box-shadow,outline-color] duration-100',
        isActive ? 'bg-surface shadow-xl lg:-translate-y-2' : 'bg-bg-subtle shadow-md',
        dropTarget ? 'border-accent outline-4 outline-offset-2 outline-accent' : 'border-border-strong outline-transparent',
      )}
    >
      <header
        className={clsx(
          'flex items-center gap-2 border-b-2 border-border-strong px-3 py-2',
          isActive ? 'bg-accent text-accent-fg' : 'bg-surface',
        )}
      >
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 border border-border-strong"
          style={{ backgroundColor: isActive ? 'var(--accent-fg)' : column.color }}
        />
        <h2 className="truncate font-mono text-2xs font-bold tracking-widest uppercase">{column.label}</h2>
        <span className={clsx('fd-num text-2xs', !isActive && 'text-text-subtle')}>{column.issues.length}</span>
      </header>

      <div className={clsx('min-h-0 flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin', dropTarget && 'bg-accent-subtle')}>
        {dropTarget && (
          <div className="mt-2 flex items-center justify-center gap-1.5 border-2 border-dashed border-accent bg-surface py-3 text-xs font-bold text-accent">
            <ArrowDownToLine className="size-3.5" />
            Перенести в «{column.label}»
          </div>
        )}
        <div className="flex flex-col gap-2 pt-2">
          {column.issues.map((issue) => (
            <DraggableCard
              key={issue.id}
              issue={issue}
              onClick={() => onOpenIssue(issue.id)}
              onToggleDone={() => onToggleDone(issue)}
            />
          ))}
        </div>
        {column.issues.length === 0 && !dropTarget && (
          <EmptyState compact className="mt-2 border-2 border-dashed border-border-strong py-6" title="Пусто" />
        )}
      </div>
    </section>
  );
}

function DraggableCard({
  issue,
  onClick,
  onToggleDone,
}: {
  issue: IssueSummaryDto;
  onClick: () => void;
  onToggleDone: () => void;
}) {
  // The card stays in place, dimmed; the copy in the drag overlay follows the pointer.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: issue.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners}>
      <IssueCard issue={issue} isDragging={isDragging} onClick={onClick} onToggleDone={onToggleDone} />
    </div>
  );
}
