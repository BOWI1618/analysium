import { useCallback, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ISSUE_PRIORITIES, Permission, type IssuePriority, type IssueSummaryDto, type StatusDto } from '@flowdesk/contracts';
import clsx from 'clsx';
import { ChevronRight, Layers, Plus } from 'lucide-react';
import { useSession } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import { useProject } from '~/features/projects/hooks';
import { useSprints } from '~/features/sprints/hooks';
import { useBulkUpdate, useCreateIssue, useIssueList, usePatchIssue, flattenPages } from '~/features/issues/hooks';
import { useFilterState } from '~/features/issues/useFilterState';
import { useSavedViews, useCreateSavedView } from '~/features/views/hooks';
import { FilterBar } from '~/components/FilterBar';
import {
  ColumnWidthsContext,
  ColumnsMenu,
  IssueRow,
  IssueRowHeader,
  DEFAULT_COLUMNS,
  listMinWidth,
  useColumnWidths,
  type ListColumn,
} from '~/components/IssueRow';
import { BulkActionBar } from '~/components/BulkActionBar';
import { Button } from '~/ui/Button';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from '~/ui/Menu';
import { PRIORITY_META } from '~/components/IssueMeta';
import { EmptyState, ErrorState, SkeletonRows } from '~/ui/Feedback';
import { useLocalStorage } from '~/lib/hooks/useLocalStorage';

type ListGroupBy = 'none' | 'status' | 'assignee' | 'priority';

const GROUP_LABELS: Record<ListGroupBy, string> = {
  none: 'Без групп',
  status: 'Статус',
  assignee: 'Исполнитель',
  priority: 'Приоритет',
};

interface ListGroup {
  key: string;
  label: string;
  accent?: string;
  issues: IssueSummaryDto[];
}

/** A virtual row: a group's heading or a task. */
type ListItem = { kind: 'group'; group: ListGroup } | { kind: 'issue'; issue: IssueSummaryDto };

/**
 * Table view with configurable columns, inline editing and bulk actions. As in
 * Weeek, a task is added by typing its title in the row on top, and the list
 * can be grouped by status, assignee or priority.
 * Rows are virtualised, so a 5 000-issue project scrolls at the same speed as
 * a 20-issue one.
 */
export function ListPage() {
  const { projectId = '' } = useParams();
  const { user, workspace } = useSession();
  const openIssue = useUiStore((s) => s.openIssue);
  const openCreateIssue = useUiStore((s) => s.openCreateIssue);

  const [filters, setFilters] = useFilterState({ sort: 'updated', order: 'desc' });
  const [columns, setColumns] = useLocalStorage<ListColumn[]>('flowdesk.list-columns', DEFAULT_COLUMNS);
  const [widths, resizeColumn] = useColumnWidths('flowdesk.list-widths');
  const [groupBy, setGroupBy] = useLocalStorage<ListGroupBy>('flowdesk.list-group', 'none');
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string[]>([]);
  const lastClickedRef = useRef<string | null>(null);

  const { data: project } = useProject(projectId);
  const { data: sprints } = useSprints(project?.projectType === 'SCRUM' ? projectId : undefined);
  const { data: savedViews } = useSavedViews(workspace?.id, projectId);
  const createSavedView = useCreateSavedView(workspace?.id ?? '');
  const bulkUpdate = useBulkUpdate(workspace?.id ?? '');
  const patchIssue = usePatchIssue();

  const query = useIssueList({ projectId }, filters);
  const issues = useMemo(() => flattenPages(query.data), [query.data]);

  const { data: epicPages } = useIssueList({ projectId }, { type: ['EPIC'], includeDone: true });
  const epics = useMemo(
    () => (epicPages?.pages.flatMap((p) => p.items) ?? []).map((e) => ({ id: e.id, title: e.title })),
    [epicPages],
  );

  const rows = useMemo<ListItem[]>(() => {
    if (groupBy === 'none') return issues.map((issue) => ({ kind: 'issue', issue }));
    return groupIssues(issues, groupBy, project?.statuses ?? []).flatMap((group) => [
      { kind: 'group', group } as ListItem,
      ...(folded.has(group.key) ? [] : group.issues.map((issue) => ({ kind: 'issue', issue }) as ListItem)),
    ]);
  }, [issues, groupBy, folded, project?.statuses]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    // Sizes are remembered per row, not per position: grouping moves rows around.
    getItemKey: (index) => {
      const row = rows[index];
      return !row ? index : row.kind === 'group' ? `group-${row.group.key}` : row.issue.id;
    },
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 37,
    overscan: 12,
  });

  const canEdit = project?.permissions.includes(Permission.ISSUE_UPDATE) ?? false;
  const canCreate = project?.permissions.includes(Permission.ISSUE_CREATE) ?? false;

  // Shift-click ranges follow the rows as they stand on screen, groups included.
  const visibleIssues = useMemo(
    () => rows.flatMap((row) => (row.kind === 'issue' ? [row.issue] : [])),
    [rows],
  );

  const toggleSelect = useCallback(
    (issueId: string, event: { shiftKey: boolean }) => {
      // Shift-click selects the range since the previous click, like a file manager.
      if (event.shiftKey && lastClickedRef.current) {
        const from = visibleIssues.findIndex((i) => i.id === lastClickedRef.current);
        const to = visibleIssues.findIndex((i) => i.id === issueId);
        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from];
          const range = visibleIssues.slice(start, end + 1).map((i) => i.id);
          setSelected((prev) => [...new Set([...prev, ...range])]);
          return;
        }
      }
      lastClickedRef.current = issueId;
      setSelected((prev) => (prev.includes(issueId) ? prev.filter((id) => id !== issueId) : [...prev, issueId]));
    },
    [visibleIssues],
  );

  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilterBar
        filters={filters}
        onChange={setFilters}
        statuses={project?.statuses}
        labels={project?.labels}
        members={project?.assignees}
        sprints={sprints}
        epics={epics}
        currentUserId={user?.id ?? ''}
        savedViews={savedViews}
        onApplyView={(saved) => setFilters(saved as typeof filters)}
        onSaveView={() => {
          const name = window.prompt('Название вида');
          if (!name?.trim()) return;
          createSavedView.mutate({
            name: name.trim(),
            projectId,
            layout: 'LIST',
            filters: filters as Record<string, unknown>,
            isShared: true,
          });
        }}
        trailing={
          <>
            <Menu>
              <MenuTrigger>
                <Button size="xs" variant="ghost" iconLeft={<Layers className="size-3" />}>
                  {groupBy === 'none' ? 'Группировка' : `Группы: ${GROUP_LABELS[groupBy].toLowerCase()}`}
                </Button>
              </MenuTrigger>
              <MenuContent align="end" width={200} label="Группировать задачи">
                <MenuLabel>Группировать по</MenuLabel>
                {(Object.keys(GROUP_LABELS) as ListGroupBy[]).map((value) => (
                  <MenuItem
                    key={value}
                    selected={groupBy === value}
                    onSelect={() => {
                      setGroupBy(value);
                      setFolded(new Set());
                    }}
                  >
                    {GROUP_LABELS[value]}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
            <ColumnsMenu columns={columns} onChange={setColumns} />
          </>
        }
      />

      <ColumnWidthsContext.Provider value={widths}>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-surface scrollbar-thin">
        <div
          className="sm:min-w-[var(--list-min)]"
          style={{ '--list-min': `${listMinWidth(columns, true, widths)}px` } as React.CSSProperties}
        >
        <IssueRowHeader columns={columns} onResize={resizeColumn} />
        {canCreate && <QuickAddRow projectId={projectId} />}

        {query.isLoading ? (
          <SkeletonRows rows={12} />
        ) : issues.length === 0 ? (
          <EmptyState
            title="Под фильтры ничего не подходит"
description="Ослабьте фильтры или создайте первую задачу в проекте."
            action={
              <Button
                size="sm"
                variant="primary"
                iconLeft={<Plus className="size-3.5" />}
                onClick={() => openCreateIssue({ projectId })}
              >
                Создать задачу
              </Button>
            }
          />
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              if (row.kind === 'group') {
                const { group } = row;
                const isFolded = folded.has(group.key);
                return (
                  <div
                    key={`group-${group.key}`}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <button
                      type="button"
                      aria-expanded={!isFolded}
                      onClick={() =>
                        setFolded((current) => {
                          const next = new Set(current);
                          if (next.has(group.key)) next.delete(group.key);
                          else next.add(group.key);
                          return next;
                        })
                      }
                      className="flex w-full items-center gap-2 border-b-2 border-border-strong bg-surface-sunken px-3 py-1.5 text-left hover:bg-surface-active"
                    >
                      <ChevronRight className={clsx('size-3.5 text-text-subtle transition-transform', !isFolded && 'rotate-90')} />
                      {group.accent && (
                        <span className="size-2.5 border border-border-strong" style={{ backgroundColor: group.accent }} aria-hidden="true" />
                      )}
                      <h2 className="fd-eyebrow">{group.label}</h2>
                      <span className="fd-num text-2xs text-text-subtle">{group.issues.length}</span>
                    </button>
                  </div>
                );
              }
              const { issue } = row;
              return (
                <div
                  key={issue.id}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <IssueRow
                    issue={issue}
                    columns={columns}
                    selected={selected.includes(issue.id)}
                    editable={canEdit}
                    statuses={project?.statuses ?? []}
                    members={project?.assignees ?? []}
                    onToggleSelect={(event) => toggleSelect(issue.id, event)}
                    onOpen={() => openIssue(issue.id)}
                    onPatch={(patch) => patchIssue.mutate({ issueId: issue.id, patch })}
                  />
                </div>
              );
            })}
          </div>
        )}

        {query.hasNextPage && (
          <div className="flex justify-center p-3">
            <Button
              size="sm"
              variant="secondary"
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              Показать ещё
            </Button>
          </div>
        )}
        </div>
      </div>
      </ColumnWidthsContext.Provider>

      <BulkActionBar
        count={selected.length}
        statuses={project?.statuses ?? []}
        members={project?.assignees ?? []}
        onClear={() => setSelected([])}
        onApply={(patch) =>
          bulkUpdate.mutate({ issueIds: selected, patch }, { onSuccess: () => setSelected([]) })
        }
        pending={bulkUpdate.isPending}
      />
    </div>
  );
}



/** The loaded tasks sorted into groups, in the order the groups mean something. */
function groupIssues(issues: IssueSummaryDto[], groupBy: Exclude<ListGroupBy, 'none'>, statuses: StatusDto[]): ListGroup[] {
  const map = new Map<string, ListGroup>();
  for (const issue of issues) {
    const [key, label, accent] =
      groupBy === 'status'
        ? [issue.statusId, issue.status.name, issue.status.color]
        : groupBy === 'assignee'
          ? [issue.assignee?.id ?? 'none', issue.assignee?.name ?? 'Без исполнителя', undefined]
          : [issue.priority, PRIORITY_META[issue.priority as IssuePriority].label, undefined];
    const group = map.get(key) ?? { key, label, accent, issues: [] };
    group.issues.push(issue);
    map.set(key, group);
  }

  const rank = (group: ListGroup) => {
    if (groupBy === 'status') return statuses.findIndex((s) => s.id === group.key);
    if (groupBy === 'priority') return ISSUE_PRIORITIES.indexOf(group.key as IssuePriority);
    return group.key === 'none' ? Number.MAX_SAFE_INTEGER : 0;
  };
  return [...map.values()].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, 'ru'));
}

/** «Новая задача» on top of the list: type a title, press Enter, type the next one. */
function QuickAddRow({ projectId }: { projectId: string }) {
  const [title, setTitle] = useState('');
  const createIssue = useCreateIssue();

  return (
    <form
      className="flex items-center gap-2 border-b-2 border-border-strong bg-surface py-1 pr-3 pl-3"
      onSubmit={(event) => {
        event.preventDefault();
        const value = title.trim();
        if (!value) return;
        setTitle('');
        createIssue.mutate(
          { projectId, title: value, type: 'TASK', priority: 'MEDIUM' },
          { onError: () => setTitle((current) => current || value) },
        );
      }}
    >
      <span className="size-3.5 shrink-0" />
      <Plus className="size-4 shrink-0 text-text-subtle" />
      <input
        value={title}
        maxLength={300}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setTitle('');
            event.currentTarget.blur();
          }
        }}
        placeholder="Новая задача — введите название и нажмите Enter"
        aria-label="Новая задача"
        className="h-7 min-w-0 flex-1 border-2 border-transparent bg-transparent px-1.5 text-sm outline-none placeholder:text-text-subtle hover:border-border-strong focus:border-accent"
      />
    </form>
  );
}
