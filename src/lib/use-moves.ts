'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiListBatches, fetchApiListLedgerEvents, fetchApiListStock } from '@/lib/api/client';
import type { LedgerEventDto, StockEntryDto } from '@/lib/api/generated';
import { CLIENT_PENDING, type ClientFilter } from '@/lib/active-client';
import { readSession, subscribeSession } from '@/lib/auth';
import { MOVES_CHANGED_EVENT, readMovePage } from '@/lib/moves';
import { readReason } from '@/lib/outbound-orders';
import type { Reloadable, ResourceState } from '@/lib/resource-state';
import { useClientEpoch } from '@/lib/use-client-epoch';

/**
 * Story 3-1 — the Moves page's reads, in the house `ResourceState &
 * Reloadable` shape (frontend guide §1).
 */

function useTenantId(): string | null {
  return useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
}

/** The origin read's page — the route's ceiling. A bin holds far fewer SKU rows than this. */
export const BIN_STOCK_LIMIT = 200;

export interface BinStock {
  readonly rows: readonly StockEntryDto[];
  /** More rows than one page — the form says so rather than silently missing a SKU. */
  readonly truncated: boolean;
}

/**
 * What one bin holds (`GET …/inventory/stock?binId&nonZero=true&limit=200`) —
 * the move form's SKU options once an origin is picked. Unfiltered by client
 * (a write-side form, guide §1.12). Refetches on `MOVES_CHANGED_EVENT`.
 */
export function useBinStock(warehouseId: string | null, binId: string | null): ResourceState<BinStock> & Reloadable {
  const tenantId = useTenantId();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; state: ResourceState<BinStock> } | null>(null);
  const key = tenantId === null || warehouseId === null || binId === null ? null : `${tenantId}|${warehouseId}|${binId}|${revision}`;

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(MOVES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(MOVES_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (key === null || tenantId === null || warehouseId === null || binId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListStock(tenantId, warehouseId, { binId, nonZero: true, limit: BIN_STOCK_LIMIT });
        if (!cancelled) {
          setResult({ key, state: { state: 'ready', data: { rows: page.items, truncated: (page.nextCursor ?? null) !== null } } });
        }
      } catch (error) {
        if (!cancelled) setResult({ key, state: { state: 'failed', reason: readReason(error, "the bin's stock") } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, tenantId, warehouseId, binId]);

  // Retry clears first, so the failure does not stay on screen as an inert button.
  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);
  return { ...(result === null || result.key !== key ? ({ state: 'loading' } as const) : result.state), reload };
}

export interface RecentMovesPage {
  readonly items: readonly LedgerEventDto[];
  readonly nextCursor: string | null;
}

/**
 * The warehouse's recent moves: its `stock.moved` ledger events, newest
 * first, following the client switcher (the filter and its epoch stamp every
 * request, guide §1.12). Reloads on `MOVES_CHANGED_EVENT` (a move from this
 * page) back to page one.
 */
export function useRecentMoves(
  warehouseId: string | null,
  clientFilter: ClientFilter,
): ResourceState<RecentMovesPage> & Reloadable & { readonly onCursor: (cursor: string | null) => void; readonly epoch: number } {
  const tenantId = useTenantId();
  const pending = clientFilter === CLIENT_PENDING;
  const clientId: string | null = clientFilter === CLIENT_PENDING ? null : clientFilter;
  const clientEpoch = useClientEpoch(clientId, pending);
  const [revision, setRevision] = useState(0);
  const scope =
    tenantId === null || warehouseId === null || pending ? null : `${tenantId}|${warehouseId}|${clientId ?? '*'}#${clientEpoch}|${revision}`;
  const [requested, setRequested] = useState<{ scope: string; cursor: string | null } | null>(null);
  const activeCursor = requested !== null && requested.scope === scope ? requested.cursor : null;
  // The move each handed-out cursor must skip the head of (the move the page
  // before it finished — `readMovePage`); keyed by scope and cursor.
  const skips = useRef(new Map<string, string | null>());
  const [result, setResult] = useState<{ scope: string; requested: string | null; state: ResourceState<RecentMovesPage> } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(MOVES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(MOVES_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (scope === null || tenantId === null || warehouseId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const skip = activeCursor === null ? null : (skips.current.get(`${scope}|${activeCursor}`) ?? null);
        const page = await readMovePage(
          (cursor) =>
            fetchApiListLedgerEvents(tenantId, warehouseId, {
              type: ['stock.moved'],
              ...(clientId === null ? {} : { clientId }),
              ...(cursor === null ? {} : { cursor }),
            }),
          activeCursor,
          skip,
        );
        if (!cancelled) {
          if (page.nextCursor !== null) skips.current.set(`${scope}|${page.nextCursor}`, page.trailingMoveId);
          setResult({ scope, requested: activeCursor, state: { state: 'ready', data: { items: page.items, nextCursor: page.nextCursor } } });
        }
      } catch (error) {
        if (!cancelled) setResult({ scope, requested: activeCursor, state: { state: 'failed', reason: readReason(error, 'the recent moves') } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, tenantId, warehouseId, clientId, activeCursor]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (scope !== null) setRequested({ scope, cursor });
    },
    [scope],
  );
  // Retry reads page one again and remounts the table (the epoch, guide §1.11).
  const reload = useCallback(() => {
    setRequested(null);
    setResult(null);
    setRevision((r) => r + 1);
  }, []);

  const stale = scope === null || result === null || result.scope !== scope || result.requested !== activeCursor;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload, onCursor, epoch: revision };
}

/**
 * The batch codes of one page of moves: one batch read per SKU the page's
 * batch arms name (`GET …/inventory/batches?skuId`), as an id → code map.
 * Null while loading; a failed read leaves the cell on the short id — the
 * code is a label, never a decision.
 */
export function useBatchCodes(warehouseId: string | null, skuIds: readonly string[]): Readonly<Record<string, string>> | null {
  const tenantId = useTenantId();
  const wanted = [...new Set(skuIds)].sort();
  const key = tenantId === null || warehouseId === null ? null : `${tenantId}|${warehouseId}|${wanted.join(',')}`;
  const [result, setResult] = useState<{ key: string; codes: Readonly<Record<string, string>> } | null>(null);

  useEffect(() => {
    if (key === null || tenantId === null || warehouseId === null) return;
    const ids = key.split('|')[2]!.split(',').filter((id) => id !== '');
    let cancelled = false;
    (async () => {
      const codes: Record<string, string> = {};
      await Promise.all(
        ids.map(async (skuId) => {
          try {
            const list = await fetchApiListBatches(tenantId, warehouseId, skuId);
            for (const batch of list.items) codes[batch.id] = batch.code;
          } catch {
            // A label read: the cell falls back to the short id.
          }
        }),
      );
      if (!cancelled) setResult({ key, codes });
    })();
    return () => {
      cancelled = true;
    };
  }, [key, tenantId, warehouseId]);

  return result === null || result.key !== key ? null : result.codes;
}
