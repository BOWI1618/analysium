import { useEffect, type RefObject } from 'react';

/** Fires when a pointer press lands outside every provided element. */
export function useClickOutside(
  refs: RefObject<HTMLElement | null> | RefObject<HTMLElement | null>[],
  handler: () => void,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return undefined;

    const list = Array.isArray(refs) ? refs : [refs];
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (list.some((ref) => ref.current?.contains(target))) return;
      handler();
    };

    // `pointerdown` (not click) so the menu closes before a re-render steals the node.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [refs, handler, enabled]);
}
