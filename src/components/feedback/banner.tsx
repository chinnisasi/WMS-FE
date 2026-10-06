import type { ReactNode } from 'react';

/**
 * Honest feedback banner: glyph + word + one reason line, on the shared
 * radius/border tokens. Accepted (accent green) and rejected (destructive)
 * variants — no celebratory animation, no color-only signals.
 *
 * Story 9-1 adds a third tone, `warning` (the existing amber `--warning`
 * token — no new hue), with an optional `action` slot: the Overview's stale
 * banner carries its Refresh button there. A warning is information, not a
 * refusal, so it is `role="status"`. The two original tones are unchanged.
 */
export function FeedbackBanner({
  tone,
  word,
  reason,
  action,
}: {
  tone: 'accepted' | 'rejected' | 'warning';
  word: string;
  reason: string;
  action?: ReactNode;
}) {
  if (tone === 'warning') {
    return (
      <div
        role="status"
        data-tone="warning"
        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-(--warning) bg-(--warning)/10 px-3 py-2 text-sm text-(--foreground)"
      >
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2 font-medium">
            <span
              aria-hidden
              className="flex h-4 w-4 items-center justify-center rounded-full bg-(--warning) text-[10px] text-(--warning-foreground)"
            >
              !
            </span>
            {word}
          </span>
          <span className="text-(--muted-foreground)">{reason}</span>
        </div>
        {action}
      </div>
    );
  }
  const accepted = tone === 'accepted';
  return (
    <div
      role={accepted ? 'status' : 'alert'}
      className={`flex flex-col gap-0.5 rounded-md border px-3 py-2 text-sm ${
        accepted
          ? 'border-(--accent) bg-(--accent)/10 text-(--foreground)'
          : 'border-(--destructive) bg-(--destructive)/10 text-(--foreground)'
      }`}
    >
      <span className="flex items-center gap-2 font-medium">
        <span
          aria-hidden
          className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] text-(--accent-foreground) ${
            accepted ? 'bg-(--accent)' : 'bg-(--destructive) text-(--destructive-foreground)'
          }`}
        >
          {accepted ? '✓' : '!'}
        </span>
        {word}
      </span>
      <span className="text-(--muted-foreground)">{reason}</span>
      {action}
    </div>
  );
}
