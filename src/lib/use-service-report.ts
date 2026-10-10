'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiClientServiceReport } from '@/lib/api/client';
import type { ServiceReportDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { serviceReportReason } from '@/lib/service-report';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

/**
 * Story 21-8 — one client's service report for the operator `/reports`
 * section, in the house `ResourceState & Reloadable` shape
 * (`use-client-usage.ts`): the tenant through `useSyncExternalStore`, a
 * fetch keyed on the tenant, the client, the period AND the warehouse with
 * `cancelled` in the cleanup, the other-scope result filtered at render, and
 * `reload()` (Refresh) clearing first. No polling — read again on Refresh.
 */
export function useServiceReport(
  clientId: string | null,
  period: { readonly from: string; readonly to: string } | null,
  warehouseId: string | null,
): ResourceState<ServiceReportDto> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const scope =
    tenantId === null || clientId === null || period === null
      ? null
      : `${tenantId}|${clientId}|${period.from}|${period.to}|${warehouseId ?? ''}`;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ scope: string; state: ResourceState<ServiceReportDto> } | null>(null);

  useEffect(() => {
    if (scope === null || tenantId === null || clientId === null || period === null) return;
    let cancelled = false;
    (async () => {
      try {
        const report = await fetchApiClientServiceReport(tenantId, clientId, { from: period.from, to: period.to, warehouseId });
        if (!cancelled) setResult({ scope, state: { state: 'ready', data: report } });
      } catch (error) {
        if (!cancelled) setResult({ scope, state: { state: 'failed', reason: serviceReportReason(error) } });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `scope` carries every input the fetch reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, revision]);

  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);
  const stale = scope === null || result === null || result.scope !== scope;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}
