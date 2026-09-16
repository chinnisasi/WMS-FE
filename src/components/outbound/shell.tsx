'use client';

import { FeedbackBanner } from '@/components/feedback/banner';

/**
 * What the Outbound surfaces share.
 *
 * Orders (4.2b) and waves (4.2c) each used to carry their own byte-identical
 * `Shell`, `ReadFailure` and six class constants — and, worse, their own
 * `useOutboundWarehouses()` call and their own `<select>`, so `/outbound`
 * rendered TWO warehouse pickers, walked the warehouse cursor chain twice per
 * load, and let a viewer read orders for one warehouse beside waves for
 * another with nothing on screen saying so.
 *
 * The warehouse is now resolved ONCE, by `outbound.tsx`, and passed in. This
 * file holds only what both surfaces draw with; each keeps its own data hooks,
 * its own capability and its own section.
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
 * One titled surface on the Outbound page. The heading renders in every
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
