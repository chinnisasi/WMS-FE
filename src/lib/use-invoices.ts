'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiGetInvoice, fetchApiListInvoices } from '@/lib/api/client';
import { CLIENT_PENDING, clientFilterForDrill, type ClientFilter } from '@/lib/active-client';
import { useClientEpoch } from '@/lib/use-client-epoch';
import { useKeyedDrill } from '@/lib/use-drill';
import type { InvoiceDto, InvoiceEntryDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { INVOICES_CHANGED_EVENT, invoiceDetailReason, invoiceListReason } from '@/lib/invoices';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';
import type { InvoicesDrill } from '@/lib/drill';
import { fetchInvoicesDrill } from '@/lib/drill-fetch';

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

/**
 * One cursor page of the tenant's invoices, newest first. Open to any member.
 *
 * Story 9-1b — given an Overview drill, the page is exactly the drill's rows
 * (its warehouse and issue window, sent verbatim); fixed for the hook's
 * lifetime (the screen remounts on a drill change).
 */
export function useInvoices(
  /** Story 1-5a — the active-client filter; a drill ignores it (decision 11). */
  clientFilter: ClientFilter,
  drillProp: InvoicesDrill | null = null,
): ResourceState<InvoicesPage> & Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  // Keyed on drillKey, not identity: an RSC refresh must not refetch.
  const drill = useKeyedDrill(drillProp);
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const effective = clientFilterForDrill(clientFilter, drill !== null);
  const pending = effective === CLIENT_PENDING;
  const clientId: string | null = effective === CLIENT_PENDING ? null : effective;
  const clientEpoch = useClientEpoch(clientId, pending);
  const [requested, setRequested] = useState<{ tenantId: string; clientId: string | null; clientEpoch: number; cursor: string | null } | null>(
    null,
  );
  const activeCursor =
    requested !== null && requested.tenantId === tenantId && requested.clientId === clientId && requested.clientEpoch === clientEpoch ? requested.cursor : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    clientId: string | null;
    requested: string | null;
    state: ResourceState<InvoicesPage>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(INVOICES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(INVOICES_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || pending) return;
    let cancelled = false;
    (async () => {
      try {
        const page =
          drill === null
            ? await fetchApiListInvoices(tenantId, {
                ...(clientId === null ? {} : { clientId }),
                ...(activeCursor === null ? {} : { cursor: activeCursor }),
              })
            : await fetchInvoicesDrill(tenantId, drill, activeCursor);
        if (!cancelled) {
          setResult({
            tenantId,
            clientId,
            requested: activeCursor,
            state: { state: 'ready', data: { items: page.items, nextCursor: page.nextCursor ?? null } },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({ tenantId, clientId, requested: activeCursor, state: { state: 'failed', reason: invoiceListReason(error) } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, clientId, pending, drill, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null) return;
      setRequested({ tenantId, clientId, clientEpoch, cursor });
    },
    [tenantId, clientId, clientEpoch],
  );
  // Clear first, and restart from page one: a stale-cursor failure whose
  // Retry re-requested the same cursor would fail forever.
  const reload = useCallback(() => {
    setRequested(null);
    setResult(null);
    setRevision((r) => r + 1);
  }, []);

  const stale =
    tenantId === null ||
    pending ||
    result === null ||
    result.tenantId !== tenantId ||
    result.clientId !== clientId ||
    result.requested !== activeCursor;

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
