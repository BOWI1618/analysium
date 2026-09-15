import clsx from 'clsx';
import { Check } from 'lucide-react';
import type { StatusDto } from '@flowdesk/contracts';

/** A task counts as closed in a finished or cancelled status. */
export function isClosedStatus(status: Pick<StatusDto, 'category'>): boolean {
  return status.category === 'COMPLETED' || status.category === 'CANCELED';
}

/** Where a checkbox puts a task it closes: the project's first finished status. */
export function doneStatusId(statuses: StatusDto[]): string | undefined {
  return statuses.find((s) => s.category === 'COMPLETED')?.id;
}

/** Where a task goes back when it is reopened: the first not started status, else any open one. */
export function reopenStatusId(statuses: StatusDto[]): string | undefined {
  return (
    statuses.find((s) => s.category === 'UNSTARTED')?.id ??
    statuses.find((s) => !isClosedStatus(s))?.id
  );
}

/**
 * The checkbox that closes a task and opens it again, the same on every card:
 * board, calendar and the task itself.
 */
export function DoneToggle({
  done,
  issueKey,
  onToggle,
  className,
}: {
  done: boolean;
  issueKey: string;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      // A drag must not start from the checkbox.
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      aria-label={done ? `Вернуть в работу ${issueKey}` : `Отметить выполненной ${issueKey}`}
      aria-pressed={done}
      className={clsx(
        'flex size-3.5 shrink-0 items-center justify-center border-2 border-border-strong',
        done ? 'bg-success text-accent-fg' : 'bg-surface hover:bg-success-subtle',
        className,
      )}
    >
      {done && <Check className="size-2.5" strokeWidth={3} />}
    </button>
  );
}
