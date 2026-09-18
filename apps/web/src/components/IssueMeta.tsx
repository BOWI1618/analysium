import clsx from 'clsx';
import type { IssuePriority, IssueType, LabelDto, StatusCategory, StatusDto } from '@flowdesk/contracts';
import {
  Bug,
  CheckSquare,
  ChevronsUp,
  ChevronUp,
  Equal,
  ChevronDown,
  Minus,
  Bookmark,
  Zap,
  GitBranch,
} from 'lucide-react';
import { dueDateLabel, hexWithAlpha, pluralize } from '~/lib/format';
import { Tooltip } from '~/ui/Tooltip';

/* ------------------------------------------------------------ issue type */

export const ISSUE_TYPE_META: Record<IssueType, { label: string; icon: typeof Bug; color: string }> = {
  TASK: { label: 'Задача', icon: CheckSquare, color: '#0083ca' },
  BUG: { label: 'Баг', icon: Bug, color: '#ef4444' },
  STORY: { label: 'История', icon: Bookmark, color: '#22c55e' },
  EPIC: { label: 'Эпик', icon: Zap, color: '#8b5cf6' },
  SUBTASK: { label: 'Подзадача', icon: GitBranch, color: '#7c88a1' },
};

export function IssueTypeIcon({
  type,
  className,
  withTooltip = true,
}: {
  type: IssueType;
  className?: string;
  withTooltip?: boolean;
}) {
  const meta = ISSUE_TYPE_META[type];
  const Icon = meta.icon;
  const icon = (
    <span
      className={clsx('inline-flex shrink-0 items-center justify-center', className ?? 'size-4')}
      style={{ color: meta.color }}
      aria-label={meta.label}
    >
      <Icon className="size-full" strokeWidth={2.25} />
    </span>
  );

  return withTooltip ? (
    <Tooltip content={meta.label}>
      <span className="inline-flex">{icon}</span>
    </Tooltip>
  ) : (
    icon
  );
}

/* -------------------------------------------------------------- priority */

export const PRIORITY_META: Record<
  IssuePriority,
  { label: string; icon: typeof ChevronsUp; varName: string }
> = {
  URGENT: { label: 'Срочный', icon: ChevronsUp, varName: '--priority-urgent' },
  HIGH: { label: 'Высокий', icon: ChevronUp, varName: '--priority-high' },
  MEDIUM: { label: 'Средний', icon: Equal, varName: '--priority-medium' },
  LOW: { label: 'Низкий', icon: ChevronDown, varName: '--priority-low' },
  NONE: { label: 'Без приоритета', icon: Minus, varName: '--priority-none' },
};

export function PriorityIcon({
  priority,
  className,
  withTooltip = true,
}: {
  priority: IssuePriority;
  className?: string;
  withTooltip?: boolean;
}) {
  const meta = PRIORITY_META[priority];
  const Icon = meta.icon;
  const icon = (
    <span
      className={clsx('inline-flex shrink-0 items-center justify-center', className ?? 'size-4')}
      style={{ color: `var(${meta.varName})` }}
      aria-label={meta.label}
    >
      <Icon className="size-full" strokeWidth={2.5} />
    </span>
  );

  return withTooltip ? (
    <Tooltip content={meta.label}>
      <span className="inline-flex">{icon}</span>
    </Tooltip>
  ) : (
    icon
  );
}

/* ---------------------------------------------------------------- status */

const CATEGORY_SHAPE: Record<StatusCategory, string> = {
  BACKLOG: 'border-dashed',
  UNSTARTED: '',
  STARTED: '',
  COMPLETED: '',
  CANCELED: '',
};

/** Status indicator whose fill communicates progress at a glance. */
export function StatusDot({ status, className }: { status: Pick<StatusDto, 'color' | 'category' | 'name'>; className?: string }) {
  const filled = status.category === 'COMPLETED' || status.category === 'CANCELED';
  const half = status.category === 'STARTED';

  return (
    <span
      className={clsx('relative inline-flex shrink-0 items-center justify-center', className ?? 'size-3.5')}
      aria-hidden="true"
    >
      {/* Square, not round: the whole product is drawn with hard edges, and a
          half-filled square reads "in progress" just as clearly as a pie. */}
      <span
        className={clsx('size-full border-2', CATEGORY_SHAPE[status.category])}
        style={{
          borderColor: status.color,
          background: filled
            ? status.color
            : half
              ? `linear-gradient(90deg, ${status.color} 0 50%, transparent 50% 100%)`
              : 'transparent',
        }}
      />
    </span>
  );
}

export function StatusPill({
  status,
  className,
  size = 'md',
}: {
  status: Pick<StatusDto, 'color' | 'category' | 'name'>;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 border-2 border-border-strong font-mono font-bold uppercase tracking-widest whitespace-nowrap',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-2xs',
        className,
      )}
      style={{ backgroundColor: hexWithAlpha(status.color, 0.2) }}
    >
      <StatusDot status={status} className={size === 'sm' ? 'size-2.5' : 'size-3'} />
      {status.name}
    </span>
  );
}

/* ---------------------------------------------------------------- labels */

export function LabelChip({
  label,
  onRemove,
  size = 'md',
}: {
  label: Pick<LabelDto, 'name' | 'color'>;
  onRemove?: () => void;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 border-2 border-border-strong bg-surface-sunken font-mono font-medium whitespace-nowrap text-text-muted',
        size === 'sm' ? 'px-1.5 py-px text-[10px]' : 'px-2 py-0.5 text-2xs',
      )}
    >
      <span className="size-1.5 shrink-0" style={{ backgroundColor: label.color }} />
      {label.name}
      {onRemove && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          aria-label={`Убрать метку ${label.name}`}
          className="ml-0.5 opacity-60 hover:opacity-100"
        >
          <svg viewBox="0 0 24 24" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </span>
  );
}

/* -------------------------------------------------------------- due date */

export function DueDateChip({
  value,
  hasTime = false,
  carriedDays = 0,
  done = false,
  className,
}: {
  value: string | null;
  hasTime?: boolean;
  /** Days the task was carried over to the next day unfinished. */
  carriedDays?: number;
  /** A closed task is never overdue — its date is history, not an alarm. */
  done?: boolean;
  className?: string;
}) {
  const label = dueDateLabel(value, hasTime);
  if (!label) return null;
  const due = done ? { ...label, tone: 'normal' as const, overdueDays: 0 } : label;
  const carried =
    carriedDays > 0 ? ` · переносилась на следующий день ${pluralize(carriedDays, ['раз', 'раза', 'раз'])}` : '';

  // Only a date that demands action is printed as a plate. A date that is
  // merely in the future is set as plain text, so a column of cards shows
  // colour exactly where something is wrong.
  const tones = {
    overdue: 'bg-danger text-accent-fg font-bold',
    today: 'bg-marker text-ink font-bold',
    soon: 'text-text-muted',
    normal: 'text-text-subtle',
  } as const;
  const isPlate = due.tone === 'overdue' || due.tone === 'today';

  return (
    <span
      className={clsx(
        'fd-num inline-flex items-center gap-1 text-2xs whitespace-nowrap',
        isPlate && 'px-1.5 py-0.5',
        tones[due.tone],
        className,
      )}
      title={
        due.tone === 'overdue'
          ? due.overdueDays > 0
            ? `Просрочено на ${pluralize(due.overdueDays, ['день', 'дня', 'дней'])} — срок был ${due.label}`
            : `Просрочено — срок был ${due.label}`
          : `Срок: ${due.label}${carried}`
      }
    >
      {!isPlate && (
        <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="16" />
          <path d="M8 3v4M16 3v4M3 11h18" strokeLinecap="round" />
        </svg>
      )}
      {due.label}
      {/* How long it has been overdue, counted in days, as Weeek does; «Вчера» already says one. */}
      {due.overdueDays > 1 && <span className="font-normal opacity-80">· {due.overdueDays} дн</span>}
      {/* Carried over unfinished: the delay stays visible although the date is today again. */}
      {carriedDays > 0 && due.tone !== 'overdue' && <span className="font-normal opacity-80">· +{carriedDays} дн</span>}
    </span>
  );
}

/* ------------------------------------------------------- project & epic */

export function EpicChip({
  epic,
  className,
}: {
  epic: { issueKey: string; title: string; color: string };
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex max-w-32 items-center gap-1 border-2 border-border-strong px-1.5 py-0.5 font-mono text-[10px] font-medium',
        className,
      )}
      style={{ backgroundColor: hexWithAlpha(epic.color, 0.22) }}
      title={`Эпик: ${epic.title}`}
    >
      <Zap className="size-2.5 shrink-0" />
      <span className="truncate">{epic.title}</span>
    </span>
  );
}

