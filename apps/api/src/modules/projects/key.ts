/**
 * Project keys are generated, never typed: they are the prefix of every task
 * number (AS-1, AS-2) and carry no meaning beyond being short and unique.
 */

const CYRILLIC: Record<string, string> = {
  А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Е: 'E', Ё: 'E', Ж: 'ZH', З: 'Z', И: 'I', Й: 'Y',
  К: 'K', Л: 'L', М: 'M', Н: 'N', О: 'O', П: 'P', Р: 'R', С: 'S', Т: 'T', У: 'U', Ф: 'F',
  Х: 'H', Ц: 'TS', Ч: 'CH', Ш: 'SH', Щ: 'SCH', Ъ: '', Ы: 'Y', Ь: '', Э: 'E', Ю: 'YU', Я: 'YA',
};

function latin(word: string): string {
  return word
    .toUpperCase()
    .replace(/[А-ЯЁ]/g, (letter) => CYRILLIC[letter] ?? '')
    .replace(/[^A-Z0-9]/g, '');
}

/** "Mobile App" → "MA", «Алабуга Старт» → "AS", «Маркетинг» → "MARK". */
export function keyFromName(name: string): string {
  const words = name.trim().split(/\s+/).map(latin).filter(Boolean);
  const initials = words.length > 1 ? words.map((word) => word[0]).join('') : '';
  const key = (initials.length >= 2 ? initials : words.join('')).replace(/^[0-9]+/, '').slice(0, 4);
  return key.length >= 2 ? key : 'PRJ';
}

/** The key for a new project, made unique among the workspace's keys: "AS" taken → "AS2". */
export function uniqueProjectKey(name: string, taken: ReadonlySet<string>): string {
  const base = keyFromName(name);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = String(n);
    const candidate = `${base.slice(0, 6 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
