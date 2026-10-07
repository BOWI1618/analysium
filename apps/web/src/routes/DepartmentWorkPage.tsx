import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { ChevronDown, Settings } from 'lucide-react';
import { useSession } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import { useMembers } from '~/features/members/hooks';
import { useProjects } from '~/features/projects/hooks';
import { useDepartmentIssues, useDepartmentStats, useDepartments } from '~/features/departments/hooks';
import {
  flattenPages,
  useAssigneeStats,
  useBulkUpdate,
  useIssueCount,
  useIssueList,
} from '~/features/issues/hooks';
import { useFilterState } from '~/features/issues/useFilterState';
import type { IssueFilters } from '~/features/issues/types';
import { Topbar } from '~/components/Topbar';
import { FilterBar } from '~/components/FilterBar';
import { BulkActionBar } from '~/components/BulkActionBar';
import { IssueRow, IssueRowHeader, listMinStyle, type ListColumn } from '~/components/IssueRow';
import { Avatar } from '~/ui/Avatar';
import { Button } from '~/ui/Button';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '~/ui/Menu';
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '~/ui/Feedback';
import { pluralize } from '~/lib/format';

const COLUMNS: ListColumn[] = ['status', 'priority', 'project', 'dueDate', 'assignee'];

/** The address of «everyone», next to the ids of real departments. */
const EVERYONE = 'all';

/**
 * A department through its lead's eyes: who is in it, how much each person
 * carries, and their tasks in one list.
 *
 * Who is in the department comes from the register an administrator keeps.
 * What is shown of their work is whatever the viewer could open anyway — the
 * department is a way to gather tasks, not a key to projects.
 *
 * Those who keep that register also get «Все сотрудники»: every task of the
 * workspace with whoever is responsible for it, tasks nobody has included —
 * the one place to sit down and see the whole of the work.
 */
export function DepartmentWorkPage() {
  const { user, workspace } = useSession();
  const openIssue = useUiStore((s) => s.openIssue);
  const workspaceId = workspace?.id ?? '';

  const [searchParams, setSearchParams] = useSearchParams();
  const { data, isLoading, error, refetch } = useDepartments(workspaceId);
  const { data: projects } = useProjects(workspaceId);
  const { data: workspaceMembers } = useMembers(workspaceId);
  const departments = data?.items ?? [];
  const requested = searchParams.get('department');

  // Offered to administrators and the owner. With no department created yet it
  // is what they see first: a list of the whole work beats an empty page.
  const canSeeEveryone = Boolean(data?.canManage);
  const everyone = canSeeEveryone && (requested === EVERYONE || departments.length === 0);
  const department = everyone ? undefined : (departments.find((item) => item.id === requested) ?? departments[0]);

  const chooseDepartment = (id: string) =>
    setSearchParams(
      // Another department is other people: a filter by person does not carry over.
      (current) => {
        const params = new URLSearchParams(current);
        params.set('department', id);
        params.delete('assigneeId');
        return params;
      },
      { replace: true },
    );

  const [barFilters, setBarFilters] = useFilterState();
  const chosen = useMemo(() => {
    const rest: IssueFilters = { ...barFilters };
    delete rest.sort;
    delete rest.order;
    return rest;
  }, [barFilters]);
  // The figures are per person, so the choice of person does not narrow them.
  const statsFilters = useMemo(() => {
    const rest: IssueFilters = { ...chosen };
    delete rest.assigneeId;
    return rest;
  }, [chosen]);

  const listFilters = useMemo<IssueFilters>(
    () => ({
      includeDone: false,
      ...chosen,
      // Chosen states replace «open only», as on «Мои задачи».
      ...(chosen.statusCategory?.length ? { includeDone: undefined } : {}),
      // People's work includes their subtasks, whoever holds the parent.
      includeSubtasks: true,
      sort: 'dueDate',
      order: 'asc',
    }),
    [chosen],
  );

  const everybody = useMemo(() => (workspaceMembers ?? []).map((member) => member.user), [workspaceMembers]);
  const members = everyone ? everybody : (department?.members ?? []);
  const memberIds = useMemo(() => members.map((member) => member.id), [members]);
  // A guest can be given work only in their own projects; in the list of all
  // tasks the people offered for reassignment are those any task can go to.
  const assignable = useMemo(
    () =>
      everyone
        ? (workspaceMembers ?? []).filter((member) => member.role !== 'GUEST').map((member) => member.user)
        : members,
    [everyone, workspaceMembers, members],
  );

  // Both sources are asked every time — hooks cannot be skipped — and only the
  // one that matches the mode is enabled.
  const departmentId = !everyone && members.length ? department?.id : undefined;
  const departmentIssues = useDepartmentIssues(departmentId, listFilters);
  const allIssues = useIssueList({ workspaceId }, listFilters, { enabled: everyone });
  const query = everyone ? allIssues : departmentIssues;

  const { data: departmentStats } = useDepartmentStats(departmentId, statsFilters);
  const { data: allStats } = useAssigneeStats(workspaceId, everyone ? memberIds : [], statsFilters);
  const stats = everyone ? allStats : departmentStats;

  const unassignedFilters = useMemo<IssueFilters>(
    () => ({ ...statsFilters, assigneeId: ['none'], includeDone: false, includeSubtasks: true }),
    [statsFilters],
  );
  const { data: unassigned } = useIssueCount(workspaceId, unassignedFilters, everyone);

  const issues = useMemo(() => flattenPages(query.data), [query.data]);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selected = useMemo(() => {
    const listed = new Set(issues.map((issue) => issue.id));
    return selectedIds.filter((id) => listed.has(id));
  }, [selectedIds, issues]);
  const lastClicked = useRef<string | null>(null);
  const toggleSelect = useCallback(
    (issueId: string, event: { shiftKey: boolean }) => {
      if (event.shiftKey && lastClicked.current) {
        const from = issues.findIndex((issue) => issue.id === lastClicked.current);
        const to = issues.findIndex((issue) => issue.id === issueId);
        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from];
          const range = issues.slice(start, end + 1).map((issue) => issue.id);
          setSelectedIds((previous) => [...new Set([...previous, ...range])]);
          return;
        }
      }
      lastClicked.current = issueId;
      setSelectedIds((previous) =>
        previous.includes(issueId) ? previous.filter((id) => id !== issueId) : [...previous, issueId],
      );
    },
    [issues],
  );
  const bulkUpdate = useBulkUpdate(workspaceId);

  const chosenPeople = chosen.assigneeId ?? [];
  const togglePerson = (id: string) =>
    setBarFilters({
      ...barFilters,
      assigneeId: chosenPeople.includes(id) ? chosenPeople.filter((other) => other !== id) : [...chosenPeople, id],
    });

  const choices = departments.length + (canSeeEveryone ? 1 : 0);

  return (
    <>
      <Topbar breadcrumbs={[{ label: everyone ? 'Все задачи' : 'Задачи отдела' }]} />

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-16" />
          <Skeleton className="h-40" />
        </div>
      ) : !everyone && !department ? (
        <div className="min-h-0 flex-1 overflow-y-auto bg-bg">
          <EmptyState
            title="Вы не руководите ни одним отделом"
            description="Здесь руководитель видит задачи своих сотрудников. Состав отделов ведёт администратор пространства."
          />
        </div>
      ) : (
        <>
          <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b-2 border-border-strong bg-surface px-3 py-3 sm:px-4">
            <div className="min-w-0 flex-1 basis-56">
              <p className="fd-eyebrow">{everyone ? 'Задачи пространства' : 'Задачи отдела'}</p>
              <h1 className="truncate text-lg leading-tight font-bold">{everyone ? 'Все сотрудники' : department!.name}</h1>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
                {everyone ? (
                  'Все задачи пространства и кто за них отвечает, включая задачи без исполнителя'
                ) : department!.lead ? (
                  <>
                    <Avatar user={department!.lead} size="xs" />
                    Руководитель: {department!.lead.id === user?.id ? 'вы' : department!.lead.name}
                  </>
                ) : (
                  'Руководитель не назначен'
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {choices > 1 && (
                <Menu>
                  <MenuTrigger>
                    <Button size="sm" variant="secondary" iconRight={<ChevronDown className="size-3.5" />}>
                      Выбрать отдел
                    </Button>
                  </MenuTrigger>
                  <MenuContent align="end" width={240} label="Выбрать отдел">
                    {canSeeEveryone && (
                      <>
                        <MenuItem selected={everyone} onSelect={() => chooseDepartment(EVERYONE)}>
                          Все сотрудники
                        </MenuItem>
                        {departments.length > 0 && <MenuSeparator />}
                      </>
                    )}
                    {departments.length > 0 && <MenuLabel>Отделы</MenuLabel>}
                    {departments.map((item) => (
                      <MenuItem
                        key={item.id}
                        selected={!everyone && item.id === department?.id}
                        onSelect={() => chooseDepartment(item.id)}
                      >
                        {item.name}
                      </MenuItem>
                    ))}
                  </MenuContent>
                </Menu>
              )}
              {data?.canManage && (
                <Link to="/settings/workspace?section=departments" className="inline-flex">
                  <Button size="sm" variant="ghost" iconLeft={<Settings className="size-3.5" />}>
                    {departments.length === 0 ? 'Создать отдел' : 'Состав'}
                  </Button>
                </Link>
              )}
            </div>
          </header>

          {everyone && !workspaceMembers ? (
            // The people of the workspace are still on their way: not «nobody here».
            <SkeletonRows rows={8} />
          ) : members.length === 0 ? (
            <div className="min-h-0 flex-1 overflow-y-auto bg-bg">
              <EmptyState
                title="В отделе пока никого нет"
                description="Задачи появятся, когда администратор добавит в отдел сотрудников."
              />
            </div>
          ) : (
            <>
              {/* Each person with what they carry; a click narrows the list below to them.
                  Capped in height: a large department must not push the task list off the screen. */}
              <ul
                className="grid max-h-[38vh] shrink-0 grid-cols-1 gap-2 overflow-y-auto border-b-2 border-border-strong bg-bg-subtle p-3 scrollbar-thin sm:grid-cols-2 xl:grid-cols-3"
                aria-label={everyone ? 'Сотрудники пространства' : 'Сотрудники отдела'}
              >
                {members.map((member) => {
                  const figures = stats?.get(member.id);
                  const active = chosenPeople.includes(member.id);
                  return (
                    <li
                      key={member.id}
                      className={clsx(
                        'flex items-center gap-2 border-2 bg-surface p-2 shadow-xs',
                        active ? 'border-accent' : 'border-border-strong',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => togglePerson(member.id)}
                        aria-pressed={active}
                        title={active ? 'Показать задачи всех' : 'Показать только задачи этого сотрудника'}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <Avatar user={member} size="md" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold">{member.name}</span>
                          <span className="fd-num flex flex-wrap gap-x-2 text-2xs text-text-subtle">
                            <span>активных {figures?.active ?? '—'}</span>
                            <span className={figures?.overdue ? 'font-bold text-danger' : undefined}>
                              просрочено {figures?.overdue ?? '—'}
                            </span>
                            <span>на 7 дней {figures?.dueSoon ?? '—'}</span>
                          </span>
                        </span>
                      </button>
                      <Link
                        to={`/employee-work?user=${member.id}`}
                        className="shrink-0 text-2xs font-bold text-accent hover:underline"
                        aria-label={`Все задачи: ${member.name}`}
                      >
                        Все задачи
                      </Link>
                    </li>
                  );
                })}

                {/* Work nobody answers for is the first thing a lead looks for in the whole picture. */}
                {everyone && (
                  <li
                    className={clsx(
                      'flex items-center gap-2 border-2 bg-surface p-2 shadow-xs',
                      chosenPeople.includes('none') ? 'border-accent' : 'border-border-strong',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => togglePerson('none')}
                      aria-pressed={chosenPeople.includes('none')}
                      title="Показать только задачи без исполнителя"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <Avatar user={null} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">Без исполнителя</span>
                        <span className={clsx('fd-num text-2xs', unassigned ? 'font-bold text-danger' : 'text-text-subtle')}>
                          активных {unassigned ?? '—'}
                        </span>
                      </span>
                    </button>
                    <Link to="/planning" className="shrink-0 text-2xs font-bold text-accent hover:underline">
                      Распределить
                    </Link>
                  </li>
                )}
              </ul>

              <FilterBar
                filters={chosen}
                onChange={setBarFilters}
                currentUserId={user?.id ?? ''}
                members={members}
                // A department is a fixed circle of people; everyone is everyone, «без исполнителя» included.
                onlyListedMembers={!everyone}
                projects={projects ?? []}
                stateFacet
                dueRange
                hideDoneOption={false}
                sortOptions={false}
              />

              <div className="min-h-0 flex-1 overflow-auto bg-surface scrollbar-thin">
                <div
                  className="pb-20 sm:min-w-[var(--list-min)] xl:min-w-[var(--list-min-xl)]"
                  style={listMinStyle(COLUMNS, true)}
                >
                  {query.error ? (
                    <ErrorState error={query.error} onRetry={() => void query.refetch()} />
                  ) : query.isLoading ? (
                    <SkeletonRows rows={10} />
                  ) : issues.length === 0 ? (
                    <EmptyState
                      title="Задач нет"
                      description={
                        everyone
                          ? 'В доступных вам проектах нет открытых задач — или их скрыли фильтры.'
                          : 'На сотрудниках отдела нет открытых задач в доступных вам проектах — или их скрыли фильтры.'
                      }
                    />
                  ) : (
                    <>
                      <IssueRowHeader columns={COLUMNS} />
                      {issues.map((issue) => (
                        <IssueRow
                          key={issue.id}
                          issue={issue}
                          columns={COLUMNS}
                          selected={selected.includes(issue.id)}
                          onToggleSelect={(event) => toggleSelect(issue.id, event)}
                          onOpen={() => openIssue(issue.id)}
                        />
                      ))}
                    </>
                  )}

                  {issues.length > 0 && (
                    <div className="flex flex-wrap items-center justify-center gap-3 p-3">
                      <span className="fd-num text-2xs text-text-subtle">
                        Загружено {pluralize(issues.length, ['задача', 'задачи', 'задач'])}
                      </span>
                      {query.hasNextPage && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={query.isFetchingNextPage}
                          onClick={() => void query.fetchNextPage()}
                        >
                          Загрузить ещё
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Handing a task to a colleague. The server decides whether the
                  viewer may: leading a department is not a right to change
                  tasks, and a refusal says so. */}
              <BulkActionBar
                count={selected.length}
                members={assignable}
                onClear={() => setSelectedIds([])}
                onApply={(patch) =>
                  bulkUpdate.mutate({ issueIds: selected, patch }, { onSuccess: () => setSelectedIds([]) })
                }
                pending={bulkUpdate.isPending}
              />
            </>
          )}
        </>
      )}
    </>
  );
}
