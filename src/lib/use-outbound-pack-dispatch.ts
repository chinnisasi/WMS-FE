'use client';

import { useCallback, useEffect, useState } from 'react';

import { ApiProblem, fetchApiOrderCartons } from '@/lib/api/client';
import type { OrderCartonsResponse } from '@/lib/api/generated';
import { cartonSummary } from '@/lib/cartons';
import { OUTBOUND_CHANGED_EVENT } from '@/lib/outbound';
import { readReason } from '@/lib/outbound-orders';
import { useOutboundOrders, type Reloadable, type ResourceState } from '@/lib/use-outbound-orders';

/**
 * The pack & dispatch surface's reads (story 4-2d).
 *
 * There is exactly one read of its own — the warehouse's order page — and it
 * is the SAME read the orders surface makes: the list endpoint is the only
 * order read there is (`cursor` + `limit`, headers only), and packable and
 * dispatchable orders are page-scoped client-side statuses of it. The hook is
 * therefore a distinct INSTANCE of the canonical shape (`use-outbound-orders`)
 * rather than a second fetch implementation: the two surfaces both mount on
 * `/outbound`, each needs its own cursor, revision counter and failed arm,
 * and the wave generate form already runs its own `useOutboundOrders` beside
 * the orders table for the same reason.
 *
 * The mutations this story adds do NOT live here: like the 4-2b/4-2c
 * surfaces, they live in the component (`pack-dispatch.tsx`), where the
 * idempotency key's lifetime is the intent — per-DRAFT for the pack bench,
 * per-CONFIRMATION for dispatch — and each success calls
 * `notifyOutboundChanged()` so every outbound reader refetches. The refusal
 * mappers live in `lib/outbound-pack-dispatch.ts`, tested.
 */

/**
 * One cursor-paginated page of the warehouse's orders, newest first — the
 * read the pack & dispatch pipeline filters its packable/dispatchable rows
 * out of.
 */
export function usePipelineOrders(warehouseId: string | null) {
  // Story 1-5a — never client-filtered: the pack bench and a carrier pickup
  // act on every client's parcels (decision 10).
  return useOutboundOrders(warehouseId, null);
}

/* ------------------------------------------------------------------ */
/* Story 4-5a — the cartons read (A11)                                 */
/* ------------------------------------------------------------------ */

function useOutboundChangeRevision(): [number, () => void] {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(OUTBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(OUTBOUND_CHANGED_EVENT, onChange);
  }, []);
  return [revision, useCallback(() => setRevision((r) => r + 1), [])];
}

/**
 * Story 4-5a (A11) — one packed order's pack and cartons, refetched on every
 * outbound change (a re-carton, a cancel). `null` when the order is not
 * packed (409 `order-not-packed`), or the API has no such route (a 404 —
 * guide §1.13, an additive section) — the panel then shows nothing.
 */
export function useOrderCartons(
  tenantId: string,
  orderId: string | null,
): ResourceState<OrderCartonsResponse | null> & Reloadable {
  const [revision, bump] = useOutboundChangeRevision();
  // Keyed by the order, not the revision: a refetch keeps the last read on
  // screen (a re-carton's outcome must outlive the refresh it triggers).
  const [result, setResult] = useState<{ key: string; state: ResourceState<OrderCartonsResponse | null> } | null>(null);
  const key = `${tenantId}|${orderId}`;

  useEffect(() => {
    if (orderId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const cartons = await fetchApiOrderCartons(tenantId, orderId);
        if (!cancelled) setResult({ key, state: { state: 'ready', data: cartons } });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiProblem && (error.code === 'order-not-packed' || error.code === 'not-found')) {
          setResult({ key, state: { state: 'ready', data: null } });
        } else {
          setResult({ key, state: { state: 'failed', reason: readReason(error, 'The cartons') } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, orderId, key, revision]);

  const reload = useCallback(() => {
    setResult(null);
    bump();
  }, [bump]);
  if (orderId === null) return { state: 'ready', data: null, reload };
  if (result === null || result.key !== key) return { state: 'loading', reload };
  return { ...result.state, reload };
}

/** At most this many cartons reads are in flight at once for the packed rows. */
export const MAX_CONCURRENT_CARTON_READS = 4;

/**
 * `fn` over `items` with at most `limit` calls in flight, results in input
 * order (as `Promise.allSettled` would give them).
 */
export async function settleLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      try {
        out[index] = { status: 'fulfilled', value: await fn(items[index]!) };
      } catch (reason) {
        out[index] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, () => worker()));
  return out;
}

/**
 * Story 4-5a (A26) — the packed rows' carton summaries ("3 cartons · 12.4
 * kg"), one cartons read per packed order on the page, at most
 * `MAX_CONCURRENT_CARTON_READS` at once. Keyed by the page's orders, not the
 * change revision: a refetch after an outbound change keeps the last
 * summaries on screen until it lands (no blank flash). A failed read leaves
 * its row without a summary (the expanded panel says why).
 */
export function usePackedCartonSummaries(tenantId: string, orderIds: readonly string[]): ReadonlyMap<string, string> {
  const [revision] = useOutboundChangeRevision();
  const [result, setResult] = useState<{ key: string; data: ReadonlyMap<string, string> } | null>(null);
  const key = `${tenantId}|${orderIds.join(',')}`;
  useEffect(() => {
    if (orderIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const settled = await settleLimited(orderIds, MAX_CONCURRENT_CARTON_READS, (orderId) => fetchApiOrderCartons(tenantId, orderId));
      if (cancelled) return;
      const data = new Map<string, string>();
      settled.forEach((entry, index) => {
        if (entry.status === 'fulfilled') {
          data.set(orderIds[index]!, cartonSummary(entry.value.pack.cartonCount, entry.value.pack.grossWeightGrams));
        }
      });
      setResult({ key, data });
    })();
    return () => {
      cancelled = true;
    };
    // `orderIds` enters through `key` — the array's identity churns every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision]);
  if (orderIds.length === 0 || result === null || result.key !== key) return EMPTY_SUMMARIES;
  return result.data;
}

const EMPTY_SUMMARIES: ReadonlyMap<string, string> = new Map();
