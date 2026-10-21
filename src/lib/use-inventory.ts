'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import {
  fetchApiListBatches,
  fetchApiListBins,
  fetchApiListSkus,
  fetchApiListStock,
  fetchApiListZones,
} from '@/lib/api/client';
import type {
  BatchListItemDto,
  BinResponse,
  SkuResponse,
  StockEntryDto,
  ZoneResponse,
} from '@/lib/api/generated';
import { CLIENT_PENDING, type ClientFilter } from '@/lib/active-client';
import { useClientEpoch } from '@/lib/use-client-epoch';
import { readSession, subscribeSession } from '@/lib/auth';
import { CATALOG_CHANGED_EVENT } from '@/lib/catalog';
import { fetchAllPages } from '@/lib/fetch-all-pages';
import { readReason } from '@/lib/outbound-orders';
import type { Reloadable, ResourceState } from '@/lib/resource-state';
import { ZONES_CHANGED_EVENT } from '@/lib/zones';

/**
 * The Inventory screen's reads (inventory-screen, 2026-10-17), in the house
 * `ResourceState & Reloadable` shape (frontend guide §1). The SKU and bin
 * lookups are `ResourceState` twins of `useSkuMap` / `useBinCodeMap`
 * (`use-inbound.ts`): those swallow a failure into `null`, which the search
 * box cannot tell from "still loading" — and the box must say which map
 * failed and offer the other code.
 */

function useTenantId(): string | null {
  return useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
}

/** Every SKU of the tenant (`fetchAllPages`, 20 pages at most — PENDING). Refetches on `CATALOG_CHANGED_EVENT`. */
export function useSkuCatalog(): ResourceState<readonly SkuResponse[]> & Reloadable {
  const tenantId = useTenantId();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ tenantId: string; revision: number; state: ResourceState<readonly SkuResponse[]> } | null>(
    null,
  );

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
        const skus = await fetchAllPages<SkuResponse>((options) => fetchApiListSkus(tenantId, options));
        if (!cancelled) setResult({ tenantId, revision, state: { state: 'ready', data: skus } });
      } catch (error) {
        if (!cancelled) setResult({ tenantId, revision, state: { state: 'failed', reason: readReason(error, 'the SKU codes') } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, revision]);

  const reload = useCallback(() => setRevision((r) => r + 1), []);
  // A Retry (new revision) reads as loading until it answers; a catalog
  // change keeps the last list on screen meanwhile.
  const stale = tenantId === null || result === null || result.tenantId !== tenantId || (result.state.state === 'failed' && result.revision !== revision);
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}

/**
 * Every bin of one warehouse — zones, then each zone's bins, both through
 * `fetchAllPages`. Unlike `useBinCodeMap`, a zone that fails to list fails
 * the read: a silently partial map would make a bin search miss.
 */
export function useWarehouseBins(warehouseId: string | null): ResourceState<readonly BinResponse[]> & Reloadable {
  const tenantId = useTenantId();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    warehouseId: string;
    revision: number;
    state: ResourceState<readonly BinResponse[]>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(ZONES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(ZONES_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || warehouseId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const zones = await fetchAllPages<ZoneResponse>((options) => fetchApiListZones(tenantId, warehouseId, options));
        const perZone = await Promise.all(
          zones.map((zone) =>
            fetchAllPages<BinResponse>((options) => fetchApiListBins(tenantId, warehouseId, zone.id, options)),
          ),
        );
        if (!cancelled) setResult({ tenantId, warehouseId, revision, state: { state: 'ready', data: perZone.flat() } });
      } catch (error) {
        if (!cancelled) {
          setResult({ tenantId, warehouseId, revision, state: { state: 'failed', reason: readReason(error, 'the bin codes') } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, revision]);

  const reload = useCallback(() => setRevision((r) => r + 1), []);
  const stale =
    tenantId === null ||
    warehouseId === null ||
    result === null ||
    result.tenantId !== tenantId ||
    result.warehouseId !== warehouseId ||
    (result.state.state === 'failed' && result.revision !== revision);
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}

/** The stock list's page size — the route's ceiling. */
export const STOCK_PAGE_LIMIT = 200;

/**
 * A SKU walk stops after this many pages (50 × 200 = 10,000 rows) and says
 * so — a SKU is never in that many bins in practice, and an uncapped walk
 * would follow a misbehaving cursor forever.
 */
export const MAX_SKU_WALK_PAGES = 50;

export interface StockFilter {
  readonly skuId: string | null;
  readonly binId: string | null;
}

export interface StockRows {
  readonly rows: readonly StockEntryDto[];
  /** The next page's cursor; null when every row is loaded. */
  readonly nextCursor: string | null;
  readonly loadingMore: boolean;
  /** A later page failed: the loaded rows stay, with this reason and Retry. */
  readonly moreFailed: string | null;
  /** A walk (`walkAll`) stopped at `MAX_SKU_WALK_PAGES` with pages left. */
  readonly capped: boolean;
}

/**
 * The stock list for the Inventory screen: non-zero rows, bin by bin
 * (`order=location`), in explicit cursor pages of 200 with **Load more** —
 * never `fetchAllPages`. `walkAll` (a SKU search) follows every page before
 * the screen shows a total. Retry (`reload`) and any scope change — tenant,
 * warehouse, filter — reset the cursor and the rows together (frontend
 * guide §1.11): the scope, stamped on the requested cursor and on the rows,
 * includes a reload epoch, so a stale page never joins a fresh list.
 */
export function useStockList(
  warehouseId: string | null,
  filter: StockFilter,
  walkAll: boolean,
  /** Story 1-5a — the screen's active-client filter (`useActiveClient().filter`); pending sends nothing. */
  clientFilter: ClientFilter,
): ResourceState<StockRows> & Reloadable & { readonly loadMore: () => void } {
  const tenantId = useTenantId();
  const [epoch, setEpoch] = useState(0);
  const { skuId, binId } = filter;
  const pending = clientFilter === CLIENT_PENDING;
  const clientId: string | null = clientFilter === CLIENT_PENDING ? null : clientFilter;
  const clientEpoch = useClientEpoch(clientId, pending);
  const scope =
    tenantId === null || warehouseId === null || pending
      ? null
      : `${tenantId}|${warehouseId}|${clientId ?? '*'}#${clientEpoch}|${skuId ?? ''}|${binId ?? ''}|${walkAll ? 'all' : 'paged'}|${epoch}`;
  const [wanted, setWanted] = useState<{ scope: string; cursor: string; page: number } | null>(null);
  const wantedCursor = wanted !== null && wanted.scope === scope ? wanted.cursor : null;
  const wantedPage = wanted !== null && wanted.scope === scope ? wanted.page : 1;
  const [acc, setAcc] = useState<{
    scope: string;
    rows: readonly StockEntryDto[];
    nextCursor: string | null;
    /** The cursor of the last page appended (null = the first page). */
    loaded: string | null;
    /** How many pages are appended. */
    pages: number;
    failure: { cursor: string | null; reason: string } | null;
  } | null>(null);

  useEffect(() => {
    if (scope === null || tenantId === null || warehouseId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListStock(tenantId, warehouseId, {
          ...(skuId === null ? {} : { skuId }),
          ...(binId === null ? {} : { binId }),
          ...(clientId === null ? {} : { clientId }),
          ...(wantedCursor === null ? {} : { cursor: wantedCursor }),
          limit: STOCK_PAGE_LIMIT,
          order: 'location',
          nonZero: true,
        });
        if (cancelled) return;
        const nextCursor = page.nextCursor ?? null;
        setAcc((prev) => {
          const same = prev !== null && prev.scope === scope;
          if (same && wantedCursor !== null && prev.loaded === wantedCursor) return prev;
          const base = wantedCursor !== null && same ? prev.rows : [];
          return { scope, rows: [...base, ...page.items], nextCursor, loaded: wantedCursor, pages: wantedPage, failure: null };
        });
        if (walkAll && nextCursor !== null && wantedPage < MAX_SKU_WALK_PAGES) {
          setWanted({ scope, cursor: nextCursor, page: wantedPage + 1 });
        }
      } catch (error) {
        if (cancelled) return;
        const failure = { cursor: wantedCursor, reason: readReason(error, 'the stock list') };
        setAcc((prev) =>
          prev !== null && prev.scope === scope && wantedCursor !== null
            ? { ...prev, failure }
            : { scope, rows: [], nextCursor: null, loaded: null, pages: 0, failure },
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, tenantId, warehouseId, clientId, skuId, binId, walkAll, wantedCursor, wantedPage]);

  const reload = useCallback(() => setEpoch((e) => e + 1), []);

  const current = acc !== null && acc.scope === scope ? acc : null;
  const loadMore = () => {
    if (scope === null || current === null || current.nextCursor === null) return;
    if (current.failure !== null) return;
    setWanted({ scope, cursor: current.nextCursor, page: current.pages + 1 });
  };

  if (current === null) return { state: 'loading', reload, loadMore };
  if (current.failure !== null && current.failure.cursor === null) {
    return { state: 'failed', reason: current.failure.reason, reload, loadMore };
  }
  return {
    state: 'ready',
    data: {
      rows: current.rows,
      nextCursor: current.nextCursor,
      loadingMore: wantedCursor !== null && current.loaded !== wantedCursor && current.failure === null,
      moreFailed: current.failure?.reason ?? null,
      capped: walkAll && current.nextCursor !== null && current.pages >= MAX_SKU_WALK_PAGES,
    },
    reload,
    loadMore,
  };
}

/**
 * One SKU's batches in a warehouse, FEFO — read only once a batch-tracked SKU
 * is chosen. Story 3-1: `binId` narrows the on-hand to one bin (the move
 * form's origin); the scope key carries it, so a bin switch refetches.
 */
export function useBatchList(
  warehouseId: string | null,
  skuId: string | null,
  binId: string | null = null,
): ResourceState<readonly BatchListItemDto[]> & Reloadable {
  const tenantId = useTenantId();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    state: ResourceState<readonly BatchListItemDto[]>;
  } | null>(null);
  const key =
    tenantId === null || warehouseId === null || skuId === null ? null : `${tenantId}|${warehouseId}|${skuId}|${binId ?? '*'}|${revision}`;

  useEffect(() => {
    if (key === null || tenantId === null || warehouseId === null || skuId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchApiListBatches(tenantId, warehouseId, skuId, binId === null ? undefined : { binId });
        if (!cancelled) setResult({ key, state: { state: 'ready', data: list.items } });
      } catch (error) {
        if (!cancelled) setResult({ key, state: { state: 'failed', reason: readReason(error, 'the batches') } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, tenantId, warehouseId, skuId, binId]);

  const reload = useCallback(() => setRevision((r) => r + 1), []);
  return { ...(result === null || result.key !== key ? ({ state: 'loading' } as const) : result.state), reload };
}
