'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import {
  fetchApiGetOrder,
  fetchApiListOrders,
  fetchApiListSkus,
} from '@/lib/api/client';
import { CLIENT_PENDING, clientFilterForDrill, type ClientFilter } from '@/lib/active-client';
import { useClientEpoch } from '@/lib/use-client-epoch';
import { useKeyedDrill } from '@/lib/use-drill';
import type { OrderDto, OrderEntryDto, SkuResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { CATALOG_CHANGED_EVENT } from '@/lib/catalog';
import type { OrdersDrill } from '@/lib/drill';
import { fetchOrdersDrill } from '@/lib/drill-fetch';
import { fetchAllPages } from '@/lib/fetch-all-pages';
import { detailReason, readReason } from '@/lib/outbound-orders';
import { OUTBOUND_CHANGED_EVENT } from '@/lib/outbound';
import type { Reloadable, ResourceState } from '@/lib/resource-state';
import { useTenantWarehouses, type TenantWarehouses } from '@/lib/use-tenant-warehouses';

/** The read-hook shape lives in `resource-state.ts` (21-11b); re-exported so this module's importers are unchanged. */
export type { Reloadable, ResourceState } from '@/lib/resource-state';

export interface OutboundOrdersPage {
  items: readonly OrderEntryDto[];
  /** Cursor for the DataTable's Next button; null on the last page. */
  nextCursor: string | null;
}

/**
 * One cursor-paginated page of a warehouse's orders (story 4.2b), wired to
 * the DataTable's Prev/Next — the canonical hook shape: session identity via
 * `useSyncExternalStore`, a `useEffect` fetch, a `revision` counter bumped by
 * OUTBOUND_CHANGED_EVENT, and stale pages (warehouse switched mid-flight,
 * tenant changed) filtered at render rather than by a setState in an effect.
 *
 * The endpoint is newest-first with `cursor` + `limit` and nothing else — no
 * status filter, no sort, no search. The surface's status control therefore
 * filters what this returns and says so; it never claims to have searched
 * the warehouse.
 *
 * Story 9-1b — drilled mode: given an Overview drill, the page is the
 * drill's rows, filtered SERVER-side by exactly the drill's keys (its
 * warehouse in the path — the caller passes `drill.warehouseId`). The
 * cursor rides back verbatim. The screen remounts on a drill change, so the
 * drill is fixed for the hook's lifetime.
 */
export function useOutboundOrders(
  warehouseId: string | null,
  /** Story 1-5a — the active-client filter; a drill ignores it (decision 11). */
  clientFilter: ClientFilter,
  drillProp: OrdersDrill | null = null,
  /**
   * Story 4-1b — the exact-match search (trimmed, non-blank, or null), sent
   * as `reference`. Part of every scope stamp, so a new search reads page one
   * and a cursor minted by another search is never replayed. A drill ignores
   * it (the drill's rows are the tile's — the screen hides the box).
   */
  referenceProp: string | null = null,
): ResourceState<OutboundOrdersPage> &
  Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  // Keyed on drillKey, not identity: an RSC refresh must not refetch.
  const drill = useKeyedDrill(drillProp);
  const reference = drill === null ? referenceProp : null;
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const effective = clientFilterForDrill(clientFilter, drill !== null);
  const pending = effective === CLIENT_PENDING;
  const clientId: string | null = effective === CLIENT_PENDING ? null : effective;
  const clientEpoch = useClientEpoch(clientId, pending);
  // The cursor the viewer asked for, scoped to the (tenant, warehouse) it was
  // asked for — a cursor left over from another tenant or warehouse is
  // treated as a first-page request, never replayed against the wrong scope.
  const [requested, setRequested] = useState<{
    tenantId: string;
    warehouseId: string;
    clientId: string | null; clientEpoch: number;
    reference: string | null;
    cursor: string | null;
  } | null>(null);
  const activeCursor =
    requested !== null && requested.tenantId === tenantId && requested.warehouseId === warehouseId && requested.clientId === clientId && requested.clientEpoch === clientEpoch && requested.reference === reference
      ? requested.cursor
      : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    warehouseId: string;
    clientId: string | null;
    reference: string | null;
    requested: string | null;
    state: ResourceState<OutboundOrdersPage>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(OUTBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(OUTBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || warehouseId === null || pending) return;
    let cancelled = false;
    (async () => {
      try {
        const page =
          drill === null
            ? await fetchApiListOrders(
                tenantId,
                warehouseId,
                {
                  ...(clientId === null ? {} : { clientId }),
                  ...(reference === null ? {} : { reference }),
                  ...(activeCursor === null ? {} : { cursor: activeCursor }),
                },
              )
            : await fetchOrdersDrill(tenantId, drill, activeCursor);
        if (!cancelled) {
          setResult({
            tenantId,
            warehouseId,
            clientId,
            reference,
            requested: activeCursor,
            state: {
              state: 'ready',
              data: { items: page.items, nextCursor: page.nextCursor ?? null },
            },
          });
        }
      } catch (error) {
        // Reported, not swallowed: the surface renders this reason in a
        // FeedbackBanner with a Retry instead of an endless "Loading…".
        if (!cancelled) {
          setResult({
            tenantId,
            warehouseId,
            clientId,
            reference,
            requested: activeCursor,
            state: { state: 'failed', reason: readReason(error, 'orders') },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, clientId, reference, pending, drill, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null || warehouseId === null) return;
      setRequested({ tenantId, warehouseId, clientId, clientEpoch, reference, cursor });
    },
    [tenantId, warehouseId, clientId, clientEpoch, reference],
  );
  const reload = useCallback(() => setRevision((r) => r + 1), []);

  const stale =
    tenantId === null ||
    warehouseId === null ||
    pending ||
    result === null ||
    result.tenantId !== tenantId ||
    result.warehouseId !== warehouseId ||
    result.clientId !== clientId ||
    result.reference !== reference ||
    result.requested !== activeCursor;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload };
}

/**
 * One order's detail, fetched when its row expands (`orderId` non-null).
 * There is no `[id]` route in this app and the list row genuinely cannot
 * carry quantities — `OrderEntryDto` omits `lines` and offers no `lineCount`
 * or `totalUnits` — so expanding fetches once.
 *
 * A failure here belongs to one row: the surface renders it inline on that
 * row and leaves the list untouched.
 */
export function useOrderDetail(orderId: string | null): ResourceState<OrderDto> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    orderId: string;
    state: ResourceState<OrderDto>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(OUTBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(OUTBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || orderId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const { order } = await fetchApiGetOrder(tenantId, orderId);
        if (!cancelled) setResult({ tenantId, orderId, state: { state: 'ready', data: order } });
      } catch (error) {
        if (!cancelled) {
          setResult({
            tenantId,
            orderId,
            state: { state: 'failed', reason: detailReason(error) },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, orderId, revision]);

  const reload = useCallback(() => setRevision((r) => r + 1), []);
  const stale =
    orderId === null ||
    tenantId === null ||
    result === null ||
    result.tenantId !== tenantId ||
    result.orderId !== orderId;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}

/**
 * The tenant's warehouses for a surface's picker. Story 21-11b folded this
 * into the one warehouses hook: it existed only because `useTenantWarehouses`
 * had no failed arm. Kept as an alias so its callers are unchanged — one
 * implementation, one behaviour.
 */
export type OutboundWarehouses = TenantWarehouses;
export const useOutboundWarehouses = useTenantWarehouses;

/**
 * The tenant's catalog as an id→SKU map — the create form's picker, and the
 * SKU codes of an expanded order's lines (`OrderLineDto` carries `skuId`
 * alone). Same explicit failed arm as its siblings: the create form cannot
 * honestly offer a SKU picker it could not load.
 */
export function useOutboundSkus(): ResourceState<Readonly<Record<string, SkuResponse>>> &
  Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    state: ResourceState<Readonly<Record<string, SkuResponse>>>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(CATALOG_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CATALOG_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const skus = await fetchAllPages<SkuResponse>((options) =>
          fetchApiListSkus(tenantId, options),
        );
        if (!cancelled) {
          setResult({
            tenantId,
            state: { state: 'ready', data: Object.fromEntries(skus.map((s) => [s.id, s])) },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({
            tenantId,
            state: { state: 'failed', reason: readReason(error, 'the SKU list') },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, revision]);

  const reload = useCallback(() => setRevision((r) => r + 1), []);
  const stale = tenantId === null || result === null || result.tenantId !== tenantId;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}
