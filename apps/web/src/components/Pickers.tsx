import { useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isSameYear,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  ISSUE_PRIORITIES,
  ISSUE_TYPES,
  type IssuePriority,
  type IssueType,
  type LabelDto,
  type StatusDto,
  type UserSummaryDto,
} from '@flowdesk/contracts';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-react';
import { Popover } from '~/ui/Popover';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '~/ui/Menu';
import { Avatar } from '~/ui/Avatar';
import { IssueTypeIcon, PriorityIcon, PRIORITY_META, StatusDot, ISSUE_TYPE_META } from './IssueMeta';

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

  const name = term.trim();
  const exactMatch = labels.some((l) => l.name.toLowerCase() === name.toLowerCase());
  const canCreate = Boolean(onCreate && name && !exactMatch);
  const create = () => {
    if (!canCreate) return;
    onCreate!(name);
    setTerm('');
  };

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
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canCreate) {
                  event.preventDefault();
                  create();
                }
              }}
              placeholder={onCreate ? 'Найти или создать…' : 'Поиск меток…'}
              maxLength={30}
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
          {canCreate && (
            <>
              {filtered.length > 0 && <MenuSeparator />}
              <MenuItem keepOpen icon={<Plus className="size-3.5" />} onSelect={create}>
                Создать метку «{name}»
              </MenuItem>
            </>
          )}
          {filtered.length === 0 && !canCreate && (
            <p className="px-2 py-3 text-center text-xs text-text-subtle">
              {onCreate && !name ? 'Меток пока нет — введите название' : 'Меток нет'}
            </p>
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

/**
 * A date with an optional time of day, picked in one window: the month to
 * click a day in and the time under it. Without a time the value is the whole
 * day, stored at noon UTC so it reads as the same date in any Russian zone;
 * with one it is the exact local moment.
 */
export function DateField({
  value,
  hasTime = false,
  onChange,
  disabled,
  label = 'Срок',
  className,
}: {
  value: string | null;
  hasTime?: boolean;
  onChange: (value: string | null, hasTime: boolean) => void;
  disabled?: boolean;
  /** Names the field for screen readers: «Срок», «Начало». */
  label?: string;
  className?: string;
}) {
  const date = value ? new Date(value) : null;
  const dateValue = date ? format(date, 'yyyy-MM-dd') : '';
  const timeValue = date && hasTime ? format(date, 'HH:mm') : '';

  const emit = (day: string, time: string) => {
    if (!day) return onChange(null, false);
    if (time) return onChange(new Date(`${day}T${time}:00`).toISOString(), true);
    onChange(new Date(`${day}T12:00:00.000Z`).toISOString(), false);
  };

  const shown = date
    ? format(date, isSameYear(date, new Date()) ? 'd MMM' : 'd MMM yyyy', { locale: ru }) + (timeValue ? `, ${timeValue}` : '')
    : '';

  return (
    <div className={clsx('flex min-w-0 items-center gap-1', className)}>
      <Popover
        width={288}
        label={`${label}: дата и время`}
        triggerClassName="min-w-0 flex-1"
        trigger={({ toggle, open }) => (
          <button
            type="button"
            disabled={disabled}
            onClick={toggle}
            aria-label={label}
            aria-expanded={open}
            className={clsx(
              'flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md border-2 border-border-strong bg-surface px-1.5 text-left text-sm',
              'hover:bg-surface-hover hover:shadow-xs focus:border-accent focus:outline-none',
              'disabled:cursor-not-allowed disabled:opacity-60',
              open && 'border-accent',
            )}
          >
            <CalendarDays className="size-3.5 shrink-0 text-text-subtle" />
            <span className={clsx('fd-num min-w-0 flex-1 truncate', !shown && 'text-text-subtle')}>
              {shown || 'Не задан'}
            </span>
          </button>
        )}
      >
        {({ close }) => (
          <DateTimePanel
            label={label}
            dateValue={dateValue}
            timeValue={timeValue}
            onChange={emit}
            onClose={close}
          />
        )}
      </Popover>
      {value && !disabled && (
        <button
          type="button"
          onClick={() => onChange(null, false)}
          aria-label={`Убрать: ${label.toLowerCase()}`}
          className="shrink-0 rounded-sm p-0.5 text-text-subtle hover:bg-surface-hover hover:text-text"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const TIME_PRESETS = ['09:00', '12:00', '15:00', '18:00'];

/** The month and the time, side by side in one panel. */
function DateTimePanel({
  label,
  dateValue,
  timeValue,
  onChange,
  onClose,
}: {
  label: string;
  dateValue: string;
  timeValue: string;
  onChange: (day: string, time: string) => void;
  onClose: () => void;
}) {
  const [month, setMonth] = useState(() => startOfMonth(dateValue ? new Date(`${dateValue}T00:00:00`) : new Date()));
  const days = eachDayOfInterval({
    start: startOfWeek(month, { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  });
  const ymd = (day: Date) => format(day, 'yyyy-MM-dd');
  const todayYmd = ymd(new Date());

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonth(addMonths(month, -1))}
          aria-label="Предыдущий месяц"
          className="rounded-sm p-1 text-text-subtle hover:bg-surface-hover hover:text-text"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-sm font-bold first-letter:uppercase">{format(month, 'LLLL yyyy', { locale: ru })}</span>
        <button
          type="button"
          onClick={() => setMonth(addMonths(month, 1))}
          aria-label="Следующий месяц"
          className="rounded-sm p-1 text-text-subtle hover:bg-surface-hover hover:text-text"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center" role="grid" aria-label={`${label}: день`}>
        {WEEKDAYS.map((weekday, index) => (
          <span key={weekday} className={clsx('text-2xs font-bold text-text-subtle', index > 4 && 'text-danger/70')}>
            {weekday}
          </span>
        ))}
        {days.map((day) => {
          const key = ymd(day);
          const selected = key === dateValue;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key, timeValue)}
              aria-label={format(day, 'd MMMM yyyy', { locale: ru })}
              aria-pressed={selected}
              className={clsx(
                'fd-num h-8 text-xs',
                selected
                  ? 'border-2 border-border-strong bg-accent font-bold text-accent-fg'
                  : key === todayYmd
                    ? 'border-2 border-accent font-bold hover:bg-accent-subtle'
                    : 'hover:bg-surface-hover',
                !selected && !isSameMonth(day, month) && 'text-text-subtle/60',
              )}
            >
              {format(day, 'd')}
            </button>
          );
        })}
      </div>

      <div className="flex gap-1">
        {[
          ['Сегодня', 0],
          ['Завтра', 1],
          ['Через неделю', 7],
        ].map(([title, offset]) => (
          <button
            key={title}
            type="button"
            onClick={() => {
              const day = addDays(new Date(), offset as number);
              setMonth(startOfMonth(day));
              onChange(ymd(day), timeValue);
            }}
            className="flex-1 border-2 border-border-strong px-1 py-0.5 text-2xs font-bold whitespace-nowrap hover:bg-surface-hover"
          >
            {title}
          </button>
        ))}
      </div>

      <div className="border-t-2 border-border-strong pt-2">
        <div className="flex items-center gap-1.5">
          <span className="text-2xs font-bold tracking-wide text-text-subtle uppercase">Время</span>
          <input
            type="time"
            value={timeValue}
            disabled={!dateValue}
            onChange={(event) => onChange(dateValue, event.target.value)}
            aria-label={`${label}: время`}
            className="fd-num h-7 flex-1 rounded-md border-2 border-border-strong bg-surface px-1.5 text-sm focus:border-accent focus:outline-none disabled:opacity-50"
          />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {TIME_PRESETS.map((time) => (
            <button
              key={time}
              type="button"
              disabled={!dateValue}
              onClick={() => onChange(dateValue, time)}
              aria-pressed={timeValue === time}
              className={clsx(
                'fd-num border-2 border-border-strong px-1.5 py-0.5 text-2xs disabled:opacity-40',
                timeValue === time ? 'bg-ink text-text-inverted' : 'hover:bg-surface-hover',
              )}
            >
              {time}
            </button>
          ))}
          <button
            type="button"
            disabled={!dateValue}
            onClick={() => onChange(dateValue, '')}
            aria-pressed={Boolean(dateValue) && !timeValue}
            className={clsx(
              'border-2 border-border-strong px-1.5 py-0.5 text-2xs disabled:opacity-40',
              dateValue && !timeValue ? 'bg-ink text-text-inverted' : 'hover:bg-surface-hover',
            )}
          >
            Весь день
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between border-t-2 border-border-strong pt-2">
        <button
          type="button"
          disabled={!dateValue}
          onClick={() => {
            onChange('', '');
            onClose();
          }}
          className="text-xs text-danger hover:underline disabled:opacity-40"
        >
          Убрать
        </button>
        <button
          type="button"
          onClick={onClose}
          className="border-2 border-border-strong bg-accent px-2.5 py-0.5 text-xs font-bold text-accent-fg hover:bg-accent-active"
        >
          Готово
        </button>
      </div>
    </div>
  );
}

