import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useDiscardGuard } from './Dialog';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Full-screen on mobile, side panel from `md` upwards. */
  width?: string;
  label: string;
  aboveDialog?: boolean;
}

/**
 * Right-hand side panel used for issue detail. Chosen over a modal so the user
 * keeps the board visible and can move between issues without losing context.
 */
export function Drawer({ open, onClose, children, width = 'max-w-[42rem]', label, aboveDialog = false }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // An unsent comment inside reports itself; closing then asks first.
  const guard = useDiscardGuard(onClose);
  const { requestClose } = guard;

  useEffect(() => {
    if (!open) return undefined;

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Let a nested dialog or menu handle Escape first. This panel itself
        // matches the dialog selector, so anything inside it does not count.
        const layers = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="menu"]'));
        const panel = panelRef.current;
        const visibleLayers = aboveDialog && panel ? layers.slice(layers.indexOf(panel) + 1) : layers;
        if (visibleLayers.some((el) => !panel?.contains(el))) return;
        event.stopPropagation();
        requestClose();
      }
    };

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focus = aboveDialog ? requestAnimationFrame(() => panelRef.current?.focus()) : undefined;
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      if (focus !== undefined) {
        cancelAnimationFrame(focus);
        if (previousFocus?.isConnected) previousFocus.focus();
      }
    };
  }, [aboveDialog, open, requestClose]);

  if (!open) return null;

  return createPortal(
    <div className={clsx('fixed inset-0 flex justify-end', aboveDialog ? 'z-[var(--z-dialog)]' : 'z-[var(--z-drawer)]')}>
      <div className="fixed inset-0 bg-[var(--overlay)] animate-in" onClick={requestClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={aboveDialog ? -1 : undefined}
        className={clsx(
          'relative z-10 flex h-full w-full flex-col bg-surface animate-slide-left',
          'border-l-2 border-border-strong shadow-xl',
          width,
        )}
      >
        <guard.Provider value={guard.scope}>{children}</guard.Provider>
      </div>
      {guard.confirm}
    </div>,
    document.body,
  );
}
