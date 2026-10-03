'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiHsnSummary, fetchApiHsnSummaryGstins } from '@/lib/api/client';
import type { HsnSummaryDto, HsnSummaryGstinDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { hsnSummaryReason } from '@/lib/hsn-summary';
import { INVOICES_CHANGED_EVENT } from '@/lib/invoices';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

/**
 * The /compliance HSN summary's reads (story 8-2a), in the house loader
 * shape (frontend guide §1): tenant through `useSyncExternalStore`, a
 * `useEffect` fetch, the stale filter at render, an explicit `failed` arm,
 * and a `reload()` that clears first. Both refetch on the invoices module
 * broadcaster — a generate can issue a new invoice into the period on screen.
 */

function useTenantId(): string | null {
  return useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
}

function useInvoicesRevision(): [number, () => void] {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(INVOICES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(INVOICES_CHANGED_EVENT, onChange);
  }, []);
  return [revision, useCallback(() => setRevision((r) => r + 1), [])];
}

/** Every supplier GSTIN with issued invoices (the GSTIN picker and its period range). */
export function useHsnSummaryGstins(): ResourceState<readonly HsnSummaryGstinDto[]> & Reloadable {
  const tenantId = useTenantId();
  const [revision, bump] = useInvoicesRevision();
  const [result, setResult] = useState<{ tenantId: string; state: ResourceState<readonly HsnSummaryGstinDto[]> } | null>(null);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const { items } = await fetchApiHsnSummaryGstins(tenantId);
        if (!cancelled) setResult({ tenantId, state: { state: 'ready', data: items } });
      } catch (error) {
        if (!cancelled) setResult({ tenantId, state: { state: 'failed', reason: hsnSummaryReason(error) } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, revision]);

  const reload = useCallback(() => {
    setResult(null);
    bump();
  }, [bump]);

  const stale = tenantId === null || result === null || result.tenantId !== tenantId;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}

/** One GSTIN's summary for one period; idle (loading) while either is unchosen. */
export function useHsnSummary(gstin: string | null, period: string | null): ResourceState<HsnSummaryDto> & Reloadable {
  const tenantId = useTenantId();
  const [revision, bump] = useInvoicesRevision();
  const [result, setResult] = useState<{
    tenantId: string;
    gstin: string;
    period: string;
    state: ResourceState<HsnSummaryDto>;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null || gstin === null || period === null) return;
    let cancelled = false;
    (async () => {
      try {
        const { summary } = await fetchApiHsnSummary(tenantId, { gstin, period });
        if (!cancelled) setResult({ tenantId, gstin, period, state: { state: 'ready', data: summary } });
      } catch (error) {
        if (!cancelled) setResult({ tenantId, gstin, period, state: { state: 'failed', reason: hsnSummaryReason(error) } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, gstin, period, revision]);

  const reload = useCallback(() => {
    setResult(null);
    bump();
  }, [bump]);

  const stale =
    tenantId === null ||
    gstin === null ||
    period === null ||
    result === null ||
    result.tenantId !== tenantId ||
    result.gstin !== gstin ||
    result.period !== period;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}
