import { describe, expect, it } from 'vitest';
import {
  Permission,
  WorkspaceRole,
  can,
  canAccessProject,
  canDeleteComment,
  canEditComment,
  outranks,
  permissionsFor,
  type ActorContext,
} from '@flowdesk/contracts';

const actor = (
  workspaceRole: WorkspaceRole,
  projectRole: ActorContext['projectRole'] = null,
  userId = 'u1',
): ActorContext => ({ userId, workspaceId: 'w1', workspaceRole, projectRole });

describe('workspace role grants', () => {
  it('gives the owner every permission', () => {
    const owner = actor(WorkspaceRole.OWNER);
    for (const permission of Object.values(Permission)) {
      expect(can(owner, permission)).toBe(true);
    }
  });

  it('lets an admin manage projects but not delete the workspace', () => {
    const admin = actor(WorkspaceRole.ADMIN);
    expect(can(admin, Permission.PROJECT_DELETE)).toBe(true);
    expect(can(admin, Permission.WORKSPACE_MANAGE_MEMBERS)).toBe(true);
    expect(can(admin, Permission.WORKSPACE_DELETE)).toBe(false);
  });

  it('lets a member work on issues but not administer the workspace', () => {
    const member = actor(WorkspaceRole.MEMBER);
    expect(can(member, Permission.ISSUE_CREATE)).toBe(true);
    expect(can(member, Permission.ISSUE_MOVE)).toBe(true);
    expect(can(member, Permission.SPRINT_MANAGE)).toBe(true);
    expect(can(member, Permission.WORKSPACE_MANAGE_MEMBERS)).toBe(false);
    expect(can(member, Permission.ISSUE_DELETE)).toBe(false);
    expect(can(member, Permission.WORKSPACE_VIEW_AUDIT)).toBe(false);
  });

  it('restricts a guest to reading and commenting', () => {
    const guest = actor(WorkspaceRole.GUEST);
    expect(can(guest, Permission.ISSUE_VIEW)).toBe(true);
    expect(can(guest, Permission.COMMENT_CREATE)).toBe(true);
    expect(can(guest, Permission.ISSUE_CREATE)).toBe(false);
    expect(can(guest, Permission.ISSUE_UPDATE)).toBe(false);
    expect(can(guest, Permission.PROJECT_CREATE)).toBe(false);
  });
});

describe('project role escalation', () => {
  it('raises a guest to contributor inside one project only', () => {
    const guest = actor(WorkspaceRole.GUEST, 'CONTRIBUTOR');
    expect(can(guest, Permission.ISSUE_CREATE)).toBe(true);
    expect(can(guest, Permission.ISSUE_UPDATE)).toBe(true);

    // The elevation must not leak to the workspace level.
    expect(can(guest, Permission.PROJECT_CREATE)).toBe(false);
    expect(can(guest, Permission.WORKSPACE_MANAGE_MEMBERS)).toBe(false);
  });

  it('lets a project lead delete issues in that project', () => {
    expect(can(actor(WorkspaceRole.MEMBER, 'LEAD'), Permission.ISSUE_DELETE)).toBe(true);
    expect(can(actor(WorkspaceRole.MEMBER, null), Permission.ISSUE_DELETE)).toBe(false);
  });

  it('never lowers what the workspace role already grants', () => {
    // A VIEWER project role must not strip a member's ability to create issues.
    const member = actor(WorkspaceRole.MEMBER, 'VIEWER');
    expect(can(member, Permission.ISSUE_CREATE)).toBe(true);
  });
});

describe('project visibility', () => {
  it('hides projects a guest was not added to', () => {
    expect(canAccessProject({ workspaceRole: WorkspaceRole.GUEST, projectRole: null })).toBe(false);
    expect(canAccessProject({ workspaceRole: WorkspaceRole.GUEST, projectRole: 'VIEWER' })).toBe(true);
  });

  it('shows every project to everyone else', () => {
    for (const role of [WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.MEMBER]) {
      expect(canAccessProject({ workspaceRole: role, projectRole: null })).toBe(true);
    }
  });
});

describe('role ranking', () => {
  it('orders owner above admin above member above guest', () => {
    expect(outranks(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)).toBe(true);
    expect(outranks(WorkspaceRole.ADMIN, WorkspaceRole.MEMBER)).toBe(true);
    expect(outranks(WorkspaceRole.MEMBER, WorkspaceRole.GUEST)).toBe(true);
  });

  it('does not let a role outrank itself', () => {
    expect(outranks(WorkspaceRole.ADMIN, WorkspaceRole.ADMIN)).toBe(false);
    expect(outranks(WorkspaceRole.MEMBER, WorkspaceRole.ADMIN)).toBe(false);
  });
});

describe('comment ownership', () => {
  it('lets an author edit only their own comment', () => {
    const member = actor(WorkspaceRole.MEMBER, null, 'u1');
    expect(canEditComment(member, 'u1')).toBe(true);
    expect(canEditComment(member, 'u2')).toBe(false);
  });

  it('lets a privileged member delete anyone’s comment', () => {
    const member = actor(WorkspaceRole.MEMBER, null, 'u1');
    const admin = actor(WorkspaceRole.ADMIN, null, 'u1');
    expect(canDeleteComment(member, 'u2')).toBe(false);
    expect(canDeleteComment(member, 'u1')).toBe(true);
    expect(canDeleteComment(admin, 'u2')).toBe(true);
  });
});

describe('permissionsFor', () => {
  it('serialises exactly the permissions `can` agrees with', () => {
    const member = actor(WorkspaceRole.MEMBER, 'LEAD');
    const list = permissionsFor(member);
    for (const permission of Object.values(Permission)) {
      expect(list.includes(permission)).toBe(can(member, permission));
    }
  });
});
