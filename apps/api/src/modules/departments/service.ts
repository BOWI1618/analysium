/**
 * Departments: an explicit register of who works where, kept by the
 * workspace's administrators.
 *
 * Two rules shape everything here.
 *
 * Membership is what the register says, never what project teams suggest: a
 * department with nobody in it has no tasks, it does not fall back to
 * «everyone».
 *
 * A department gives no access. Its lead sees the list of its people and may
 * ask for their tasks through it, and what comes back is cut by the very same
 * project access as any other list the lead opens — leading a department does
 * not open a project, and does not let anyone change a task they could not
 * change anyway.
 */
import type {
  ActorContext,
  AssigneeStatsDto,
  CreateDepartmentInput,
  DepartmentDto,
  DepartmentListDto,
  IssueFilterInput,
  IssueSummaryDto,
  Paginated,
  UpdateDepartmentInput,
} from '@flowdesk/contracts';
import { Permission, can } from '@flowdesk/contracts';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { assertCan } from '../../lib/context';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { toUserSummary, userSummarySelect } from '../../lib/serialize';
import { assigneeStats, listIssues } from '../issues/service';

const departmentSelect = {
  id: true,
  name: true,
  workspaceId: true,
  lead: { select: { user: { select: userSummarySelect } } },
  members: {
    orderBy: { member: { user: { name: 'asc' } } },
    select: { member: { select: { user: { select: userSummarySelect } } } },
  },
} satisfies Prisma.DepartmentSelect;

type DepartmentRow = Prisma.DepartmentGetPayload<{ select: typeof departmentSelect }>;

const toDepartment = (row: DepartmentRow): DepartmentDto => ({
  id: row.id,
  name: row.name,
  lead: row.lead ? toUserSummary(row.lead.user) : null,
  members: row.members.map((entry) => toUserSummary(entry.member.user)!),
});

const canManage = (actor: ActorContext): boolean => can(actor, Permission.WORKSPACE_MANAGE_MEMBERS);

/** What the actor may see: every department for an administrator, otherwise the ones they lead. */
const visibleTo = (actor: ActorContext): Prisma.DepartmentWhereInput => ({
  workspaceId: actor.workspaceId,
  ...(canManage(actor) ? {} : { lead: { userId: actor.userId } }),
});

export async function listDepartments(actor: ActorContext): Promise<DepartmentListDto> {
  const rows = await prisma.department.findMany({
    where: visibleTo(actor),
    orderBy: { name: 'asc' },
    select: departmentSelect,
  });
  return { items: rows.map(toDepartment), canManage: canManage(actor) };
}

/** A department the actor may see; anything else does not exist as far as they can tell. */
export async function getDepartment(actor: ActorContext, departmentId: string): Promise<DepartmentDto> {
  const row = await prisma.department.findFirst({
    where: { id: departmentId, ...visibleTo(actor) },
    select: departmentSelect,
  });
  if (!row) throw notFound('Отдел');
  return toDepartment(row);
}

/** Workspace memberships for the given people; refuses anyone who is not in the workspace. */
async function membershipsOf(workspaceId: string, userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const rows = await prisma.workspaceMember.findMany({
    where: { workspaceId, userId: { in: ids } },
    select: { id: true, userId: true },
  });
  if (rows.length !== ids.length) throw badRequest('Не все выбранные люди состоят в этом пространстве');
  return new Map(rows.map((row) => [row.userId, row.id]));
}

/**
 * Makes the department's people exactly the given ones. Someone who was in
 * another department moves here: a person is in one department at a time.
 */
async function replaceMembers(tx: Prisma.TransactionClient, departmentId: string, memberIds: string[]): Promise<void> {
  await tx.departmentMember.deleteMany({ where: { departmentId, memberId: { notIn: memberIds } } });
  for (const memberId of memberIds) {
    await tx.departmentMember.upsert({
      where: { memberId },
      create: { departmentId, memberId },
      update: { departmentId },
    });
  }
}

const nameTaken = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

export async function createDepartment(actor: ActorContext, input: CreateDepartmentInput): Promise<DepartmentDto> {
  assertCan(actor, Permission.WORKSPACE_MANAGE_MEMBERS);
  const memberships = await membershipsOf(actor.workspaceId, [
    ...(input.memberIds ?? []),
    ...(input.leadId ? [input.leadId] : []),
  ]);

  try {
    const id = await prisma.$transaction(async (tx) => {
      const created = await tx.department.create({
        data: {
          workspaceId: actor.workspaceId,
          name: input.name,
          leadId: input.leadId ? memberships.get(input.leadId)! : null,
        },
        select: { id: true },
      });
      await replaceMembers(tx, created.id, (input.memberIds ?? []).map((userId) => memberships.get(userId)!));
      return created.id;
    });
    return getDepartment(actor, id);
  } catch (error) {
    if (nameTaken(error)) throw conflict('Отдел с таким названием уже есть', { name: 'Такое название уже занято' });
    throw error;
  }
}

export async function updateDepartment(
  actor: ActorContext,
  departmentId: string,
  input: UpdateDepartmentInput,
): Promise<DepartmentDto> {
  assertCan(actor, Permission.WORKSPACE_MANAGE_MEMBERS);
  const existing = await prisma.department.findFirst({
    where: { id: departmentId, workspaceId: actor.workspaceId },
    select: { id: true },
  });
  if (!existing) throw notFound('Отдел');

  const memberships = await membershipsOf(actor.workspaceId, [
    ...(input.memberIds ?? []),
    ...(input.leadId ? [input.leadId] : []),
  ]);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.department.update({
        where: { id: departmentId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.leadId !== undefined ? { leadId: input.leadId ? memberships.get(input.leadId)! : null } : {}),
        },
      });
      if (input.memberIds !== undefined) {
        await replaceMembers(tx, departmentId, input.memberIds.map((userId) => memberships.get(userId)!));
      }
    });
  } catch (error) {
    if (nameTaken(error)) throw conflict('Отдел с таким названием уже есть', { name: 'Такое название уже занято' });
    throw error;
  }
  return getDepartment(actor, departmentId);
}

export async function deleteDepartment(actor: ActorContext, departmentId: string): Promise<void> {
  assertCan(actor, Permission.WORKSPACE_MANAGE_MEMBERS);
  const result = await prisma.department.deleteMany({ where: { id: departmentId, workspaceId: actor.workspaceId } });
  if (result.count === 0) throw notFound('Отдел');
}

/**
 * The people a department's work is asked about: its members, narrowed to the
 * ones named in the filter. A name from outside the department narrows the
 * list to nobody — it never widens it.
 */
function assigneesWithin(department: DepartmentDto, filter: IssueFilterInput): string[] {
  const members = department.members.map((member) => member.id);
  const asked = filter.assigneeId;
  return asked?.length ? members.filter((id) => asked.includes(id)) : members;
}

export async function departmentIssues(
  actor: ActorContext,
  departmentId: string,
  filter: IssueFilterInput,
  timezone?: string,
): Promise<Paginated<IssueSummaryDto>> {
  const department = await getDepartment(actor, departmentId);
  const assigneeId = assigneesWithin(department, filter);
  // Nobody to ask about is an empty list. Passing no assignee on would mean
  // «any assignee» and show the whole workspace under the department's name.
  if (assigneeId.length === 0) return { items: [], nextCursor: null };
  return listIssues(actor, { ...filter, assigneeId, includeSubtasks: true }, timezone);
}

export async function departmentStats(
  actor: ActorContext,
  departmentId: string,
  filter: IssueFilterInput,
  timezone: string,
): Promise<AssigneeStatsDto[]> {
  const department = await getDepartment(actor, departmentId);
  const assigneeId = department.members.map((member) => member.id);
  if (assigneeId.length === 0) return [];
  return assigneeStats(actor, { ...filter, assigneeId }, timezone);
}
