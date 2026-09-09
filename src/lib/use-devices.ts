'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListDevices } from '@/lib/api/client';
import type { DeviceResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';

export interface DevicesPage {
  items: readonly DeviceResponse[];
  /** Cursor for the DataTable's Next button; null on the last page. */
  nextCursor: string | null;
}

/**
 * One cursor-paginated page of the tenant's enrolled devices (Story 3.2),
 * wired to the DataTable's Prev/Next — the same external-store pattern as
 * use-users.ts. The device list is a read, open to every tenant member.
 */
export function useDevices(): (DevicesPage & {
  onCursor: (cursor: string | null) => void;
  reload: () => void;
}) | null {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [requested, setRequested] = useState<{ tenantId: string; cursor: string | null } | null>(null);
  const activeCursor =
    requested !== null && requested.tenantId === tenantId ? requested.cursor : null;
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<{
    tenantId: string;
    requested: string | null;
    page: DevicesPage;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchApiListDevices(
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