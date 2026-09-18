import { useMemo } from 'react';
import type { ActivityDto, IssueDetailDto, LabelDto, StatusDto, UserSummaryDto } from '@flowdesk/contracts';
import { Avatar } from '~/ui/Avatar';
import { relativeTime, fullDate, shortDate } from '~/lib/format';
import { PRIORITY_META, ISSUE_TYPE_META } from '~/components/IssueMeta';

interface Lookups {
  statuses: StatusDto[];
  members: UserSummaryDto[];
  labels: LabelDto[];
}

/**
 * Renders each history entry as a sentence a human can read
 * ("Alex changed status from In Progress to Done") rather than a field dump.
 */
function describe(event: ActivityDto, lookups: Lookups): string | null {
  const statusName = (id: string | null) => lookups.statuses.find((s) => s.id === id)?.name ?? 'статус';
  const userName = (id: string | null) =>
    id ? (lookups.members.find((m) => m.id === id)?.name ?? 'кого-то') : null;

  switch (event.type) {
    case 'ISSUE_CREATED':
      return 'создал(а) задачу';
    case 'STATUS_CHANGED': {
      const from = (event.metadata?.from as string | undefined) ?? statusName(event.fromValue);
      const to = (event.metadata?.to as string | undefined) ?? statusName(event.toValue);
      return event.fromValue ? `сменил(а) статус с «${from}» на «${to}»` : `установил(а) статус «${to}»`;
    }
    case 'ASSIGNEE_CHANGED': {
      const to = userName(event.toValue);
      const from = userName(event.fromValue);
      if (!to) return from ? `снял(а) назначение с ${from}` : 'убрал(а) исполнителя';
      return from ? `переназначил(а) задачу с ${from} на ${to}` : `назначил(а) задачу на ${to}`;
    }
    case 'PRIORITY_CHANGED': {
      const to = PRIORITY_META[(event.toValue ?? 'NONE') as keyof typeof PRIORITY_META]?.label ?? event.toValue;
      const from = event.fromValue
        ? PRIORITY_META[event.fromValue as keyof typeof PRIORITY_META]?.label
        : null;
      return from ? `сменил(а) приоритет с «${from}» на «${to}»` : `установил(а) приоритет «${to}»`;
    }
    case 'TITLE_CHANGED':
      return `переименовал(а) в «${event.toValue}»`;
    case 'DESCRIPTION_CHANGED':
      return 'обновил(а) описание';
    case 'TYPE_CHANGED': {
      const to = ISSUE_TYPE_META[(event.toValue ?? 'TASK') as keyof typeof ISSUE_TYPE_META]?.label;
      return `сменил(а) тип на «${to}»`;
    }
    case 'LABEL_ADDED':
      return `добавил(а) метку «${event.toValue}»`;
    case 'LABEL_REMOVED':
      return `убрал(а) метку «${event.fromValue}»`;
    case 'DUE_DATE_CHANGED':
      return event.toValue ? `установил(а) срок ${shortDate(event.toValue)}` : 'убрал(а) срок';
    case 'STORY_POINTS_CHANGED':
      return event.toValue ? `поставил(а) оценку ${event.toValue}` : 'убрал(а) оценку';
    case 'EPIC_CHANGED':
      return event.toValue ? 'перенёс(ла) задачу в эпик' : 'убрал(а) задачу из эпика';
    case 'SPRINT_CHANGED':
      return event.toValue ? 'перенёс(ла) задачу в спринт' : 'убрал(а) задачу из спринта';
    case 'PARENT_CHANGED':
      return event.toValue ? 'сменил(а) родительскую задачу' : 'отвязал(а) от родительской задачи';
    case 'SUBTASK_CREATED':
      return `добавил(а) подзадачу ${event.toValue}`;
    case 'COMMENT_ADDED':
      return 'оставил(а) комментарий';
    case 'COMMENT_DELETED':
      return 'удалил(а) комментарий';
    case 'ATTACHMENT_ADDED':
      return `прикрепил(а) ${event.toValue}`;
    case 'ATTACHMENT_REMOVED':
      return `удалил(а) ${event.fromValue}`;
    case 'ISSUE_ARCHIVED':
      return 'архивировал(а) задачу';
    case 'KEY_CHANGED':
      return `номер задачи изменился: ${event.fromValue} → ${event.toValue}`;
    case 'PROJECT_CHANGED': {
      const to = event.metadata?.toProject;
      return typeof to === 'string'
        ? `перенёс(ла) задачу в проект «${to}»: ${event.fromValue} → ${event.toValue}`
        : `перенёс(ла) задачу: ${event.fromValue} → ${event.toValue}`;
    }
    default:
      return null;
  }
}

export function ActivityTimeline({
  activity,
  issue,
  members,
}: {
  activity: ActivityDto[];
  issue: IssueDetailDto;
  members: UserSummaryDto[];
}) {
  const lookups = useMemo<Lookups>(
    () => ({ statuses: [issue.status], members, labels: issue.labels }),
    [issue, members],
  );

  // Comment bodies live in the comment thread; the timeline only notes them.
  const entries = activity
    .map((event) => ({ event, text: describe(event, lookups) }))
    .filter((entry): entry is { event: ActivityDto; text: string } => entry.text !== null);

  if (entries.length === 0) {
    return <p className="py-4 text-sm text-text-subtle">Истории пока нет.</p>;
  }

  return (
    <ol className="relative space-y-3 pl-1">
      <span className="absolute top-2 bottom-2 left-[11px] w-px bg-border" aria-hidden="true" />
      {entries.map(({ event, text }) => (
        <li key={event.id} className="relative flex items-start gap-2.5">
          <span className="z-10 mt-0.5">
            <Avatar user={event.actor} size="md" className="ring-2 ring-[var(--surface)]" />
          </span>
          <p className="min-w-0 flex-1 text-sm text-text-muted">
            <span className="font-medium text-text">{event.actor.name}</span> {text}
            <time
              dateTime={event.createdAt}
              title={fullDate(event.createdAt)}
              className="ml-1.5 text-xs text-text-subtle"
            >
              {relativeTime(event.createdAt)}
            </time>
          </p>
        </li>
      ))}
    </ol>
  );
}
