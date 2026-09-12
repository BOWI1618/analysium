import { useCallback, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Permission } from '@flowdesk/contracts';
import { Columns3, Plus } from 'lucide-react';
import { useSession } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import { useProject } from '~/features/projects/hooks';
import { useSprints } from '~/features/sprints/hooks';
import { useBulkUpdate, useIssueList, usePatchIssue, flattenPages } from '~/features/issues/hooks';
import { useFilterState } from '~/features/issues/useFilterState';
import { useSavedViews, useCreateSavedView } from '~/features/views/hooks';
import { FilterBar } from '~/components/FilterBar';
import { IssueRow, IssueRowHeader, ALL_COLUMNS, DEFAULT_COLUMNS, type ListColumn } from '~/components/IssueRow';
import { BulkActionBar } from '~/components/BulkActionBar';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from '~/ui/Menu';
import { Button } from '~/ui/Button';
import { EmptyState, ErrorState, SkeletonRows } from '~/ui/Feedback';
import { useLocalStorage } from '~/lib/hooks/useLocalStorage';

/**
 * Table view with configurable columns, inline editing and bulk actions.
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: issues.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 37,
    overscan: 12,
  });

  const canEdit = project?.permissions.includes(Permission.ISSUE_UPDATE) ?? false;

  const toggleSelect = useCallback(
    (issueId: string, event: React.MouseEvent) => {
      // Shift-click selects the range since the previous click, like a file manager.
      if (event.shiftKey && lastClickedRef.current) {
        const from = issues.findIndex((i) => i.id === lastClickedRef.current);
        const to = issues.findIndex((i) => i.id === issueId);
        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from];
          const range = issues.slice(start, end + 1).map((i) => i.id);
          setSelected((prev) => [...new Set([...prev, ...range])]);
          return;
        }
      }
      lastClickedRef.current = issueId;
      setSelected((prev) => (prev.includes(issueId) ? prev.filter((id) => id !== issueId) : [...prev, issueId]));
    },
    [issues],
  );

  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilterBar
        filters={filters}
        onChange={setFilters}
        statuses={project?.statuses}
        labels={project?.labels}
        members={project?.members.map((m) => m.user)}
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
          <Menu>
            <MenuTrigger>
              <Button size="xs" variant="ghost" iconLeft={<Columns3 className="size-3" />}>
                Колонки
              </Button>
            </MenuTrigger>
            <MenuContent align="end" width={190} label="Видимые колонки">
              <MenuLabel>Показывать колонки</MenuLabel>
              {ALL_COLUMNS.map((column) => (
                <MenuItem
                  key={column.key}
                  keepOpen
                  selected={columns.includes(column.key)}
                  onSelect={() =>
                    setColumns((prev) =>
                      prev.includes(column.key)
                        ? prev.filter((c) => c !== column.key)
                        : [...prev, column.key],
                    )
                  }
                >
                  {column.label}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        }
      />

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-surface scrollbar-thin">
        <IssueRowHeader columns={columns} />

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
              const issue = issues[virtualRow.index];
              if (!issue) return null;
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
                    members={project?.members.map((m) => m.user) ?? []}
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

      <BulkActionBar
        count={selected.length}
        statuses={project?.statuses ?? []}
        members={project?.members.map((m) => m.user) ?? []}
        onClear={() => setSelected([])}
        onApply={(patch) =>
          bulkUpdate.mutate({ issueIds: selected, patch }, { onSuccess: () => setSelected([]) })
        }
        pending={bulkUpdate.isPending}
      />
    </div>
  );
}


