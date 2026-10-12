'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListPutawayTasks } from '@/lib/api/client';
import type { PutawayTaskDto } from '@/lib/api/generated';
import { INBOUND_CHANGED_EVENT } from '@/lib/asns';
import { readSession, subscribeSession } from '@/lib/auth';
import { readReason } from '@/lib/outbound-orders';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

/**
 * Story 9-1b — one warehouse's derived putaway tasks ("Awaiting putaway" on
 * /inbound): GRN lines whose applied stock still sits in the system
 * Receiving bin. Unpaged — the route returns `{items}` and takes the
 * warehouse alone, which is also all a putaway drill carries — so the
 * drilled and the normal reads are the same call, differing only in the
 * warehouse the caller passes (the drill's, or the active one).
 *
 * The house loader shape (frontend guide §1): an explicit `failed` arm and a
 * `reload()` that clears first; a result for another tenant or warehouse is
 * filtered at render, never by a setState in an effect.
 */
export function usePutawayTasks(
  warehouseId: string | null,
): ResourceState<readonly PutawayTaskDto[]> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    warehouseId: string;
    state: ResourceState<readonly PutawayTaskDto[]>;
  } | null>(null);

  // A receipt or ASN write on /inbound changes what awaits putaway.
  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(INBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(INBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || warehouseId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const { items } = await fetchApiListPutawayTasks(tenantId, warehouseId);
        if (!cancelled) setResult({ tenantId, warehouseId, state: { state: 'ready', data: items } });
      } catch (error) {
        if (!cancelled) {
          setResult({ tenantId, warehouseId, state: { state: 'failed', reason: readReason(error, 'the putaway tasks') } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, revision]);

  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);

  const stale =
    tenantId === null ||
    warehouseId === null ||
    result === null ||
    result.tenantId !== tenantId ||
    result.warehouseId !== warehouseId;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}
