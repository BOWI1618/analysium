import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { SprintDto } from '@flowdesk/contracts';
import { Permission } from '@flowdesk/contracts';
import { ChevronDown, ChevronRight, MoreHorizontal, Play, Plus, Square, Trash2 } from 'lucide-react';
import { useSession } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import { useProject } from '~/features/projects/hooks';
import {
  useCompleteSprint,
  useCreateSprint,
  useDeleteSprint,
  useSprints,
  useStartSprint,
} from '~/features/sprints/hooks';
import { useBulkUpdate, useIssueList, usePatchIssue, flattenPages } from '~/features/issues/hooks';
import { useFilterState } from '~/features/issues/useFilterState';
import type { IssueFilters } from '~/features/issues/types';
import { FilterBar } from '~/components/FilterBar';
import { IssueRow, DEFAULT_COLUMNS } from '~/components/IssueRow';
import { BulkActionBar } from '~/components/BulkActionBar';
import { Button } from '~/ui/Button';
import { Badge } from '~/ui/Badge';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '~/ui/Menu';
import { Dialog, ConfirmDialog, DialogCloseButton } from '~/ui/Dialog';
import { Input, Textarea, Select } from '~/ui/Input';
import { EmptyState, ErrorState, ProgressBar, SkeletonRows } from '~/ui/Feedback';
import { shortDate } from '~/lib/format';

/**
 * Scrum backlog: sprints stacked above an unscheduled backlog. Moving work
 * between them is a single click on any row, or a bulk action on a selection.
 */
export function BacklogPage() {
  const { projectId = '' } = useParams();
  const { user, workspace } = useSession();
  const openIssue = useUiStore((s) => s.openIssue);
  const openCreateIssue = useUiStore((s) => s.openCreateIssue);

  const [filters, setFilters] = useFilterState({ sort: 'rank', order: 'asc' });
  const [selected, setSelected] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [createSprintOpen, setCreateSprintOpen] = useState(false);
  const [completing, setCompleting] = useState<SprintDto | null>(null);
  const [deleting, setDeleting] = useState<SprintDto | null>(null);

  const { data: project } = useProject(projectId);
  const { data: sprints, isLoading: sprintsLoading } = useSprints(projectId);
  const createSprint = useCreateSprint(projectId);
  const deleteSprint = useDeleteSprint(projectId);
  const bulkUpdate = useBulkUpdate(workspace?.id ?? '');
  const patchIssue = usePatchIssue();

  // One query per sprint plus the backlog keeps each section independently
  // paginated instead of loading the whole project at once.
  const backlogQuery = useIssueList({ projectId }, { ...filters, noSprint: true, includeDone: false });
  const backlogIssues = useMemo(() => flattenPages(backlogQuery.data), [backlogQuery.data]);

  const canManageSprints = project?.permissions.includes(Permission.SPRINT_MANAGE) ?? false;
  const canEdit = project?.permissions.includes(Permission.ISSUE_UPDATE) ?? false;
  const openSprints = (sprints ?? []).filter((s) => s.status !== 'COMPLETED');

  if (backlogQuery.error) {
    return <ErrorState error={backlogQuery.error} onRetry={() => void backlogQuery.refetch()} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilterBar
        filters={filters}
        onChange={setFilters}
        statuses={project?.statuses}
        labels={project?.labels}
        members={project?.assignees}
        currentUserId={user?.id ?? ''}
        trailing={
          canManageSprints ? (
            <Button size="xs" variant="secondary" iconLeft={<Plus className="size-3" />} onClick={() => setCreateSprintOpen(true)}>
              Новый спринт
            </Button>
          ) : undefined
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {sprintsLoading ? (
          <SkeletonRows rows={8} />
        ) : (
          <>
            {openSprints.map((sprint) => (
              <SprintSection
                key={sprint.id}
                sprint={sprint}
                projectId={projectId}
                filters={filters}
                collapsed={collapsed[sprint.id] ?? false}
                onToggle={() =>
                  setCollapsed((prev) => ({ ...prev, [sprint.id]: !(prev[sprint.id] ?? false) }))
                }
                selected={selected}
                onToggleSelect={(id) =>
                  setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
                }
                onOpen={openIssue}
                canManage={canManageSprints}
                canEdit={canEdit}
                project={project}
                onCreate={() => openCreateIssue({ projectId, sprintId: sprint.id })}
                onComplete={() => setCompleting(sprint)}
                onDelete={() => setDeleting(sprint)}
              />
            ))}

            {/* Backlog — named «Без спринта», because «Бэклог» is also the
                default name of a status and the two read as one thing. */}
            <section className="border-b border-border">
              <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
                <h2 className="text-sm font-semibold">Без спринта</h2>
                <span className="fd-num text-2xs text-text-subtle">{backlogIssues.length}</span>
                {canEdit && (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="ml-auto"
                    iconLeft={<Plus className="size-3" />}
                    onClick={() => openCreateIssue({ projectId })}
                  >
                    Добавить задачу
                  </Button>
                )}
              </header>

              {backlogQuery.isLoading ? (
                <SkeletonRows rows={6} />
              ) : backlogIssues.length === 0 ? (
                <EmptyState
                  compact
                  title="Все задачи в спринтах"
description="Всё уже запланировано — или задач ещё нет."
                />
              ) : (
                <div className="bg-surface">
                  {backlogIssues.map((issue) => (
                    <IssueRow
                      key={issue.id}
                      issue={issue}
                      columns={DEFAULT_COLUMNS}
                      selected={selected.includes(issue.id)}
                      editable={canEdit}
                      statuses={project?.statuses ?? []}
                      members={project?.assignees ?? []}
                      onToggleSelect={() =>
                        setSelected((prev) =>
                          prev.includes(issue.id) ? prev.filter((x) => x !== issue.id) : [...prev, issue.id],
                        )
                      }
                      onOpen={() => openIssue(issue.id)}
                      onPatch={(patch) => patchIssue.mutate({ issueId: issue.id, patch })}
                    />
                  ))}
                </div>
              )}

              {backlogQuery.hasNextPage && (
                <div className="flex justify-center p-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={backlogQuery.isFetchingNextPage}
                    onClick={() => void backlogQuery.fetchNextPage()}
                  >
                    Показать ещё
                  </Button>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <BulkActionBar
        count={selected.length}
        statuses={project?.statuses ?? []}
        members={project?.assignees ?? []}
        onClear={() => setSelected([])}
        onApply={(patch) => bulkUpdate.mutate({ issueIds: selected, patch }, { onSuccess: () => setSelected([]) })}
        pending={bulkUpdate.isPending}
      />

      {/* Mounted only while open, so a closed dialog starts empty next time. */}
      <CreateSprintDialog
        key={createSprintOpen ? 'open' : 'closed'}
        open={createSprintOpen}
        onClose={() => setCreateSprintOpen(false)}
        onCreate={(input) => {
          createSprint.mutate(input, { onSuccess: () => setCreateSprintOpen(false) });
        }}
        pending={createSprint.isPending}
      />

      {/* Keying by sprint remounts the dialog, so a stale "move to" choice from
          the previous open never leaks into the next one. */}
      <CompleteSprintDialog
        key={completing?.id}
        sprint={completing}
        sprints={openSprints}
        projectId={projectId}
        onClose={() => setCompleting(null)}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) deleteSprint.mutate(deleting.id);
          setDeleting(null);
        }}
        title={`Удалить спринт «${deleting?.name}»?`}
message="Задачи спринта перейдут в «Без спринта». Ничего не потеряется."
        confirmLabel="Удалить спринт"
        danger
      />
    </div>
  );
}

/* --------------------------------------------------------------- section */

function SprintSection({
  sprint,
  projectId,
  filters,
  collapsed,
  onToggle,
  selected,
  onToggleSelect,
  onOpen,
  canManage,
  canEdit,
  project,
  onCreate,
  onComplete,
  onDelete,
}: {
  sprint: SprintDto;
  projectId: string;
  filters: IssueFilters;
  collapsed: boolean;
  onToggle: () => void;
  selected: string[];
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
  canManage: boolean;
  canEdit: boolean;
  project: ReturnType<typeof useProject>['data'];
  onCreate: () => void;
  onComplete: () => void;
  onDelete: () => void;
}) {
  const query = useIssueList(
    { projectId },
    { ...filters, sprintId: [sprint.id] },
    { enabled: !collapsed },
  );
  const issues = useMemo(() => flattenPages(query.data), [query.data]);
  const startSprint = useStartSprint(projectId);

  const isActive = sprint.status === 'ACTIVE';

  return (
    <section className="border-b border-border">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-surface-hover"
        >
          {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          <h2 className="text-sm font-semibold">{sprint.name}</h2>
        </button>

        {isActive && <Badge tone="success">Активный</Badge>}
        {sprint.status === 'PLANNED' && <Badge tone="neutral">Запланирован</Badge>}

        {sprint.startDate && sprint.endDate && (
          <span className="fd-num text-2xs text-text-subtle">
            {shortDate(sprint.startDate)} → {shortDate(sprint.endDate)}
          </span>
        )}

        <span className="fd-num text-2xs text-text-subtle">
          {sprint.completedIssueCount}/{sprint.issueCount} готово
        </span>

        {sprint.issueCount > 0 && (
          <ProgressBar
            value={sprint.completedIssueCount}
            max={sprint.issueCount}
            className="w-24"
            tone="success"
            label={`Выполнено ${sprint.completedIssueCount} из ${sprint.issueCount} задач`}
          />
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {canEdit && (
            <Button size="xs" variant="ghost" iconLeft={<Plus className="size-3" />} onClick={onCreate}>
              Добавить
            </Button>
          )}
          {canManage && sprint.status === 'PLANNED' && (
            <Button
              size="xs"
              variant="primary"
              loading={startSprint.isPending}
              iconLeft={<Play className="size-3" />}
              onClick={() => startSprint.mutate(sprint.id)}
            >
              Запустить спринт
            </Button>
          )}
          {canManage && isActive && (
            <Button size="xs" variant="secondary" iconLeft={<Square className="size-3" />} onClick={onComplete}>
              Завершить
            </Button>
          )}
          {canManage && (
            <Menu>
              <MenuTrigger>
                <button
                  type="button"
                  aria-label={`Действия со спринтом «${sprint.name}»`}
                  className="rounded-md p-1 text-text-subtle hover:bg-surface-hover hover:text-text"
                >
                  <MoreHorizontal className="size-3.5" />
                </button>
              </MenuTrigger>
              <MenuContent align="end" width={180} label="Действия со спринтом">
                <MenuItem onSelect={onCreate}>Добавить задачу</MenuItem>
                <MenuSeparator />
                <MenuItem
                  icon={<Trash2 className="size-3.5" />}
                  danger
                  disabled={isActive}
                  onSelect={onDelete}
                >
                  Удалить спринт
                </MenuItem>
              </MenuContent>
            </Menu>
          )}
        </div>

        {sprint.goal && (
          <p className="w-full text-xs text-text-muted">
            <span className="font-medium">Цель:</span> {sprint.goal}
          </p>
        )}
      </header>

      {!collapsed && (
        <div className="bg-surface">
          {query.isLoading ? (
            <SkeletonRows rows={4} />
          ) : issues.length === 0 ? (
            <EmptyState
              compact
              title="В спринте нет задач"
description="Перетащите задачи из «Без спринта» или добавьте новую."
            />
          ) : (
            issues.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                columns={DEFAULT_COLUMNS}
                selected={selected.includes(issue.id)}
                editable={canEdit}
                statuses={project?.statuses ?? []}
                members={project?.assignees ?? []}
                onToggleSelect={() => onToggleSelect(issue.id)}
                onOpen={() => onOpen(issue.id)}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- dialogs */

function CreateSprintDialog({
  open,
  onClose,
  onCreate,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; goal?: string | null; startDate?: string | null; endDate?: string | null }) => void;
  pending: boolean;
}) {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dirty={Boolean(name.trim() || goal.trim() || start || end)}
      title="Новый спринт"
      description="Дайте имя и цель, по которой команда сверится в конце."
      size="sm"
      footer={
        <>
          <DialogCloseButton size="sm" variant="ghost">
            Отмена
          </DialogCloseButton>
          <Button
            size="sm"
            variant="primary"
            loading={pending}
            disabled={!name.trim()}
            onClick={() =>
              onCreate({
                name: name.trim(),
                goal: goal.trim() || null,
                startDate: start ? new Date(`${start}T09:00:00.000Z`).toISOString() : null,
                endDate: end ? new Date(`${end}T17:00:00.000Z`).toISOString() : null,
              })
            }
          >
            Создать спринт
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Название"
          data-autofocus="true"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Спринт 14"
        />
        <Textarea
          label="Цель"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
placeholder="Как выглядит успех в конце этого спринта?"
          rows={2}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Начало" type="date" value={start} onChange={(event) => setStart(event.target.value)} />
          <Input label="Окончание" type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
        </div>
      </div>
    </Dialog>
  );
}

function CompleteSprintDialog({
  sprint,
  sprints,
  projectId,
  onClose,
}: {
  sprint: SprintDto | null;
  sprints: SprintDto[];
  projectId: string;
  onClose: () => void;
}) {
  const completeSprint = useCompleteSprint(projectId);
  const [target, setTarget] = useState('backlog');

  if (!sprint) return null;
  const unfinished = sprint.issueCount - sprint.completedIssueCount;
  const others = sprints.filter((s) => s.id !== sprint.id);

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Завершить спринт «${sprint.name}»?`}
      size="sm"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={completeSprint.isPending}
            onClick={() =>
              completeSprint.mutate(
                { sprintId: sprint.id, moveUnfinishedTo: target },
                { onSuccess: onClose },
              )
            }
          >
            Завершить спринт
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-text-muted">
          Готово {sprint.completedIssueCount} из {sprint.issueCount} задач
          {unfinished > 0
            ? `. Незавершённых: ${unfinished} — им нужно новое место.`
            : '.'}
        </p>

        {unfinished > 0 && (
          <Select
            label="Перенести незавершённые в"
            value={target}
            onChange={(event) => setTarget((event.target as HTMLSelectElement).value)}
          >
            <option value="backlog">Без спринта</option>
            {others.map((other) => (
              <option key={other.id} value={other.id}>
                {other.name}
              </option>
            ))}
          </Select>
        )}
      </div>
    </Dialog>
  );
}
