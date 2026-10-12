'use client';

import { FeedbackBanner } from '@/components/feedback/banner';

/**
 * The surface primitives shared by operator and portal pages (story 21-11b):
 * the six class constants, `Section` and `ReadFailure`. They began life in
 * `components/outbound/shell.tsx` (4.2b/4.2c), which still re-exports them
 * for its operator importers; the portal imports them from here, so no
 * portal page reaches an operator module (`lib/portal-boundary.test.ts`).
 *
 * Imports nothing but the feedback banner — keep it that way.
 */

export const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
export const labelClass = 'text-sm font-medium';
export const selectClass = `${inputClass} appearance-none`;
export const buttonClass =
  'rounded-sm border border-(--border) px-3 py-2 text-sm hover:bg-(--muted) disabled:opacity-40';
export const primaryClass =
  'rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60';
export const rowButtonClass =
  'rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40';

/**
 * One titled surface on a page. The heading renders in every
 * state, including a failed read — a section that goes entirely blank tells
 * the viewer nothing about where they are or what went wrong.
 */
export function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A failed read: the reason, and the way to try again. Never progress copy. */
export function ReadFailure({
  word,
  reason,
  onRetry,
}: {
  word: string;
  reason: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-2">
      <FeedbackBanner tone="rejected" word={word} reason={reason} />
      <button type="button" onClick={onRetry} className={buttonClass}>
        Retry
      </button>
    </div>
  );
}
