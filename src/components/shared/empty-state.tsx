import type { ReactNode } from 'react';

/**
 * Story UI-2 (UI-PATTERNS §5, W4) — the three empty states, each with one
 * rendering, so first use, a filter that matched nothing and an all-clear
 * queue no longer look alike:
 *
 * - `first-use` — why it is empty, plus at most one next step;
 * - `filtered` — what matched nothing, plus the way out (Clear filters);
 * - `cleared` — a queue with nothing waiting: a good state, read as one
 *   (a muted ✓ beside the words; the glyph is decoration, the words carry
 *   the state — never colour or glyph alone).
 *
 * One sentence, never progress copy (a load is a skeleton) and never a
 * failure (that is `ReadFailure`). Portal-allowed: no hook.
 */
export type EmptyKind = 'first-use' | 'filtered' | 'cleared';

export function EmptyState({
  kind,
  children,
  action,
}: {
  readonly kind: EmptyKind;
  /** The one sentence. */
  readonly children: ReactNode;
  /** One next step: a button or a link (the caller's, so it carries its own capability gate). */
  readonly action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-2 text-center" data-testid="empty-state" data-kind={kind}>
      <p className="flex items-center gap-2 text-sm text-(--muted-foreground)">
        {kind === 'cleared' && (
          <span aria-hidden className="text-(--accent)">
            ✓
          </span>
        )}
        <span>{children}</span>
      </p>
      {action !== undefined && action !== null && action !== false && <div>{action}</div>}
    </div>
  );
}
