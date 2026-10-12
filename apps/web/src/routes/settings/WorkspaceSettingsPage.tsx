import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import type { AuditLogDto, CreatedInviteCodeDto, WorkspaceRole } from '@flowdesk/contracts';
import { Permission, WORKSPACE_ROLES, outranks } from '@flowdesk/contracts';
import { Check, KeyRound, Link2, Plus, Trash2 } from 'lucide-react';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { useSession } from '~/app/session';
import { useRealtime } from '~/app/realtime';
import { useToast } from '~/app/toast';
import {
  roleChoice,
  useCreateInviteCode,
  useInviteCodes,
  useMembers,
  useRevokeInviteCode,
  useRemoveMember,
  useResetMemberPassword,
  useUpdateMemberRole,
  useUpdateWorkspace,
} from '~/features/members/hooks';
import { useProjects } from '~/features/projects/hooks';
import { Topbar } from '~/components/Topbar';
import { Avatar } from '~/ui/Avatar';
import { Badge } from '~/ui/Badge';
import { Button, IconButton } from '~/ui/Button';
import { Checkbox, Input, Select } from '~/ui/Input';
import { ConfirmDialog } from '~/ui/Dialog';
import { EmptyState, Skeleton } from '~/ui/Feedback';
import { ProjectIcon } from '~/ui/ProjectIcon';
import { fullDate, pluralize, relativeTime } from '~/lib/format';
import { AUDIT_ACTION_LABEL, ROLE_LABEL, describeAuditDetails } from '~/lib/labels';
import { DepartmentsSection } from './DepartmentsSection';
import { projectTree } from '~/features/projects/tree';
import { TemplatesSection } from './TemplatesSection';
import { RolesSection } from './RolesSection';
import { useRoles } from '~/features/roles/hooks';

const SECTIONS = ['general', 'members', 'departments', 'templates', 'roles', 'projects', 'audit'] as const;
type Section = (typeof SECTIONS)[number];

const SECTION_LABELS: Record<Section, string> = {
  general: 'Основное',
  members: 'Участники',
  departments: 'Отделы',
  templates: 'Шаблоны задач',
  roles: 'Роли и права',
  projects: 'Проекты',
  audit: 'Журнал аудита',
};

export function WorkspaceSettingsPage() {
  const { workspace, user } = useSession();
  // A link from elsewhere can open a particular section: «Состав» on the
  // department screen leads straight to the departments.
  const [searchParams] = useSearchParams();
  const requested = searchParams.get('section') as Section | null;
  const [section, setSection] = useState<Section>(requested && SECTIONS.includes(requested) ? requested : 'general');

  if (!workspace || !user) return null;

  // By what the server says the person may do: a role of the workspace's own has no set the page could know.
  const may = (permission: Permission) => workspace.permissions.includes(permission);
  const visible = SECTIONS.filter((s) =>
    s === 'audit'
      ? may(Permission.WORKSPACE_VIEW_AUDIT)
      : s === 'departments'
        ? may(Permission.WORKSPACE_MANAGE_MEMBERS)
        : s === 'templates'
          ? may(Permission.WORKSPACE_UPDATE)
          : true,
  );
  // An address naming a section the viewer may not see falls back to the first one.
  const current: Section = visible.includes(section) ? section : 'general';

  return (
    <>
      <Topbar breadcrumbs={[{ label: workspace.name }, { label: 'Настройки' }]} />

      <div className="min-h-0 flex-1 overflow-y-auto bg-bg scrollbar-thin">
        <div className="mx-auto flex max-w-4xl gap-6 p-4 sm:p-6">
          <nav className="hidden w-44 shrink-0 sm:block" aria-label="Разделы настроек">
            <ul className="space-y-1">
              {visible.map((item) => (
                <li key={item}>
                  <button
                    type="button"
                    onClick={() => setSection(item)}
                    className={clsx(
                      'w-full border-2 px-2 py-1.5 text-left text-sm font-bold transition-colors',
                      current === item
                        ? 'border-border-strong bg-marker-subtle text-text'
                        : 'border-transparent text-text-muted hover:bg-surface-hover hover:text-text',
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
                value={current}
                onChange={(event) => setSection((event.target as HTMLSelectElement).value as Section)}
              >
                {visible.map((item) => (
                  <option key={item} value={item}>
                    {SECTION_LABELS[item]}
                  </option>
                ))}
              </Select>
            </div>

            {current === 'general' && <GeneralSection />}
            {current === 'members' && <MembersSection />}
            {current === 'departments' && <DepartmentsSection />}
            {current === 'templates' && <TemplatesSection />}
            {current === 'roles' && <RolesSection />}
            {current === 'projects' && <ProjectsSection />}
            {current === 'audit' && <AuditSection />}
          </div>
        </div>
      </div>
    </>
  );
}

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

function GeneralSection() {
  const { workspace, user } = useSession();
  const update = useUpdateWorkspace(workspace?.id ?? '');
  const [name, setName] = useState(workspace?.name ?? '');
  const [logo, setLogo] = useState(workspace?.logo ?? '');

  if (!workspace) return null;
  const dirty = name !== workspace.name || logo !== (workspace.logo ?? '');
  const canUpdate = Boolean(user) && workspace.permissions.includes(Permission.WORKSPACE_UPDATE);

  return (
    <>
    <Card title="Пространство" description="Как пространство видят все его участники.">
      <div className="space-y-3">
        <div className="flex gap-3">
          <div className="w-20">
            <Input
              label="Логотип"
              value={logo}
              maxLength={4}
              onChange={(event) => setLogo(event.target.value)}
              className="text-center text-lg"
              placeholder="A"
            />
          </div>
          <div className="flex-1">
            <Input label="Название" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
        </div>

        <Input label="Адрес" value={workspace.slug} disabled hint="Адрес задаётся при создании и не меняется." />

        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty}
            loading={update.isPending}
            onClick={() => update.mutate({ name, logo: logo || null })}
          >
            Сохранить
          </Button>
          <span className="fd-num text-2xs text-text-subtle">
            {pluralize(workspace.memberCount, ['участник', 'участника', 'участников'])} ·{' '}
            {pluralize(workspace.projectCount, ['проект', 'проекта', 'проектов'])}
          </span>
        </div>
      </div>
    </Card>

    <Card
      title="Сроки задач"
      description="Для всех проектов пространства. Менять могут владелец и администраторы."
    >
      <Checkbox
        checked={workspace.carryOverTasks}
        disabled={!canUpdate || update.isPending}
        onChange={(event) => update.mutate({ carryOverTasks: event.target.checked })}
        label={<span className="text-sm font-bold">Переносить невыполненные задачи на следующий день</span>}
      />
      <p className="mt-1.5 pl-6 text-xs text-text-muted">
        Задача, день которой прошёл, а она не закрыта, сама встаёт на сегодня: меняется сам срок, и просроченной
        она после этого не считается. Задержка не теряется — на задаче остаются счётчик дней переноса и исходный срок,
        а каждый перенос записывается в её историю. Счётчик сбрасывается, когда срок меняют вручную.
      </p>
    </Card>
    </>
  );
}

/* --------------------------------------------------------------- members */

function MembersSection() {
  const { workspace, user } = useSession();
  const workspaceId = workspace?.id ?? '';
  const { onlineUserIds } = useRealtime();

  const { data: members, isLoading } = useMembers(workspaceId);
  const updateRole = useUpdateMemberRole(workspaceId);
  const removeMember = useRemoveMember(workspaceId);
  const resetPassword = useResetMemberPassword(workspaceId);
  const toast = useToast();

  // Computed before the early return: the links query below is a hook and has
  // to run on every render.
  const canManage = Boolean(workspace && user && workspace.permissions.includes(Permission.WORKSPACE_MANAGE_MEMBERS));
  // Roles of the workspace's own stand in every list a role is chosen from, after the built-in ones.
  const { data: roles } = useRoles(workspaceId);
  const ownRoles = (roles ?? []).filter((item) => item.scope === 'WORKSPACE');
  const roleOptions = (
    <>
      {WORKSPACE_ROLES.filter((r) => r !== 'OWNER').map((option) => (
        <option key={option} value={option}>
          {ROLE_LABEL[option as WorkspaceRole]}
        </option>
      ))}
      {ownRoles.length > 0 && (
        <optgroup label="Свои роли">
          {ownRoles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
  // Letting people in is the owner's alone: nobody else makes or sees the links.
  const grantsAccess = workspace?.role === 'OWNER';
  const { data: codes } = useInviteCodes(workspaceId, grantsAccess);
  const createCode = useCreateInviteCode(workspaceId);
  const revokeCode = useRevokeInviteCode(workspaceId);

  const [role, setRole] = useState<string>('MEMBER');
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [resetting, setResetting] = useState<{ id: string; name: string; email: string } | null>(null);
  const [created, setCreated] = useState<CreatedInviteCodeDto | null>(null);

  if (!workspace || !user) return null;

  return (
    <>
      {grantsAccess && (
        <Card
          title="Выдать доступ"
          description="Создайте ссылку и передайте её человеку. По ней он задаст себе имя, логин и пароль и попадёт в пространство. Другого способа войти нет, и ссылки создаёте только вы."
        >
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              createCode.mutate(roleChoice(role, WORKSPACE_ROLES), { onSuccess: (code) => setCreated(code) });
            }}
          >
            <Select
              label="Роль"
              value={role}
              onChange={(event) => setRole((event.target as HTMLSelectElement).value)}
              className="w-48"
            >
              {roleOptions}
            </Select>
            <Button type="submit" variant="secondary" iconLeft={<Plus className="size-3.5" />} loading={createCode.isPending}>
              Создать ссылку
            </Button>
          </form>

          {created && <InviteCodePanel invite={created} onClose={() => setCreated(null)} />}

          {codes && codes.length > 0 && (
            <div className="mt-4">
              <p className="fd-eyebrow mb-2">Действующие ссылки</p>
              <ul className="divide-y-2 divide-border-strong border-2 border-border-strong">
                {codes.map((code) => (
                  <li key={code.id} className="flex flex-wrap items-center gap-2.5 p-2.5 text-xs">
                    <Badge tone="neutral">{code.customRole?.name ?? ROLE_LABEL[code.role]}</Badge>
                    <span className="min-w-0 flex-1 text-text-muted">
                      {code.createdBy ? `создал(а) ${code.createdBy.name}` : 'создатель удалён'} ·{' '}
                      <span title={fullDate(code.createdAt)}>{relativeTime(code.createdAt)}</span>
                    </span>
                    <span className="fd-num text-text-subtle" title={fullDate(code.expiresAt)}>
                      до {fullDate(code.expiresAt)}
                    </span>
                    <Button
                      size="xs"
                      variant="ghost"
                      loading={revokeCode.isPending && revokeCode.variables === code.id}
                      onClick={() => revokeCode.mutate(code.id)}
                    >
                      Отозвать
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-2xs text-text-subtle">
                Сама ссылка здесь не показывается — она видна только при создании.
                Потеряли — отзовите и создайте новую.
              </p>
            </div>
          )}
        </Card>
      )}

      <Card title={`Участники (${members?.length ?? 0})`}>
        {isLoading ? (
          <Skeleton className="h-32" />
        ) : (
          <ul className="divide-y-2 divide-border-strong border-2 border-border-strong">
            {members?.map((member) => {
              const isSelf = member.user.id === user.id;
              const canChange = canManage && member.role !== 'OWNER' && outranks(workspace.role, member.role);
              const online = onlineUserIds.includes(member.user.id);

              return (
                <li key={member.id} className="flex flex-wrap items-center gap-2.5 p-2.5">
                  <span className="relative">
                    <Avatar user={member.user} size="lg" />
                    {online && (
                      <span
                        className="absolute -right-0.5 -bottom-0.5 size-2.5 bg-success ring-2 ring-[var(--surface)]"
                        title="Сейчас онлайн"
                      />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {member.user.name}
                      {isSelf && <span className="ml-1.5 text-2xs text-text-subtle">вы</span>}
                    </p>
                    <p className="truncate text-2xs text-text-subtle">{member.user.email}</p>
                  </div>

                  {member.user.status === 'INVITED' && <Badge tone="warning">Приглашён</Badge>}
                  {member.passwordResetExpiresAt && (
                    <span title={`Может войти без пароля до ${fullDate(member.passwordResetExpiresAt)}`}>
                      <Badge tone="warning">Пароль сброшен</Badge>
                    </span>
                  )}

                  <span className="fd-num hidden text-2xs text-text-subtle sm:inline">
                    {member.user.lastActiveAt ? relativeTime(member.user.lastActiveAt) : 'не заходил(а)'}
                  </span>

                  {canChange ? (
                    <select
                      value={member.customRole?.id ?? member.role}
                      onChange={(event) =>
                        updateRole.mutate({ memberId: member.id, role: roleChoice(event.target.value, WORKSPACE_ROLES) })
                      }
                      aria-label={`Роль участника ${member.user.name}`}
                      className="h-7 max-w-44 border-2 border-border-strong bg-surface px-1.5 text-xs"
                    >
                      {roleOptions}
                    </select>
                  ) : (
                    <Badge tone={member.role === 'OWNER' ? 'accent' : 'neutral'}>
                      {member.customRole?.name ?? ROLE_LABEL[member.role]}
                    </Badge>
                  )}

                  {canChange && !isSelf && member.user.status === 'ACTIVE' && (
                    <IconButton
                      label={`Сбросить пароль: ${member.user.name}`}
                      size="xs"
                      onClick={() =>
                        setResetting({ id: member.id, name: member.user.name, email: member.user.email })
                      }
                    >
                      <KeyRound className="size-3.5" />
                    </IconButton>
                  )}

                  {(canChange || isSelf) && member.role !== 'OWNER' && (
                    <IconButton
                      label={isSelf ? 'Покинуть пространство' : `Убрать ${member.user.name}`}
                      size="xs"
                      onClick={() => setRemoving({ id: member.id, name: isSelf ? 'себя' : member.user.name })}
                    >
                      <Trash2 className="size-3.5 text-danger" />
                    </IconButton>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) removeMember.mutate(removing.id);
          setRemoving(null);
        }}
        title={`Убрать ${removing?.name}?`}
        message="Доступ к пространству пропадёт сразу. Задачи и комментарии останутся."
        confirmLabel="Убрать"
        danger
      />

      <ConfirmDialog
        open={Boolean(resetting)}
        onClose={() => setResetting(null)}
        onConfirm={() => {
          const target = resetting;
          setResetting(null);
          if (!target) return;
          resetPassword.mutate(target.id, {
            onSuccess: () =>
              toast.success(
                'Пароль сброшен',
                `${target.name} может в течение суток войти по логину ${target.email} с пустым паролем и задать новый. Сообщите об этом.`,
              ),
          });
        }}
        title={`Сбросить пароль: ${resetting?.name}?`}
        message="Текущий пароль перестанет работать, а все входы на устройствах завершатся. В течение суток человек сможет войти только по логину, оставив пароль пустым, — и сразу задаст новый. Сообщите ему об этом сами."
        confirmLabel="Сбросить пароль"
        danger
      />
    </>
  );
}

/**
 * The access link that was just created.
 *
 * This is the only time it can be shown: the server keeps a hash of the code
 * the link carries, not the code. The code is given too, small — for the case
 * when a link cannot be sent and has to be read out.
 */
function InviteCodePanel({ invite, onClose }: { invite: CreatedInviteCodeDto; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/join?code=${encodeURIComponent(invite.code)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Clipboard access can be refused; the link stays selectable on screen.
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-3 border-2 border-border-strong bg-surface-sunken p-3">
      <p className="text-sm font-bold">Ссылка для роли «{invite.customRole?.name ?? ROLE_LABEL[invite.role]}»</p>
      <p className="mt-0.5 text-xs text-text-muted">
        Скопируйте сейчас — после закрытия ссылка больше не покажется. Она одноразовая и действует до{' '}
        {fullDate(invite.expiresAt)}.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          aria-label="Ссылка для входа"
          className="fd-num min-w-0 flex-1 basis-64 select-all border-2 border-border-strong bg-surface px-2.5 py-1.5 text-xs break-all"
        >
          {link}
        </span>
        <Button
          size="sm"
          variant="primary"
          iconLeft={copied ? <Check className="size-3.5" /> : <Link2 className="size-3.5" />}
          onClick={() => void copy()}
        >
          {copied ? 'Скопировано' : 'Скопировать ссылку'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Готово
        </Button>
      </div>
      <p className="mt-2 text-2xs text-text-subtle">
        Если ссылку не переслать, продиктуйте код из неё:{' '}
        <span aria-label="Код из ссылки" className="fd-num font-bold tracking-widest text-text select-all">
          {invite.code}
        </span>
        . Его вводят на странице входа, по строке «Вас пригласили?».
      </p>
    </div>
  );
}

/* -------------------------------------------------------------- projects */

function ProjectsSection() {
  const { workspace } = useSession();
  const { data: projects, isLoading } = useProjects(workspace?.id ?? '', true);

  return (
    <Card title="Все проекты" description="Все проекты пространства, включая архивные.">
      {isLoading ? (
        <Skeleton className="h-32" />
      ) : projects && projects.length > 0 ? (
        <ul className="divide-y-2 divide-border-strong border-2 border-border-strong">
          {/* Subprojects under their project, as everywhere else. */}
          {projectTree(projects).map(({ project, children }) => {
            const line = (item: typeof project) => (
              <span className="flex items-center gap-2.5 p-2.5">
                <ProjectIcon icon={item.icon} color={item.color} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span>
                <span className="fd-key">{item.key}</span>
                {item.projectType === 'SCRUM' && <Badge>спринты</Badge>}
                {item.isArchived && <Badge tone="warning">в архиве</Badge>}
                <span className="fd-num text-2xs text-text-subtle">
                  {pluralize(item.totalIssueCount ?? 0, ['задача', 'задачи', 'задач'])}
                </span>
              </span>
            );
            return (
              <li key={project.id}>
                {line(project)}
                {children.length > 0 && (
                  <ul className="mb-1.5 ml-4 border-l-2 border-border-strong" aria-label={`Подпроекты «${project.name}»`}>
                    {children.map((child) => (
                      <li key={child.id}>{line(child)}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState compact title="Проектов пока нет" />
      )}
    </Card>
  );
}

/* ----------------------------------------------------------------- audit */

function AuditSection() {
  const { workspace } = useSession();
  const workspaceId = workspace?.id ?? '';

  const { data, isLoading } = useQuery({
    queryKey: qk.auditLogs(workspaceId),
    queryFn: () =>
      api.get<{ items: AuditLogDto[]; nextCursor: string | null }>(
        `/workspaces/${workspaceId}/audit-logs`,
        { query: { limit: 50 } },
      ),
    enabled: Boolean(workspaceId),
  });

  const entries = useMemo(() => data?.items ?? [], [data]);

  return (
    <Card title="Журнал аудита" description="Действия, важные для безопасности. Сначала свежие.">
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : entries.length === 0 ? (
        <EmptyState compact title="Записей пока нет" />
      ) : (
        <ul className="divide-y-2 divide-border-strong border-2 border-border-strong">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2.5 p-2.5">
              <Avatar user={entry.actor} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs">
                  <span className="font-medium">{entry.actor?.name ?? 'Система'}</span>{' '}
                  <span className="text-text-muted">
                    {AUDIT_ACTION_LABEL[entry.action] ?? entry.action.replace(/_/g, ' ').toLowerCase()}
                  </span>
                </p>
                {describeAuditDetails(entry.action, entry.metadata) && (
                  <p className="truncate text-2xs text-text-subtle">{describeAuditDetails(entry.action, entry.metadata)}</p>
                )}
              </div>
              <span className="fd-num shrink-0 text-2xs text-text-subtle" title={fullDate(entry.createdAt)}>
                {relativeTime(entry.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
