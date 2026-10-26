import { useId, type ReactNode } from 'react';

import { labelClass } from '@/components/shared/surface';

/**
 * Story UI-2 (UI-PATTERNS §4, W9) — one label/hint/error contract for every
 * field: the label above, an optional hint, the error below the input in
 * text (WCAG 3.3.1 / 3.3.3), and the input tied to both by
 * `aria-describedby`, with `aria-invalid` while the field has an error.
 *
 * The input is the caller's (a text input, a select, a number field): it
 * receives the wiring through a render function, so no input type is
 * wrapped or re-styled here. The error is `role="alert"` only because it
 * appears in answer to the user's own submit or blur. Portal-allowed: the
 * only hook is React's `useId`.
 */
export interface FieldControlProps {
  readonly id: string;
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: true;
}

export function Field({
  label,
  hint,
  error,
  labelHidden = false,
  className = 'flex flex-col gap-1',
  children,
}: {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly error?: string | null;
  /** Keep the label for assistive tech only (a compact toolbar field); the input still gets it. */
  readonly labelHidden?: boolean;
  readonly className?: string;
  readonly children: (control: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const hasError = error !== undefined && error !== null && error !== '';
  const hasHint = hint !== undefined && hint !== null && hint !== false && hint !== '';
  const describedBy = [hasHint ? hintId : null, hasError ? errorId : null].filter((part) => part !== null).join(' ');
  return (
    <div className={className}>
      <label htmlFor={id} className={labelHidden ? 'sr-only' : labelClass}>
        {label}
      </label>
      {hasHint && (
        <span id={hintId} className="text-xs text-(--muted-foreground)">
          {hint}
        </span>
      )}
      {children({
        id,
        ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
        ...(hasError ? { 'aria-invalid': true as const } : {}),
      })}
      {hasError && (
        <span id={errorId} role="alert" className="text-xs text-(--destructive)">
          {error}
        </span>
      )}
    </div>
  );
}
