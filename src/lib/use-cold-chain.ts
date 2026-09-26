'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiGetOrderColdChainTrace } from '@/lib/api/client';
import type { ColdChainTraceResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { traceReason } from '@/lib/cold-chain';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

/**
 * One dispatched order's cold-chain trace (FR-45, story 12-6 read surfaced
 * by 12-7), in the `useWaveDetail` shape: fetched when its inputs exist
 * (`warehouseId` + `orderId` non-null), `ResourceState & Reloadable`, stale
 * results (warehouse or order switched mid-flight) filtered at render.
 *
 * The orderId's ULID shape check is the SURFACE's (it refuses inline without
 * spending the request); this hook fetches whatever non-null id it is given
 * and reports the backend's mapped refusal through its `failed` arm.
 */
export function useColdChainTrace(
  warehouseId: string | null,
  orderId: string | null,
): ResourceState<ColdChainTraceResponse> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    warehouseId: string;
    orderId: string;
    state: ResourceState<ColdChainTraceResponse>;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null || warehouseId === null || orderId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const trace = await fetchApiGetOrderColdChainTrace(tenantId, warehouseId, orderId);
        if (!cancelled) {
          setResult({ tenantId, warehouseId, orderId, state: { state: 'ready', data: trace } });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({
            tenantId,
            warehouseId,
            orderId,
            state: { state: 'failed', reason: traceReason(error) },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, orderId, revision]);

  // Clearing the result first is what makes Retry visible: leaving the old
  // `failed` state in place while the refetch is in flight renders a second
  // identical failure as an inert button.
  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);
  const stale =
    tenantId === null ||
    warehouseId === null ||
    orderId === null ||
    result === null ||
    result.tenantId !== tenantId ||
    result.warehouseId !== warehouseId ||
    result.orderId !== orderId;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}