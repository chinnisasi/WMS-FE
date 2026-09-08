'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiSetupChecklist } from '@/lib/api/client';
import type { SetupChecklistResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { WAREHOUSES_CHANGED_EVENT } from '@/lib/warehouses';
import { ZONES_CHANGED_EVENT } from '@/lib/zones';

/**
 * The setup checklist (Story 1.3), computed on read by the backend — this
 * hook refetches whenever anything it aggregates changes: a warehouse is
 * created (WAREHOUSES_CHANGED_EVENT) or zone/bin master data mutates
 * (ZONES_CHANGED_EVENT), plus session identity changes. Stale cross-tenant
 * pages are filtered at render time (result.tenantId), matching the
 * useTenantWarehouses convention of never calling setState in an effect.
 */
export function useSetupChecklist(): (SetupChecklistResponse & { tenantId: string }) | null {
  // `null` = unknown (server render) or signed out.
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<(SetupChecklistResponse & { tenantId: string }) | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(WAREHOUSES_CHANGED_EVENT, onChange);
    window.addEventListener(ZONES_CHANGED_EVENT, onChange);
    return () => {
      window.removeEventListener(WAREHOUSES_CHANGED_EVENT, onChange);
      window.removeEventListener(ZONES_CHANGED_EVENT, onChange);
    };
  }, []);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const checklist = await fetchApiSetupChecklist(tenantId);
        if (!cancelled) setPage({ ...checklist, tenantId });
      } catch {
        // A failed fetch leaves the previous page in state — the tenantId
        // check at render hides it; surfaces report API errors separately.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, revision]);

  if (tenantId === null || page === null || page.tenantId !== tenantId) return null;
  return page;
}