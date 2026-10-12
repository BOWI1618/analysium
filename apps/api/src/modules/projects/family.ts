/**
 * A project seen together with its subprojects.
 *
 * A subproject is a project of its own — its own tasks, statuses and
 * members. Opened by itself it shows only its own work. The project above it
 * is the place where everything is seen at once: its own tasks and those of
 * every subproject, on one board and in one list.
 *
 * Two things make that possible without merging anything:
 *
 * The family is cut by access. A subproject the actor cannot open adds
 * nothing — not a task, not a figure.
 *
 * Statuses are matched, not shared. Each project keeps its own columns; a
 * subproject's status stands in the parent's column of the same name, or
 * failing that of the same meaning. The task itself never gets a status of
 * another project: moved on the parent's board, it takes its own project's
 * status that stands for the column it was dropped into.
 */
import type { ActorContext } from '@flowdesk/contracts';
import { prisma } from '../../lib/prisma';
import { visibleProjectIds } from '../../lib/context';

export interface StatusLike {
  id: string;
  name: string;
  category: string;
  isDefault?: boolean;
}

const closes = (category: string) => category === 'COMPLETED' || category === 'CANCELED';
const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase('ru') === b.trim().toLocaleLowerCase('ru');

/**
 * The status among `targets` that stands for `source` — a status of another
 * project. By name first: «На ревью» is «На ревью». Then by meaning: the first
 * column of the same category. A project that has no such category still has
 * to put the task somewhere true: finished work goes to a closing column, open
 * work to the one new tasks get.
 *
 * `targets` are in board order.
 */
export function equivalentStatus<T extends StatusLike>(targets: T[], source: { name: string; category: string }): T | undefined {
  return (
    targets.find((status) => sameName(status.name, source.name) && closes(status.category) === closes(source.category)) ??
    targets.find((status) => status.category === source.category) ??
    (closes(source.category)
      ? (targets.find((status) => status.category === 'COMPLETED') ?? targets.find((status) => closes(status.category)))
      : (targets.find((status) => status.isDefault && !closes(status.category)) ??
        targets.find((status) => !closes(status.category)))) ??
    targets[0]
  );
}

/** The project and the subprojects under it that the actor may open; the project itself comes first. */
export async function projectFamily(actor: ActorContext, projectId: string): Promise<string[]> {
  const children = await prisma.project.findMany({
    where: { parentId: projectId, workspaceId: actor.workspaceId, isArchived: false },
    select: { id: true },
  });
  if (children.length === 0) return [projectId];
  const allowed = await visibleProjectIds(actor);
  return [projectId, ...children.map((child) => child.id).filter((id) => allowed === 'ALL' || allowed.includes(id))];
}

/**
 * For each status of the project, the statuses of its subprojects that stand
 * in its column. Every status of a subproject lands in exactly one column, so
 * a task is never shown twice and never lost.
 */
export async function statusStandIns(projectId: string, family: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const others = family.filter((id) => id !== projectId);
  if (others.length === 0) return result;

  const statuses = await prisma.workflowStatus.findMany({
    where: { projectId: { in: family } },
    orderBy: { position: 'asc' },
    select: { id: true, name: true, category: true, isDefault: true, projectId: true },
  });
  const own = statuses.filter((status) => status.projectId === projectId);
  for (const status of statuses) {
    if (status.projectId === projectId) continue;
    const column = equivalentStatus(own, status);
    if (column) result.set(column.id, [...(result.get(column.id) ?? []), status.id]);
  }
  return result;
}

/**
 * A project's filter turned into one over the project and its subprojects —
 * where that was asked for and there is anything to add.
 */
export async function withinFamily<
  T extends { projectId?: string | string[]; statusId?: string[]; withSubprojects?: boolean },
>(actor: ActorContext, projectId: string, filter: T): Promise<T> {
  if (!filter.withSubprojects) return filter;
  const family = await projectFamily(actor, projectId);
  if (family.length === 1) return filter;
  const standIns = await statusStandIns(projectId, family);
  return { ...filter, projectId: family, statusId: withStandIns(filter.statusId, standIns) };
}

/** Statuses chosen in the project's filter, widened to the subprojects' statuses that stand for them. */
export function withStandIns(statusIds: string[] | undefined, standIns: Map<string, string[]>): string[] | undefined {
  if (!statusIds?.length) return statusIds;
  return [...new Set(statusIds.flatMap((id) => [id, ...(standIns.get(id) ?? [])]))];
}
