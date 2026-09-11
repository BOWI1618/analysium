import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { IconButton } from './Button';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Set false for destructive confirmations that need an explicit choice. */
  closeOnOverlay?: boolean;
}

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const;

/**
 * Accessible modal: focus is trapped while open, Escape closes, the trigger
 * regains focus on close, and background scrolling is locked.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnOverlay = true,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement as HTMLElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const list = focusables();
      if (list.length === 0) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    const raf = requestAnimationFrame(() => {
      const list = focusables();
      (list.find((el) => el.dataset.autofocus === 'true') ?? list[0])?.focus();
    });

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = overflow;
      cancelAnimationFrame(raf);
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[var(--z-dialog)] flex items-start justify-center overflow-y-auto p-4 sm:p-6">
      <div
        className="fixed inset-0 bg-[var(--overlay)] animate-in"
        onClick={closeOnOverlay ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={clsx(
          'relative z-10 my-auto w-full rounded-xl border border-border bg-surface-raised shadow-lg',
          'animate-slide-up',
          SIZES[size],
        )}
      >
        {title && (
          <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-md font-semibold text-text">{title}</h2>
              {description && <p className="mt-0.5 text-xs text-text-muted">{description}</p>}
            </div>
            <IconButton label="Закрыть" size="sm" onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </header>
        )}
        <div className="px-4 py-4">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Подтвердить',
  danger,
  loading,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      closeOnOverlay={!loading}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-surface-hover"
          >
            Отмена
          </button>
          <button
            type="button"
            data-autofocus="true"
            onClick={onConfirm}
            disabled={loading}
            className={clsx(
              'inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-white disabled:opacity-50',
              danger ? 'bg-danger hover:opacity-90' : 'bg-accent hover:bg-accent-hover',
            )}
          >
            {loading ? 'Выполняем…' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm text-text-muted">{message}</p>
    </Dialog>
  );
}
