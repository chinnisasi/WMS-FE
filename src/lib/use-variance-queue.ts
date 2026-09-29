'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListLedgerEvents, fetchApiListVariances } from '@/lib/api/client';
import type { CountVarianceEntryResponseDto, LedgerEventDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { ledgerListReason, varianceListReason } from '@/lib/review-queue';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

/**
 * The variance review queue's reads (stories 5-4/5-5), in the shape
 * `use-excursions.ts` established: session identity through
 * `useSyncExternalStore`, a `useEffect` fetch, and stale results (tenant
 * changed, tab changed) filtered at render rather than by a setState in an
 * effect. The `Page | null` house hooks are declared debt — every new hook
 * carries the explicit `failed` arm, because a queue rendering `null` as
 * "Loading…" tells the viewer a fetch is still in flight forever.
 */

/** The list's own entry — the 5-4 DTO, aliased so the surface's imports read as the queue's rows. */
export type LedgerVarianceEntry = CountVarianceEntryResponseDto;

/** The variance list's status tabs: the open queue plus the two history arms. */
export const VARIANCE_STATUSES = ['open', 'adjusted', 'recounted'] as const;
export type VarianceStatus = (typeof VARIANCE_STATUSES)[number];

export interface VariancesPage {
  items: readonly LedgerVarianceEntry[];
  /** Cursor for the queue's Next button; null on the last page. */
  nextCursor: string | null;
}

/**
 * The queue read: one cursor-paginated page of the TENANT's variances,
 * newest first, status-filterable (no warehouse dimension — each row carries
 * its own warehouseId, and one place for everything needing judgment is the
 * point). The cursor is scoped to the (tenant, status) it was asked for — a
 * cursor paged on one status tab is a first-page request on another.
 */
export function useVarianceQueue(
  status: VarianceStatus,
): ResourceState<VariancesPage> & Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  // The requested cursor, STAMPED with the scope it was asked for (the
  // use-excursions pattern): a cursor left over from another tenant or tab
  // is a first-page request, never replayed against the wrong scope.
  const [requested, setRequested] = useState<{
    tenantId: string;
    status: VarianceStatus;
    cursor: string | null;
  } | null>(null);
  const activeCursor =
    requested !== null && requested.tenantId === tenantId && requested.status === status
      ? requested.cursor
      : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    status: VarianceStatus;
    requested: string | null;
    state: ResourceState<VariancesPage>;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListVariances(
          tenantId,
          activeCursor === null ? { status } : { status, cursor: activeCursor },
        );
        if (!cancelled) {
          setResult({
            tenantId,
            status,
            requested: activeCursor,
            state: {
              state: 'ready',
              data: { items: page.items, nextCursor: page.nextCursor ?? null },
            },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({
            tenantId,
            status,
            requested: activeCursor,
            state: { state: 'failed', reason: varianceListReason(error) },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, status, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null) return;
      setRequested({ tenantId, status, cursor });
    },
    [tenantId, status],
  );
  // Clearing the result first is what makes Retry visible: leaving the old
  // `failed` state in place while the refetch is in flight renders a second
  // identical failure as an inert button. `requested` resets too — the
  // classic failure here is a stale cursor whose Retry re-requests the SAME
  // stale cursor forever.
  const reload = useCallback(() => {
    setRequested(null);
    setResult(null);
    setRevision((r) => r + 1);
  }, []);

  const stale =
    tenantId === null ||
    result === null ||
    result.tenantId !== tenantId ||
    result.status !== status ||
    result.requested !== activeCursor;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload };
}

export interface LedgerEventsPage {
  items: readonly LedgerEventDto[];
  /** Cursor for the timeline panel's Next button; null on the last page. */
  nextCursor: string | null;
}

/**
 * The variance card's bin ledger timeline (story 5-5): the events touching
 * one bin (`GET .../warehouses/{w}/inventory/events?binId=` — source OR
 * destination), newest first, keyset-paginated. The panel mounts only when a
 * card is expanded, so this fetch (and this walk) runs only then. Warehouse
 * and bin come from the variance row itself, never from a picker.
 */
export function useBinLedgerEvents(
  warehouseId: string | null,
  binId: string | null,
): ResourceState<LedgerEventsPage> &
  Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  // The cursor is scoped to the (warehouse, bin) it was asked for — a cursor
  // paged on one bin is a first-page request on another.
  const [requested, setRequested] = useState<{
    warehouseId: string;
    binId: string;
    cursor: string | null;
  } | null>(null);
  const activeCursor =
    requested !== null &&
    warehouseId !== null &&
    binId !== null &&
    requested.warehouseId === warehouseId &&
    requested.binId === binId
      ? requested.cursor
      : null;
  const [result, setResult] = useState<{
    warehouseId: string;
    binId: string;
    requested: string | null;
    state: ResourceState<LedgerEventsPage>;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null || warehouseId === null || binId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListLedgerEvents(
          tenantId,
          warehouseId,
          activeCursor === null ? { binId } : { binId, cursor: activeCursor },
        );
        if (!cancelled) {
          setResult({
            warehouseId,
            binId,
            requested: activeCursor,
            state: {
              state: 'ready',
              data: { items: page.items, nextCursor: page.nextCursor ?? null },
            },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({
            warehouseId,
            binId,
            requested: activeCursor,
            state: { state: 'failed', reason: ledgerListReason(error) },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, binId, activeCursor]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (warehouseId === null || binId === null) return;
      setRequested({ warehouseId, binId, cursor });
    },
    [warehouseId, binId],
  );
  // The Retry affordance: clear the failure first, and restart from the
  // first page (a stale cursor would loop its own failure).
  const reload = useCallback(() => {
    setRequested(null);
    setResult(null);
  }, []);

  const stale =
    warehouseId === null ||
    binId === null ||
    result === null ||
    result.warehouseId !== warehouseId ||
    result.binId !== binId ||
    result.requested !== activeCursor;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload };
}