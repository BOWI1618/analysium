import clsx from 'clsx';
import type { CSSProperties, ReactNode } from 'react';
import { AlertTriangle, Inbox, RefreshCw, ShieldAlert, WifiOff } from 'lucide-react';
import { ApiError, NetworkError } from '~/lib/api';
import { Button } from './Button';

/* ------------------------------------------------------------- skeletons */

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      className={clsx('animate-shimmer bg-surface-active', className)}
      style={style}
      aria-hidden="true"
    />
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={clsx('space-y-2', className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={clsx('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="border-2 border-border-strong bg-surface p-3 shadow-sm">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-2 h-3.5 w-full" />
      <Skeleton className="mt-1.5 h-3.5 w-3/5" />
      <div className="mt-3 flex items-center gap-2">
        <Skeleton className="size-5" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  );
}

export function SkeletonRows({ rows = 8 }: { rows?: number }) {
  return (
    <div className="divide-y-2 divide-border-strong" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="size-3.5" />
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 flex-1" style={{ maxWidth: `${40 + ((i * 13) % 40)}%` }} />
          <Skeleton className="ml-auto size-5" />
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------- empty state */

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({ icon, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-16',
        className,
      )}
    >
      <div
        className={clsx(
          'flex items-center justify-center border-2 border-border-strong bg-surface-active text-text-subtle',
          compact ? 'size-8' : 'size-12',
        )}
      >
        {icon ?? <Inbox className={compact ? 'size-4' : 'size-6'} />}
      </div>
      <div className="max-w-sm">
        <h3 className={clsx('font-semibold text-text', compact ? 'text-sm' : 'text-md')}>{title}</h3>
        {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/* ----------------------------------------------------------- error state */

export interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}

/** Turns any thrown value into a message a user can act on. */
export function ErrorState({ error, onRetry, className, compact }: ErrorStateProps) {
  const { icon, title, description } = describeError(error);

  return (
    <EmptyState
      className={className}
      compact={compact}
      icon={icon}
      title={title}
      description={description}
      action={
        onRetry ? (
          <Button size="sm" variant="secondary" iconLeft={<RefreshCw className="size-3.5" />} onClick={onRetry}>
            Повторить
          </Button>
        ) : undefined
      }
    />
  );
}

function describeError(error: unknown): { icon: ReactNode; title: string; description: string } {
  if (error instanceof NetworkError) {
    return {
      icon: <WifiOff className="size-6" />,
      title: 'Сервер недоступен',
      description: 'Проверьте соединение — изменения сохранены и отправятся повторно.',
    };
  }
  if (error instanceof ApiError) {
    if (error.isForbidden) {
      return {
        icon: <ShieldAlert className="size-6" />,
        title: 'Нет доступа',
        description: error.message,
      };
    }
    if (error.isNotFound) {
      return { icon: <Inbox className="size-6" />, title: 'Не найдено', description: error.message };
    }
    if (error.status >= 500) {
      return {
        icon: <AlertTriangle className="size-6" />,
        title: 'Ошибка сервера',
        description: 'Что-то сломалось на нашей стороне. Попробуйте через минуту.',
      };
    }
    return { icon: <AlertTriangle className="size-6" />, title: 'Запрос не прошёл', description: error.message };
  }
  return {
    icon: <AlertTriangle className="size-6" />,
    title: 'Что-то пошло не так',
    description: error instanceof Error ? error.message : 'Произошла непредвиденная ошибка.',
  };
}

/* ------------------------------------------------------------- progress */

export function ProgressBar({
  value,
  max = 100,
  className,
  tone = 'accent',
  label,
}: {
  value: number;
  max?: number;
  className?: string;
  tone?: 'accent' | 'success' | 'warning' | 'danger';
  label?: string;
}) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const colors = {
    accent: 'bg-accent',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
  } as const;

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      // No `w-full` in the base: Tailwind cannot reliably resolve two width
      // utilities on one element, so the caller owns the width and the default
      // below only applies when none was given.
      className={clsx(
        'h-2 overflow-hidden border-2 border-border-strong bg-surface-sunken',
        /\bw-/.test(className ?? '') ? undefined : 'w-full',
        className,
      )}
    >
      <div
        className={clsx('h-full transition-[width] duration-300', colors[tone])}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
