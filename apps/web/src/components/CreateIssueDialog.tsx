import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CreateIssueInput, IssuePriority, IssueType } from '@flowdesk/contracts';
import { EMPTY_DOC, isDocEmpty } from '@flowdesk/contracts';
import { ChevronDown, CornerDownLeft, FolderPlus } from 'lucide-react';
import { useSession } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import { useToast } from '~/app/toast';
import { useProject, useProjects } from '~/features/projects/hooks';
import { useSprints } from '~/features/sprints/hooks';
import { useCreateIssue, useIssueList } from '~/features/issues/hooks';
import { Dialog } from '~/ui/Dialog';
import { Button } from '~/ui/Button';
import { Input } from '~/ui/Input';
import { Checkbox } from '~/ui/Input';
import { Kbd } from '~/ui/Tooltip';
import { Avatar } from '~/ui/Avatar';
import { RichTextEditor } from './RichText';
import { LabelPicker, PriorityPicker, StatusPicker, TypePicker, UserPicker, DateField } from './Pickers';
import { IssueTypeIcon, LabelChip, PriorityIcon, PRIORITY_META, StatusDot, ISSUE_TYPE_META } from './IssueMeta';

/**
 * Quick-create. Optimised for the common path: type a title, hit Enter.
 * Everything else is optional and reachable without leaving the keyboard.
 */
export function CreateIssueDialog() {
  const open = useUiStore((s) => s.createIssueOpen);
  const defaults = useUiStore((s) => s.createIssueDefaults);
  const close = useUiStore((s) => s.closeCreateIssue);
  const openIssue = useUiStore((s) => s.openIssue);
  const { workspace } = useSession();
  const toast = useToast();
  const navigate = useNavigate();

  const { data: projects } = useProjects(workspace?.id ?? '');
  const [projectId, setProjectId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState<unknown>(EMPTY_DOC);
  const [type, setType] = useState<IssueType>('TASK');
  const [priority, setPriority] = useState<IssuePriority>('MEDIUM');
  const [statusId, setStatusId] = useState<string | undefined>();
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [sprintId, setSprintId] = useState<string | null>(null);
  const [epicId, setEpicId] = useState<string | null>(null);
  const [storyPoints, setStoryPoints] = useState<string>('');
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [createAnother, setCreateAnother] = useState(false);

  const { data: project } = useProject(projectId || undefined);
  const { data: sprints } = useSprints(project?.projectType === 'SCRUM' ? projectId : undefined);
  const { data: epicPages } = useIssueList(
    { projectId: projectId || undefined },
    { type: ['EPIC'], includeDone: true },
    { enabled: Boolean(projectId) },
  );
  const epics = useMemo(() => epicPages?.pages.flatMap((p) => p.items) ?? [], [epicPages]);

  const createIssue = useCreateIssue();

  // Latest values without making them effect dependencies — a background
  // refetch of `projects` must never wipe what the user is typing.
  const latest = useRef({ defaults, projects });
  latest.current = { defaults, projects };

  // Seed the form once, on the transition from closed to open.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;

    const { defaults: seed, projects: list } = latest.current;
    setProjectId(seed?.projectId ?? list?.[0]?.id ?? '');
    setStatusId(seed?.statusId);
    setSprintId(seed?.sprintId ?? null);
    setEpicId(seed?.epicId ?? null);
    setTitle('');
    setDescription(EMPTY_DOC);
    setType(seed?.parentId ? 'SUBTASK' : 'TASK');
    setPriority('MEDIUM');
    setAssigneeId(null);
    setLabelIds([]);
    setStoryPoints('');
    setDueDate(null);
  }, [open]);

  // Switching project invalidates project-scoped selections, but only when the
  // user actually changes it — not while the dialog is being seeded.
  const seededProject = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !projectId) return;
    if (seededProject.current === null) {
      seededProject.current = projectId;
      return;
    }
    if (seededProject.current === projectId) return;
    seededProject.current = projectId;
    setStatusId(undefined);
    setLabelIds([]);
    setEpicId(null);
    setSprintId(null);
  }, [open, projectId]);

  // Forget the seeded project once the dialog closes.
  useEffect(() => {
    if (!open) seededProject.current = null;
  }, [open]);

  // The dialog can open before the project list has loaded — from the global
  // shortcut right after a project is created, for instance. The native select
  // would then display the first option while the state stayed empty, leaving
  // the form permanently unsubmittable, so adopt the first project when it
  // arrives and nothing has been chosen yet.
  useEffect(() => {
    if (!open || projectId) return;
    const first = projects?.[0]?.id;
    if (first) setProjectId(first);
  }, [open, projectId, projects]);

  const members = project?.assignees ?? [];
  const statuses = project?.statuses ?? [];
  const selectedStatus = statuses.find((s) => s.id === statusId) ?? statuses[0];
  const canSubmit = title.trim().length > 0 && Boolean(projectId) && !createIssue.isPending;

  const submit = async (openAfter: boolean) => {
    if (!canSubmit) return;

    const input: CreateIssueInput = {
      projectId,
      title: title.trim(),
      type,
      priority,
      ...(statusId ? { statusId } : {}),
      ...(assigneeId ? { assigneeId } : {}),
      ...(labelIds.length ? { labelIds } : {}),
      ...(sprintId ? { sprintId } : {}),
      ...(epicId ? { epicId } : {}),
      ...(defaults?.parentId ? { parentId: defaults.parentId } : {}),
      ...(storyPoints ? { storyPoints: Number(storyPoints) } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(isDocEmpty(description) ? {} : { description: description as Record<string, unknown> }),
    };

    try {
      const issue = await createIssue.mutateAsync(input);
      toast.toast({
        tone: 'success',
        title: `${issue.issueKey} создана`,
        description: issue.title,
        action: { label: 'Открыть', onClick: () => openIssue(issue.id) },
      });

      if (createAnother && !openAfter) {
        setTitle('');
        setDescription(EMPTY_DOC);
        return;
      }
      close();
      if (openAfter) openIssue(issue.id);
    } catch {
      /* the mutation's onError already surfaced a toast */
    }
  };

  if (!projects) return null;

  // Tasks live in projects. With none yet, the form had nothing to offer: an
  // empty project dropdown, nobody to assign, and a Create button that could
  // never enable. Say why and point at the one step that unblocks it.
  if (projects.length === 0) {
    return (
      <Dialog
        open={open}
        onClose={close}
        title="Новая задача"
        footer={
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={close}>
              Закрыть
            </Button>
            <Button
              size="sm"
              variant="primary"
              iconLeft={<FolderPlus className="size-3.5" />}
              onClick={() => {
                close();
                navigate('/projects/new');
              }}
            >
              Создать проект
            </Button>
          </div>
        }
      >
        <p className="text-sm text-text-muted">
          Задачи создаются внутри проекта, а в пространстве пока нет ни одного. Создайте первый — доска,
          список и участники появятся сразу, и сюда можно будет вернуться.
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Новая задача"
      size="lg"
      footer={
        <div className="flex w-full items-center gap-3">
          <Checkbox
            checked={createAnother}
            onChange={(event) => setCreateAnother(event.target.checked)}
            label={<span className="text-xs text-text-muted">Создать ещё</span>}
          />
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={close}>
              Отмена
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!canSubmit}
              onClick={() => void submit(true)}
            >
              Создать и открыть
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={createIssue.isPending}
              disabled={!canSubmit}
              onClick={() => void submit(false)}
              iconRight={<Kbd className="border-white/30 bg-white/10 text-white/80">↵</Kbd>}
            >
              Создать
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {/* Project + type */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            aria-label="Проект"
            className="h-7 rounded-md border-2 border-border-strong bg-surface px-2 text-sm hover:bg-surface-hover hover:shadow-xs focus:border-accent focus:outline-none"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.icon} {p.name}
              </option>
            ))}
          </select>

          <TypePicker value={type} onChange={setType}>
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border-2 border-border-strong bg-surface px-2 text-sm hover:bg-surface-hover hover:shadow-xs"
            >
              <IssueTypeIcon type={type} withTooltip={false} className="size-3.5" />
              {ISSUE_TYPE_META[type].label}
              <ChevronDown className="size-3 text-text-subtle" />
            </button>
          </TypePicker>

          {selectedStatus && (
            <StatusPicker statuses={statuses} value={selectedStatus.id} onChange={setStatusId}>
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1.5 rounded-md border-2 border-border-strong bg-surface px-2 text-sm hover:bg-surface-hover hover:shadow-xs"
              >
                <StatusDot status={selectedStatus} className="size-3" />
                {selectedStatus.name}
                <ChevronDown className="size-3 text-text-subtle" />
              </button>
            </StatusPicker>
          )}
        </div>

        {/* Title */}
        <Input
          data-autofocus="true"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit(false);
            }
          }}
          placeholder="Название задачи"
          inputSize="lg"
          aria-label="Название задачи"
          className="font-bold"
          maxLength={300}
        />

        {/* Description */}
        <RichTextEditor
          value={description}
          onChange={setDescription}
          users={members}
          placeholder="Описание… (введите @, чтобы упомянуть)"
          minHeight="6rem"
        />

        {/* Secondary fields */}
        <div className="flex flex-wrap items-center gap-1.5 border-t-2 border-border-strong pt-3">
          <PriorityPicker value={priority} onChange={setPriority}>
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border-2 border-border-strong bg-surface px-2 text-xs hover:bg-surface-hover hover:shadow-xs"
            >
              <PriorityIcon priority={priority} withTooltip={false} className="size-3.5" />
              {PRIORITY_META[priority].label}
            </button>
          </PriorityPicker>

          <UserPicker users={members} value={assigneeId} onChange={setAssigneeId}>
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border-2 border-border-strong bg-surface px-2 text-xs hover:bg-surface-hover hover:shadow-xs"
            >
              <Avatar user={members.find((m) => m.id === assigneeId) ?? null} size="sm" />
              {members.find((m) => m.id === assigneeId)?.name ?? 'Исполнитель'}
            </button>
          </UserPicker>

          <LabelPicker labels={project?.labels ?? []} value={labelIds} onChange={setLabelIds}>
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border-2 border-border-strong bg-surface px-2 text-xs hover:bg-surface-hover hover:shadow-xs"
            >
              {labelIds.length === 0 ? (
                'Метки'
              ) : (
                <span className="flex items-center gap-1">
                  {project?.labels
                    .filter((l) => labelIds.includes(l.id))
                    .slice(0, 2)
                    .map((label) => (
                      <LabelChip key={label.id} label={label} size="sm" />
                    ))}
                  {labelIds.length > 2 && <span className="text-text-subtle">+{labelIds.length - 2}</span>}
                </span>
              )}
            </button>
          </LabelPicker>

          {sprints && sprints.length > 0 && (
            <select
              value={sprintId ?? ''}
              onChange={(event) => setSprintId(event.target.value || null)}
              aria-label="Спринт"
              className="h-7 rounded-md border-2 border-border-strong bg-surface px-2 text-xs hover:bg-surface-hover hover:shadow-xs focus:border-accent focus:outline-none"
            >
              <option value="">Бэклог</option>
              {sprints
                .filter((s) => s.status !== 'COMPLETED')
                .map((sprint) => (
                  <option key={sprint.id} value={sprint.id}>
                    {sprint.name}
                  </option>
                ))}
            </select>
          )}

          {epics.length > 0 && type !== 'EPIC' && (
            <select
              value={epicId ?? ''}
              onChange={(event) => setEpicId(event.target.value || null)}
              aria-label="Эпик"
              className="h-7 max-w-40 rounded-md border-2 border-border-strong bg-surface px-2 text-xs hover:bg-surface-hover hover:shadow-xs focus:border-accent focus:outline-none"
            >
              <option value="">Без эпика</option>
              {epics.map((epic) => (
                <option key={epic.id} value={epic.id}>
                  {epic.title}
                </option>
              ))}
            </select>
          )}

          <input
            type="number"
            min={0}
            max={100}
            value={storyPoints}
            onChange={(event) => setStoryPoints(event.target.value)}
            placeholder="Оценка"
            aria-label="Оценка сложности в сторипоинтах"
            title="Оценка сложности в сторипоинтах: условные единицы, чтобы сравнивать задачи между собой. Необязательно."
            className="h-7 w-20 rounded-md border-2 border-border-strong bg-surface px-2 text-xs hover:bg-surface-hover hover:shadow-xs focus:border-accent focus:outline-none"
          />

          <div className="w-36">
            <DateField value={dueDate} onChange={setDueDate} />
          </div>
        </div>

        <p className="flex items-center gap-1.5 text-2xs text-text-subtle">
          <CornerDownLeft className="size-3" />
          Enter — создать, Shift+Enter — перенос строки в описании
        </p>
      </div>
    </Dialog>
  );
}
