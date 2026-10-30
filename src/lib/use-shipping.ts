'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  ApiProblem,
  fetchApiGetShipment,
  fetchApiHandover,
  fetchApiHandoverCandidates,
  fetchApiListHandovers,
  fetchApiOrderShipping,
} from '@/lib/api/client';
import type {
  HandoverCandidateDto,
  HandoverDetailDto,
  HandoverListItemDto,
  OrderShippingResponse,
  ShipmentDto,
} from '@/lib/api/generated';
import { CLIENT_PENDING, type ClientFilter } from '@/lib/active-client';
import { readSession, subscribeSession } from '@/lib/auth';
import { OUTBOUND_CHANGED_EVENT } from '@/lib/outbound';
import { readReason } from '@/lib/outbound-orders';
import type { ResourceState, Reloadable } from '@/lib/resource-state';
import { MAX_HANDOVER_CANDIDATES, shippingReason } from '@/lib/shipping';
import { useClientEpoch } from '@/lib/use-client-epoch';

/**
 * Story 4-4a — the client-arranged shipping reads (A16), in the canonical
 * hook shape (`use-outbound-labels.ts`): the tenant through
 * `useSyncExternalStore`, a revision bumped by OUTBOUND_CHANGED_EVENT, the
 * scope stamped on every result and stale results filtered at render. The
 * mutations live in the components, where the key's lifetime is the intent.
 */

function useTenantId(): string | null {
  return useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
}

function useOutboundRevision(): [number, () => void] {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(OUTBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(OUTBOUND_CHANGED_EVENT, onChange);
  }, []);
  return [revision, useCallback(() => setRevision((r) => r + 1), [])];
}

/**
 * One order's shipping (the Shipping panel). A 404 reads as `null` (guide
 * §1.13: the panel is an additive section whose parent detail owns the
 * order's 404, and an older API has no route); `refresh()` refetches quietly
 * (a presigned URL expired) without blanking the panel.
 */
export function useOrderShipping(
  orderId: string | null,
): ResourceState<OrderShippingResponse | null> & Reloadable & { refresh: () => Promise<void> } {
  const tenantId = useTenantId();
  const [revision, bump] = useOutboundRevision();
  const [result, setResult] = useState<{ tenantId: string; orderId: string; state: ResourceState<OrderShippingResponse | null> } | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (t: string, o: string, isCurrent: () => boolean) => {
    try {
      const data = await fetchApiOrderShipping(t, o);
      if (isCurrent()) setResult({ tenantId: t, orderId: o, state: { state: 'ready', data } });
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof ApiProblem && error.status === 404) {
        setResult({ tenantId: t, orderId: o, state: { state: 'ready', data: null } });
        return;
      }
      setResult({ tenantId: t, orderId: o, state: { state: 'failed', reason: shippingReason(error, 'read') } });
    }
  }, []);

  useEffect(() => {
    if (tenantId === null || orderId === null) return;
    let cancelled = false;
    const mine = ++seq.current;
    void load(tenantId, orderId, () => !cancelled && mine === seq.current);
    return () => {
      cancelled = true;
    };
  }, [tenantId, orderId, revision, load]);

  const reload = useCallback(() => {
    setResult(null);
    bump();
  }, [bump]);
  const refresh = useCallback(async () => {
    if (tenantId === null || orderId === null) return;
    const mine = ++seq.current;
    try {
      const data = await fetchApiOrderShipping(tenantId, orderId);
      if (mine === seq.current) setResult({ tenantId, orderId, state: { state: 'ready', data } });
    } catch {
      // A failed quiet refresh keeps the last-good record (guide §1.3).
    }
  }, [tenantId, orderId]);

  const stale = tenantId === null || orderId === null || result === null || result.tenantId !== tenantId || result.orderId !== orderId;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload, refresh };
}

/**
 * The live shipment of each given order (4.6c's per-order read, which since
 * 4-4a carries `kind` and `labelVerifiedAt`) — the pipeline page's Shipping
 * cell and the manifest builder read the same map. A 404 is "none"; a real
 * failure fails the whole arm (a terminal manifest built from a part-read
 * page would silently omit shipments).
 */
export function useOrderShipments(
  tenantId: string,
  orderIds: readonly string[],
): (
  | { state: 'loading' }
  | { state: 'ready'; data: ReadonlyMap<string, ShipmentDto | null> }
  | { state: 'failed'; reason: string }
) & { reload: () => void } {
  const [revision, bump] = useOutboundRevision();
  const [result, setResult] = useState<{
    orderKey: string;
    state: { state: 'ready'; data: ReadonlyMap<string, ShipmentDto | null> } | { state: 'failed'; reason: string };
  } | null>(null);
  const orderKey = `${tenantId}|${orderIds.join(',')}`;

  useEffect(() => {
    if (orderIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const settled = await Promise.allSettled(
        orderIds.map(async (orderId) => {
          const response = await fetchApiGetShipment(tenantId, orderId);
          return [orderId, response === null ? null : response.shipment] as const;
        }),
      );
      if (cancelled) return;
      const failure = settled.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected');
      if (failure !== undefined) {
        setResult({ orderKey, state: { state: 'failed', reason: readReason(failure.reason, 'the shipments') } });
        return;
      }
      const map = new Map<string, ShipmentDto | null>();
      for (const entry of settled) if (entry.status === 'fulfilled') map.set(entry.value[0], entry.value[1]);
      setResult({ orderKey, state: { state: 'ready', data: map } });
    })();
    return () => {
      cancelled = true;
    };
    // `orderIds` enters through `orderKey` — the array's identity churns every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey, revision]);

  if (orderIds.length === 0) return { state: 'ready', data: new Map(), reload: bump };
  if (result === null || result.orderKey !== orderKey) return { state: 'loading', reload: bump };
  return { ...result.state, reload: bump };
}

export interface HandoverCandidates {
  readonly items: readonly HandoverCandidateDto[];
  /** More than `MAX_HANDOVER_CANDIDATES` wait — the builder says so (A49). */
  readonly truncated: boolean;
}

/**
 * The builder's candidates for one client (A49): the whole chain, walked to
 * the end (≤ 500) BEFORE scanning starts, so a scan never misses a row on a
 * later page. Not refetched on the outbound broadcast while the drawer is
 * open (a refetch under a draft would reorder its rows) — `reload()` does.
 */
export function useHandoverCandidates(
  warehouseId: string | null,
  clientId: string | null,
): ResourceState<HandoverCandidates> & Reloadable {
  const tenantId = useTenantId();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; state: ResourceState<HandoverCandidates> } | null>(null);
  const key = `${tenantId}|${warehouseId}|${clientId}|${revision}`;

  useEffect(() => {
    if (tenantId === null || warehouseId === null || clientId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const items: HandoverCandidateDto[] = [];
        let cursor: string | null = null;
        let truncated = false;
        for (;;) {
          const page = await fetchApiHandoverCandidates(tenantId, warehouseId, clientId, cursor === null ? { limit: 200 } : { cursor, limit: 200 });
          items.push(...page.items);
          cursor = page.nextCursor;
          if (cursor === null) break;
          if (items.length >= MAX_HANDOVER_CANDIDATES) {
            truncated = true;
            break;
          }
        }
        if (!cancelled) {
          setResult({ key, state: { state: 'ready', data: { items: items.slice(0, MAX_HANDOVER_CANDIDATES), truncated: truncated || items.length > MAX_HANDOVER_CANDIDATES } } });
        }
      } catch (error) {
        if (!cancelled) setResult({ key, state: { state: 'failed', reason: readReason(error, 'the parcels awaiting pickup') } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, clientId, key]);

  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);
  const stale = tenantId === null || warehouseId === null || clientId === null || result === null || result.key !== key;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}

export interface HandoversPage {
  readonly items: readonly HandoverListItemDto[];
  readonly nextCursor: string | null;
}

/** One keyset page of the warehouse's handovers, newest first — the Handovers tab (filtered by the active client). */
export function useHandovers(
  warehouseId: string | null,
  clientFilter: ClientFilter,
): ResourceState<HandoversPage> & Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  const tenantId = useTenantId();
  const pending = clientFilter === CLIENT_PENDING;
  const clientId: string | null = clientFilter === CLIENT_PENDING ? null : clientFilter;
  const clientEpoch = useClientEpoch(clientId, pending);
  const [requested, setRequested] = useState<{ scope: string; cursor: string | null } | null>(null);
  const scope = `${tenantId}|${warehouseId}|${clientId}|${clientEpoch}`;
  const activeCursor = requested !== null && requested.scope === scope ? requested.cursor : null;
  const [revision, bump] = useOutboundRevision();
  const [result, setResult] = useState<{ scope: string; requested: string | null; state: ResourceState<HandoversPage> } | null>(null);

  useEffect(() => {
    if (tenantId === null || warehouseId === null || pending) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListHandovers(tenantId, warehouseId, {
          ...(clientId === null ? {} : { clientId }),
          ...(activeCursor === null ? {} : { cursor: activeCursor }),
        });
        if (!cancelled) setResult({ scope, requested: activeCursor, state: { state: 'ready', data: { items: page.items, nextCursor: page.nextCursor ?? null } } });
      } catch (error) {
        if (!cancelled) setResult({ scope, requested: activeCursor, state: { state: 'failed', reason: readReason(error, 'handovers') } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, clientId, pending, activeCursor, revision, scope]);

  const onCursor = useCallback((cursor: string | null) => setRequested({ scope, cursor }), [scope]);
  const reload = useCallback(() => {
    setResult(null);
    setRequested(null);
    bump();
  }, [bump]);
  const stale = tenantId === null || warehouseId === null || pending || result === null || result.scope !== scope || result.requested !== activeCursor;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload };
}

/** One handover's detail (the sheet), refetched on the outbound broadcast; `refresh()` is quiet. */
export function useHandoverDetail(
  handoverId: string | null,
): ResourceState<HandoverDetailDto> & Reloadable & { refresh: () => Promise<void> } {
  const tenantId = useTenantId();
  const [revision, bump] = useOutboundRevision();
  const [result, setResult] = useState<{ key: string; state: ResourceState<HandoverDetailDto> } | null>(null);
  const key = `${tenantId}|${handoverId}`;
  const seq = useRef(0);

  useEffect(() => {
    if (tenantId === null || handoverId === null) return;
    let cancelled = false;
    const mine = ++seq.current;
    (async () => {
      try {
        const { handover } = await fetchApiHandover(tenantId, handoverId);
        if (!cancelled && mine === seq.current) setResult({ key, state: { state: 'ready', data: handover } });
      } catch (error) {
        if (!cancelled && mine === seq.current) setResult({ key, state: { state: 'failed', reason: shippingReason(error, 'read') } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, handoverId, key, revision]);

  const reload = useCallback(() => {
    setResult(null);
    bump();
  }, [bump]);
  const refresh = useCallback(async () => {
    if (tenantId === null || handoverId === null) return;
    const mine = ++seq.current;
    try {
      const { handover } = await fetchApiHandover(tenantId, handoverId);
      if (mine === seq.current) setResult({ key: `${tenantId}|${handoverId}`, state: { state: 'ready', data: handover } });
    } catch {
      // Keep the last-good sheet.
    }
  }, [tenantId, handoverId]);
  const stale = tenantId === null || handoverId === null || result === null || result.key !== key;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload, refresh };
}
