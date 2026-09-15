import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { Button, IconButton, type ButtonProps } from './Button';

/* ------------------------------------------------------- unsaved changes */

/** Asks the browser to confirm closing or reloading the tab while `dirty`. */
export function useBeforeUnloadWarning(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers need a return value; the text itself is never shown.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}

interface DiscardScope {
  report: (key: object, dirty: boolean) => void;
  requestClose: () => void;
}

const DiscardScopeContext = createContext<DiscardScope | null>(null);

/**
 * Something typed but not yet saved, inside a dialog or panel: closing that
 * container asks first instead of silently throwing the input away.
 */
export function useUnsavedChanges(dirty: boolean): void {
  const scope = useContext(DiscardScopeContext);
  const key = useRef({});
  useEffect(() => {
    scope?.report(key.current, dirty);
    return () => scope?.report(key.current, false);
  }, [scope, dirty]);
  useBeforeUnloadWarning(dirty);
}

/** Closes the nearest dialog or panel, asking first if something is unsaved. */
export function useGuardedClose(fallback?: () => void): () => void {
  const scope = useContext(DiscardScopeContext);
  return scope?.requestClose ?? fallback ?? (() => undefined);
}

/**
 * The close logic shared by Dialog and Drawer. `dirty` is the container's own
 * state; components inside add theirs through `useUnsavedChanges`.
 */
export function useDiscardGuard(onClose: () => void, dirty = false) {
  const reports = useRef(new Map<object, true>());
  const [asking, setAsking] = useState(false);
  const latest = useRef({ onClose, dirty });
  latest.current = { onClose, dirty };

  const requestClose = useCallback(() => {
    if (latest.current.dirty || reports.current.size > 0) setAsking(true);
    else latest.current.onClose();
  }, []);

  const scope = useMemo<DiscardScope>(
    () => ({
      report: (key, isDirty) => {
        if (isDirty) reports.current.set(key, true);
        else reports.current.delete(key);
      },
      requestClose,
    }),
    [requestClose],
  );

  useBeforeUnloadWarning(dirty);

  const confirm = (
    <ConfirmDialog
      open={asking}
      onClose={() => setAsking(false)}
      onConfirm={() => {
        setAsking(false);
        reports.current.clear();
        latest.current.onClose();
      }}
      title="Закрыть без сохранения?"
      message="Введённые данные не сохранятся."
      confirmLabel="Не сохранять"
      cancelLabel="Продолжить"
      danger
      safeDefault
    />
  );

  return { requestClose, scope, confirm, Provider: DiscardScopeContext.Provider };
}

/** A cancel button for a dialog footer: closes through the unsaved-changes check. */
export function DialogCloseButton(props: Omit<ButtonProps, 'onClick'>) {
  const close = useGuardedClose();
  return <Button type="button" {...props} onClick={close} />;
}

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
  /**
   * Unsaved input: closing by Escape, the cross, the overlay or a
   * `DialogCloseButton` asks before throwing it away.
   */
  dirty?: boolean;
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
  dirty = false,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const guard = useDiscardGuard(onClose, dirty);
  // Stable across renders: re-running the effect below would move focus
  // every time the input turns dirty or clean.
  const { requestClose } = guard;

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
        // A list opened from inside the dialog closes first; the dialog, with
        // everything typed into it, stays.
        if (document.querySelector('[role="menu"], [data-popover]')) return;
        // So does a dialog opened on top of this one, such as the question
        // about unsaved changes.
        const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
        if (dialogs[dialogs.length - 1] !== panelRef.current) return;
        event.stopPropagation();
        requestClose();
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
  }, [open, requestClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[var(--z-dialog)] flex items-start justify-center overflow-y-auto p-4 sm:p-6">
      <div
        className="fixed inset-0 bg-[var(--overlay)] animate-in"
        onClick={closeOnOverlay ? requestClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={clsx(
          'relative z-10 my-auto w-full rounded-lg border-2 border-border-strong bg-surface shadow-xl',
          'animate-slide-up',
          SIZES[size],
        )}
      >
        {title && (
          <header className="flex items-start justify-between gap-4 border-b-2 border-border-strong bg-surface-raised px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-md font-semibold text-text">{title}</h2>
              {description && <p className="mt-0.5 text-xs text-text-muted">{description}</p>}
            </div>
            <IconButton label="Закрыть" size="sm" variant="secondary" onClick={requestClose}>
              <X className="size-4" />
            </IconButton>
          </header>
        )}
        <guard.Provider value={guard.scope}>
          <div className="px-4 py-4">{children}</div>
          {footer && (
            <footer className="flex items-center justify-end gap-2 border-t-2 border-border-strong bg-surface-raised px-4 py-3">
              {footer}
            </footer>
          )}
        </guard.Provider>
      </div>
      {guard.confirm}
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
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  /** Focus the cancel button, so a stray Enter does not confirm. */
  safeDefault?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  danger,
  loading,
  safeDefault,
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
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-autofocus={safeDefault ? 'true' : undefined}
            onClick={onClose}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            data-autofocus={safeDefault ? undefined : 'true'}
            variant={danger ? 'danger' : 'primary'}
            size="sm"
            loading={loading}
            onClick={onConfirm}
          >
            {loading ? 'Выполняем…' : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-muted">{message}</p>
    </Dialog>
  );
}
