import clsx from 'clsx';
import type { ReactNode } from 'react';

/**
 * The page masthead — the editorial signature of the product.
 *
 * Every screen opens the same way: a mono dateline, a heavy uppercase display
 * headline, and a rule underneath. Anything on the right of the rule (a note,
 * a legend, a row of controls) hangs off the same baseline, so pages differ in
 * content but never in rhythm.
 */
export function Masthead({
  kicker,
  title,
  note,
  actions,
  size = 'lg',
  className,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  /** Short prose that sits opposite the headline, set in mono like a caption. */
  note?: ReactNode;
  actions?: ReactNode;
  /** `lg` is a landing page; `md` is a screen inside a project. */
  size?: 'lg' | 'md' | 'sm';
  className?: string;
}) {
  return (
    <header
      className={clsx(
        'flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b-2 border-border-strong pb-5',
        className,
      )}
    >
      <div className="min-w-0">
        {kicker && <div className="fd-kicker mb-2.5">{kicker}</div>}
        <h1
          className={clsx(
            'fd-display',
            size === 'lg' && 'text-[clamp(1.75rem,3.2vw,2.75rem)]',
            size === 'md' && 'text-[clamp(1.5rem,2.6vw,2.25rem)]',
            size === 'sm' && 'text-[clamp(1.25rem,2vw,1.625rem)]',
          )}
        >
          {title}
        </h1>
      </div>

      {(note || actions) && (
        <div className="flex shrink-0 items-end gap-4">
          {note && (
            <p className="hidden max-w-[19rem] text-right font-mono text-2xs leading-relaxed text-text-muted lg:block">
              {note}
            </p>
          )}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
    </header>
  );
}

/** A yellow marker swipe behind a word — used on exactly one word per headline. */
export function Marker({ children }: { children: ReactNode }) {
  return <span className="marker-hl">{children}</span>;
}

/**
 * Section heading inside a page: display face, one size down from the
 * masthead, with an optional link or count sitting on its baseline.
 */
export function SectionHeading({
  children,
  aside,
  className,
}: {
  children: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('flex items-baseline justify-between gap-4 pb-2.5', className)}>
      <h2 className="font-display text-lg font-extrabold uppercase tracking-tight">{children}</h2>
      {aside}
    </div>
  );
}

/** Class for the `все →` link that closes a section heading. */
export const sectionLinkClass =
  'font-mono text-2xs underline decoration-accent decoration-2 underline-offset-4 hover:text-accent';
