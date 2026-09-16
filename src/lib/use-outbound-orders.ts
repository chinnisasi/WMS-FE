'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import {
  fetchApiGetOrder,
  fetchApiListOrders,
  fetchApiListSkus,
  fetchApiListWarehouses,
} from '@/lib/api/client';
import type { OrderDto, OrderEntryDto, SkuResponse, WarehouseResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { CATALOG_CHANGED_EVENT } from '@/lib/catalog';
import { fetchAllPages } from '@/lib/fetch-all-pages';
import { fetchAllWarehouses } from '@/lib/fetch-all-warehouses';
import { detailReason, readReason } from '@/lib/outbound-orders';
import { OUTBOUND_CHANGED_EVENT } from '@/lib/outbound';
import { WAREHOUSES_CHANGED_EVENT } from '@/lib/warehouses';

/**
 * Every read this surface makes reports its own failure.
 *
 * The house hooks swallow a failed fetch into `null`, and a surface that
 * renders `null` as "Loading…" then tells the viewer a fetch is still in
 * flight forever. The I/O matrix asks for the house unreachable copy in a
 * FeedbackBanner instead, so these hooks carry an explicit `failed` arm and
 * the surface renders it with a Retry. Progress copy is never used for a
 * failure.
 */
export type ResourceState<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly data: T }
  | { readonly state: 'failed'; readonly reason: string };

/** Every resource hook returns a way to re-run itself — the Retry affordance. */
export interface Reloadable {
  readonly reload: () => void;
}

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
 */
export function useOutboundOrders(
  warehouseId: string | null,
): ResourceState<OutboundOrdersPage> &
  Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  // The cursor the viewer asked for, scoped to the (tenant, warehouse) it was
  // asked for — a cursor left over from another tenant or warehouse is
  // treated as a first-page request, never replayed against the wrong scope.
  const [requested, setRequested] = useState<{
    tenantId: string;
    warehouseId: string;
    cursor: string | null;
  } | null>(null);
  const activeCursor =
    requested !== null && requested.tenantId === tenantId && requested.warehouseId === warehouseId
      ? requested.cursor
      : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    warehouseId: string;
    requested: string | null;
    state: ResourceState<OutboundOrdersPage>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(OUTBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(OUTBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || warehouseId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListOrders(
          tenantId,
          warehouseId,
          activeCursor === null ? undefined : { cursor: activeCursor },
        );
        if (!cancelled) {
          setResult({
            tenantId,
            warehouseId,
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
            requested: activeCursor,
            state: { state: 'failed', reason: readReason(error, 'orders') },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null || warehouseId === null) return;
      setRequested({ tenantId, warehouseId, cursor });
    },
    [tenantId, warehouseId],
  );
  const reload = useCallback(() => setRevision((r) => r + 1), []);

  const stale =
    tenantId === null ||
    warehouseId === null ||
    result === null ||
    result.tenantId !== tenantId ||
    result.warehouseId !== warehouseId ||
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

export interface OutboundWarehouses {
  readonly tenantId: string;
  readonly items: readonly WarehouseResponse[];
}

/**
 * The tenant's warehouses for the surface's picker. The shared
 * `useTenantWarehouses` returns `null` on failure, which renders here as a
 * blank surface with no heading at all — so this surface does the same walk
 * with an explicit failed arm. (Nothing is lost by not sharing: every
 * consumer of that hook runs its own fetch anyway.)
 */
export function useOutboundWarehouses(): ResourceState<OutboundWarehouses> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    state: ResourceState<OutboundWarehouses>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(WAREHOUSES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(WAREHOUSES_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const items = await fetchAllWarehouses(tenantId, (id, options) =>
          fetchApiListWarehouses(id, options),
        );
        if (!cancelled) {
          setResult({ tenantId, state: { state: 'ready', data: { tenantId, items } } });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({
            tenantId,
            state: { state: 'failed', reason: readReason(error, 'warehouses') },
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
