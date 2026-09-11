import { cloneElement, useRef, useState, type ReactElement, type ReactNode } from 'react';
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

/**
 * Lightweight tooltip rendered in a portal so it is never clipped by an
 * `overflow: hidden` ancestor (board columns, table cells). Shows on hover
 * *and* keyboard focus.
 */
export function Tooltip({ content, children, side = 'top', delay = 350, disabled }: TooltipProps) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const timerRef = useRef<number>(0);
  const anchorRef = useRef<HTMLElement | null>(null);

  const show = (event: AnchorEvent) => {
    if (disabled || !content) return;
    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;
    anchorRef.current = target;
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const rect = target.getBoundingClientRect();
      const offset = 8;
      const positions = {
        top: { top: rect.top - offset, left: rect.left + rect.width / 2 },
        bottom: { top: rect.bottom + offset, left: rect.left + rect.width / 2 },
        left: { top: rect.top + rect.height / 2, left: rect.left - offset },
        right: { top: rect.top + rect.height / 2, left: rect.right + offset },
      };
      setPosition(positions[side]);
    }, delay);
  };

  const hide = () => {
    window.clearTimeout(timerRef.current);
    setPosition(null);
  };

  const transforms = {
    top: 'translate(-50%, -100%)',
    bottom: 'translate(-50%, 0)',
    left: 'translate(-100%, -50%)',
    right: 'translate(0, -50%)',
  };

  return (
    <>
      {cloneElement<AnchorProps>(children, {
        onMouseEnter: show,
        onMouseLeave: hide,
        onFocus: show,
        onBlur: hide,
      })}
      {position &&
        createPortal(
          <div
            role="tooltip"
            className={clsx(
              'pointer-events-none fixed z-[var(--z-tooltip)] max-w-64 rounded-md px-2 py-1',
              'bg-[var(--text)] text-[var(--text-inverted)] text-xs font-medium shadow-md',
              'animate-in',
            )}
            style={{ top: position.top, left: position.left, transform: transforms[side] }}
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
        'inline-flex h-4 min-w-4 items-center justify-center rounded-xs border border-border-strong',
        'bg-surface-sunken px-1 font-sans text-[10px] font-medium text-text-subtle',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
