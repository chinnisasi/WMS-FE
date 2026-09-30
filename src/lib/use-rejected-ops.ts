'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListRejectedOps } from '@/lib/api/client';
import type { RejectedOpResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { rejectedOpsListReason } from '@/lib/review-queue';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

/**
 * The rejected-ops review queue's read (story 5-6), in the shape
 * `use-variance-queue.ts` established: session identity through
 * `useSyncExternalStore`, a `useEffect` fetch, stale results (tenant
 * changed, tab changed) filtered at render, the cursor STAMPED with the
 * scope it was asked for, and the E1-fixed revision counter so a reload
 * whose resets leave the deps unchanged still re-runs. The ledger timeline
 * a card's expanded panel walks is `useBinLedgerEvents` — reused verbatim,
 * nothing new.
 */

/** The list's own entry — the 5-6 DTO, aliased so the surface's imports read as the queue's rows. */
export type RejectedOpEntry = RejectedOpResponse;

/** The rejected-ops list's status tabs: the open queue plus the three history arms. */
export const REJECTED_OP_STATUSES = ['open', 'applied', 'recounted', 'discarded'] as const;
export type RejectedOpStatus = (typeof REJECTED_OP_STATUSES)[number];

export interface RejectedOpsPage {
  items: readonly RejectedOpEntry[];
  /** Cursor for the queue's Next button; null on the last page. */
  nextCursor: string | null;
}

/**
 * The queue read: one cursor-paginated page of the TENANT's rejected ops
 * (the AD-14 quarantine residents and outright-refused ops the devices'
 * sync reports uploaded), newest first, status-filterable. The cursor is
 * scoped to the (tenant, status) it was asked for — a cursor paged on one
 * status tab is a first-page request on another.
 */
export function useRejectedOps(
  status: RejectedOpStatus,
): ResourceState<RejectedOpsPage> & Reloadable & { readonly onCursor: (cursor: string | null) => void } {
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
    status: RejectedOpStatus;
    cursor: string | null;
  } | null>(null);
  const activeCursor =
    requested !== null && requested.tenantId === tenantId && requested.status === status
      ? requested.cursor
      : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    status: RejectedOpStatus;
    requested: string | null;
    state: ResourceState<RejectedOpsPage>;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListRejectedOps(
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
            state: { state: 'failed', reason: rejectedOpsListReason(error) },
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
  // resets too — the classic failure here is a stale cursor whose Retry
  // re-requests the SAME stale cursor forever.
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
