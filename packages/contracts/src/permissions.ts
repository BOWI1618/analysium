/**
 * Central authorization matrix.
 *
 * This module is *pure*: no I/O, no framework types. The API imports it to
 * enforce permissions server-side; the web client imports the very same
 * functions to decide what to render. Hiding a button is a UX nicety —
 * `assertCan` on the server is the actual security boundary.
 */
import { WorkspaceRole, WORKSPACE_ROLE_RANK, ProjectRole } from './enums';

export const Permission = {
  // Workspace
  WORKSPACE_VIEW: 'workspace:view',
  WORKSPACE_UPDATE: 'workspace:update',
  WORKSPACE_DELETE: 'workspace:delete',
  WORKSPACE_MANAGE_MEMBERS: 'workspace:manage_members',
  WORKSPACE_VIEW_AUDIT: 'workspace:view_audit',
  WORKSPACE_MANAGE_LABELS: 'workspace:manage_labels',

  // Project
  PROJECT_CREATE: 'project:create',
  PROJECT_VIEW: 'project:view',
  PROJECT_UPDATE: 'project:update',
  PROJECT_DELETE: 'project:delete',
  PROJECT_MANAGE_MEMBERS: 'project:manage_members',
  PROJECT_MANAGE_WORKFLOW: 'project:manage_workflow',

  // Issue
  ISSUE_VIEW: 'issue:view',
  ISSUE_CREATE: 'issue:create',
  ISSUE_UPDATE: 'issue:update',
  ISSUE_DELETE: 'issue:delete',
  ISSUE_ASSIGN: 'issue:assign',
  ISSUE_MOVE: 'issue:move',

  // Comment
  COMMENT_CREATE: 'comment:create',
  COMMENT_UPDATE_OWN: 'comment:update_own',
  COMMENT_DELETE_ANY: 'comment:delete_any',

  // Sprint
  SPRINT_MANAGE: 'sprint:manage',

  // Attachment
  ATTACHMENT_UPLOAD: 'attachment:upload',
  ATTACHMENT_DELETE_ANY: 'attachment:delete_any',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

/**
 * Base grants by workspace role. A project-level role can *raise* a member's
 * effective capability inside one project (see `can`), never lower the
 * workspace floor for OWNER/ADMIN.
 */
const WORKSPACE_GRANTS: Record<WorkspaceRole, ReadonlySet<Permission>> = {
  OWNER: new Set(Object.values(Permission)),
  ADMIN: new Set<Permission>([
    Permission.WORKSPACE_VIEW,
    Permission.WORKSPACE_UPDATE,
    Permission.WORKSPACE_MANAGE_MEMBERS,
    Permission.WORKSPACE_VIEW_AUDIT,
    Permission.WORKSPACE_MANAGE_LABELS,
    Permission.PROJECT_CREATE,
    Permission.PROJECT_VIEW,
    Permission.PROJECT_UPDATE,
    Permission.PROJECT_DELETE,
    Permission.PROJECT_MANAGE_MEMBERS,
    Permission.PROJECT_MANAGE_WORKFLOW,
    Permission.ISSUE_VIEW,
    Permission.ISSUE_CREATE,
    Permission.ISSUE_UPDATE,
    Permission.ISSUE_DELETE,
    Permission.ISSUE_ASSIGN,
    Permission.ISSUE_MOVE,
    Permission.COMMENT_CREATE,
    Permission.COMMENT_UPDATE_OWN,
    Permission.COMMENT_DELETE_ANY,
    Permission.SPRINT_MANAGE,
    Permission.ATTACHMENT_UPLOAD,
    Permission.ATTACHMENT_DELETE_ANY,
  ]),
  MEMBER: new Set<Permission>([
    Permission.WORKSPACE_VIEW,
    Permission.PROJECT_CREATE,
    Permission.PROJECT_VIEW,
    Permission.ISSUE_VIEW,
    Permission.ISSUE_CREATE,
    Permission.ISSUE_UPDATE,
    Permission.ISSUE_ASSIGN,
    Permission.ISSUE_MOVE,
    Permission.COMMENT_CREATE,
    Permission.COMMENT_UPDATE_OWN,
    Permission.SPRINT_MANAGE,
    Permission.ATTACHMENT_UPLOAD,
  ]),
  GUEST: new Set<Permission>([
    Permission.WORKSPACE_VIEW,
    Permission.PROJECT_VIEW,
    Permission.ISSUE_VIEW,
    Permission.COMMENT_CREATE,
    Permission.COMMENT_UPDATE_OWN,
  ]),
};

/** Extra permissions a project role grants inside that project only. */
const PROJECT_GRANTS: Record<ProjectRole, ReadonlySet<Permission>> = {
  LEAD: new Set<Permission>([
    Permission.PROJECT_VIEW,
    Permission.PROJECT_UPDATE,
    Permission.PROJECT_MANAGE_MEMBERS,
    Permission.PROJECT_MANAGE_WORKFLOW,
    Permission.ISSUE_VIEW,
    Permission.ISSUE_CREATE,
    Permission.ISSUE_UPDATE,
    Permission.ISSUE_DELETE,
    Permission.ISSUE_ASSIGN,
    Permission.ISSUE_MOVE,
    Permission.COMMENT_CREATE,
    Permission.COMMENT_UPDATE_OWN,
    Permission.COMMENT_DELETE_ANY,
    Permission.SPRINT_MANAGE,
    Permission.ATTACHMENT_UPLOAD,
    Permission.ATTACHMENT_DELETE_ANY,
  ]),
  CONTRIBUTOR: new Set<Permission>([
    Permission.PROJECT_VIEW,
    Permission.ISSUE_VIEW,
    Permission.ISSUE_CREATE,
    Permission.ISSUE_UPDATE,
    Permission.ISSUE_ASSIGN,
    Permission.ISSUE_MOVE,
    Permission.COMMENT_CREATE,
    Permission.COMMENT_UPDATE_OWN,
    Permission.ATTACHMENT_UPLOAD,
  ]),
  VIEWER: new Set<Permission>([Permission.PROJECT_VIEW, Permission.ISSUE_VIEW]),
};

export interface ActorContext {
  userId: string;
  workspaceId: string;
  workspaceRole: WorkspaceRole;
  /** Role in the project being acted upon, if any. */
  projectRole?: ProjectRole | null;
}

/**
 * A GUEST only ever sees projects they were explicitly added to. Everyone else
 * sees every non-archived project in the workspace.
 */
export function canAccessProject(actor: Pick<ActorContext, 'workspaceRole' | 'projectRole'>): boolean {
  if (actor.workspaceRole === WorkspaceRole.GUEST) return Boolean(actor.projectRole);
  return true;
}

export function can(actor: ActorContext, permission: Permission): boolean {
  const base = WORKSPACE_GRANTS[actor.workspaceRole];
  if (base?.has(permission)) return true;
  if (actor.projectRole) {
    const extra = PROJECT_GRANTS[actor.projectRole];
    if (extra?.has(permission)) return true;
  }
  return false;
}

export function canAll(actor: ActorContext, permissions: Permission[]): boolean {
  return permissions.every((p) => can(actor, p));
}

export function canAny(actor: ActorContext, permissions: Permission[]): boolean {
  return permissions.some((p) => can(actor, p));
}

/** True when `actor` outranks `target` — required to change or remove a member. */
export function outranks(actorRole: WorkspaceRole, targetRole: WorkspaceRole): boolean {
  return WORKSPACE_ROLE_RANK[actorRole] > WORKSPACE_ROLE_RANK[targetRole];
}

/** A comment may be edited by its author, or deleted by author / privileged member. */
export function canEditComment(actor: ActorContext, authorId: string): boolean {
  return actor.userId === authorId && can(actor, Permission.COMMENT_UPDATE_OWN);
}

export function canDeleteComment(actor: ActorContext, authorId: string): boolean {
  return actor.userId === authorId || can(actor, Permission.COMMENT_DELETE_ANY);
}

/** Full permission list for an actor — serialized to the client for UI gating. */
export function permissionsFor(actor: ActorContext): Permission[] {
  return Object.values(Permission).filter((p) => can(actor, p));
}
