import clsx from 'clsx';
import { comboKeys, comboText, isMac } from '~/lib/shortcuts';
import { Kbd } from './Tooltip';

/**
 * A key combination drawn as keycaps: `Ctrl + Alt + N`, or `⌃⌥N` on a Mac.
 *
 * The plus is spelled out between caps. The old dialog put the word «затем»
 * between keys that are pressed together, which read as "press Ctrl, then K".
 */
export function Shortcut({ combo, className }: { combo: string; className?: string }) {
  const keys = comboKeys(combo);
  return (
    // Hidden on touch screens: a phone has no Ctrl key, and the caps only take
    // room from the label they sit next to.
    <span
      className={clsx('inline-flex shrink-0 items-center gap-0.5 [@media(hover:none)]:hidden', className)}
      aria-label={comboText(combo)}
    >
      {keys.map((key, index) => (
        <span key={`${key}-${index}`} className="inline-flex items-center gap-0.5">
          {index > 0 && !isMac && <span className="text-[10px] text-text-subtle" aria-hidden="true">+</span>}
          <Kbd>{key}</Kbd>
        </span>
      ))}
    </span>
  );
}
