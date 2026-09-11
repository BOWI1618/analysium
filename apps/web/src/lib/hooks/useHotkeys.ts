import { useEffect, useRef } from 'react';

/**
 * Global keyboard shortcuts.
 *
 * Handles single keys ("c"), modifiers ("mod+k") and Linear-style sequences
 * ("g p" — press g, then p). Typing in an input or a rich-text editor never
 * triggers a shortcut, except for explicitly allowed combinations like Escape.
 */
export type HotkeyHandler = (event: KeyboardEvent) => void;

export interface HotkeyMap {
  [combo: string]: HotkeyHandler;
}

const SEQUENCE_TIMEOUT_MS = 900;

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

function normalizeEvent(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push('mod');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey && event.key.length > 1) parts.push('shift');
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
  parts.push(key);
  return parts.join('+');
}

export function useHotkeys(map: HotkeyMap, options: { enabled?: boolean } = {}): void {
  const enabled = options.enabled ?? true;
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    if (!enabled) return undefined;

    let sequence: string[] = [];
    let timer: number | undefined;

    const resetSequence = () => {
      sequence = [];
      if (timer) window.clearTimeout(timer);
      timer = undefined;
    };

    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const combo = normalizeEvent(event);
      const handlers = mapRef.current;
      const editable = isEditableTarget(event.target);

      // Escape and mod-combos still work while typing; bare letters do not.
      const allowWhileTyping = combo === 'escape' || combo.startsWith('mod+');
      if (editable && !allowWhileTyping) {
        resetSequence();
        return;
      }

      // Try a two-key sequence first ("g p").
      if (sequence.length > 0) {
        const candidate = [...sequence, combo].join(' ');
        const seqHandler = handlers[candidate];
        resetSequence();
        if (seqHandler) {
          event.preventDefault();
          seqHandler(event);
          return;
        }
      }

      const direct = handlers[combo];
      if (direct) {
        event.preventDefault();
        direct(event);
        return;
      }

      // Start a sequence when some registered shortcut begins with this key.
      const startsSequence = Object.keys(handlers).some((k) => k.startsWith(`${combo} `));
      if (startsSequence) {
        sequence = [combo];
        timer = window.setTimeout(resetSequence, SEQUENCE_TIMEOUT_MS);
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      resetSequence();
    };
  }, [enabled]);
}
