import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { addWeeks, format, startOfWeek, subDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { UserSummaryDto, WorkloadRowDto } from '@flowdesk/contracts';
import { useSession } from '~/app/session';
import { useMembers } from '~/features/members/hooks';
import { useDepartments } from '~/features/departments/hooks';
import { useWorkload } from '~/features/issues/hooks';
import { Avatar } from '~/ui/Avatar';
import { SegmentedControl } from '~/ui/Tabs';
import { EmptyState, ErrorState, SkeletonRows, StaleNotice } from '~/ui/Feedback';
import { pluralize } from '~/lib/format';

const EVERYONE = 'all';
const WEEK_CHOICES = ['4', '8', '12'] as const;
type WeekChoice = (typeof WEEK_CHOICES)[number];
const isWeekChoice = (value: string | null): value is WeekChoice => WEEK_CHOICES.includes(value as WeekChoice);

const WEEK_NAMES = ['эта неделя', 'следующая'];

/**
 * «По неделям»: who has how much active work, and when it falls due.
 *
 * The page next to it shows one person before giving them tasks. This one puts
 * people side by side, so that the next week can be planned and not only the
 * current one, and so that the work goes to whoever has room for it.
 *
 * Counts and relative estimates only — see the server's `workload`.
 */
export function PlanningWeeks() {
  const { workspace } = useSession();
  const workspaceId = workspace?.id ?? '';
  const [searchParams, setSearchParams] = useSearchParams();
  const setParam = (key: string, value: string | null) =>
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        if (value) params.set(key, value);
        else params.delete(key);
        return params;
      },
      { replace: true },
    );

  const { data: members } = useMembers(workspaceId);
  const { data: departments } = useDepartments(workspaceId);

  // The circle of people comes from the register of departments, not from who
  // happens to be in which project.
  const team = searchParams.get('team') ?? EVERYONE;
  const department = departments?.items.find((item) => item.id === team);
  const people = useMemo<UserSummaryDto[]>(
    () =>
      department
        ? department.members
        : // A guest gets work only in the projects they were added to; this table is about the team.
          (members ?? []).filter((member) => member.role !== 'GUEST').map((member) => member.user),
    [department, members],
  );

  const weeksParam = searchParams.get('weeks');
  const weekCount = Number(isWeekChoice(weeksParam) ? weeksParam : '4');

  // Mondays of the viewer's own calendar; `today` makes them move on when the day does.
  const today = format(new Date(), 'yyyy-MM-dd');
  const bounds = useMemo(() => {
    const first = startOfWeek(new Date(`${today}T12:00:00`), { weekStartsOn: 1 });
    return Array.from({ length: weekCount + 1 }, (_, index) => addWeeks(first, index));
  }, [today, weekCount]);

  const userIds = useMemo(() => people.map((person) => person.id), [people]);
  const query = useWorkload(workspaceId, userIds, bounds);
  const data = query.data;
  const rowOf = useMemo(() => new Map((data?.rows ?? []).map((row) => [row.userId, row])), [data]);

  // The tallest cell of the table: bars under the week figures are drawn against it.
  const peak = Math.max(1, ...(data?.rows ?? []).flatMap((row) => row.weeks.map((week) => week.count)));
  const total = (pick: (row: WorkloadRowDto) => number) => (data?.rows ?? []).reduce((sum, row) => sum + pick(row), 0);

  const listOf = (userId: string, params: Record<string, string> = {}) =>
    `/employee-work?${new URLSearchParams({ user: userId, ...params }).toString()}`;
  // The same lines the server cut the week along: from its Monday to the last instant before the next one.
  const weekParams = (index: number) => ({
    dueAfter: bounds[index]!.toISOString(),
    dueBefore: new Date(bounds[index + 1]!.getTime() - 1).toISOString(),
  });
  const weekRange = (index: number) =>
    `${format(bounds[index]!, 'd MMM', { locale: ru })} – ${format(subDays(bounds[index + 1]!, 1), 'd MMM', { locale: ru })}`;

  const head = 'border-b-2 border-l-2 border-border-strong px-3 py-2 text-center align-bottom';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b-2 border-border-strong bg-surface px-3 py-2">
        <label className="flex items-center gap-2 text-xs font-bold">
          Сотрудники
          <select
            value={department ? team : EVERYONE}
            onChange={(event) => setParam('team', event.target.value === EVERYONE ? null : event.target.value)}
            className="h-7 max-w-56 rounded-md border-2 border-border-strong bg-surface px-2 text-xs font-normal hover:bg-surface-hover focus:border-accent focus:outline-none"
          >
            <option value={EVERYONE}>Все сотрудники</option>
            {(departments?.items ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2 text-xs font-bold">
          Недель вперёд
          <SegmentedControl
            label="Сколько недель показать"
            value={String(weekCount) as WeekChoice}
            onChange={(next) => setParam('weeks', next === '4' ? null : next)}
            options={WEEK_CHOICES.map((value) => ({ value, label: value }))}
          />
        </div>
        <p className="min-w-0 flex-1 text-2xs text-text-subtle">
          Активные задачи по сроку. Любое число открывает свой список.
        </p>
      </div>

      <StaleNotice query={query} />

      <div className="min-h-0 flex-1 overflow-auto bg-surface scrollbar-thin">
        {query.error && !data ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : !members || !departments || (query.isLoading && userIds.length > 0) ? (
          <SkeletonRows rows={6} />
        ) : people.length === 0 ? (
          <EmptyState
            title="В отделе пока никого нет"
            description="Состав отдела задаётся в настройках пространства, в разделе «Отделы»."
          />
        ) : (
          <>
            <table className="w-full min-w-max border-collapse text-sm" aria-label="Активные задачи сотрудников по неделям">
              <thead className="sticky top-0 z-20 bg-surface-sunken">
                <tr>
                  <th scope="col" className="sticky left-0 z-10 border-b-2 border-border-strong bg-surface-sunken px-3 py-2 text-left align-bottom">
                    <span className="fd-eyebrow">Сотрудник</span>
                  </th>
                  <th scope="col" className={head}>
                    <span className="fd-eyebrow">Активные</span>
                  </th>
                  <th scope="col" className={head}>
                    <span className="fd-eyebrow">Просрочено</span>
                  </th>
                  <th scope="col" className={head}>
                    <span className="fd-eyebrow">Без срока</span>
                  </th>
                  {data?.usesEstimates && (
                    <th scope="col" className={head}>
                      <span className="fd-eyebrow">Без оценки</span>
                    </th>
                  )}
                  {(data?.weeks ?? []).map((week, index) => (
                    <th key={week.start} scope="col" className={clsx(head, index === 0 && 'bg-marker-subtle')}>
                      <span className="fd-eyebrow block">{WEEK_NAMES[index] ?? `через ${index} нед.`}</span>
                      <span className="fd-num block text-2xs font-normal whitespace-nowrap text-text-subtle">{weekRange(index)}</span>
                    </th>
                  ))}
                  <th scope="col" className={head}>
                    <span className="fd-eyebrow">Позже</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {people.map((person) => {
                  const row = rowOf.get(person.id);
                  return (
                    <tr key={person.id} className="border-b-2 border-border-strong">
                      <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-normal">
                        <span className="flex items-center gap-2">
                          <Avatar user={person} size="md" />
                          <span className="min-w-0">
                            <Link to={listOf(person.id)} className="block max-w-48 truncate text-sm font-bold hover:text-accent">
                              {person.name}
                            </Link>
                            {/* From comparing people straight to giving one of them work. */}
                            <Link
                              to={`/planning?mode=pool&user=${person.id}`}
                              className="text-2xs text-text-subtle underline-offset-2 hover:text-accent hover:underline"
                            >
                              дать задачи
                            </Link>
                          </span>
                        </span>
                      </th>
                      <Cell label={`${person.name}: активные`} value={row?.active} points={row?.points} to={listOf(person.id)} />
                      <Cell
                        label={`${person.name}: просрочено`}
                        value={row?.overdue}
                        to={listOf(person.id, { view: 'overdue' })}
                        alarm
                      />
                      <Cell
                        label={`${person.name}: без срока`}
                        value={row?.noDueDate}
                        to={listOf(person.id, { noDueDate: 'true' })}
                      />
                      {data?.usesEstimates && (
                        <Cell
                          label={`${person.name}: без оценки`}
                          value={row?.unestimated}
                          to={listOf(person.id, { noEstimate: 'true' })}
                        />
                      )}
                      {(data?.weeks ?? []).map((week, index) => (
                        <Cell
                          key={week.start}
                          label={`${person.name}: ${weekRange(index)}`}
                          value={row?.weeks[index]?.count}
                          points={row?.weeks[index]?.points}
                          to={listOf(person.id, weekParams(index))}
                          share={(row?.weeks[index]?.count ?? 0) / peak}
                          current={index === 0}
                        />
                      ))}
                      <Cell
                        label={`${person.name}: позже`}
                        value={row?.later}
                        to={listOf(person.id, { dueAfter: bounds[bounds.length - 1]!.toISOString() })}
                      />
                    </tr>
                  );
                })}
              </tbody>
              {people.length > 1 && data && (
                <tfoot>
                  <tr className="bg-surface-sunken">
                    <th scope="row" className="sticky left-0 z-10 bg-surface-sunken px-3 py-2 text-left">
                      <span className="fd-eyebrow">Всего</span>
                    </th>
                    <Sum value={total((row) => row.active)} />
                    <Sum value={total((row) => row.overdue)} alarm />
                    <Sum value={total((row) => row.noDueDate)} />
                    {data.usesEstimates && <Sum value={total((row) => row.unestimated)} />}
                    {data.weeks.map((week, index) => (
                      <Sum key={week.start} value={total((row) => row.weeks[index]?.count ?? 0)} />
                    ))}
                    <Sum value={total((row) => row.later)} />
                  </tr>
                </tfoot>
              )}
            </table>

            <div className="space-y-1 border-t-2 border-border-strong p-3 text-2xs text-text-subtle">
              <p>
                Неделя — задачи, срок которых приходится на неё. Просроченная задача учтена и в «Просрочено», и в
                своей неделе, поэтому сумма по строке может быть больше числа активных.
              </p>
              {data?.usesEstimates && (
                <p>
                  «б.» — оценка в баллах: относительная, не часы и не занятость. Оценка задачи не прибавляется, если
                  оценены её подзадачи, — иначе одна работа считалась бы дважды.
                </p>
              )}
              {data?.truncated && (
                <p className="font-bold text-danger">
                  Активных задач больше, чем помещается в расчёт, — числа неполные. Выберите отдел, чтобы сузить круг.
                </p>
              )}
              <p>В таблице {pluralize(people.length, ['сотрудник', 'сотрудника', 'сотрудников'])}.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Cell({
  label,
  value,
  points,
  to,
  alarm,
  share,
  current,
}: {
  label: string;
  value: number | undefined;
  /** Shown under the figure where the team estimates its tasks. */
  points?: number;
  /** The list of exactly the tasks counted here. */
  to: string;
  alarm?: boolean;
  /** Part of the tallest week cell, for the bar that lets rows be compared at a glance. */
  share?: number;
  current?: boolean;
}) {
  const cell = clsx('border-l-2 border-border-strong p-0 text-center align-top', current && 'bg-marker-subtle');
  if (!value) {
    return (
      <td className={cell}>
        <span className="block px-3 py-2 text-text-subtle" aria-label={`${label}: ${value === undefined ? 'нет данных' : 0}`}>
          {value === undefined ? '·' : '—'}
        </span>
      </td>
    );
  }
  return (
    <td className={cell}>
      <Link
        to={to}
        aria-label={`${label}: ${value}`}
        title="Открыть эти задачи списком"
        className={clsx('block min-w-16 px-3 py-2 hover:bg-surface-hover', alarm && 'text-danger')}
      >
        <span className="fd-num block text-base font-bold">{value}</span>
        {points ? <span className="fd-num block text-2xs text-text-subtle">{points} б.</span> : null}
        {share !== undefined && (
          <span className="mt-1 block h-1 bg-surface-active" aria-hidden="true">
            <span className="block h-full bg-accent" style={{ width: `${Math.max(8, Math.round(share * 100))}%` }} />
          </span>
        )}
      </Link>
    </td>
  );
}

function Sum({ value, alarm }: { value: number; alarm?: boolean }) {
  return (
    <td className="border-l-2 border-border-strong px-3 py-2 text-center">
      <span className={clsx('fd-num font-bold', alarm && value > 0 && 'text-danger', value === 0 && 'text-text-subtle')}>
        {value || '—'}
      </span>
    </td>
  );
}
