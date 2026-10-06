import { cloneElement, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

type AnchorEvent = { currentTarget: EventTarget | null };

interface AnchorProps {
  onMouseEnter?: (event: AnchorEvent) => void;
  onMouseLeave?: () => void;
  onFocus?: (event: AnchorEvent) => void;
  onBlur?: () => void;
}

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement<AnchorProps>;
  side?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  disabled?: boolean;
}

type Side = NonNullable<TooltipProps['side']>;

/** Space between the tooltip and what it describes, and between it and the window's edge. */
const GAP = 8;
const EDGE = 4;

/**
 * Where a tooltip of a known size goes. It takes the side it was asked for
 * unless it does not fit there and fits opposite, and is then pushed back
 * inside the window. Buttons in a header sit right under the top edge — a
 * tooltip drawn above them regardless was drawn off the screen.
 */
function place(anchor: DOMRect, width: number, height: number, side: Side): { top: number; left: number } {
  const fits: Record<Side, boolean> = {
    top: anchor.top - GAP - height >= EDGE,
    bottom: anchor.bottom + GAP + height <= window.innerHeight - EDGE,
    left: anchor.left - GAP - width >= EDGE,
    right: anchor.right + GAP + width <= window.innerWidth - EDGE,
  };
  const opposite: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const actual = !fits[side] && fits[opposite[side]] ? opposite[side] : side;

  const vertical = actual === 'top' || actual === 'bottom';
  const top = vertical
    ? actual === 'top'
      ? anchor.top - GAP - height
      : anchor.bottom + GAP
    : anchor.top + anchor.height / 2 - height / 2;
  const left = vertical
    ? anchor.left + anchor.width / 2 - width / 2
    : actual === 'left'
      ? anchor.left - GAP - width
      : anchor.right + GAP;

  const within = (value: number, max: number) => Math.max(EDGE, Math.min(value, max));
  return {
    top: within(top, window.innerHeight - height - EDGE),
    left: within(left, window.innerWidth - width - EDGE),
  };
}

/**
 * Lightweight tooltip rendered in a portal so it is never clipped by an
 * `overflow: hidden` ancestor (board columns, table cells). Shows on hover
 * *and* keyboard focus, and stays inside the window.
 */
export function Tooltip({ content, children, side = 'top', delay = 350, disabled }: TooltipProps) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const timerRef = useRef<number>(0);
  const tipRef = useRef<HTMLDivElement>(null);

  const show = (event: AnchorEvent) => {
    if (disabled || !content) return;
    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setAnchor(target.getBoundingClientRect()), delay);
  };

  const hide = () => {
    window.clearTimeout(timerRef.current);
    setAnchor(null);
    setPosition(null);
  };

  // Placed once it is in the document: only then is its size known, and with
  // the size whether it fits where it was asked to go. Until then it is
  // rendered unseen, so it never flashes in the wrong spot.
  useLayoutEffect(() => {
    if (!anchor || !tipRef.current) return;
    const tip = tipRef.current.getBoundingClientRect();
    setPosition(place(anchor, tip.width, tip.height, side));
  }, [anchor, side]);

  return (
    <>
      {cloneElement<AnchorProps>(children, {
        onMouseEnter: show,
        onMouseLeave: hide,
        onFocus: show,
        onBlur: hide,
      })}
      {anchor &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            className={clsx(
              'pointer-events-none fixed z-[var(--z-tooltip)] max-w-64 rounded-sm px-2 py-1',
              'bg-[var(--text)] text-[var(--text-inverted)] text-xs font-medium border border-border-strong shadow-sm',
              position && 'animate-in',
            )}
            style={position ?? { top: 0, left: 0, visibility: 'hidden' }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Keyboard shortcut hint, e.g. inside a tooltip or menu item. */
/**
 * A key hint. Decorative by default: when a Kbd sits inside a button, its glyph
 * would otherwise be read out as part of the button's name ("Создать ↵"), which
 * is noise for screen readers and makes the control hard to address by name.
 * Pass `aria-hidden={false}` for a standalone hint that should be announced.
 */
export function Kbd({
  children,
  className,
  'aria-hidden': ariaHidden = true,
}: {
  children: ReactNode;
  className?: string;
  'aria-hidden'?: boolean;
}) {
  return (
    <kbd
      aria-hidden={ariaHidden || undefined}
      className={clsx(
        'inline-flex h-4 min-w-4 items-center justify-center rounded-sm border-2 border-border-strong',
        'bg-surface px-1 font-mono text-[10px] font-semibold text-text shadow-xs',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
