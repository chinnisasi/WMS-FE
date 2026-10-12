'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListLedgerEvents } from '@/lib/api/client';
import { useKeyedDrill } from '@/lib/use-drill';
import type { LedgerEventDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import type { LedgerDrill } from '@/lib/drill';
import { fetchLedgerDrill } from '@/lib/drill-fetch';
import { readReason } from '@/lib/outbound-orders';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

export interface LedgerEventsPage {
  readonly items: readonly LedgerEventDto[];
  /** Cursor for the DataTable's Next button; null on the last page. */
  readonly nextCursor: string | null;
}

/**
 * Story 9-1b — one keyset page of a warehouse's ledger timeline, newest
 * first (the Ledger page, `/inventory/ledger`). Without a drill it is the
 * warehouse's recent events, unfiltered; with one it is exactly the drill's
 * rows — its type, window, SKU, order and short-pick flag sent verbatim, its
 * warehouse in the path (the caller passes `drill.warehouseId`). The cursor
 * is passed back verbatim, stamped with the (tenant, warehouse) it was
 * requested for (frontend guide §1).
 */
export function useLedgerEvents(
  warehouseId: string | null,
  drillProp: LedgerDrill | null = null,
): ResourceState<LedgerEventsPage> & Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  // Keyed on drillKey, not identity: an RSC refresh must not refetch.
  const drill = useKeyedDrill(drillProp);
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [requested, setRequested] = useState<{ tenantId: string; warehouseId: string; cursor: string | null } | null>(
    null,
  );
  const activeCursor =
    requested !== null && requested.tenantId === tenantId && requested.warehouseId === warehouseId
      ? requested.cursor
      : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    warehouseId: string;
    requested: string | null;
    state: ResourceState<LedgerEventsPage>;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null || warehouseId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page =
          drill === null
            ? await fetchApiListLedgerEvents(tenantId, warehouseId, activeCursor === null ? undefined : { cursor: activeCursor })
            : await fetchLedgerDrill(tenantId, drill, activeCursor);
        if (!cancelled) {
          setResult({
            tenantId,
            warehouseId,
            requested: activeCursor,
            state: { state: 'ready', data: { items: page.items, nextCursor: page.nextCursor ?? null } },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({
            tenantId,
            warehouseId,
            requested: activeCursor,
            state: { state: 'failed', reason: readReason(error, 'the ledger') },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, drill, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null || warehouseId === null) return;
      setRequested({ tenantId, warehouseId, cursor });
    },
    [tenantId, warehouseId],
  );
  // Clear first, and restart from page one: a stale-cursor failure whose
  // Retry re-requested the same cursor would fail forever.
  const reload = useCallback(() => {
    setRequested(null);
    setResult(null);
    setRevision((r) => r + 1);
  }, []);

  const stale =
    tenantId === null ||
    warehouseId === null ||
    result === null ||
    result.tenantId !== tenantId ||
    result.warehouseId !== warehouseId ||
    result.requested !== activeCursor;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload };
}
