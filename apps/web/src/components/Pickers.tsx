import { useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  ISSUE_PRIORITIES,
  ISSUE_TYPES,
  type IssuePriority,
  type IssueType,
  type LabelDto,
  type StatusDto,
  type UserSummaryDto,
} from '@flowdesk/contracts';
import { Check, Search, X } from 'lucide-react';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '~/ui/Menu';
import { Avatar } from '~/ui/Avatar';
import { IssueTypeIcon, LabelChip, PriorityIcon, PRIORITY_META, StatusDot, ISSUE_TYPE_META } from './IssueMeta';

/**
 * Inline pickers used all over the product (issue detail sidebar, board card
 * context menus, bulk-action bar). Each is a plain controlled component so the
 * same picker works optimistically inline and inside a create form.
 */

export interface PickerProps<T> {
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  children: ReactNode;
  align?: 'start' | 'end';
}

/* ------------------------------------------------------------- status */

export function StatusPicker({
  statuses,
  value,
  onChange,
  disabled,
  children,
  align = 'start',
}: PickerProps<string> & { statuses: StatusDto[] }) {
  return (
    <Menu>
      <MenuTrigger>{children}</MenuTrigger>
      {!disabled && (
        <MenuContent align={align} label="Изменить статус" width={220}>
          <MenuLabel>Статус</MenuLabel>
          {statuses.map((status) => (
            <MenuItem
              key={status.id}
              icon={<StatusDot status={status} />}
              selected={status.id === value}
              onSelect={() => onChange(status.id)}
            >
              {status.name}
            </MenuItem>
          ))}
        </MenuContent>
      )}
    </Menu>
  );
}

/* ----------------------------------------------------------- priority */

export function PriorityPicker({
  value,
  onChange,
  disabled,
  children,
  align = 'start',
}: PickerProps<IssuePriority>) {
  return (
    <Menu>
      <MenuTrigger>{children}</MenuTrigger>
      {!disabled && (
        <MenuContent align={align} label="Изменить приоритет" width={180}>
          <MenuLabel>Приоритет</MenuLabel>
          {ISSUE_PRIORITIES.map((priority) => (
            <MenuItem
              key={priority}
              icon={<PriorityIcon priority={priority as IssuePriority} withTooltip={false} className="size-3.5" />}
              selected={priority === value}
              onSelect={() => onChange(priority as IssuePriority)}
            >
              {PRIORITY_META[priority as IssuePriority].label}
            </MenuItem>
          ))}
        </MenuContent>
      )}
    </Menu>
  );
}

/* --------------------------------------------------------------- type */

export function TypePicker({ value, onChange, disabled, children, align = 'start' }: PickerProps<IssueType>) {
  return (
    <Menu>
      <MenuTrigger>{children}</MenuTrigger>
      {!disabled && (
        <MenuContent align={align} label="Изменить тип задачи" width={180}>
          <MenuLabel>Тип</MenuLabel>
          {ISSUE_TYPES.filter((t) => t !== 'SUBTASK').map((type) => (
            <MenuItem
              key={type}
              icon={<IssueTypeIcon type={type as IssueType} withTooltip={false} className="size-3.5" />}
              selected={type === value}
              onSelect={() => onChange(type as IssueType)}
            >
              {ISSUE_TYPE_META[type as IssueType].label}
            </MenuItem>
          ))}
        </MenuContent>
      )}
    </Menu>
  );
}

/* ------------------------------------------------------------- people */

export interface UserPickerProps {
  users: UserSummaryDto[];
  value: string | null;
  onChange: (userId: string | null) => void;
  disabled?: boolean;
  children: ReactNode;
  align?: 'start' | 'end';
  allowUnassigned?: boolean;
  label?: string;
}

export function UserPicker({
  users,
  value,
  onChange,
  disabled,
  children,
  align = 'start',
  allowUnassigned = true,
  label = 'Исполнитель',
}: UserPickerProps) {
  const [term, setTerm] = useState('');

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [users, term]);

  return (
    <Menu onOpenChange={(open) => !open && setTerm('')}>
      <MenuTrigger>{children}</MenuTrigger>
      {!disabled && (
        <MenuContent align={align} label={`Изменить ${label.toLowerCase()}`} width={240}>
          <div className="mb-1 flex items-center gap-1.5 rounded-md border-2 border-border-strong bg-surface-sunken px-2 py-1">
            <Search className="size-3.5 shrink-0 text-text-subtle" />
            <input
              autoFocus
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder={`Поиск ${label.toLowerCase()}…`}
              className="w-full bg-transparent text-sm outline-none placeholder:text-text-subtle"
            />
          </div>
          {allowUnassigned && (
            <MenuItem
              icon={<Avatar user={null} size="sm" />}
              selected={value === null}
              onSelect={() => onChange(null)}
            >
              Без исполнителя
            </MenuItem>
          )}
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-text-subtle">Никого не найдено</p>
          ) : (
            filtered.map((user) => (
              <MenuItem
                key={user.id}
                icon={<Avatar user={user} size="sm" />}
                selected={user.id === value}
                onSelect={() => onChange(user.id)}
              >
                {user.name}
              </MenuItem>
            ))
          )}
        </MenuContent>
      )}
    </Menu>
  );
}

/* ------------------------------------------------------------- labels */

export function LabelPicker({
  labels,
  value,
  onChange,
  disabled,
  children,
  align = 'start',
  onCreate,
}: {
  labels: LabelDto[];
  value: string[];
  onChange: (labelIds: string[]) => void;
  disabled?: boolean;
  children: ReactNode;
  align?: 'start' | 'end';
  onCreate?: (name: string) => void;
}) {
  const [term, setTerm] = useState('');
  const selected = new Set(value);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    return q ? labels.filter((l) => l.name.toLowerCase().includes(q)) : labels;
  }, [labels, term]);

  const exactMatch = filtered.some((l) => l.name.toLowerCase() === term.trim().toLowerCase());

  return (
    <Menu onOpenChange={(open) => !open && setTerm('')}>
      <MenuTrigger>{children}</MenuTrigger>
      {!disabled && (
        <MenuContent align={align} label="Изменить метки" width={240}>
          <div className="mb-1 flex items-center gap-1.5 rounded-md border-2 border-border-strong bg-surface-sunken px-2 py-1">
            <Search className="size-3.5 shrink-0 text-text-subtle" />
            <input
              autoFocus
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Поиск меток…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-text-subtle"
            />
          </div>
          {filtered.map((label) => (
            <MenuItem
              key={label.id}
              keepOpen
              icon={<span className="size-2.5 border border-border-strong" style={{ backgroundColor: label.color }} />}
              selected={selected.has(label.id)}
              onSelect={() =>
                onChange(
                  selected.has(label.id) ? value.filter((id) => id !== label.id) : [...value, label.id],
                )
              }
            >
              {label.name}
            </MenuItem>
          ))}
          {onCreate && term.trim() && !exactMatch && (
            <>
              <MenuSeparator />
              <MenuItem onSelect={() => onCreate(term.trim())}>Создать «{term.trim()}»</MenuItem>
            </>
          )}
          {filtered.length === 0 && !onCreate && (
            <p className="px-2 py-3 text-center text-xs text-text-subtle">Меток нет</p>
          )}
        </MenuContent>
      )}
    </Menu>
  );
}

/* ---------------------------------------------------------- generic multi */

export interface MultiSelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

export function MultiSelect({
  options,
  value,
  onChange,
  children,
  title,
  align = 'start',
  searchable = true,
}: {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  children: ReactNode;
  title: string;
  align?: 'start' | 'end';
  searchable?: boolean;
}) {
  const [term, setTerm] = useState('');
  const selected = new Set(value);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, term]);

  return (
    <Menu onOpenChange={(open) => !open && setTerm('')}>
      <MenuTrigger>{children}</MenuTrigger>
      <MenuContent align={align} label={title} width={230}>
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-2xs font-bold tracking-wide text-text-subtle uppercase">{title}</span>
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="inline-flex items-center gap-0.5 text-2xs text-text-subtle hover:text-text"
            >
              <X className="size-2.5" />
              Очистить
            </button>
          )}
        </div>
        {searchable && options.length > 7 && (
          <div className="mb-1 flex items-center gap-1.5 rounded-md border-2 border-border-strong bg-surface-sunken px-2 py-1">
            <Search className="size-3.5 shrink-0 text-text-subtle" />
            <input
              autoFocus
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Поиск…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-text-subtle"
            />
          </div>
        )}
        {filtered.map((option) => (
          <MenuItem
            key={option.value}
            keepOpen
            icon={option.icon}
            selected={selected.has(option.value)}
            onSelect={() =>
              onChange(
                selected.has(option.value)
                  ? value.filter((v) => v !== option.value)
                  : [...value, option.value],
              )
            }
          >
            {option.label}
          </MenuItem>
        ))}
        {filtered.length === 0 && <p className="px-2 py-3 text-center text-xs text-text-subtle">Ничего не найдено</p>}
      </MenuContent>
    </Menu>
  );
}

/* ---------------------------------------------------------- date picker */

export function DateField({
  value,
  onChange,
  disabled,
  placeholder = 'Без срока',
  className,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const dateValue = value ? new Date(value).toISOString().slice(0, 10) : '';

  return (
    <div className={clsx('flex items-center gap-1', className)}>
      <input
        type="date"
        value={dateValue}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          // Store noon UTC so the date does not shift across time zones.
          onChange(next ? new Date(`${next}T12:00:00.000Z`).toISOString() : null);
        }}
        aria-label="Срок"
        className={clsx(
          'h-7 w-full rounded-md border-2 border-border-strong bg-surface px-1.5 text-sm',
          'hover:bg-surface-hover hover:shadow-xs focus:border-accent focus:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-60',
          !dateValue && 'text-text-subtle',
        )}
        placeholder={placeholder}
      />
      {value && !disabled && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Убрать срок"
          className="shrink-0 rounded-sm p-0.5 text-text-subtle hover:bg-surface-hover hover:text-text"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

export function CheckIcon() {
  return <Check className="size-3.5" />;
}
