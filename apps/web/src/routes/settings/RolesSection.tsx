import { useState } from 'react';
import clsx from 'clsx';
import type { ProjectRole, RoleDto, RoleScope, WorkspaceRole } from '@flowdesk/contracts';
import {
  PERMISSION_COLUMNS,
  PERMISSION_COLUMN_LABEL,
  PROJECT_ROLES,
  WORKSPACE_ROLES,
  builtInRolePermissions,
  hasCell,
  permissionRows,
} from '@flowdesk/contracts';
import { ChevronDown, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { ApiError } from '~/lib/api';
import { useSession } from '~/app/session';
import { useCreateRole, useDeleteRole, useRoles, useUpdateRole } from '~/features/roles/hooks';
import { Badge } from '~/ui/Badge';
import { Button, IconButton } from '~/ui/Button';
import { ConfirmDialog } from '~/ui/Dialog';
import { Skeleton } from '~/ui/Feedback';
import { Input, Select } from '~/ui/Input';
import { SegmentedControl } from '~/ui/Tabs';
import { PROJECT_ROLE_LABEL, ROLE_LABEL } from '~/lib/labels';
import { pluralize } from '~/lib/format';

/** What each built-in role is for, in a line. Their ticks are fixed. */
const BUILT_IN: Record<RoleScope, { role: string; name: string; summary: string }[]> = {
  WORKSPACE: [
    { role: 'OWNER', name: ROLE_LABEL.OWNER, summary: 'Может всё. Только он выдаёт доступ по ссылке, создаёт роли и удаляет пространство.' },
    { role: 'ADMIN', name: ROLE_LABEL.ADMIN, summary: 'Ведёт пространство изо дня в день. Видит все проекты.' },
    { role: 'MEMBER', name: ROLE_LABEL.MEMBER, summary: 'Роль по умолчанию для всех, кто делает работу. Видит все проекты.' },
    { role: 'GUEST', name: ROLE_LABEL.GUEST, summary: 'Видит только проекты, куда добавлен; читает и комментирует.' },
  ],
  PROJECT: [
    { role: 'LEAD', name: PROJECT_ROLE_LABEL.LEAD, summary: 'Ведёт проект: задачи, статусы, участники.' },
    { role: 'CONTRIBUTOR', name: PROJECT_ROLE_LABEL.CONTRIBUTOR, summary: 'Работает с задачами проекта.' },
    { role: 'VIEWER', name: PROJECT_ROLE_LABEL.VIEWER, summary: 'Только читает проект.' },
  ],
};

interface Draft {
  /** Set when an existing role is being changed. */
  id: string | null;
  name: string;
  permissions: string[];
  allProjects: boolean;
}

/**
 * «Роли и права»: what each role lets a person do, and — for the owner — the
 * place where roles of the workspace's own are made.
 *
 * A role is a name and the ticks of one table: what, by read / change /
 * delete. The built-in roles are shown in the same table so they can be
 * compared with one's own, but their ticks are fixed.
 */
export function RolesSection() {
  const { workspace } = useSession();
  const workspaceId = workspace?.id ?? '';
  const isOwner = workspace?.role === 'OWNER';

  const { data: roles, isLoading } = useRoles(workspaceId);
  const createRole = useCreateRole(workspaceId);
  const updateRole = useUpdateRole(workspaceId);
  const deleteRole = useDeleteRole(workspaceId);

  const [scope, setScope] = useState<RoleScope>('WORKSPACE');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<RoleDto | null>(null);

  const own = (roles ?? []).filter((role) => role.scope === scope);
  const saving = createRole.isPending || updateRole.isPending;

  const startNew = () => {
    setErrors({});
    setDraft({ id: null, name: '', permissions: [], allProjects: true });
  };
  const startEdit = (role: RoleDto) => {
    setErrors({});
    setDraft({ id: role.id, name: role.name, permissions: role.permissions, allProjects: role.allProjects });
  };

  const save = () => {
    if (!draft) return;
    setErrors({});
    const onError = (error: unknown) => {
      if (error instanceof ApiError) setErrors(error.fields);
    };
    const onSuccess = () => setDraft(null);
    const allProjects = scope === 'WORKSPACE' ? draft.allProjects : undefined;
    if (draft.id) {
      updateRole.mutate(
        { roleId: draft.id, patch: { name: draft.name.trim(), permissions: draft.permissions, allProjects } },
        { onSuccess, onError },
      );
    } else {
      createRole.mutate({ scope, name: draft.name.trim(), permissions: draft.permissions, allProjects }, { onSuccess, onError });
    }
  };

  return (
    <section className="border-2 border-border-strong bg-surface p-4 shadow-md">
      <h2 className="fd-eyebrow">Роли и права</h2>
      <p className="mt-1 text-xs text-text-muted">
        Роль решает, что человек может делать. Встроенные роли не меняются;{' '}
        {isOwner ? 'свои вы создаёте сами' : 'свои создаёт владелец пространства'} — название и галочки в таблице. Роль в
        пространстве действует везде. Роль в проекте только добавляет права к ней и действует в одном проекте.
      </p>

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <SegmentedControl
          label="Где действует роль"
          value={scope}
          onChange={(next) => {
            setScope(next);
            setDraft(null);
            setOpenKey(null);
          }}
          options={[
            { value: 'WORKSPACE', label: 'В пространстве' },
            { value: 'PROJECT', label: 'В проекте' },
          ]}
        />
        {isOwner && !draft && (
          <Button size="sm" variant="secondary" iconLeft={<Plus className="size-3.5" />} onClick={startNew}>
            Новая роль
          </Button>
        )}
      </div>

      {draft && (
        <RoleEditor
          scope={scope}
          draft={draft}
          own={own}
          errors={errors}
          saving={saving}
          onChange={setDraft}
          onSave={save}
          onCancel={() => setDraft(null)}
        />
      )}

      <ul className="mt-3.5 space-y-2.5" aria-label={scope === 'WORKSPACE' ? 'Роли в пространстве' : 'Роли в проекте'}>
        {BUILT_IN[scope].map((entry) => {
          const key = `built-in:${entry.role}`;
          return (
            <RoleCard
              key={key}
              name={entry.name}
              summary={entry.summary}
              badge="встроенная"
              open={openKey === key}
              onToggle={() => setOpenKey(openKey === key ? null : key)}
            >
              <PermissionTable
                scope={scope}
                permissions={builtInRolePermissions(scope, entry.role as WorkspaceRole | ProjectRole)}
                roleName={entry.name}
              />
            </RoleCard>
          );
        })}

        {isLoading && <Skeleton className="h-12" />}
        {own.map((role) => (
          <RoleCard
            key={role.id}
            name={role.name}
            summary={
              (scope === 'WORKSPACE' ? (role.allProjects ? 'Видит все проекты. ' : 'Видит только проекты, куда добавлен. ') : '') +
              (role.memberCount > 0
                ? `Выдана: ${pluralize(role.memberCount, ['человеку', 'людям', 'людям'])}.`
                : 'Пока никому не выдана.')
            }
            badge="своя"
            accent
            open={openKey === role.id}
            onToggle={() => setOpenKey(openKey === role.id ? null : role.id)}
            actions={
              isOwner ? (
                <>
                  <IconButton label={`Изменить роль «${role.name}»`} size="xs" onClick={() => startEdit(role)}>
                    <Pencil className="size-3.5" />
                  </IconButton>
                  <IconButton label={`Удалить роль «${role.name}»`} size="xs" onClick={() => setDeleting(role)}>
                    <Trash2 className="size-3.5 text-danger" />
                  </IconButton>
                </>
              ) : undefined
            }
          >
            <PermissionTable scope={scope} permissions={role.permissions} roleName={role.name} />
          </RoleCard>
        ))}
      </ul>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) deleteRole.mutate(deleting.id);
          setDeleting(null);
        }}
        title={`Удалить роль «${deleting?.name}»?`}
        message={
          deleting && deleting.memberCount > 0
            ? 'Роль сейчас выдана людям — сначала дайте им другую, иначе удалить её не получится.'
            : 'Ссылки для входа, созданные с этой ролью, перестанут работать.'
        }
        confirmLabel="Удалить"
        danger
      />
    </section>
  );
}

/** One role as a line that opens into its table. */
function RoleCard({
  name,
  summary,
  badge,
  accent,
  open,
  onToggle,
  actions,
  children,
}: {
  name: string;
  summary: string;
  badge: string;
  accent?: boolean;
  open: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="border-2 border-border-strong bg-surface-sunken">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <ShieldCheck className={clsx('size-3.5 shrink-0', accent ? 'text-accent' : 'text-text-subtle')} />
        <div className="min-w-0 flex-1 basis-48">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
            <span className="first-letter:uppercase">{name}</span>
            <Badge tone={accent ? 'accent' : 'neutral'}>{badge}</Badge>
          </p>
          <p className="mt-0.5 text-xs text-text-muted">{summary}</p>
        </div>
        {actions}
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="inline-flex items-center gap-1 text-xs font-bold text-text-muted hover:text-text"
        >
          {open ? 'Скрыть права' : 'Показать права'}
          <ChevronDown className={clsx('size-3.5 transition-transform', open && 'rotate-180')} />
          <span className="sr-only">: {name}</span>
        </button>
      </div>
      {open && <div className="border-t-2 border-border-strong bg-surface p-3">{children}</div>}
    </li>
  );
}

/** The form of a role: its name, how far its holder sees, and the ticks. */
function RoleEditor({
  scope,
  draft,
  own,
  errors,
  saving,
  onChange,
  onSave,
  onCancel,
}: {
  scope: RoleScope;
  draft: Draft;
  own: RoleDto[];
  errors: Record<string, string>;
  saving: boolean;
  onChange: (next: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  // A new role rarely starts from nothing: it is an existing one with a tick more or less.
  const bases =
    scope === 'WORKSPACE'
      ? WORKSPACE_ROLES.filter((role) => role !== 'OWNER').map((role) => ({ value: role, label: ROLE_LABEL[role] }))
      : PROJECT_ROLES.map((role) => ({ value: role, label: PROJECT_ROLE_LABEL[role] }));

  const takeFrom = (value: string) => {
    if (!value) return;
    const custom = own.find((role) => role.id === value);
    onChange({
      ...draft,
      permissions: custom ? custom.permissions : builtInRolePermissions(scope, value as WorkspaceRole | ProjectRole),
      ...(custom ? { allProjects: custom.allProjects } : scope === 'WORKSPACE' ? { allProjects: value !== 'GUEST' } : {}),
    });
  };

  return (
    <form
      className="mt-3.5 space-y-3 border-2 border-accent bg-surface p-3 shadow-sm"
      aria-label={draft.id ? 'Изменение роли' : 'Новая роль'}
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <p className="text-sm font-bold">{draft.id ? 'Изменение роли' : 'Новая роль'}</p>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-48 flex-1">
          <Input
            label="Название роли"
            autoFocus
            required
            maxLength={40}
            value={draft.name}
            error={errors.name}
            placeholder={scope === 'WORKSPACE' ? 'например, Аналитик' : 'например, Тестировщик'}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
        </div>
        {scope === 'WORKSPACE' && (
          <div className="min-w-56 flex-1">
            <Select
              label="Какие проекты видит"
              value={draft.allProjects ? 'all' : 'own'}
              onChange={(event) => onChange({ ...draft, allProjects: (event.target as HTMLSelectElement).value === 'all' })}
            >
              <option value="all">Все проекты пространства</option>
              <option value="own">Только проекты, куда добавлен</option>
            </Select>
          </div>
        )}
        {!draft.id && (
          <div className="min-w-48 flex-1">
            <Select label="Взять галочки из роли" defaultValue="" onChange={(event) => takeFrom((event.target as HTMLSelectElement).value)}>
              <option value="">С чистого листа</option>
              {bases.map((base) => (
                <option key={base.value} value={base.value}>
                  {base.label}
                </option>
              ))}
              {own.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      <PermissionTable
        scope={scope}
        permissions={draft.permissions}
        roleName={draft.name.trim() || 'новая роль'}
        onChange={(permissions) => onChange({ ...draft, permissions })}
      />

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="sm" loading={saving} disabled={draft.name.trim().length < 2}>
          {draft.id ? 'Сохранить роль' : 'Создать роль'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </form>
  );
}

/**
 * The table of permissions: what, by read / change / delete. With `onChange`
 * the ticks are set; without it the table only shows what a role has.
 */
function PermissionTable({
  scope,
  permissions,
  roleName,
  onChange,
}: {
  scope: RoleScope;
  permissions: string[];
  roleName: string;
  onChange?: (permissions: string[]) => void;
}) {
  const toggle = (cell: { permissions: string[] }, on: boolean) => {
    if (!onChange) return;
    const rest = permissions.filter((permission) => !cell.permissions.includes(permission));
    onChange(on ? [...rest, ...cell.permissions] : rest);
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[30rem] border-collapse text-left text-xs" aria-label={`Права роли «${roleName}»`}>
        <thead>
          <tr className="border-b-2 border-border-strong">
            <th scope="col" className="fd-eyebrow py-1.5 pr-3 font-bold">
              Что
            </th>
            {PERMISSION_COLUMNS.map((column) => (
              <th key={column} scope="col" className="fd-eyebrow w-[24%] px-2 py-1.5 font-bold">
                {PERMISSION_COLUMN_LABEL[column]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {permissionRows(scope).map((row) => (
            <tr key={row.key} className="border-b border-border-strong/40 align-top last:border-b-0">
              <th scope="row" className="py-2 pr-3 font-semibold">
                {row.label}
              </th>
              {PERMISSION_COLUMNS.map((column) => {
                const cell = row[column];
                if (!cell) {
                  return (
                    <td key={column} className="px-2 py-2 text-text-subtle" aria-label="не применяется">
                      —
                    </td>
                  );
                }
                const on = Boolean(cell.locked) || hasCell(permissions, cell);
                return (
                  <td key={column} className="px-2 py-2">
                    <label className={clsx('flex items-start gap-1.5', onChange && !cell.locked && 'cursor-pointer')}>
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!onChange || cell.locked}
                        onChange={(event) => toggle(cell, event.target.checked)}
                        aria-label={`${row.label}: ${PERMISSION_COLUMN_LABEL[column].toLowerCase()}`}
                        className="mt-0.5 size-3.5 shrink-0 accent-[var(--accent)]"
                      />
                      <span className={clsx('leading-snug', on ? 'text-text' : 'text-text-subtle')}>
                        {cell.hint}
                        {cell.locked && onChange && <span className="block text-2xs text-text-subtle">всегда</span>}
                      </span>
                    </label>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
