import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { ChevronDown, ChevronRight, Link2, Unlink } from 'lucide-react';
import type { DependencyDto, GanttRowDto, GanttScale } from '@flowdesk/contracts';
import { Avatar } from '~/ui/Avatar';
import { Tooltip } from '~/ui/Tooltip';
import { IssueTypeIcon } from '~/components/IssueMeta';
import {
  ROW_HEIGHT,
  barGeometry,
  buildTimeline,
  dateForX,
  edgeX,
  weekendBands,
  type Timeline,
} from './scale';

export interface GanttChartProps {
  rows: GanttRowDto[];
  dependencies: DependencyDto[];
  range: { start: string; end: string };
  scale: GanttScale;
  editable: boolean;
  showBaseline: boolean;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  onOpenIssue: (id: string) => void;
  onReschedule: (issueId: string, start: string, end: string) => void;
  onCreateDependency: (predecessorId: string, successorId: string) => void;
  onDeleteDependency: (dependencyId: string) => void;
}

type DragMode = 'move' | 'resize-start' | 'resize-end';

interface DragState {
  rowId: string;
  mode: DragMode;
  originX: number;
  /** Whole days. */
  steps: number;
  /** Set once the pointer travels far enough to count as a drag. */
  moved: boolean;
}

interface LinkState {
  fromId: string;
  x: number;
  y: number;
}

/**
 * The chart itself: a fixed work-breakdown tree on the left and a scrolling
 * timeline on the right, sharing one vertical scroll position.
 *
 * Bars are absolutely positioned rather than laid out in a grid, because a
 * drag needs to move one element without reflowing the other several hundred.
 */
export function GanttChart({
  rows,
  dependencies,
  range,
  scale,
  editable,
  showBaseline,
  collapsed,
  onToggleCollapse,
  onOpenIssue,
  onReschedule,
  onCreateDependency,
  onDeleteDependency,
}: GanttChartProps) {
  // The chart is never narrower than the space it sits in.
  const timelineRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) => setViewportWidth(Math.round(entry!.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const timeline = useMemo(
    () => buildTimeline(new Date(range.start), new Date(range.end), scale, viewportWidth),
    [range.start, range.end, scale, viewportWidth],
  );

  // Open on today rather than on the far past, once per zoom level.
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    const el = timelineRef.current;
    if (!el || viewportWidth === 0 || timeline.todayX === null || scrolledFor.current === scale) return;
    scrolledFor.current = scale;
    el.scrollLeft = Math.max(0, timeline.todayX - Math.min(240, viewportWidth / 3));
  }, [scale, timeline.todayX, viewportWidth]);

  // A drag moves by whole days.
  const stepPx = timeline.dayWidth;
  const stepMs = 24 * 60 * 60 * 1000;

  // A row is hidden when any ancestor is collapsed.
  const visibleRows = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const isHidden = (row: GanttRowDto): boolean => {
      let parentId = row.parentId;
      const seen = new Set<string>();
      while (parentId && !seen.has(parentId)) {
        if (collapsed.has(parentId)) return true;
        seen.add(parentId);
        parentId = byId.get(parentId)?.parentId ?? null;
      }
      return false;
    };
    return rows.filter((row) => !isHidden(row));
  }, [rows, collapsed]);

  const rowIndex = useMemo(
    () => new Map(visibleRows.map((row, index) => [row.id, index])),
    [visibleRows],
  );

  // Float is only meaningful for work that something else depends on; an
  // unlinked task can slip forever without hurting anything, so drawing a
  // slack rail on every row would be noise rather than information.
  const linkedIds = useMemo(
    () => new Set(dependencies.flatMap((d) => [d.predecessorId, d.successorId])),
    [dependencies],
  );

  const [drag, setDrag] = useState<DragState | null>(null);
  const [link, setLink] = useState<LinkState | null>(null);
  const suppressClickRef = useRef(false);

  const openIfNotDragging = useCallback(
    (id: string) => {
      if (suppressClickRef.current) return;
      onOpenIssue(id);
    },
    [onOpenIssue],
  );

  /* ------------------------------------------------------------ dragging */

  const endDrag = useCallback(() => {
    setDrag((current) => {
      // A drag that moved must not also register as a click on the bar.
      if (current?.moved) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      if (!current || current.steps === 0) return null;

      const row = rows.find((r) => r.id === current.rowId);
      if (!row) return null;

      const shiftIso = (value: string | null, steps: number) =>
        value ? new Date(new Date(value).getTime() + steps * stepMs).toISOString() : null;

      const start = current.mode === 'resize-end' ? row.start : shiftIso(row.start, current.steps);
      const end = current.mode === 'resize-start' ? row.end : shiftIso(row.end, current.steps);

      if (start && end && new Date(start) > new Date(end)) return null;
      onReschedule(current.rowId, start ?? end!, end ?? start!);
      return null;
    });
  }, [rows, onReschedule, stepMs]);

  useEffect(() => {
    if (!drag) return;

    const onMove = (event: PointerEvent) => {
      const deltaPx = event.clientX - drag.originX;
      setDrag((current) =>
        current
          ? {
              ...current,
              steps: Math.round(deltaPx / stepPx),
              moved: current.moved || Math.abs(deltaPx) > 3,
            }
          : current,
      );
    };
    const onUp = () => endDrag();
    const onKey = (event: KeyboardEvent) => {
      // Escape abandons the drag without writing anything.
      if (event.key === 'Escape') setDrag(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [drag, stepPx, endDrag]);

  /* -------------------------------------------------------------- linking */

  useEffect(() => {
    if (!link) return;

    const onMove = (event: PointerEvent) => {
      const rect = timelineRef.current?.getBoundingClientRect();
      if (!rect) return;
      setLink((current) =>
        current
          ? {
              ...current,
              x: event.clientX - rect.left + (timelineRef.current?.scrollLeft ?? 0),
              y: event.clientY - rect.top + (timelineRef.current?.scrollTop ?? 0),
            }
          : current,
      );
    };
    const onUp = (event: PointerEvent) => {
      const target = (event.target as HTMLElement | null)?.closest('[data-bar-id]');
      const toId = target?.getAttribute('data-bar-id');
      if (toId && toId !== link.fromId) onCreateDependency(link.fromId, toId);
      setLink(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLink(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [link, onCreateDependency]);

  const chartHeight = visibleRows.length * ROW_HEIGHT;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Work-breakdown tree */}
      <div className="flex w-40 shrink-0 flex-col border-r-2 border-border-strong bg-surface sm:w-64 lg:w-80">
        <div
          className="fd-eyebrow sticky top-0 z-20 flex shrink-0 items-end border-b-2 border-border-strong bg-surface-sunken px-3 pb-1"
          style={{ height: 52 }}
        >
          Декомпозиция
        </div>

        <div className="min-h-0 flex-1 overflow-hidden" id="gantt-tree">
          <div style={{ height: chartHeight }}>
            {visibleRows.map((row) => (
              <TreeRow
                key={row.id}
                row={row}
                collapsed={collapsed.has(row.id)}
                onToggle={() => onToggleCollapse(row.id)}
                onOpen={() => onOpenIssue(row.id)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div
        ref={timelineRef}
        className="min-h-0 flex-1 overflow-auto scrollbar-thin"
        onScroll={(event) => {
          const tree = document.getElementById('gantt-tree');
          if (tree) tree.scrollTop = event.currentTarget.scrollTop;
        }}
      >
        <div style={{ width: timeline.totalWidth, minWidth: '100%' }}>
          <TimelineHeader timeline={timeline} />

          <div className="relative" style={{ height: chartHeight }}>
            <Background timeline={timeline} rowCount={visibleRows.length} />

            <DependencyArrows
              dependencies={dependencies}
              rows={visibleRows}
              rowIndex={rowIndex}
              timeline={timeline}
              editable={editable}
              onDelete={onDeleteDependency}
            />

            {visibleRows.map((row, index) => (
              <Bar
                key={row.id}
                row={row}
                index={index}
                linked={linkedIds.has(row.id)}
                timeline={timeline}
                editable={editable}
                showBaseline={showBaseline}
                drag={drag?.rowId === row.id ? drag : null}
                stepPx={stepPx}
                onStartDrag={(mode, originX) =>
                  setDrag({ rowId: row.id, mode, originX, steps: 0, moved: false })
                }
                onStartLink={(x, y) => setLink({ fromId: row.id, x, y })}
                onOpen={() => openIfNotDragging(row.id)}
              />
            ))}

            {link && <LinkPreview link={link} rows={visibleRows} rowIndex={rowIndex} timeline={timeline} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- tree row */

function TreeRow({
  row,
  collapsed,
  onToggle,
  onOpen,
}: {
  row: GanttRowDto;
  collapsed: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      className="flex items-center gap-1.5 border-b border-border/60 px-2 hover:bg-surface-hover"
      style={{ height: ROW_HEIGHT, paddingLeft: 8 + row.depth * 14 }}
    >
      {row.hasChildren ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Развернуть ${row.issueKey}` : `Свернуть ${row.issueKey}`}
          className="shrink-0 p-0.5 text-text-subtle hover:bg-surface-active hover:text-text"
        >
          {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}

      <IssueTypeIcon type={row.type} className="size-3.5 shrink-0" />

      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        title={`${row.issueKey}: ${row.title}`}
      >
        {/* On a phone the tree column is 160px; with the key and the avatar
            beside it the title was cut to two or three letters. There the title
            alone identifies the bar. */}
        <span className="fd-key hidden shrink-0 sm:inline">{row.issueKey}</span>
        <span
          className={clsx(
            'min-w-0 flex-1 truncate text-xs',
            row.isSummary && 'font-semibold',
            row.progress >= 1 && 'text-text-subtle line-through',
          )}
        >
          {row.title}
        </span>
      </button>

      <span className="hidden shrink-0 sm:inline-flex">
        <Avatar user={row.assignee} size="sm" showEmpty={false} />
      </span>
    </div>
  );
}

/* ------------------------------------------------------------- timeline */

function TimelineHeader({ timeline }: { timeline: Timeline }) {
  return (
    <div className="sticky top-0 z-20 bg-surface-sunken" style={{ height: 52 }}>
      <div className="relative border-b-2 border-border-strong" style={{ height: 26 }}>
        {timeline.majorTicks.map((tick) => (
          <div
            key={tick.key}
            className="fd-eyebrow absolute top-0 flex h-full items-center border-l-2 border-border-strong px-2 whitespace-nowrap"
            style={{ left: tick.x, width: tick.width }}
          >
            {/* Kept in view while the row scrolls: a single day in hours is one long cell. */}
            <span className="sticky left-2">{tick.label}</span>
          </div>
        ))}
      </div>

      <div className="relative border-b-2 border-border-strong" style={{ height: 26 }}>
        {timeline.minorTicks.map((tick) => (
          <div
            key={tick.key}
            className={clsx(
              'fd-num absolute top-0 flex h-full items-center justify-center border-l border-border text-2xs',
              tick.isToday ? 'bg-marker font-bold text-ink' : 'text-text-subtle',
              tick.isWeekend && !tick.isToday && 'bg-surface-active/50',
            )}
            style={{ left: tick.x, width: tick.width }}
          >
            {tick.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function Background({ timeline, rowCount }: { timeline: Timeline; rowCount: number }) {
  const bands = useMemo(() => weekendBands(timeline), [timeline]);

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {bands.map((band) => (
        <div
          key={band.x}
          className="absolute top-0 bottom-0 bg-surface-active/30"
          style={{ left: band.x, width: band.width }}
        />
      ))}

      {Array.from({ length: rowCount }).map((_, index) => (
        <div
          key={index}
          className="absolute right-0 left-0 border-b border-border/40"
          style={{ top: (index + 1) * ROW_HEIGHT - 1, height: 1 }}
        />
      ))}

      {/* Today is the one rule on the chart that has to be read from across the
          room, so it is drawn thick and in the alarm colour. The header marks the
          day, week or hour it falls in — a text flag covered either a task's bar
          or a month's name. */}
      {timeline.todayX !== null && (
        <div
          className="absolute top-0 bottom-0 z-10 w-[3px] bg-danger"
          style={{ left: timeline.todayX - 1 }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ bar */

function Bar({
  row,
  index,
  linked,
  timeline,
  editable,
  showBaseline,
  drag,
  stepPx,
  onStartDrag,
  onStartLink,
  onOpen,
}: {
  stepPx: number;
  row: GanttRowDto;
  index: number;
  linked: boolean;
  timeline: Timeline;
  editable: boolean;
  showBaseline: boolean;
  drag: DragState | null;
  onStartDrag: (mode: DragMode, originX: number) => void;
  onStartLink: (x: number, y: number) => void;
  onOpen: () => void;
}) {
  const geometry = barGeometry(timeline, row.start, row.end);
  const draggable = editable && !row.isSummary;
  const baseline = showBaseline ? barGeometry(timeline, row.baselineStart, row.baselineEnd) : null;

  const top = index * ROW_HEIGHT;
  const shift = (drag?.steps ?? 0) * stepPx;

  if (!geometry) return null;

  const adjusted = {
    x: geometry.x + (drag?.mode === 'resize-end' ? 0 : shift),
    width:
      drag?.mode === 'resize-end'
        ? Math.max(stepPx, geometry.width + shift)
        : drag?.mode === 'resize-start'
          ? Math.max(stepPx, geometry.width - shift)
          : geometry.width,
  };

  const dateLabel = [
    row.start ? format(new Date(row.start), row.startHasTime ? 'd MMM, HH:mm' : 'd MMM', { locale: ru }) : null,
    row.end ? format(new Date(row.end), row.endHasTime ? 'd MMM, HH:mm' : 'd MMM', { locale: ru }) : null,
  ]
    .filter(Boolean)
    .join(' → ');

  /* Milestone: a diamond at a single point in time. */
  if (row.isMilestone) {
    return (
      <div className="absolute" style={{ top, height: ROW_HEIGHT }}>
        <Tooltip content={`${row.issueKey}: ${row.title} · ${dateLabel}`}>
          <button
            type="button"
            data-bar-id={row.id}
            onClick={onOpen}
            aria-label={`Веха ${row.issueKey}: ${row.title}, ${dateLabel}`}
            className="absolute size-3.5 rotate-45 border-2 border-border-strong bg-marker hover:scale-125"
            style={{ left: adjusted.x + timeline.dayWidth / 2 - 6, top: ROW_HEIGHT / 2 - 6 }}
          />
        </Tooltip>
      </div>
    );
  }

  const progressPercent = Math.round(row.progress * 100);

  const slackWidth =
    linked && !row.isSummary && row.slackDays !== null && row.slackDays > 0
      ? Math.min(row.slackDays, 90) * timeline.dayWidth
      : 0;

  return (
    <div className="absolute" style={{ top, height: ROW_HEIGHT, left: 0, right: 0 }}>
      {baseline && (
        <div
          className="absolute border-2 border-dashed border-border-strong"
          style={{ left: baseline.x, width: baseline.width, top: ROW_HEIGHT - 9, height: 5 }}
          aria-hidden="true"
        />
      )}

      <Tooltip
        content={
          <span className="whitespace-nowrap">
            {row.issueKey}: {row.title}
            <br />
            {dateLabel} · {progressPercent}%
            {row.isCritical && ' · критический путь'}
            {row.slackDays !== null && row.slackDays > 0 && ` · резерв ${row.slackDays} дн`}
          </span>
        }
      >
        <div
          data-bar-id={row.id}
          role="button"
          tabIndex={0}
          aria-label={`${row.issueKey}: ${row.title}, ${dateLabel}, выполнено ${progressPercent}%`}
          onClick={onOpen}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onOpen();
            }
          }}
          onPointerDown={(event) => {
            if (!draggable || event.button !== 0) return;
            event.preventDefault();
            onStartDrag('move', event.clientX);
          }}
          className={clsx(
            // Bars are printed plates like everything else: a hard ink rule
            // around a flat fill, so the chart reads as one drawing rather
            // than a pastel timeline pasted into the product.
            'group absolute flex items-center border-2 border-border-strong shadow-xs transition-shadow focus:ring-2 focus:ring-accent/40 focus:outline-none',
            row.isSummary
              ? 'bg-ink'
              : row.isCritical
                ? 'bg-accent text-accent-fg'
                : row.isOverdue
                  ? 'bg-danger text-accent-fg'
                  : 'bg-surface',
            draggable && 'cursor-grab active:cursor-grabbing',
            drag && 'shadow-md',
          )}
          style={{
            left: adjusted.x,
            width: adjusted.width,
            top: row.isSummary ? ROW_HEIGHT / 2 - 5 : 6,
            height: row.isSummary ? 10 : ROW_HEIGHT - 14,
          }}
        >
          {/* Progress fill */}
          {!row.isSummary && (
            <div
              className={clsx(
                'absolute inset-y-0 left-0 border-r-2 border-border-strong last:border-r-0',
                progressPercent >= 100 ? 'bg-success' : 'bg-ink/20',
                progressPercent >= 100 && 'border-r-0',
              )}
              style={{ width: `${progressPercent}%` }}
              aria-hidden="true"
            />
          )}

          {!row.isSummary && adjusted.width > 60 && (
            <span className="relative z-10 truncate px-2 text-2xs font-semibold">
              {row.title}
            </span>
          )}

          {row.assignee && adjusted.width > 90 && (
            <span className="relative z-10 ml-auto pr-1">
              <Avatar user={row.assignee} size="xs" />
            </span>
          )}

          {/* Resize handles */}
          {draggable && (
            <>
              <span
                role="presentation"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  onStartDrag('resize-start', event.clientX);
                }}
                className="absolute top-0 bottom-0 left-0 w-1.5 cursor-ew-resize opacity-0 group-hover:bg-accent/50 group-hover:opacity-100"
              />
              <span
                role="presentation"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  onStartDrag('resize-end', event.clientX);
                }}
                className="absolute top-0 right-0 bottom-0 w-1.5 cursor-ew-resize opacity-0 group-hover:bg-accent/50 group-hover:opacity-100"
              />

              {/* Drag from here to another bar to create a dependency. */}
              <button
                type="button"
                aria-label={`Связать ${row.issueKey} с другой задачей`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  onStartLink(adjusted.x + adjusted.width, top + ROW_HEIGHT / 2);
                }}
                className="absolute top-1/2 -right-4 -translate-y-1/2 border-2 border-border-strong bg-surface p-0.5 text-text-subtle opacity-0 group-hover:opacity-100 hover:text-accent"
              >
                <Link2 className="size-3" />
              </button>
            </>
          )}
        </div>
      </Tooltip>

      {/* Slack rail — how far this task can slip before the project end moves.
          Critical work has none, which is exactly what makes it critical. */}
      {slackWidth > 0 && (
        <Tooltip content={`Запас ${row.slackDays} дн — можно сдвинуть без ущерба для срока`}>
          <span
            className="absolute border-t border-dashed border-text-subtle/60"
            style={{
              left: adjusted.x + adjusted.width,
              width: slackWidth,
              top: ROW_HEIGHT / 2,
              height: 1,
            }}
          >
            <span
              className="absolute top-1/2 right-0 h-2 w-px -translate-y-1/2 bg-text-subtle/60"
              aria-hidden="true"
            />
          </span>
        </Tooltip>
      )}

      {/* A narrow bar keeps its label — outside, rather than clipped away. */}
      {!row.isSummary && adjusted.width <= 60 && (
        <span
          className="pointer-events-none absolute truncate text-2xs whitespace-nowrap text-text-muted"
          style={{
            left: adjusted.x + adjusted.width + slackWidth + 6,
            top: ROW_HEIGHT / 2 - 7,
            maxWidth: 180,
          }}
        >
          {row.title}
        </span>
      )}

      {drag && (
        <span
          className="fd-num pointer-events-none absolute z-30 border-2 border-border-strong bg-surface-raised px-1.5 py-0.5 text-2xs shadow-sm"
          style={{ left: adjusted.x, top: -4 }}
        >
          {drag.steps > 0 ? `+${drag.steps}` : drag.steps} дн
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- arrows */

function DependencyArrows({
  dependencies,
  rows,
  rowIndex,
  timeline,
  editable,
  onDelete,
}: {
  dependencies: DependencyDto[];
  rows: GanttRowDto[];
  rowIndex: Map<string, number>;
  timeline: Timeline;
  editable: boolean;
  onDelete: (id: string) => void;
}) {
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  const paths = dependencies
    .map((dependency) => {
      const from = byId.get(dependency.predecessorId);
      const to = byId.get(dependency.successorId);
      const fromIndex = rowIndex.get(dependency.predecessorId);
      const toIndex = rowIndex.get(dependency.successorId);
      if (!from?.end || !to?.start || fromIndex === undefined || toIndex === undefined) return null;

      const x1 = edgeX(timeline, from.end, 'end');
      const y1 = fromIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
      const x2 = edgeX(timeline, to.start, 'start');
      const y2 = toIndex * ROW_HEIGHT + ROW_HEIGHT / 2;

      // A successor that starts before its predecessor finishes is a broken
      // plan, not a drawing problem — it gets its own routing and its own
      // colour rather than a line dragged across the whole chart.
      const violated = x2 < x1;
      const stub = 10;

      // Forward links take a simple elbow. Backward links hug the rows: out to
      // the right, into the gutter between rows, back left, then in.
      const d = violated
        ? `M ${x1} ${y1} H ${x1 + stub} V ${y1 + ROW_HEIGHT / 2 - 4} H ${x2 - stub} V ${y2} H ${x2}`
        : `M ${x1} ${y1} H ${x1 + (x2 - x1) / 2} V ${y2} H ${x2}`;

      return {
        id: dependency.id,
        d,
        x2,
        y2,
        violated,
        critical: from.isCritical && to.isCritical,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (paths.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 overflow-visible"
      width={timeline.totalWidth}
      height={rows.length * ROW_HEIGHT}
      aria-hidden="true"
    >
      {paths.map((path) => (
        <g key={path.id} className="pointer-events-auto">
          {/* Dashes are reserved for slack. A broken link is solid and red so
              the two never read as the same thing. */}
          <path
            d={path.d}
            fill="none"
            strokeWidth={path.violated ? 1.5 : 1}
            className={clsx(
              'transition-opacity',
              path.violated
                ? 'stroke-danger'
                : path.critical
                  ? 'stroke-danger/50 hover:stroke-danger'
                  : 'stroke-border-strong/60 hover:stroke-border-strong',
            )}
          />
          <polygon
            points={`${path.x2},${path.y2} ${path.x2 - 5},${path.y2 - 3.5} ${path.x2 - 5},${path.y2 + 3.5}`}
            className={
              path.violated ? 'fill-danger' : path.critical ? 'fill-danger/50' : 'fill-border-strong/60'
            }
          />
          {editable && (
            <g
              className="cursor-pointer opacity-0 hover:opacity-100"
              onClick={() => onDelete(path.id)}
            >
              <circle cx={path.x2 - 14} cy={path.y2} r={7} className="fill-surface stroke-border" />
              <foreignObject x={path.x2 - 20} y={path.y2 - 6} width={12} height={12}>
                <Unlink className="size-3 text-danger" />
              </foreignObject>
            </g>
          )}
        </g>
      ))}
    </svg>
  );
}

function LinkPreview({
  link,
  rows,
  rowIndex,
  timeline,
}: {
  link: LinkState;
  rows: GanttRowDto[];
  rowIndex: Map<string, number>;
  timeline: Timeline;
}) {
  const from = rows.find((r) => r.id === link.fromId);
  const index = rowIndex.get(link.fromId);
  if (!from?.end || index === undefined) return null;

  const x1 = edgeX(timeline, from.end, 'end');
  const y1 = index * ROW_HEIGHT + ROW_HEIGHT / 2;

  return (
    <svg className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden="true">
      <line
        x1={x1}
        y1={y1}
        x2={link.x}
        y2={link.y}
        className="stroke-accent"
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
    </svg>
  );
}

export { dateForX };
