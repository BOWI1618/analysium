import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  pointerWithin,
  useDroppable,
  type CollisionDetection,
  type DragOverEvent,
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
import type { IssueSummaryDto } from '@flowdesk/contracts';
import { Permission, StatusCategory } from '@flowdesk/contracts';
import { Plus, AlertTriangle, ArrowDownToLine } from 'lucide-react';
import type { StatusDto } from '@flowdesk/contracts';
import { useSession } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import { useProject } from '~/features/projects/hooks';
import { useSprints } from '~/features/sprints/hooks';
import { useBoard, useIssueList, useMoveIssue, usePatchIssue } from '~/features/issues/hooks';
import { useUpdateStatus } from '~/features/projects/hooks';
import {
  AddColumn,
  BoardSettingsMenu,
  ColumnMenu,
  DEFAULT_BOARD_SETTINGS,
  QuickAddIssue,
  type BoardSettings,
} from '~/features/board/BoardParts';
import { doneStatusId, isClosedStatus, reopenStatusId } from '~/components/DoneToggle';
import { useLocalStorage } from '~/lib/hooks/useLocalStorage';
import { useFilterState } from '~/features/issues/useFilterState';
import type { BoardColumnDto } from '~/features/issues/types';
import { FilterBar } from '~/components/FilterBar';
import { IssueCard, type IssueCardFields } from '~/components/IssueCard';
import { StatusDot } from '~/components/IssueMeta';
import { EmptyState, ErrorState, SkeletonCard } from '~/ui/Feedback';
import { Tooltip } from '~/ui/Tooltip';

/**
 * Kanban board, worked the way Weeek works one: a task is added by typing its
 * title at the top of a column, closed with the checkbox on its card, and a
 * column is renamed, coloured, limited or moved from its own menu.
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
  const patchIssue = usePatchIssue();
  const [storedSettings, setSettings] = useLocalStorage<BoardSettings>('flowdesk.board-settings', DEFAULT_BOARD_SETTINGS);
  const settings: BoardSettings = {
    fields: { ...DEFAULT_BOARD_SETTINGS.fields, ...storedSettings?.fields },
  };
  const [draggingIssue, setDraggingIssue] = useState<IssueSummaryDto | null>(null);
  // The column a dragged card would land in, lit up so the move is obvious.
  const [overColumnId, setOverColumnId] = useState<string | null>(null);

  const epics = useMemo(
    () => (epicPages?.pages.flatMap((p) => p.items) ?? []).map((e) => ({ id: e.id, title: e.title })),
    [epicPages],
  );

  const canMove = project?.permissions.includes(Permission.ISSUE_MOVE) ?? false;
  const canCreate = project?.permissions.includes(Permission.ISSUE_CREATE) ?? false;
  const canEdit = project?.permissions.includes(Permission.ISSUE_UPDATE) ?? false;
  const canManageColumns = project?.permissions.includes(Permission.PROJECT_MANAGE_WORKFLOW) ?? false;
  const statuses = project?.statuses ?? [];

  const toggleDone = (issue: IssueSummaryDto) => {
    const statusId = isClosedStatus(issue.status) ? reopenStatusId(statuses) : doneStatusId(statuses);
    if (statusId) patchIssue.mutate({ issueId: issue.id, patch: { statusId } });
  };

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

  const columnIdOf = (overId: string | null): string | null => {
    if (!overId) return null;
    if (columns.some((c) => c.status.id === overId)) return overId;
    return findIssue(overId)?.column.status.id ?? null;
  };

  const handleDragOver = (event: DragOverEvent) =>
    setOverColumnId(columnIdOf(event.over ? String(event.over.id) : null));

  // The pointer decides first: anywhere over a column — its header, its empty
  // foot — drops into it. Over a card inside, the card wins, for the position.
  const collisionDetection: CollisionDetection = (args) => {
    const hits = pointerWithin(args);
    if (hits.length === 0) return closestCorners(args);
    const cards = hits.filter((hit) => !columns.some((c) => c.status.id === hit.id));
    return cards.length > 0 ? cards : hits;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingIssue(null);
    setOverColumnId(null);
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
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <FilterBar
        filters={filters}
        onChange={setFilters}
        statuses={project?.statuses}
        labels={project?.labels}
        members={project?.assignees}
        sprints={sprints}
        epics={epics}
        currentUserId={user?.id ?? ''}
        sortOptions={false}
        trailing={
          <>
            {isFetching && <span className="text-2xs text-text-subtle">Синхронизация…</span>}
            <BoardSettingsMenu settings={settings} onChange={setSettings} />
          </>
        }
      />

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setDraggingIssue(null);
          setOverColumnId(null);
        }}
      >
        {/* On a phone one column fits the screen, so a swipe settles on the next
            column instead of stopping halfway between two. */}
        <div className="min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden scroll-px-4 scrollbar-thin sm:snap-none">
          <div className="flex h-full min-w-max items-stretch gap-4 p-4 pt-6">
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
                    projectId={projectId}
                    column={column}
                    statuses={statuses}
                    fields={settings.fields}
                    canMove={canMove}
                    canCreate={canCreate}
                    canManage={canManageColumns}
                    onOpenIssue={openIssue}
                    onToggleDone={canEdit ? toggleDone : undefined}
                    onCreate={() => openCreateIssue({ projectId, statusId: column.status.id })}
                    dropTarget={
                      Boolean(draggingIssue) &&
                      overColumnId === column.status.id &&
                      draggingIssue?.statusId !== column.status.id
                    }
                  />
                ))}
            {!isLoading && canManageColumns && <AddColumn projectId={projectId} statuses={statuses} />}
          </div>
        </div>

        {/* The dragged card follows the cursor at full opacity. */}
        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }}>
          {draggingIssue && (
            <div className="w-72 rotate-1" style={{ boxShadow: 'var(--shadow-drag)' }}>
              <IssueCard issue={draggingIssue} fields={settings.fields} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

/* ---------------------------------------------------------------- column */

function BoardColumn({
  projectId,
  column,
  statuses,
  fields,
  canMove,
  canCreate,
  canManage,
  onOpenIssue,
  onToggleDone,
  onCreate,
  dropTarget,
}: {
  projectId: string;
  column: BoardColumnDto;
  statuses: StatusDto[];
  fields: IssueCardFields;
  canMove: boolean;
  canCreate: boolean;
  canManage: boolean;
  onOpenIssue: (id: string) => void;
  onToggleDone?: (issue: IssueSummaryDto) => void;
  onCreate: () => void;
  /** A card from another column is over this one. */
  dropTarget: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  // The whole column takes the drop, header included, not only its card list.
  const { setNodeRef } = useDroppable({ id: column.status.id, data: { type: 'column' } });

  const overLimit =
    column.status.wipLimit !== null &&
    column.status.wipLimit !== undefined &&
    column.status.wipLimit > 0 &&
    column.total > column.status.wipLimit;

  // The column where work is actually happening is the one the board is about,
  // so it is printed in the accent and lifted a step above its neighbours.
  const isActive = column.status.category === StatusCategory.STARTED;

  return (
    <section
      ref={setNodeRef}
      className={clsx(
        'relative flex w-[min(18rem,calc(100vw-3rem))] shrink-0 snap-start flex-col border-2 sm:w-72',
        'transition-[box-shadow,outline-color] duration-100',
        isActive ? 'bg-surface shadow-xl lg:-translate-y-2' : 'bg-bg-subtle shadow-md',
        dropTarget ? 'border-accent outline-4 outline-offset-2 outline-accent' : 'border-border-strong outline-transparent',
      )}
      aria-label={`Колонка «${column.status.name}»`}
    >
      <header
        className={clsx(
          'flex items-center gap-2 border-b-2 border-border-strong px-3 py-2',
          isActive ? 'bg-accent text-accent-fg' : 'bg-surface',
        )}
      >
        {isActive ? (
          <span aria-hidden="true" className="size-2.5 shrink-0 bg-accent-fg" />
        ) : (
          <StatusDot status={column.status} className="size-2.5" />
        )}
        {renaming ? (
          <RenameColumn projectId={projectId} status={column.status} onDone={() => setRenaming(false)} />
        ) : (
          <h2
            className={clsx('truncate font-mono text-2xs font-bold uppercase tracking-widest', canManage && 'cursor-text')}
            onDoubleClick={canManage ? () => setRenaming(true) : undefined}
            title={canManage ? 'Дважды щёлкните, чтобы переименовать' : undefined}
          >
            {column.status.name}
          </h2>
        )}
        <span className={clsx('fd-num text-2xs', !isActive && 'text-text-subtle')}>{column.total}</span>

        {column.status.wipLimit ? (
          <Tooltip
            content={
              overLimit
                ? `Превышен лимит задач: ${column.status.wipLimit}`
                : `Лимит задач: ${column.status.wipLimit}`
            }
          >
            <span
              className={clsx(
                'fd-num inline-flex items-center gap-0.5 border-2 px-1.5 py-px text-2xs font-bold',
                overLimit
                  ? 'border-border-strong bg-danger text-accent-fg'
                  : isActive
                    ? 'border-accent-fg/50 text-accent-fg'
                    : 'border-border-strong bg-surface-active text-text-subtle',
              )}
            >
              {overLimit && <AlertTriangle className="size-2.5" />}
              {column.total}/{column.status.wipLimit}
            </span>
          </Tooltip>
        ) : null}

        <span className="ml-auto flex items-center gap-0.5">
        {canCreate && (
          <button
            type="button"
            onClick={onCreate}
            aria-label={`Добавить задачу в «${column.status.name}»`}
            title="Новая задача со всеми полями"
            className={clsx(
              'p-0.5',
              isActive ? 'text-accent-fg hover:bg-accent-active' : 'text-text-subtle hover:bg-surface-active hover:text-text',
            )}
          >
            <Plus className="size-3.5" />
          </button>
        )}
        {canManage && (
          <ColumnMenu
            projectId={projectId}
            status={column.status}
            statuses={statuses}
            onRename={() => setRenaming(true)}
            onActiveHeader={isActive}
          />
        )}
        </span>
      </header>

      <div
        className={clsx(
          'min-h-0 flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin',
          dropTarget && 'bg-accent-subtle',
        )}
      >
        {dropTarget && (
          <div className="mt-2 flex items-center justify-center gap-1.5 border-2 border-dashed border-accent bg-surface py-3 text-xs font-bold text-accent">
            <ArrowDownToLine className="size-3.5" />
            Перенести в «{column.status.name}»
          </div>
        )}
        {/* New cards land at the top of a column, so the field that adds one is there too. */}
        {canCreate && (
          <QuickAddIssue
            projectId={projectId}
            statusId={column.status.id}
            statusName={column.status.name}
            className="mt-2"
          />
        )}

        <SortableContext items={column.issues.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2 pt-2">
            {column.issues.map((issue) => (
              <SortableIssueCard
                key={issue.id}
                issue={issue}
                fields={fields}
                disabled={!canMove}
                onClick={() => onOpenIssue(issue.id)}
                onToggleDone={onToggleDone ? () => onToggleDone(issue) : undefined}
              />
            ))}
          </div>
        </SortableContext>

        {column.issues.length === 0 && (
          <EmptyState
            compact
            className="border-2 border-dashed border-border-strong py-6"
            title="Пусто"
            description={canCreate ? 'Перетащите задачу сюда или создайте новую.' : undefined}
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
  fields,
  disabled,
  onClick,
  onToggleDone,
}: {
  issue: IssueSummaryDto;
  fields: IssueCardFields;
  disabled: boolean;
  onClick: () => void;
  onToggleDone?: () => void;
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
      <IssueCard issue={issue} fields={fields} isDragging={isDragging} onClick={onClick} onToggleDone={onToggleDone} />
    </div>
  );
}

/** The column title turned into a field; Enter or leaving it saves, Escape cancels. */
function RenameColumn({ projectId, status, onDone }: { projectId: string; status: StatusDto; onDone: () => void }) {
  const updateStatus = useUpdateStatus(projectId);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      defaultValue={status.name}
      maxLength={40}
      aria-label={`Новое название колонки «${status.name}»`}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          event.stopPropagation();
          cancelled.current = true;
          event.currentTarget.blur();
        }
      }}
      onBlur={(event) => {
        const name = event.target.value.trim();
        if (!cancelled.current && name && name !== status.name) {
          updateStatus.mutate({ statusId: status.id, patch: { name } });
        }
        onDone();
      }}
      className="h-6 min-w-0 flex-1 border-2 border-accent bg-surface px-1 font-mono text-2xs font-bold tracking-widest text-text uppercase outline-none"
    />
  );
}
