import clsx from 'clsx';
import type { ReactNode } from 'react';

/**
 * A printed plate with a captioned head — the standard container for a block
 * of content inside a page. The head is a mono eyebrow on a sunken strip, so
 * a stack of panels reads as a stack of labelled sheets.
 */
export function Panel({
  title,
  subtitle,
  icon,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  /** A count, a range, a unit — set in mono next to the caption. */
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx('border-2 border-border-strong bg-surface shadow-md', className)}>
      <header className="flex items-center gap-2 border-b-2 border-border-strong bg-surface-sunken px-3 py-1.5">
        {icon}
        <h3 className="fd-eyebrow">{title}</h3>
        {subtitle && <span className="fd-num text-2xs text-text-subtle">{subtitle}</span>}
        {actions && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
