'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiAuditExports } from '@/lib/api/client';
import type { AuditExportDto } from '@/lib/api/generated';
import { exportReason, isExportRoleDenied } from '@/lib/audit-exports';
import { readSession, subscribeSession } from '@/lib/auth';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

/**
 * Story 9-3b — the caller's own last 20 audit exports for the `/reports`
 * "Your exports" list, in the house `ResourceState & Reloadable` shape
 * (IMPLEMENTATION-GUIDE §1). Unpaged (the backend serves at most 20). No
 * polling: the list re-reads on `reload()` — the Refresh button, a posted
 * export, a refused download, and a `#audit-exports` hash change.
 *
 * `denied` is true when the read was refused `role-denied` (a demoted
 * owner): the export surface then hides rather than offering a button the
 * server will refuse.
 */
export function useAuditExports(): ResourceState<readonly AuditExportDto[]> & Reloadable & { denied: boolean } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    revision: number;
    denied: boolean;
    state: ResourceState<readonly AuditExportDto[]>;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiAuditExports(tenantId);
        if (!cancelled) setResult({ tenantId, revision, denied: false, state: { state: 'ready', data: page.items } });
      } catch (error) {
        if (!cancelled) {
          setResult({ tenantId, revision, denied: isExportRoleDenied(error), state: { state: 'failed', reason: exportReason(error) } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, revision]);

  // Clears first (the result is stamped with its revision, so a bumped
  // revision reads as loading at once): Retry and Refresh visibly re-read.
  const reload = useCallback(() => setRevision((r) => r + 1), []);
  const stale = tenantId === null || result === null || result.tenantId !== tenantId || result.revision !== revision;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload, denied: !stale && result.denied };
}
