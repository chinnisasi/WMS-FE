'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiGetStockTake, fetchApiListStockTakeVariances, fetchApiListStockTakes } from '@/lib/api/client';
import type { StockTakeDetailResponse, StockTakeListEntryDto, StockTakeVarianceEntryDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { COUNTS_CHANGED_EVENT } from '@/lib/counts';
import { readReason } from '@/lib/outbound-orders';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

/**
 * Story 3-5b — the Stock takes tab's reads, in the house shape (frontend
 * guide §1): the result stamped with its scope, an explicit `failed` arm,
 * `reload()` clearing first, `COUNTS_CHANGED_EVENT` bumping a revision. No
 * polling (decision 11): the dashboard has Refresh and an "As of HH:MM".
 */

export interface Stamped<T> {
  readonly data: T;
  /** When the read landed (ISO) — the "As of" line. */
  readonly asOf: string;
}

function useScopedRead<T>(scope: string | null, read: (() => Promise<T>) | null, what: string): ResourceState<Stamped<T>> & Reloadable {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ scope: string; state: ResourceState<Stamped<T>> } | null>(null);
  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(COUNTS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(COUNTS_CHANGED_EVENT, onChange);
  }, []);
  useEffect(() => {
    if (scope === null || read === null) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await read();
        if (!cancelled) setResult({ scope, state: { state: 'ready', data: { data, asOf: new Date().toISOString() } } });
      } catch (error) {
        if (!cancelled) setResult({ scope, state: { state: 'failed', reason: readReason(error, what) } });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `read` is rebuilt per render; the scope and the revision are the identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, revision]);
  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);
  const fresh = scope !== null && result !== null && result.scope === scope;
  return { ...(fresh ? result.state : ({ state: 'loading' } as const)), reload };
}

function useTenantId(): string | null {
  return useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
}

/** The list page size — newest first; "Load more" appends the next keyset page. */
export const STOCK_TAKES_PAGE_LIMIT = 50;

export interface StockTakesPage {
  readonly items: readonly StockTakeListEntryDto[];
  readonly nextCursor: string | null;
}

/** A warehouse's stock takes, newest first, with Load more (keyset cursor). */
export function useStockTakes(warehouseId: string): ResourceState<Stamped<StockTakesPage>> &
  Reloadable & { readonly loadMore: () => void; readonly loadingMore: boolean; readonly moreError: string | null } {
  const tenantId = useTenantId();
  const first = useScopedRead(
    tenantId === null ? null : `${tenantId}|${warehouseId}`,
    tenantId === null
      ? null
      : async (): Promise<StockTakesPage> => {
          const page = await fetchApiListStockTakes(tenantId, { warehouseId, limit: STOCK_TAKES_PAGE_LIMIT });
          return { items: page.items, nextCursor: page.nextCursor ?? null };
        },
    'the stock takes',
  );
  const [more, setMore] = useState<{ base: string; items: readonly StockTakeListEntryDto[]; nextCursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const baseAsOf = first.state === 'ready' ? first.data.asOf : null;
  const extra = more !== null && more.base === baseAsOf ? more : null;
  const loadMore = useCallback(() => {
    if (tenantId === null || first.state !== 'ready') return;
    const cursor = extra?.nextCursor ?? first.data.data.nextCursor;
    if (cursor === null || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    void fetchApiListStockTakes(tenantId, { warehouseId, cursor, limit: STOCK_TAKES_PAGE_LIMIT })
      .then((page) =>
        setMore({ base: first.data.asOf, items: [...(extra?.items ?? []), ...page.items], nextCursor: page.nextCursor ?? null }),
      )
      .catch((error: unknown) => setMoreError(readReason(error, 'more stock takes')))
      .finally(() => setLoadingMore(false));
  }, [tenantId, warehouseId, first, extra, loadingMore]);
  if (first.state !== 'ready') return { ...first, loadMore, loadingMore, moreError };
  const merged: StockTakesPage = {
    items: [...first.data.data.items, ...(extra?.items ?? [])],
    nextCursor: extra === null ? first.data.data.nextCursor : extra.nextCursor,
  };
  return { state: 'ready', data: { data: merged, asOf: first.data.asOf }, reload: first.reload, loadMore, loadingMore, moreError };
}

export function useStockTakeDetail(stockTakeId: string): ResourceState<Stamped<StockTakeDetailResponse>> & Reloadable {
  const tenantId = useTenantId();
  return useScopedRead(
    tenantId === null ? null : `${tenantId}|${stockTakeId}`,
    tenantId === null ? null : () => fetchApiGetStockTake(tenantId, stockTakeId),
    'the stock take',
  );
}

/** Every variance of the take (keyset pages walked to the end; gated server-side). */
export function useStockTakeVariances(stockTakeId: string, enabled: boolean): ResourceState<Stamped<readonly StockTakeVarianceEntryDto[]>> & Reloadable {
  const tenantId = useTenantId();
  return useScopedRead(
    tenantId === null || !enabled ? null : `${tenantId}|${stockTakeId}`,
    tenantId === null || !enabled
      ? null
      : async () => {
          const items: StockTakeVarianceEntryDto[] = [];
          let cursor: string | undefined;
          do {
            const page = await fetchApiListStockTakeVariances(tenantId, stockTakeId, { limit: 500, ...(cursor === undefined ? {} : { cursor }) });
            items.push(...page.items);
            cursor = page.nextCursor ?? undefined;
          } while (cursor !== undefined);
          return items;
        },
    'the variances',
  );
}
