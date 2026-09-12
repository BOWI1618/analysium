import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { AlertCircle, CheckCircle2, Info, X, Undo2 } from 'lucide-react';
import { errorMessage } from '~/lib/api';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  /** Optional undo affordance — used after destructive or bulk actions. */
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  toast: (toast: Omit<Toast, 'id'>) => string;
  success: (title: string, description?: string) => void;
  error: (error: unknown, title?: string) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DURATION_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const toast = useCallback(
    (input: Omit<Toast, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((list) => [...list.slice(-3), { ...input, id }]);
      timers.current.set(id, window.setTimeout(() => dismiss(id), DURATION_MS));
      return id;
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      dismiss,
      success: (title, description) => void toast({ tone: 'success', title, description }),
      error: (error, title) =>
        void toast({ tone: 'error', title: title ?? 'Что-то пошло не так', description: errorMessage(error) }),
    }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div
          className="pointer-events-none fixed bottom-4 left-1/2 z-[var(--z-toast)] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4 sm:left-auto sm:right-4 sm:translate-x-0"
          role="region"
          aria-label="Уведомления"
        >
          {toasts.map((item) => (
            <ToastCard key={item.id} toast={item} onDismiss={() => dismiss(item.id)} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

const ICONS: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 className="size-4 text-success" />,
  error: <AlertCircle className="size-4 text-danger" />,
  info: <Info className="size-4 text-info" />,
};

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div
      role="status"
      aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
      className={clsx(
        'pointer-events-auto flex items-start gap-2.5 rounded-lg border-2 border-border-strong bg-surface p-3 shadow-xl',
        'animate-slide-up',
      )}
    >
      <span className="mt-0.5 shrink-0">{ICONS[toast.tone]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-text">{toast.title}</p>
        {toast.description && <p className="mt-0.5 text-xs text-text-muted">{toast.description}</p>}
      </div>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action!.onClick();
            onDismiss();
          }}
          className="inline-flex shrink-0 items-center gap-1 border-2 border-border-strong bg-accent px-2 py-0.5 text-xs font-bold text-accent-fg shadow-xs"
        >
          <Undo2 className="size-3" />
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Закрыть"
        className="shrink-0 p-0.5 text-text-subtle hover:bg-surface-hover hover:text-text"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
