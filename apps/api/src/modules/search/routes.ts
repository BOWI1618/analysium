import type { FastifyInstance } from 'fastify';
import type { SearchResultsDto } from '@flowdesk/contracts';
import { searchQuerySchema } from '@flowdesk/contracts';
import { parse } from '../../lib/validate';
import { prisma } from '../../lib/prisma';
import { visibleProjectIds, workspaceContext } from '../../lib/context';
import { currentUser, requireAuth } from '../../plugins/auth';
import { issueSummarySelect, toIssueSummary } from '../../lib/serialize';

/**
 * Global search across issues, projects, people and epics.
 * Backed by the trigram indexes added in the search_indexes migration, and
 * every branch is scoped to projects the caller may actually read.
 */
export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get<{ Params: { workspaceId: string } }>('/workspaces/:workspaceId/search', async (req) => {
    const actor = await workspaceContext(currentUser(req).id, req.params.workspaceId);
    const parsed = parse(searchQuerySchema, req.query);
    const { limit } = parsed;
    // «@имя» looks for people only — the hint in the header promises it. The
    // rest of the query goes to the name and address search as typed.
    const peopleOnly = parsed.q.startsWith('@');
    const q = peopleOnly ? parsed.q.slice(1).trim() : parsed.q;
    const allowed = await visibleProjectIds(actor);
    const projectScope = allowed === 'ALL' ? {} : { projectId: { in: allowed } };

    // An exact issue key ("WEB-42") should win over fuzzy title matches.
    const keyMatch = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(q.trim());

    const [issues, projects, users, epics] = await Promise.all([
      peopleOnly ? [] : prisma.issue.findMany({
        where: {
          project: { workspaceId: actor.workspaceId },
          ...projectScope,
          archivedAt: null,
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { descriptionText: { contains: q, mode: 'insensitive' } },
            { issueKey: { startsWith: q.toUpperCase() } },
          ],
        },
        orderBy: keyMatch ? [{ issueKey: 'asc' }] : [{ updatedAt: 'desc' }],
        take: limit,
        select: issueSummarySelect,
      }),
      peopleOnly ? [] : prisma.project.findMany({
        where: {
          workspaceId: actor.workspaceId,
          isArchived: false,
          ...(allowed === 'ALL' ? {} : { id: { in: allowed } }),
          OR: [{ name: { contains: q, mode: 'insensitive' } }, { key: { startsWith: q.toUpperCase() } }],
        },
        take: 5,
        select: { id: true, name: true, key: true, icon: true, color: true },
      }),
      prisma.user.findMany({
        where: {
          memberships: { some: { workspaceId: actor.workspaceId } },
          // A bare «@» lists people, the start of choosing someone.
          ...(q
            ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] }
            : {}),
        },
        orderBy: { name: 'asc' },
        take: peopleOnly ? limit : 5,
        select: { id: true, name: true, email: true, avatarUrl: true },
      }),
      peopleOnly ? [] : prisma.issue.findMany({
        where: {
          project: { workspaceId: actor.workspaceId },
          ...projectScope,
          type: 'EPIC',
          archivedAt: null,
          title: { contains: q, mode: 'insensitive' },
        },
        take: 5,
        select: { id: true, issueKey: true, title: true, projectId: true, project: { select: { color: true } } },
      }),
    ]);

    const results: SearchResultsDto = {
      issues: issues.map(toIssueSummary),
      projects,
      users,
      epics: epics.map((e) => ({
        id: e.id,
        issueKey: e.issueKey,
        title: e.title,
        projectId: e.projectId,
        color: e.project.color,
      })),
    };
    return results;
  });
}
