'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiGetClientInvoice, fetchApiListClientInvoices } from '@/lib/api/client';
import type { ClientInvoiceDto, ClientInvoiceEntryDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { CLIENT_INVOICES_CHANGED_EVENT, clientInvoiceReadReason } from '@/lib/client-invoices';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

/**
 * Story 21-5 — the client invoices reads, in the house shape (frontend guide
 * §1, `use-invoices.ts`): session identity through `useSyncExternalStore`, a
 * `useEffect` fetch with `cancelled` in the cleanup, the cursor stamped with
 * the scope it was requested for (tenant + client filter), stale results
 * filtered at render, an explicit `failed` arm, and `reload()` clearing first.
 * Both refetch on `CLIENT_INVOICES_CHANGED_EVENT`.
 */

export interface ClientInvoicesPage {
  readonly items: readonly ClientInvoiceEntryDto[];
  readonly nextCursor: string | null;
}

/**
 * One cursor page of the tenant's client invoices, newest first — every
 * client's, or one client's (`clientId`). `limit` is the page size (the
 * usage preview asks for a whole client's recent set at 100).
 */
export function useClientInvoices(
  clientId: string | null = null,
  limit?: number,
): ResourceState<ClientInvoicesPage> & Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const scope = `${tenantId ?? ''}|${clientId ?? ''}`;
  const [requested, setRequested] = useState<{ scope: string; cursor: string | null } | null>(null);
  const activeCursor = requested !== null && requested.scope === scope ? requested.cursor : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ scope: string; requested: string | null; state: ResourceState<ClientInvoicesPage> } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(CLIENT_INVOICES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CLIENT_INVOICES_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListClientInvoices(tenantId, {
          ...(clientId === null ? {} : { clientId }),
          ...(activeCursor === null ? {} : { cursor: activeCursor }),
          ...(limit === undefined ? {} : { limit }),
        });
        if (!cancelled) {
          setResult({ scope, requested: activeCursor, state: { state: 'ready', data: { items: page.items, nextCursor: page.nextCursor ?? null } } });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({ scope, requested: activeCursor, state: { state: 'failed', reason: clientInvoiceReadReason(error, 'list') } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, clientId, scope, activeCursor, limit, revision]);

  const onCursor = useCallback((cursor: string | null) => setRequested({ scope, cursor }), [scope]);
  const reload = useCallback(() => {
    setRequested(null);
    setResult(null);
    setRevision((r) => r + 1);
  }, []);

  const stale = tenantId === null || result === null || result.scope !== scope || result.requested !== activeCursor;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload };
}

/** One client invoice's detail, or nothing while `invoiceId` is null. */
export function useClientInvoiceDetail(invoiceId: string | null): ResourceState<ClientInvoiceDto> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ tenantId: string; invoiceId: string; revision: number; state: ResourceState<ClientInvoiceDto> } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(CLIENT_INVOICES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CLIENT_INVOICES_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || invoiceId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const { invoice } = await fetchApiGetClientInvoice(tenantId, invoiceId);
        if (!cancelled) setResult({ tenantId, invoiceId, revision, state: { state: 'ready', data: invoice } });
      } catch (error) {
        if (!cancelled) setResult({ tenantId, invoiceId, revision, state: { state: 'failed', reason: clientInvoiceReadReason(error, 'detail') } });
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

  // A superseded SUCCESS stays on screen while its refetch is in flight (the
  // document does not flash away after an action); a stale failure never lingers.
  const sameScope = tenantId !== null && invoiceId !== null && result !== null && result.tenantId === tenantId && result.invoiceId === invoiceId;
  const current = sameScope && (result.revision === revision || result.state.state === 'ready');
  return { ...(current ? result.state : ({ state: 'loading' } as const)), reload };
}
