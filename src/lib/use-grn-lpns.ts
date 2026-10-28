'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListLpns } from '@/lib/api/client';
import type { LpnDto } from '@/lib/api/generated';
import { INBOUND_CHANGED_EVENT } from '@/lib/asns';
import { readSession, subscribeSession } from '@/lib/auth';
import { readReason } from '@/lib/outbound-orders';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

/**
 * Story 2-10b — one GRN's LPNs (licence plates) for the expandable GRN row (the
 * `useGateInDetail` shape: the scope stamped into the result and filtered at
 * render, `cancelled` in the cleanup, an inbound change refetching). `null`
 * reads nothing.
 */
export function useGrnLpns(grnId: string | null): ResourceState<readonly LpnDto[]> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    grnId: string;
    revision: number;
    state: ResourceState<readonly LpnDto[]>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(INBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(INBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || grnId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const { items } = await fetchApiListLpns(tenantId, grnId);
        if (!cancelled) setResult({ tenantId, grnId, revision, state: { state: 'ready', data: items } });
      } catch (error) {
        if (!cancelled) setResult({ tenantId, grnId, revision, state: { state: 'failed', reason: readReason(error, 'the receipt LPNs') } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, grnId, revision]);

  // An inbound change (a mint, a void) refetches QUIETLY — the last-good
  // list stays until the answer lands; Retry (`reload`) clears first.
  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);
  const stale = tenantId === null || grnId === null || result === null || result.tenantId !== tenantId || result.grnId !== grnId;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}
