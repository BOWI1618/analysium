import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import type { DashboardDto } from '@flowdesk/contracts';
import { AlertTriangle, CheckCircle2, CircleDot, UserX } from 'lucide-react';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { PRIORITY_META } from '~/components/IssueMeta';
import { Avatar } from '~/ui/Avatar';
import { SegmentedControl } from '~/ui/Tabs';
import { EmptyState, ErrorState, ProgressBar, Skeleton } from '~/ui/Feedback';
import { Panel } from '~/ui/Panel';
import { Marker, Masthead } from '~/ui/Masthead';
import { shortDate } from '~/lib/format';

/**
 * Project insights. Every number is computed server-side from grouped queries,
 * so the page costs the same on a 50-issue project and a 50 000-issue one.
 */
export function DashboardPage() {
  const { projectId = '' } = useParams();
  const [days, setDays] = useState<number>(30);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.dashboard(projectId, days),
    queryFn: () => api.get<DashboardDto>(`/projects/${projectId}/dashboard`, { query: { days } }),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <Masthead
          size="md"
          kicker={`последние ${days} дн.`}
          title={
            <>
              <Marker>Аналитика</Marker>
            </>
          }
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
        />

        {isLoading || !data ? (
          <DashboardSkeleton />
        ) : (
          <>
            {/* Totals */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="Открыто"
                value={data.totals.open}
                total={data.totals.total}
                icon={<CircleDot className="size-4" />}
                tone="accent"
              />
              <StatCard
                label="Завершено"
                value={data.totals.completed}
                total={data.totals.total}
                icon={<CheckCircle2 className="size-4" />}
                tone="success"
              />
              <StatCard
                label="Просрочено"
                value={data.totals.overdue}
                total={data.totals.open}
                icon={<AlertTriangle className="size-4" />}
                tone="danger"
              />
              <StatCard
                label="Без исполнителя"
                value={data.totals.unassigned}
                total={data.totals.total}
                icon={<UserX className="size-4" />}
                tone="warning"
              />
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
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
            <Panel bodyClassName="p-3.5" title={`Создано и завершено — за ${days} дн.`}>
              <ActivityChart data={data.activity} />
            </Panel>

            <div className="grid gap-3 lg:grid-cols-2">
              {/* Workload */}
              <Panel bodyClassName="p-3.5" title="Нагрузка по исполнителям">
                {data.byAssignee.length === 0 ? (
                  <EmptyState compact title="Ничего не назначено" />
                ) : (
                  <ul className="space-y-2.5">
                    {data.byAssignee.map((row) => (
                      <li key={row.user?.id ?? 'unassigned'} className="flex items-center gap-2.5">
                        <Avatar user={row.user} size="md" />
                        <span className="min-w-0 flex-1 truncate text-xs">
                          {row.user?.name ?? 'Без исполнителя'}
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
  icon,
  tone,
}: {
  label: string;
  value: number;
  total: number;
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
    <div className={clsx('border-2 border-border-strong p-4 shadow-md', tones[tone])}>
      <div className="flex items-center justify-between">
        {icon}
        <span className="fd-num text-[10px] uppercase tracking-widest opacity-70">{label}</span>
      </div>
      <p className="mt-3 font-display text-3xl font-black tabular-nums">{value}</p>
      {total > 0 && (
        <p className="fd-num mt-1.5 text-[10px] uppercase tracking-widest opacity-70">
          {percent}% из {total}
        </p>
      )}
    </div>
  );
}

/** Grouped bars: created vs completed per day, rendered as inline SVG. */
function ActivityChart({ data }: { data: { date: string; created: number; completed: number }[] }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.created, d.completed)));
  const width = Math.max(data.length * 14, 100);

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <svg
        viewBox={`0 0 ${width} 90`}
        className="h-24 w-full min-w-full"
        role="img"
        aria-label="Создано и завершено задач по дням"
        preserveAspectRatio="none"
      >
        {data.map((day, index) => {
          const x = index * 14 + 2;
          const createdHeight = (day.created / max) * 70;
          const completedHeight = (day.completed / max) * 70;
          return (
            <g key={day.date}>
              <title>{`${day.date}: создано ${day.created}, завершено ${day.completed}`}</title>
              <rect
                x={x}
                y={78 - createdHeight}
                width="5"
                height={Math.max(createdHeight, day.created > 0 ? 2 : 0)}
                rx="1.5"
                fill="var(--accent)"
                opacity="0.85"
              />
              <rect
                x={x + 6}
                y={78 - completedHeight}
                width="5"
                height={Math.max(completedHeight, day.completed > 0 ? 2 : 0)}
                rx="1.5"
                fill="var(--success)"
                opacity="0.85"
              />
            </g>
          );
        })}
        <line x1="0" y1="78" x2={width} y2="78" stroke="var(--border)" strokeWidth="1" />
      </svg>

      <div className="mt-2 flex items-center gap-4 text-2xs text-text-subtle">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-xs bg-accent" /> Создано
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-xs bg-success" /> Завершено
        </span>
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
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
      <Skeleton className="h-40" />
    </div>
  );
}
