import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle' | 'outline';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

/* Hard-plate variants carry the solid offset shadow: they lift one pixel on
   hover and press flat on active. Motion is gated on `enabled` so a disabled
   button never moves. */
const HARD_PLATE =
  'border-2 border-border-strong shadow-sm ' +
  'transition-[color,background-color,border-color,box-shadow,translate] duration-100 ' +
  'enabled:hover:-translate-x-px enabled:hover:-translate-y-px enabled:hover:shadow-md ' +
  'enabled:active:translate-x-px enabled:active:translate-y-px enabled:active:shadow-none';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: `${HARD_PLATE} bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-active disabled:hover:bg-accent`,
  secondary: `${HARD_PLATE} bg-surface text-text hover:bg-surface-hover active:bg-surface-active disabled:hover:bg-surface`,
  outline: `${HARD_PLATE} bg-transparent text-text hover:bg-surface-hover active:bg-surface-active`,
  ghost:
    'bg-transparent text-text-muted transition-colors duration-100 hover:bg-surface-hover hover:text-text active:bg-surface-active',
  subtle:
    'border-2 border-border-strong bg-marker-subtle text-text transition-colors duration-100 hover:bg-marker active:bg-surface-active',
  danger: `${HARD_PLATE} bg-danger text-accent-fg hover:opacity-95 active:opacity-90`,
};

const SIZES: Record<ButtonSize, string> = {
  xs: 'h-6 px-2 text-2xs gap-1 rounded-sm',
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-8 px-3 text-sm gap-1.5 rounded-md',
  lg: 'h-10 px-4 text-base gap-2 rounded-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    iconLeft,
    iconRight,
    fullWidth,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex items-center justify-center font-medium whitespace-nowrap select-none',
        'transition-colors duration-100',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="size-3.5" /> : iconLeft}
      {children}
      {!loading && iconRight}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Required — icon-only controls must be labelled for screen readers. */
  label: string;
  loading?: boolean;
}

const ICON_SIZES: Record<ButtonSize, string> = {
  xs: 'size-5 rounded-sm',
  sm: 'size-6 rounded-md',
  md: 'size-8 rounded-md',
  lg: 'size-10 rounded-lg',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'ghost', size = 'md', label, loading, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={clsx(
        'inline-flex items-center justify-center shrink-0 transition-colors duration-100',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANTS[variant],
        ICON_SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="size-3.5" /> : children}
    </button>
  );
});
