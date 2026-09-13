import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { CircleDot, Clock, Plus, Star, TriangleAlert } from 'lucide-react';
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
import { Marker, Masthead, SectionHeading, sectionLinkClass } from '~/ui/Masthead';
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
        <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
          <Masthead
            kicker={dateline()}
            title={
              <>
                {greeting}, <Marker>{firstName}</Marker>
              </>
            }
            note={
              summary
                ? summary.assigned === 0
                  ? 'Сейчас на вас ничего не назначено.'
                  : `На вас ${pluralize(summary.assigned, ['открытая задача', 'открытые задачи', 'открытых задач'])}${
                      summary.overdue > 0 ? `, из них ${summary.overdue} просрочено` : ''
                    }.`
                : 'Загружаем ваши задачи…'
            }
          />

          {/* The four numbers that matter, set as a stepped row rather than a
              flat grid — the eye reads them in order instead of all at once. */}
          <div className="grid grid-cols-2 gap-3 pt-7 pb-2 sm:gap-4 lg:grid-cols-4">
            <StatPlate
              to="/my-work"
              eyebrow="на мне"
              label="Назначено"
              value={summary?.assigned}
              icon={<CircleDot className="size-5" />}
              tone="ink"
            />
            <StatPlate
              to="/my-work?isOverdue=true"
              eyebrow="срочно"
              label="Просрочено"
              value={summary?.overdue}
              icon={<TriangleAlert className="size-5" />}
              tone="danger"
              className="lg:translate-y-4"
            />
            <StatPlate
              to="/my-work"
              eyebrow="дедлайны"
              label="Срок на неделе"
              value={summary?.upcoming}
              icon={<Clock className="size-5" />}
              tone="marker"
            />
            <StatPlate
              to="/my-work"
              eyebrow="эта неделя"
              label="Сделано за неделю"
              value={summary?.completedThisWeek}
              icon={<Star className="size-5" />}
              tone="paper"
              className="lg:translate-y-6"
            />
          </div>

          <div className="grid gap-6 pt-10 lg:grid-cols-3">
            {/* Assigned to me */}
            <section className="lg:col-span-2">
              <SectionHeading
                aside={
                  <Link to="/my-work" className={sectionLinkClass}>
                    все мои задачи →
                  </Link>
                }
              >
                Ваша очередь
              </SectionHeading>

              <div className="border-2 border-border-strong bg-surface shadow-xl">
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
                  <ul className="divide-y-2 divide-border-strong">
                    {assigned.map((issue) => (
                      <li key={issue.id}>
                        <button
                          type="button"
                          onClick={() => openIssue(issue.id)}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-hover"
                        >
                          <span
                            className="fd-key shrink-0 truncate font-bold text-text"
                            style={{ width: 'var(--key-rail)' }}
                          >
                            {issue.issueKey}
                          </span>
                          <IssueTypeIcon type={issue.type} className="size-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{issue.title}</span>
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

            {/* Projects — dropped a step below the queue so the two columns
                do not read as one symmetrical block. */}
            <section className="lg:translate-y-8">
              <SectionHeading
                aside={
                  <Link to="/projects" className={sectionLinkClass}>
                    все →
                  </Link>
                }
              >
                {favorites.length > 0 ? 'Избранное' : 'Проекты'}
              </SectionHeading>

              {projectsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                </div>
              ) : visibleProjects.length === 0 ? (
                <EmptyState
                  compact
                  className="border-2 border-dashed border-border-strong"
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
                <ul className="space-y-4">
                  {visibleProjects.map((project) => {
                    const total = project.totalIssueCount ?? 0;
                    const open = project.openIssueCount ?? 0;
                    const done = Math.max(0, total - open);
                    return (
                      <li key={project.id}>
                        <Link
                          to={`/projects/${project.id}`}
                          className="fd-lift block border-2 border-border-strong bg-surface p-4 shadow-md"
                        >
                          <div className="flex items-center gap-2.5">
                            <span
                              aria-hidden="true"
                              className="size-3 shrink-0 border-2 border-border-strong"
                              style={{ backgroundColor: project.color || 'var(--accent)' }}
                            />
                            <span className="min-w-0 flex-1 truncate text-sm font-bold">{project.name}</span>
                            <span className="fd-num bg-ink px-1.5 py-0.5 text-[10px] font-bold text-text-inverted">
                              {project.key}
                            </span>
                          </div>
                          <ProgressBar
                            value={done}
                            max={Math.max(total, 1)}
                            className="mt-3"
                            tone="success"
                            label={`${done} из ${total} задач готово`}
                          />
                          <p className="fd-num mt-2 text-2xs text-text-subtle">
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
          <section className="pt-14">
            <SectionHeading>Недавно обновлённые</SectionHeading>
            <div className="border-2 border-border-strong bg-surface shadow-lg">
              {recentQuery.isLoading ? (
                <SkeletonRows rows={4} />
              ) : recent.length === 0 ? (
                <EmptyState compact title="Активности пока нет" description="Здесь появятся задачи, над которыми работает команда." />
              ) : (
                <ul className="divide-y-2 divide-border-strong">
                  {recent.map((issue) => (
                    <li key={issue.id}>
                      <button
                        type="button"
                        onClick={() => openIssue(issue.id)}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-hover"
                      >
                        <Avatar user={issue.assignee} size="md" />
                        <span className="fd-key shrink-0 truncate font-bold text-text" style={{ width: 'var(--key-rail)' }}>
                          {issue.issueKey}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{issue.title}</span>
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

/**
 * A headline number. Each tone is a different printed plate — reversed ink,
 * a red alarm, a yellow marker, plain paper — so the four read as four
 * different kinds of news rather than four copies of one card.
 */
function StatPlate({
  to,
  eyebrow,
  label,
  value,
  icon,
  tone,
  className,
}: {
  to: string;
  eyebrow: string;
  label: string;
  value: number | undefined;
  icon: React.ReactNode;
  tone: 'ink' | 'danger' | 'marker' | 'paper';
  className?: string;
}) {
  const tones = {
    ink: 'bg-ink text-text-inverted shadow-md',
    danger: 'bg-danger text-accent-fg shadow-[4px_4px_0_var(--accent)]',
    marker: 'bg-marker text-ink shadow-md',
    paper: 'bg-surface text-text shadow-md',
  } as const;

  return (
    <Link
      to={to}
      className={clsx('fd-lift block border-2 border-border-strong p-5', tones[tone], className)}
    >
      <div className="flex items-center justify-between">
        {icon}
        <span className="fd-num text-[10px] uppercase tracking-widest opacity-70">{eyebrow}</span>
      </div>
      <div className="mt-3 font-display text-4xl font-black tabular-nums">{value ?? '—'}</div>
      <div className="fd-num mt-2 text-[10px] uppercase tracking-widest opacity-75">{label}</div>
    </Link>
  );
}

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = [
  'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
];

/** ISO week number — the masthead dates itself the way a sprint does. */
function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function dateline(): string {
  const now = new Date();
  return `${WEEKDAYS[now.getDay()]} · ${now.getDate()} ${MONTHS[now.getMonth()]} · неделя ${isoWeek(now)}`;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Ещё не спите';
  if (hour < 12) return 'Доброе утро';
  if (hour < 18) return 'Добрый день';
  return 'Добрый вечер';
}
