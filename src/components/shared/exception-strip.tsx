import Link from 'next/link';

import { statusChipClass, StatusChip } from './status-chip';

/**
 * Story UI-1 (UI-PATTERNS §2 / §6, part of W11) — "what needs a human",
 * first on the page. Each non-zero item is an amber chip with its count in
 * words, a link to the rows behind it when the viewer can open them (a
 * plain chip when not). Zero items are not drawn: an all-clear strip says so
 * once, in one muted line, and the caller passes WHICH all-clear sentence is
 * true (every source read, or only some — never claim more than is known).
 * Portal-allowed: no hook.
 */
export interface ExceptionItem {
  readonly key: string;
  /** The words after the count, agreeing with it: "short-picked lines today". */
  readonly label: string;
  readonly count: number;
  /** The drill behind the count, or null when there is none for this viewer. */
  readonly href: string | null;
}

export function ExceptionStrip({
  items,
  clearedText,
}: {
  readonly items: readonly ExceptionItem[];
  readonly clearedText: string;
}) {
  const open = items.filter((item) => item.count > 0);
  return (
    <section aria-labelledby="exception-strip-heading" className="flex flex-wrap items-center gap-2 text-sm" data-testid="exception-strip">
      <h2 id="exception-strip-heading" className="text-sm font-medium">
        Needs attention
      </h2>
      {open.length === 0 ? (
        <span className="text-(--muted-foreground)" data-testid="exceptions-cleared">
          <span aria-hidden>✓ </span>
          {clearedText}
        </span>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {open.map((item) => {
            const words = `${item.count} ${item.label}`;
            return (
              <li key={item.key} data-testid={`exception-${item.key}`}>
                {item.href === null ? (
                  <StatusChip tone="warning" glyph="⚠">
                    {words}
                  </StatusChip>
                ) : (
                  <Link
                    href={item.href}
                    className={`${statusChipClass('warning')} underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-(--ring)`}
                  >
                    <span aria-hidden>⚠</span>
                    {words}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
