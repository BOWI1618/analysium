import { Prisma } from '@prisma/client';
import {
  collectMentions,
  dayPlanPath,
  docToText,
  NotificationType,
  Permission,
  type ActorContext,
  type DayPlanDraftDto,
  type DayPlansDto,
  type RichDoc,
  type SaveDayPlanInput,
} from '@flowdesk/contracts';
import { assertCan } from '../../lib/context';
import { badRequest, conflict } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { userSummarySelect } from '../../lib/serialize';
import { announceNotifications } from '../notifications/service';
import { cleanPlan, mentionedLines, normalizeMentions, notificationExcerpt } from './document';

const atNoon = (date: string) => new Date(`${date}T12:00:00.000Z`);
const draftSelect = { draft: true, publishedContent: true, revision: true } as const;

function toDraft(row: { draft: Prisma.JsonValue; publishedContent: Prisma.JsonValue; revision: number }): DayPlanDraftDto {
  return { content: row.draft as unknown as RichDoc, publishedContent: row.publishedContent as unknown as RichDoc | null, revision: row.revision };
}

export async function listDayPlans(actor: ActorContext, date: string): Promise<DayPlansDto> {
  const { workspaceId, userId } = actor;
  const day = atNoon(date);
  const membership = await prisma.departmentMember.findFirst({
    where: { member: { workspaceId, userId } },
    select: { manager: { select: { member: { select: { userId: true } } } } },
  });
  const managerId = membership?.manager?.member.userId;
  const [own, published] = await Promise.all([
    prisma.dayPlan.findUnique({ where: { workspaceId_day_authorId: { workspaceId, day, authorId: userId } }, select: draftSelect }),
    prisma.dayPlan.findMany({
      where: {
        workspaceId,
        day,
        publishedAt: { not: null },
        author: { status: 'ACTIVE', memberships: { some: { workspaceId } } },
        OR: [
          { authorId: { in: managerId ? [userId, managerId] : [userId] } },
          { mentionedUserIds: { has: userId } },
        ],
      },
      select: { id: true, author: { select: userSummarySelect }, publishedContent: true },
      orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
    }),
  ]);
  return {
    draft: own ? toDraft(own) : null,
    plans: published.map((plan) => ({
      id: plan.id,
      author: plan.author,
      content: plan.publishedContent as unknown as RichDoc,
    })),
  };
}

export async function saveDayPlan(actor: ActorContext, date: string, input: SaveDayPlanInput): Promise<DayPlanDraftDto> {
  assertCan(actor, Permission.ISSUE_ASSIGN);
  const { workspaceId, userId } = actor;
  const content = cleanPlan(input.content);
  if (input.publish && !docToText(content)) throw badRequest('Добавьте хотя бы один пункт плана');
  const key = { workspaceId, day: atNoon(date), authorId: userId };
  const stale = () => conflict('План изменился в другой вкладке. Скопируйте свои правки и обновите страницу.');

  const { saved, notices } = await prisma.$transaction(async (tx) => {
    const previous = await tx.dayPlan.findUnique({
      where: { workspaceId_day_authorId: key },
      select: { ...draftSelect, id: true },
    });
    if ((previous?.revision ?? null) !== input.revision) throw stale();

    const oldLines = previous?.publishedContent ? mentionedLines(previous.publishedContent as unknown as RichDoc) : new Map<string, string[]>();
    const members = await tx.workspaceMember.findMany({
      where: { workspaceId, userId: { in: [...new Set([...collectMentions(content), ...oldLines.keys()])] }, user: { status: 'ACTIVE' } },
      select: { user: { select: { id: true, name: true } } },
    });
    const names = new Map(members.map(({ user }) => [user.id, user.name]));
    normalizeMentions(content, names);
    const newLines = input.publish ? mentionedLines(content) : new Map<string, string[]>();
    const json = content as unknown as Prisma.InputJsonObject;
    const data = {
      draft: json,
      ...(input.publish ? { publishedContent: json, publishedAt: new Date(), mentionedUserIds: [...newLines.keys()] } : {}),
    };

    let id: string;
    if (previous) {
      const updated = await tx.dayPlan.updateMany({
        where: { id: previous.id, revision: previous.revision },
        data: { ...data, revision: { increment: 1 } },
      });
      if (updated.count === 0) throw stale();
      id = previous.id;
    } else {
      const [created] = await tx.dayPlan.createManyAndReturn({ data: { ...key, ...data }, skipDuplicates: true, select: { id: true } });
      if (!created) throw stale();
      id = created.id;
    }

    const changes: Prisma.NotificationCreateManyInput[] = [];
    if (input.publish) {
      const titleDate = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeZone: 'UTC' }).format(key.day);
      for (const recipientId of new Set([...oldLines.keys(), ...newLines.keys()])) {
        if (recipientId === userId || !names.has(recipientId)) continue;
        const before = oldLines.get(recipientId) ?? [];
        const after = newLines.get(recipientId) ?? [];
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        changes.push({
          userId: recipientId,
          workspaceId,
          actorId: userId,
          type: NotificationType.DAY_PLAN,
          title: before.length ? `Изменился план на ${titleDate}` : `План на ${titleDate}`,
          body: after.length ? notificationExcerpt(after) : 'Ваше упоминание убрали из плана.',
          dayPlanId: after.length ? id : null,
        });
      }
    }

    const notices = changes.length ? await tx.notification.createManyAndReturn({
      data: changes, select: { id: true, userId: true, title: true, body: true, dayPlanId: true },
    }) : [];
    const saved = await tx.dayPlan.findUniqueOrThrow({ where: { id }, select: draftSelect });
    return { saved, notices };
  });

  for (const notice of notices) {
    announceNotifications([notice], {
      actorId: userId,
      workspaceId,
      type: NotificationType.DAY_PLAN,
      title: notice.title,
      body: notice.body,
      ...(notice.dayPlanId ? { dayPlanPath: dayPlanPath(workspaceId, date, notice.dayPlanId) } : {}),
    });
  }
  return toDraft(saved);
}
