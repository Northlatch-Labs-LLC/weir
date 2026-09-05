'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude

/**
 * The interactive primitives.
 *
 * # Why these are a separate module
 *
 * `Button` and `Field` forward `onClick`, `onChange` and the rest of their host element's
 * attributes. React's Flight serializer throws `"Event handlers cannot be passed to Client
 * Component props"` on any prop matching `/^on[A-Z]/` that crosses the server boundary — so these
 * two must be client components, and a page rendering `<Button onClick={…}>` from a server tree
 * would otherwise crash at render rather than at build.
 *
 * The purely presentational primitives stay in `primitives.tsx` without a directive, so a
 * server-rendered page can use `Stat` or `Card` without dragging the whole layer into the client
 * bundle.
 *
 * # The states are the point
 *
 * `loading` in particular. Each screen improvised it — `disabled={busy}` here, `{busy ? 'Saving…'
 * : 'Save'}` there — and any screen that forgot left a button clickable while a transaction was in
 * flight. On this platform that means signing twice. A primitive that owns the state cannot forget.
 */

import { useId } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

/* ------------------------------------------------------------------ button */

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  children: ReactNode;
  variant?: 'primary' | 'ghost';
  /**
   * Work is in flight.
   *
   * Disables the button *and* replaces the label. A button that only dims still looks pressable,
   * and a label that never changes gives no sign anything happened. Both were improvised per
   * screen before this, and improvised things get skipped.
   */
  loading?: boolean;
  /** Shown in place of `children` while loading. */
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
  // Pulled out of `rest` deliberately. Spread first and then re-applied, `style` would compile
  // fine and be silently discarded — a caller's margin simply vanishing at render with no type
  // error and no warning.
  style,
  ...rest
}: ButtonProps) {
  return (
    <>
      <button
        {...rest}
        type={type}
        className={variant === 'ghost' ? 'btn ghost' : 'btn'}
        // Disabled whenever loading, without the caller remembering. This is the whole reason the
        // state belongs in the primitive: on this platform a second click is a second signature.
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

/* ------------------------------------------------------------------ input */

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /**
   * Applied to the wrapper, not the input.
   *
   * `Card` and `Panel` both take one, and without it any call site needing the whole labelled block
   * to sit in a flex row has to wrap it in another styled div — reintroducing exactly the inline
   * sprawl this layer removes.
   */
  className?: string;
  /** Shown under the field. For constraints a person needs *before* typing. */
  hint?: ReactNode;
  /** Replaces the hint, in the error tone. */
  error?: string | null;
}

/**
 * A labelled input.
 *
 * The label is a real `<label>` bound by `id`. Several screens rendered a `.k` span above an input
 * with no association at all, so clicking the label did nothing and a screen reader announced the
 * field as unlabelled — an accessibility fault that looked completely fine.
 */
export function Field({
  label,
  hint,
  error,
  id,
  className,
  // Merged rather than replaced. A caller wiring this to an external help block would otherwise
  // have that reference silently dropped in favour of the field's own — a screen-reader regression
  // with no visible symptom.
  'aria-describedby': callerDescribedBy,
  ...rest
}: FieldProps) {
  /*
   * `useId`, not a slug of the label.
   *
   * Deriving the id from label text meant two fields sharing a label — "Amount" on two rows of the
   * same form, which this application has — produced duplicate DOM ids. `htmlFor` and
   * `aria-describedby` bind to the first match only, so the second field's label and error message
   * were associated with nothing at all, while looking entirely correct.
   */
  const generated = useId();
  const fieldId = id ?? generated;
  const own = error != null ? `${fieldId}-error` : hint !== undefined ? `${fieldId}-hint` : undefined;
  // Space-separated, as the attribute allows. Both references survive.
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
          // `aria-describedby` alone is read only when the field takes focus. Validation usually
          // runs on blur or submit, by which time focus has moved on and the message is never
          // spoken. WCAG 2.2 4.1.3.
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
