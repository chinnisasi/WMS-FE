'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiReportingOverview } from '@/lib/api/client';
import type { ReportingOverviewResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { readReason } from '@/lib/outbound-orders';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

/**
 * Story 9-1 — the Overview read for one warehouse, in the house loader shape
 * (FE IMPLEMENTATION-GUIDE §1): session identity through the external store,
 * an effect fetch with a `cancelled` cleanup, and the stale-scope filter at
 * render.
 *
 * It reloads ONLY on a warehouse (or tenant) switch and on `reload()` — the
 * Refresh button. There is deliberately no window-event revision and no
 * interval: the dashboard never auto-refreshes (UX-DR19); the viewer is told
 * the figures are stale and refreshes by hand.
 */
export function useReportingOverview(
  warehouseId: string | null,
): ResourceState<ReportingOverviewResponse> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    warehouseId: string;
    revision: number;
    state: ResourceState<ReportingOverviewResponse>;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null || warehouseId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchApiReportingOverview(tenantId, warehouseId);
        if (!cancelled) setResult({ tenantId, warehouseId, revision, state: { state: 'ready', data } });
      } catch (error) {
        if (!cancelled) {
          setResult({
            tenantId,
            warehouseId,
            revision,
            state: { state: 'failed', reason: readReason(error, 'the overview') },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, revision]);

  // Clears first: a result stamped with an older revision reads as loading,
  // so a Refresh visibly starts over rather than leaving the old figures (or
  // an old failure) on screen as if nothing happened.
  const reload = useCallback(() => setRevision((r) => r + 1), []);
  const stale =
    tenantId === null ||
    warehouseId === null ||
    result === null ||
    result.tenantId !== tenantId ||
    result.warehouseId !== warehouseId ||
    result.revision !== revision;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}
