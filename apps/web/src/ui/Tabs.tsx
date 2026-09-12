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
    // Tabs are set as a run of cells divided by rules — a contents bar, not a
    // row of buttons. The current view is the only one on paper white, and it
    // carries an accent rule under its foot.
    <nav className={clsx('flex items-stretch overflow-x-auto no-scrollbar', className)}>
      {items.map((item, index) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            clsx(
              'relative inline-flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2 text-sm font-bold',
              'transition-colors duration-100',
              index > 0 && 'border-l-2 border-border-strong',
              isActive
                ? 'bg-surface text-text after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-accent'
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
      className={clsx('inline-flex items-stretch border-2 border-border-strong bg-surface-sunken', className)}
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
            'inline-flex items-center gap-1.5 px-2.5 py-1 font-mono text-2xs font-bold uppercase tracking-wider transition-colors',
            value === option.value ? 'bg-ink text-text-inverted' : 'text-text-muted hover:bg-surface-hover hover:text-text',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
