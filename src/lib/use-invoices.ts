'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiGetInvoice, fetchApiListInvoices } from '@/lib/api/client';
import type { InvoiceDto, InvoiceEntryDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { INVOICES_CHANGED_EVENT, invoiceDetailReason, invoiceListReason } from '@/lib/invoices';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

/**
 * The /compliance Invoices section's reads (story 8-1), in the shape
 * `use-outbound-waves` established (frontend guide §1): session identity
 * through `useSyncExternalStore`, a `useEffect` fetch, stale results filtered
 * at render, an explicit `failed` arm, and a `reload()` that clears first.
 * Invoices are tenant-scoped (no warehouse filter), so the cursor is stamped
 * with the tenant alone.
 */

export interface InvoicesPage {
  items: readonly InvoiceEntryDto[];
  nextCursor: string | null;
}

/** One cursor page of the tenant's invoices, newest first. Open to any member. */
export function useInvoices(): ResourceState<InvoicesPage> & Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [requested, setRequested] = useState<{ tenantId: string; cursor: string | null } | null>(null);
  const activeCursor = requested !== null && requested.tenantId === tenantId ? requested.cursor : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    requested: string | null;
    state: ResourceState<InvoicesPage>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(INVOICES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(INVOICES_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListInvoices(tenantId, activeCursor === null ? undefined : { cursor: activeCursor });
        if (!cancelled) {
          setResult({
            tenantId,
            requested: activeCursor,
            state: { state: 'ready', data: { items: page.items, nextCursor: page.nextCursor ?? null } },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({ tenantId, requested: activeCursor, state: { state: 'failed', reason: invoiceListReason(error) } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null) return;
      setRequested({ tenantId, cursor });
    },
    [tenantId],
  );
  // Clear first, and restart from page one: a stale-cursor failure whose
  // Retry re-requested the same cursor would fail forever.
  const reload = useCallback(() => {
    setRequested(null);
    setResult(null);
    setRevision((r) => r + 1);
  }, []);

  const stale =
    tenantId === null || result === null || result.tenantId !== tenantId || result.requested !== activeCursor;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload };
}

/**
 * One invoice's detail (row + lines + document), or nothing while
 * `invoiceId` is null. Refetches on the module broadcaster, so a regenerate
 * from the pricing panel re-reads the document it just changed.
 */
export function useInvoiceDetail(invoiceId: string | null): ResourceState<InvoiceDto> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    invoiceId: string;
    revision: number;
    state: ResourceState<InvoiceDto>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(INVOICES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(INVOICES_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || invoiceId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const { invoice } = await fetchApiGetInvoice(tenantId, invoiceId);
        if (!cancelled) setResult({ tenantId, invoiceId, revision, state: { state: 'ready', data: invoice } });
      } catch (error) {
        if (!cancelled) {
          setResult({ tenantId, invoiceId, revision, state: { state: 'failed', reason: invoiceDetailReason(error) } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, invoiceId, revision]);

  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);

  // A result from a superseded revision stays on screen while the refetch is
  // in flight ONLY when it was a success (the document does not flash away
  // under the operator after a regenerate); a stale failure never lingers.
  const sameScope = tenantId !== null && invoiceId !== null && result !== null && result.tenantId === tenantId && result.invoiceId === invoiceId;
  const current = sameScope && (result.revision === revision || result.state.state === 'ready');
  return { ...(current ? result.state : ({ state: 'loading' } as const)), reload };
}
