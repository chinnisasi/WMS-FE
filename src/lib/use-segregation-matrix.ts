'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiGetSegregationMatrix } from '@/lib/api/client';
import type { SegregationMatrixResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { readReason } from '@/lib/outbound-orders';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

/**
 * The hazard segregation matrix read (story 12-7) — the ungated catalog read
 * that turns the server's own predicate into data, in the canonical
 * `ResourceState & Reloadable` shape (the `use-outbound-waves.ts` pattern):
 * session identity through `useSyncExternalStore`, a `useEffect` fetch, and
 * stale results (tenant changed mid-flight) filtered at render.
 *
 * The matrix is code on the backend and never changes mid-session — no
 * revision event rides this hook — but the read still carries its explicit
 * `failed` arm: a matrix card that silently renders an empty grid would read
 * as "everything is compatible".
 */
export function useSegregationMatrix(): ResourceState<SegregationMatrixResponse> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    state: ResourceState<SegregationMatrixResponse>;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const matrix = await fetchApiGetSegregationMatrix(tenantId);
        if (!cancelled) {
          setResult({ tenantId, state: { state: 'ready', data: matrix } });
        }
      } catch (error) {
        if (!cancelled) {
          // The house read mapper (the use-outbound-waves pattern): a failed
          // read is reported with a Retry, never swallowed into an empty grid.
          setResult({ tenantId, state: { state: 'failed', reason: readReason(error, 'the segregation matrix') } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, revision]);

  // Clearing the result first is what makes Retry visible: leaving the old
  // `failed` state in place while the refetch is in flight renders a second
  // identical failure as an inert button.
  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);
  const stale = tenantId === null || result === null || result.tenantId !== tenantId;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}