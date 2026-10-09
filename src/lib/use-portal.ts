'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import {
  fetchApiPortalAsn,
  fetchApiPortalAsns,
  fetchApiPortalInvoice,
  fetchApiPortalInvoices,
  fetchApiPortalOrder,
  fetchApiPortalOrders,
  fetchApiPortalPurchaseOrder,
  fetchApiPortalPurchaseOrders,
  fetchApiPortalStock,
} from '@/lib/api/client';
import type {
  PortalAsnDetailResponse,
  PortalAsnRowDto,
  PortalInvoiceDetailResponse,
  PortalInvoiceRowDto,
  PortalOrderDetailResponse,
  PortalOrderRowDto,
  PortalPurchaseOrderDetailResponse,
  PortalPurchaseOrderRowDto,
  PortalStockRowDto,
} from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { portalReadReason } from '@/lib/portal';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

/**
 * Story 21-7 — the client portal's loaders, in the house shape
 * (IMPLEMENTATION-GUIDE §1): session identity through the external store
 * (server snapshot null), the requested cursor STAMPED with the scope it
 * was requested for, a `cancelled` flag in the effect cleanup, the stale
 * result filtered at render (never a setState in an effect), and a
 * `reload()` that clears the result first so a Retry is visibly in flight.
 * Portal reads take no warehouse — the scope is the tenant (the session's
 * client is the server's to apply) plus the list's own filter.
 */

export interface PortalPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

function useTenantId(): string | null {
  return useSyncExternalStore(subscribeSession, () => readSession()?.tenant.id ?? null, () => null);
}

function usePortalList<T>(
  scope: string,
  subject: string,
  fetchPage: (tenantId: string, cursor: string | null) => Promise<PortalPage<T>>,
): ResourceState<PortalPage<T>> & Reloadable & { onCursor: (cursor: string | null) => void } {
  const tenantId = useTenantId();
  const [requested, setRequested] = useState<{ tenantId: string | null; scope: string; cursor: string | null } | null>(null);
  const activeCursor =
    requested !== null && requested.tenantId === tenantId && requested.scope === scope ? requested.cursor : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    scope: string;
    requested: string | null;
    state: ResourceState<PortalPage<T>>;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchPage(tenantId, activeCursor);
        if (!cancelled) {
          setResult({ tenantId, scope, requested: activeCursor, state: { state: 'ready', data: { items: page.items, nextCursor: page.nextCursor ?? null } } });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({ tenantId, scope, requested: activeCursor, state: { state: 'failed', reason: portalReadReason(error, subject) } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // `fetchPage` is keyed by `scope` — the caller's filter — on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, scope, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => setRequested({ tenantId, scope, cursor }),
    [tenantId, scope],
  );
  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);
  const stale =
    tenantId === null || result === null || result.tenantId !== tenantId || result.scope !== scope || result.requested !== activeCursor;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload };
}

function usePortalDetail<T>(
  id: string | null,
  subject: string,
  fetchOne: (tenantId: string, id: string) => Promise<T>,
): ResourceState<T> & Reloadable {
  const tenantId = useTenantId();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ tenantId: string; id: string; state: ResourceState<T> } | null>(null);

  useEffect(() => {
    if (tenantId === null || id === null) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchOne(tenantId, id);
        if (!cancelled) setResult({ tenantId, id, state: { state: 'ready', data } });
      } catch (error) {
        if (!cancelled) setResult({ tenantId, id, state: { state: 'failed', reason: portalReadReason(error, subject) } });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, id, revision]);

  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);
  const stale = tenantId === null || id === null || result === null || result.tenantId !== tenantId || result.id !== id;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}

const cursorOption = (cursor: string | null) => (cursor === null ? {} : { cursor });

export function usePortalStock() {
  return usePortalList<PortalStockRowDto>('stock', 'your stock', (tenantId, cursor) =>
    fetchApiPortalStock(tenantId, cursorOption(cursor)),
  );
}

export function usePortalOrders(status: PortalOrderRowDto['status'] | null) {
  return usePortalList<PortalOrderRowDto>(`orders:${status ?? ''}`, 'your orders', (tenantId, cursor) =>
    fetchApiPortalOrders(tenantId, { ...cursorOption(cursor), ...(status === null ? {} : { status }) }),
  );
}

export function usePortalOrder(orderId: string | null): ResourceState<PortalOrderDetailResponse> & Reloadable {
  return usePortalDetail(orderId, 'This order', fetchApiPortalOrder);
}

export function usePortalAsns() {
  return usePortalList<PortalAsnRowDto>('asns', 'your shipment notices', (tenantId, cursor) =>
    fetchApiPortalAsns(tenantId, cursorOption(cursor)),
  );
}

export function usePortalAsn(asnId: string | null): ResourceState<PortalAsnDetailResponse> & Reloadable {
  return usePortalDetail(asnId, 'This shipment notice', fetchApiPortalAsn);
}

export function usePortalPurchaseOrders() {
  return usePortalList<PortalPurchaseOrderRowDto>('pos', 'your purchase orders', (tenantId, cursor) =>
    fetchApiPortalPurchaseOrders(tenantId, cursorOption(cursor)),
  );
}

export function usePortalPurchaseOrder(poId: string | null): ResourceState<PortalPurchaseOrderDetailResponse> & Reloadable {
  return usePortalDetail(poId, 'This purchase order', fetchApiPortalPurchaseOrder);
}

export function usePortalInvoices() {
  return usePortalList<PortalInvoiceRowDto>('invoices', 'your invoices', (tenantId, cursor) =>
    fetchApiPortalInvoices(tenantId, cursorOption(cursor)),
  );
}

export function usePortalInvoice(invoiceId: string | null): ResourceState<PortalInvoiceDetailResponse> & Reloadable {
  return usePortalDetail(invoiceId, 'This invoice', fetchApiPortalInvoice);
}
