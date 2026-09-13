import { useEffect, useRef } from 'react';

/**
 * Keyboard shortcuts.
 *
 * Keys are matched by **physical position** (`event.code`), not by the
 * character they produce. With a Russian layout active the key labelled C
 * produces «С», and with Alt held on a Mac letters turn into symbols — matching
 * characters silently broke every letter shortcut for both. Combos are written
 * as `mod+alt+shift+key`, where `mod` is Ctrl or ⌘ and `key` is a lower-case
 * letter, a digit, or a name such as `enter`, `escape`, `arrowdown`, `/`.
 *
 * While typing in a field or the rich-text editor only a short list of combos
 * gets through — closing, submitting and opening search. Everything else stays
 * with the field: Ctrl+Alt+digit makes a heading in the editor, and on some
 * layouts Ctrl+Alt types a character.
 */
export type HotkeyHandler = (event: KeyboardEvent) => void;

export interface HotkeyMap {
  [combo: string]: HotkeyHandler;
}

const ALLOWED_WHILE_TYPING = new Set(['escape', 'mod+enter', 'mod+k', 'mod+/']);

const CODE_KEYS: Record<string, string> = {
  Slash: '/',
  Enter: 'enter',
  NumpadEnter: 'enter',
  Escape: 'escape',
  Space: 'space',
  ArrowUp: 'arrowup',
  ArrowDown: 'arrowdown',
  ArrowLeft: 'arrowleft',
  ArrowRight: 'arrowright',
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable ||
    target.closest('[data-editor="true"]') !== null
  );
}

function keyOf(event: KeyboardEvent): string {
  const { code } = event;
  if (code.startsWith('Key')) return code.slice(3).toLowerCase();
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad') && /\d$/.test(code)) return code.slice(-1);
  return CODE_KEYS[code] ?? event.key.toLowerCase();
}

export function comboOf(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('mod');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  parts.push(keyOf(event));
  return parts.join('+');
}

export function useHotkeys(map: HotkeyMap, options: { enabled?: boolean } = {}): void {
  const enabled = options.enabled ?? true;
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    if (!enabled) return undefined;

    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;

      const combo = comboOf(event);
      if (isEditableTarget(event.target) && !ALLOWED_WHILE_TYPING.has(combo)) return;

      const run = mapRef.current[combo];
      if (!run) return;
      event.preventDefault();
      run(event);
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled]);
}
