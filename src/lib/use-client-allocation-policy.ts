'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiGetClientAllocationPolicy } from '@/lib/api/client';
import type { ClientAllocationPolicyResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { allocationPolicyReadReason } from '@/lib/allocation-policy';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

/**
 * Story 4-3a — one client's allocation policy plus its `untrackedSkuCount` and
 * `undatedBatchesOnHand` (the useClientReceivingPolicy shape),
 * in the house `ResourceState & Reloadable` shape (`use-client-contacts.ts`):
 * the tenant through the session subscription, a `cancelled` cleanup, the
 * result stamped with its (tenant, client) scope and filtered at render, and
 * `reload()` clearing the result first so a Retry is visibly in flight.
 */
export function useClientAllocationPolicy(clientId: string): ResourceState<ClientAllocationPolicyResponse> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    clientId: string;
    state: ResourceState<ClientAllocationPolicyResponse>;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const policy = await fetchApiGetClientAllocationPolicy(tenantId, clientId);
        if (!cancelled) setResult({ tenantId, clientId, state: { state: 'ready', data: policy } });
      } catch (error) {
        if (!cancelled) setResult({ tenantId, clientId, state: { state: 'failed', reason: allocationPolicyReadReason(error) } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, clientId, revision]);

  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);
  const stale = tenantId === null || result === null || result.tenantId !== tenantId || result.clientId !== clientId;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}
