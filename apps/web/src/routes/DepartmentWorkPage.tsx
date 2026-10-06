import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { ChevronDown, Settings } from 'lucide-react';
import { useSession } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import { useProjects } from '~/features/projects/hooks';
import { useDepartmentIssues, useDepartmentStats, useDepartments } from '~/features/departments/hooks';
import { flattenPages, useBulkUpdate } from '~/features/issues/hooks';
import { useFilterState } from '~/features/issues/useFilterState';
import type { IssueFilters } from '~/features/issues/types';
import { Topbar } from '~/components/Topbar';
import { FilterBar } from '~/components/FilterBar';
import { BulkActionBar } from '~/components/BulkActionBar';
import { IssueRow, IssueRowHeader, listMinWidth, type ListColumn } from '~/components/IssueRow';
import { Avatar } from '~/ui/Avatar';
import { Button } from '~/ui/Button';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from '~/ui/Menu';
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '~/ui/Feedback';
import { pluralize } from '~/lib/format';

const COLUMNS: ListColumn[] = ['status', 'priority', 'project', 'dueDate', 'assignee'];

/**
 * A department through its lead's eyes: who is in it, how much each person
 * carries, and their tasks in one list.
 *
 * Who is in the department comes from the register an administrator keeps.
 * What is shown of their work is whatever the viewer could open anyway — the
 * department is a way to gather tasks, not a key to projects.
 */
export function DepartmentWorkPage() {
  const { user, workspace } = useSession();
  const openIssue = useUiStore((s) => s.openIssue);
  const workspaceId = workspace?.id ?? '';

  const [searchParams, setSearchParams] = useSearchParams();
  const { data, isLoading, error, refetch } = useDepartments(workspaceId);
  const { data: projects } = useProjects(workspaceId);
  const departments = data?.items ?? [];
  const department = departments.find((item) => item.id === searchParams.get('department')) ?? departments[0];

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
      sort: 'dueDate',
      order: 'asc',
    }),
    [chosen],
  );

  const members = department?.members ?? [];
  const query = useDepartmentIssues(members.length ? department?.id : undefined, listFilters);
  const { data: stats } = useDepartmentStats(members.length ? department?.id : undefined, statsFilters);
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

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'Задачи отдела' }]} />

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-16" />
          <Skeleton className="h-40" />
        </div>
      ) : !department ? (
        <div className="min-h-0 flex-1 overflow-y-auto bg-bg">
          <EmptyState
            title={data?.canManage ? 'Отделов пока нет' : 'Вы не руководите ни одним отделом'}
            description={
              data?.canManage
                ? 'Создайте отдел в настройках пространства: назовите его, назначьте руководителя и добавьте сотрудников.'
                : 'Здесь руководитель видит задачи своих сотрудников. Состав отделов ведёт администратор пространства.'
            }
            action={
              data?.canManage ? (
                <Link to="/settings/workspace?section=departments">
                  <Button size="sm" variant="primary">
                    Открыть настройки отделов
                  </Button>
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b-2 border-border-strong bg-surface px-3 py-3 sm:px-4">
            <div className="min-w-0 flex-1 basis-56">
              <p className="fd-eyebrow">Задачи отдела</p>
              <h1 className="truncate text-lg leading-tight font-bold">{department.name}</h1>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
                {department.lead ? (
                  <>
                    <Avatar user={department.lead} size="xs" />
                    Руководитель: {department.lead.id === user?.id ? 'вы' : department.lead.name}
                  </>
                ) : (
                  'Руководитель не назначен'
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {departments.length > 1 && (
                <Menu>
                  <MenuTrigger>
                    <Button size="sm" variant="secondary" iconRight={<ChevronDown className="size-3.5" />}>
                      Другой отдел
                    </Button>
                  </MenuTrigger>
                  <MenuContent align="end" width={240} label="Выбрать отдел">
                    <MenuLabel>Отделы</MenuLabel>
                    {departments.map((item) => (
                      <MenuItem key={item.id} selected={item.id === department.id} onSelect={() => chooseDepartment(item.id)}>
                        {item.name}
                      </MenuItem>
                    ))}
                  </MenuContent>
                </Menu>
              )}
              {data?.canManage && (
                <Link to="/settings/workspace?section=departments" className="inline-flex">
                  <Button size="sm" variant="ghost" iconLeft={<Settings className="size-3.5" />}>
                    Состав
                  </Button>
                </Link>
              )}
            </div>
          </header>

          {members.length === 0 ? (
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
                aria-label="Сотрудники отдела"
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
                        title={active ? 'Показать задачи всего отдела' : 'Показать только задачи этого сотрудника'}
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
              </ul>

              <FilterBar
                filters={chosen}
                onChange={setBarFilters}
                currentUserId={user?.id ?? ''}
                members={members}
                onlyListedMembers
                projects={projects ?? []}
                stateFacet
                dueRange
                hideDoneOption={false}
                sortOptions={false}
              />

              <div className="min-h-0 flex-1 overflow-auto bg-surface scrollbar-thin">
                <div
                  className="pb-20 sm:min-w-[var(--list-min)]"
                  style={{ '--list-min': `${listMinWidth(COLUMNS, true)}px` } as React.CSSProperties}
                >
                  {query.error ? (
                    <ErrorState error={query.error} onRetry={() => void query.refetch()} />
                  ) : query.isLoading ? (
                    <SkeletonRows rows={10} />
                  ) : issues.length === 0 ? (
                    <EmptyState
                      title="Задач нет"
                      description="На сотрудниках отдела нет открытых задач в доступных вам проектах — или их скрыли фильтры."
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

              {/* Handing a task to a colleague in the department. The server
                  decides whether the viewer may: leading a department is not a
                  right to change tasks, and a refusal says so. */}
              <BulkActionBar
                count={selected.length}
                members={members}
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
