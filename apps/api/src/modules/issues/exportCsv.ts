/**
 * A project's tasks as a table for Excel or Google Sheets — for a report, or a
 * copy of the project kept outside Analysium.
 *
 * Written for Russian Excel as it opens a file with a double click: a byte
 * order mark so Cyrillic is read as UTF-8, and «;» between columns, which is
 * the list separator in the Russian locale.
 */
import type { ActorContext, IssueFilterInput, IssueSummaryDto } from '@flowdesk/contracts';
import { listIssues } from './service';

/** Enough for any project a team of five builds; the export stops there. */
const MAX_ROWS = 5000;

const TYPE_LABEL: Record<string, string> = {
  TASK: 'Задача',
  BUG: 'Ошибка',
  STORY: 'История',
  EPIC: 'Эпик',
  SUBTASK: 'Подзадача',
};

const PRIORITY_LABEL: Record<string, string> = {
  URGENT: 'Срочный',
  HIGH: 'Высокий',
  MEDIUM: 'Средний',
  LOW: 'Низкий',
  NONE: 'Без приоритета',
};

const COLUMNS = [
  'Ключ',
  'Задача',
  'Родительская задача',
  'Тип',
  'Статус',
  'Приоритет',
  'Исполнитель',
  'Автор',
  'Метки',
  'Эпик',
  'Начало',
  'Срок',
  'Создана',
  'Завершена',
];

export async function exportIssuesCsv(
  actor: ActorContext,
  filter: IssueFilterInput,
  timezone: string,
): Promise<string> {
  const issues: IssueSummaryDto[] = [];
  let cursor: string | undefined;
  do {
    const page = await listIssues(actor, { ...filter, includeSubtasks: true, limit: 200, cursor });
    issues.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && issues.length < MAX_ROWS);

  const format = dateFormatter(timezone);
  const rows = issues.slice(0, MAX_ROWS).map((issue) => [
    issue.issueKey,
    issue.title,
    issue.parent?.issueKey ?? '',
    TYPE_LABEL[issue.type] ?? issue.type,
    issue.status.name,
    PRIORITY_LABEL[issue.priority] ?? issue.priority,
    issue.assignee?.name ?? '',
    issue.reporter?.name ?? '',
    issue.labels.map((label) => label.name).join(', '),
    issue.epic ? `${issue.epic.issueKey} ${issue.epic.title}` : '',
    format(issue.startDate, issue.startHasTime),
    format(issue.dueDate, issue.dueHasTime),
    format(issue.createdAt, true),
    format(issue.completedAt, true),
  ]);

  return '﻿' + [COLUMNS, ...rows].map((row) => row.map(cell).join(';')).join('\r\n') + '\r\n';
}

/**
 * One cell. Quoted when it holds a separator, quote or line break; and a text
 * starting with = + - @ is prefixed with an apostrophe, so a task titled like a
 * formula stays text instead of being run by the spreadsheet.
 */
function cell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Dates as the reader's clock shows them: «18.09.2026», with «14:30» when a
 * time was set. A date without a time is a calendar day stored at noon UTC and
 * is read in UTC — in the reader's zone it would slip to the next day at UTC+12.
 */
function dateFormatter(timezone: string) {
  const zone = isValidZone(timezone) ? timezone : 'Europe/Moscow';
  const dayOptions = { day: '2-digit', month: '2-digit', year: 'numeric' } as const;
  const calendarDay = new Intl.DateTimeFormat('ru-RU', { ...dayOptions, timeZone: 'UTC' });
  const localDay = new Intl.DateTimeFormat('ru-RU', { ...dayOptions, timeZone: zone });
  const localTime = new Intl.DateTimeFormat('ru-RU', { timeZone: zone, hour: '2-digit', minute: '2-digit' });
  return (value: string | null, withTime: boolean) => {
    if (!value) return '';
    const date = new Date(value);
    return withTime ? `${localDay.format(date)} ${localTime.format(date)}` : calendarDay.format(date);
  };
}

function isValidZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
