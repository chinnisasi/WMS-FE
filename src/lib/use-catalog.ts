'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListKits, fetchApiListProducts, fetchApiListSkus } from '@/lib/api/client';
import type { KitResponse, ProductResponse, SkuResponse } from '@/lib/api/generated';
import { CLIENT_PENDING, type ClientFilter } from '@/lib/active-client';
import { useClientEpoch } from '@/lib/use-client-epoch';
import { readSession, subscribeSession } from '@/lib/auth';
import { CATALOG_CHANGED_EVENT } from '@/lib/catalog';
import { fetchAllPages } from '@/lib/fetch-all-pages';
import { readReason } from '@/lib/outbound-orders';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

/** Story 1-4b — the SKU table's status filter: All (`null`), Active or Inactive. */
export type SkuStatusFilter = 'active' | 'inactive' | null;

export interface SkusPage {
  items: readonly SkuResponse[];
  /** Cursor for the DataTable's Next button; null on the last page. */
  nextCursor: string | null;
}

/**
 * One cursor-paginated page of the tenant's SKUs, wired to the DataTable's
 * Prev/Next (keyset pagination — offset/infinite scroll banned). Mutations
 * (import, inline edit) bump the revision via CATALOG_CHANGED_EVENT or the
 * returned `reload`, and the requested page is refetched. Stale pages
 * (tenant changed) are filtered at render time — no synchronous setState in
 * effects, matching useZoneBins.
 */
export function useSkus(
  /** Story 1-5a — the screen's active-client filter (`useActiveClient().filter`); pending sends nothing. */
  clientFilter: ClientFilter,
  /** Story 1-4b — the status filter (All = null). Joins the requested-cursor scope. */
  status: SkuStatusFilter = null,
): (SkusPage & { onCursor: (cursor: string | null) => void; reload: () => void }) | null {
  // `null` = unknown (server render) or signed out.
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const pending = clientFilter === CLIENT_PENDING;
  const clientId: string | null = clientFilter === CLIENT_PENDING ? null : clientFilter;
  const clientEpoch = useClientEpoch(clientId, pending);
  // The cursor the viewer asked for, scoped to the tenant it was asked for —
  // a cursor left over from another tenant is treated as a first-page
  // request, never replayed against the wrong scope.
  const [requested, setRequested] = useState<{
    tenantId: string;
    clientId: string | null;
    clientEpoch: number;
    status: SkuStatusFilter;
    cursor: string | null;
  } | null>(null);
  const activeCursor =
    requested !== null &&
    requested.tenantId === tenantId &&
    requested.clientId === clientId &&
    requested.clientEpoch === clientEpoch &&
    requested.status === status
      ? requested.cursor
      : null;
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<{
    tenantId: string;
    clientId: string | null;
    status: SkuStatusFilter;
    requested: string | null;
    page: SkusPage;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(CATALOG_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CATALOG_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || pending) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchApiListSkus(
          tenantId,
          {
            ...(clientId === null ? {} : { clientId }),
            ...(status === null ? {} : { status }),
            ...(activeCursor === null ? {} : { cursor: activeCursor }),
          },
        );
        if (!cancelled) {
          setPage({ tenantId, clientId, status, requested: activeCursor, page: result });
        }
      } catch {
        // Quiet chrome on failure — the render-time key check hides stale data.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, clientId, status, pending, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null) return;
      setRequested({ tenantId, clientId, clientEpoch, status, cursor });
    },
    [tenantId, clientId, clientEpoch, status],
  );
  const reload = useCallback(() => setRevision((r) => r + 1), []);

  if (
    tenantId === null ||
    pending ||
    page === null ||
    page.tenantId !== tenantId ||
    page.clientId !== clientId ||
    page.status !== status ||
    page.requested !== activeCursor
  ) {
    return null;
  }
  return { ...page.page, onCursor, reload };
}

/* ------------------------------------------------------------------ */
/* Products, kits and the variant matrix (story 11-6)                  */
/*                                                                     */
/* These hooks use the `ResourceState` shape — loading | ready |       */
/* failed, with `reload()` — the preferred shape since 4.2b (the       */
/* legacy `useSkus` above swallows a failed fetch into `null`, which   */
/* renders as "Loading…" forever; it is known debt, not a pattern).    */
/* ------------------------------------------------------------------ */

export interface ProductsPage {
  items: readonly ProductResponse[];
  /** Cursor for the DataTable's Next button; null on the last page. */
  nextCursor: string | null;
}

/**
 * One cursor-paginated page of the tenant's products (story 11-6) — the
 * products card's list, in the canonical `ResourceState` shape. Product and
 * variant mutations (create, edit, attach, detach) all notify through
 * CATALOG_CHANGED_EVENT, which bumps the revision and refetches the page;
 * stale pages (tenant changed) are filtered at render.
 */
export function useProducts(
  /** Story 1-5a — the screen's active-client filter (`useActiveClient().filter`); pending sends nothing. */
  clientFilter: ClientFilter,
): ResourceState<ProductsPage> &
  Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const pending = clientFilter === CLIENT_PENDING;
  const clientId: string | null = clientFilter === CLIENT_PENDING ? null : clientFilter;
  const clientEpoch = useClientEpoch(clientId, pending);
  // The cursor the viewer asked for, scoped to the tenant it was asked for.
  const [requested, setRequested] = useState<{ tenantId: string; clientId: string | null; clientEpoch: number; cursor: string | null } | null>(
    null,
  );
  const activeCursor =
    requested !== null && requested.tenantId === tenantId && requested.clientId === clientId && requested.clientEpoch === clientEpoch ? requested.cursor : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    clientId: string | null;
    requested: string | null;
    state: ResourceState<ProductsPage>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(CATALOG_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CATALOG_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || pending) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListProducts(
          tenantId,
          { ...(clientId === null ? {} : { clientId }), ...(activeCursor === null ? {} : { cursor: activeCursor }) },
        );
        if (!cancelled) {
          setResult({
            tenantId,
            clientId,
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
            clientId,
            requested: activeCursor,
            state: { state: 'failed', reason: readReason(error, 'products') },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, clientId, pending, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null) return;
      setRequested({ tenantId, clientId, clientEpoch, cursor });
    },
    [tenantId, clientId, clientEpoch],
  );
  const reload = useCallback(() => setRevision((r) => r + 1), []);

  const stale =
    tenantId === null ||
    pending ||
    result === null ||
    result.tenantId !== tenantId ||
    result.clientId !== clientId ||
    result.requested !== activeCursor;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload };
}

/**
 * The tenant's whole catalog as an id→SKU map — the settings pickers'
 * data source (the products card's attach picker, the kit editor's
 * component picker). Same explicit failed arm as its outbound sibling
 * `useOutboundSkus`: a picker cannot honestly be offered empty.
 */
export function useCatalogSkus(): ResourceState<Readonly<Record<string, SkuResponse>>> & Reloadable {
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

/**
 * The tenant's kits as a kitSkuId→kit map (story 11-6) — the SKU table's kit
 * marker and the kit editor's prefill. Kit-ness is DERIVED (the 11-4
 * no-flag decision): the marker is this join, never a field on the SKU.
 */
export function useKits(): ResourceState<Readonly<Record<string, KitResponse>>> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    state: ResourceState<Readonly<Record<string, KitResponse>>>;
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
        const kits = await fetchAllPages<KitResponse>((options) =>
          fetchApiListKits(tenantId, options),
        );
        if (!cancelled) {
          setResult({
            tenantId,
            state: { state: 'ready', data: Object.fromEntries(kits.map((k) => [k.skuId, k])) },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({
            tenantId,
            state: { state: 'failed', reason: readReason(error, 'the kit list') },
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
 * The SKUs attached to one product (story 11-6) — the variant matrix's data
 * source, `GET /catalog/skus?productId=` (built in 11-3 for exactly this).
 * Fetched when the product row expands (`productId` non-null); a failure is
 * reported on that row alone via the card, which renders it inline with a
 * Retry. The names/axes the matrix adds come from the products list the card
 * already holds — the join is client-side, per the spec, so the backend grew
 * no read for this.
 */
export function useSkusForProduct(
  productId: string | null,
): ResourceState<readonly SkuResponse[]> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    productId: string;
    state: ResourceState<readonly SkuResponse[]>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(CATALOG_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CATALOG_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || productId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const skus = await fetchAllPages<SkuResponse>((options) =>
          fetchApiListSkus(tenantId, { ...options, productId }),
        );
        if (!cancelled) {
          setResult({ tenantId, productId, state: { state: 'ready', data: skus } });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({
            tenantId,
            productId,
            state: { state: 'failed', reason: readReason(error, 'the variant list') },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, productId, revision]);

  const reload = useCallback(() => setRevision((r) => r + 1), []);
  const stale =
    productId === null || tenantId === null || result === null || result.tenantId !== tenantId || result.productId !== productId;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}