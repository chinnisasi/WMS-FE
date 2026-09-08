'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListZones } from '@/lib/api/client';
import type { ZoneResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { fetchAllPages } from '@/lib/fetch-all-pages';
import { ZONES_CHANGED_EVENT } from '@/lib/zones';

/**
 * All zones of one warehouse (Story 1.3): the session *identity* drives the
 * tenant scoping, the generic cursor walker follows the full keyset chain,
 * and zone/bin mutations bump a revision so the effect re-runs. Stale
 * cross-tenant or cross-warehouse pages are filtered at render time —
 * the useTenantWarehouses convention (no synchronous setState in effects).
 */
export function useWarehouseZones(warehouseId: string | null): readonly ZoneResponse[] | null {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<{ tenantId: string; warehouseId: string; items: readonly ZoneResponse[] } | null>(
    null,
  );

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(ZONES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(ZONES_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || warehouseId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const items = await fetchAllPages<ZoneResponse>((options) =>
          fetchApiListZones(tenantId, warehouseId, options),
        );
        if (!cancelled) setPage({ tenantId, warehouseId, items });
      } catch {
        // A failed fetch leaves the previous page in state; the render-time
        // key check below hides it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, revision]);

  if (
    tenantId === null ||
    warehouseId === null ||
    page === null ||
    page.tenantId !== tenantId ||
    page.warehouseId !== warehouseId
  ) {
    return null;
  }
  return page.items;
}