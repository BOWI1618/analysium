import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';
import type { IssueSummaryDto, StatusDto } from '@flowdesk/contracts';
import { Permission } from '@flowdesk/contracts';
import { Plus, AlertTriangle } from 'lucide-react';
import { useSession } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import { useProject } from '~/features/projects/hooks';
import { useSprints } from '~/features/sprints/hooks';
import { useBoard, useIssueList, useMoveIssue } from '~/features/issues/hooks';
import { useFilterState } from '~/features/issues/useFilterState';
import type { BoardColumnDto } from '~/features/issues/types';
import { FilterBar } from '~/components/FilterBar';
import { IssueCard } from '~/components/IssueCard';
import { StatusDot } from '~/components/IssueMeta';
import { EmptyState, ErrorState, SkeletonCard } from '~/ui/Feedback';
import { Button } from '~/ui/Button';
import { Tooltip } from '~/ui/Tooltip';

/**
 * Kanban board.
 *
 * Each column is fetched with its own limit so a project with thousands of
 * completed issues still renders instantly, and a drag writes a single
 * fractional rank rather than renumbering the column.
 */
export function BoardPage() {
  const { projectId = '' } = useParams();
  const { user } = useSession();
  const openIssue = useUiStore((s) => s.openIssue);
  const openCreateIssue = useUiStore((s) => s.openCreateIssue);

  const [filters, setFilters] = useFilterState();
  const { data: project } = useProject(projectId);
  const { data: sprints } = useSprints(project?.projectType === 'SCRUM' ? projectId : undefined);
  const { data: board, isLoading, error, refetch, isFetching } = useBoard(projectId, filters);
  const { data: epicPages } = useIssueList({ projectId }, { type: ['EPIC'], includeDone: true });

  const moveIssue = useMoveIssue(projectId, filters);
  const [draggingIssue, setDraggingIssue] = useState<IssueSummaryDto | null>(null);

  const epics = useMemo(
    () => (epicPages?.pages.flatMap((p) => p.items) ?? []).map((e) => ({ id: e.id, title: e.title })),
    [epicPages],
  );

  const canMove = project?.permissions.includes(Permission.ISSUE_MOVE) ?? false;
  const canCreate = project?.permissions.includes(Permission.ISSUE_CREATE) ?? false;

  const sensors = useSensors(
    // A small activation distance keeps a click from being read as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const columns = board?.columns ?? [];

  const findIssue = (id: string): { issue: IssueSummaryDto; column: BoardColumnDto } | null => {
    for (const column of columns) {
      const issue = column.issues.find((i) => i.id === id);
      if (issue) return { issue, column };
    }
    return null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    const found = findIssue(String(event.active.id));
    setDraggingIssue(found?.issue ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingIssue(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const source = findIssue(activeId);
    if (!source) return;

    // The drop target is either a column (empty area) or another card.
    const overColumn = columns.find((c) => c.status.id === overId);
    const overIssue = findIssue(overId);
    const targetColumn = overColumn ?? overIssue?.column;
    if (!targetColumn) return;

    const list = targetColumn.issues.filter((i) => i.id !== activeId);
    const dropIndex = overIssue ? list.findIndex((i) => i.id === overIssue.issue.id) : list.length;
    const index = dropIndex < 0 ? list.length : dropIndex;

    const beforeId = index > 0 ? (list[index - 1]?.id ?? null) : null;
    const afterId = list[index]?.id ?? null;

    moveIssue.mutate({
      issueId: activeId,
      statusId: targetColumn.status.id,
      beforeId,
      afterId,
    });
  };

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilterBar
        filters={filters}
        onChange={setFilters}
        statuses={project?.statuses}
        labels={project?.labels}
        members={project?.members.map((m) => m.user)}
        sprints={sprints}
        epics={epics}
        currentUserId={user?.id ?? ''}
        sortOptions={false}
        trailing={
          isFetching ? <span className="text-2xs text-text-subtle">Синхронизация…</span> : undefined
        }
      />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDraggingIssue(null)}
      >
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden scrollbar-thin">
          <div className="flex h-full min-w-max gap-3 p-3">
            {isLoading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex w-72 flex-col gap-2">
                    <SkeletonCard />
                    <SkeletonCard />
                    <SkeletonCard />
                  </div>
                ))
              : columns.map((column) => (
                  <BoardColumn
                    key={column.status.id}
                    column={column}
                    canMove={canMove}
                    canCreate={canCreate}
                    onOpenIssue={openIssue}
                    onCreate={() => openCreateIssue({ projectId, statusId: column.status.id })}
                  />
                ))}
          </div>
        </div>

        {/* The dragged card follows the cursor at full opacity. */}
        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }}>
          {draggingIssue && (
            <div className="w-72 rotate-1" style={{ boxShadow: 'var(--shadow-drag)', borderRadius: 'var(--radius-lg)' }}>
              <IssueCard issue={draggingIssue} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

/* ---------------------------------------------------------------- column */

function BoardColumn({
  column,
  canMove,
  canCreate,
  onOpenIssue,
  onCreate,
}: {
  column: BoardColumnDto;
  canMove: boolean;
  canCreate: boolean;
  onOpenIssue: (id: string) => void;
  onCreate: () => void;
}) {
  const { setNodeRef, isOver } = useSortable({
    id: column.status.id,
    data: { type: 'column' },
    disabled: true,
  });

  const overLimit =
    column.status.wipLimit !== null &&
    column.status.wipLimit !== undefined &&
    column.status.wipLimit > 0 &&
    column.total > column.status.wipLimit;

  return (
    <section
      className="flex w-72 shrink-0 flex-col rounded-lg bg-bg-subtle"
      aria-label={`Колонка «${column.status.name}»`}
    >
      <header className="flex items-center gap-2 px-2.5 py-2">
        <StatusDot status={column.status} className="size-3" />
        <h2 className="truncate text-xs font-semibold text-text">{column.status.name}</h2>
        <span className="fd-num text-2xs text-text-subtle">{column.total}</span>

        {column.status.wipLimit ? (
          <Tooltip
            content={
              overLimit
                ? `Превышен WIP-лимит: ${column.status.wipLimit}`
                : `WIP-лимит: ${column.status.wipLimit}`
            }
          >
            <span
              className={clsx(
                'fd-num inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-2xs font-medium',
                overLimit ? 'bg-danger-subtle text-danger' : 'bg-surface-active text-text-subtle',
              )}
            >
              {overLimit && <AlertTriangle className="size-2.5" />}
              {column.total}/{column.status.wipLimit}
            </span>
          </Tooltip>
        ) : null}

        {canCreate && (
          <button
            type="button"
            onClick={onCreate}
            aria-label={`Добавить задачу в «${column.status.name}»`}
            className="ml-auto rounded-sm p-0.5 text-text-subtle hover:bg-surface-active hover:text-text"
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </header>

      <div
        ref={setNodeRef}
        className={clsx(
          'min-h-0 flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin',
          isOver && 'rounded-lg bg-accent-subtle/40',
        )}
      >
        <SortableContext items={column.issues.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {column.issues.map((issue) => (
              <SortableIssueCard
                key={issue.id}
                issue={issue}
                disabled={!canMove}
                onClick={() => onOpenIssue(issue.id)}
              />
            ))}
          </div>
        </SortableContext>

        {column.issues.length === 0 && (
          <EmptyState
            compact
            className="rounded-lg border border-dashed border-border py-6"
            title="Пусто"
            description={canCreate ? 'Перетащите задачу сюда или создайте новую.' : undefined}
            action={
              canCreate ? (
                <Button size="xs" variant="ghost" iconLeft={<Plus className="size-3" />} onClick={onCreate}>
                  Новая задача
                </Button>
              ) : undefined
            }
          />
        )}

        {column.hasMore && (
          <p className="fd-num py-2 text-center text-2xs text-text-subtle">
            ещё {column.total - column.issues.length}
          </p>
        )}
      </div>
    </section>
  );
}

function SortableIssueCard({
  issue,
  disabled,
  onClick,
}: {
  issue: IssueSummaryDto;
  disabled: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issue.id,
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <IssueCard issue={issue} isDragging={isDragging} onClick={onClick} />
    </div>
  );
}

export type { StatusDto };
