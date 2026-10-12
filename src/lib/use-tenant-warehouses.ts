'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListWarehouses } from '@/lib/api/client';
import type { WarehouseResponse } from '@/lib/api/generated';
import { fetchAllWarehouses } from '@/lib/fetch-all-warehouses';
import { readSession, subscribeSession } from '@/lib/auth';
import { readReason } from '@/lib/outbound-orders';
import type { Reloadable, ResourceState } from '@/lib/resource-state';
import { WAREHOUSES_CHANGED_EVENT } from '@/lib/warehouses';

export interface TenantWarehouses {
  /** The signed-in tenant the list was read for. */
  readonly tenantId: string;
  readonly items: readonly WarehouseResponse[];
  /**
   * Decision 3 (21-11b): a REFETCH failed and `items` is the last-good list —
   * the reason, for the one-line `WarehousesRefreshNote`. Null after any
   * successful read.
   */
  readonly refreshFailed: string | null;
}

/**
 * The ONE warehouses hook (story 21-11b) for every surface that lists the
 * tenant's warehouses — the sidebar and mobile switchers, the Settings
 * cards, every warehouse picker. The session *identity* (tenant id) drives
 * the fetch, the full keyset cursor chain is followed (bounded 20 hops), and
 * the warehouses-changed event bumps a revision so the effect re-runs.
 *
 * It returns `ResourceState` with a `failed` arm: before 21-11b it swallowed
 * a failed read into `null`, and its consumers rendered a failure as "no
 * warehouses" (the switcher even said "No warehouse yet — create one in
 * Settings"). A failure renders through `WarehousesFailure`
 * (`components/shared/warehouses-failure.tsx`). `useOutboundWarehouses` is an
 * alias of this hook.
 *
 * A failed REFETCH (after `WAREHOUSES_CHANGED_EVENT`) keeps the last-good
 * list and is not silent (decision 3): the ready data carries
 * `refreshFailed: reason`, which consumers render as the one-line
 * `WarehousesRefreshNote`; the next successful read clears it. The state goes
 * to `failed` only when there is no data yet for this tenant. `reload()`
 * clears a `failed` state first, so Retry reads as loading rather than a
 * second identical failure.
 *
 * Stale cross-tenant data is filtered at render (`result.tenantId`), never by
 * a setState in an effect.
 */
export function useTenantWarehouses(): ResourceState<TenantWarehouses> & Reloadable {
  // `null` = unknown (server render) or signed out.
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  // Bumped by the warehouses-changed event and by reload() (setState in a
  // subscription callback, never synchronously in an effect).
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ tenantId: string; state: ResourceState<TenantWarehouses> } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(WAREHOUSES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(WAREHOUSES_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const items = await fetchAllWarehouses(tenantId, (id, options) => fetchApiListWarehouses(id, options));
        if (!cancelled) setResult({ tenantId, state: { state: 'ready', data: { tenantId, items, refreshFailed: null } } });
      } catch (error) {
        if (cancelled) return;
        const reason = readReason(error, 'warehouses');
        // Keep the last-good list for this tenant, flagged (decision 3); fail
        // only with no data yet.
        setResult((previous) =>
          previous !== null && previous.tenantId === tenantId && previous.state.state === 'ready'
            ? { tenantId, state: { state: 'ready', data: { ...previous.state.data, refreshFailed: reason } } }
            : { tenantId, state: { state: 'failed', reason } },
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, revision]);

  const reload = useCallback(() => {
    // Clear a failure first, so the refetch reads as loading, not as the
    // same failure again (IMPLEMENTATION-GUIDE §1).
    setResult((previous) => (previous !== null && previous.state.state === 'failed' ? null : previous));
    setRevision((r) => r + 1);
  }, []);

  const stale = tenantId === null || result === null || result.tenantId !== tenantId;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}
