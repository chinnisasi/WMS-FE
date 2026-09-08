'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListBins } from '@/lib/api/client';
import type { BinResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { ZONES_CHANGED_EVENT } from '@/lib/zones';

export interface ZoneBinsPage {
  items: readonly BinResponse[];
  /** Cursor for the DataTable's Next button; null on the last page. */
  nextCursor: string | null;
}

/**
 * One cursor-paginated page of a zone's bins, wired to the DataTable's
 * Prev/Next (cursor pagination — offset/infinite scroll banned). Mutations
 * (grid generate, manual bin, block toggle) bump the revision via
 * ZONES_CHANGED_EVENT or the returned `reload`, and the requested page is
 * refetched. Stale pages (zone switched mid-flight, tenant changed) are
 * filtered at render time — no synchronous setState in effects.
 */
export function useZoneBins(
  warehouseId: string | null,
  zoneId: string | null,
): (ZoneBinsPage & { onCursor: (cursor: string | null) => void; reload: () => void }) | null {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  // The cursor the viewer asked for; null = first page.
  const [requested, setRequested] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<{
    tenantId: string;
    warehouseId: string;
    zoneId: string;
    requested: string | null;
    page: ZoneBinsPage;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(ZONES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(ZONES_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || warehouseId === null || zoneId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchApiListBins(
          tenantId,
          warehouseId,
          zoneId,
          requested === null ? undefined : { cursor: requested },
        );
        if (!cancelled) {
          setPage({ tenantId, warehouseId, zoneId, requested, page: result });
        }
      } catch {
        // Quiet chrome on failure — the render-time key check hides stale data.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, zoneId, requested, revision]);

  const onCursor = useCallback((cursor: string | null) => setRequested(cursor), []);
  const reload = useCallback(() => setRevision((r) => r + 1), []);

  if (
    tenantId === null ||
    warehouseId === null ||
    zoneId === null ||
    page === null ||
    page.tenantId !== tenantId ||
    page.warehouseId !== warehouseId ||
    page.zoneId !== zoneId ||
    page.requested !== requested
  ) {
    return null;
  }
  return { ...page.page, onCursor, reload };
}