import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import type { IssueDetailDto, IssuePriority, IssueType, UserSummaryDto } from '@flowdesk/contracts';
import { Permission } from '@flowdesk/contracts';
import {
  ChevronDown,
  Copy,
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
import { useToast } from '~/app/toast';
import { useProject } from '~/features/projects/hooks';
import { useSprints } from '~/features/sprints/hooks';
import {
  useDeleteAttachment,
  useDeleteIssue,
  useIssueActivity,
  useIssueList,
  useUpdateIssue,
  useUploadAttachment,
} from './hooks';
import { ActivityTimeline } from './ActivityTimeline';
import { CommentThread } from './CommentThread';
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
import { ConfirmDialog } from '~/ui/Dialog';
import { ProgressBar, SkeletonText } from '~/ui/Feedback';
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
export function IssueDetail({ issue, onClose, variant = 'panel' }: IssueDetailProps) {
  const currentUser = useCurrentUser();
  const { workspace } = useSession();
  const toast = useToast();
  const openCreateIssue = useUiStore((s) => s.openCreateIssue);
  const openIssue = useUiStore((s) => s.openIssue);

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const members = useMemo<UserSummaryDto[]>(() => project?.members.map((m) => m.user) ?? [], [project]);
  const epics = useMemo(
    () => (epicPages?.pages.flatMap((p) => p.items) ?? []).filter((e) => e.id !== issue.id),
    [epicPages, issue.id],
  );

  const can = (permission: Permission) => issue.permissions.includes(permission);
  const canEdit = can(Permission.ISSUE_UPDATE);
  const canComment = can(Permission.COMMENT_CREATE);

  const patch = (values: Parameters<typeof updateIssue.mutate>[0]) => updateIssue.mutate(values);

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
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {/* ------------------------------------------------------------ header */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
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
            className="rounded-full transition-opacity hover:opacity-80 disabled:cursor-default"
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
            className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs text-text-muted hover:bg-surface-hover disabled:cursor-default"
          >
            <PriorityIcon priority={issue.priority} withTooltip={false} className="size-3.5" />
            <span className="hidden sm:inline">{PRIORITY_META[issue.priority].label}</span>
          </button>
        </PriorityPicker>

        <div className="ml-auto flex items-center gap-0.5">
          <Tooltip content="Copy link">
            <IconButton label="Скопировать ссылку" size="sm" onClick={() => void copyLink()}>
              <Link2 className="size-4" />
            </IconButton>
          </Tooltip>

          {variant === 'panel' && (
            <Tooltip content="Open full page">
              <Link
                to={`/issue/${issue.issueKey}`}
                onClick={onClose}
                aria-label="Открыть на отдельной странице"
                className="inline-flex size-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text"
              >
                <ExternalLink className="size-4" />
              </Link>
            </Tooltip>
          )}

          <Menu>
            <MenuTrigger asChild>
              <IconButton label="Действия с задачей" size="sm">
                <MoreHorizontal className="size-4" />
              </IconButton>
            </MenuTrigger>
            <MenuContent align="end" width={200} label="Действия с задачей">
              <MenuItem icon={<Copy className="size-3.5" />} onSelect={() => void copyLink()}>
                Copy link
              </MenuItem>
              {canEdit && issue.type !== 'SUBTASK' && (
                <MenuItem
                  icon={<Plus className="size-3.5" />}
                  onSelect={() => openCreateIssue({ projectId: issue.projectId, parentId: issue.id })}
                >
                  Добавить подзадачу
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
          variant === 'page' ? 'lg:flex lg:gap-6 lg:px-6 lg:py-5' : '',
        )}
      >
        <div className={clsx(variant === 'page' ? 'min-w-0 flex-1' : 'px-4 py-4')}>
          {/* Parent breadcrumb */}
          {issue.parent && (
            <button
              type="button"
              onClick={() => openIssue(issue.parent!.id)}
              className="mb-2 inline-flex items-center gap-1 text-xs text-text-subtle hover:text-accent"
            >
              <span className="fd-key">{issue.parent.issueKey}</span>
              <span className="max-w-64 truncate">{issue.parent.title}</span>
            </button>
          )}

          <TitleField value={issue.title} editable={canEdit} onSave={(title) => patch({ title })} />

          {/* Description */}
          <section className="mt-4" aria-label="Описание">
            <RichTextEditor
              value={issue.description}
              users={members}
              editable={canEdit}
              toolbar={canEdit}
              placeholder={canEdit ? 'Добавьте описание…' : 'Описания нет'}
              minHeight="4rem"
              onBlur={(description) => {
                if (JSON.stringify(description) !== JSON.stringify(issue.description)) {
                  patch({ description: description as Record<string, unknown> });
                }
              }}
            />
          </section>

          {/* Attachments */}
          <section className="mt-5" aria-label="Файлы">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                <Paperclip className="size-3.5" />
                Файлы
                {issue.attachments.length > 0 && (
                  <span className="text-text-subtle">({issue.attachments.length})</span>
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
                    className="group flex items-center gap-2 rounded-md border border-border bg-surface-sunken p-1.5"
                  >
                    {attachment.isImage ? (
                      <img
                        src={attachment.url}
                        alt=""
                        className="size-9 shrink-0 rounded-sm object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-surface-active text-text-subtle">
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
                <h3 className="text-xs font-semibold text-text-muted">
                  Подзадачи
                  {issue.subtasks.length > 0 && (
                    <span className="ml-1.5 text-text-subtle">
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
                <ul className="divide-y divide-border rounded-md border border-border">
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

          {/* Discussion */}
          <section className="mt-6" aria-label="Обсуждение">
            <div className="mb-3 flex items-center gap-1 border-b border-border">
              {(['comments', 'activity'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  aria-selected={tab === key}
                  role="tab"
                  className={clsx(
                    '-mb-px border-b-2 px-2.5 py-1.5 text-sm font-medium transition-colors',
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
          className={clsx(
            'shrink-0 border-border',
            variant === 'page'
              ? 'lg:w-72 lg:border-l lg:pl-6'
              : 'mt-2 border-t bg-surface-sunken px-4 py-3',
          )}
          aria-label="Свойства задачи"
        >
          <dl className="space-y-3">
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
              <span className="flex items-center gap-1.5 px-1.5 text-sm">
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
              >
                <FieldButton disabled={!canEdit} className="flex-wrap" label="Изменить метки">
                  {issue.labels.length === 0 ? (
                    <span className="text-text-subtle">Нет</span>
                  ) : (
                    issue.labels.map((label) => <LabelChip key={label.id} label={label} size="sm" />)
                  )}
                </FieldButton>
              </LabelPicker>
            </Field>

            <Field label="Проект">
              <Link
                to={`/projects/${issue.projectId}`}
                className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm hover:bg-surface-hover"
              >
                <span aria-hidden="true">{issue.project.icon}</span>
                {issue.project.name}
              </Link>
            </Field>

            {issue.type !== 'EPIC' && (
              <Field label="Эпик">
                <select
                  value={issue.epic?.id ?? ''}
                  disabled={!canEdit}
                  onChange={(event) => patch({ epicId: event.target.value || null })}
                  className="h-7 w-full rounded-md border border-transparent bg-transparent px-1.5 text-sm hover:border-border hover:bg-surface-hover focus:border-accent focus:outline-none disabled:cursor-default"
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
                  className="h-7 w-full rounded-md border border-transparent bg-transparent px-1.5 text-sm hover:border-border hover:bg-surface-hover focus:border-accent focus:outline-none disabled:cursor-default"
                >
                  <option value="">Бэклог</option>
                  {sprints.map((sprint) => (
                    <option key={sprint.id} value={sprint.id}>
                      {sprint.name}
                      {sprint.status === 'ACTIVE' ? ' (active)' : ''}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="Стори-поинты">
              <input
                type="number"
                min={0}
                max={100}
                disabled={!canEdit}
                defaultValue={issue.storyPoints ?? ''}
                key={issue.storyPoints ?? 'none'}
                onBlur={(event) => {
                  const raw = event.target.value;
                  const next = raw === '' ? null : Number(raw);
                  if (next !== issue.storyPoints) patch({ storyPoints: next });
                }}
                placeholder="—"
                className="h-7 w-full rounded-md border border-transparent bg-transparent px-1.5 text-sm hover:border-border hover:bg-surface-hover focus:border-accent focus:outline-none disabled:cursor-default"
              />
            </Field>

            <Field label="Срок">
              <DateField
                value={issue.dueDate}
                disabled={!canEdit}
                onChange={(dueDate) => patch({ dueDate })}
              />
            </Field>

            <div className="space-y-1 border-t border-border pt-3 text-2xs text-text-subtle">
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
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          deleteIssue.mutate(
            { id: issue.id, projectId: issue.projectId, issueKey: issue.issueKey },
            { onSuccess: () => onClose?.() },
          );
          setConfirmDelete(false);
        }}
        title={`Удалить ${issue.issueKey}?`}
        message="Задача, её комментарии, подзадачи и история будут удалены безвозвратно."
        confirmLabel="Удалить"
        danger
      />

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
}: {
  value: string;
  editable: boolean;
  onSave: (title: string) => void;
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
        onClick={() => editable && setEditing(true)}
        className={clsx(
          '-mx-1 rounded-md px-1 text-xl leading-snug font-semibold text-text',
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
      className="-mx-1 w-[calc(100%+0.5rem)] resize-none overflow-hidden rounded-md border border-accent bg-surface px-1 text-xl leading-snug font-semibold outline-none"
    />
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-start gap-2">
      <dt className="pt-1.5 text-xs text-text-subtle">{label}</dt>
      <dd className="min-w-0">{children}</dd>
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
}: {
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className={clsx(
        'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm',
        'border border-transparent transition-colors',
        !disabled && 'hover:border-border hover:bg-surface-hover',
        disabled && 'cursor-default',
        className,
      )}
    >
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</span>
      {!disabled && <ChevronDown className="size-3 shrink-0 text-text-subtle" />}
    </button>
  );
}
