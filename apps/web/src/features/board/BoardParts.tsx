import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { StatusDto } from '@flowdesk/contracts';
import { ArrowLeft, ArrowRight, Gauge, MoreHorizontal, Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import { useCreateIssue } from '~/features/issues/hooks';
import { useCreateStatus, useDeleteStatus, useReorderStatuses, useUpdateStatus } from '~/features/projects/hooks';
import { ALL_CARD_FIELDS, type IssueCardFields } from '~/components/IssueCard';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '~/ui/Menu';
import { Button, IconButton } from '~/ui/Button';
import { ConfirmDialog, Dialog, DialogCloseButton } from '~/ui/Dialog';
import { Input } from '~/ui/Input';

/** Colours offered for a column, in the brand's family. */
export const COLUMN_COLORS = [
  '#9fb0c6',
  '#7c88a1',
  '#0083ca',
  '#005dac',
  '#283a97',
  '#5b4bb7',
  '#0e7490',
  '#22c55e',
  '#0f7a44',
  '#d97706',
  '#b45309',
  '#c22e1f',
];

/* ------------------------------------------------------------ quick add */

/**
 * «Добавить задачу» at the top of a column: type a title and press Enter. The
 * field stays open for the next one until Escape or «Отмена» — closing it on
 * blur shifted the cards under a click aimed at one of them.
 */
export function QuickAddIssue({
  projectId,
  statusId,
  statusName,
  className,
}: {
  projectId: string;
  statusId: string;
  statusName: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const createIssue = useCreateIssue();

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const submit = () => {
    const value = title.trim();
    if (!value) return;
    // Cleared at once, so the next title can be typed while this one saves;
    // given back if saving fails.
    setTitle('');
    inputRef.current?.focus();
    createIssue.mutate(
      { projectId, statusId, title: value, type: 'TASK', priority: 'MEDIUM' },
      { onError: () => setTitle((current) => current || value) },
    );
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={clsx(
          'flex w-full items-center gap-1.5 px-1 py-1.5 text-left text-xs text-text-subtle hover:bg-surface-active hover:text-text',
          className,
        )}
      >
        <Plus className="size-3.5" />
        Добавить задачу
      </button>
    );
  }

  return (
    <div className={clsx('border-2 border-accent bg-surface p-2 shadow-sm', className)}>
      <textarea
        ref={inputRef}
        value={title}
        rows={2}
        maxLength={300}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setTitle('');
            setOpen(false);
          }
        }}
        placeholder="Название задачи"
        aria-label={`Название новой задачи в «${statusName}»`}
        className="block w-full resize-none bg-transparent text-sm outline-none placeholder:text-text-subtle"
      />
      <div className="mt-1.5 flex items-center gap-1.5">
        <Button size="xs" variant="primary" disabled={!title.trim()} onClick={submit}>
          Добавить
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            setTitle('');
            setOpen(false);
          }}
        >
          Отмена
        </Button>
        <span className="ml-auto text-2xs text-text-subtle">Enter · Esc</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- column menu */

/**
 * A column is set up where it stands: renamed, coloured, limited, moved or
 * removed from its own menu, without a trip to the project settings.
 */
export function ColumnMenu({
  projectId,
  status,
  statuses,
  onRename,
  onActiveHeader,
}: {
  projectId: string;
  status: StatusDto;
  statuses: StatusDto[];
  onRename: () => void;
  /** The column printed in the accent needs a light trigger. */
  onActiveHeader: boolean;
}) {
  const updateStatus = useUpdateStatus(projectId);
  const deleteStatus = useDeleteStatus(projectId);
  const reorder = useReorderStatuses(projectId);
  const [limitOpen, setLimitOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const index = statuses.findIndex((s) => s.id === status.id);
  const move = (direction: -1 | 1) => {
    const ids = statuses.map((s) => s.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    ids.splice(index, 1);
    ids.splice(target, 0, status.id);
    reorder.mutate(ids);
  };

  return (
    <>
      <Menu>
        <MenuTrigger>
          <button
            type="button"
            aria-label={`Действия с колонкой «${status.name}»`}
            className={clsx(
              'p-0.5',
              onActiveHeader
                ? 'text-accent-fg hover:bg-accent-active'
                : 'text-text-subtle hover:bg-surface-active hover:text-text',
            )}
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </MenuTrigger>
        <MenuContent width={220} label={`Колонка «${status.name}»`}>
          <MenuItem icon={<Pencil className="size-3.5" />} onSelect={onRename}>
            Переименовать
          </MenuItem>
          <MenuItem icon={<Gauge className="size-3.5" />} onSelect={() => setLimitOpen(true)}>
            {status.wipLimit ? `Лимит задач: ${status.wipLimit}` : 'Лимит задач…'}
          </MenuItem>
          <MenuSeparator />
          <MenuLabel>Цвет</MenuLabel>
          <div className="grid grid-cols-6 gap-1 px-2 pb-1.5">
            {COLUMN_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Цвет ${color}`}
                aria-pressed={status.color.toLowerCase() === color}
                onClick={() => updateStatus.mutate({ statusId: status.id, patch: { color } })}
                className={clsx(
                  'size-6 border-2 border-border-strong',
                  status.color.toLowerCase() === color && 'ring-2 ring-accent ring-offset-1',
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <MenuSeparator />
          <MenuItem icon={<ArrowLeft className="size-3.5" />} disabled={index <= 0} onSelect={() => move(-1)}>
            Сдвинуть левее
          </MenuItem>
          <MenuItem
            icon={<ArrowRight className="size-3.5" />}
            disabled={index >= statuses.length - 1}
            onSelect={() => move(1)}
          >
            Сдвинуть правее
          </MenuItem>
          {statuses.length > 1 && (
            <>
              <MenuSeparator />
              <MenuItem icon={<Trash2 className="size-3.5" />} danger onSelect={() => setConfirmDelete(true)}>
                Удалить колонку
              </MenuItem>
            </>
          )}
        </MenuContent>
      </Menu>

      {limitOpen && (
        <WipLimitDialog
          status={status}
          onClose={() => setLimitOpen(false)}
          onSave={(wipLimit) => {
            updateStatus.mutate({ statusId: status.id, patch: { wipLimit } });
            setLimitOpen(false);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          deleteStatus.mutate({ statusId: status.id });
          setConfirmDelete(false);
        }}
        title={`Удалить колонку «${status.name}»?`}
        message="Задачи из неё перейдут в статус по умолчанию. Ни одна задача не будет удалена."
        confirmLabel="Удалить колонку"
        danger
      />
    </>
  );
}

function WipLimitDialog({
  status,
  onClose,
  onSave,
}: {
  status: StatusDto;
  onClose: () => void;
  onSave: (limit: number | null) => void;
}) {
  const [value, setValue] = useState(status.wipLimit ? String(status.wipLimit) : '');
  const limit = value.trim() === '' ? null : Number(value);
  const valid = limit === null || (Number.isInteger(limit) && limit >= 0 && limit <= 99);

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Лимит задач в «${status.name}»`}
      description="Сколько задач может одновременно стоять в колонке. Когда их больше, счётчик в шапке становится красным. Пусто — без ограничения."
      footer={
        <>
          <DialogCloseButton size="sm" variant="ghost">
            Отмена
          </DialogCloseButton>
          <Button size="sm" variant="primary" disabled={!valid} onClick={() => onSave(limit === 0 ? null : limit)}>
            Сохранить
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onSave(limit === 0 ? null : limit);
        }}
      >
        <Input
          label="Не больше задач"
          type="number"
          min={0}
          max={99}
          value={value}
          autoFocus
          placeholder="без ограничения"
          onChange={(event) => setValue(event.target.value)}
        />
      </form>
    </Dialog>
  );
}

/* ----------------------------------------------------------- add column */

/**
 * A new column at the end of the work in progress: before the columns that
 * close a task, so «Готово» stays last. What it means can be changed in the
 * project settings.
 */
export function AddColumn({ projectId, statuses }: { projectId: string; statuses: StatusDto[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const createStatus = useCreateStatus(projectId);
  const reorder = useReorderStatuses(projectId);

  const submit = () => {
    const value = name.trim();
    if (!value) return;
    createStatus.mutate(
      { name: value, category: 'STARTED' },
      {
        onSuccess: (created: StatusDto) => {
          setName('');
          setOpen(false);
          const ids = statuses.map((s) => s.id);
          const firstClosing = statuses.findIndex((s) => s.category === 'COMPLETED' || s.category === 'CANCELED');
          if (firstClosing >= 0) {
            ids.splice(firstClosing, 0, created.id);
            reorder.mutate(ids);
          }
        },
      },
    );
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 w-56 shrink-0 items-center gap-1.5 border-2 border-dashed border-border-strong px-3 text-xs font-bold text-text-subtle hover:bg-surface hover:text-text"
      >
        <Plus className="size-3.5" />
        Добавить колонку
      </button>
    );
  }

  return (
    <form
      className="flex w-64 shrink-0 flex-col gap-2 self-start border-2 border-border-strong bg-surface p-2 shadow-md"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Input
        label="Новая колонка"
        value={name}
        autoFocus
        maxLength={40}
        placeholder="например, На проверке"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      <div className="flex gap-1.5">
        <Button type="submit" size="xs" variant="primary" loading={createStatus.isPending} disabled={!name.trim()}>
          Добавить
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(false)}>
          Отмена
        </Button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------- board settings */

export interface BoardSettings {
  fields: IssueCardFields;
}

export const DEFAULT_BOARD_SETTINGS: BoardSettings = { fields: ALL_CARD_FIELDS };

const FIELD_LABELS: { key: keyof IssueCardFields; label: string }[] = [
  { key: 'dueDate', label: 'Срок' },
  { key: 'assignee', label: 'Исполнитель' },
  { key: 'priority', label: 'Приоритет' },
  { key: 'type', label: 'Тип' },
  { key: 'labels', label: 'Метки' },
  { key: 'epic', label: 'Эпик' },
  { key: 'counters', label: 'Подзадачи, комментарии, файлы' },
];

/** The board's gear: which fields a card shows. */
export function BoardSettingsMenu({
  settings,
  onChange,
}: {
  settings: BoardSettings;
  onChange: (settings: BoardSettings) => void;
}) {
  return (
    <Menu>
      <MenuTrigger>
        <IconButton label="Настройки доски" size="sm">
          <Settings2 className="size-4" />
        </IconButton>
      </MenuTrigger>
      <MenuContent align="end" width={290} label="Настройки доски">
        <MenuLabel>На карточке</MenuLabel>
        {FIELD_LABELS.map(({ key, label }) => (
          <MenuItem
            key={key}
            keepOpen
            selected={settings.fields[key]}
            onSelect={() => onChange({ ...settings, fields: { ...settings.fields, [key]: !settings.fields[key] } })}
          >
            {label}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
