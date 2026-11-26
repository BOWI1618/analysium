import { Prisma } from '@prisma/client';
import {
  collectMentions,
  dayPlanChecklistItem,
  dayPlanPath,
  docToText,
  NotificationType,
  Permission,
  RealtimeEventType,
  type ActorContext,
  type CheckDayPlanItemInput,
  type DayPlanDraftDto,
  type DayPlansDto,
  type RichDoc,
  type SaveDayPlanInput,
} from '@flowdesk/contracts';
import { assertCan } from '../../lib/context';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { userSummarySelect } from '../../lib/serialize';
import { emit } from '../../realtime/eventBus';
import { announceNotifications } from '../notifications/service';
import { cleanPlan, mentionedLines, normalizeMentions, notificationExcerpt } from './document';

const atNoon = (date: string) => new Date(`${date}T12:00:00.000Z`);
const draftSelect = { draft: true, publishedContent: true, revision: true } as const;
const stalePlan = () => conflict('План изменился в другой вкладке. Скопируйте свои правки и обновите страницу.');

function toDraft(row: { draft: Prisma.JsonValue; publishedContent: Prisma.JsonValue; revision: number }): DayPlanDraftDto {
  return { content: row.draft as unknown as RichDoc, publishedContent: row.publishedContent as unknown as RichDoc | null, revision: row.revision };
}

async function publishedPlansWhere(actor: ActorContext): Promise<Prisma.DayPlanWhereInput> {
  const { workspaceId, userId } = actor;
  const membership = await prisma.departmentMember.findFirst({
    where: { member: { workspaceId, userId } },
    select: { manager: { select: { member: { select: { userId: true } } } } },
  });
  const managerId = membership?.manager?.member.userId;
  return {
    workspaceId,
    publishedAt: { not: null },
    author: { status: 'ACTIVE', memberships: { some: { workspaceId } } },
    OR: [
      { authorId: { in: managerId ? [userId, managerId] : [userId] } },
      { mentionedUserIds: { has: userId } },
    ],
  };
}

export async function listDayPlans(actor: ActorContext, date: string): Promise<DayPlansDto> {
  const { workspaceId, userId } = actor;
  const day = atNoon(date);
  const visible = await publishedPlansWhere(actor);
  const [own, published] = await Promise.all([
    prisma.dayPlan.findUnique({ where: { workspaceId_day_authorId: { workspaceId, day, authorId: userId } }, select: draftSelect }),
    prisma.dayPlan.findMany({
      where: { ...visible, day },
      select: { id: true, author: { select: userSummarySelect }, publishedContent: true, publishedAt: true },
      orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
    }),
  ]);
  return {
    draft: own ? toDraft(own) : null,
    plans: published.map((plan) => ({
      id: plan.id,
      author: plan.author,
      content: plan.publishedContent as unknown as RichDoc,
      publishedAt: plan.publishedAt!.toISOString(),
    })),
  };
}

export async function checkDayPlanItem(actor: ActorContext, planId: string, input: CheckDayPlanItemInput): Promise<void> {
  const visible = await publishedPlansWhere(actor);
  await prisma.$transaction(async (tx) => {
    // Serialize checkbox writes and publication changes against this plan.
    await tx.$queryRaw`SELECT id FROM "day_plans" WHERE id = ${planId} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
    const plan = await tx.dayPlan.findFirst({
      where: { ...visible, id: planId },
      select: { draft: true, publishedContent: true, publishedAt: true, authorId: true },
    });
    if (!plan?.publishedContent) throw notFound('План');
    if (plan.authorId !== actor.userId) assertCan(actor, Permission.ISSUE_UPDATE);
    if (plan.publishedAt?.toISOString() !== input.publishedAt) {
      throw conflict('План был опубликован заново. Проверьте пункт и попробуйте ещё раз.');
    }
    const content = plan.publishedContent as unknown as RichDoc;
    const item = dayPlanChecklistItem(content, input.path);
    if (!item) throw notFound('Пункт плана');
    if ((item.attrs?.checked === true) === input.checked) return;

    const draft = plan.draft as unknown as RichDoc;
    const draftItem = dayPlanChecklistItem(draft, input.path);
    // Copy progress into the draft only if this position still holds the same item.
    const ownText = (node: NonNullable<typeof draftItem>) =>
      JSON.stringify(node.content?.filter((child) => child.type !== 'taskList') ?? []);
    const syncDraft = draftItem && ownText(draftItem) === ownText(item);
    item.attrs = { ...item.attrs, checked: input.checked };
    if (syncDraft) draftItem.attrs = { ...draftItem.attrs, checked: input.checked };

    await tx.dayPlan.update({
      where: { id: planId },
      data: {
        publishedContent: content as unknown as Prisma.InputJsonObject,
        ...(syncDraft ? { draft: draft as unknown as Prisma.InputJsonObject } : {}),
        revision: { increment: 1 },
      },
    });
  });
}

export async function saveDayPlan(actor: ActorContext, date: string, input: SaveDayPlanInput): Promise<DayPlanDraftDto> {
  assertCan(actor, Permission.ISSUE_ASSIGN);
  const { workspaceId, userId } = actor;
  const content = cleanPlan(input.content);
  if (input.publish && !docToText(content)) throw badRequest('Добавьте хотя бы один пункт плана');
  const key = { workspaceId, day: atNoon(date), authorId: userId };
  const { saved, notices } = await prisma.$transaction(async (tx) => {
    const previous = await tx.dayPlan.findUnique({
      where: { workspaceId_day_authorId: key },
      select: { ...draftSelect, id: true },
    });
    if ((previous?.revision ?? null) !== input.revision) throw stalePlan();

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
      if (updated.count === 0) throw stalePlan();
      id = previous.id;
    } else {
      const [created] = await tx.dayPlan.createManyAndReturn({ data: { ...key, ...data }, skipDuplicates: true, select: { id: true } });
      if (!created) throw stalePlan();
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

export async function unpublishDayPlan(actor: ActorContext, date: string, revision: number): Promise<DayPlanDraftDto> {
  assertCan(actor, Permission.ISSUE_ASSIGN);
  const { workspaceId, userId } = actor;
  const key = { workspaceId, day: atNoon(date), authorId: userId };
  const { saved, recipients } = await prisma.$transaction(async (tx) => {
    const current = await tx.dayPlan.findUnique({
      where: { workspaceId_day_authorId: key },
      select: { ...draftSelect, id: true },
    });
    if (!current) throw notFound('План');
    if (!current.publishedContent) return { saved: current, recipients: [] };
    if (current.revision !== revision) throw stalePlan();

    const updated = await tx.dayPlan.updateMany({
      where: { id: current.id, revision },
      data: { publishedContent: Prisma.DbNull, publishedAt: null, mentionedUserIds: [], revision: { increment: 1 } },
    });
    if (!updated.count) throw stalePlan();

    const where = { dayPlanId: current.id };
    const recipients = await tx.notification.findMany({ where, distinct: ['userId'], select: { userId: true } });
    await tx.notification.deleteMany({ where });
    return { saved: { ...current, publishedContent: null, revision: revision + 1 }, recipients };
  });

  for (const { userId: recipientId } of recipients) {
    emit(RealtimeEventType.NOTIFICATION_REMOVED, { workspaceId, actorId: userId, payload: { recipientId } });
  }
  return toDraft(saved);
}
