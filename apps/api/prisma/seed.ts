/**
 * Demo seed.
 *
 * Produces a workspace that looks like a team has been using it for weeks:
 * real people, three projects with different methodologies, epics, a finished
 * sprint, an active sprint, a backlog, comments and activity history.
 *
 * Idempotent: rerunning wipes the demo workspace and rebuilds it.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { hashPassword } from '../src/lib/password';
import { DEFAULT_STATUSES, formatIssueKey } from '../src/domain/issueRules';

/** Demo data only — real projects start without labels. */
const DEMO_LABELS: { name: string; color: string }[] = [
  { name: 'фронтенд', color: '#3b82f6' },
  { name: 'бэкенд', color: '#8b5cf6' },
  { name: 'дизайн', color: '#ec4899' },
  { name: 'инфраструктура', color: '#f59e0b' },
  { name: 'техдолг', color: '#64748b' },
  { name: 'от клиента', color: '#14b8a6' },
];
import { rankBetween } from '@flowdesk/contracts';

const prisma = new PrismaClient();

const DEMO_SLUG = 'acme';
const DEMO_PASSWORD = 'demo1234';
const DAY = 24 * 60 * 60 * 1000;

/** Deterministic PRNG so every seed run produces the same demo data. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
const rand = makeRandom(20260910);

const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
const chance = (p: number): boolean => rand() < p;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const daysAhead = (n: number) => new Date(Date.now() + n * DAY);

const PEOPLE = [
  { name: 'Алексей Рябов', email: 'alex@acme.test', role: 'OWNER' as const, avatar: '#6366f1' },
  { name: 'Мария Чен', email: 'maria@acme.test', role: 'ADMIN' as const, avatar: '#ec4899' },
  { name: 'Иван Окафор', email: 'john@acme.test', role: 'MEMBER' as const, avatar: '#14b8a6' },
  { name: 'Прия Наир', email: 'priya@acme.test', role: 'MEMBER' as const, avatar: '#f59e0b' },
  { name: 'Тимур Линд', email: 'tomas@acme.test', role: 'MEMBER' as const, avatar: '#8b5cf6' },
  { name: 'Дана Вольф', email: 'dana@acme.test', role: 'GUEST' as const, avatar: '#0ea5e9' },
];

const PROJECTS = [
  {
    name: 'Сайт',
    key: 'WEB',
    icon: '🌐',
    color: '#6366f1',
    projectType: 'SCRUM' as const,
    description: 'Маркетинговый сайт, документация и всё, что видит клиент.',
  },
  {
    name: 'Мобильное приложение',
    key: 'MOB',
    icon: '📱',
    color: '#ec4899',
    projectType: 'KANBAN' as const,
    description: 'Клиенты для iOS и Android на общей дизайн-системе.',
  },
  {
    name: 'Внутренние сервисы',
    key: 'OPS',
    icon: '🛠️',
    color: '#14b8a6',
    projectType: 'SIMPLE' as const,
    description: 'Админки, биллинг и внутренняя автоматизация.',
  },
];

const EPIC_TITLES: Record<string, string[]> = {
  WEB: ['Обновление дизайн-системы', 'Переделка оформления заказа', 'SEO и скорость'],
  MOB: ['Офлайн-режим', 'Push-уведомления', 'Переработка онбординга'],
  OPS: ['Автоматизация биллинга', 'Инструменты поддержки'],
};

const ISSUE_TITLES: Record<string, string[]> = {
  WEB: [
    'Переделать первый экран страницы тарифов',
    'Убрать скачок вёрстки в боковом меню документации',
    'Добавить тёмную тему на маркетинговый сайт',
    'Перенести блог на новую схему CMS',
    'Оплата: валидация отклоняет корректные карты Amex',
    'Снизить LCP ниже 2 секунд',
    'Добавить микроразметку для страниц продуктов',
    'Баннер о cookie перекрывает мобильное меню',
    'Собрать карусель логотипов клиентов',
    'Локализовать подвал для de-DE',
    'Неверные canonical на страницах с пагинацией',
    'Выпустить новый компонент отзывов',
    'Сжать изображения первого экрана в WebP',
    'Поиск отдаёт устаревшие результаты после публикации',
    'Добавить аналитические события в воронку регистрации',
    'Форма обратной связи молча теряет длинные сообщения',
    'Переписать страницу изменений на MDX',
    'В карту сайта не попадают новые страницы документации',
    'Добавить навигацию с клавиатуры в мегаменю',
    'Разобраться с 500-ми в калькуляторе тарифов',
  ],
  MOB: [
    'Офлайн-очередь теряет записи при принудительном закрытии',
    'Обновление push-токена ломается после переустановки',
    'Онбординг: у кнопки «Пропустить» нет зоны нажатия на iOS',
    'Сделать разблокировку по биометрии',
    'Падение на Android 13 при открытии камеры',
    'Добавить обновление жестом в ленту активности',
    'Сократить холодный старт до 1,5 секунды',
    'В тёмной теме не читается текст в редакторе',
    'Диплинки открывают не ту вкладку',
    'Конфликты синхронизации затирают локальные черновики',
    'Добавить тактильный отклик на свайпы',
    'Загрузка изображений падает через мобильную сеть',
    'Локализовать формат дат под язык устройства',
    'Сделать запрос оценки приложения',
    'Сессия истекает без видимого сообщения',
    'Добавить скелетоны загрузки во «Входящие»',
    'Клавиатура перекрывает поле ответа',
    'Расход батареи в фоновом режиме',
  ],
  OPS: [
    'Автоматизировать выставление счетов за месяц',
    'Консоль поддержки: аудит входа под клиентом',
    'Перенести cron-задачи в сервис планировщика',
    'Добавить алерты на неудачные доставки вебхуков',
    'Возврат средств не освобождает лицензию',
    'Сделать выгрузку потребления для финансов',
    'Ротация ключей сервисных аккаунтов',
    'Запрос дашборда отваливается по таймауту на 90 днях',
    'Добавить ролевой доступ в админ-панель',
    'Убрать дубли клиентов из синхронизации с CRM',
    'Восстановить пропущенные события подписок',
    'Настроить обезличивание данных на стенде',
  ],
};

const COMMENTS = [
  'Взял в работу — PR будет завтра.',
  'Воспроизводится на стенде, но только на холодном кеше.',
  'Ждём, пока приедет изменение в API.',
  'Хорошая находка. Добавляю регрессионный тест.',
  'Перевёл на ревью, нужен второй взгляд.',
  'Оказалось больше, чем ожидали, — вынес продолжение отдельной задачей.',
  'После последнего деплоя починилось, проверил.',
  'Берём в текущий спринт или в следующий?',
  'Дизайн согласовал последнюю итерацию.',
  'Пока откатил — ломался ночной билд.',
];

function paragraph(text: string): Prisma.InputJsonValue {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

/**
 * A plausible scheduled window: most work has both a start and an end so the
 * Gantt is populated out of the box, a few items carry only a deadline, and a
 * handful are left unscheduled to exercise the "not planned yet" tray.
 */
function schedule(): { startDate: Date | null; dueDate: Date | null } {
  const roll = rand();
  if (roll < 0.18) return { startDate: null, dueDate: null };
  if (roll < 0.3) {
    return { startDate: null, dueDate: new Date(Date.now() + (rand() * 24 - 6) * DAY) };
  }

  const startOffset = rand() * 30 - 14;
  const durationDays = 1 + Math.floor(rand() * 9);
  const start = new Date(Date.now() + startOffset * DAY);
  return { startDate: start, dueDate: new Date(start.getTime() + durationDays * DAY) };
}

function issueDescription(title: string): Prisma.InputJsonValue {
  return {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: `${title}.` }] },
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Критерии приёмки' }] },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: true },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Воспроизведено и оценено' }] }],
          },
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Покрыто автотестом' }] }],
          },
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Проверено на стенде' }] }],
          },
        ],
      },
    ],
  };
}

async function main(): Promise<void> {
  // Dev-only: rerunning wipes the demo workspace and resets demo users'
  // passwords, which must never happen against a production database.
  if (process.env.NODE_ENV === 'production') {
    console.error('Seed is dev-only: refusing to run with NODE_ENV=production.');
    process.exit(1);
  }

  console.log('Заполняем демо-данные FlowDesk…');

  const existing = await prisma.workspace.findUnique({ where: { slug: DEMO_SLUG }, select: { id: true } });
  if (existing) {
    await prisma.workspace.delete({ where: { id: existing.id } });
    console.log('  удалено прежнее демо-пространство');
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const users = await Promise.all(
    PEOPLE.map((person) =>
      prisma.user.upsert({
        where: { email: person.email },
        // Demo accounts are verified outright: there is no mailbox behind
        // these addresses, so a confirmation link would strand every one of
        // them the moment MAIL_ENABLED is turned on.
        update: { name: person.name, passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date() },
        create: {
          name: person.name,
          email: person.email,
          passwordHash,
          emailVerifiedAt: new Date(),
          timezone: 'Europe/Berlin',
          lastActiveAt: daysAgo(rand() * 2),
        },
      }),
    ),
  );
  const userByEmail = new Map(users.map((u) => [u.email, u]));
  const owner = userByEmail.get('alex@acme.test')!;
  const activeUsers = users.filter((u) => u.email !== 'dana@acme.test');

  const workspace = await prisma.workspace.create({
    data: { name: 'Acme', slug: DEMO_SLUG, ownerId: owner.id, logo: '🚀' },
  });

  await prisma.workspaceMember.createMany({
    data: PEOPLE.map((p) => ({
      workspaceId: workspace.id,
      userId: userByEmail.get(p.email)!.id,
      role: p.role,
      joinedAt: daysAgo(60 - PEOPLE.indexOf(p) * 4),
    })),
  });

  let totalIssues = 0;

  for (const spec of PROJECTS) {
    const lead = pick(activeUsers);
    const project = await prisma.project.create({
      data: {
        workspaceId: workspace.id,
        name: spec.name,
        key: spec.key,
        icon: spec.icon,
        color: spec.color,
        description: spec.description,
        projectType: spec.projectType,
        leadId: lead.id,
        createdAt: daysAgo(55),
      },
    });

    await prisma.projectMember.createMany({
      data: activeUsers.map((u) => ({
        projectId: project.id,
        userId: u.id,
        role: u.id === lead.id ? ('LEAD' as const) : ('CONTRIBUTOR' as const),
      })),
    });
    // The guest can only see one project — demonstrates guest scoping.
    if (spec.key === 'WEB') {
      await prisma.projectMember.create({
        data: { projectId: project.id, userId: userByEmail.get('dana@acme.test')!.id, role: 'VIEWER' },
      });
    }

    const statuses = await Promise.all(
      DEFAULT_STATUSES.map((s, index) =>
        prisma.workflowStatus.create({
          data: {
            projectId: project.id,
            name: s.name,
            category: s.category,
            color: s.color,
            position: index,
            wipLimit: s.wipLimit ?? null,
            isDefault: index === 1,
          },
        }),
      ),
    );
    const statusByCategory = (category: string) => statuses.filter((s) => s.category === category);

    const labels = await Promise.all(
      DEMO_LABELS.map((l) =>
        prisma.label.create({ data: { projectId: project.id, name: l.name, color: l.color } }),
      ),
    );

    /* ------------------------------------------------------------ sprints */

    let sprints: { id: string; status: string }[] = [];
    if (spec.projectType === 'SCRUM') {
      const finished = await prisma.sprint.create({
        data: {
          projectId: project.id,
          name: `${spec.key} Спринт 12`,
          goal: 'Стабилизировать оформление заказа и выпустить новые тарифы.',
          status: 'COMPLETED',
          startDate: daysAgo(28),
          endDate: daysAgo(14),
          completedAt: daysAgo(14),
          committedPoints: 34,
          position: 0,
        },
      });
      const active = await prisma.sprint.create({
        data: {
          projectId: project.id,
          name: `${spec.key} Спринт 13`,
          goal: 'Снизить LCP ниже 2 секунд и завершить переход на дизайн-систему.',
          status: 'ACTIVE',
          startDate: daysAgo(5),
          endDate: daysAhead(9),
          committedPoints: 29,
          position: 1,
        },
      });
      const planned = await prisma.sprint.create({
        data: {
          projectId: project.id,
          name: `${spec.key} Спринт 14`,
          goal: null,
          status: 'PLANNED',
          startDate: daysAhead(10),
          endDate: daysAhead(24),
          position: 2,
        },
      });
      sprints = [finished, active, planned];
    }

    /* -------------------------------------------------------------- epics */

    let counter = 0;
    const nextKey = () => {
      counter += 1;
      return { number: counter, issueKey: formatIssueKey(spec.key, counter) };
    };

    // Annotated explicitly: the array is referenced inside the loop that fills
    // it, so TypeScript cannot infer its element type on its own.
    const epics: { id: string; issueKey: string; title: string }[] = [];
    for (const title of EPIC_TITLES[spec.key] ?? []) {
      const key = nextKey();
      const epic = await prisma.issue.create({
        data: {
          projectId: project.id,
          number: key.number,
          issueKey: key.issueKey,
          title,
          description: issueDescription(title),
          descriptionText: title,
          type: 'EPIC',
          statusId: pick(statusByCategory('STARTED')).id,
          priority: 'HIGH',
          reporterId: lead.id,
          assigneeId: pick(activeUsers).id,
          rank: rankBetween(null, null) + String(epics.length),
          createdAt: daysAgo(50),
        },
      });
      epics.push(epic);
    }

    /* ------------------------------------------------------------- issues */

    const titles = ISSUE_TITLES[spec.key] ?? [];
    const rankByStatus = new Map<string, string | null>();
    const createdIssues: { id: string; issueKey: string; title: string; statusId: string; category: string }[] = [];

    for (const title of titles) {
      const key = nextKey();
      const isBug = /fail|crash|broken|drop|stale|error|500|conflict|timeout|reject|silently|drain/i.test(title);
      const type = isBug ? 'BUG' : chance(0.35) ? 'STORY' : 'TASK';

      // Skew the distribution so the board looks like real work in flight.
      const roll = rand();
      const status =
        roll < 0.25
          ? pick(statusByCategory('BACKLOG'))
          : roll < 0.45
            ? pick(statusByCategory('UNSTARTED'))
            : roll < 0.68
              ? pick(statusByCategory('STARTED'))
              : pick(statusByCategory('COMPLETED'));

      const prevRank = rankByStatus.get(status.id) ?? null;
      const rank = rankBetween(prevRank, null);
      rankByStatus.set(status.id, rank);

      const done = status.category === 'COMPLETED';
      const createdAt = daysAgo(2 + rand() * 45);
      const activeSprint = sprints.find((s) => s.status === 'ACTIVE');
      const completedSprint = sprints.find((s) => s.status === 'COMPLETED');

      const sprintId = sprints.length
        ? done
          ? (completedSprint?.id ?? null)
          : status.category === 'BACKLOG'
            ? null
            : (activeSprint?.id ?? null)
        : null;

      const issue = await prisma.issue.create({
        data: {
          projectId: project.id,
          number: key.number,
          issueKey: key.issueKey,
          title,
          description: issueDescription(title),
          descriptionText: title,
          type,
          statusId: status.id,
          priority: isBug ? pick(['URGENT', 'HIGH', 'HIGH', 'MEDIUM']) : pick(['HIGH', 'MEDIUM', 'MEDIUM', 'LOW', 'NONE']),
          reporterId: pick(activeUsers).id,
          assigneeId: chance(0.82) ? pick(activeUsers).id : null,
          epicId: epics.length && chance(0.6) ? pick(epics).id : null,
          sprintId,
          storyPoints: chance(0.75) ? pick([1, 2, 3, 3, 5, 5, 8, 13]) : null,
          ...schedule(),
          rank,
          createdAt,
          updatedAt: new Date(createdAt.getTime() + rand() * 5 * DAY),
          completedAt: done ? new Date(createdAt.getTime() + rand() * 10 * DAY) : null,
        },
      });
      totalIssues += 1;
      createdIssues.push({ ...issue, category: status.category });

      // Labels
      const labelCount = chance(0.7) ? 1 + Math.floor(rand() * 2) : 0;
      const chosen = new Set<string>();
      for (let i = 0; i < labelCount; i += 1) chosen.add(pick(labels).id);
      if (chosen.size) {
        await prisma.issueLabel.createMany({
          data: [...chosen].map((labelId) => ({ issueId: issue.id, labelId })),
        });
      }

      // History
      await prisma.activityEvent.create({
        data: { issueId: issue.id, actorId: issue.reporterId, type: 'ISSUE_CREATED', createdAt },
      });
      if (issue.assigneeId) {
        await prisma.activityEvent.create({
          data: {
            issueId: issue.id,
            actorId: pick(activeUsers).id,
            type: 'ASSIGNEE_CHANGED',
            field: 'assigneeId',
            toValue: issue.assigneeId,
            createdAt: new Date(createdAt.getTime() + DAY / 2),
          },
        });
      }
      if (status.category !== 'BACKLOG') {
        await prisma.activityEvent.create({
          data: {
            issueId: issue.id,
            actorId: issue.assigneeId ?? issue.reporterId,
            type: 'STATUS_CHANGED',
            field: 'statusId',
            toValue: status.id,
            metadata: { to: status.name },
            createdAt: new Date(createdAt.getTime() + DAY),
          },
        });
      }

      // Comments
      if (chance(0.55)) {
        const commentCount = 1 + Math.floor(rand() * 3);
        for (let i = 0; i < commentCount; i += 1) {
          const text = pick(COMMENTS);
          const author = pick(activeUsers);
          const at = new Date(createdAt.getTime() + (i + 1) * DAY * 0.7);
          const comment = await prisma.comment.create({
            data: {
              issueId: issue.id,
              authorId: author.id,
              body: paragraph(text),
              bodyText: text,
              createdAt: at,
              updatedAt: at,
            },
          });
          await prisma.activityEvent.create({
            data: {
              issueId: issue.id,
              actorId: author.id,
              type: 'COMMENT_ADDED',
              metadata: { commentId: comment.id },
              createdAt: at,
            },
          });
        }
      }

      // Subtasks on a few larger items
      if (type === 'STORY' && chance(0.4)) {
        const subCount = 2 + Math.floor(rand() * 3);
        await prisma.issue.update({ where: { id: issue.id }, data: { subtaskCounter: subCount } });
        for (let i = 0; i < subCount; i += 1) {
          // Numbered after the parent (WEB-4.1), not from the project counter.
          const subKey = { number: issue.number, subNumber: i + 1, issueKey: formatIssueKey(spec.key, issue.number, i + 1) };
          const subDone = chance(0.5);
          const subStatus = subDone ? pick(statusByCategory('COMPLETED')) : pick(statusByCategory('UNSTARTED'));
          await prisma.issue.create({
            data: {
              projectId: project.id,
              number: subKey.number,
              subNumber: subKey.subNumber,
              issueKey: subKey.issueKey,
              title: `${title} — шаг ${i + 1}`,
              type: 'SUBTASK',
              statusId: subStatus.id,
              priority: 'MEDIUM',
              reporterId: issue.reporterId,
              assigneeId: chance(0.7) ? pick(activeUsers).id : null,
              parentId: issue.id,
              rank: rankBetween(null, null) + String(i),
              createdAt,
              completedAt: subDone ? new Date(createdAt.getTime() + DAY * 2) : null,
            },
          });
          totalIssues += 1;
        }
      }
    }

    /* ------------------------------------------------- gantt: milestones */

    // One release milestone per project: a zero-duration marker the timeline
    // draws as a diamond.
    const milestoneKey = nextKey();
    const releaseDate = new Date(Date.now() + (10 + rand() * 12) * DAY);
    await prisma.issue.create({
      data: {
        projectId: project.id,
        number: milestoneKey.number,
        issueKey: milestoneKey.issueKey,
        title: `Релиз ${spec.name}`,
        description: issueDescription(`Релиз ${spec.name}`),
        descriptionText: `Релиз ${spec.name}`,
        type: 'TASK',
        statusId: pick(statusByCategory('UNSTARTED')).id,
        priority: 'HIGH',
        reporterId: lead.id,
        assigneeId: lead.id,
        startDate: releaseDate,
        dueDate: releaseDate,
        isMilestone: true,
        rank: rankBetween(null, null) + 'z',
        createdAt: daysAgo(20),
      },
    });
    totalIssues += 1;

    /* ----------------------------------------------- gantt: dependencies */

    // Chain a few scheduled issues so the chart shows real precedence links
    // and a critical path rather than an empty graph.
    const schedulable = await prisma.issue.findMany({
      where: { projectId: project.id, startDate: { not: null }, dueDate: { not: null }, parentId: null },
      orderBy: { startDate: 'asc' },
      select: { id: true, startDate: true, dueDate: true },
      take: 14,
    });

    // Only link pairs the schedule actually satisfies: the successor must start
    // no earlier than the predecessor finishes. A seeded plan that violates its
    // own links would show the demo as permanently broken.
    let linked = 0;
    for (let i = 0; i < schedulable.length - 1 && linked < 4; i += 1) {
      const predecessor = schedulable[i]!;
      const successor = schedulable.find(
        (candidate, index) =>
          index > i && candidate.startDate!.getTime() >= predecessor.dueDate!.getTime(),
      );
      if (!successor) continue;

      await prisma.issueDependency.create({
        data: {
          predecessorId: predecessor.id,
          successorId: successor.id,
          type: 'FINISH_TO_START',
          lagDays: 0,
          createdById: lead.id,
        },
      });
      linked += 1;
      // Skip ahead so the chain does not fan out from one task.
      i = schedulable.indexOf(successor);
    }

    // Keep the project's key counter in sync with the seeded issues, otherwise
    // the first issue created through the API would collide on (projectId, number).
    await prisma.project.update({ where: { id: project.id }, data: { issueCounter: counter } });

    console.log(`  ${spec.icon} ${spec.name} (${spec.key}) — задач верхнего уровня: ${createdIssues.length}`);
  }

  /* --------------------------------------------------------- notifications */

  const recentIssues = await prisma.issue.findMany({
    where: { project: { workspaceId: workspace.id }, assigneeId: { not: null } },
    orderBy: { updatedAt: 'desc' },
    take: 12,
    select: { id: true, issueKey: true, title: true, assigneeId: true },
  });

  for (const [index, issue] of recentIssues.entries()) {
    await prisma.notification.create({
      data: {
        userId: issue.assigneeId!,
        workspaceId: workspace.id,
        actorId: pick(activeUsers).id,
        type: index % 3 === 0 ? 'ISSUE_ASSIGNED' : index % 3 === 1 ? 'ISSUE_COMMENTED' : 'ISSUE_STATUS_CHANGED',
        title:
          // Same wording the live services produce, so demo notifications do
          // not read differently from real ones.
          index % 3 === 0
            ? `${issue.issueKey} назначена на вас`
            : index % 3 === 1
              ? `Новый комментарий в ${issue.issueKey}`
              : `Изменился статус у ${issue.issueKey}`,
        body: issue.title,
        issueId: issue.id,
        readAt: index > 4 ? daysAgo(1) : null,
        createdAt: daysAgo(index * 0.4),
      },
    });
  }

  /* ----------------------------------------------------------- saved views */

  await prisma.savedView.createMany({
    data: [
      {
        workspaceId: workspace.id,
        ownerId: owner.id,
        name: 'My open bugs',
        layout: 'LIST',
        isShared: true,
        filters: { assigneeId: ['@me'], type: ['BUG'], includeDone: false },
      },
      {
        workspaceId: workspace.id,
        ownerId: owner.id,
        name: 'Overdue across projects',
        layout: 'LIST',
        isShared: true,
        filters: { isOverdue: true, sort: 'dueDate', order: 'asc' },
      },
      {
        workspaceId: workspace.id,
        ownerId: owner.id,
        name: 'Urgent & unassigned',
        layout: 'LIST',
        isShared: true,
        filters: { priority: ['URGENT', 'HIGH'], assigneeId: ['none'], includeDone: false },
      },
    ],
  });

  await prisma.auditLog.createMany({
    data: [
      {
        workspaceId: workspace.id,
        actorId: owner.id,
        action: 'WORKSPACE_CREATED',
        entityType: 'Workspace',
        entityId: workspace.id,
        createdAt: daysAgo(60),
      },
      {
        workspaceId: workspace.id,
        actorId: owner.id,
        action: 'MEMBER_INVITED',
        entityType: 'WorkspaceMember',
        metadata: { email: 'maria@acme.test', role: 'ADMIN' },
        createdAt: daysAgo(56),
      },
    ],
  });

  console.log(`\nГотово. Задач: ${totalIssues}, проектов: ${PROJECTS.length}.`);
  console.log('\nДемо-аккаунты (пароль у всех: ' + DEMO_PASSWORD + ')');
  for (const p of PEOPLE) console.log(`  ${p.role.padEnd(6)} ${p.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
