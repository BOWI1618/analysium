import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useClickOutside } from '~/lib/hooks/useClickOutside';

export interface PopoverProps {
  trigger: (props: { open: boolean; toggle: () => void; ref: React.Ref<never> }) => ReactNode;
  children: (props: { close: () => void }) => ReactNode;
  align?: 'start' | 'end';
  className?: string;
  /** For the wrapper around the trigger, e.g. to let a field fill its row. */
  triggerClassName?: string;
  width?: number;
  label?: string;
}

/** Free-form floating panel (filters, date picker, label editor). */
export function Popover({ trigger, children, align = 'start', className, triggerClassName, width = 256, label }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useClickOutside([triggerRef, contentRef], () => setOpen(false), open);

  useEffect(() => {
    if (!open) return undefined;

    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const height = contentRef.current?.offsetHeight ?? 0;
      let top = rect.bottom + 4;
      if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 4);
      const left = align === 'end' ? rect.right - width : rect.left;
      setCoords({ top, left: Math.min(Math.max(8, left), window.innerWidth - width - 8) });
    };

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, align, width]);

  return (
    <>
      <div ref={triggerRef} className={clsx('inline-flex', triggerClassName)}>
        {trigger({ open, toggle: () => setOpen((v) => !v), ref: undefined as never })}
      </div>
      {open &&
        createPortal(
          <div
            ref={contentRef}
            role="dialog"
            aria-label={label}
            data-popover
            className={clsx(
              'fixed z-[var(--z-menu)] rounded-md border-2 border-border-strong bg-surface p-2 shadow-lg animate-scale-in',
              className,
            )}
            style={{
              top: coords?.top ?? -9999,
              left: coords?.left ?? -9999,
              width,
              visibility: coords ? 'visible' : 'hidden',
            }}
          >
            {children({ close: () => setOpen(false) })}
          </div>,
          document.body,
        )}
    </>
  );
}
