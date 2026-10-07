import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useQueryClient } from '@tanstack/react-query';
import type { AttachmentDto, CreateIssueRequest, IssuePriority, IssueRecurrence, IssueType } from '@flowdesk/contracts';
import { EMPTY_DOC, ISSUE_RECURRENCES, isDocEmpty } from '@flowdesk/contracts';
import { ChevronDown, CornerDownLeft, Eye, History } from 'lucide-react';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { useSession } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import { useToast } from '~/app/toast';
import {
  nextLabelColor,
  useCreateLabel,
  useCreateProjectlessLabel,
  useProject,
  useProjects,
} from '~/features/projects/hooks';
import { useMembers } from '~/features/members/hooks';
import { useSprints } from '~/features/sprints/hooks';
import { useCreateIssue, useIssueList } from '~/features/issues/hooks';
import { clearIssueDraft, readIssueDraft, writeIssueDraft, type IssueDraft } from '~/features/issues/createDraft';
import { RECURRENCE_LABEL } from '~/lib/labels';
import { Dialog, DialogCloseButton } from '~/ui/Dialog';
import { Button } from '~/ui/Button';
import { Input } from '~/ui/Input';
import { Checkbox } from '~/ui/Input';
import { Kbd } from '~/ui/Tooltip';
import { Avatar } from '~/ui/Avatar';
import { RichTextEditor, replaceImageSources } from './RichText';
import {
  LabelPicker,
  MultiSelect,
  PriorityPicker,
  ProjectPicker,
  StatusPicker,
  TypePicker,
  UserPicker,
  DateField,
} from './Pickers';
import { ProjectIcon } from '~/ui/ProjectIcon';
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
  const { workspace, user } = useSession();
  const toast = useToast();

  const { data: projects } = useProjects(workspace?.id ?? '', false, { includeSystem: true });
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
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [dueHasTime, setDueHasTime] = useState(false);
  const [watcherIds, setWatcherIds] = useState<string[]>([]);
  // «Все поля»: what most tasks do without, one click away rather than only
  // in the task's card after it is created.
  const [startDate, setStartDate] = useState<string | null>(null);
  const [startHasTime, setStartHasTime] = useState(false);
  const [storyPoints, setStoryPoints] = useState<number | null>(null);
  const [recurrence, setRecurrence] = useState<IssueRecurrence | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [createAnother, setCreateAnother] = useState(false);
  /** When the draft now in the form was last saved; `null` for a form started from scratch. */
  const [restoredAt, setRestoredAt] = useState<number | null>(null);

  // An empty choice means "without a project". Such tasks live in the
  // workspace's list of tasks without a project; once that list exists its
  // statuses and labels are offered like any project's. Until the first such
  // task creates it, there is nothing project-scoped to pick yet.
  const regularProjects = useMemo(() => (projects ?? []).filter((p) => !p.isSystem), [projects]);
  const selectedProject = regularProjects.find((p) => p.id === projectId);
  const systemProjectId = projects?.find((p) => p.isSystem)?.id;
  const effectiveProjectId = projectId || systemProjectId || '';

  const { data: project } = useProject(effectiveProjectId || undefined);
  const { data: workspaceMembers } = useMembers(workspace?.id);
  const { data: sprints } = useSprints(project?.projectType === 'SCRUM' ? effectiveProjectId : undefined);
  const { data: epicPages } = useIssueList(
    { projectId: effectiveProjectId || undefined },
    { type: ['EPIC'], includeDone: true },
    { enabled: Boolean(effectiveProjectId) },
  );
  const epics = useMemo(() => epicPages?.pages.flatMap((p) => p.items) ?? [], [epicPages]);

  const createIssue = useCreateIssue();
  const queryClient = useQueryClient();
  const createLabel = useCreateLabel(effectiveProjectId);

  // Pictures pasted before the task exists have nowhere to be stored yet: they
  // are shown from memory and uploaded to the task the moment it is created.
  const heldImages = useRef(new Map<string, File>());
  const holdImage = async (file: File) => {
    const url = URL.createObjectURL(file);
    heldImages.current.set(url, file);
    return url;
  };
  const releaseImages = () => {
    for (const url of heldImages.current.keys()) URL.revokeObjectURL(url);
    heldImages.current.clear();
  };

  /** Uploads the held pictures still in the text and points the description at them. */
  const attachHeldImages = async (issueId: string, doc: unknown) => {
    const text = JSON.stringify(doc);
    const used = [...heldImages.current].filter(([url]) => text.includes(url));
    if (used.length === 0) return;
    const uploaded = new Map<string, string>();
    for (const [url, file] of used) {
      const form = new FormData();
      form.append('file', file);
      try {
        uploaded.set(url, (await api.upload<AttachmentDto>(`/issues/${issueId}/attachments`, form)).url);
      } catch {
        /* reported below, together with the rest */
      }
    }
    if (uploaded.size > 0) {
      await api.patch(`/issues/${issueId}`, { description: replaceImageSources(doc, uploaded) });
      void queryClient.invalidateQueries({ queryKey: qk.issue(issueId) });
    }
    if (uploaded.size < used.length) {
      toast.toast({
        tone: 'error',
        title: 'Не все картинки загрузились',
        description: 'Задача создана — добавьте недостающие картинки в неё ещё раз.',
      });
    }
  };
  const createProjectlessLabel = useCreateProjectlessLabel(workspace?.id ?? '');

  // Latest values without making them effect dependencies — a background
  // refetch of `projects` must never wipe what the user is typing.
  const draftOwner = user && workspace ? { userId: user.id, workspaceId: workspace.id } : null;
  const latest = useRef({ defaults, projects, draftOwner });
  latest.current = { defaults, projects, draftOwner };

  // Whether the draft in the browser is this form's own: restored into it or
  // written by it. A draft the form did not take — it belongs to a subtask of
  // another task — is left alone.
  const ownsDraft = useRef(false);
  // The first pass of the saving effect after opening still sees the fields
  // of the previous opening; it must neither save nor erase anything.
  const settled = useRef(false);

  /** The form as it opens from where it was called, with nothing typed. */
  const seedForm = () => {
    const { defaults: seed, projects: list } = latest.current;
    // From a project page the task belongs there; from anywhere else it starts
    // without a project, and a project can be picked if wanted.
    setProjectId(seed?.projectId && list?.some((p) => p.id === seed.projectId && !p.isSystem) ? seed.projectId : '');
    setStatusId(seed?.statusId);
    setSprintId(seed?.sprintId ?? null);
    setEpicId(seed?.epicId ?? null);
    setTitle('');
    setDescription(EMPTY_DOC);
    releaseImages();
    setType(seed?.parentId ? 'SUBTASK' : 'TASK');
    setPriority('MEDIUM');
    setAssigneeId(null);
    setLabelIds([]);
    setWatcherIds([]);
    setDueDate(seed?.dueDate ?? null);
    setDueHasTime(seed?.dueHasTime ?? false);
    setStartDate(seed?.startDate ?? null);
    setStartHasTime(seed?.startHasTime ?? false);
    setStoryPoints(null);
    setRecurrence(null);
    // A start that came with the form (an hour slot of the calendar) is shown, not hidden.
    setMoreOpen(Boolean(seed?.startDate));
    setRestoredAt(null);
  };

  const restoreDraft = (draft: IssueDraft) => {
    const { projects: list } = latest.current;
    // The project may have been archived or closed to this person since.
    setProjectId(list?.some((p) => p.id === draft.projectId && !p.isSystem) ? draft.projectId : '');
    setStatusId(draft.statusId);
    setSprintId(draft.sprintId);
    setEpicId(draft.epicId);
    setTitle(draft.title);
    setDescription(draft.description ?? EMPTY_DOC);
    setType(draft.type);
    setPriority(draft.priority);
    setAssigneeId(draft.assigneeId);
    setLabelIds(draft.labelIds ?? []);
    setWatcherIds(draft.watcherIds ?? []);
    setDueDate(draft.dueDate);
    setDueHasTime(draft.dueHasTime);
    setStartDate(draft.startDate);
    setStartHasTime(draft.startHasTime);
    setStoryPoints(draft.storyPoints);
    setRecurrence(draft.recurrence);
    setMoreOpen(Boolean(draft.startDate) || draft.storyPoints !== null || draft.recurrence !== null);
    setRestoredAt(draft.savedAt);
  };

  // Seed the form once, on the transition from closed to open.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    settled.current = false;
    ownsDraft.current = false;

    seedForm();
    const { defaults: seed, draftOwner: owner } = latest.current;
    const draft = owner ? readIssueDraft(owner.userId, owner.workspaceId) : null;
    if (draft && draft.parentId === (seed?.parentId ?? null) && (draft.title.trim() || !isDocEmpty(draft.description))) {
      restoreDraft(draft);
      ownsDraft.current = true;
    }
  }, [open]);

  // While there is text in the form it is kept in the browser: a reload or a
  // phone that put the tab to sleep must not cost what was typed.
  const hasText = title.trim().length > 0 || !isDocEmpty(description);
  useEffect(() => {
    if (!open || !draftOwner) return;
    if (!settled.current) {
      settled.current = true;
      return;
    }
    const { userId, workspaceId } = draftOwner;
    if (!hasText) {
      // Everything was erased by hand: there is nothing left worth restoring.
      if (ownsDraft.current) clearIssueDraft(userId, workspaceId);
      ownsDraft.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      ownsDraft.current = true;
      writeIssueDraft(userId, workspaceId, {
        savedAt: Date.now(),
        parentId: defaults?.parentId ?? null,
        projectId,
        title,
        // A picture held in memory cannot outlive the page; the text can.
        description: replaceImageSources(description, new Map()),
        type,
        priority,
        statusId,
        assigneeId,
        labelIds,
        watcherIds,
        sprintId,
        epicId,
        dueDate,
        dueHasTime,
        startDate,
        startHasTime,
        storyPoints,
        recurrence,
      });
    }, 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the owner's ids are stable while the form is open
  }, [
    open,
    hasText,
    title,
    description,
    projectId,
    type,
    priority,
    statusId,
    assigneeId,
    labelIds,
    watcherIds,
    sprintId,
    epicId,
    dueDate,
    dueHasTime,
    startDate,
    startHasTime,
    storyPoints,
    recurrence,
  ]);

  const dropDraft = () => {
    if (ownsDraft.current && draftOwner) clearIssueDraft(draftOwner.userId, draftOwner.workspaceId);
    ownsDraft.current = false;
  };

  /** Closing on purpose — created, cancelled or confirmed «не сохранять» — ends the draft. */
  const closeForm = () => {
    dropDraft();
    close();
  };



  // Anyone in the workspace who can see the task. Without a project list yet,
  // that is every non-guest member — the same people who will see it.
  const members = project
    ? project.assignees
    : (workspaceMembers ?? []).filter((m) => m.role !== 'GUEST').map((m) => m.user);
  const statuses = project?.statuses ?? [];
  // Without a choice the form shows the status the server would pick — the
  // project's default, which need not be its first column. It used to show the
  // first one («Бэклог») and then save the task as «К выполнению».
  const selectedStatus =
    statuses.find((s) => s.id === statusId) ?? statuses.find((s) => s.isDefault) ?? statuses[0];
  // Another project has another circle of people: someone picked for the old
  // one may not be able to open the new one, so they are dropped, not sent.
  const allowedWatcherIds = watcherIds.filter((id) => members.some((member) => member.id === id));
  const assignee = members.find((member) => member.id === assigneeId) ?? null;
  // A new label is added to the same list the task goes to and picked at once.
  const addLabel = async (name: string) => {
    const input = { name, color: nextLabelColor(project?.labels ?? []) };
    try {
      const label = effectiveProjectId
        ? await createLabel.mutateAsync(input)
        : await createProjectlessLabel.mutateAsync(input);
      setLabelIds((ids) => [...ids, label.id]);
    } catch {
      /* the mutation's onError already surfaced a toast */
    }
  };

  // What would be lost by closing: anything the person typed or picked.
  const dirty =
    title.trim().length > 0 ||
    !isDocEmpty(description) ||
    Boolean(assigneeId) ||
    labelIds.length > 0 ||
    watcherIds.length > 0 ||
    // A date that came with the form (a calendar day's «+») is not the person's input.
    (dueDate ?? null) !== (defaults?.dueDate ?? null) ||
    (startDate ?? null) !== (defaults?.startDate ?? null) ||
    storyPoints !== null ||
    recurrence !== null;

  const isSubtask = Boolean(defaults?.parentId);
  const extraCount = [startDate, storyPoints, isSubtask ? null : recurrence].filter((value) => value !== null).length;

  const canSubmit = title.trim().length > 0 && Boolean(workspace) && !createIssue.isPending;

  const submit = async (openAfter: boolean) => {
    if (!canSubmit) return;

    // Held pictures are left out of the first save — the server would keep them
    // as broken images — and put back once they are uploaded to the new task.
    const body = replaceImageSources(description, new Map());
    const input: CreateIssueRequest = {
      ...(effectiveProjectId ? { projectId: effectiveProjectId } : { workspaceId: workspace!.id }),
      title: title.trim(),
      type,
      priority,
      // What is on the screen is what is saved, chosen by hand or not.
      ...(selectedStatus ? { statusId: selectedStatus.id } : {}),
      ...(assignee ? { assigneeId: assignee.id } : {}),
      ...(labelIds.length ? { labelIds } : {}),
      ...(allowedWatcherIds.length ? { watcherIds: allowedWatcherIds } : {}),
      ...(sprintId ? { sprintId } : {}),
      ...(epicId ? { epicId } : {}),
      ...(defaults?.parentId ? { parentId: defaults.parentId } : {}),
      ...(dueDate ? { dueDate, dueHasTime } : {}),
      ...(startDate ? { startDate, startHasTime } : {}),
      ...(storyPoints !== null ? { storyPoints } : {}),
      // A subtask comes back together with its parent, never on its own.
      ...(recurrence && !isSubtask ? { recurrence } : {}),
      ...(isDocEmpty(body) ? {} : { description: body as Record<string, unknown> }),
    };

    try {
      const issue = await createIssue.mutateAsync(input);
      await attachHeldImages(issue.id, description).catch(() => undefined);
      releaseImages();
      // The task exists now; its text is no longer a draft.
      dropDraft();
      setRestoredAt(null);
      // «Создать и открыть» opens the task itself; a toast offering to open it
      // would only cover the panel.
      if (!openAfter) toast.toast({
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
      closeForm();
      if (openAfter) openIssue(issue.id);
    } catch {
      /* the mutation's onError already surfaced a toast */
    }
  };

  if (!projects) return null;

  return (
    <Dialog
      open={open}
      onClose={closeForm}
      dirty={dirty}
      title="Новая задача"
      size="lg"
      footer={
        // Wraps on a phone: the three buttons and the checkbox are wider than a
        // 390px screen, and in one row «Создать» ran off its edge.
        <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2">
          <Checkbox
            checked={createAnother}
            onChange={(event) => setCreateAnother(event.target.checked)}
            label={
              <span className="text-xs text-text-muted">
                Создать ещё
                {/* What «ещё» keeps is said, not left to be found out on the second task. */}
                {createAnother && <span className="hidden sm:inline"> — поля останутся, очистится только текст</span>}
              </span>
            }
          />
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <DialogCloseButton size="sm" variant="ghost">
              Отмена
            </DialogCloseButton>
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
              iconRight={
                // The Enter hint means nothing on a touch screen and costs the width the button needs there.
                <span className="hidden sm:inline-flex">
                  <Kbd className="border-white/30 bg-white/10 text-white/80">↵</Kbd>
                </span>
              }
            >
              Создать
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {restoredAt !== null && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-2 border-border-strong bg-surface-sunken px-2.5 py-1.5 text-xs"
          >
            <History className="size-3.5 shrink-0 text-text-subtle" />
            <span className="min-w-0 flex-1">
              Восстановлен несохранённый черновик от{' '}
              {new Date(restoredAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                dropDraft();
                seedForm();
              }}
            >
              Начать заново
            </Button>
          </div>
        )}

        {/* Project + type */}
        <div className="flex flex-wrap items-center gap-2">
          <ProjectPicker
            projects={regularProjects}
            value={projectId}
            onChange={(next) => {
              // Statuses, labels, epics and sprints belong to a project: a
              // choice made for one means nothing in another.
              if (next !== projectId) {
                setStatusId(undefined);
                setLabelIds([]);
                setEpicId(null);
                setSprintId(null);
              }
              setProjectId(next);
            }}
          >
            <button
              type="button"
              aria-label={`Проект: ${selectedProject?.name ?? 'без проекта'}`}
              className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md border-2 border-border-strong bg-surface px-2 text-sm hover:bg-surface-hover hover:shadow-xs"
            >
              {selectedProject && <ProjectIcon icon={selectedProject.icon} color={selectedProject.color} size="sm" />}
              <span className="truncate">{selectedProject?.name ?? 'Без проекта'}</span>
              <ChevronDown className="size-3 shrink-0 text-text-subtle" />
            </button>
          </ProjectPicker>

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
          onUploadImage={holdImage}
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
              <Avatar user={assignee} size="sm" />
              {assignee?.name ?? 'Исполнитель'}
            </button>
          </UserPicker>

          <MultiSelect
            title="Наблюдатели"
            options={members.map((member) => ({
              value: member.id,
              label: member.name,
              icon: <Avatar user={member} size="sm" />,
            }))}
            value={allowedWatcherIds}
            onChange={setWatcherIds}
          >
            <button
              type="button"
              aria-label={`Наблюдатели: ${allowedWatcherIds.length || 'нет'}`}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border-2 border-border-strong bg-surface px-2 text-xs hover:bg-surface-hover hover:shadow-xs"
            >
              <Eye className="size-3.5 text-text-subtle" />
              {allowedWatcherIds.length ? `Наблюдатели: ${allowedWatcherIds.length}` : 'Наблюдатели'}
            </button>
          </MultiSelect>

          <LabelPicker
            labels={project?.labels ?? []}
            value={labelIds}
            onChange={setLabelIds}
            onCreate={(name) => void addLabel(name)}
          >
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
              <option value="">Без спринта</option>
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

          <div className="w-56">
            <DateField
              value={dueDate}
              hasTime={dueHasTime}
              onChange={(value, hasTime) => {
                setDueDate(value);
                setDueHasTime(hasTime);
              }}
            />
          </div>
        </div>

        {/* All fields */}
        <div>
          <button
            type="button"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((shown) => !shown)}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-text-muted hover:text-text"
          >
            <ChevronDown className={clsx('size-3.5 transition-transform', !moreOpen && '-rotate-90')} />
            Все поля
            {extraCount > 0 && <span className="fd-num text-2xs font-normal text-accent">заполнено: {extraCount}</span>}
          </button>

          {moreOpen && (
            <div className="mt-2 grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-3">
              <div>
                <span className="mb-1 block text-2xs font-bold tracking-wide text-text-subtle uppercase">Начало</span>
                <DateField
                  label="Начало"
                  value={startDate}
                  hasTime={startHasTime}
                  onChange={(value, hasTime) => {
                    setStartDate(value);
                    setStartHasTime(hasTime);
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="create-issue-points"
                  className="mb-1 block text-2xs font-bold tracking-wide text-text-subtle uppercase"
                >
                  Оценка, баллы
                </label>
                <input
                  id="create-issue-points"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  value={storyPoints ?? ''}
                  onChange={(event) => {
                    const raw = event.target.value;
                    const points = Math.round(Number(raw));
                    setStoryPoints(raw === '' || !Number.isFinite(points) ? null : Math.min(100, Math.max(0, points)));
                  }}
                  placeholder="—"
                  title="Оценка в баллах, не в часах"
                  className="fd-num h-7 w-full rounded-md border-2 border-border-strong bg-surface px-2 text-sm hover:bg-surface-hover focus:border-accent focus:outline-none"
                />
              </div>

              {!isSubtask && (
                <div>
                  <label
                    htmlFor="create-issue-recurrence"
                    className="mb-1 block text-2xs font-bold tracking-wide text-text-subtle uppercase"
                  >
                    Повтор
                  </label>
                  <select
                    id="create-issue-recurrence"
                    value={recurrence ?? ''}
                    onChange={(event) => setRecurrence((event.target.value || null) as IssueRecurrence | null)}
                    className="h-7 w-full rounded-md border-2 border-border-strong bg-surface px-2 text-sm hover:bg-surface-hover focus:border-accent focus:outline-none"
                  >
                    <option value="">Не повторять</option>
                    {ISSUE_RECURRENCES.map((rule) => (
                      <option key={rule} value={rule}>
                        {RECURRENCE_LABEL[rule].charAt(0).toUpperCase() + RECURRENCE_LABEL[rule].slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {recurrence && !isSubtask && (
                <p className="text-2xs text-text-subtle sm:col-span-3">
                  Повтор срабатывает после закрытия: когда эту задачу завершат, появится следующая — со сдвинутым сроком.
                </p>
              )}
            </div>
          )}
        </div>

        <p className="flex items-center gap-1.5 text-2xs text-text-subtle">
          <CornerDownLeft className="size-3" />
          Enter — создать, Shift+Enter — перенос строки в описании
        </p>
      </div>
    </Dialog>
  );
}
