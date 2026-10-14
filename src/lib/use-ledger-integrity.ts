'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiLedgerIntegrity } from '@/lib/api/client';
import type { LedgerIntegrityResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { integrityReason, isIntegrityRoleDenied } from '@/lib/ledger-integrity';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

/**
 * Story 9-3c — the tenant's ledger integrity status for the `/reports`
 * "Ledger integrity" section, in the house `ResourceState & Reloadable`
 * shape (the `useAuditExports` model). Unpaged — the backend bounds it by
 * the warehouse count. No polling: it re-reads on `reload()` — the Refresh
 * button, an acknowledgement, a `#ledger-integrity` hash change and the
 * bell's refresh event.
 *
 * `denied` is true when the read was refused `role-denied` (a demoted
 * owner): the section then hides.
 */
export function useLedgerIntegrity(): ResourceState<LedgerIntegrityResponse> & Reloadable & { denied: boolean } {
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
    state: ResourceState<LedgerIntegrityResponse>;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchApiLedgerIntegrity(tenantId);
        if (!cancelled) setResult({ tenantId, revision, denied: false, state: { state: 'ready', data } });
      } catch (error) {
        if (!cancelled) {
          setResult({ tenantId, revision, denied: isIntegrityRoleDenied(error), state: { state: 'failed', reason: integrityReason(error) } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, revision]);

  const reload = useCallback(() => setRevision((r) => r + 1), []);
  const stale = tenantId === null || result === null || result.tenantId !== tenantId || result.revision !== revision;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload, denied: !stale && result.denied };
}
