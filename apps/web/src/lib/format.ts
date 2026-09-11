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

/** Due-date label: "Today", "Tomorrow", "12 Mar" — plus overdue detection. */
export function dueDateLabel(value: string | Date | null | undefined): {
  label: string;
  tone: 'overdue' | 'today' | 'soon' | 'normal';
} | null {
  const date = toDate(value);
  if (!date) return null;

  const days = differenceInCalendarDays(date, new Date());
  if (days < 0) {
    return { label: isYesterday(date) ? 'Вчера' : format(date, 'd MMM', { locale }), tone: 'overdue' };
  }
  if (isToday(date)) return { label: 'Сегодня', tone: 'today' };
  if (isTomorrow(date)) return { label: 'Завтра', tone: 'soon' };
  if (days <= 7) return { label: format(date, 'EEEEEE, d MMM', { locale }), tone: 'soon' };
  return { label: format(date, isThisYear(date) ? 'd MMM' : 'd MMM yy', { locale }), tone: 'normal' };
}

export function shortDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '';
  return format(date, isThisYear(date) ? 'd MMM' : 'd MMM yy', { locale });
}

export function dateInputValue(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, 'yyyy-MM-dd') : '';
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Stable colour per user so avatars stay recognisable across sessions. */
const AVATAR_COLORS = [
  '#6d4aff',
  '#ec4899',
  '#14b8a6',
  '#f59e0b',
  '#0ea5e9',
  '#8b5cf6',
  '#ef4444',
  '#22c55e',
  '#f97316',
  '#06b6d4',
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

/** Readable text colour for an arbitrary background (labels, project colours). */
export function contrastText(hex: string): string {
  const value = hex.replace('#', '');
  if (value.length !== 6) return '#ffffff';
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  // Relative luminance, sRGB weights.
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#1c1917' : '#ffffff';
}

export function hexWithAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  if (value.length !== 6) return hex;
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${value}${a}`;
}
