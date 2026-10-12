'use client';

import type { Reloadable } from '@/lib/resource-state';

import { ReadFailure, rowButtonClass } from '@/components/shared/surface';

/** The one word every failed warehouses read shows (story 21-11b). */
export const WAREHOUSES_NOT_LOADED = 'Warehouses not loaded';

/**
 * The ONE rendering of a failed warehouses read (story 21-11b, retro F3):
 * "Warehouses not loaded", the reason, and Retry — never an empty list, and
 * never "No warehouse yet". Every warehouse-listing surface renders it on
 * `failed`, from `useTenantWarehouses` (operator) or `usePortalWarehouses`
 * (portal).
 *
 * The prop type is the minimal failed arm from `lib/resource-state`, so this
 * component pulls in no operator module and the portal may use it
 * (`lib/portal-boundary.test.ts`).
 *
 * `compact` is the switcher's variant — it sits in the narrow sidebar and
 * the mobile menu: one line plus Retry, the reason as the line's title.
 */
export function WarehousesFailure({
  state,
  compact = false,
}: {
  state: { readonly state: 'failed'; readonly reason: string } & Reloadable;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div role="alert" title={state.reason} className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate font-medium">{WAREHOUSES_NOT_LOADED}</span>
        <button type="button" onClick={state.reload} className={rowButtonClass}>
          Retry
        </button>
      </div>
    );
  }
  return <ReadFailure word={WAREHOUSES_NOT_LOADED} reason={state.reason} onRetry={state.reload} />;
}

/**
 * Decision 3 (21-11b): a failed REFRESH while a last-good list is on screen —
 * one non-blocking line, "Couldn't refresh warehouses — Retry", the reason as
 * its title. The picker keeps the last-good list. Rendered where each
 * consumer renders its warehouse picker or list when `refreshFailed` is set.
 */
export function WarehousesRefreshNote({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  return (
    <div role="status" title={reason} className="flex items-center gap-1 text-xs text-(--muted-foreground)">
      <span>Couldn&apos;t refresh warehouses —{' '}</span>
      <button type="button" onClick={onRetry} className="underline underline-offset-2 hover:text-(--foreground)">
        Retry
      </button>
    </div>
  );
}
