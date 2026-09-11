import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CircleDot, Clock, Plus, Star, TriangleAlert } from 'lucide-react';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { useSession } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import { useProjects } from '~/features/projects/hooks';
import { useIssueList, flattenPages } from '~/features/issues/hooks';
import { Topbar } from '~/components/Topbar';
import { IssueTypeIcon, PriorityIcon, StatusDot, DueDateChip } from '~/components/IssueMeta';
import { Avatar } from '~/ui/Avatar';
import { Button } from '~/ui/Button';
import { EmptyState, ProgressBar, Skeleton, SkeletonRows } from '~/ui/Feedback';
import { pluralize, relativeTime } from '~/lib/format';

interface MyWorkSummary {
  assigned: number;
  created: number;
  overdue: number;
  upcoming: number;
  completedThisWeek: number;
}

/**
 * Landing screen. Answers three questions in order: what needs me today, what
 * is on fire, and where is the team working.
 */
export function HomePage() {
  const { user, workspace } = useSession();
  const openIssue = useUiStore((s) => s.openIssue);
  const openCreateIssue = useUiStore((s) => s.openCreateIssue);
  const workspaceId = workspace?.id ?? '';

  const { data: summary } = useQuery({
    queryKey: qk.myWork(workspaceId),
    queryFn: () => api.get<MyWorkSummary>(`/workspaces/${workspaceId}/my-work/summary`),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });

  const { data: projects, isLoading: projectsLoading } = useProjects(workspaceId);

  const assignedQuery = useIssueList(
    { workspaceId },
    { assigneeId: ['@me'], includeDone: false, sort: 'priority', order: 'asc' },
    { limit: 8 },
  );
  const assigned = useMemo(() => flattenPages(assignedQuery.data), [assignedQuery.data]);

  const recentQuery = useIssueList({ workspaceId }, { sort: 'updated', order: 'desc' }, { limit: 6 });
  const recent = useMemo(() => flattenPages(recentQuery.data), [recentQuery.data]);

  const favorites = projects?.filter((p) => p.isFavorite) ?? [];
  const visibleProjects = (favorites.length > 0 ? favorites : (projects ?? [])).slice(0, 6);

  const greeting = getGreeting();
  const firstName = user?.name.split(' ')[0] ?? 'there';

  return (
    <>
      <Topbar breadcrumbs={[{ label: workspace?.name ?? 'Home' }]} />

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">
              {greeting}, {firstName}
            </h1>
            <p className="mt-1 text-sm text-text-muted">
              {summary
                ? summary.assigned === 0
                  ? 'Сейчас на вас ничего не назначено.'
                  : `На вас ${pluralize(summary.assigned, ['открытая задача', 'открытые задачи', 'открытых задач'])}${
                      summary.overdue > 0 ? `, из них ${summary.overdue} просрочено` : ''
                    }.`
                : 'Загружаем ваши задачи…'}
            </p>
          </header>

          {/* Quick stats */}
          <div className="grid gap-3 sm:grid-cols-4">
            <StatTile
              to="/my-work"
              label="Назначено"
              value={summary?.assigned}
              icon={<CircleDot className="size-4" />}
            />
            <StatTile
              to="/my-work?isOverdue=true"
              label="Просрочено"
              value={summary?.overdue}
              icon={<TriangleAlert className="size-4" />}
              tone="danger"
            />
            <StatTile
              to="/my-work"
              label="Срок на неделе"
              value={summary?.upcoming}
              icon={<Clock className="size-4" />}
              tone="warning"
            />
            <StatTile
              to="/my-work"
              label="Сделано за неделю"
              value={summary?.completedThisWeek}
              icon={<Star className="size-4" />}
              tone="success"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Assigned to me */}
            <section className="lg:col-span-2">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Ваша очередь</h2>
                <Link to="/my-work" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                  Все мои задачи
                  <ArrowRight className="size-3" />
                </Link>
              </div>

              <div className="overflow-hidden rounded-lg border border-border bg-surface">
                {assignedQuery.isLoading ? (
                  <SkeletonRows rows={5} />
                ) : assigned.length === 0 ? (
                  <EmptyState
                    compact
                    title="Очередь пуста"
description="На вас ничего не назначено. Возьмите задачу или создайте новую."
                    action={
                      <Button
                        size="sm"
                        variant="secondary"
                        iconLeft={<Plus className="size-3.5" />}
                        onClick={() => openCreateIssue()}
                      >
                        Создать задачу
                      </Button>
                    }
                  />
                ) : (
                  <ul className="divide-y divide-border">
                    {assigned.map((issue) => (
                      <li key={issue.id}>
                        <button
                          type="button"
                          onClick={() => openIssue(issue.id)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover"
                        >
                          <IssueTypeIcon type={issue.type} className="size-3.5 shrink-0" />
                          <span className="fd-key shrink-0 truncate" style={{ width: 'var(--key-rail)' }}>
                            {issue.issueKey}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm">{issue.title}</span>
                          <DueDateChip value={issue.dueDate} />
                          <StatusDot status={issue.status} className="size-3 shrink-0" />
                          <PriorityIcon priority={issue.priority} className="size-3.5 shrink-0" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            {/* Projects */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold">{favorites.length > 0 ? 'Избранное' : 'Проекты'}</h2>
                <Link to="/projects" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                  Все
                  <ArrowRight className="size-3" />
                </Link>
              </div>

              {projectsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                </div>
              ) : visibleProjects.length === 0 ? (
                <EmptyState
                  compact
                  className="rounded-lg border border-dashed border-border"
                  title="Проектов пока нет"
description="В проекте живут задачи, доска и спринты."
                  action={
                    <Link to="/projects/new">
                      <Button size="sm" variant="primary" iconLeft={<Plus className="size-3.5" />}>
                        Создать проект
                      </Button>
                    </Link>
                  }
                />
              ) : (
                <ul className="space-y-2">
                  {visibleProjects.map((project) => {
                    const total = project.totalIssueCount ?? 0;
                    const open = project.openIssueCount ?? 0;
                    const done = Math.max(0, total - open);
                    return (
                      <li key={project.id}>
                        <Link
                          to={`/projects/${project.id}`}
                          className="block rounded-lg border border-border bg-surface p-3 transition-colors hover:border-border-strong hover:bg-surface-hover"
                        >
                          <div className="flex items-center gap-2">
                            <span aria-hidden="true">{project.icon}</span>
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">{project.name}</span>
                            <span className="fd-key">{project.key}</span>
                          </div>
                          <ProgressBar
                            value={done}
                            max={Math.max(total, 1)}
                            className="mt-2"
                            tone="success"
                            label={`${done} of ${total} issues complete`}
                          />
                          <p className="fd-num mt-1.5 text-2xs text-text-subtle">
                            {open} в работе · {done} готово
                          </p>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          {/* Team activity */}
          <section>
            <h2 className="mb-2 text-sm font-semibold">Недавно обновлённые</h2>
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              {recentQuery.isLoading ? (
                <SkeletonRows rows={4} />
              ) : recent.length === 0 ? (
                <EmptyState compact title="Активности пока нет" description="Здесь появятся задачи, над которыми работает команда." />
              ) : (
                <ul className="divide-y divide-border">
                  {recent.map((issue) => (
                    <li key={issue.id}>
                      <button
                        type="button"
                        onClick={() => openIssue(issue.id)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover"
                      >
                        <Avatar user={issue.assignee} size="md" />
                        <span className="fd-key shrink-0 truncate" style={{ width: 'var(--key-rail)' }}>
                          {issue.issueKey}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm">{issue.title}</span>
                        <StatusDot status={issue.status} className="size-3 shrink-0" />
                        <span className="fd-num hidden shrink-0 text-2xs text-text-subtle sm:inline">
                          {relativeTime(issue.updatedAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function StatTile({
  to,
  label,
  value,
  icon,
  tone = 'accent',
}: {
  to: string;
  label: string;
  value: number | undefined;
  icon: React.ReactNode;
  tone?: 'accent' | 'danger' | 'warning' | 'success';
}) {
  const tones = {
    accent: 'text-accent bg-accent-subtle',
    danger: 'text-danger bg-danger-subtle',
    warning: 'text-warning bg-warning-subtle',
    success: 'text-success bg-success-subtle',
  } as const;

  return (
    <Link
      to={to}
      className="rounded-lg border border-border bg-surface p-3 transition-colors hover:border-border-strong hover:bg-surface-hover"
    >
      <span className={`inline-flex size-7 items-center justify-center rounded-md ${tones[tone]}`}>{icon}</span>
      <p className="fd-num mt-2 text-xl font-semibold">{value ?? '—'}</p>
      <p className="text-xs text-text-muted">{label}</p>
    </Link>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Ещё не спите';
  if (hour < 12) return 'Доброе утро';
  if (hour < 18) return 'Добрый день';
  return 'Добрый вечер';
}
