import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { useSession } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import { useMembers } from '~/features/members/hooks';
import { useIssueList, flattenPages } from '~/features/issues/hooks';
import { useFilterState } from '~/features/issues/useFilterState';
import type { IssueFilters } from '~/features/issues/types';
import { Topbar } from '~/components/Topbar';
import { FilterBar } from '~/components/FilterBar';
import { IssueRow, IssueRowHeader, DEFAULT_COLUMNS } from '~/components/IssueRow';
import { Button } from '~/ui/Button';
import { SegmentedControl } from '~/ui/Tabs';
import { EmptyState, ErrorState, SkeletonRows } from '~/ui/Feedback';
import { shortDate } from '~/lib/format';
import type { IssueSummaryDto } from '@flowdesk/contracts';

type Tab = 'assigned' | 'created' | 'overdue' | 'upcoming' | 'recent';
type GroupBy = 'none' | 'status' | 'project' | 'dueDate';

const TABS: { value: Tab; label: string }[] = [
  { value: 'assigned', label: 'Назначено мне' },
  { value: 'created', label: 'Создано мной' },
  { value: 'overdue', label: 'Просрочено' },
  { value: 'upcoming', label: 'Ближайшие' },
  { value: 'recent', label: 'Недавно обновлённые' },
];

/** Filter preset per tab — the tab *is* a filter, so the URL stays honest. */
function presetFor(tab: Tab): IssueFilters {
  switch (tab) {
    case 'assigned':
      return { assigneeId: ['@me'], includeDone: false, sort: 'priority', order: 'asc' };
    case 'created':
      return { reporterId: ['@me'], sort: 'created', order: 'desc' };
    case 'overdue':
      return { assigneeId: ['@me'], isOverdue: true, sort: 'dueDate', order: 'asc' };
    case 'upcoming':
      return {
        assigneeId: ['@me'],
        includeDone: false,
        dueAfter: new Date().toISOString(),
        sort: 'dueDate',
        order: 'asc',
      };
    case 'recent':
      return { sort: 'updated', order: 'desc' };
  }
}

/**
 * Personal work queue across every project in the workspace, with grouping
 * that answers "what should I do next" rather than "what exists".
 */
export function MyWorkPage() {
  const { user, workspace } = useSession();
  const openIssue = useUiStore((s) => s.openIssue);
  const openCreateIssue = useUiStore((s) => s.openCreateIssue);
  const workspaceId = workspace?.id ?? '';

  const [tab, setTab] = useState<Tab>('assigned');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [extraFilters, setExtraFilters] = useFilterState();

  const { data: members } = useMembers(workspaceId);

  const filters = useMemo<IssueFilters>(
    () => ({ ...presetFor(tab), ...extraFilters }),
    [tab, extraFilters],
  );

  // The "upcoming" preset filters on dueAfter = now — refetch on a timer so
  // the window does not freeze at the moment the tab was opened.
  const query = useIssueList({ workspaceId }, filters, { limit: 100, refetchInterval: 60_000 });
  const issues = useMemo(() => flattenPages(query.data), [query.data]);

  const groups = useMemo(() => groupIssues(issues, groupBy), [issues, groupBy]);

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'Мои задачи' }]} />

      <div className="flex items-stretch overflow-x-auto border-b-2 border-border-strong bg-bg-subtle no-scrollbar">
        {TABS.map((item, index) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setTab(item.value)}
            aria-current={tab === item.value ? 'page' : undefined}
            className={clsx(
              'px-3.5 py-2 text-sm font-bold whitespace-nowrap transition-colors',
              index > 0 && 'border-l-2 border-border-strong',
              tab === item.value
                ? 'relative bg-surface text-text after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-accent'
                : 'text-text-muted hover:bg-surface-hover hover:text-text',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <FilterBar
        filters={extraFilters}
        onChange={setExtraFilters}
        members={members?.map((m) => m.user)}
        currentUserId={user?.id ?? ''}
        trailing={
          <SegmentedControl
            label="Группировка"
            value={groupBy}
            onChange={setGroupBy}
            options={[
              { value: 'none', label: 'Без групп' },
              { value: 'status', label: 'Статус' },
              { value: 'project', label: 'Проект' },
              { value: 'dueDate', label: 'Срок' },
            ]}
          />
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface scrollbar-thin">
        {query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : query.isLoading ? (
          <SkeletonRows rows={10} />
        ) : issues.length === 0 ? (
          <EmptyState
            title={emptyTitle(tab)}
            description={emptyDescription(tab)}
            action={
              <Button size="sm" variant="primary" iconLeft={<Plus className="size-3.5" />} onClick={() => openCreateIssue()}>
                Создать задачу
              </Button>
            }
          />
        ) : groupBy === 'none' ? (
          <>
            <IssueRowHeader columns={[...DEFAULT_COLUMNS, 'project']} />
            {issues.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                columns={[...DEFAULT_COLUMNS, 'project']}
                selected={false}
                onToggleSelect={() => undefined}
                onOpen={() => openIssue(issue.id)}
              />
            ))}
          </>
        ) : (
          groups.map((group) => (
            <section key={group.key}>
              <header className="sticky top-0 z-10 flex items-center gap-2 border-b-2 border-border-strong bg-surface-sunken px-3 py-1.5">
                {group.accent && (
                  <span className="size-2.5 border border-border-strong" style={{ backgroundColor: group.accent }} aria-hidden="true" />
                )}
                <h2 className="fd-eyebrow">{group.label}</h2>
                <span className="fd-num text-2xs text-text-subtle">{group.issues.length}</span>
              </header>
              {group.issues.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  columns={[...DEFAULT_COLUMNS, 'project']}
                  selected={false}
                  onToggleSelect={() => undefined}
                  onOpen={() => openIssue(issue.id)}
                />
              ))}
            </section>
          ))
        )}

        {query.hasNextPage && (
          <div className="flex justify-center p-3">
            <Button
              size="sm"
              variant="secondary"
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              Загрузить ещё
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

interface Group {
  key: string;
  label: string;
  accent?: string;
  issues: IssueSummaryDto[];
}

function groupIssues(issues: IssueSummaryDto[], groupBy: GroupBy): Group[] {
  if (groupBy === 'none') return [];

  const map = new Map<string, Group>();

  for (const issue of issues) {
    let key: string;
    let label: string;
    let accent: string | undefined;

    if (groupBy === 'status') {
      key = issue.statusId;
      label = issue.status.name;
      accent = issue.status.color;
    } else if (groupBy === 'project') {
      key = issue.projectId;
      label = issue.project.name;
      accent = issue.project.color;
    } else {
      const bucket = dueBucket(issue.dueDate);
      key = bucket.key;
      label = bucket.label;
    }

    const group = map.get(key) ?? { key, label, accent, issues: [] };
    group.issues.push(issue);
    map.set(key, group);
  }

  const order = ['overdue', 'today', 'week', 'later', 'none'];
  return [...map.values()].sort((a, b) =>
    groupBy === 'dueDate' ? order.indexOf(a.key) - order.indexOf(b.key) : a.label.localeCompare(b.label),
  );
}

function dueBucket(dueDate: string | null): { key: string; label: string } {
  if (!dueDate) return { key: 'none', label: 'Без срока' };
  const due = new Date(dueDate);
  const now = new Date();
  const days = Math.floor((due.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  if (days < 0) return { key: 'overdue', label: 'Просрочено' };
  if (days === 0) return { key: 'today', label: 'Сегодня' };
  if (days <= 7) return { key: 'week', label: 'На этой неделе' };
  return { key: 'later', label: `Позже — с ${shortDate(dueDate)}` };
}

function emptyTitle(tab: Tab): string {
  switch (tab) {
    case 'assigned':
      return 'На вас ничего не назначено';
    case 'created':
      return 'Вы ещё не создавали задач';
    case 'overdue':
      return 'Просроченных задач нет';
    case 'upcoming':
      return 'Ближайших сроков нет';
    case 'recent':
      return 'Недавней активности нет';
  }
}

function emptyDescription(tab: Tab): string {
  switch (tab) {
    case 'assigned':
      return 'Возьмите задачу с доски проекта или создайте новую.';
    case 'created':
      return 'Здесь соберутся задачи, которые вы создали.';
    case 'overdue':
      return 'Со сроками всё в порядке.';
    case 'upcoming':
      return 'В ближайшее время ничего не горит.';
    case 'recent':
      return 'Здесь появятся задачи, которые обновляет команда.';
  }
}
