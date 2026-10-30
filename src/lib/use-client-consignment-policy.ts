'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiGetClientConsignmentPolicy } from '@/lib/api/client';
import type { ConsignmentPolicyResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { consignmentReason } from '@/lib/consignment';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

function useTenantId(): string | null {
  return useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
}

/**
 * Story 4-6a (A11) — one client's documents rule (Settings → Clients), in the
 * `useClientAllocationPolicy` shape: the result stamped with its (tenant,
 * client) scope and filtered at render; `reload()` clears first.
 */
export function useClientConsignmentPolicy(clientId: string): ResourceState<ConsignmentPolicyResponse> & Reloadable {
  const tenantId = useTenantId();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ tenantId: string; clientId: string; state: ResourceState<ConsignmentPolicyResponse> } | null>(null);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const policy = await fetchApiGetClientConsignmentPolicy(tenantId, clientId);
        if (!cancelled) setResult({ tenantId, clientId, state: { state: 'ready', data: policy } });
      } catch (error) {
        if (!cancelled) setResult({ tenantId, clientId, state: { state: 'failed', reason: consignmentReason(error) } });
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
