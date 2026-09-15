import {
  differenceInCalendarDays,
  format,
  isThisYear,
  isToday,
  isTomorrow,
  isValid,
  isYesterday,
  parseISO,
} from 'date-fns';
import { ru } from 'date-fns/locale';

/** The product ships in Russian; every date passes through this locale. */
const locale = ru;

export function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === 'string' ? parseISO(value) : value;
  return isValid(date) ? date : null;
}

/**
 * Compact relative time: «5 мин», «3 ч», «2 дн», «4 мес».
 *
 * The library's Russian output ("5 минут назад") is roughly twice as wide as
 * its English equivalent and wraps inside table cells and card footers, so the
 * dense surfaces get this abbreviated form instead. `fullDate` is attached as a
 * `title` wherever it is used, which keeps the exact moment one hover away.
 */
export function relativeTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '';

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  const future = seconds < 0;
  const abs = Math.abs(seconds);

  const format = (amount: number, unit: string) => (future ? `через ${amount} ${unit}` : `${amount} ${unit}`);

  if (abs < 45) return future ? 'вот-вот' : 'только что';
  if (abs < 3600) return format(Math.round(abs / 60), 'мин');
  if (abs < 86_400) return format(Math.round(abs / 3600), 'ч');
  if (abs < 2_592_000) return format(Math.round(abs / 86_400), 'дн');
  if (abs < 31_536_000) return format(Math.round(abs / 2_592_000), 'мес');
  return format(Math.round(abs / 31_536_000), 'г');
}

export function fullDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, 'd MMMM yyyy, HH:mm', { locale }) : '';
}

/**
 * Due-date label: "Сегодня", "Завтра, 14:30", "12 мар" — plus overdue detection.
 * Without a time the date is the whole day and is overdue only the day after;
 * with one it is overdue the moment that time passes.
 */
export function dueDateLabel(
  value: string | Date | null | undefined,
  hasTime = false,
): {
  label: string;
  tone: 'overdue' | 'today' | 'soon' | 'normal';
  /** Whole days past the deadline; 0 when it is not overdue or passed today. */
  overdueDays: number;
} | null {
  const date = toDate(value);
  if (!date) return null;

  const time = hasTime ? `, ${format(date, 'HH:mm')}` : '';
  const days = differenceInCalendarDays(date, new Date());
  const overdue = hasTime ? date.getTime() < Date.now() : days < 0;
  if (overdue) {
    const day = isToday(date) ? 'Сегодня' : isYesterday(date) ? 'Вчера' : format(date, 'd MMM', { locale });
    return { label: day + time, tone: 'overdue', overdueDays: Math.max(0, -days) };
  }
  if (isToday(date)) return { label: 'Сегодня' + time, tone: 'today', overdueDays: 0 };
  if (isTomorrow(date)) return { label: 'Завтра' + time, tone: 'soon', overdueDays: 0 };
  if (days <= 7) return { label: format(date, 'EEEEEE, d MMM', { locale }) + time, tone: 'soon', overdueDays: 0 };
  return { label: format(date, isThisYear(date) ? 'd MMM' : 'd MMM yy', { locale }) + time, tone: 'normal', overdueDays: 0 };
}

/** "12 мар" or "12 мар, 14:30" — for dates that are not deadlines. */
export function dateWithTime(value: string | Date | null | undefined, hasTime = false): string {
  const date = toDate(value);
  if (!date) return '';
  return shortDate(date) + (hasTime ? `, ${format(date, 'HH:mm')}` : '');
}

export function shortDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '';
  return format(date, isThisYear(date) ? 'd MMM' : 'd MMM yy', { locale });
}


export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Stable colour per user so avatars stay recognisable across sessions. */
// Distinct enough to tell people apart, deep enough for white initials, and
// kept in the cool family of the brand palette so avatars do not shout.
const AVATAR_COLORS = [
  '#005dac',
  '#283a97',
  '#0083ca',
  '#0e7490',
  '#0f7a44',
  '#5b4bb7',
  '#b45309',
  '#9d174d',
  '#1e3a8a',
  '#0369a1',
];

export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

/**
 * Russian needs three plural forms, not two: 1 задача, 2 задачи, 5 задач.
 * `forms` is [one, few, many].
 */
export function plural(count: number, forms: [string, string, string]): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

export function pluralize(count: number, forms: [string, string, string]): string {
  return `${count} ${plural(count, forms)}`;
}


export function hexWithAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  if (value.length !== 6) return hex;
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${value}${a}`;
}
