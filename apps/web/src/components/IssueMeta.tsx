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
import { contrastText, dueDateLabel, hexWithAlpha, plural } from '~/lib/format';
import { Tooltip } from '~/ui/Tooltip';

/* ------------------------------------------------------------ issue type */

export const ISSUE_TYPE_META: Record<IssueType, { label: string; icon: typeof Bug; color: string }> = {
  TASK: { label: 'Задача', icon: CheckSquare, color: '#3b82f6' },
  BUG: { label: 'Баг', icon: Bug, color: '#ef4444' },
  STORY: { label: 'История', icon: Bookmark, color: '#22c55e' },
  EPIC: { label: 'Эпик', icon: Zap, color: '#8b5cf6' },
  SUBTASK: { label: 'Подзадача', icon: GitBranch, color: '#64748b' },
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
      className={clsx('inline-flex shrink-0 items-center justify-center rounded-xs', className ?? 'size-4')}
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

/** Circular status indicator whose fill communicates progress at a glance. */
export function StatusDot({ status, className }: { status: Pick<StatusDto, 'color' | 'category' | 'name'>; className?: string }) {
  const filled = status.category === 'COMPLETED' || status.category === 'CANCELED';
  const half = status.category === 'STARTED';

  return (
    <span
      className={clsx('relative inline-flex shrink-0 items-center justify-center', className ?? 'size-3.5')}
      aria-hidden="true"
    >
      <span
        className={clsx('size-full rounded-full border-2', CATEGORY_SHAPE[status.category])}
        style={{
          borderColor: status.color,
          background: filled ? status.color : half ? `conic-gradient(${status.color} 0 50%, transparent 50% 100%)` : 'transparent',
        }}
      />
      {filled && status.category === 'COMPLETED' && (
        <svg viewBox="0 0 24 24" className="absolute size-2 text-white" fill="none" stroke="currentColor" strokeWidth="4">
          <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
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
        'inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap',
        size === 'sm' ? 'px-1.5 py-0.5 text-2xs' : 'px-2 py-0.5 text-xs',
        className,
      )}
      style={{
        color: status.color,
        borderColor: hexWithAlpha(status.color, 0.35),
        backgroundColor: hexWithAlpha(status.color, 0.1),
      }}
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
        'inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap',
        size === 'sm' ? 'px-1.5 py-px text-2xs' : 'px-2 py-0.5 text-xs',
      )}
      style={{ backgroundColor: hexWithAlpha(label.color, 0.16), color: label.color }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: label.color }} />
      {label.name}
      {onRemove && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          aria-label={`Убрать метку ${label.name}`}
          className="ml-0.5 rounded-full opacity-60 hover:opacity-100"
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

export function DueDateChip({ value, className }: { value: string | null; className?: string }) {
  const due = dueDateLabel(value);
  if (!due) return null;

  const tones = {
    overdue: 'text-danger bg-danger-subtle',
    today: 'text-warning bg-warning-subtle',
    soon: 'text-text-muted bg-surface-active',
    normal: 'text-text-subtle bg-surface-active',
  } as const;

  return (
    <span
      className={clsx(
        'fd-num inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-2xs font-medium whitespace-nowrap',
        tones[due.tone],
        className,
      )}
      title={due.tone === 'overdue' ? `Просрочено — срок был ${due.label}` : `Срок: ${due.label}`}
    >
      <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 11h18" strokeLinecap="round" />
      </svg>
      {due.label}
    </span>
  );
}

/* ------------------------------------------------------- project & epic */

export function ProjectBadge({
  project,
  className,
}: {
  project: { key: string; name: string; color: string; icon: string };
  className?: string;
}) {
  return (
    <span
      className={clsx('fd-key inline-flex items-center gap-1', className)}
      title={project.name}
    >
      <span aria-hidden="true">{project.icon}</span>
      {project.key}
    </span>
  );
}

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
        'inline-flex max-w-32 items-center gap-1 rounded-full px-1.5 py-0.5 text-2xs font-medium',
        className,
      )}
      style={{ backgroundColor: hexWithAlpha(epic.color, 0.16), color: epic.color }}
      title={`Эпик: ${epic.title}`}
    >
      <Zap className="size-2.5 shrink-0" />
      <span className="truncate">{epic.title}</span>
    </span>
  );
}

export function StoryPoints({ points, className }: { points: number | null; className?: string }) {
  if (points === null) return null;
  return (
    <span
      className={clsx(
        'fd-num inline-flex size-4.5 min-w-4.5 items-center justify-center rounded-full bg-surface-active px-1 text-2xs font-semibold text-text-muted',
        className,
      )}
      title={`${points} ${plural(points, ['стори-поинт', 'стори-поинта', 'стори-поинтов'])}`}
    >
      {points}
    </span>
  );
}

export function projectTextColor(hex: string): string {
  return contrastText(hex);
}
