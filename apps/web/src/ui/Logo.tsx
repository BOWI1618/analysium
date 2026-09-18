import clsx from 'clsx';

/**
 * The Analysium mark: a square-cut «A» struck through with a marker bar. The
 * bar is the same sky-blue highlight the headings use under a key word, so the
 * mark reads as part of the interface rather than a picture pasted on top.
 * Drawn for a filled accent plate; the letter takes the plate's text colour.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={clsx('size-5', className)} fill="none" aria-hidden="true">
      <path d="M8.5 25 16 7.5 23.5 25" stroke="currentColor" strokeWidth="3.6" strokeLinejoin="miter" />
      <path d="M6 19.2h20" strokeWidth="3.6" style={{ stroke: 'var(--marker)' }} />
    </svg>
  );
}
