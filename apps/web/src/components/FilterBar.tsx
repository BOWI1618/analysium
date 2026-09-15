import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  ISSUE_PRIORITIES,
  ISSUE_TYPES,
  type IssuePriority,
  type IssueType,
  type LabelDto,
  type SprintDto,
  type StatusDto,
  type UserSummaryDto,
} from '@flowdesk/contracts';
import { Filter, ListFilter, Search, SlidersHorizontal, X, Bookmark } from 'lucide-react';
import type { IssueFilters } from '~/features/issues/types';
import { activeFilterCount } from '~/features/issues/types';
import { MultiSelect } from './Pickers';
import { IssueTypeIcon, PriorityIcon, PRIORITY_META, StatusDot, ISSUE_TYPE_META } from './IssueMeta';
import { Avatar } from '~/ui/Avatar';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '~/ui/Menu';
import { Button } from '~/ui/Button';
import { Badge } from '~/ui/Badge';

export interface FilterBarProps {
  filters: IssueFilters;
  onChange: (filters: IssueFilters) => void;
  statuses?: StatusDto[];
  labels?: LabelDto[];
  members?: UserSummaryDto[];
  sprints?: SprintDto[];
  epics?: { id: string; title: string }[];
  currentUserId: string;
  /** Extra controls rendered on the right (view switcher, grouping). */
  trailing?: React.ReactNode;
  onSaveView?: () => void;
  savedViews?: { id: string; name: string; filters: Record<string, unknown> }[];
  onApplyView?: (filters: Record<string, unknown>) => void;
  sortOptions?: boolean;
  /** «Скрыть завершённые» in «Ещё»; left out where the state is picked in «Состояние». */
  hideDoneOption?: boolean;
  /** «Состояние»: open, in progress, finished — for lists across projects, which share no statuses. */
  stateFacet?: boolean;
}

/** The state a task is in, whatever its project calls the status. */
const STATE_OPTIONS = [
  { value: 'BACKLOG', label: 'В бэклоге' },
  { value: 'UNSTARTED', label: 'Не начаты' },
  { value: 'STARTED', label: 'В работе' },
  { value: 'COMPLETED', label: 'Завершены' },
  { value: 'CANCELED', label: 'Отменены' },
];

const SORT_LABELS: Record<string, string> = {
  rank: 'Вручную',
  created: 'По дате создания',
  updated: 'По дате обновления',
  priority: 'По приоритету',
  dueDate: 'По сроку',
  title: 'По заголовку',
  status: 'По статусу',
};

/**
 * The one filtering surface used by board, list, backlog and calendar. Filter
 * state is owned by the page (and mirrored into the URL), so a filtered view is
 * always shareable by copying the address bar.
 */
export function FilterBar({
  filters,
  onChange,
  statuses = [],
  labels = [],
  members = [],
  sprints = [],
  epics = [],
  currentUserId,
  trailing,
  onSaveView,
  savedViews = [],
  onApplyView,
  sortOptions = true,
  hideDoneOption = true,
  stateFacet = false,
}: FilterBarProps) {
  const [searchTerm, setSearchTerm] = useState(filters.search ?? '');
  const [facetsOpen, setFacetsOpen] = useState(false);

  // The URL (or an applied saved view) can change filters.search from outside.
  useEffect(() => setSearchTerm(filters.search ?? ''), [filters.search]);
  const count = activeFilterCount(filters);

  const patch = (next: Partial<IssueFilters>) => onChange({ ...filters, ...next });

  const memberOptions = useMemo(
    () => [
      { value: '@me', label: 'Я', icon: <Avatar user={members.find((m) => m.id === currentUserId)} size="sm" /> },
      { value: 'none', label: 'Без исполнителя', icon: <Avatar user={null} size="sm" /> },
      // «Я» above already stands for the current user.
      ...members
        .filter((m) => m.id !== currentUserId)
        .map((m) => ({ value: m.id, label: m.name, icon: <Avatar user={m} size="sm" /> })),
    ],
    [members, currentUserId],
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b-2 border-border-strong bg-surface px-3 py-2">
      {/* Search */}
      <div className="relative min-w-40 flex-1 sm:max-w-64">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-text-subtle" />
        <input
          value={searchTerm}
          onChange={(event) => {
            setSearchTerm(event.target.value);
            patch({ search: event.target.value || undefined });
          }}
          placeholder="Фильтр по заголовку или ключу…"
          aria-label="Фильтровать задачи"
          className="h-7 w-full border-2 border-border-strong bg-surface-sunken pr-6 pl-7 text-xs outline-none hover:bg-surface hover:shadow-xs focus:border-accent focus:shadow-sm focus:-translate-x-px focus:-translate-y-px"
        />
        {searchTerm && (
          <button
            type="button"
            onClick={() => {
              setSearchTerm('');
              patch({ search: undefined });
            }}
            aria-label="Очистить фильтр"
            className="absolute top-1/2 right-1.5 -translate-y-1/2 p-0.5 text-text-subtle hover:text-text"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      {/* On a phone the facet row costs three lines of vertical space, so it
          collapses behind one button; the active-filter count stays visible
          on the button itself. */}
      <button
        type="button"
        onClick={() => setFacetsOpen((open) => !open)}
        aria-expanded={facetsOpen}
        className={clsx(
          'inline-flex h-7 items-center gap-1.5 border-2 px-2 text-xs font-bold sm:hidden',
          count
            ? 'border-accent-border bg-accent-subtle text-accent'
            : 'border-border-strong text-text-muted hover:bg-surface-hover hover:text-text hover:shadow-xs',
        )}
      >
        <ListFilter className="size-3" />
        Фильтры
        {count ? <span className="fd-num">{count}</span> : null}
      </button>

      <div className={clsx('flex-wrap items-center gap-1.5 sm:flex', facetsOpen ? 'flex w-full' : 'hidden')}>
        {/* Facets */}
        {statuses.length > 0 && (
          <MultiSelect
            title="Статус"
            options={statuses.map((s) => ({ value: s.id, label: s.name, icon: <StatusDot status={s} /> }))}
            value={filters.statusId ?? []}
            onChange={(statusId) => patch({ statusId: statusId.length ? statusId : undefined })}
          >
            <FacetButton label="Статус" count={filters.statusId?.length} />
          </MultiSelect>
        )}

        {stateFacet && (
          <MultiSelect
            title="Состояние"
            options={STATE_OPTIONS}
            value={filters.statusCategory ?? []}
            onChange={(statusCategory) => patch({ statusCategory: statusCategory.length ? statusCategory : undefined })}
          >
            <FacetButton label="Состояние" count={filters.statusCategory?.length} />
          </MultiSelect>
        )}

        <MultiSelect
          title="Исполнитель"
          options={memberOptions}
          value={filters.assigneeId ?? []}
          onChange={(assigneeId) => patch({ assigneeId: assigneeId.length ? assigneeId : undefined })}
        >
          <FacetButton label="Исполнитель" count={filters.assigneeId?.length} />
        </MultiSelect>

        <MultiSelect
          title="Приоритет"
          options={ISSUE_PRIORITIES.map((p) => ({
            value: p,
            label: PRIORITY_META[p as IssuePriority].label,
            icon: <PriorityIcon priority={p as IssuePriority} withTooltip={false} className="size-3.5" />,
          }))}
          value={filters.priority ?? []}
          onChange={(priority) => patch({ priority: priority.length ? priority : undefined })}
        >
          <FacetButton label="Приоритет" count={filters.priority?.length} />
        </MultiSelect>

        <MultiSelect
          title="Тип"
          options={ISSUE_TYPES.map((t) => ({
            value: t,
            label: ISSUE_TYPE_META[t as IssueType].label,
            icon: <IssueTypeIcon type={t as IssueType} withTooltip={false} className="size-3.5" />,
          }))}
          value={filters.type ?? []}
          onChange={(type) => patch({ type: type.length ? type : undefined })}
        >
          <FacetButton label="Тип" count={filters.type?.length} />
        </MultiSelect>

        {labels.length > 0 && (
          <MultiSelect
            title="Метки"
            options={labels.map((l) => ({
              value: l.id,
              label: l.name,
              icon: <span className="size-2.5 border border-border-strong" style={{ backgroundColor: l.color }} />,
            }))}
            value={filters.labelId ?? []}
            onChange={(labelId) => patch({ labelId: labelId.length ? labelId : undefined })}
          >
            <FacetButton label="Метки" count={filters.labelId?.length} />
          </MultiSelect>
        )}

        {sprints.length > 0 && (
          <MultiSelect
            title="Спринт"
            options={[
              { value: 'none', label: 'Без спринта' },
              ...sprints.map((s) => ({ value: s.id, label: s.name })),
            ]}
            value={filters.sprintId ?? []}
            onChange={(sprintId) => patch({ sprintId: sprintId.length ? sprintId : undefined })}
          >
            <FacetButton label="Спринт" count={filters.sprintId?.length} />
          </MultiSelect>
        )}

        {epics.length > 0 && (
          <MultiSelect
            title="Эпик"
            options={[{ value: 'none', label: 'Без эпика' }, ...epics.map((e) => ({ value: e.id, label: e.title }))]}
            value={filters.epicId ?? []}
            onChange={(epicId) => patch({ epicId: epicId.length ? epicId : undefined })}
          >
            <FacetButton label="Эпик" count={filters.epicId?.length} />
          </MultiSelect>
        )}

        {/* More */}
        <Menu>
          <MenuTrigger>
            <FacetButton label="Ещё" icon={<SlidersHorizontal className="size-3" />} />
          </MenuTrigger>
          <MenuContent width={220} label="Дополнительные фильтры">
            <MenuLabel>Уточнить</MenuLabel>
            <MenuItem
              keepOpen
              selected={filters.isOverdue === true}
              onSelect={() => patch({ isOverdue: filters.isOverdue ? undefined : true })}
            >
              Только просроченные
            </MenuItem>
            {hideDoneOption && (
              <MenuItem
                keepOpen
                selected={filters.includeDone === false}
                onSelect={() => patch({ includeDone: filters.includeDone === false ? undefined : false })}
              >
                Скрыть завершённые
              </MenuItem>
            )}
            <MenuItem
              keepOpen
              selected={filters.includeSubtasks === true}
              onSelect={() => patch({ includeSubtasks: filters.includeSubtasks ? undefined : true })}
            >
              Показывать подзадачи
            </MenuItem>
            {sortOptions && (
              <>
                <MenuSeparator />
                <MenuLabel>Сортировка</MenuLabel>
                {Object.entries(SORT_LABELS).map(([key, label]) => (
                  <MenuItem
                    key={key}
                    selected={(filters.sort ?? 'rank') === key}
                    onSelect={() => patch({ sort: key as IssueFilters['sort'] })}
                  >
                    {label}
                  </MenuItem>
                ))}
                <MenuSeparator />
                <MenuItem
                  selected={filters.order !== 'desc'}
                  onSelect={() => patch({ order: filters.order === 'desc' ? 'asc' : 'desc' })}
                >
                  {filters.order === 'desc' ? 'По убыванию' : 'По возрастанию'}
                </MenuItem>
              </>
            )}
          </MenuContent>
        </Menu>

        {savedViews.length > 0 && onApplyView && (
          <Menu>
            <MenuTrigger>
              <FacetButton label="Виды" icon={<Bookmark className="size-3" />} />
            </MenuTrigger>
            <MenuContent width={220} label="Сохранённые виды">
              <MenuLabel>Сохранённые виды</MenuLabel>
              {savedViews.map((view) => (
                <MenuItem key={view.id} onSelect={() => onApplyView(view.filters)}>
                  {view.name}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        )}

        {count > 0 && (
          <>
            <Badge tone="accent" className="gap-1">
              <Filter className="size-2.5" />
              {count}
            </Badge>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setSearchTerm('');
                onChange({ sort: filters.sort, order: filters.order });
              }}
            >
              Очистить
            </Button>
          </>
        )}

        {onSaveView && count > 0 && (
          <Button size="xs" variant="ghost" iconLeft={<Bookmark className="size-3" />} onClick={onSaveView}>
            Сохранить вид
          </Button>
        )}

      </div>

      {trailing && <div className="ml-auto flex items-center gap-1.5">{trailing}</div>}
    </div>
  );
}

function FacetButton({
  label,
  count,
  icon,
}: {
  label: string;
  count?: number;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={clsx(
        'inline-flex h-7 items-center gap-1.5 border-2 border-border-strong px-2 text-xs font-bold whitespace-nowrap transition-colors',
        // An applied filter is a solid plate: it has to be obvious at a glance
        // which of a dozen chips are actually narrowing the list.
        count
          ? 'bg-ink text-text-inverted shadow-xs'
          : 'text-text-muted hover:bg-surface-hover hover:text-text hover:shadow-xs',
      )}
    >
      {icon ?? <ListFilter className="size-3" />}
      {label}
      {count ? <span className="tabular-nums">{count}</span> : null}
    </button>
  );
}
