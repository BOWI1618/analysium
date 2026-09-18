import { memo } from 'react';
import clsx from 'clsx';
import type { IssueSummaryDto } from '@flowdesk/contracts';
import { MessageSquare, Paperclip, ListChecks, Repeat } from 'lucide-react';
import { Avatar } from '~/ui/Avatar';
import { pluralize } from '~/lib/format';
import { RECURRENCE_LABEL } from '~/lib/labels';
import { DueDateChip, EpicChip, IssueTypeIcon, LabelChip, PriorityIcon } from './IssueMeta';
import { DoneToggle, isClosedStatus } from './DoneToggle';

/** What a board card shows, chosen in the board settings. */
export interface IssueCardFields {
  priority: boolean;
  type: boolean;
  labels: boolean;
  epic: boolean;
  dueDate: boolean;
  assignee: boolean;
  /** Subtasks, comments and files. */
  counters: boolean;
}

export const ALL_CARD_FIELDS: IssueCardFields = {
  priority: true,
  type: true,
  labels: true,
  epic: true,
  dueDate: true,
  assignee: true,
  counters: true,
};

export interface IssueCardProps {
  issue: IssueSummaryDto;
  onClick?: () => void;
  isDragging?: boolean;
  isSelected?: boolean;
  showProject?: boolean;
  className?: string;
  fields?: IssueCardFields;
  /** Shows the checkbox that closes the task and opens it again. */
  onToggleDone?: () => void;
}

/**
 * Board card. Deliberately compact — the goal is to scan a column of twenty
 * cards, so every element earns its place: type, key, title, then only the
 * metadata that actually exists on this issue.
 *
 * Memoised because a drag re-renders the whole column otherwise.
 */
export const IssueCard = memo(function IssueCard({
  issue,
  onClick,
  isDragging,
  isSelected,
  showProject,
  className,
  fields = ALL_CARD_FIELDS,
  onToggleDone,
}: IssueCardProps) {
  const hasFooterMeta =
    fields.counters && (issue.commentCount > 0 || issue.attachmentCount > 0 || issue.subtaskCount > 0);
  const done = isClosedStatus(issue.status);
  const epic = fields.epic ? issue.epic : null;
  const labels = fields.labels ? issue.labels : [];

  return (
    <article
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onClick?.();
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`${issue.issueKey}: ${issue.title}`}
      className={clsx(
        'group cursor-grab border-2 bg-surface p-3 text-left shadow-sm',
        'transition-[background-color,border-color,box-shadow,translate] duration-100',
        'hover:-translate-x-px hover:-translate-y-px hover:shadow-md active:translate-x-px active:translate-y-px active:shadow-none',
        isSelected ? 'border-accent shadow-md' : 'border-border-strong',
        isDragging && 'opacity-40 shadow-drag',
        className,
      )}
    >
      {/* Header: the key leads, because a column is read as an index */}
      <div className="flex items-center gap-1.5">
        {onToggleDone && <DoneToggle done={done} issueKey={issue.issueKey} onToggle={onToggleDone} />}
        <span className="fd-key font-bold text-text">{issue.issueKey}</span>
        {showProject && (
          <span className="truncate text-2xs text-text-subtle" title={issue.project.name}>
            · {issue.project.name}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {fields.priority && issue.priority !== 'NONE' && <PriorityIcon priority={issue.priority} className="size-3.5" />}
          {fields.type && <IssueTypeIcon type={issue.type} className="size-3.5" />}
        </span>
      </div>

      {/* Title */}
      <h3
        className={clsx(
          'mt-1.5 line-clamp-3 text-sm leading-snug font-semibold group-hover:text-accent',
          onToggleDone && done ? 'text-text-subtle line-through' : 'text-text',
        )}
      >
        {issue.title}
      </h3>

      {/* Epic + labels */}
      {(epic || labels.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {epic && <EpicChip epic={epic} />}
          {labels.slice(0, 3).map((label) => (
            <LabelChip key={label.id} label={label} size="sm" />
          ))}
          {labels.length > 3 && (
            <span className="text-2xs text-text-subtle">+{labels.length - 3}</span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 flex items-center gap-2">
        {fields.dueDate && issue.dueDate && <DueDateChip value={issue.dueDate} hasTime={issue.dueHasTime} carriedDays={issue.carriedOverDays} done={done} />}
        {issue.recurrence && (
          <span className="text-text-subtle" title={`Повторяется ${RECURRENCE_LABEL[issue.recurrence]}`}>
            <Repeat className="size-3" aria-label={`Повторяется ${RECURRENCE_LABEL[issue.recurrence]}`} />
          </span>
        )}

        {hasFooterMeta && (
          <span className="fd-num flex items-center gap-2 text-2xs text-text-subtle">
            {issue.subtaskCount > 0 && (
              <span
                className="flex items-center gap-0.5"
                title={`Подзадачи: ${issue.subtaskDoneCount} из ${issue.subtaskCount} готово`}
              >
                <ListChecks className="size-3" />
                {issue.subtaskDoneCount}/{issue.subtaskCount}
              </span>
            )}
            {issue.commentCount > 0 && (
              <span className="flex items-center gap-0.5" title={pluralize(issue.commentCount, ['комментарий', 'комментария', 'комментариев'])}>
                <MessageSquare className="size-3" />
                {issue.commentCount}
              </span>
            )}
            {issue.attachmentCount > 0 && (
              <span className="flex items-center gap-0.5" title={pluralize(issue.attachmentCount, ['файл', 'файла', 'файлов'])}>
                <Paperclip className="size-3" />
                {issue.attachmentCount}
              </span>
            )}
          </span>
        )}

        <span className="ml-auto flex items-center gap-1.5">
          {fields.assignee && <Avatar user={issue.assignee} size="md" showEmpty={false} />}
        </span>
      </div>
    </article>
  );
});
