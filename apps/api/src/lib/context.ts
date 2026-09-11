/**
 * Actor resolution — the single place where "who is asking, and what are they
 * allowed to do here" is answered. Every service takes an `ActorContext`
 * produced here rather than a bare userId, which makes it impossible to write
 * a query that forgets to scope by workspace.
 */
import type { ActorContext, Permission } from '@flowdesk/contracts';
import { can, canAccessProject } from '@flowdesk/contracts';
import { prisma } from './prisma';
import { forbidden, notFound } from './errors';

export interface ProjectContext {
  actor: ActorContext;
  project: {
    id: string;
    workspaceId: string;
    key: string;
    name: string;
    projectType: string;
    isArchived: boolean;
  };
}

/** Resolves membership in a workspace. Non-members get 404, never 403 —
 *  existence of a workspace should not leak to outsiders. */
export async function workspaceContext(userId: string, workspaceId: string): Promise<ActorContext> {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });
  if (!member) throw notFound('Пространство');
  return { userId, workspaceId, workspaceRole: member.role };
}

/**
 * Resolves a project together with the caller's effective role. Guests without
 * an explicit project membership are treated as if the project did not exist.
 */
export async function projectContext(userId: string, projectId: string): Promise<ProjectContext> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      workspaceId: true,
      key: true,
      name: true,
      projectType: true,
      isArchived: true,
      members: { where: { userId }, select: { role: true } },
      workspace: { select: { members: { where: { userId }, select: { role: true } } } },
    },
  });
  if (!project) throw notFound('Проект');

  const workspaceRole = project.workspace.members[0]?.role;
  if (!workspaceRole) throw notFound('Проект');

  const actor: ActorContext = {
    userId,
    workspaceId: project.workspaceId,
    workspaceRole,
    projectRole: project.members[0]?.role ?? null,
  };

  if (!canAccessProject(actor)) throw notFound('Проект');

  return {
    actor,
    project: {
      id: project.id,
      workspaceId: project.workspaceId,
      key: project.key,
      name: project.name,
      projectType: project.projectType,
      isArchived: project.isArchived,
    },
  };
}

/** Resolves the project context for an issue in one round trip. */
export async function issueContext(userId: string, issueId: string) {
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { id: true, projectId: true, issueKey: true, statusId: true, title: true },
  });
  if (!issue) throw notFound('Задача');
  const ctx = await projectContext(userId, issue.projectId);
  return { ...ctx, issue };
}

export function assertCan(actor: ActorContext, permission: Permission, message?: string): void {
  if (!can(actor, permission)) {
    // The permission slug is developer detail; the user sees a plain sentence
    // and the slug goes to the log via the request id.
    throw forbidden(message ?? 'Недостаточно прав для этого действия');
  }
}

/** Ids of projects the actor may read — used to scope cross-project queries. */
export async function visibleProjectIds(actor: ActorContext): Promise<string[] | 'ALL'> {
  if (actor.workspaceRole !== 'GUEST') return 'ALL';
  const rows = await prisma.projectMember.findMany({
    where: { userId: actor.userId, project: { workspaceId: actor.workspaceId } },
    select: { projectId: true },
  });
  return rows.map((r) => r.projectId);
}
