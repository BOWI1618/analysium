import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';

const FIELD_BASE =
  'w-full bg-surface text-text placeholder:text-text-subtle border border-border rounded-md ' +
  'transition-colors duration-100 hover:border-border-strong ' +
  'focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 ' +
  'disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-surface-sunken';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  inputSize?: 'sm' | 'md' | 'lg';
}

const SIZES = {
  sm: 'h-7 text-xs px-2',
  md: 'h-8 text-sm px-2.5',
  lg: 'h-10 text-base px-3',
} as const;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, iconLeft, iconRight, inputSize = 'md', className, id, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-text-muted">
          {label}
        </label>
      )}
      <div className="relative">
        {iconLeft && (
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-subtle">
            {iconLeft}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={clsx(
            FIELD_BASE,
            SIZES[inputSize],
            iconLeft && 'pl-8',
            iconRight && 'pr-8',
            error && 'border-danger focus:border-danger focus:ring-danger/20',
            className,
          )}
          {...rest}
        />
        {iconRight && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-subtle">{iconRight}</span>
        )}
      </div>
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1 text-xs text-text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, id, ...rest },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={fieldId} className="mb-1 block text-xs font-medium text-text-muted">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        className={clsx(FIELD_BASE, 'px-2.5 py-1.5 text-sm resize-y min-h-16', error && 'border-danger', className)}
        {...rest}
      />
      {error ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-text-subtle">{hint}</p>
      ) : null}
    </div>
  );
});

export interface SelectProps extends InputHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  children: ReactNode;
  selectSize?: 'sm' | 'md';
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, className, id, children, selectSize = 'md', ...rest },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={fieldId} className="mb-1 block text-xs font-medium text-text-muted">
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={fieldId}
        className={clsx(FIELD_BASE, SIZES[selectSize], 'pr-7 cursor-pointer appearance-none', className)}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238a8279' stroke-width='3' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 8px center',
        }}
        {...(rest as object)}
      >
        {children}
      </select>
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, className, id, ...rest },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <div className="inline-flex items-center gap-2">
      <input
        ref={ref}
        id={fieldId}
        type="checkbox"
        className={clsx(
          'size-3.5 rounded-xs border border-border-strong bg-surface cursor-pointer',
          'accent-[var(--accent)] transition-colors',
          className,
        )}
        {...rest}
      />
      {label && (
        <label htmlFor={fieldId} className="cursor-pointer text-sm select-none">
          {label}
        </label>
      )}
    </div>
  );
});
