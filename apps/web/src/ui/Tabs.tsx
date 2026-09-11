import clsx from 'clsx';
import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

export interface TabItem {
  to: string;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
  end?: boolean;
}

/** Route-driven tabs — the URL is the source of truth, so tabs are linkable. */
export function RouteTabs({ items, className }: { items: TabItem[]; className?: string }) {
  return (
    <nav className={clsx('flex items-center gap-0.5 overflow-x-auto no-scrollbar', className)}>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            clsx(
              'relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium',
              'transition-colors duration-100',
              isActive
                ? 'bg-surface-active text-text'
                : 'text-text-muted hover:bg-surface-hover hover:text-text',
            )
          }
        >
          {item.icon}
          {item.label}
          {item.badge}
        </NavLink>
      ))}
    </nav>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

/** Compact single-choice control (view switcher, grouping selector). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  label,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={clsx('inline-flex items-center gap-0.5 rounded-md bg-surface-sunken p-0.5', className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-medium transition-colors',
            value === option.value
              ? 'bg-surface text-text shadow-xs'
              : 'text-text-muted hover:text-text',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
