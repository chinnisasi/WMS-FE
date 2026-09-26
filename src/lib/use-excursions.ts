'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListExcursions, fetchApiListQcHolds } from '@/lib/api/client';
import type { ExcursionDto, QcHoldDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { MAX_PAGE_HOPS } from '@/lib/fetch-all-pages';
import { excursionListReason } from '@/lib/excursion';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

/**
 * The excursion review queue's reads (story 12-7), in the shape
 * `use-outbound-waves` established: session identity through
 * `useSyncExternalStore`, a `useEffect` fetch, and stale results (warehouse
 * switched mid-flight, tenant changed, tab changed) filtered at render
 * rather than by a setState in an effect.
 *
 * A NEW hook, not a fork of `useOverReceipts`: the house `Page | null` hooks
 * are declared debt (frontend guide §1) — every new hook carries the explicit
 * `failed` arm, because a queue rendering `null` as "Loading…" tells the
 * viewer a fetch is still in flight forever.
 */

export interface ExcursionHolds {
  /** holdId → the joined hold row (open or released — both states label). */
  holds: Readonly<Record<string, QcHoldDto>>;
  /**
   * The hold join's cursor chain hit its hop cap. A truncated join silently
   * re-labels live holds as disposed, so the card says the affected-units
   * list may be incomplete instead.
   */
  truncated: boolean;
}

export interface ExcursionsPage {
  items: readonly ExcursionDto[];
  /** Cursor for the queue's Next button; null on the last page. */
  nextCursor: string | null;
  /** The qc-holds join for the cards' affected units. */
  holds: ExcursionHolds;
}

/**
 * One cursor-paginated page of the tenant's temperature excursions, newest
 * first, warehouse- and status-filterable — the Conflicts & Reviews queue
 * read (open to any member; the resolve button is gated separately).
 *
 * The qc-holds join runs after the list lands: each card's holdIds resolve
 * against the WAREHOUSE's full hold chain (both statuses — a resolved
 * excursion's holds stay open until a `qc.manage` release, and a released
 * hold still labels). A hold id missing from the join renders disposed.
 */
export function useExcursions(
  warehouseId: string | null,
  status: 'open' | 'resolved',
): ResourceState<ExcursionsPage> & Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  // The cursor is scoped to the scope it was asked for — a cursor paged on
  // one warehouse or one status tab is a first-page request on another.
  const [requested, setRequested] = useState<{
    tenantId: string;
    warehouseId: string | null;
    status: 'open' | 'resolved';
    cursor: string | null;
  } | null>(null);
  const activeCursor =
    requested !== null &&
    requested.tenantId === tenantId &&
    requested.warehouseId === warehouseId &&
    requested.status === status
      ? requested.cursor
      : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    warehouseId: string | null;
    status: 'open' | 'resolved';
    requested: string | null;
    state: ResourceState<ExcursionsPage>;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListExcursions(
          tenantId,
          warehouseId === null && activeCursor === null
            ? { status }
            : {
                ...(warehouseId === null ? {} : { warehouseId }),
                status,
                ...(activeCursor === null ? {} : { cursor: activeCursor }),
              },
        );
        // The hold join: the warehouse's whole hold chain (both statuses),
        // walked to the hop cap with the truncation flagged like the wave
        // policies walk.
        const joined: Record<string, QcHoldDto> = {};
        let truncated = false;
        let holdCursor: string | undefined;
        for (let hops = 0; hops < MAX_PAGE_HOPS; hops++) {
          const holdPage = await fetchApiListQcHolds(
            tenantId,
            warehouseId === null && holdCursor === undefined
              ? undefined
              : {
                  ...(warehouseId === null ? {} : { warehouseId }),
                  ...(holdCursor === undefined ? {} : { cursor: holdCursor }),
                },
          );
          for (const hold of holdPage.items) {
            joined[hold.id] = hold;
          }
          const next = holdPage.nextCursor ?? null;
          if (next === null) break;
          holdCursor = next;
          truncated = hops === MAX_PAGE_HOPS - 1;
        }
        if (!cancelled) {
          setResult({
            tenantId,
            warehouseId,
            status,
            requested: activeCursor,
            state: {
              state: 'ready',
              data: {
                items: page.items,
                nextCursor: page.nextCursor ?? null,
                holds: { holds: joined, truncated },
              },
            },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({
            tenantId,
            warehouseId,
            status,
            requested: activeCursor,
            state: { state: 'failed', reason: excursionListReason(error) },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, status, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null) return;
      setRequested({ tenantId, warehouseId, status, cursor });
    },
    [tenantId, warehouseId, status],
  );
  // Clearing the result first is what makes Retry visible: leaving the old
  // `failed` state in place while the refetch is in flight renders a second
  // identical failure as an inert button.
  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);

  const stale =
    tenantId === null ||
    result === null ||
    result.tenantId !== tenantId ||
    result.warehouseId !== warehouseId ||
    result.status !== status ||
    result.requested !== activeCursor;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload };
}