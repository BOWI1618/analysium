import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import type { AuditLogDto, CreatedInviteCodeDto, WorkspaceRole } from '@flowdesk/contracts';
import { Permission, WORKSPACE_ROLES, can, outranks } from '@flowdesk/contracts';
import { Check, Copy, KeyRound, Link2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { useSession } from '~/app/session';
import { useRealtime } from '~/app/realtime';
import { useToast } from '~/app/toast';
import {
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
import { Input, Select } from '~/ui/Input';
import { ConfirmDialog } from '~/ui/Dialog';
import { EmptyState, Skeleton } from '~/ui/Feedback';
import { ProjectIcon } from '~/ui/ProjectIcon';
import { fullDate, pluralize, relativeTime } from '~/lib/format';
import { AUDIT_ACTION_LABEL, ROLE_LABEL, describeAuditDetails } from '~/lib/labels';

const SECTIONS = ['general', 'members', 'roles', 'projects', 'audit'] as const;
type Section = (typeof SECTIONS)[number];

const SECTION_LABELS: Record<Section, string> = {
  general: 'Основное',
  members: 'Участники',
  roles: 'Роли и права',
  projects: 'Проекты',
  audit: 'Журнал аудита',
};

export function WorkspaceSettingsPage() {
  const { workspace, user } = useSession();
  const [section, setSection] = useState<Section>('general');

  if (!workspace || !user) return null;

  const actor = { userId: user.id, workspaceId: workspace.id, workspaceRole: workspace.role };
  const visible = SECTIONS.filter((s) =>
    s === 'audit' ? can(actor, Permission.WORKSPACE_VIEW_AUDIT) : true,
  );

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
                      section === item
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
                value={section}
                onChange={(event) => setSection((event.target as HTMLSelectElement).value as Section)}
              >
                {visible.map((item) => (
                  <option key={item} value={item}>
                    {SECTION_LABELS[item]}
                  </option>
                ))}
              </Select>
            </div>

            {section === 'general' && <GeneralSection />}
            {section === 'members' && <MembersSection />}
            {section === 'roles' && <RolesSection />}
            {section === 'projects' && <ProjectsSection />}
            {section === 'audit' && <AuditSection />}
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
  const { workspace } = useSession();
  const update = useUpdateWorkspace(workspace?.id ?? '');
  const [name, setName] = useState(workspace?.name ?? '');
  const [logo, setLogo] = useState(workspace?.logo ?? '');

  if (!workspace) return null;
  const dirty = name !== workspace.name || logo !== (workspace.logo ?? '');

  return (
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

  // Computed before the early return: the codes query below is a hook and has
  // to run on every render, and only managers are allowed to list codes.
  const canManage =
    workspace && user
      ? can({ userId: user.id, workspaceId, workspaceRole: workspace.role }, Permission.WORKSPACE_MANAGE_MEMBERS)
      : false;
  const { data: codes } = useInviteCodes(workspaceId, canManage);
  const createCode = useCreateInviteCode(workspaceId);
  const revokeCode = useRevokeInviteCode(workspaceId);

  const [role, setRole] = useState<string>('MEMBER');
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [resetting, setResetting] = useState<{ id: string; name: string; email: string } | null>(null);
  const [created, setCreated] = useState<CreatedInviteCodeDto | null>(null);

  if (!workspace || !user) return null;

  return (
    <>
      {canManage && (
        <Card
          title="Пригласить в команду"
          description="Создайте код и передайте его человеку. Он введёт код на странице входа, а имя, почту и пароль задаст сам."
        >
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              createCode.mutate(role, { onSuccess: (code) => setCreated(code) });
            }}
          >
            <Select
              label="Роль"
              value={role}
              onChange={(event) => setRole((event.target as HTMLSelectElement).value)}
              className="w-40"
            >
              {WORKSPACE_ROLES.filter((r) => r !== 'OWNER').map((option) => (
                <option key={option} value={option}>
                  {ROLE_LABEL[option as WorkspaceRole]}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="secondary" iconLeft={<Plus className="size-3.5" />} loading={createCode.isPending}>
              Создать код
            </Button>
          </form>

          {created && <InviteCodePanel invite={created} onClose={() => setCreated(null)} />}

          {codes && codes.length > 0 && (
            <div className="mt-4">
              <p className="fd-eyebrow mb-2">Действующие коды</p>
              <ul className="divide-y-2 divide-border-strong border-2 border-border-strong">
                {codes.map((code) => (
                  <li key={code.id} className="flex flex-wrap items-center gap-2.5 p-2.5 text-xs">
                    <Badge tone="neutral">{ROLE_LABEL[code.role]}</Badge>
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
                Сам код здесь не показывается — он хранится в зашифрованном виде и виден только при создании.
                Потеряли — отзовите и создайте новый.
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
                      value={member.role}
                      onChange={(event) => updateRole.mutate({ memberId: member.id, role: event.target.value })}
                      aria-label={`Роль участника ${member.user.name}`}
                      className="h-7 border-2 border-border-strong bg-surface px-1.5 text-xs"
                    >
                      {WORKSPACE_ROLES.filter((r) => r !== 'OWNER').map((option) => (
                        <option key={option} value={option}>
                          {ROLE_LABEL[option as WorkspaceRole]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Badge tone={member.role === 'OWNER' ? 'accent' : 'neutral'}>{ROLE_LABEL[member.role]}</Badge>
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
                `${target.name} может в течение суток войти по почте ${target.email} с пустым паролем и задать новый. Сообщите об этом.`,
              ),
          });
        }}
        title={`Сбросить пароль: ${resetting?.name}?`}
        message="Текущий пароль перестанет работать, а все входы на устройствах завершатся. В течение суток человек сможет войти только по почте, оставив пароль пустым, — и сразу задаст новый. Сообщите ему об этом сами."
        confirmLabel="Сбросить пароль"
        danger
      />
    </>
  );
}

/**
 * The code that was just created.
 *
 * This is the only time it can be shown: the server keeps a hash, not the code.
 * Both forms are offered — the bare code to dictate or type, and a link that
 * opens the join page with the code already filled in.
 */
function InviteCodePanel({ invite, onClose }: { invite: CreatedInviteCodeDto; onClose: () => void }) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const link = `${window.location.origin}/join?code=${encodeURIComponent(invite.code)}`;

  const copy = async (what: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(what === 'code' ? invite.code : link);
    } catch {
      // Clipboard access can be refused; the values stay selectable on screen.
      return;
    }
    setCopied(what);
    window.setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="mt-3 border-2 border-border-strong bg-surface-sunken p-3">
      <p className="text-sm font-bold">Код для роли «{ROLE_LABEL[invite.role]}»</p>
      <p className="mt-0.5 text-xs text-text-muted">
        Скопируйте сейчас — после закрытия код больше не покажется. Он одноразовый и действует до{' '}
        {fullDate(invite.expiresAt)}.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          aria-label="Код приглашения"
          className="fd-num select-all border-2 border-border-strong bg-surface px-3 py-1.5 text-xl font-bold tracking-[0.2em]"
        >
          {invite.code}
        </span>
        <Button
          size="sm"
          variant="primary"
          iconLeft={copied === 'code' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          onClick={() => void copy('code')}
        >
          {copied === 'code' ? 'Скопировано' : 'Код'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          iconLeft={copied === 'link' ? <Check className="size-3.5" /> : <Link2 className="size-3.5" />}
          onClick={() => void copy('link')}
        >
          {copied === 'link' ? 'Скопировано' : 'Ссылка с кодом'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Готово
        </Button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- roles */

const ROLE_MATRIX: { role: WorkspaceRole; summary: string; grants: string[] }[] = [
  {
    role: 'OWNER',
    summary: 'Полный контроль, включая удаление пространства.',
    grants: ['Всё, что может администратор', 'Удалить пространство', 'Нельзя исключить из пространства'],
  },
  {
    role: 'ADMIN',
    summary: 'Ведёт пространство изо дня в день.',
    grants: [
      'Управлять участниками и ролями',
      'Создавать, править и удалять любой проект',
      'Править и удалять любую задачу',
      'Читать журнал аудита',
    ],
  },
  {
    role: 'MEMBER',
    summary: 'Роль по умолчанию для всех, кто делает работу.',
    grants: [
      'Видеть все проекты',
      'Создавать и править задачи',
      'Двигать задачи и вести спринты',
      'Комментировать и загружать файлы',
    ],
  },
  {
    role: 'GUEST',
    summary: 'Внешние коллеги с доступом к отдельным проектам.',
    grants: ['Видит только проекты, куда добавлен', 'Читает задачи и комментирует', 'Не может создавать и править задачи'],
  },
];

function RolesSection() {
  return (
    <Card
      title="Роли"
      description="Что может каждая роль. Роль участника меняется в разделе «Участники»."
    >
      <ul className="space-y-2.5">
        {ROLE_MATRIX.map((entry) => (
          <li key={entry.role} className="border-2 border-border-strong bg-surface-sunken p-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-3.5 text-accent" />
              <h3 className="text-sm font-semibold">{ROLE_LABEL[entry.role]}</h3>
            </div>
            <p className="mt-0.5 text-xs text-text-muted">{entry.summary}</p>
            <ul className="mt-2 space-y-1">
              {entry.grants.map((grant) => (
                <li key={grant} className="flex items-start gap-1.5 text-xs text-text-muted">
                  <span className="mt-1.5 size-1 shrink-0 bg-text-subtle" aria-hidden="true" />
                  {grant}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Card>
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
          {projects.map((project) => (
            <li key={project.id} className="flex items-center gap-2.5 p-2.5">
              <ProjectIcon icon={project.icon} color={project.color} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{project.name}</span>
              <span className="fd-key">{project.key}</span>
              {project.projectType === 'SCRUM' && <Badge>спринты</Badge>}
              {project.isArchived && <Badge tone="warning">в архиве</Badge>}
              <span className="fd-num text-2xs text-text-subtle">
                {pluralize(project.totalIssueCount ?? 0, ['задача', 'задачи', 'задач'])}
              </span>
            </li>
          ))}
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
