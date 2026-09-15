import { memo } from 'react';
import clsx from 'clsx';
import { ChevronRight, Columns3, CornerDownRight, MessageSquare, UserPen } from 'lucide-react';
import type { IssueSummaryDto, StatusDto, UserSummaryDto } from '@flowdesk/contracts';
import { useUiStore } from '~/app/uiStore';
import { useIssue, usePatchIssue } from '~/features/issues/hooks';
import { Avatar } from '~/ui/Avatar';
import { ProjectIcon } from '~/ui/ProjectIcon';
import { relativeTime, shortDate } from '~/lib/format';
import { Button } from '~/ui/Button';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from '~/ui/Menu';
import {
  DueDateChip,
  EpicChip,
  ISSUE_TYPE_META,
  IssueTypeIcon,
  LabelChip,
  PriorityIcon,
  StatusPill,
} from './IssueMeta';
import { PriorityPicker, StatusPicker, UserPicker } from './Pickers';

export type ListColumn =
  | 'status'
  | 'priority'
  | 'type'
  | 'assignee'
  | 'reporter'
  | 'labels'
  | 'epic'
  | 'startDate'
  | 'dueDate'
  | 'comments'
  | 'created'
  | 'updated'
  | 'project';

export const ALL_COLUMNS: { key: ListColumn; label: string; width: string }[] = [
  { key: 'status', label: 'Статус', width: 'w-32' },
  { key: 'priority', label: 'Приоритет', width: 'w-8' },
  { key: 'type', label: 'Тип', width: 'w-24' },
  { key: 'assignee', label: 'Исполнитель', width: 'w-8' },
  { key: 'reporter', label: 'Автор', width: 'w-8' },
  { key: 'labels', label: 'Метки', width: 'w-40' },
  { key: 'epic', label: 'Эпик', width: 'w-32' },
  { key: 'project', label: 'Проект', width: 'w-24' },
  { key: 'startDate', label: 'Начало', width: 'w-20' },
  { key: 'dueDate', label: 'Срок', width: 'w-24' },
  { key: 'comments', label: 'Комментарии', width: 'w-10' },
  { key: 'created', label: 'Создано', width: 'w-20' },
  { key: 'updated', label: 'Обновлено', width: 'w-20' },
];

/** Pixel widths of the optional cells, matching the Tailwind widths used below. */
const COLUMN_PX: Record<ListColumn, number> = {
  status: 128,
  priority: 20,
  type: 96,
  assignee: 24,
  reporter: 24,
  labels: 128,
  epic: 128,
  project: 96,
  startDate: 80,
  dueDate: 96,
  comments: 40,
  created: 80,
  updated: 80,
};

/**
 * The narrowest a list can get before its cells would overlap. Lists set it as
 * a minimum width from `sm` up and scroll sideways past it, so every column the
 * user picked stays visible instead of running off the edge.
 */
export function listMinWidth(columns: ListColumn[], selectable = true): number {
  const fixed =
    24 /* padding */ + (selectable ? 14 : 0) + 16 /* fold */ + 14 /* type icon */ + 68 /* key */ + 160 /* title */ + 12; /* subtask indent */
  const cells = columns.reduce((sum, column) => sum + (COLUMN_PX[column] ?? 0), 0);
  const items = (selectable ? 1 : 0) + 4 + columns.length;
  return fixed + cells + 8 * (items - 1);
}

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
  /**
   * 1 for a subtask unfolded under its parent: indented, and without a
   * checkbox of its own (selection belongs to the list's top-level rows).
   */
  depth?: 0 | 1;
  /** For a row without a checkbox in a list whose rows have one. */
  alignWithCheckbox?: boolean;
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
  depth = 0,
  alignWithCheckbox = false,
}: IssueRowProps) {
  const show = (column: ListColumn) => columns.includes(column);
  const expandable = depth === 0 && issue.subtaskCount > 0;
  const expanded = useUiStore((s) => expandable && Boolean(s.expandedIssueIds[issue.id]));
  const toggleExpanded = useUiStore((s) => s.toggleIssueExpanded);

  return (
    <>
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
        } else if (expandable && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
          event.preventDefault();
          toggleExpanded(issue.id, event.key === 'ArrowRight');
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
        'group flex cursor-pointer items-center gap-2 border-b-2 border-border-strong py-2 pr-3 transition-colors',
        depth === 1 ? 'bg-surface-sunken pl-3' : 'pl-3',
        selected ? 'bg-marker-subtle' : 'hover:bg-surface-hover',
        focused && 'ring-1 ring-accent ring-inset',
      )}
    >
      {/* An unfolded subtask keeps the checkbox column, so every column below lines up. */}
      {!selectable && alignWithCheckbox && <span className="size-3.5 shrink-0" />}
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

      {/* Fold toggle for subtasks; the same slot holds the connector of an unfolded subtask. */}
      <span className="flex w-4 shrink-0 justify-center">
        {expandable ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? `Свернуть подзадачи ${issue.issueKey}` : `Показать подзадачи ${issue.issueKey}`}
            onClick={(event) => {
              event.stopPropagation();
              toggleExpanded(issue.id);
            }}
            className="inline-flex size-4 items-center justify-center text-text-subtle hover:bg-surface-active hover:text-text"
          >
            <ChevronRight className={clsx('size-3.5 transition-transform', expanded && 'rotate-90')} />
          </button>
        ) : depth === 1 ? (
          <CornerDownRight className="size-3.5 text-text-subtle" aria-hidden="true" />
        ) : null}
      </span>

      <IssueTypeIcon type={issue.type} className={clsx('size-3.5 shrink-0', depth === 1 && 'ml-3')} />

      <span className="fd-key shrink-0 truncate" style={{ width: 'var(--key-rail)' }}>
        {issue.issueKey}
      </span>

      {/* Two lines on a phone rather than a few truncated words; one line from sm up. */}
      <span className="line-clamp-2 min-w-0 flex-1 text-sm font-bold break-words text-text group-hover:text-accent sm:line-clamp-none sm:min-w-24 sm:truncate xl:min-w-40">
        {/* A subtask listed on its own (in «Мои задачи») says whose part it is. */}
        {depth === 0 && issue.parent && (
          <span className="fd-key mr-1.5 font-normal text-text-subtle" title={issue.parent.title}>
            {issue.parent.issueKey} ›
          </span>
        )}
        {issue.title}
        {issue.subtaskCount > 0 && (
          <span className="fd-num ml-2 text-2xs font-normal text-text-subtle">
            {issue.subtaskDoneCount}/{issue.subtaskCount}
          </span>
        )}
      </span>

      {show('type') && (
        <span className="hidden w-24 shrink-0 items-center gap-1 truncate text-2xs text-text-muted sm:flex">
          <IssueTypeIcon type={issue.type} withTooltip={false} className="size-3 shrink-0" />
          {ISSUE_TYPE_META[issue.type].label}
        </span>
      )}

      {show('labels') && (
        <span className="hidden w-32 shrink-0 items-center gap-1 overflow-hidden sm:flex">
          {issue.labels.slice(0, 2).map((label) => (
            <LabelChip key={label.id} label={label} size="sm" />
          ))}
          {issue.labels.length > 2 && (
            <span className="text-2xs text-text-subtle">+{issue.labels.length - 2}</span>
          )}
        </span>
      )}

      {show('epic') && (
        <span className="hidden w-32 shrink-0 sm:block">
          {issue.epic && <EpicChip epic={issue.epic} />}
        </span>
      )}

      {show('project') && (
        <span className="hidden w-24 shrink-0 items-center gap-1 truncate text-2xs text-text-subtle sm:flex" title={issue.project.name}>
          <ProjectIcon icon={issue.project.icon} color={issue.project.color} size="sm" />
          <span className="fd-key">{issue.project.key}</span>
        </span>
      )}

      {show('startDate') && (
        <span className="fd-num hidden w-20 shrink-0 text-right text-2xs text-text-subtle sm:block">
          {issue.startDate ? shortDate(issue.startDate) : ''}
        </span>
      )}

      {show('dueDate') && (
        <span className="hidden w-24 shrink-0 justify-end sm:flex">
          <DueDateChip value={issue.dueDate} />
        </span>
      )}

      {show('comments') && (
        <span className="fd-num hidden w-10 shrink-0 items-center justify-end gap-0.5 text-2xs text-text-subtle sm:flex">
          {issue.commentCount > 0 && (
            <>
              <MessageSquare className="size-3" />
              {issue.commentCount}
            </>
          )}
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

      {show('created') && (
        <span className="fd-num hidden w-20 shrink-0 text-right text-2xs whitespace-nowrap text-text-subtle sm:block" title={shortDate(issue.createdAt)}>
          {relativeTime(issue.createdAt)}
        </span>
      )}

      {show('updated') && (
        <span className="fd-num hidden w-20 shrink-0 text-right text-2xs whitespace-nowrap text-text-subtle sm:block">
          {relativeTime(issue.updatedAt)}
        </span>
      )}

      {show('reporter') && (
        <span className="hidden shrink-0 sm:inline-flex" title={issue.reporter ? `Автор: ${issue.reporter.name}` : 'Автор удалён'}>
          <Avatar user={issue.reporter} size="md" />
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
    {expanded && (
      <SubtaskRows
        parentId={issue.id}
        columns={columns}
        editable={editable}
        statuses={statuses}
        members={members}
        alignWithCheckbox={selectable}
      />
    )}
    </>
  );
});

/**
 * The subtasks of an unfolded row, read from the parent's detail — the same
 * cache the issue panel uses, so both stay in step.
 */
function SubtaskRows({
  parentId,
  columns,
  editable,
  statuses,
  members,
  alignWithCheckbox,
}: {
  parentId: string;
  columns: ListColumn[];
  editable?: boolean;
  statuses: StatusDto[];
  members: UserSummaryDto[];
  alignWithCheckbox: boolean;
}) {
  const { data: parent, isLoading } = useIssue(parentId);
  const openIssue = useUiStore((s) => s.openIssue);
  const patchIssue = usePatchIssue();

  if (isLoading || !parent) {
    return (
      <div className="border-b-2 border-border-strong bg-surface-sunken py-2 pl-9 text-2xs text-text-subtle">
        Загружаем подзадачи…
      </div>
    );
  }

  return (
    <div role="rowgroup" aria-label={`Подзадачи ${parent.issueKey}`}>
      {parent.subtasks.map((subtask) => (
        <IssueRow
          key={subtask.id}
          issue={subtask}
          columns={columns}
          depth={1}
          selected={false}
          selectable={false}
          alignWithCheckbox={alignWithCheckbox}
          onToggleSelect={() => undefined}
          onOpen={() => openIssue(subtask.id)}
          editable={editable}
          statuses={statuses}
          members={members}
          onPatch={(patch) => patchIssue.mutate({ issueId: subtask.id, patch })}
        />
      ))}
    </div>
  );
}

/** Sticky header describing the visible columns. */
export function IssueRowHeader({ columns, selectable = true }: { columns: ListColumn[]; selectable?: boolean }) {
  const show = (column: ListColumn) => columns.includes(column);

  return (
    <div
      role="row"
      className="sticky top-0 z-10 flex items-center gap-2 border-b-2 border-border-strong bg-surface-sunken px-3 py-1.5 text-2xs font-bold tracking-wide text-text-subtle uppercase"
    >
      {/* Spacers mirror the row: the checkbox (only where rows are selectable), the fold toggle and the type icon. */}
      {selectable && <span className="size-3.5 shrink-0" />}
      <span className="w-4 shrink-0" />
      <span className="size-3.5 shrink-0" />
      <span className="shrink-0" style={{ width: 'var(--key-rail)' }}>
        Ключ
      </span>
      <span className="min-w-0 flex-1 sm:min-w-40">Задача</span>
      {show('type') && <span className="hidden w-24 shrink-0 sm:block">Тип</span>}
      {show('labels') && <span className="hidden w-32 shrink-0 sm:block">Метки</span>}
      {show('epic') && <span className="hidden w-32 shrink-0 sm:block">Эпик</span>}
      {show('project') && <span className="hidden w-24 shrink-0 sm:block">Проект</span>}
      {show('startDate') && <span className="hidden w-20 shrink-0 text-right sm:block">Начало</span>}
      {show('dueDate') && <span className="hidden w-24 shrink-0 text-right sm:block">Срок</span>}
      {show('comments') && (
        <span className="hidden w-10 shrink-0 justify-end sm:flex" aria-label="Комментарии" title="Комментарии">
          <MessageSquare className="size-3" />
        </span>
      )}
      {show('status') && <span className="hidden w-32 shrink-0 sm:block">Статус</span>}
      {show('priority') && <span className="w-5 shrink-0" aria-label="Приоритет" />}
      {show('created') && <span className="hidden w-20 shrink-0 text-right sm:block">Создано</span>}
      {show('updated') && <span className="hidden w-20 shrink-0 text-right sm:block">Обновлено</span>}
      {show('reporter') && (
        <span className="hidden w-6 shrink-0 justify-center sm:flex" aria-label="Автор" title="Автор">
          <UserPen className="size-3" />
        </span>
      )}
      {show('assignee') && <span className="w-6 shrink-0" />}
    </div>
  );
}

/** Which columns a list shows. The choice is remembered per list by the caller. */
export function ColumnsMenu({
  columns,
  onChange,
}: {
  columns: ListColumn[];
  onChange: (columns: ListColumn[]) => void;
}) {
  return (
    // Hidden on phones: there every optional column is folded away by width,
    // so the menu would toggle things nobody could see.
    <div className="hidden sm:block">
      <Menu>
        <MenuTrigger>
          <Button size="xs" variant="ghost" iconLeft={<Columns3 className="size-3" />}>
            Колонки
          </Button>
        </MenuTrigger>
        <MenuContent align="end" width={200} label="Видимые колонки">
          <MenuLabel>Показывать колонки</MenuLabel>
          {ALL_COLUMNS.map((column) => (
            <MenuItem
              key={column.key}
              keepOpen
              selected={columns.includes(column.key)}
              onSelect={() =>
                onChange(
                  columns.includes(column.key)
                    ? columns.filter((c) => c !== column.key)
                    : // Kept in menu order, so the row layout does not depend on click order.
                      ALL_COLUMNS.map((c) => c.key).filter((key) => key === column.key || columns.includes(key)),
                )
              }
            >
              {column.label}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
    </div>
  );
}
