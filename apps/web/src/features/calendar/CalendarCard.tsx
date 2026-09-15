import clsx from 'clsx';
import { DoneToggle } from '~/components/DoneToggle';
import { IssueTypeIcon, LabelChip, PriorityIcon } from '~/components/IssueMeta';
import { Avatar } from '~/ui/Avatar';
import { timeLabel, type CalendarItem } from './items';

export interface CardFields {
  assignee: boolean;
  priority: boolean;
  labels: boolean;
}

export interface CalendarDrag {
  issueId: string;
  /** Day the task was picked up from, to move it by whole days. */
  fromKey: string | null;
  /** Minutes between the task's start and the point it was grabbed at — keeps it under the pointer. */
  grabMinutes: number;
}

/**
 * A task in the calendar: a checkbox to close it, its time if it has one, and
 * the fields chosen in the calendar settings. Dragged to another day or hour.
 */
export function CalendarCard({
  item,
  fields,
  canEdit,
  compact = false,
  floating = false,
  showTime = true,
  className,
  style,
  onOpen,
  onToggleDone,
  onDragStart,
  onDragEnd,
  dragging,
  children,
}: {
  item: CalendarItem;
  fields: CardFields;
  canEdit: boolean;
  compact?: boolean;
  /** Positioned absolutely by the caller (a block on the hour grid). */
  floating?: boolean;
  showTime?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onOpen: () => void;
  onToggleDone: () => void;
  onDragStart?: (event: React.DragEvent) => void;
  onDragEnd?: () => void;
  dragging?: boolean;
  children?: React.ReactNode;
}) {
  const { issue } = item;
  const time = showTime && item.timed ? timeLabel(issue) : '';

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen();
      }}
      aria-label={`${issue.issueKey}: ${issue.title}${time ? `, ${time}` : ''}`}
      className={clsx(
        'group flex min-w-0 gap-1.5 border-2 border-border-strong bg-surface text-left shadow-xs',
        floating ? 'absolute' : 'relative',
        'hover:bg-surface-hover focus:ring-2 focus:ring-accent/40 focus:outline-none',
        compact ? 'items-center px-1 py-0.5' : 'items-start px-1.5 py-1',
        canEdit && 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-40',
        className,
      )}
      style={{ borderLeftColor: issue.status.color, borderLeftWidth: 4, ...style }}
    >
      {canEdit ? (
        <DoneToggle done={item.done} issueKey={issue.issueKey} onToggle={onToggleDone} className="mt-px" />
      ) : (
        <IssueTypeIcon type={issue.type} withTooltip={false} className="mt-px size-3.5 shrink-0" />
      )}

      <span className="min-w-0 flex-1">
        {time && <span className="fd-num block text-[10px] leading-tight font-bold text-text-muted">{time}</span>}
        <span
          className={clsx(
            'block text-2xs leading-snug',
            compact ? 'truncate' : 'line-clamp-2 break-words',
            item.done && 'text-text-subtle line-through',
          )}
        >
          {issue.title}
        </span>
        {!compact && fields.labels && issue.labels.length > 0 && (
          <span className="mt-0.5 flex flex-wrap gap-0.5">
            {issue.labels.slice(0, 2).map((label) => (
              <LabelChip key={label.id} label={label} size="sm" />
            ))}
          </span>
        )}
      </span>

      {fields.priority && issue.priority !== 'NONE' && (
        <PriorityIcon priority={issue.priority} withTooltip={false} className="mt-px size-3 shrink-0" />
      )}
      {fields.assignee && <Avatar user={issue.assignee} size="xs" showEmpty={false} />}
      {children}
    </div>
  );
}

/** Starts a drag of a task, remembering where in it the pointer took hold. */
export function startCardDrag(
  event: React.DragEvent,
  item: CalendarItem | null,
  issueId: string,
  fromKey: string | null,
  pxPerMinute = 0,
): CalendarDrag {
  event.dataTransfer.effectAllowed = 'move';
  // Firefox refuses to drag without data.
  event.dataTransfer.setData('text/plain', issueId);
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const grabMinutes = item?.timed && pxPerMinute ? Math.max(0, (event.clientY - rect.top) / pxPerMinute) : 0;
  return { issueId, fromKey, grabMinutes };
}
