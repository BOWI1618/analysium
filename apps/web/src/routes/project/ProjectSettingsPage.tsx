import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { PROJECT_ROLES, STATUS_CATEGORIES, Permission, type StatusCategory } from '@flowdesk/contracts';
import { GripVertical, Plus, Trash2, X } from 'lucide-react';
import { useSession } from '~/app/session';
import { useMembers } from '~/features/members/hooks';
import {
  useAddProjectMember,
  useCreateLabel,
  useCreateStatus,
  useDeleteLabel,
  useDeleteProject,
  useDeleteStatus,
  useProject,
  useRemoveProjectMember,
  useReorderStatuses,
  useUpdateLabel,
  useUpdateProject,
  useUpdateStatus,
} from '~/features/projects/hooks';
import { Button, IconButton } from '~/ui/Button';
import { Input, Select, Textarea, Checkbox } from '~/ui/Input';
import { Avatar } from '~/ui/Avatar';
import { Badge } from '~/ui/Badge';
import { ConfirmDialog } from '~/ui/Dialog';
import { ErrorState, Skeleton } from '~/ui/Feedback';
import { ProjectIcon } from '~/ui/ProjectIcon';
import { StatusDot } from '~/components/IssueMeta';
import { PROJECT_ROLE_LABEL, STATUS_CATEGORY_LABEL } from '~/lib/labels';
import { pluralize } from '~/lib/format';
import { PROJECT_ICONS, PROJECT_COLORS } from '~/lib/projectMeta';

const SECTIONS = ['general', 'workflow', 'labels', 'members', 'danger'] as const;
type Section = (typeof SECTIONS)[number];

const SECTION_LABELS: Record<Section, string> = {
  general: 'Основное',
  workflow: 'Статусы',
  labels: 'Метки',
  members: 'Участники',
  danger: 'Опасная зона',
};

/**
 * Project configuration. Every control here maps to a permission that the
 * server independently enforces — hiding a button is a courtesy, not the gate.
 */
export function ProjectSettingsPage() {
  const { projectId = '' } = useParams();
  const { workspace } = useSession();
  const navigate = useNavigate();
  const [section, setSection] = useState<Section>('general');

  const { data: project, isLoading, error, refetch } = useProject(projectId);

  if (isLoading) {
    return (
      <div className="space-y-3 bg-bg p-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-48 w-full max-w-2xl" />
      </div>
    );
  }
  if (error || !project) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const canManageWorkflow = project.permissions.includes(Permission.PROJECT_MANAGE_WORKFLOW);
  const canDelete = project.permissions.includes(Permission.PROJECT_DELETE);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-bg scrollbar-thin">
      <div className="mx-auto flex max-w-4xl gap-6 p-4">
        <nav className="hidden w-40 shrink-0 sm:block" aria-label="Разделы настроек">
          <ul className="space-y-1">
            {SECTIONS.filter((s) => s !== 'danger' || canDelete).map((item) => (
              <li key={item}>
                <button
                  type="button"
                  onClick={() => setSection(item)}
                  className={clsx(
                    'w-full border-2 px-2 py-1.5 text-left text-sm font-bold transition-colors',
                    section === item
                      ? 'border-border-strong bg-marker-subtle text-text'
                      : 'border-transparent text-text-muted hover:bg-surface-hover hover:text-text',
                    item === 'danger' && section !== item && 'text-danger',
                  )}
                >
                  {SECTION_LABELS[item]}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 flex-1 space-y-4">
          <div className="sm:hidden">
            <Select
              label="Раздел"
              value={section}
              onChange={(event) => setSection((event.target as HTMLSelectElement).value as Section)}
            >
              {SECTIONS.filter((s) => s !== 'danger' || canDelete).map((item) => (
                <option key={item} value={item}>
                  {SECTION_LABELS[item]}
                </option>
              ))}
            </Select>
          </div>

          {section === 'general' && <GeneralSection project={project} workspaceId={workspace?.id ?? ''} />}
          {section === 'workflow' && <WorkflowSection project={project} canManage={canManageWorkflow} />}
          {section === 'labels' && <LabelsSection project={project} />}
          {section === 'members' && <MembersSection project={project} workspaceId={workspace?.id ?? ''} />}
          {section === 'danger' && canDelete && (
            <DangerSection
              project={project}
              workspaceId={workspace?.id ?? ''}
              onDeleted={() => navigate('/projects')}
            />
          )}
        </div>
      </div>
    </div>
  );
}

type Project = NonNullable<ReturnType<typeof useProject>['data']>;

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="border-2 border-border-strong bg-surface p-4 shadow-md">
      <h2 className="fd-eyebrow">{title}</h2>
      {description && <p className="mt-1 text-xs text-text-muted">{description}</p>}
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

/* --------------------------------------------------------------- general */

function GeneralSection({ project, workspaceId }: { project: Project; workspaceId: string }) {
  const update = useUpdateProject(project.id, workspaceId);
  const [form, setForm] = useState({
    name: project.name,
    description: project.description ?? '',
    icon: project.icon,
    color: project.color,
    projectType: project.projectType,
  });

  const dirty =
    form.name !== project.name ||
    form.description !== (project.description ?? '') ||
    form.icon !== project.icon ||
    form.color !== project.color ||
    form.projectType !== project.projectType;

  const isPresetColor = PROJECT_COLORS.some((c) => c.value === form.color);
  const isPresetIcon = PROJECT_ICONS.some((i) => i.name === form.icon);

  return (
    <Card title="Основное" description="Название, внешний вид и методология.">
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-bold text-text">Иконка</label>
          <div className="flex flex-wrap items-center gap-2">
            {PROJECT_ICONS.map(({ name, label, Icon }) => {
              const selected = form.icon === name;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, icon: name }))}
                  aria-pressed={selected}
                  aria-label={`Иконка «${label}»`}
                  title={label}
                  className={clsx(
                    'flex size-8 items-center justify-center transition-colors',
                    selected
                      ? 'border-2 border-accent bg-marker-subtle text-accent'
                      : 'border-2 border-border-strong bg-surface text-text hover:bg-surface-hover',
                  )}
                >
                  <Icon className="size-4" />
                </button>
              );
            })}
            {!isPresetIcon && (
              <span className="flex size-8 items-center justify-center border-2 border-border-strong bg-surface-active text-sm">
                {form.icon}
              </span>
            )}
          </div>
          <Input
            value={form.icon}
            onChange={(event) => setForm((f) => ({ ...f, icon: event.target.value }))}
            placeholder="package"
            hint="Имя иконки из набора или произвольный символ."
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <Input
              label="Название"
              value={form.name}
              onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
            />
          </div>
          <div className="w-24">
            <Input
              label="Цвет"
              value={form.color}
              onChange={(event) => setForm((f) => ({ ...f, color: event.target.value }))}
              placeholder="#ff4d00"
              className="font-mono"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {PROJECT_COLORS.map(({ value, label }) => {
            const selected = form.color === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setForm((f) => ({ ...f, color: value }))}
                aria-pressed={selected}
                aria-label={`Цвет: ${label}`}
                title={label}
                className="size-7 border-2 border-border-strong"
                style={{
                  backgroundColor: value,
                  boxShadow: selected ? `0 0 0 2px var(--surface), 0 0 0 4px var(--border-strong)` : undefined,
                }}
              />
            );
          })}
        </div>

        <Textarea
          label="Описание"
          value={form.description}
          rows={2}
          onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
          placeholder="Для чего этот проект?"
        />

        <Select
          label="Методология"
          value={form.projectType}
          onChange={(event) =>
            setForm((f) => ({ ...f, projectType: (event.target as HTMLSelectElement).value as Project['projectType'] }))
          }
        >
          <option value="KANBAN">Канбан — непрерывный поток</option>
          <option value="SCRUM">Скрам — спринты и бэклог</option>
          <option value="SIMPLE">Простой — просто список работ</option>
        </Select>

        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty}
            loading={update.isPending}
            onClick={() =>
              update.mutate({
                name: form.name,
                description: form.description || null,
                icon: form.icon,
                color: form.color,
                projectType: form.projectType,
              })
            }
          >
            Сохранить
          </Button>
          <span className="fd-key">Ключ: {project.key}</span>
          <span className="text-2xs text-text-subtle">Ключ изменить нельзя — от него зависят ключи задач.</span>
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------- workflow */

function WorkflowSection({ project, canManage }: { project: Project; canManage: boolean }) {
  const createStatus = useCreateStatus(project.id);
  const updateStatus = useUpdateStatus(project.id);
  const deleteStatus = useDeleteStatus(project.id);
  const reorder = useReorderStatuses(project.id);

  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<StatusCategory>('UNSTARTED');
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

  const move = (index: number, direction: -1 | 1) => {
    const ids = project.statuses.map((s) => s.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    const next = [...ids];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    reorder.mutate(next);
  };

  return (
    <>
      <Card
        title="Колонки доски"
        description="Статусы задают колонки доски. Категория определяет, что считается «в работе» и «готово» в отчётах."
      >
        <ul className="divide-y-2 divide-border-strong border-2 border-border-strong">
          {project.statuses.map((status, index) => (
            <li key={status.id} className="flex flex-wrap items-center gap-2 p-2">
              {canManage && (
                <span className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`Поднять «${status.name}»`}
                    className="text-text-subtle hover:text-text disabled:opacity-30"
                  >
                    <GripVertical className="size-3.5 rotate-90" />
                  </button>
                </span>
              )}
              <StatusDot status={status} />

              <input
                defaultValue={status.name}
                disabled={!canManage}
                onBlur={(event) => {
                  const name = event.target.value.trim();
                  if (name && name !== status.name) updateStatus.mutate({ statusId: status.id, patch: { name } });
                }}
                aria-label={`Название статуса «${status.name}»`}
                className="h-7 min-w-32 flex-1 border-2 border-transparent bg-transparent px-1.5 text-sm hover:border-border-strong focus:border-accent focus:outline-none disabled:cursor-default"
              />

              <select
                defaultValue={status.category}
                disabled={!canManage}
                onChange={(event) =>
                  updateStatus.mutate({ statusId: status.id, patch: { category: event.target.value } })
                }
                aria-label={`Категория статуса «${status.name}»`}
                className="h-7 border-2 border-border-strong bg-surface px-1.5 text-xs disabled:opacity-60"
              >
                {STATUS_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {STATUS_CATEGORY_LABEL[category]}
                  </option>
                ))}
              </select>

              <input
                type="color"
                defaultValue={status.color}
                disabled={!canManage}
                onBlur={(event) => updateStatus.mutate({ statusId: status.id, patch: { color: event.target.value } })}
                aria-label={`Цвет статуса «${status.name}»`}
                className="h-7 w-10 cursor-pointer border-2 border-border-strong bg-surface p-0.5 disabled:cursor-default"
              />

              <input
                type="number"
                min={0}
                max={99}
                defaultValue={status.wipLimit ?? ''}
                disabled={!canManage}
                placeholder="WIP"
                onBlur={(event) => {
                  const raw = event.target.value;
                  const wipLimit = raw === '' ? null : Number(raw);
                  if (wipLimit !== status.wipLimit) updateStatus.mutate({ statusId: status.id, patch: { wipLimit } });
                }}
                aria-label={`WIP-лимит статуса «${status.name}»`}
                className="fd-num h-7 w-14 border-2 border-border-strong bg-surface px-1.5 text-xs disabled:opacity-60"
              />

              <span className="fd-num text-2xs text-text-subtle">{status.issueCount ?? 0}</span>

              {canManage && project.statuses.length > 1 && (
                <IconButton
                  label={`Удалить «${status.name}»`}
                  size="xs"
                  onClick={() => setDeleting({ id: status.id, name: status.name })}
                >
                  <Trash2 className="size-3.5 text-danger" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>

        {canManage && (
          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!newName.trim()) return;
              createStatus.mutate(
                { name: newName.trim(), category: newCategory },
                { onSuccess: () => setNewName('') },
              );
            }}
          >
            <div className="min-w-40 flex-1">
              <Input
                label="Новый статус"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="например, Заблокировано"
              />
            </div>
            <Select
              label="Категория"
              value={newCategory}
              onChange={(event) => setNewCategory((event.target as HTMLSelectElement).value as StatusCategory)}
              className="w-36"
            >
              {STATUS_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {STATUS_CATEGORY_LABEL[category]}
                </option>
              ))}
            </Select>
            <Button type="submit" size="md" variant="secondary" iconLeft={<Plus className="size-3.5" />} loading={createStatus.isPending}>
              Добавить статус
            </Button>
          </form>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) deleteStatus.mutate({ statusId: deleting.id });
          setDeleting(null);
        }}
        title={`Удалить «${deleting?.name}»?`}
        message="Задачи из этой колонки перейдут в статус по умолчанию. Ни одна задача не будет удалена."
        confirmLabel="Удалить статус"
        danger
      />
    </>
  );
}

/* ---------------------------------------------------------------- labels */

function LabelsSection({ project }: { project: Project }) {
  const createLabel = useCreateLabel(project.id);
  const updateLabel = useUpdateLabel(project.id);
  const deleteLabel = useDeleteLabel(project.id);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#ff4d00');

  return (
    <Card title="Метки" description="Общий словарь для фильтрации на досках и в списках.">
      <ul className="flex flex-wrap gap-2">
        {project.labels.map((label) => (
          <li
            key={label.id}
            className="flex items-center gap-1.5 border-2 border-border-strong bg-surface-sunken py-0.5 pr-1 pl-2"
          >
            <input
              type="color"
              defaultValue={label.color}
              onBlur={(event) => updateLabel.mutate({ labelId: label.id, patch: { color: event.target.value } })}
              aria-label={`Цвет метки «${label.name}»`}
              className="size-4 cursor-pointer border-none bg-transparent p-0"
            />
            <input
              defaultValue={label.name}
              onBlur={(event) => {
                const next = event.target.value.trim();
                if (next && next !== label.name) updateLabel.mutate({ labelId: label.id, patch: { name: next } });
              }}
              aria-label={`Название метки «${label.name}»`}
              size={Math.max(label.name.length, 4)}
              className="bg-transparent text-xs outline-none"
            />
            <button
              type="button"
              onClick={() => deleteLabel.mutate(label.id)}
              aria-label={`Удалить метку «${label.name}»`}
              className="p-0.5 text-text-subtle hover:bg-danger-subtle hover:text-danger"
            >
              <X className="size-3" />
            </button>
          </li>
        ))}
        {project.labels.length === 0 && <p className="text-xs text-text-subtle">Меток пока нет.</p>}
      </ul>

      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          createLabel.mutate({ name: name.trim(), color }, { onSuccess: () => setName('') });
        }}
      >
        <div className="min-w-40 flex-1">
          <Input label="Новая метка" value={name} onChange={(event) => setName(event.target.value)} placeholder="например, безопасность" />
        </div>
        <div className="w-20">
          <label className="mb-1 block text-xs font-bold text-text" htmlFor="label-color">
            Цвет
          </label>
          <input
            id="label-color"
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="h-8 w-full cursor-pointer border-2 border-border-strong bg-surface p-1"
          />
        </div>
        <Button type="submit" variant="secondary" iconLeft={<Plus className="size-3.5" />} loading={createLabel.isPending}>
          Добавить метку
        </Button>
      </form>
    </Card>
  );
}

/* --------------------------------------------------------------- members */

function MembersSection({ project, workspaceId }: { project: Project; workspaceId: string }) {
  const { data: workspaceMembers } = useMembers(workspaceId);
  const addMember = useAddProjectMember(project.id);
  const removeMember = useRemoveProjectMember(project.id);

  const projectMemberIds = new Set(project.members.map((m) => m.userId));
  const available = (workspaceMembers ?? []).filter((m) => !projectMemberIds.has(m.user.id));

  return (
    <Card
      title="Участники проекта"
      description="Гости видят только те проекты, куда их добавили. Остальные видят все проекты пространства."
    >
      <ul className="divide-y-2 divide-border-strong border-2 border-border-strong">
        {project.members.map((member) => (
          <li key={member.userId} className="flex items-center gap-2.5 p-2">
            <Avatar user={member.user} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{member.user.name}</p>
              <p className="truncate text-2xs text-text-subtle">{member.user.email}</p>
            </div>
            <Badge tone={member.role === 'LEAD' ? 'accent' : 'neutral'}>{member.role.toLowerCase()}</Badge>
            <IconButton
              label={`Убрать ${member.user.name}`}
              size="xs"
              onClick={() => removeMember.mutate(member.userId)}
            >
              <X className="size-3.5" />
            </IconButton>
          </li>
        ))}
      </ul>

      {available.length > 0 && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const userId = String(form.get('userId') ?? '');
            const role = String(form.get('role') ?? 'CONTRIBUTOR');
            if (userId) addMember.mutate({ userId, role });
          }}
        >
          <div className="min-w-44 flex-1">
            <Select name="userId" label="Добавить участника">
              {available.map((member) => (
                <option key={member.user.id} value={member.user.id}>
                  {member.user.name}
                </option>
              ))}
            </Select>
          </div>
          <Select name="role" label="Роль" className="w-36" defaultValue="CONTRIBUTOR">
            {PROJECT_ROLES.map((role) => (
              <option key={role} value={role}>
                {PROJECT_ROLE_LABEL[role]}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary" loading={addMember.isPending}>
            Добавить
          </Button>
        </form>
      )}
    </Card>
  );
}

/* ----------------------------------------------------------------- danger */

function DangerSection({
  project,
  workspaceId,
  onDeleted,
}: {
  project: Project;
  workspaceId: string;
  onDeleted: () => void;
}) {
  const update = useUpdateProject(project.id, workspaceId);
  const deleteProject = useDeleteProject(workspaceId);
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <>
      <Card title="Архивировать проект" description="Проект скроется из списков и поиска. Ничего не удаляется, можно вернуть обратно.">
        <Button
          variant="secondary"
          size="sm"
          loading={update.isPending}
          onClick={() => update.mutate({ isArchived: !project.isArchived })}
        >
          {project.isArchived ? 'Вернуть из архива' : 'Архивировать проект'}
        </Button>
      </Card>

      <section className="border-2 border-danger-border bg-danger-subtle p-4 shadow-sm">
        <h2 className="fd-eyebrow text-danger">Удалить проект</h2>
        <p className="mt-0.5 text-xs text-text-muted">
          Безвозвратно удалит {pluralize(project.totalIssueCount ?? 0, ['задачу', 'задачи', 'задач'])}, их комментарии,
          файлы и историю. Отменить нельзя.
        </p>
        <div className="mt-3 space-y-2">
          <Checkbox
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            label={<span className="text-xs">Я понимаю, что это необратимо</span>}
          />
          <Button variant="danger" size="sm" disabled={!acknowledged} onClick={() => setConfirming(true)}>
            Удалить {project.key}
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          deleteProject.mutate(project.id, { onSuccess: onDeleted });
          setConfirming(false);
        }}
        title={`Удалить проект «${project.name}»?`}
        message="Все задачи, комментарии, файлы и спринты проекта будут удалены навсегда."
        confirmLabel="Удалить навсегда"
        danger
        loading={deleteProject.isPending}
      />
    </>
  );
}
