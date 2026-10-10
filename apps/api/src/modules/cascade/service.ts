/**
 * Handing work down the reporting line.
 *
 * A department's register says who reports to whom. This module reads that
 * line and does two things with it: shows a person their own tasks next to
 * those of the people right below them, and moves a task one step along the
 * line — down to a direct report, sideways between direct reports, or back up
 * to oneself.
 *
 * Three rules shape everything here.
 *
 * The line gives no access. Every figure and every task is cut by the
 * viewer's own project access, exactly like any other list; a recipient has
 * to be able to open the project already, and a handover never opens it.
 *
 * A handover is the ordinary change of assignee and nothing else: the same
 * task, the same status and dates, the same history and notifications as a
 * reassignment made in the card. It goes through the same code.
 *
 * One step at a time. The screen is for a manager and the people right below
 * them; reaching past a direct report or into a neighbouring branch is not a
 * handover and is refused here, whatever ids the request carries. Fixing an
 * assignment across the chart stays where it was — in the card and the lists,
 * under their own permissions.
 */
import type {
  ActorContext,
  CascadeDto,
  CascadeFiguresDto,
  CascadePersonDto,
  HandoffInput,
  UserSummaryDto,
} from '@flowdesk/contracts';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { visibleProjectIds } from '../../lib/context';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { toUserSummary, userSummarySelect } from '../../lib/serialize';
import { overdueWhere } from '../../domain/filters';
import { bulkUpdate } from '../issues/service';

const ACTIVE = ['BACKLOG', 'UNSTARTED', 'STARTED'] as const;
const NO_FIGURES: CascadeFiguresDto = { backlog: 0, active: 0, overdue: 0 };

interface LineMember {
  /** Row of the register. */
  id: string;
  managerId: string | null;
  position: string | null;
  user: UserSummaryDto;
}

/** The reporting line of the department a person is in. */
interface Line {
  department: { id: string; name: string };
  self: LineMember;
  byRow: Map<string, LineMember>;
  byUser: Map<string, LineMember>;
  reportsOf: Map<string, LineMember[]>;
}

/** Loads the whole department of a person once; `null` for someone the register does not list. */
async function loadLine(workspaceId: string, userId: string): Promise<Line | null> {
  const own = await prisma.departmentMember.findFirst({
    where: { member: { workspaceId, userId } },
    select: { departmentId: true, department: { select: { id: true, name: true } } },
  });
  if (!own) return null;

  const rows = await prisma.departmentMember.findMany({
    where: { departmentId: own.departmentId },
    select: {
      id: true,
      managerId: true,
      position: true,
      member: { select: { user: { select: userSummarySelect } } },
    },
  });
  const members: LineMember[] = rows.map((row) => ({
    id: row.id,
    managerId: row.managerId,
    position: row.position,
    user: toUserSummary(row.member.user)!,
  }));

  const byRow = new Map(members.map((member) => [member.id, member]));
  const byUser = new Map(members.map((member) => [member.user.id, member]));
  const reportsOf = new Map<string, LineMember[]>();
  for (const member of members) {
    if (!member.managerId) continue;
    reportsOf.set(member.managerId, [...(reportsOf.get(member.managerId) ?? []), member]);
  }
  for (const reports of reportsOf.values()) reports.sort((a, b) => a.user.name.localeCompare(b.user.name, 'ru'));

  return { department: own.department, self: byUser.get(userId)!, byRow, byUser, reportsOf };
}

/** Everyone below a person, the person excluded. A ring in the data ends the walk instead of spinning. */
function below(line: Line, member: LineMember): LineMember[] {
  const seen = new Set([member.id]);
  const result: LineMember[] = [];
  const queue = [...(line.reportsOf.get(member.id) ?? [])];
  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next.id)) continue;
    seen.add(next.id);
    result.push(next);
    queue.push(...(line.reportsOf.get(next.id) ?? []));
  }
  return result;
}

const toPerson = (member: LineMember): CascadePersonDto => ({ user: member.user, position: member.position });

/** Figures per person over what the viewer may read: three counts, one query each. */
async function figuresFor(
  actor: ActorContext,
  userIds: string[],
  timezone: string,
  now = new Date(),
): Promise<Map<string, CascadeFiguresDto>> {
  const result = new Map<string, CascadeFiguresDto>(userIds.map((id) => [id, { ...NO_FIGURES }]));
  if (userIds.length === 0) return result;

  const allowed = await visibleProjectIds(actor);
  const base: Prisma.IssueWhereInput = {
    archivedAt: null,
    assigneeId: { in: userIds },
    project: { workspaceId: actor.workspaceId },
    ...(allowed === 'ALL' ? {} : { projectId: { in: allowed } }),
  };
  const wheres: Record<keyof CascadeFiguresDto, Prisma.IssueWhereInput> = {
    backlog: { AND: [base, { status: { category: 'BACKLOG' } }] },
    active: { AND: [base, { status: { category: { in: [...ACTIVE] } } }] },
    overdue: { AND: [base, { status: { category: { in: [...ACTIVE] } } }, overdueWhere(now, timezone)] },
  };

  await Promise.all(
    (Object.keys(wheres) as (keyof CascadeFiguresDto)[]).map(async (key) => {
      const rows = await prisma.issue.groupBy({ by: ['assigneeId'], where: wheres[key], _count: { _all: true } });
      for (const row of rows) {
        const figures = row.assigneeId ? result.get(row.assigneeId) : undefined;
        if (figures) figures[key] = row._count._all;
      }
    }),
  );
  return result;
}

const sum = (figures: Map<string, CascadeFiguresDto>, userIds: string[]): CascadeFiguresDto =>
  userIds.reduce<CascadeFiguresDto>(
    (total, id) => {
      const own = figures.get(id) ?? NO_FIGURES;
      return {
        backlog: total.backlog + own.backlog,
        active: total.active + own.active,
        overdue: total.overdue + own.overdue,
      };
    },
    { ...NO_FIGURES },
  );

/**
 * A person's pool as the screen needs it: the viewer's own by default, or
 * that of someone in the viewer's branch. Anyone else — a neighbour, the
 * viewer's own manager — is not found: the chart is not a way to look around.
 */
export async function getCascade(
  actor: ActorContext,
  timezone: string,
  viewedUserId?: string,
): Promise<CascadeDto> {
  const line = await loadLine(actor.workspaceId, actor.userId);

  // Not in any department: a pool of one's own, and nobody to hand anything to.
  if (!line) {
    if (viewedUserId && viewedUserId !== actor.userId) throw notFound('Сотрудник');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: userSummarySelect });
    const person: CascadePersonDto = { user: toUserSummary(user)!, position: null };
    const own = (await figuresFor(actor, [actor.userId], timezone)).get(actor.userId)!;
    return { person, department: null, chain: [person], manager: null, own, branch: own, branchSize: 1, reports: [] };
  }

  const viewed = viewedUserId && viewedUserId !== actor.userId ? line.byUser.get(viewedUserId) : line.self;
  if (!viewed) throw notFound('Сотрудник');

  // The way down from the viewer to the person shown; it exists only inside the viewer's branch.
  const chain: LineMember[] = [viewed];
  const walked = new Set([viewed.id]);
  while (chain[0]!.id !== line.self.id) {
    const manager = chain[0]!.managerId ? line.byRow.get(chain[0]!.managerId) : undefined;
    if (!manager || walked.has(manager.id)) throw notFound('Сотрудник');
    walked.add(manager.id);
    chain.unshift(manager);
  }

  const reports = line.reportsOf.get(viewed.id) ?? [];
  const under = below(line, viewed);
  const figures = await figuresFor(actor, [viewed.user.id, ...under.map((member) => member.user.id)], timezone);

  return {
    person: toPerson(viewed),
    department: line.department,
    chain: chain.map(toPerson),
    manager: viewed.managerId && line.byRow.has(viewed.managerId) ? toPerson(line.byRow.get(viewed.managerId)!) : null,
    own: figures.get(viewed.user.id)!,
    branch: sum(figures, [viewed.user.id, ...under.map((member) => member.user.id)]),
    branchSize: under.length + 1,
    reports: reports.map((report) => {
      const theirs = below(line, report).map((member) => member.user.id);
      return {
        ...toPerson(report),
        own: figures.get(report.user.id) ?? { ...NO_FIGURES },
        below: sum(figures, theirs),
        belowUserIds: theirs,
      };
    }),
  };
}

const ONE_STEP =
  'Через распределение задачу можно передать своему непосредственному подчинённому, переложить между ними или вернуть себе';

/**
 * Moves tasks one step along the line. All or nothing: a task the sender may
 * not move, a recipient who cannot open its project, or a task that has
 * changed hands meanwhile fails the whole batch.
 */
export async function handoff(actor: ActorContext, input: HandoffInput): Promise<{ updated: number }> {
  const line = await loadLine(actor.workspaceId, actor.userId);
  if (!line) throw forbidden('Вы не состоите в отделе: передавать задачи по подчинённости некому');

  const direct = new Set((line.reportsOf.get(line.self.id) ?? []).map((member) => member.user.id));
  const to = input.toUserId;
  if (to !== actor.userId && !direct.has(to)) throw forbidden(ONE_STEP);

  for (const item of input.items) {
    const from = item.expectedAssigneeId;
    const down = from === actor.userId && direct.has(to);
    const sideways = from !== null && direct.has(from) && direct.has(to) && from !== to;
    const back = from !== null && direct.has(from) && to === actor.userId;
    if (!down && !sideways && !back) throw forbidden(ONE_STEP);
  }

  const ids = [...new Set(input.items.map((item) => item.issueId))];
  // Finished work is looked at here, not handed out: a drag must not quietly reopen a question of who does it.
  const allowed = await visibleProjectIds(actor);
  const closed = await prisma.issue.findMany({
    where: {
      id: { in: ids },
      project: { workspaceId: actor.workspaceId },
      ...(allowed === 'ALL' ? {} : { projectId: { in: allowed } }),
      status: { category: { in: ['COMPLETED', 'CANCELED'] } },
    },
    select: { issueKey: true },
  });
  if (closed.length) {
    throw badRequest(`Завершённые и отменённые задачи не передаются: ${closed.map((issue) => issue.issueKey).join(', ')}`);
  }

  // The ordinary change of assignee from here on — access of the sender and
  // of the recipient per project, history, notifications — claimed against
  // what the sender saw.
  return bulkUpdate(
    actor,
    ids,
    { assigneeId: to },
    {
      expected: new Map(
        input.items.map((item) => [
          item.issueId,
          {
            assigneeId: item.expectedAssigneeId,
            ...(item.expectedUpdatedAt ? { updatedAt: new Date(item.expectedUpdatedAt) } : {}),
          },
        ]),
      ),
    },
  );
}
