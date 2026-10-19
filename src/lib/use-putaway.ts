'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { CLIENT_PENDING, type ClientFilter } from '@/lib/active-client';
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
  /** Story 1-5a — the screen's active-client filter (`useActiveClient().filter`); pending sends nothing. */
  clientFilter: ClientFilter,
): ResourceState<readonly PutawayTaskDto[]> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const pending = clientFilter === CLIENT_PENDING;
  const clientId: string | null = clientFilter === CLIENT_PENDING ? null : clientFilter;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    warehouseId: string;
    clientId: string | null;
    state: ResourceState<readonly PutawayTaskDto[]>;
  } | null>(null);

  // A receipt or ASN write on /inbound changes what awaits putaway.
  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(INBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(INBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || warehouseId === null || pending) return;
    let cancelled = false;
    (async () => {
      try {
        const { items } = await fetchApiListPutawayTasks(tenantId, warehouseId, clientId === null ? undefined : { clientId });
        if (!cancelled) setResult({ tenantId, warehouseId, clientId, state: { state: 'ready', data: items } });
      } catch (error) {
        if (!cancelled) {
          setResult({ tenantId, warehouseId, clientId, state: { state: 'failed', reason: readReason(error, 'the putaway tasks') } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, clientId, pending, revision]);

  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);

  const stale =
    tenantId === null ||
    warehouseId === null ||
    pending ||
    result === null ||
    result.tenantId !== tenantId ||
    result.warehouseId !== warehouseId ||
    result.clientId !== clientId;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}
