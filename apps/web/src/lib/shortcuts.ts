/**
 * Every keyboard shortcut in the product, in one place.
 *
 * The shortcuts dialog, the command palette hints and the tooltips all read
 * from here, so what the product advertises cannot drift from what it does —
 * which is exactly what had happened: the old dialog listed keys that were
 * never wired up.
 *
 * All commands use Ctrl (⌘ on a Mac). Bare letters were dropped for two
 * reasons: they fire by accident while reading, and they were matched by the
 * character produced, so on a Russian layout pressing "C" delivered "С" and no
 * shortcut worked at all. Matching now goes by physical key, see useHotkeys.
 *
 * Combos are chosen to stay clear of what browsers and desktops keep for
 * themselves: Ctrl+N/T/W and Ctrl+1–9 cannot be taken from Chrome, Ctrl+Alt+L
 * locks the screen on Ubuntu and Ctrl+Alt+T opens a terminal there.
 */
export const SHORTCUTS = {
  commandPalette: 'mod+k',
  showShortcuts: 'mod+/',
  createIssue: 'mod+alt+n',
  // The same numbers as the rubrics in the sidebar: 01 Главная … 04 Проекты.
  goHome: 'mod+alt+1',
  goMyWork: 'mod+alt+2',
  goInbox: 'mod+alt+3',
  goProjects: 'mod+alt+4',
  issueTitle: 'mod+alt+e',
  issueStatus: 'mod+alt+s',
  issueAssignee: 'mod+alt+a',
  issuePriority: 'mod+alt+p',
  issueLabels: 'mod+alt+m',
  submit: 'mod+enter',
} as const;

export const isMac =
  typeof navigator !== 'undefined' &&
  /mac|iphone|ipad|ipod/i.test(
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
      navigator.platform ??
      navigator.userAgent,
  );

const KEY_LABEL: Record<string, string> = {
  enter: 'Enter',
  escape: 'Esc',
  space: 'Пробел',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  '/': '/',
};

/**
 * The keys of a combo as a person reads them: `['Ctrl', 'Alt', 'N']`, or on a
 * Mac `['⌘', 'K']` and `['⌃', '⌥', 'N']`.
 *
 * On a Mac a plain `mod` combo is shown with ⌘, as every Mac app does. Combos
 * that also need Alt are shown with ⌃ instead: ⌘⌥ is crowded with system
 * shortcuts (⌘⌥M minimises every window), and the handler accepts either key.
 */
export function comboKeys(combo: string): string[] {
  const parts = combo.split('+');
  const key = parts[parts.length - 1]!;
  const hasAlt = parts.includes('alt');
  const labels: string[] = [];

  if (parts.includes('mod')) labels.push(isMac ? (hasAlt ? '⌃' : '⌘') : 'Ctrl');
  if (hasAlt) labels.push(isMac ? '⌥' : 'Alt');
  if (parts.includes('shift')) labels.push(isMac ? '⇧' : 'Shift');
  labels.push(KEY_LABEL[key] ?? key.toUpperCase());

  return labels;
}

/** A combo as plain text, for `title` attributes and aria labels. */
export function comboText(combo: string): string {
  return comboKeys(combo).join(isMac ? '' : '+');
}
