import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AttachmentDto, CreateIssueRequest, IssuePriority, IssueType } from '@flowdesk/contracts';
import { EMPTY_DOC, isDocEmpty } from '@flowdesk/contracts';
import { ChevronDown, CornerDownLeft } from 'lucide-react';
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
import { Dialog, DialogCloseButton } from '~/ui/Dialog';
import { Button } from '~/ui/Button';
import { Input } from '~/ui/Input';
import { Checkbox } from '~/ui/Input';
import { Kbd } from '~/ui/Tooltip';
import { Avatar } from '~/ui/Avatar';
import { RichTextEditor, replaceImageSources } from './RichText';
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
  const [createAnother, setCreateAnother] = useState(false);

  // An empty choice means "without a project". Such tasks live in the
  // workspace's list of tasks without a project; once that list exists its
  // statuses and labels are offered like any project's. Until the first such
  // task creates it, there is nothing project-scoped to pick yet.
  const regularProjects = useMemo(() => (projects ?? []).filter((p) => !p.isSystem), [projects]);
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
    setDueDate(seed?.dueDate ?? null);
    setDueHasTime(seed?.dueHasTime ?? false);
  }, [open]);



  // Anyone in the workspace who can see the task. Without a project list yet,
  // that is every non-guest member — the same people who will see it.
  const members = project
    ? project.assignees
    : (workspaceMembers ?? []).filter((m) => m.role !== 'GUEST').map((m) => m.user);
  const statuses = project?.statuses ?? [];
  const selectedStatus = statuses.find((s) => s.id === statusId) ?? statuses[0];
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
    // A date that came with the form (a calendar day's «+») is not the person's input.
    (dueDate ?? null) !== (defaults?.dueDate ?? null);

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
      ...(statusId ? { statusId } : {}),
      ...(assigneeId ? { assigneeId } : {}),
      ...(labelIds.length ? { labelIds } : {}),
      ...(sprintId ? { sprintId } : {}),
      ...(epicId ? { epicId } : {}),
      ...(defaults?.parentId ? { parentId: defaults.parentId } : {}),
      ...(dueDate ? { dueDate, dueHasTime } : {}),
      // A start comes only from where the form was opened (an hour slot in the calendar).
      ...(defaults?.startDate ? { startDate: defaults.startDate, startHasTime: defaults.startHasTime ?? false } : {}),
      ...(isDocEmpty(body) ? {} : { description: body as Record<string, unknown> }),
    };

    try {
      const issue = await createIssue.mutateAsync(input);
      await attachHeldImages(issue.id, description).catch(() => undefined);
      releaseImages();
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
      close();
      if (openAfter) openIssue(issue.id);
    } catch {
      /* the mutation's onError already surfaced a toast */
    }
  };

  if (!projects) return null;

  return (
    <Dialog
      open={open}
      onClose={close}
      dirty={dirty}
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
            onChange={(event) => {
              // Statuses, labels, epics and sprints belong to a project: a
              // choice made for one means nothing in another.
              if (event.target.value !== projectId) {
                setStatusId(undefined);
                setLabelIds([]);
                setEpicId(null);
                setSprintId(null);
              }
              setProjectId(event.target.value);
            }}
            aria-label="Проект"
            className="h-7 rounded-md border-2 border-border-strong bg-surface px-2 text-sm hover:bg-surface-hover hover:shadow-xs focus:border-accent focus:outline-none"
          >
            <option value="">Без проекта</option>
            {regularProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
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
              <Avatar user={members.find((m) => m.id === assigneeId) ?? null} size="sm" />
              {members.find((m) => m.id === assigneeId)?.name ?? 'Исполнитель'}
            </button>
          </UserPicker>

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

        <p className="flex items-center gap-1.5 text-2xs text-text-subtle">
          <CornerDownLeft className="size-3" />
          Enter — создать, Shift+Enter — перенос строки в описании
        </p>
      </div>
    </Dialog>
  );
}
