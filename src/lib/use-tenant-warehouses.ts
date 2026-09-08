'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListWarehouses } from '@/lib/api/client';
import type { WarehouseResponse } from '@/lib/api/generated';
import { fetchAllWarehouses } from '@/lib/fetch-all-warehouses';
import { readSession, subscribeSession } from '@/lib/auth';
import { WAREHOUSES_CHANGED_EVENT } from '@/lib/warehouses';

export interface TenantWarehouses {
  /** Non-null only while a session exists — the signed-in tenant. */
  tenantId: string;
  items: readonly WarehouseResponse[];
}

/**
 * Shared warehouse loader for every surface that shows the tenant's
 * warehouses (sidebar switcher, mobile switcher, the Settings list): the
 * session *identity* (tenant id) drives the fetch, the full keyset cursor
 * chain is followed (bounded 20 hops — review loop 1), and the
 * warehouses-changed event bumps a revision so the effect re-runs.
 *
 * Stale cross-tenant data is filtered at render time (`result.tenantId`
 * changes before the new page lands), matching the repo convention of never
 * calling setState synchronously in an effect.
 */
export function useTenantWarehouses(): TenantWarehouses | null {
  // `null` = unknown (server render) or signed out.
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  // Bumped by the warehouses-changed event (setState in a subscription
  // callback, never synchronously in an effect).
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<{ tenantId: string; items: readonly WarehouseResponse[] } | null>(
    null,
  );

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
        const items = await fetchAllWarehouses(tenantId, (id, options) =>
          fetchApiListWarehouses(id, options),
        );
        // A failed fetch leaves the previous tenant's page in state — the
        // tenantId check at render (not a setState-in-effect) hides it.
        if (!cancelled) setPage({ tenantId, items });
      } catch {
        // Consumers render quiet chrome on failure — surfaces report API errors.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, revision]);

  if (tenantId === null || page === null || page.tenantId !== tenantId) return null;
  return { tenantId, items: page.items };
}