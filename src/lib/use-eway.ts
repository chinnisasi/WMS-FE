'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

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
 * read refetches at once on `EWAY_CHANGED_EVENT` (an e-way mutation).
 *
 * Story 8-1d: only the BILLS list also follows `INVOICES_CHANGED_EVENT`, and
 * not at once — an issuance queues its bill later, through the outbox relay,
 * so an immediate refetch missed it while one pricing action fired ~7
 * requests (the bills and both settings lists). The bills now re-read on a
 * trailing debounce (`EWAY_INVOICE_REFETCH_DELAYS_MS`), and the settings
 * lists, which an issuance never changes, ignore invoice events.
 */

/**
 * After the LAST invoice event in a burst, the bills list re-reads at about
 * 3 s (the relay's usual pickup) and again at about 10 s (a slower drain). A
 * new invoice event restarts the schedule; Refresh is always there too.
 */
export const EWAY_INVOICE_REFETCH_DELAYS_MS: readonly [number, number] = [3_000, 10_000];

function useTenantId(): string | null {
  return useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
}

/** The revision every e-way read bumps on an e-way mutation — at once. */
function useChangeRevision(): [number, (bump: (r: number) => number) => void] {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(EWAY_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(EWAY_CHANGED_EVENT, onChange);
  }, []);
  return [revision, setRevision];
}

/**
 * The bills-only invoice follow-up (story 8-1d): ONE trailing-debounce timer
 * per mounted list. Each `INVOICES_CHANGED_EVENT` clears it and schedules a
 * re-read at ~3 s, which schedules one more at ~10 s. The timer is cleared on
 * unmount and when the tenant changes (the effect re-runs on `tenantId`), so
 * a late tick never re-reads a scope the viewer has left.
 */
function useInvoiceFollowUp(tenantId: string | null, bump: (bump: (r: number) => number) => void): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (tenantId === null) return;
    const [first, second] = EWAY_INVOICE_REFETCH_DELAYS_MS;
    const clear = () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
    const onInvoices = () => {
      clear();
      timer.current = setTimeout(() => {
        bump((r) => r + 1);
        timer.current = setTimeout(() => {
          timer.current = null;
          bump((r) => r + 1);
        }, second - first);
      }, first);
    };
    window.addEventListener(INVOICES_CHANGED_EVENT, onInvoices);
    return () => {
      window.removeEventListener(INVOICES_CHANGED_EVENT, onInvoices);
      clear();
    };
  }, [tenantId, bump]);
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
  useInvoiceFollowUp(tenantId, setRevision);
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

/**
 * A whole-list read keyed on the tenant alone (the two settings lists). It
 * follows e-way mutations only: an invoice issuance never changes either.
 */
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
