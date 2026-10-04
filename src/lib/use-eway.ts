'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListEwayBills, fetchApiListEwayGstinSettings, fetchApiListEwayStateThresholds } from '@/lib/api/client';
import type { EwayBillDto, EwayGstinSettingDto, EwayStateThresholdDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { EWAY_CHANGED_EVENT, ewayListReason, type EwayTab } from '@/lib/eway';
import { INVOICES_CHANGED_EVENT } from '@/lib/invoices';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

/**
 * The /compliance E-way bills section's reads (story 8-2b), in the
 * `use-invoices` shape (frontend guide §1): session identity through
 * `useSyncExternalStore`, a `useEffect` fetch, stale results filtered at
 * render, an explicit `failed` arm and a `reload()` that clears first. Every
 * read refetches on `EWAY_CHANGED_EVENT` (an e-way mutation) and on
 * `INVOICES_CHANGED_EVENT` (an issuance queues a bill shortly after).
 */

function useTenantId(): string | null {
  return useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
}

function useChangeRevision(): [number, (bump: (r: number) => number) => void] {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(EWAY_CHANGED_EVENT, onChange);
    window.addEventListener(INVOICES_CHANGED_EVENT, onChange);
    return () => {
      window.removeEventListener(EWAY_CHANGED_EVENT, onChange);
      window.removeEventListener(INVOICES_CHANGED_EVENT, onChange);
    };
  }, []);
  return [revision, setRevision];
}

export interface EwayBillsPage {
  items: readonly EwayBillDto[];
  nextCursor: string | null;
}

/** One cursor page of the bills in one status tab, optionally one GSTIN's. */
export function useEwayBills(
  tab: EwayTab,
  gstin: string | null,
): ResourceState<EwayBillsPage> & Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  const tenantId = useTenantId();
  // The cursor is stamped with the scope it was requested for: a cursor from
  // another tab or GSTIN filter is a first-page request, never replayed.
  const [requested, setRequested] = useState<{ tenantId: string; tab: EwayTab; gstin: string | null; cursor: string | null } | null>(null);
  const activeCursor =
    requested !== null && requested.tenantId === tenantId && requested.tab === tab && requested.gstin === gstin ? requested.cursor : null;
  const [revision, setRevision] = useChangeRevision();
  const [result, setResult] = useState<{
    tenantId: string;
    tab: EwayTab;
    gstin: string | null;
    requested: string | null;
    state: ResourceState<EwayBillsPage>;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListEwayBills(tenantId, {
          status: tab,
          ...(gstin === null ? {} : { gstin }),
          ...(activeCursor === null ? {} : { cursor: activeCursor }),
        });
        if (!cancelled) {
          setResult({ tenantId, tab, gstin, requested: activeCursor, state: { state: 'ready', data: { items: page.items, nextCursor: page.nextCursor ?? null } } });
        }
      } catch (error) {
        if (!cancelled) setResult({ tenantId, tab, gstin, requested: activeCursor, state: { state: 'failed', reason: ewayListReason(error) } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, tab, gstin, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null) return;
      setRequested({ tenantId, tab, gstin, cursor });
    },
    [tenantId, tab, gstin],
  );
  const reload = useCallback(() => {
    setRequested(null);
    setResult(null);
    setRevision((r) => r + 1);
  }, [setRevision]);

  const stale =
    tenantId === null ||
    result === null ||
    result.tenantId !== tenantId ||
    result.tab !== tab ||
    result.gstin !== gstin ||
    result.requested !== activeCursor;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload };
}

/** A whole-list read keyed on the tenant alone (the two settings lists). */
function useTenantList<T>(
  fetcher: (tenantId: string) => Promise<{ items: T[] }>,
): ResourceState<readonly T[]> & Reloadable {
  const tenantId = useTenantId();
  const [revision, setRevision] = useChangeRevision();
  const [result, setResult] = useState<{ tenantId: string; state: ResourceState<readonly T[]> } | null>(null);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const { items } = await fetcher(tenantId);
        if (!cancelled) setResult({ tenantId, state: { state: 'ready', data: items } });
      } catch (error) {
        if (!cancelled) setResult({ tenantId, state: { state: 'failed', reason: ewayListReason(error) } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, revision, fetcher]);

  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, [setRevision]);
  const stale = tenantId === null || result === null || result.tenantId !== tenantId;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}

/** The tenant's intra-state threshold overrides (append-only history). */
export function useEwayStateThresholds(): ResourceState<readonly EwayStateThresholdDto[]> & Reloadable {
  return useTenantList(fetchApiListEwayStateThresholds);
}

/** Every GSTIN the tenant holds, with its e-invoicing flag. */
export function useEwayGstinSettings(): ResourceState<readonly EwayGstinSettingDto[]> & Reloadable {
  return useTenantList(fetchApiListEwayGstinSettings);
}
