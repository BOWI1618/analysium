import { memo } from 'react';
import clsx from 'clsx';
import type { IssueSummaryDto, StatusDto, UserSummaryDto } from '@flowdesk/contracts';
import { Avatar } from '~/ui/Avatar';
import { relativeTime } from '~/lib/format';
import {
  DueDateChip,
  EpicChip,
  IssueTypeIcon,
  LabelChip,
  PriorityIcon,
  StatusPill,
  StoryPoints,
} from './IssueMeta';
import { PriorityPicker, StatusPicker, UserPicker } from './Pickers';

export type ListColumn =
  | 'status'
  | 'priority'
  | 'assignee'
  | 'reporter'
  | 'labels'
  | 'sprint'
  | 'epic'
  | 'dueDate'
  | 'points'
  | 'updated'
  | 'project';

export const ALL_COLUMNS: { key: ListColumn; label: string; width: string }[] = [
  { key: 'status', label: 'Status', width: 'w-32' },
  { key: 'priority', label: 'Priority', width: 'w-8' },
  { key: 'assignee', label: 'Assignee', width: 'w-8' },
  { key: 'reporter', label: 'Reporter', width: 'w-8' },
  { key: 'labels', label: 'Labels', width: 'w-40' },
  { key: 'epic', label: 'Epic', width: 'w-32' },
  { key: 'project', label: 'Project', width: 'w-24' },
  { key: 'points', label: 'Points', width: 'w-12' },
  { key: 'dueDate', label: 'Due', width: 'w-24' },
  { key: 'updated', label: 'Updated', width: 'w-20' },
];

export const DEFAULT_COLUMNS: ListColumn[] = ['status', 'priority', 'assignee', 'labels', 'dueDate', 'updated'];

export interface IssueRowProps {
  issue: IssueSummaryDto;
  columns: ListColumn[];
  selected: boolean;
  focused?: boolean;
  /** `shiftKey` extends the selection as a range, like a file manager. */
  onToggleSelect: (event: { shiftKey: boolean }) => void;
  /**
   * Whether this list supports selecting rows at all. Where it does not, the
   * checkbox is left out instead of sitting there invisible: on a touch screen
   * there is no hover to reveal it, yet tapping its empty square selected the
   * row.
   */
  selectable?: boolean;
  onOpen: () => void;
  /** Inline editing is disabled when the viewer lacks permission. */
  editable?: boolean;
  statuses?: StatusDto[];
  members?: UserSummaryDto[];
  onPatch?: (patch: Record<string, unknown>) => void;
}

/**
 * List-view row with inline editing: status, priority and assignee are
 * editable in place, so triaging a backlog never requires opening an issue.
 */
export const IssueRow = memo(function IssueRow({
  issue,
  columns,
  selected,
  focused,
  onToggleSelect,
  onOpen,
  editable,
  statuses = [],
  members = [],
  onPatch,
  selectable = true,
}: IssueRowProps) {
  const show = (column: ListColumn) => columns.includes(column);

  return (
    <div
      role="row"
      tabIndex={0}
      data-issue-row
      aria-selected={selected}
      onClick={onOpen}
      onKeyDown={(event) => {
        // Only keys aimed at the row itself: a picker or checkbox inside handles its own.
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          onOpen();
        } else if (event.key === ' ' && selectable) {
          event.preventDefault();
          onToggleSelect({ shiftKey: event.shiftKey });
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          // Rows across every group on the page, in reading order — grouped
          // "Мои задачи" moves straight from one group into the next.
          const rows = [...document.querySelectorAll<HTMLElement>('[data-issue-row]')];
          const next = rows[rows.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1)];
          next?.focus();
          next?.scrollIntoView({ block: 'nearest' });
        }
      }}
      className={clsx(
        'group flex cursor-pointer items-center gap-2 border-b-2 border-border-strong px-3 py-2 transition-colors',
        selected ? 'bg-marker-subtle' : 'hover:bg-surface-hover',
        focused && 'ring-1 ring-accent ring-inset',
      )}
    >
      {selectable && (
        <input
          type="checkbox"
          checked={selected}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelect(event);
          }}
          onChange={() => undefined}
          aria-label={`Выбрать ${issue.issueKey}`}
          className={clsx(
            'size-3.5 shrink-0 cursor-pointer rounded-xs accent-[var(--accent)]',
            // Revealed on hover with a mouse; always shown on touch, which has no hover.
            !selected &&
              'opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100',
          )}
        />
      )}

      <IssueTypeIcon type={issue.type} className="size-3.5 shrink-0" />

      <span className="fd-key shrink-0 truncate" style={{ width: 'var(--key-rail)' }}>
        {issue.issueKey}
      </span>

      {/* Two lines on a phone rather than a few truncated words; one line from sm up. */}
      <span className="line-clamp-2 min-w-0 flex-1 text-sm font-bold break-words text-text group-hover:text-accent sm:line-clamp-none sm:min-w-40 sm:truncate">
        {issue.title}
        {issue.subtaskCount > 0 && (
          <span className="fd-num ml-2 text-2xs font-normal text-text-subtle">
            {issue.subtaskDoneCount}/{issue.subtaskCount}
          </span>
        )}
      </span>

      {show('labels') && (
        <span className="hidden w-32 shrink-0 items-center gap-1 overflow-hidden xl:flex">
          {issue.labels.slice(0, 2).map((label) => (
            <LabelChip key={label.id} label={label} size="sm" />
          ))}
          {issue.labels.length > 2 && (
            <span className="text-2xs text-text-subtle">+{issue.labels.length - 2}</span>
          )}
        </span>
      )}

      {show('epic') && (
        <span className="hidden w-32 shrink-0 xl:block">
          {issue.epic && <EpicChip epic={issue.epic} />}
        </span>
      )}

      {show('project') && (
        <span className="hidden w-24 shrink-0 truncate text-2xs text-text-subtle xl:block">
          <span aria-hidden="true">{issue.project.icon}</span>{' '}
          <span className="fd-key">{issue.project.key}</span>
        </span>
      )}

      {show('points') && (
        <span className="hidden w-10 shrink-0 justify-center lg:flex">
          <StoryPoints points={issue.storyPoints} />
        </span>
      )}

      {show('dueDate') && (
        <span className="hidden w-24 shrink-0 justify-end lg:flex">
          <DueDateChip value={issue.dueDate} />
        </span>
      )}

      {show('status') && (
        <span className="hidden w-32 shrink-0 sm:block" onClick={(event) => event.stopPropagation()}>
          {editable && onPatch && statuses.length > 0 ? (
            <StatusPicker
              statuses={statuses}
              value={issue.statusId}
              align="end"
              onChange={(statusId) => onPatch({ statusId })}
            >
              <button type="button" className="hover:opacity-80">
                <StatusPill status={issue.status} size="sm" />
              </button>
            </StatusPicker>
          ) : (
            <StatusPill status={issue.status} size="sm" />
          )}
        </span>
      )}

      {show('priority') && (
        <span className="shrink-0" onClick={(event) => event.stopPropagation()}>
          {editable && onPatch ? (
            <PriorityPicker value={issue.priority} align="end" onChange={(priority) => onPatch({ priority })}>
              <button type="button" className="inline-flex rounded-sm p-0.5 hover:bg-surface-active">
                <PriorityIcon priority={issue.priority} className="size-3.5" />
              </button>
            </PriorityPicker>
          ) : (
            <PriorityIcon priority={issue.priority} className="size-3.5" />
          )}
        </span>
      )}

      {show('updated') && (
        <span className="fd-num hidden w-16 shrink-0 text-right text-2xs text-text-subtle xl:block">
          {relativeTime(issue.updatedAt)}
        </span>
      )}

      {show('assignee') && (
        <span className="shrink-0" onClick={(event) => event.stopPropagation()}>
          {editable && onPatch ? (
            <UserPicker
              users={members}
              value={issue.assignee?.id ?? null}
              align="end"
              onChange={(assigneeId) => onPatch({ assigneeId })}
            >
              <button type="button" className="inline-flex hover:opacity-80">
                <Avatar user={issue.assignee} size="md" />
              </button>
            </UserPicker>
          ) : (
            <Avatar user={issue.assignee} size="md" />
          )}
        </span>
      )}
    </div>
  );
});

/** Sticky header describing the visible columns. */
export function IssueRowHeader({ columns, selectable = true }: { columns: ListColumn[]; selectable?: boolean }) {
  const show = (column: ListColumn) => columns.includes(column);

  return (
    <div
      role="row"
      className="sticky top-0 z-10 flex items-center gap-2 border-b-2 border-border-strong bg-surface-sunken px-3 py-1.5 text-2xs font-bold tracking-wide text-text-subtle uppercase"
    >
      {/* Spacers mirror the row: the checkbox (only where rows are selectable) and the type icon. */}
      {selectable && <span className="size-3.5 shrink-0" />}
      <span className="size-3.5 shrink-0" />
      <span className="shrink-0" style={{ width: 'var(--key-rail)' }}>
        Ключ
      </span>
      <span className="min-w-0 flex-1 sm:min-w-40">Задача</span>
      {show('labels') && <span className="hidden w-32 shrink-0 xl:block">Метки</span>}
      {show('epic') && <span className="hidden w-32 shrink-0 xl:block">Эпик</span>}
      {show('project') && <span className="hidden w-24 shrink-0 xl:block">Проект</span>}
      {show('points') && <span className="hidden w-10 shrink-0 text-center lg:block">SP</span>}
      {show('dueDate') && <span className="hidden w-24 shrink-0 text-right lg:block">Срок</span>}
      {show('status') && <span className="hidden w-32 shrink-0 sm:block">Статус</span>}
      {show('priority') && <span className="w-5 shrink-0" aria-label="Приоритет" />}
      {show('updated') && <span className="hidden w-16 shrink-0 text-right xl:block">Обновлено</span>}
      {show('assignee') && <span className="w-6 shrink-0" />}
    </div>
  );
}
