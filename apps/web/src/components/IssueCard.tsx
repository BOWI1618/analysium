import { memo } from 'react';
import clsx from 'clsx';
import type { IssueSummaryDto } from '@flowdesk/contracts';
import { MessageSquare, Paperclip, ListChecks } from 'lucide-react';
import { Avatar } from '~/ui/Avatar';
import { DueDateChip, EpicChip, IssueTypeIcon, LabelChip, PriorityIcon, StoryPoints } from './IssueMeta';

export interface IssueCardProps {
  issue: IssueSummaryDto;
  onClick?: () => void;
  isDragging?: boolean;
  isSelected?: boolean;
  showProject?: boolean;
  className?: string;
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
}: IssueCardProps) {
  const hasFooterMeta =
    issue.commentCount > 0 || issue.attachmentCount > 0 || issue.subtaskCount > 0 || issue.storyPoints !== null;

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
        'group cursor-pointer rounded-lg border bg-surface p-2.5 text-left transition-colors',
        'hover:border-border-strong hover:bg-surface-hover',
        isSelected ? 'border-accent ring-2 ring-accent/20' : 'border-border',
        isDragging && 'opacity-40',
        className,
      )}
    >
      {/* Header: key + priority */}
      <div className="mb-1.5 flex items-center gap-1.5">
        <IssueTypeIcon type={issue.type} className="size-3.5" />
        <span className="fd-key">{issue.issueKey}</span>
        {showProject && (
          <span className="truncate text-2xs text-text-subtle" title={issue.project.name}>
            · {issue.project.name}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {issue.priority !== 'NONE' && <PriorityIcon priority={issue.priority} className="size-3.5" />}
        </span>
      </div>

      {/* Title */}
      <h3 className="line-clamp-3 text-sm leading-snug font-medium text-text group-hover:text-accent">
        {issue.title}
      </h3>

      {/* Epic + labels */}
      {(issue.epic || issue.labels.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {issue.epic && <EpicChip epic={issue.epic} />}
          {issue.labels.slice(0, 3).map((label) => (
            <LabelChip key={label.id} label={label} size="sm" />
          ))}
          {issue.labels.length > 3 && (
            <span className="text-2xs text-text-subtle">+{issue.labels.length - 3}</span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-2.5 flex items-center gap-2">
        {issue.dueDate && <DueDateChip value={issue.dueDate} />}

        {hasFooterMeta && (
          <span className="fd-num flex items-center gap-2 text-2xs text-text-subtle">
            {issue.subtaskCount > 0 && (
              <span
                className="flex items-center gap-0.5"
                title={`${issue.subtaskDoneCount} of ${issue.subtaskCount} subtasks done`}
              >
                <ListChecks className="size-3" />
                {issue.subtaskDoneCount}/{issue.subtaskCount}
              </span>
            )}
            {issue.commentCount > 0 && (
              <span className="flex items-center gap-0.5" title={`${issue.commentCount} comments`}>
                <MessageSquare className="size-3" />
                {issue.commentCount}
              </span>
            )}
            {issue.attachmentCount > 0 && (
              <span className="flex items-center gap-0.5" title={`${issue.attachmentCount} files`}>
                <Paperclip className="size-3" />
                {issue.attachmentCount}
              </span>
            )}
          </span>
        )}

        <span className="ml-auto flex items-center gap-1.5">
          <StoryPoints points={issue.storyPoints} />
          <Avatar user={issue.assignee} size="md" showEmpty={false} />
        </span>
      </div>
    </article>
  );
});
