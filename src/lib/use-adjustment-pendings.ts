'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListAdjustmentPendings } from '@/lib/api/client';
import type { AdjustmentPendingDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { adjustmentListReason } from '@/lib/review-queue';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

/**
 * The adjustment-approval queue's read (story 5-2's pendings, consumed by
 * story 5-5), in the `use-excursions.ts` shape — the explicit `failed` arm,
 * never a swallowed `null` (the house `Page | null` hooks are declared debt).
 */

/** The pending list's status tabs: the live queue plus the two decision outcomes. */
export const ADJUSTMENT_PENDING_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type AdjustmentPendingStatus = (typeof ADJUSTMENT_PENDING_STATUSES)[number];

export interface AdjustmentPendingsPage {
  items: readonly AdjustmentPendingDto[];
  /** Cursor for the queue's Next button; null on the last page. */
  nextCursor: string | null;
}

/**
 * The queue read: one cursor-paginated page of the TENANT's adjustment
 * pendings, newest first, status-filterable (the endpoint carries no
 * warehouse dimension — each row carries its own warehouseId). The cursor is
 * scoped to the (tenant, status) it was asked for — a cursor paged on one
 * status tab is a first-page request on another.
 */
export function useAdjustmentPendings(
  status: AdjustmentPendingStatus,
): ResourceState<AdjustmentPendingsPage> &
  Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  // The requested cursor, STAMPED with the scope it was asked for: a cursor
  // left over from another tenant or tab is a first-page request, never
  // replayed against the wrong scope.
  const [requested, setRequested] = useState<{
    tenantId: string;
    status: AdjustmentPendingStatus;
    cursor: string | null;
  } | null>(null);
  const activeCursor =
    requested !== null && requested.tenantId === tenantId && requested.status === status
      ? requested.cursor
      : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    status: AdjustmentPendingStatus;
    requested: string | null;
    state: ResourceState<AdjustmentPendingsPage>;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListAdjustmentPendings(
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
            state: { state: 'failed', reason: adjustmentListReason(error) },
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
  // Clearing the result first is what makes Retry visible; `requested`
  // resets too, so Retry restarts from the first page.
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