'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  ApiProblem,
  fetchApiConsignmentWorklist,
  fetchApiOrderConsignment,
} from '@/lib/api/client';
import type { ConsignmentWorklistResponse, OrderConsignmentResponse } from '@/lib/api/generated';
import { CLIENT_PENDING, type ClientFilter } from '@/lib/active-client';
import { readSession, subscribeSession } from '@/lib/auth';
import { consignmentReason } from '@/lib/consignment';
import { OUTBOUND_CHANGED_EVENT } from '@/lib/outbound';
import type { ResourceState, Reloadable } from '@/lib/resource-state';
import { useClientEpoch } from '@/lib/use-client-epoch';

/**
 * Story 4-6a — the consignment reads (A16), in the house hook shape
 * (`use-shipping.ts`): the tenant through `useSyncExternalStore`, a revision
 * bumped by OUTBOUND_CHANGED_EVENT (a record, a withdraw, a dispatch and a
 * cancel all broadcast it), the scope stamped on every result and stale
 * results filtered at render. The mutations live in the components.
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
 * One order's consignment (the Tax documents panel). A 404 reads as `null`
 * (guide §1.13: an additive section whose parent detail owns the order's
 * 404, and an older API has no route). A refetch on the outbound broadcast
 * keeps the last-good data on screen (a record just saved must not blank the
 * panel behind its banner); Retry clears first.
 */
export function useOrderConsignment(
  orderId: string | null,
): ResourceState<OrderConsignmentResponse | null> & Reloadable & { readonly refresh: () => void } {
  const tenantId = useTenantId();
  const [revision, bump] = useOutboundRevision();
  const [result, setResult] = useState<{ tenantId: string; orderId: string; state: ResourceState<OrderConsignmentResponse | null> } | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (tenantId === null || orderId === null) return;
    let cancelled = false;
    const mine = ++seq.current;
    const current = () => !cancelled && mine === seq.current;
    (async () => {
      try {
        const data = await fetchApiOrderConsignment(tenantId, orderId);
        if (current()) setResult({ tenantId, orderId, state: { state: 'ready', data } });
      } catch (error) {
        if (!current()) return;
        if (error instanceof ApiProblem && error.status === 404) {
          setResult({ tenantId, orderId, state: { state: 'ready', data: null } });
          return;
        }
        const failed = { state: 'failed', reason: consignmentReason(error) } as const;
        // A failed REFETCH keeps the last-good record; only a first load fails.
        setResult((prev) =>
          prev !== null && prev.tenantId === tenantId && prev.orderId === orderId && prev.state.state === 'ready' ? prev : { tenantId, orderId, state: failed },
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, orderId, revision]);

  const reload = useCallback(() => {
    setResult(null);
    bump();
  }, [bump]);
  // A quiet refetch: the last-good read stays on screen (and a mounted form with its refusal) until the answer lands.
  const refresh = bump;
  const stale = tenantId === null || orderId === null || result === null || result.tenantId !== tenantId || result.orderId !== orderId;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload, refresh };
}

export type ConsignmentWorklistView = 'needed' | 'exceptions';

/**
 * The warehouse's Documents worklist (A16, A43): one bounded read per view,
 * filtered by the shell's client switcher (1-5a; `clientId` sent only when
 * set, the epoch in every stamp).
 */
export function useConsignmentWorklist(
  warehouseId: string | null,
  clientFilter: ClientFilter,
  view: ConsignmentWorklistView,
): ResourceState<ConsignmentWorklistResponse> & Reloadable {
  const tenantId = useTenantId();
  const pending = clientFilter === CLIENT_PENDING;
  const clientId: string | null = clientFilter === CLIENT_PENDING ? null : clientFilter;
  const clientEpoch = useClientEpoch(clientId, pending);
  const scope = `${tenantId}|${warehouseId}|${clientId}|${clientEpoch}|${view}`;
  const [revision, bump] = useOutboundRevision();
  const [result, setResult] = useState<{ scope: string; state: ResourceState<ConsignmentWorklistResponse> } | null>(null);

  useEffect(() => {
    if (tenantId === null || warehouseId === null || pending) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchApiConsignmentWorklist(tenantId, warehouseId, {
          ...(clientId === null ? {} : { clientId }),
          ...(view === 'needed' ? {} : { view }),
        });
        if (!cancelled) setResult({ scope, state: { state: 'ready', data } });
      } catch (error) {
        if (!cancelled) setResult({ scope, state: { state: 'failed', reason: consignmentReason(error) } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, clientId, pending, view, revision, scope]);

  const reload = useCallback(() => {
    setResult(null);
    bump();
  }, [bump]);
  const stale = tenantId === null || warehouseId === null || pending || result === null || result.scope !== scope;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}
