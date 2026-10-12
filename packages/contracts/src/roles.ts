/**
 * Roles of a workspace's own making, and the table their permissions are
 * chosen in.
 *
 * The built-in roles are fixed sets (see permissions.ts). Next to them the
 * owner of a workspace can make roles: a name and a set of permissions picked
 * in a table of «what» by «read / change / delete». The table is defined here
 * once, so the server that stores a role and the page that draws it cannot
 * disagree about what a tick means.
 *
 * A cell of the table stands for one or several permissions that only make
 * sense together — creating a task, editing it and moving it across the board
 * are one tick. A role has a cell whole or not at all.
 */
import { ProjectRole, WorkspaceRole } from './enums';
import { Permission, builtInGrants } from './permissions';

export const RoleScope = {
  /** Given to a member of the workspace: what they may do everywhere. */
  WORKSPACE: 'WORKSPACE',
  /** Given to a member of a project: what they may do in that project on top of it. */
  PROJECT: 'PROJECT',
} as const;
export type RoleScope = (typeof RoleScope)[keyof typeof RoleScope];
export const ROLE_SCOPES = Object.values(RoleScope);

export interface PermissionCell {
  permissions: Permission[];
  /** What the tick means, in a few words. */
  hint: string;
  /** Always granted: being let in means being able to read. */
  locked?: boolean;
}

export interface PermissionRow {
  key: string;
  label: string;
  /** Roles of which kind have this row. */
  scopes: RoleScope[];
  read?: PermissionCell;
  change?: PermissionCell;
  remove?: PermissionCell;
}

const BOTH: RoleScope[] = [RoleScope.WORKSPACE, RoleScope.PROJECT];
const WORKSPACE_ONLY: RoleScope[] = [RoleScope.WORKSPACE];

export const PERMISSION_TABLE: PermissionRow[] = [
  {
    key: 'issues',
    label: 'Задачи',
    scopes: BOTH,
    read: { permissions: [Permission.ISSUE_VIEW], hint: 'видеть задачи', locked: true },
    change: {
      permissions: [Permission.ISSUE_CREATE, Permission.ISSUE_UPDATE, Permission.ISSUE_MOVE],
      hint: 'создавать, править, двигать по доске',
    },
    remove: { permissions: [Permission.ISSUE_DELETE], hint: 'удалять задачи' },
  },
  {
    key: 'assignees',
    label: 'Исполнители задач',
    scopes: BOTH,
    change: { permissions: [Permission.ISSUE_ASSIGN], hint: 'назначать и менять исполнителя' },
  },
  {
    key: 'comments',
    label: 'Комментарии',
    scopes: BOTH,
    change: {
      permissions: [Permission.COMMENT_CREATE, Permission.COMMENT_UPDATE_OWN],
      hint: 'писать и править свои',
    },
    remove: { permissions: [Permission.COMMENT_DELETE_ANY], hint: 'удалять чужие' },
  },
  {
    key: 'files',
    label: 'Файлы',
    scopes: BOTH,
    change: { permissions: [Permission.ATTACHMENT_UPLOAD], hint: 'прикладывать к задачам' },
    remove: { permissions: [Permission.ATTACHMENT_DELETE_ANY], hint: 'удалять чужие' },
  },
  {
    key: 'sprints',
    label: 'Спринты',
    scopes: BOTH,
    change: { permissions: [Permission.SPRINT_MANAGE], hint: 'создавать, начинать, завершать' },
  },
  {
    key: 'project',
    label: 'Проект',
    scopes: BOTH,
    read: { permissions: [Permission.PROJECT_VIEW], hint: 'открывать проект', locked: true },
    change: { permissions: [Permission.PROJECT_UPDATE], hint: 'название, описание, архив' },
    remove: { permissions: [Permission.PROJECT_DELETE], hint: 'удалять проект' },
  },
  {
    key: 'workflow',
    label: 'Статусы и колонки',
    scopes: BOTH,
    change: { permissions: [Permission.PROJECT_MANAGE_WORKFLOW], hint: 'добавлять, менять, убирать' },
  },
  {
    key: 'projectMembers',
    label: 'Участники проекта',
    scopes: BOTH,
    change: { permissions: [Permission.PROJECT_MANAGE_MEMBERS], hint: 'добавлять, убирать, менять роль' },
  },
  {
    key: 'newProjects',
    label: 'Новые проекты',
    scopes: WORKSPACE_ONLY,
    change: { permissions: [Permission.PROJECT_CREATE], hint: 'создавать проекты и подпроекты' },
  },
  {
    key: 'labels',
    label: 'Метки',
    scopes: WORKSPACE_ONLY,
    change: { permissions: [Permission.WORKSPACE_MANAGE_LABELS], hint: 'создавать, менять, удалять' },
  },
  {
    key: 'members',
    label: 'Участники пространства',
    scopes: WORKSPACE_ONLY,
    change: {
      permissions: [Permission.WORKSPACE_MANAGE_MEMBERS],
      hint: 'менять роли, убирать, сбрасывать пароль, вести отделы',
    },
  },
  {
    key: 'workspace',
    label: 'Настройки пространства',
    scopes: WORKSPACE_ONLY,
    change: { permissions: [Permission.WORKSPACE_UPDATE], hint: 'название, шаблоны задач' },
  },
  {
    key: 'audit',
    label: 'Журнал действий',
    scopes: WORKSPACE_ONLY,
    read: { permissions: [Permission.WORKSPACE_VIEW_AUDIT], hint: 'читать журнал' },
  },
];

export const PERMISSION_COLUMNS = ['read', 'change', 'remove'] as const;
export type PermissionColumn = (typeof PERMISSION_COLUMNS)[number];
export const PERMISSION_COLUMN_LABEL: Record<PermissionColumn, string> = {
  read: 'Чтение',
  change: 'Изменение',
  remove: 'Удаление',
};

/** The rows a role of this kind has. */
export function permissionRows(scope: RoleScope): PermissionRow[] {
  return PERMISSION_TABLE.filter((row) => row.scopes.includes(scope));
}

function cellsOf(scope: RoleScope): PermissionCell[] {
  return permissionRows(scope).flatMap((row) =>
    PERMISSION_COLUMNS.map((column) => row[column]).filter((cell): cell is PermissionCell => Boolean(cell)),
  );
}

/** Whether a set of permissions has a cell — all of what the tick stands for. */
export function hasCell(permissions: readonly string[], cell: PermissionCell): boolean {
  return cell.permissions.every((permission) => permissions.includes(permission));
}

/**
 * The permissions a role of the workspace's own ends up with: only what the
 * table offers for its kind, whole cells only, and always what reading takes.
 * Anything else that was sent — a slug of another kind, a made-up one, half a
 * cell — is dropped, so the stored set is exactly what the table shows.
 */
export function normalizeRolePermissions(scope: RoleScope, permissions: readonly string[]): Permission[] {
  const result = new Set<Permission>();
  // A member of the workspace can open it; the table has no row for that.
  if (scope === RoleScope.WORKSPACE) result.add(Permission.WORKSPACE_VIEW);
  for (const cell of cellsOf(scope)) {
    if (cell.locked || hasCell(permissions, cell)) cell.permissions.forEach((permission) => result.add(permission));
  }
  return [...result];
}

/** What a built-in role grants, for showing it in the same table as the others. */
export function builtInRolePermissions(scope: RoleScope, role: WorkspaceRole | ProjectRole): Permission[] {
  return builtInGrants(scope === RoleScope.WORKSPACE ? 'workspace' : 'project', role);
}
