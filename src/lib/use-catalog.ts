'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListSkus } from '@/lib/api/client';
import type { SkuResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { CATALOG_CHANGED_EVENT } from '@/lib/catalog';

export interface SkusPage {
  items: readonly SkuResponse[];
  /** Cursor for the DataTable's Next button; null on the last page. */
  nextCursor: string | null;
}

/**
 * One cursor-paginated page of the tenant's SKUs, wired to the DataTable's
 * Prev/Next (keyset pagination — offset/infinite scroll banned). Mutations
 * (import, inline edit) bump the revision via CATALOG_CHANGED_EVENT or the
 * returned `reload`, and the requested page is refetched. Stale pages
 * (tenant changed) are filtered at render time — no synchronous setState in
 * effects, matching useZoneBins.
 */
export function useSkus(): (SkusPage & { onCursor: (cursor: string | null) => void; reload: () => void }) | null {
  // `null` = unknown (server render) or signed out.
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  // The cursor the viewer asked for, scoped to the tenant it was asked for —
  // a cursor left over from another tenant is treated as a first-page
  // request, never replayed against the wrong scope.
  const [requested, setRequested] = useState<{ tenantId: string; cursor: string | null } | null>(null);
  const activeCursor =
    requested !== null && requested.tenantId === tenantId ? requested.cursor : null;
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<{
    tenantId: string;
    requested: string | null;
    page: SkusPage;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(CATALOG_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CATALOG_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchApiListSkus(
          tenantId,
          activeCursor === null ? undefined : { cursor: activeCursor },
        );
        if (!cancelled) {
          setPage({ tenantId, requested: activeCursor, page: result });
        }
      } catch {
        // Quiet chrome on failure — the render-time key check hides stale data.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null) return;
      setRequested({ tenantId, cursor });
    },
    [tenantId],
  );
  const reload = useCallback(() => setRevision((r) => r + 1), []);

  if (
    tenantId === null ||
    page === null ||
    page.tenantId !== tenantId ||
    page.requested !== activeCursor
  ) {
    return null;
  }
  return { ...page.page, onCursor, reload };
}