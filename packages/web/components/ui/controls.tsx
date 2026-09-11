'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useId } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  children: ReactNode;
  variant?: 'primary' | 'ghost';
  loading?: boolean;
  loadingLabel?: string;
  full?: boolean;
}

export function Button({
  children,
  variant = 'primary',
  loading = false,
  loadingLabel = 'Working…',
  full = false,
  disabled,
  type = 'button',
  style,
  ...rest
}: ButtonProps) {
  return (
    <>
      <button
        {...rest}
        type={type}
        className={variant === 'ghost' ? 'btn ghost' : 'btn'}
        disabled={disabled === true || loading}
        aria-busy={loading || undefined}
        style={full ? { ...style, width: '100%' } : style}
      >
        {loading ? loadingLabel : children}
      </button>
      {/*
        The announcement lives OUTSIDE the button, and that is the whole point.

        Disabling a focused element blurs it in every major browser, so focus moves to the body on
        the same render that sets `aria-busy` and swaps the label. Both land on something no longer
        focused, and neither is spoken — a keyboard or screen-reader user pressing "Sign" would get
        the double-click protection and no confirmation that anything happened at all.

        A separate live region is not affected by the button's focus or disabled state, so it still
        announces. WCAG 2.2 4.1.3.
      */}
      <span className="sr-only" role="status">{loading ? loadingLabel : ''}</span>
    </>
  );
}

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  className?: string;
  hint?: ReactNode;
  error?: string | null;
}

export function Field({
  label,
  hint,
  error,
  id,
  className,
  'aria-describedby': callerDescribedBy,
  ...rest
}: FieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const own = error != null ? `${fieldId}-error` : hint !== undefined ? `${fieldId}-hint` : undefined;
  const describedBy = [own, callerDescribedBy].filter(Boolean).join(' ') || undefined;

  return (
    <div className={className}>
      <label
        className="k"
        htmlFor={fieldId}
        style={{ display: 'block', marginBottom: 'var(--space-6)' }}
      >
        {label}
      </label>
      <input
        {...rest}
        id={fieldId}
        className="comment-input"
        aria-invalid={error != null || undefined}
        aria-describedby={describedBy}
      />
      {error != null ? (
        <p
          id={`${fieldId}-error`}
          className="unmeasured"
          role="alert"
          style={{ margin: 'var(--space-6) 0 0' }}
        >
          {error}
        </p>
      ) : hint !== undefined ? (
        <p id={`${fieldId}-hint`} className="locked-why" style={{ marginBottom: 0 }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
