'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiSecondFactorStatus } from '@/lib/api/client';
import type { SecondFactorStatusResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import type { Reloadable, ResourceState } from '@/lib/resource-state';
import { secondFactorReason } from '@/lib/second-factor';

/**
 * Story 6-1b — My account → Security: the caller's two-factor state
 * (`GET …/me/second-factor`). Keyed on the tenant; a result from another
 * tenant's read is filtered at render; `reload()` clears first.
 */
export function useSecondFactorStatus(): ResourceState<SecondFactorStatusResponse> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ tenantId: string; revision: number; state: ResourceState<SecondFactorStatusResponse> } | null>(
    null,
  );

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    void fetchApiSecondFactorStatus(tenantId).then(
      (data) => {
        if (!cancelled) setResult({ tenantId, revision, state: { state: 'ready', data } });
      },
      (error: unknown) => {
        if (!cancelled) setResult({ tenantId, revision, state: { state: 'failed', reason: secondFactorReason(error) } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [tenantId, revision]);

  const reload = () => setRevision((value) => value + 1);
  if (tenantId === null || result === null || result.tenantId !== tenantId || result.revision !== revision) {
    return { state: 'loading', reload };
  }
  return { ...result.state, reload };
}
