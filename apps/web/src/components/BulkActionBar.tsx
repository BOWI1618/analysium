import { useState, type ReactNode } from 'react';
import type { StatusDto, UserSummaryDto } from '@flowdesk/contracts';
import { ISSUE_PRIORITIES, type IssuePriority } from '@flowdesk/contracts';
import { X } from 'lucide-react';
import { Avatar } from '~/ui/Avatar';
import { Button } from '~/ui/Button';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '~/ui/Menu';
import { PriorityIcon, PRIORITY_META, StatusDot } from './IssueMeta';

/**
 * Floating bar that appears once rows are selected. Bulk edits go through one
 * server call that re-checks permissions and records history per issue.
 */
export function BulkActionBar({
  count,
  statuses = [],
  members = [],
  onApply,
  onClear,
  pending,
  primary,
}: {
  count: number;
  /** Statuses of the one project the rows belong to; across projects there are none to offer. */
  statuses?: StatusDto[];
  /** People to choose an assignee from; empty where the page assigns in its own way. */
  members?: UserSummaryDto[];
  onApply: (patch: Record<string, unknown>) => void;
  onClear: () => void;
  pending?: boolean;
  /** The page's own main action, ahead of the generic ones. */
  primary?: ReactNode;
}) {
  if (count === 0) return null;

  return (
    <div
      role="region"
      aria-label="Массовые действия"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4"
    >
      {/* Wraps on a phone: with a main action and four menus the bar is wider than the screen. */}
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 border-2 border-border-strong bg-surface px-3 py-2 shadow-xl animate-slide-up">
        <span className="fd-num px-1 text-xs font-bold">
          Выбрано: {count}
        </span>

        <span className="h-4 w-px bg-border-strong" />

        {primary}

        {statuses.length > 0 && (
          <Menu>
            <MenuTrigger>
              <Button size="xs" variant="ghost" disabled={pending}>
                Статус
              </Button>
            </MenuTrigger>
            <MenuContent side="top" width={200} label="Изменить статус">
              <MenuLabel>Статус</MenuLabel>
              {statuses.map((status) => (
                <MenuItem
                  key={status.id}
                  icon={<StatusDot status={status} />}
                  onSelect={() => onApply({ statusId: status.id })}
                >
                  {status.name}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        )}

        <Menu>
          <MenuTrigger>
            <Button size="xs" variant="ghost" disabled={pending}>
              Приоритет
            </Button>
          </MenuTrigger>
          <MenuContent side="top" width={180} label="Изменить приоритет">
            <MenuLabel>Приоритет</MenuLabel>
            {ISSUE_PRIORITIES.map((priority) => (
              <MenuItem
                key={priority}
                icon={<PriorityIcon priority={priority as IssuePriority} withTooltip={false} className="size-3.5" />}
                onSelect={() => onApply({ priority })}
              >
                {PRIORITY_META[priority as IssuePriority].label}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>

        {members.length > 0 && (
          <Menu>
            <MenuTrigger>
              <Button size="xs" variant="ghost" disabled={pending}>
                Исполнитель
              </Button>
            </MenuTrigger>
            <MenuContent side="top" width={230} label="Назначить исполнителя">
              <MenuLabel>Назначить</MenuLabel>
              <MenuItem icon={<Avatar user={null} size="sm" />} onSelect={() => onApply({ assigneeId: null })}>
                Без исполнителя
              </MenuItem>
              {members.map((member) => (
                <MenuItem
                  key={member.id}
                  icon={<Avatar user={member} size="sm" />}
                  onSelect={() => onApply({ assigneeId: member.id })}
                >
                  {member.name}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        )}

        <DueDateMenu pending={pending} onApply={onApply} />

        <span className="h-4 w-px bg-border-strong" />

        <button
          type="button"
          onClick={onClear}
          aria-label="Снять выделение"
          className="p-1 text-text-subtle hover:bg-surface-hover hover:text-text"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * One deadline for every selected task, or none.
 *
 * The date is applied by a button, not as it is typed: a date field reports a
 * change for every digit of the year, and each of those would have been a
 * separate change to every selected task.
 */
function DueDateMenu({ pending, onApply }: { pending?: boolean; onApply: (patch: Record<string, unknown>) => void }) {
  const [day, setDay] = useState('');

  return (
    <Menu onOpenChange={(open) => !open && setDay('')}>
      <MenuTrigger>
        <Button size="xs" variant="ghost" disabled={pending}>
          Срок
        </Button>
      </MenuTrigger>
      <MenuContent side="top" width={230} label="Изменить срок">
        <MenuLabel>Срок для выбранных</MenuLabel>
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <input
            type="date"
            value={day}
            onChange={(event) => setDay(event.target.value)}
            aria-label="Новый срок"
            className="h-7 min-w-0 flex-1 border-2 border-border-strong bg-surface-sunken px-1.5 text-xs outline-none focus:border-accent"
          />
          <Button
            size="xs"
            variant="primary"
            disabled={!day || pending}
            // A whole day: stored at noon UTC, like every date without a time.
            onClick={() => onApply({ dueDate: `${day}T12:00:00.000Z`, dueHasTime: false })}
          >
            Задать
          </Button>
        </div>
        <MenuSeparator />
        <MenuItem onSelect={() => onApply({ dueDate: null })}>Снять срок</MenuItem>
      </MenuContent>
    </Menu>
  );
}
