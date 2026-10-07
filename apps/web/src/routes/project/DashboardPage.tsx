import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import type { DashboardDto } from '@flowdesk/contracts';
import { AlertTriangle, CheckCircle2, CircleDot, UserX } from 'lucide-react';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { PRIORITY_META } from '~/components/IssueMeta';
import { Avatar } from '~/ui/Avatar';
import { SegmentedControl } from '~/ui/Tabs';
import { EmptyState, ErrorState, ProgressBar, Skeleton, StaleNotice } from '~/ui/Feedback';
import { Panel } from '~/ui/Panel';
import { Marker, Masthead } from '~/ui/Masthead';
import { pluralize, shortDate } from '~/lib/format';

/**
 * Project insights. Every number is computed server-side from grouped queries,
 * so the page costs the same on a 50-issue project and a 50 000-issue one.
 */
export function DashboardPage() {
  const { projectId = '' } = useParams();
  const [days, setDays] = useState<number>(30);

  const dashboardQuery = useQuery({
    queryKey: qk.dashboard(projectId, days),
    queryFn: () => api.get<DashboardDto>(`/projects/${projectId}/dashboard`, { query: { days } }),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });
  const { data, isLoading, error, refetch } = dashboardQuery;

  if (error && !data) return <ErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
      <StaleNotice query={dashboardQuery} />
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        {/* The period switch sits with the one block it changes, further
            down. Here in the heading it read as a filter over the whole page,
            while the figures under it never moved. */}
        <Masthead
          size="md"
          kicker="проект сейчас"
          title={
            <>
              <Marker>Аналитика</Marker>
            </>
          }
        />

        {isLoading || !data ? (
          <DashboardSkeleton />
        ) : (
          <>
            {/* Totals */}
            {/* Each figure leads to the tasks it counts. */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="В работе и в очереди"
                value={data.totals.open}
                total={data.totals.total}
                of="всех"
                to={`/projects/${projectId}/list?includeDone=false`}
                icon={<CircleDot className="size-4" />}
                tone="accent"
              />
              <StatCard
                label="Просрочено"
                value={data.totals.overdue}
                total={data.totals.open}
                of="открытых"
                to={`/projects/${projectId}/list?isOverdue=true`}
                icon={<AlertTriangle className="size-4" />}
                tone="danger"
              />
              <StatCard
                label="Без исполнителя"
                value={data.totals.unassigned}
                total={data.totals.open}
                of="открытых"
                to={`/projects/${projectId}/list?assigneeId=none&includeDone=false`}
                icon={<UserX className="size-4" />}
                tone="warning"
              />
              <StatCard
                label="Завершено за всё время"
                value={data.totals.completed}
                total={data.totals.total}
                of="всех"
                to={`/projects/${projectId}/list?statusCategory=COMPLETED`}
                icon={<CheckCircle2 className="size-4" />}
                tone="success"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {/* Status breakdown */}
              <Panel bodyClassName="p-3.5" title="По статусам">
                {data.byStatus.length === 0 ? (
                  <EmptyState compact title="Пока нечего показать" />
                ) : (
                  <ul className="space-y-2.5">
                    {data.byStatus.map((row) => (
                      <li key={row.statusId}>
                        <div className="mb-1 flex items-center gap-2 text-xs">
                          <span
                            className="size-2.5 shrink-0 border border-border-strong"
                            style={{ backgroundColor: row.color }}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate">{row.name}</span>
                          <span className="fd-num text-text-subtle">{row.count}</span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden border-2 border-border-strong bg-surface-sunken">
                          <div
                            className="h-full"
                            style={{
                              width: `${data.totals.total ? (row.count / data.totals.total) * 100 : 0}%`,
                              backgroundColor: row.color,
                            }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              {/* Priority breakdown */}
              <Panel bodyClassName="p-3.5" title="По приоритетам">
                <ul className="space-y-2.5">
                  {data.byPriority
                    .filter((row) => row.count > 0)
                    .map((row) => (
                      <li key={row.priority}>
                        <div className="mb-1 flex items-center gap-2 text-xs">
                          <span
                            className="size-2.5 shrink-0 border border-border-strong"
                            style={{ backgroundColor: `var(${PRIORITY_META[row.priority].varName})` }}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1">{PRIORITY_META[row.priority].label}</span>
                          <span className="fd-num text-text-subtle">{row.count}</span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden border-2 border-border-strong bg-surface-sunken">
                          <div
                            className="h-full"
                            style={{
                              width: `${data.totals.total ? (row.count / data.totals.total) * 100 : 0}%`,
                              backgroundColor: `var(${PRIORITY_META[row.priority].varName})`,
                            }}
                          />
                        </div>
                      </li>
                    ))}
                  {data.byPriority.every((row) => row.count === 0) && (
                    <EmptyState compact title="Задач пока нет" />
                  )}
                </ul>
              </Panel>
            </div>

            {/* Created vs completed */}
            <Panel
              bodyClassName="p-3.5"
              title="Динамика за период"
              subtitle={`За ${data.period.days} дн.: создано ${data.period.created}, завершено ${data.period.completed}`}
              actions={
                <SegmentedControl
                  label="Период"
                  value={String(days)}
                  onChange={(value) => setDays(Number(value))}
                  options={[
                    { value: '7', label: '7 дн' },
                    { value: '30', label: '30 дн' },
                    { value: '90', label: '90 дн' },
                  ]}
                />
              }
            >
              <ActivityChart data={data.activity} />
            </Panel>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {/* Workload */}
              {/* It was called «Нагрузка», and showed completed out of all
                  tasks ever — someone with every task finished read as loaded
                  at 100%. What a person has on them now is said in words; the
                  bar stays what it is, a share of work done. */}
              <Panel bodyClassName="p-3.5" title="По сотрудникам" subtitle="Сейчас на человеке и сколько сделано за всё время">
                {data.byAssignee.length === 0 ? (
                  <EmptyState compact title="Ничего не назначено" />
                ) : (
                  <ul className="space-y-2.5">
                    {data.byAssignee.map((row) => (
                      <li key={row.user?.id ?? 'unassigned'} className="flex items-center gap-2.5">
                        <Avatar user={row.user} size="md" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs">{row.user?.name ?? 'Без исполнителя'}</span>
                          <span className="fd-num block truncate text-2xs text-text-subtle">
                            {pluralize(row.active, ['активная', 'активные', 'активных'])}
                            {row.overdue > 0 && <span className="font-bold text-danger"> · просрочено {row.overdue}</span>}
                          </span>
                        </span>
                        <ProgressBar
                          value={row.completed}
                          max={row.count}
                          className="w-24"
                          tone="success"
                          label={`Выполнено ${row.completed} из ${row.count}`}
                        />
                        <span className="fd-num w-14 text-right text-2xs text-text-subtle">
                          {row.completed}/{row.count}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              {/* Velocity */}
              <Panel bodyClassName="p-3.5" title="Скорость спринтов">
                {data.velocity.length === 0 ? (
                  <EmptyState
                    compact
                    title="Завершённых спринтов нет"
description="Скорость появится после первого завершённого спринта."
                  />
                ) : (
                  <VelocityChart data={data.velocity} />
                )}
              </Panel>
            </div>

            {/* Sprint burndown */}
            {data.sprint && (
              <Panel
                bodyClassName="p-3.5"
                title={`Сгорание задач — ${data.sprint.name}`}
                subtitle={
                  data.sprint.startDate && data.sprint.endDate
                    ? `${shortDate(data.sprint.startDate)} → ${shortDate(data.sprint.endDate)}`
                    : undefined
                }
              >
                <BurndownChart data={data.sprint.burndown} />
              </Panel>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ bits */

function StatCard({
  label,
  value,
  total,
  of,
  to,
  icon,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  /** What the share is taken of — «всех», «открытых» — so the percentage says what it measures. */
  of: string;
  /** The list of exactly the tasks counted here. */
  to: string;
  icon: React.ReactNode;
  tone: 'accent' | 'success' | 'danger' | 'warning';
}) {
  const tones = {
    accent: 'bg-ink text-text-inverted',
    success: 'bg-success text-accent-fg',
    danger: 'bg-danger text-accent-fg',
    warning: 'bg-marker text-ink',
  } as const;

  const percent = total > 0 ? Math.round((value / total) * 100) : 0;

  return (
    <Link
      to={to}
      title="Открыть эти задачи списком"
      className={clsx('fd-lift block border-2 border-border-strong p-4 shadow-md', tones[tone])}
    >
      <div className="flex items-center justify-between gap-2">
        {icon}
        <span className="fd-num text-right text-[10px] uppercase tracking-widest opacity-70">{label}</span>
      </div>
      <p className="mt-3 font-display text-3xl font-black tabular-nums">{value}</p>
      {total > 0 && (
        <p className="fd-num mt-1.5 text-[10px] uppercase tracking-widest opacity-70">
          {percent}% из {total} {of}
        </p>
      )}
    </Link>
  );
}

/** `2026-10-07` as «07.10»: short enough to stand under a bar, and no time zone to get wrong. */
const dayLabel = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;

/**
 * Grouped bars: created vs completed per day, rendered as inline SVG.
 *
 * The bars used to stand on a bare line: nothing said how many tasks the
 * tallest one was, or which day a bar belonged to, short of hovering over it.
 * The scale and the dates are plain text beside the drawing — inside it they
 * would be stretched together with the bars.
 */
function ActivityChart({ data }: { data: { date: string; created: number; completed: number }[] }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.created, d.completed)));
  const width = Math.max(data.length * 14, 100);
  // Every day of a week, every fifth of a month: as many dates as fit in a row.
  const step = Math.max(1, Math.ceil(data.length / 7));
  // Where the top of the tallest bar and the baseline sit, as shares of the drawing's height.
  const TOP = 8;
  const BASE = 78;
  const HEIGHT = 90;
  const at = (y: number) => `${(y / HEIGHT) * 100}%`;

  return (
    <div>
      <div className="flex gap-2">
        <div className="fd-num relative h-24 w-7 shrink-0 text-right text-2xs text-text-subtle" aria-hidden="true">
          <span className="absolute right-0 -translate-y-1/2" style={{ top: at(TOP) }}>
            {max}
          </span>
          {max % 2 === 0 && (
            <span className="absolute right-0 -translate-y-1/2" style={{ top: at((TOP + BASE) / 2) }}>
              {max / 2}
            </span>
          )}
          <span className="absolute right-0 -translate-y-1/2" style={{ top: at(BASE) }}>
            0
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <svg
            viewBox={`0 0 ${width} ${HEIGHT}`}
            className="h-24 w-full"
            role="img"
            aria-label={`Создано и завершено задач по дням, самое большое значение за день — ${max}`}
            preserveAspectRatio="none"
          >
            <line x1="0" y1={TOP} x2={width} y2={TOP} stroke="var(--border)" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
            <line
              x1="0"
              y1={(TOP + BASE) / 2}
              x2={width}
              y2={(TOP + BASE) / 2}
              stroke="var(--border)"
              strokeWidth="1"
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
            {data.map((day, index) => {
              const x = index * 14 + 2;
              const createdHeight = (day.created / max) * (BASE - TOP);
              const completedHeight = (day.completed / max) * (BASE - TOP);
              return (
                <g key={day.date}>
                  <title>{`${dayLabel(day.date)}: создано ${day.created}, завершено ${day.completed}`}</title>
                  {/* The whole day answers to the pointer, not only its bars: an empty day has none. */}
                  <rect x={index * 14} y="0" width="14" height={HEIGHT} fill="transparent" />
                  <rect
                    x={x}
                    y={BASE - createdHeight}
                    width="5"
                    height={Math.max(createdHeight, day.created > 0 ? 2 : 0)}
                    rx="1.5"
                    fill="var(--accent)"
                    opacity="0.85"
                  />
                  <rect
                    x={x + 6}
                    y={BASE - completedHeight}
                    width="5"
                    height={Math.max(completedHeight, day.completed > 0 ? 2 : 0)}
                    rx="1.5"
                    fill="var(--success)"
                    opacity="0.85"
                  />
                </g>
              );
            })}
            <line x1="0" y1={BASE} x2={width} y2={BASE} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          </svg>

          <div className="fd-num relative h-4 text-2xs text-text-subtle" aria-hidden="true">
            {data.map((day, index) =>
              // Counted from the last day back, so that today always has its date.
              (data.length - 1 - index) % step === 0 ? (
                <span
                  key={day.date}
                  className="absolute -translate-x-1/2 whitespace-nowrap"
                  style={{ left: `${((index * 14 + 7.5) / width) * 100}%` }}
                >
                  {dayLabel(day.date)}
                </span>
              ) : null,
            )}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-9 text-2xs text-text-subtle">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-xs bg-accent" /> Создано
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-xs bg-success" /> Завершено
        </span>
        <span>Слева — задач за день, снизу — даты</span>
      </div>
    </div>
  );
}

function VelocityChart({
  data,
}: {
  data: { sprintId: string; name: string; committed: number; completed: number }[];
}) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.committed, d.completed)));

  return (
    <div className="space-y-2.5">
      {data.map((sprint) => (
        <div key={sprint.sprintId}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="truncate">{sprint.name}</span>
            <span className="fd-num text-text-subtle">
              {sprint.completed}/{sprint.committed} задач
            </span>
          </div>
          <div className="relative h-4 w-full overflow-hidden rounded-sm bg-surface-active">
            <div
              className="absolute inset-y-0 left-0 rounded-sm bg-accent/25"
              style={{ width: `${(sprint.committed / max) * 100}%` }}
              title={`Взято в спринт: ${sprint.committed} задач`}
            />
            <div
              className="absolute inset-y-0 left-0 rounded-sm bg-success"
              style={{ width: `${(sprint.completed / max) * 100}%` }}
              title={`Завершено: ${sprint.completed} задач`}
            />
          </div>
        </div>
      ))}
      <p className="text-2xs text-text-subtle">Сплошная — завершено, бледная — взято в спринт на старте.</p>
    </div>
  );
}

function BurndownChart({ data }: { data: { date: string; remaining: number | null; ideal: number }[] }) {
  if (data.length < 2) {
    return <EmptyState compact title="Недостаточно данных" description="Укажите даты спринта, чтобы увидеть сгорание задач." />;
  }

  const max = Math.max(1, ...data.map((d) => Math.max(d.ideal, d.remaining ?? 0)));
  const width = 300;
  const height = 100;
  const stepX = width / (data.length - 1);

  const toPoints = (pick: (d: (typeof data)[number]) => number | null) =>
    data
      .map((d, i) => {
        const value = pick(d);
        if (value === null || Number.isNaN(value)) return null;
        return `${i * stepX},${height - (value / max) * (height - 10) - 5}`;
      })
      .filter((point): point is string => point !== null)
      .join(' ');

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-28 w-full"
        role="img"
        aria-label="Сгорание задач спринта: остаток работ против идеальной линии"
        preserveAspectRatio="none"
      >
        <polyline
          points={toPoints((d) => d.ideal)}
          fill="none"
          stroke="var(--border-strong)"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
        <polyline
          points={toPoints((d) => d.remaining)}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>

      <div className="mt-2 flex items-center gap-4 text-2xs text-text-subtle">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-accent" /> Осталось
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 border-t border-dashed border-border-strong" /> Идеально
        </span>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
      <Skeleton className="h-40" />
    </div>
  );
}
