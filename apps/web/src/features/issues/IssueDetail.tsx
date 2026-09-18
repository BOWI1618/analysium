import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import type { IssueDetailDto, ProjectDto, UserSummaryDto } from '@flowdesk/contracts';
import { Permission } from '@flowdesk/contracts';
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  CopyPlus,
  CornerDownRight,
  CornerUpLeft,
  FileText,
  ExternalLink,
  Link2,
  MoreHorizontal,
  Paperclip,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCurrentUser, useSession } from '~/app/session';
import { useUiStore } from '~/app/uiStore';
import { useHotkeys } from '~/lib/hooks/useHotkeys';
import { SHORTCUTS } from '~/lib/shortcuts';
import { useToast } from '~/app/toast';
import { nextLabelColor, useCreateLabel, useProject, useProjects } from '~/features/projects/hooks';
import { useSprints } from '~/features/sprints/hooks';
import {
  useDeleteAttachment,
  useDeleteIssue,
  useIssueActivity,
  useIssueList,
  useTransferIssue,
  useUpdateIssue,
  useUploadAttachment,
} from './hooks';
import { ActivityTimeline } from './ActivityTimeline';
import { CommentThread } from './CommentThread';
import { IssueLinks } from './IssueLinks';
import { AttachToParentDialog, DuplicateIssueDialog } from './IssueActionDialogs';
import { DoneToggle, doneStatusId, isClosedStatus, reopenStatusId } from '~/components/DoneToggle';
import { RichTextEditor } from '~/components/RichText';
import {
  DateField,
  LabelPicker,
  PriorityPicker,
  StatusPicker,
  TypePicker,
  UserPicker,
} from '~/components/Pickers';
import {
  ISSUE_TYPE_META,
  IssueTypeIcon,
  LabelChip,
  PRIORITY_META,
  PriorityIcon,
  StatusDot,
  StatusPill,
} from '~/components/IssueMeta';
import { Avatar } from '~/ui/Avatar';
import { Button, IconButton } from '~/ui/Button';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '~/ui/Menu';
import { ConfirmDialog, useGuardedClose } from '~/ui/Dialog';
import { ProgressBar, SkeletonText } from '~/ui/Feedback';
import { Panel } from '~/ui/Panel';
import { ProjectIcon } from '~/ui/ProjectIcon';
import { Tooltip } from '~/ui/Tooltip';
import { formatBytes, fullDate, relativeTime } from '~/lib/format';

export interface IssueDetailProps {
  issue: IssueDetailDto;
  onClose?: () => void;
  /** Full-page mode drops the close button and widens the layout. */
  variant?: 'panel' | 'page';
}

/**
 * The complete issue view, shared by the side panel and the standalone route.
 *
 * Every field edits in place: there is no "edit mode" and no save button, and
 * each change is an isolated PATCH that the server records in the history.
 */
export function IssueDetail({ issue, onClose: close, variant = 'panel' }: IssueDetailProps) {
  // In the side panel, closing asks first when a comment is typed but not sent.
  const guardedClose = useGuardedClose(close);
  const onClose = close ? guardedClose : undefined;
  const currentUser = useCurrentUser();
  const { workspace } = useSession();
  const toast = useToast();
  const openCreateIssue = useUiStore((s) => s.openCreateIssue);
  const openIssue = useUiStore((s) => s.openIssue);

  // Issue shortcuts press the very buttons a mouse would, found inside this
  // issue: one code path, and nothing to fall out of sync with the fields. They
  // stand down while another dialog is on top — quick-create over an open issue
  // must not have its keys open this issue's menus underneath.
  const rootRef = useRef<HTMLDivElement>(null);
  const pressInIssue = (selector: string) => () => {
    const root = rootRef.current;
    if (!root) return;
    const topDialog = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].pop();
    if (topDialog && !topDialog.contains(root)) return;
    root.querySelector<HTMLElement>(selector)?.click();
  };
  useHotkeys({
    [SHORTCUTS.issueTitle]: pressInIssue('[data-issue-title]'),
    [SHORTCUTS.issueStatus]: pressInIssue('[aria-label="Изменить статус"]'),
    [SHORTCUTS.issueAssignee]: pressInIssue('[aria-label="Изменить исполнителя"]'),
    [SHORTCUTS.issuePriority]: pressInIssue('[aria-label="Изменить приоритет"]'),
    [SHORTCUTS.issueLabels]: pressInIssue('[aria-label="Изменить метки"]'),
  });

  const { data: project } = useProject(issue.projectId);
  const { data: sprints } = useSprints(project?.projectType === 'SCRUM' ? issue.projectId : undefined);
  const { data: activity, isLoading: activityLoading } = useIssueActivity(issue.id);
  const { data: epicPages } = useIssueList(
    { projectId: issue.projectId },
    { type: ['EPIC'], includeDone: true },
  );

  const updateIssue = useUpdateIssue(issue.id);
  const deleteIssue = useDeleteIssue();
  const uploadAttachment = useUploadAttachment(issue.id);
  const deleteAttachment = useDeleteAttachment(issue.id);

  const [tab, setTab] = useState<'comments' | 'activity'>('comments');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const navigate = useNavigate();
  const { data: workspaceProjects } = useProjects(workspace?.id ?? '', false, { includeSystem: true });
  const transferIssue = useTransferIssue(issue.id);
  const [transferTo, setTransferTo] = useState<ProjectDto | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Description value at the moment the editor took focus — compared on blur
  // to detect that a teammate saved while we were typing.
  const descriptionBaseRef = useRef<unknown>(undefined);

  // Everyone who can open this project — the explicit role list would leave out
  // most of the team (a new project holds only its lead).
  const members = useMemo<UserSummaryDto[]>(() => project?.assignees ?? [], [project]);
  const epics = useMemo(
    () => (epicPages?.pages.flatMap((p) => p.items) ?? []).filter((e) => e.id !== issue.id),
    [epicPages, issue.id],
  );

  const can = (permission: Permission) => issue.permissions.includes(permission);
  const canEdit = can(Permission.ISSUE_UPDATE);
  const canComment = can(Permission.COMMENT_CREATE);
  const canUpload = can(Permission.ATTACHMENT_UPLOAD);

  // A picture in the text is a task file shown in place, so it lands in «Файлы» too.
  const uploadImage = async (file: File) => {
    try {
      return (await uploadAttachment.mutateAsync(file)).url;
    } catch {
      return null; // the mutation's onError already said why
    }
  };

  const patch = (values: Parameters<typeof updateIssue.mutate>[0]) => updateIssue.mutate(values);

  const createLabel = useCreateLabel(issue.projectId);
  // A label created from the list is put on the task straight away.
  const addLabel = (name: string) =>
    createLabel.mutate(
      { name, color: nextLabelColor(project?.labels ?? []) },
      { onSuccess: (label) => patch({ labelIds: [...issue.labels.map((l) => l.id), label.id] }) },
    );

  const copyLink = async () => {
    const url = `${window.location.origin}/issue/${issue.issueKey}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Ссылка скопирована', url);
    } catch {
      toast.error(new Error('Буфер обмена недоступен в этом браузере'), 'Не удалось скопировать');
    }
  };

  const doneSubtasks = issue.subtasks.filter((s) => s.status.category === 'COMPLETED').length;

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-surface">
      {/* ------------------------------------------------------------ header */}
      <header className="flex shrink-0 items-center gap-2 border-b-2 border-border-strong bg-surface px-3 py-2 shadow-sm">
        {canEdit && project && (
          <DoneToggle
            done={isClosedStatus(issue.status)}
            issueKey={issue.issueKey}
            className="size-4"
            onToggle={() => {
              const statusId = isClosedStatus(issue.status)
                ? reopenStatusId(project.statuses)
                : doneStatusId(project.statuses);
              if (statusId) patch({ statusId });
            }}
          />
        )}
        <IssueTypeIcon type={issue.type} className="size-4" />
        <Link
          to={`/issue/${issue.issueKey}`}
          className="fd-key text-xs hover:text-accent"
        >
          {issue.issueKey}
        </Link>

        <StatusPicker
          statuses={project?.statuses ?? []}
          value={issue.statusId}
          disabled={!canEdit}
          onChange={(statusId) => patch({ statusId })}
        >
          <button
            type="button"
            disabled={!canEdit}
            className="transition-opacity hover:opacity-80 disabled:cursor-default"
          >
            <StatusPill status={issue.status} />
          </button>
        </StatusPicker>

        <PriorityPicker
          value={issue.priority}
          disabled={!canEdit}
          onChange={(priority) => patch({ priority })}
        >
          <button
            type="button"
            disabled={!canEdit}
            className="inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-xs text-text-muted hover:bg-surface-hover disabled:cursor-default"
          >
            <PriorityIcon priority={issue.priority} withTooltip={false} className="size-3.5" />
            <span className="hidden sm:inline">{PRIORITY_META[issue.priority].label}</span>
          </button>
        </PriorityPicker>

        <div className="ml-auto flex items-center gap-0.5">
          <Tooltip content="Скопировать ссылку">
            <IconButton label="Скопировать ссылку" size="sm" onClick={() => void copyLink()}>
              <Link2 className="size-4" />
            </IconButton>
          </Tooltip>

          {variant === 'panel' && (
            <Tooltip content="Открыть на отдельной странице">
              <Link
                to={`/issue/${issue.issueKey}`}
                onClick={close}
                aria-label="Открыть на отдельной странице"
                className="inline-flex size-8 items-center justify-center rounded-sm text-text-muted hover:bg-surface-hover hover:text-text"
              >
                <ExternalLink className="size-4" />
              </Link>
            </Tooltip>
          )}

          <Menu>
            <MenuTrigger>
              <IconButton label="Действия с задачей" size="sm">
                <MoreHorizontal className="size-4" />
              </IconButton>
            </MenuTrigger>
            <MenuContent align="end" width={230} label="Действия с задачей">
              <MenuItem icon={<Copy className="size-3.5" />} onSelect={() => void copyLink()}>
                Скопировать ссылку
              </MenuItem>
              {canEdit && issue.type !== 'SUBTASK' && (
                <MenuItem
                  icon={<Plus className="size-3.5" />}
                  onSelect={() => openCreateIssue({ projectId: issue.projectId, parentId: issue.id })}
                >
                  Добавить подзадачу
                </MenuItem>
              )}
              {can(Permission.ISSUE_CREATE) && (
                <MenuItem icon={<CopyPlus className="size-3.5" />} onSelect={() => setDuplicating(true)}>
                  Дублировать задачу
                </MenuItem>
              )}
              {canEdit && !issue.parent && issue.subtasks.length === 0 && issue.type !== 'EPIC' && (
                <MenuItem icon={<CornerDownRight className="size-3.5" />} onSelect={() => setAttaching(true)}>
                  Сделать подзадачей…
                </MenuItem>
              )}
              {canEdit && issue.parent && (
                <MenuItem icon={<CornerUpLeft className="size-3.5" />} onSelect={() => patch({ parentId: null, type: 'TASK' })}>
                  Отвязать от {issue.parent.issueKey}
                </MenuItem>
              )}
              {can(Permission.ISSUE_DELETE) && (
                <>
                  <MenuSeparator />
                  <MenuItem icon={<Trash2 className="size-3.5" />} danger onSelect={() => setConfirmDelete(true)}>
                    Удалить задачу
                  </MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>

          {onClose && (
            <IconButton label="Закрыть" size="sm" onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          )}
        </div>
      </header>

      {/* ------------------------------------------------------------- body */}
      <div
        className={clsx(
          'min-h-0 flex-1 overflow-y-auto scrollbar-thin',
          // Below lg the page had no horizontal padding at all: the title and
          // every section ran into the screen edge.
          variant === 'page' ? 'px-4 py-4 lg:flex lg:gap-6 lg:px-6 lg:py-5' : '',
        )}
      >
        <div className={clsx(variant === 'page' ? 'min-w-0 flex-1' : 'px-4 py-4')}>
          {/* Way back to the parent task. A subtask cannot have subtasks of
              its own, so one level is the whole chain. */}
          {issue.parent && (
            <button
              type="button"
              onClick={() => {
                if (variant === 'page') navigate(`/issue/${issue.parent!.issueKey}`);
                else openIssue(issue.parent!.id);
              }}
              className="mb-3 inline-flex max-w-full items-center gap-1.5 border-2 border-border-strong bg-surface px-2 py-1 text-xs shadow-xs hover:bg-surface-hover hover:text-accent"
            >
              <ArrowLeft className="size-3.5 shrink-0" />
              <span className="shrink-0 text-text-subtle">Подзадача задачи</span>
              <span className="fd-key shrink-0">{issue.parent.issueKey}</span>
              <span className="min-w-0 truncate font-bold">{issue.parent.title}</span>
            </button>
          )}

          <TitleField
            value={issue.title}
            editable={canEdit}
            display={variant === 'page'}
            onSave={(title) => patch({ title })}
          />

          {/* Description */}
          <Panel title="описание" icon={<FileText className="size-3.5 text-text-subtle" />} className="mt-6">
            <RichTextEditor
              value={issue.description}
              users={members}
              editable={canEdit}
              toolbar={canEdit}
              placeholder={canEdit ? 'Добавьте описание…' : 'Описания нет'}
              minHeight="4rem"
              onUploadImage={canEdit && canUpload ? uploadImage : undefined}
              onFocus={() => {
                descriptionBaseRef.current = issue.description;
              }}
              onBlur={(description) => {
                const base = descriptionBaseRef.current;
                descriptionBaseRef.current = undefined;
                if (JSON.stringify(description) === JSON.stringify(base)) return;
                if (JSON.stringify(issue.description) !== JSON.stringify(base)) {
                  // A teammate saved while we were editing — keep their version
                  // instead of overwriting it, and offer a reload to see it.
                  toast.toast({
                    tone: 'info',
                    title: 'Описание обновилось',
                    description: 'Пока вы редактировали, описание сохранил другой участник. Ваши правки не записаны.',
                    action: { label: 'Обновить', onClick: () => window.location.reload() },
                  });
                  return;
                }
                patch({ description: description as Record<string, unknown> });
              }}
            />
          </Panel>

          {/* Attachments */}
          <section className="mt-5" aria-label="Файлы">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="fd-eyebrow flex items-center gap-1.5">
                <Paperclip className="size-3.5" />
                Файлы
                {issue.attachments.length > 0 && (
                  <span className="fd-num">({issue.attachments.length})</span>
                )}
              </h3>
              {can(Permission.ATTACHMENT_UPLOAD) && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) uploadAttachment.mutate(file);
                      event.target.value = '';
                    }}
                  />
                  <Button
                    size="xs"
                    variant="ghost"
                    iconLeft={<Upload className="size-3" />}
                    loading={uploadAttachment.isPending}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Загрузить
                  </Button>
                </>
              )}
            </div>

            {issue.attachments.length === 0 ? (
              <p className="text-xs text-text-subtle">Файлов нет.</p>
            ) : (
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {issue.attachments.map((attachment) => (
                  <li
                    key={attachment.id}
                    className="group flex items-center gap-2 border-2 border-border-strong bg-surface-sunken p-1.5"
                  >
                    {attachment.isImage ? (
                      <img
                        src={attachment.url}
                        alt=""
                        className="size-9 shrink-0 object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="flex size-9 shrink-0 items-center justify-center bg-surface-active text-text-subtle">
                        <Paperclip className="size-4" />
                      </span>
                    )}
                    <a
                      href={attachment.url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1"
                      title={attachment.filename}
                    >
                      <span className="block truncate text-xs font-medium hover:text-accent">
                        {attachment.filename}
                      </span>
                      <span className="block text-2xs text-text-subtle">
                        {formatBytes(attachment.size)} · {relativeTime(attachment.createdAt)}
                      </span>
                    </a>
                    <IconButton
                      label={`Remove ${attachment.filename}`}
                      size="xs"
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                      onClick={() => deleteAttachment.mutate(attachment.id)}
                    >
                      <X className="size-3" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Subtasks */}
          {issue.type !== 'SUBTASK' && (
            <section className="mt-5" aria-label="Подзадачи">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="fd-eyebrow">
                  Подзадачи
                  {issue.subtasks.length > 0 && (
                    <span className="fd-num ml-1.5 normal-case tracking-normal">
                      {doneSubtasks} / {issue.subtasks.length} готово
                    </span>
                  )}
                </h3>
                {canEdit && (
                  <Button
                    size="xs"
                    variant="ghost"
                    iconLeft={<Plus className="size-3" />}
                    onClick={() => openCreateIssue({ projectId: issue.projectId, parentId: issue.id })}
                  >
                    Добавить
                  </Button>
                )}
              </div>

              {issue.subtasks.length > 0 && (
                <ProgressBar
                  value={doneSubtasks}
                  max={issue.subtasks.length}
                  tone={doneSubtasks === issue.subtasks.length ? 'success' : 'accent'}
                  className="mb-2"
                  label={`Готово подзадач: ${doneSubtasks} из ${issue.subtasks.length}`}
                />
              )}

              {issue.subtasks.length === 0 ? (
                <p className="text-xs text-text-subtle">Разбейте задачу на части.</p>
              ) : (
                <ul className="divide-y-2 divide-border-strong border-2 border-border-strong">
                  {issue.subtasks.map((subtask) => (
                    <li key={subtask.id}>
                      <button
                        type="button"
                        onClick={() => openIssue(subtask.id)}
                        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-surface-hover"
                      >
                        <StatusDot status={subtask.status} className="size-3" />
                        <span className="fd-key">{subtask.issueKey}</span>
                        <span
                          className={clsx(
                            'min-w-0 flex-1 truncate text-sm',
                            subtask.status.category === 'COMPLETED' && 'text-text-subtle line-through',
                          )}
                        >
                          {subtask.title}
                        </span>
                        <Avatar user={subtask.assignee} size="sm" showEmpty={false} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <IssueLinks
            issue={issue}
            canEdit={canEdit}
            onDetach={() => patch({ parentId: null, type: 'TASK' })}
          />

          {/* Discussion */}
          <section className="mt-6" aria-label="Обсуждение">
            <div className="mb-3 flex items-center gap-1 border-b-2 border-border-strong">
              {(['comments', 'activity'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  aria-selected={tab === key}
                  role="tab"
                  className={clsx(
                    '-mb-0.5 border-b-2 px-2.5 py-1.5 text-sm font-bold transition-colors',
                    tab === key
                      ? 'border-accent text-text'
                      : 'border-transparent text-text-muted hover:text-text',
                  )}
                >
                  {key === 'comments' ? 'Комментарии' : 'История'}
                  {key === 'comments' && issue.commentCount > 0 && (
                    <span className="ml-1.5 text-xs text-text-subtle">{issue.commentCount}</span>
                  )}
                </button>
              ))}
            </div>

            {tab === 'comments' ? (
              <CommentThread
                issueId={issue.id}
                members={members}
                canComment={canComment}
                currentUser={currentUser}
                onUploadImage={canUpload ? uploadImage : undefined}
              />
            ) : activityLoading ? (
              <SkeletonText lines={5} />
            ) : (
              <ActivityTimeline activity={activity ?? []} issue={issue} members={members} />
            )}
          </section>
        </div>

        {/* ---------------------------------------------------------- sidebar */}
        <aside
          className={clsx('shrink-0', variant === 'page' ? 'mt-6 lg:mt-0 lg:w-72 lg:pt-6' : 'mt-4 px-4 pb-4')}
          aria-label="Свойства задачи"
        >
          <dl className="divide-y-2 divide-border-strong border-2 border-border-strong bg-surface shadow-lg">
            <Field label="Статус">
              <StatusPicker
                statuses={project?.statuses ?? []}
                value={issue.statusId}
                disabled={!canEdit}
                onChange={(statusId) => patch({ statusId })}
              >
                <FieldButton disabled={!canEdit} label="Изменить статус">
                  <StatusDot status={issue.status} className="size-3" />
                  {issue.status.name}
                </FieldButton>
              </StatusPicker>
            </Field>

            <Field label="Исполнитель">
              <UserPicker
                users={members}
                value={issue.assignee?.id ?? null}
                disabled={!canEdit}
                onChange={(assigneeId) => patch({ assigneeId })}
              >
                <FieldButton disabled={!canEdit} label="Изменить исполнителя">
                  <Avatar user={issue.assignee} size="sm" />
                  {issue.assignee?.name ?? 'Не назначен'}
                </FieldButton>
              </UserPicker>
            </Field>

            <Field label="Автор">
              <span className="flex items-center gap-1.5 text-sm">
                <Avatar user={issue.reporter} size="sm" />
                {issue.reporter?.name ?? 'Неизвестно'}
              </span>
            </Field>

            <Field label="Приоритет">
              <PriorityPicker value={issue.priority} disabled={!canEdit} onChange={(priority) => patch({ priority })}>
                <FieldButton disabled={!canEdit} label="Изменить приоритет">
                  <PriorityIcon priority={issue.priority} withTooltip={false} className="size-3.5" />
                  {PRIORITY_META[issue.priority].label}
                </FieldButton>
              </PriorityPicker>
            </Field>

            <Field label="Тип">
              <TypePicker
                value={issue.type}
                disabled={!canEdit || issue.type === 'SUBTASK'}
                onChange={(type) => patch({ type })}
              >
                <FieldButton disabled={!canEdit || issue.type === 'SUBTASK'} label="Изменить тип">
                  <IssueTypeIcon type={issue.type} withTooltip={false} className="size-3.5" />
                  {ISSUE_TYPE_META[issue.type].label}
                </FieldButton>
              </TypePicker>
            </Field>

            <Field label="Метки">
              <LabelPicker
                labels={project?.labels ?? []}
                value={issue.labels.map((l) => l.id)}
                disabled={!canEdit}
                onChange={(labelIds) => patch({ labelIds })}
                onCreate={addLabel}
              >
                <FieldButton disabled={!canEdit} wrap label="Изменить метки">
                  {issue.labels.length === 0 ? (
                    <span className="text-text-subtle">Нет</span>
                  ) : (
                    issue.labels.map((label) => <LabelChip key={label.id} label={label} size="sm" />)
                  )}
                </FieldButton>
              </LabelPicker>
            </Field>

            <Field label="Проект">
              {canEdit && workspaceProjects && workspaceProjects.length > 1 ? (
                <div className="flex min-w-0 items-center gap-1.5">
                  <ProjectIcon icon={issue.project.icon} color={issue.project.color} size="sm" />
                  <select
                    value={issue.projectId}
                    aria-label="Перенести в проект"
                    disabled={transferIssue.isPending}
                    onChange={(event) => {
                      const next = workspaceProjects.find((p) => p.id === event.target.value);
                      if (next && next.id !== issue.projectId) setTransferTo(next);
                    }}
                    className="h-7 min-w-0 flex-1 border-2 border-transparent bg-transparent text-sm hover:border-border-strong hover:bg-surface-hover focus:border-accent focus:outline-none"
                  >
                    {/* The current project stays listed even if archived, so the value shows. */}
                    {!workspaceProjects.some((p) => p.id === issue.projectId) && (
                      <option value={issue.projectId}>{issue.project.name}</option>
                    )}
                    {workspaceProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <Link
                    to={`/projects/${issue.projectId}`}
                    aria-label="Открыть проект"
                    title="Открыть проект"
                    className="inline-flex size-7 shrink-0 items-center justify-center text-text-muted hover:bg-surface-hover hover:text-text"
                  >
                    <ExternalLink className="size-3.5" />
                  </Link>
                </div>
              ) : (
                <Link
                  to={`/projects/${issue.projectId}`}
                  className="flex items-center gap-1.5 text-sm hover:text-accent"
                >
                  <ProjectIcon icon={issue.project.icon} color={issue.project.color} size="sm" />
                  {issue.project.name}
                </Link>
              )}
            </Field>

            {issue.type !== 'EPIC' && (
              <Field label="Эпик">
                <select
                  value={issue.epic?.id ?? ''}
                  disabled={!canEdit}
                  onChange={(event) => patch({ epicId: event.target.value || null })}
                  className="h-7 w-full border-2 border-transparent bg-transparent text-sm hover:border-border-strong hover:bg-surface-hover focus:border-accent focus:outline-none disabled:cursor-default"
                >
                  <option value="">Без эпика</option>
                  {epics.map((epic) => (
                    <option key={epic.id} value={epic.id}>
                      {epic.title}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {sprints && sprints.length > 0 && (
              <Field label="Спринт">
                <select
                  value={issue.sprintId ?? ''}
                  disabled={!canEdit}
                  onChange={(event) => patch({ sprintId: event.target.value || null })}
                  className="h-7 w-full border-2 border-transparent bg-transparent text-sm hover:border-border-strong hover:bg-surface-hover focus:border-accent focus:outline-none disabled:cursor-default"
                >
                  <option value="">Без спринта</option>
                  {sprints.map((sprint) => (
                    <option key={sprint.id} value={sprint.id}>
                      {sprint.name}
                      {sprint.status === 'ACTIVE' ? ' (активный)' : ''}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="Начало">
              <DateField
                label="Начало"
                value={issue.startDate}
                hasTime={issue.startHasTime}
                disabled={!canEdit}
                onChange={(startDate, startHasTime) => patch({ startDate, startHasTime })}
              />
            </Field>

            <Field label="Срок">
              <DateField
                value={issue.dueDate}
                hasTime={issue.dueHasTime}
                disabled={!canEdit}
                onChange={(dueDate, dueHasTime) => patch({ dueDate, dueHasTime })}
              />
            </Field>

            <div className="fd-num space-y-1 bg-surface-sunken px-3.5 py-3 text-2xs text-text-subtle">
              <p title={fullDate(issue.createdAt)}>Создано {relativeTime(issue.createdAt)}</p>
              <p title={fullDate(issue.updatedAt)}>Обновлено {relativeTime(issue.updatedAt)}</p>
              {issue.completedAt && (
                <p title={fullDate(issue.completedAt)}>Завершено {relativeTime(issue.completedAt)}</p>
              )}
            </div>
          </dl>
        </aside>
      </div>

      <ConfirmDialog
        open={Boolean(transferTo)}
        onClose={() => setTransferTo(null)}
        onConfirm={() => {
          const target = transferTo;
          setTransferTo(null);
          if (!target) return;
          transferIssue.mutate(target.id, {
            // The full page is addressed by key, and the key has just changed.
            onSuccess: (moved) => {
              if (variant === 'page') navigate(`/issue/${moved.issueKey}`, { replace: true });
            },
          });
        }}
        title={`Перенести ${issue.issueKey} в «${transferTo?.name}»?`}
        message={
          <>
            Задача получит новый номер в этом проекте
            {issue.subtasks.length > 0 ? ', подзадачи переедут вместе с ней' : ''}. Статус и метки подберутся
            по названию, спринт и эпик сбросятся. Старая ссылка на задачу продолжит работать.
          </>
        }
        confirmLabel="Перенести"
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          deleteIssue.mutate(
            { id: issue.id, projectId: issue.projectId, issueKey: issue.issueKey },
            { onSuccess: () => close?.() },
          );
          setConfirmDelete(false);
        }}
        title={`Удалить ${issue.issueKey}?`}
        message="Задача, её комментарии, подзадачи и история будут удалены безвозвратно."
        confirmLabel="Удалить"
        danger
      />

      {duplicating && (
        <DuplicateIssueDialog
          issue={issue}
          onClose={() => setDuplicating(false)}
          onDuplicated={(copy) => {
            setDuplicating(false);
            if (variant === 'page') navigate(`/issue/${copy.issueKey}`);
            else openIssue(copy.id);
          }}
        />
      )}

      {attaching && (
        <AttachToParentDialog
          issue={issue}
          onClose={() => setAttaching(false)}
          onPick={(parentId) => {
            setAttaching(false);
            patch({ parentId, type: 'SUBTASK' });
          }}
        />
      )}

      {/* Referenced so the workspace id stays in scope for future deep links. */}
      <span hidden>{workspace?.id}</span>
    </div>
  );
}

/* ------------------------------------------------------------ sub-pieces */

function TitleField({
  value,
  editable,
  onSave,
  display,
}: {
  value: string;
  editable: boolean;
  onSave: (title: string) => void;
  /** The full page sets the title as a masthead; the side panel does not. */
  display?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === value) {
      setDraft(value);
      return;
    }
    onSave(trimmed);
  };

  if (!editable || !editing) {
    return (
      <h1
        data-issue-title
        onClick={() => editable && setEditing(true)}
        className={clsx(
          '-mx-1 px-1 text-text',
          display ? 'fd-display text-[clamp(1.375rem,2.4vw,2rem)]' : 'text-xl leading-snug font-semibold',
          editable && 'cursor-text hover:bg-surface-hover',
        )}
        title={editable ? 'Нажмите, чтобы переименовать' : undefined}
      >
        {value}
      </h1>
    );
  }

  return (
    <textarea
      ref={inputRef}
      value={draft}
      rows={1}
      maxLength={300}
      onChange={(event) => {
        setDraft(event.target.value);
        event.target.style.height = 'auto';
        event.target.style.height = `${event.target.scrollHeight}px`;
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
      aria-label="Название задачи"
      className={clsx(
        '-mx-1 w-[calc(100%+0.5rem)] resize-none overflow-hidden border-2 border-accent bg-surface px-1 outline-none',
        display ? 'fd-display text-[clamp(1.375rem,2.4vw,2rem)]' : 'text-xl leading-snug font-semibold',
      )}
    />
  );
}

/**
 * One property of the issue. The label is set as a mono eyebrow above its
 * value rather than beside it, so the rail reads as a stack of captioned
 * entries — and long values (a name, a row of labels) get the full width.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-3.5 py-2.5">
      <dt className="fd-eyebrow">{label}</dt>
      {/* A picker wraps its trigger in an inline-flex span, which would
          shrink-wrap to the value's own width and leave the rest of the cell
          empty. Stretching the cell's children gives every control the full
          column. */}
      <dd className="mt-1.5 flex min-w-0 flex-col items-stretch">{children}</dd>
    </div>
  );
}

/**
 * Trigger for an inline-editable property. `label` names the action rather than
 * the value, so a screen reader hears "Изменить статус" instead of just reading
 * out whatever the status happens to be right now.
 */
function FieldButton({
  children,
  disabled,
  className,
  label,
  wrap,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
  label?: string;
  /** Set when the value is a collection (labels) that may need several lines. */
  wrap?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className={clsx(
        'flex w-full items-center gap-1.5 px-1 py-0.5 -mx-1 text-left text-sm font-semibold',
        'border-2 border-transparent transition-colors',
        !disabled && 'hover:border-border-strong hover:bg-surface-hover',
        disabled && 'cursor-default',
        className,
      )}
    >
      <span className={clsx('flex min-w-0 flex-1 items-center gap-1.5', wrap && 'flex-wrap')}>{children}</span>
      {!disabled && <ChevronDown className="size-3 shrink-0 text-text-subtle" />}
    </button>
  );
}
