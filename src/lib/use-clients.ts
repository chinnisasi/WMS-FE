'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListClients } from '@/lib/api/client';
import type { ClientDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { CLIENTS_CHANGED_EVENT } from '@/lib/clients';
import { readReason } from '@/lib/outbound-orders';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

/**
 * Story 21-2b — the tenant's clients, in the house `ResourceState &
 * Reloadable` shape (the `use-segregation-matrix.ts` / `use-outbound-waves.ts`
 * pattern): session identity through `useSyncExternalStore`, a `useEffect`
 * fetch with `cancelled` in the cleanup, the stale (tenant-changed) result
 * filtered at render, and `reload()` clearing the result first so a Retry is
 * visibly in flight. Refetches on `CLIENTS_CHANGED_EVENT`.
 *
 * The list is unpaginated (the backend bounds it at 500) — one read is the
 * whole set the pickers and the client columns need.
 */
export function useClients(): ResourceState<readonly ClientDto[]> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    state: ResourceState<readonly ClientDto[]>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(CLIENTS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CLIENTS_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchApiListClients(tenantId);
        if (!cancelled) setResult({ tenantId, state: { state: 'ready', data: list.items } });
      } catch (error) {
        if (!cancelled) {
          setResult({ tenantId, state: { state: 'failed', reason: readReason(error, 'the clients') } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, revision]);

  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);
  const stale = tenantId === null || result === null || result.tenantId !== tenantId;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}

/** The ready list, or null while loading/failed — for surfaces that only decorate with it. */
export function readyClients(state: ResourceState<readonly ClientDto[]>): readonly ClientDto[] | null {
  return state.state === 'ready' ? state.data : null;
}
