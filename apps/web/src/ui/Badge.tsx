import clsx from 'clsx';
import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-active text-text-muted border-border-strong',
  accent: 'bg-accent-subtle text-accent border-accent-border',
  success: 'bg-success-subtle text-success border-success-border',
  warning: 'bg-warning-subtle text-warning border-warning-border',
  danger: 'bg-danger-subtle text-danger border-danger-border',
  info: 'bg-info-subtle text-info border-info-border',
};

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  size?: 'sm' | 'md';
}

export function Badge({ tone = 'neutral', children, className, size = 'sm' }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 font-mono font-bold whitespace-nowrap border-2',
        size === 'sm' ? 'px-1.5 py-0.5 text-2xs' : 'px-2 py-0.5 text-xs',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Small count pill used on tabs and the notification bell. */
export function CountBadge({ count, tone = 'neutral' }: { count: number; tone?: BadgeTone }) {
  if (count <= 0) return null;
  return (
    <Badge tone={tone} className="min-w-4 justify-center tabular-nums">
      {count > 99 ? '99+' : count}
    </Badge>
  );
}
