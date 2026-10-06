'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiClientUsage } from '@/lib/api/client';
import type { ClientUsageResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { RATE_CARDS_CHANGED_EVENT } from '@/lib/rate-cards';
import { usageReason } from '@/lib/usage';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

/**
 * Story 21-4 — one client's metered usage over an inclusive IST period, in
 * the house `ResourceState & Reloadable` shape (`use-rate-cards.ts`): the
 * tenant through `useSyncExternalStore`, a `useEffect` fetch keyed on the
 * tenant, the client AND the period with `cancelled` in the cleanup, the
 * stale (other-scope) result filtered at render, and `reload()` clearing
 * first. Refetches on `RATE_CARDS_CHANGED_EVENT` — a card activated or
 * cancelled re-prices the segments.
 */
export function useClientUsage(
  clientId: string | null,
  period: { readonly from: string; readonly to: string } | null,
): ResourceState<ClientUsageResponse> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const from = period?.from ?? null;
  const to = period?.to ?? null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    clientId: string;
    from: string;
    to: string;
    state: ResourceState<ClientUsageResponse>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(RATE_CARDS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(RATE_CARDS_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || clientId === null || from === null || to === null) return;
    let cancelled = false;
    (async () => {
      try {
        const usage = await fetchApiClientUsage(tenantId, clientId, { from, to });
        if (!cancelled) setResult({ tenantId, clientId, from, to, state: { state: 'ready', data: usage } });
      } catch (error) {
        if (!cancelled) setResult({ tenantId, clientId, from, to, state: { state: 'failed', reason: usageReason(error) } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, clientId, from, to, revision]);

  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);
  const stale =
    tenantId === null ||
    clientId === null ||
    from === null ||
    to === null ||
    result === null ||
    result.tenantId !== tenantId ||
    result.clientId !== clientId ||
    result.from !== from ||
    result.to !== to;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}
