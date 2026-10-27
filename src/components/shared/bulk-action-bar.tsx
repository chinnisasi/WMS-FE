import type { ReactNode } from 'react';

import { buttonClass } from '@/components/shared/surface';

/**
 * Story UI-2 (UI-PATTERNS §3.5, W6) — the bar that replaces a table's top
 * edge while rows are selected: "3 waves selected", up to three actions,
 * and Clear selection at the far right. It sits in the flow above the
 * table (never sticky over it), so it can never cover the focused row
 * (WCAG 2.4.11). The count is a polite live region: a selection change is
 * announced, a routine update never becomes an alert. Portal-allowed.
 */
export function BulkActionBar({
  count,
  noun,
  onClear,
  disabled = false,
  children,
}: {
  readonly count: number;
  readonly noun: { readonly one: string; readonly many: string };
  readonly onClear: () => void;
  /** While a bulk run is in flight: the actions are the caller's, Clear is disabled here. */
  readonly disabled?: boolean;
  readonly children?: ReactNode;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="flex flex-wrap items-center gap-2 border-b border-(--border) bg-(--muted) px-3 py-2 text-sm"
      data-testid="bulk-action-bar"
    >
      <span aria-live="polite" className="font-medium">
        {count} {count === 1 ? noun.one : noun.many} selected
      </span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <button type="button" className={`${buttonClass} ml-auto py-1`} onClick={onClear} disabled={disabled}>
        Clear selection
      </button>
    </div>
  );
}
