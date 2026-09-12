import type { StatusDto, UserSummaryDto } from '@flowdesk/contracts';
import { ISSUE_PRIORITIES, type IssuePriority } from '@flowdesk/contracts';
import { X } from 'lucide-react';
import { Avatar } from '~/ui/Avatar';
import { Button } from '~/ui/Button';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from '~/ui/Menu';
import { PriorityIcon, PRIORITY_META, StatusDot } from './IssueMeta';

/**
 * Floating bar that appears once rows are selected. Bulk edits go through one
 * server call that re-checks permissions and records history per issue.
 */
export function BulkActionBar({
  count,
  statuses,
  members,
  onApply,
  onClear,
  pending,
}: {
  count: number;
  statuses: StatusDto[];
  members: UserSummaryDto[];
  onApply: (patch: Record<string, unknown>) => void;
  onClear: () => void;
  pending?: boolean;
}) {
  if (count === 0) return null;

  return (
    <div
      role="region"
      aria-label="Массовые действия"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4"
    >
      <div className="pointer-events-auto flex items-center gap-2 border-2 border-border-strong bg-surface px-3 py-2 shadow-xl animate-slide-up">
        <span className="fd-num px-1 text-xs font-bold">
          Выбрано: {count}
        </span>

        <span className="h-4 w-px bg-border-strong" />

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
