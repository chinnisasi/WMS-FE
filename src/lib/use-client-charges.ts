'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiClientChargePolicy, fetchApiListClientCharges } from '@/lib/api/client';
import type { ChargePolicyResponse, ClientChargeDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { CLIENT_CHARGES_CHANGED_EVENT, chargeReadReason, type ChargeFilters } from '@/lib/client-charges';
import { CLIENT_INVOICES_CHANGED_EVENT } from '@/lib/client-invoices';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

/**
 * Story 5-5a — the ad-hoc charge reads, in the house shape (frontend guide
 * §1, `use-counts.ts`): session identity through `useSyncExternalStore`, the
 * result stamped with its scope and revision and filtered at render, an
 * explicit `failed` arm, `reload()` clearing first, "Load more" appending the
 * next keyset page. Both reads refetch on `CLIENT_CHARGES_CHANGED_EVENT`; the
 * list also on `CLIENT_INVOICES_CHANGED_EVENT` (a prepared, issued or voided
 * invoice moves a charge's billing cell).
 */

function useTenantId(): string | null {
  return useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
}

function useChargesRevision(alsoInvoices: boolean): readonly [number, () => void] {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(CLIENT_CHARGES_CHANGED_EVENT, onChange);
    if (alsoInvoices) window.addEventListener(CLIENT_INVOICES_CHANGED_EVENT, onChange);
    return () => {
      window.removeEventListener(CLIENT_CHARGES_CHANGED_EVENT, onChange);
      if (alsoInvoices) window.removeEventListener(CLIENT_INVOICES_CHANGED_EVENT, onChange);
    };
  }, [alsoInvoices]);
  const bump = useCallback(() => setRevision((r) => r + 1), []);
  return [revision, bump];
}

/** The list page size — newest first. */
export const CLIENT_CHARGES_PAGE_LIMIT = 50;

export interface ClientChargesView {
  readonly items: readonly ClientChargeDto[];
  readonly nextCursor: string | null;
}

function queryOf(filters: ChargeFilters, cursor: string | undefined) {
  return {
    ...(filters.clientId === null ? {} : { clientId: filters.clientId }),
    ...(filters.warehouseId === null ? {} : { warehouseId: filters.warehouseId }),
    ...(filters.status === null ? {} : { status: filters.status }),
    ...(filters.month === null ? {} : { month: filters.month }),
    ...(cursor === undefined ? {} : { cursor }),
    limit: CLIENT_CHARGES_PAGE_LIMIT,
  };
}

/** The tenant's ad-hoc charges under the filters, newest first. A refetch keeps the rows already loaded ("Load more" progress). */
export function useClientCharges(
  filters: ChargeFilters,
): ResourceState<ClientChargesView> & Reloadable & { readonly loadMore: () => void; readonly loadingMore: boolean; readonly moreError: string | null } {
  const tenantId = useTenantId();
  const scope = `${tenantId ?? ''}|${filters.clientId ?? ''}|${filters.warehouseId ?? ''}|${filters.status ?? ''}|${filters.month ?? ''}`;
  const [revision, bump] = useChargesRevision(true);
  const [result, setResult] = useState<{ scope: string; revision: number; state: ResourceState<ClientChargesView> } | null>(null);
  const [more, setMore] = useState<{ scope: string; revision: number; loading: boolean; error: string | null } | null>(null);
  const seq = useRef(0);
  // Code review E4 — "Load more" waits while a refetch is in flight, so a page
  // appended to the OLD rows can never overwrite the fresh list.
  const refetching = useRef(false);
  const loaded = useRef<{ scope: string; count: number } | null>(null);
  useEffect(() => {
    if (result !== null && result.state.state === 'ready') loaded.current = { scope: result.scope, count: result.state.data.items.length };
  }, [result]);

  useEffect(() => {
    if (tenantId === null) return;
    seq.current += 1;
    refetching.current = true;
    let cancelled = false;
    const target = loaded.current !== null && loaded.current.scope === scope ? loaded.current.count : 0;
    (async () => {
      try {
        const items: ClientChargeDto[] = [];
        let cursor: string | undefined;
        let nextCursor: string | null = null;
        do {
          const page = await fetchApiListClientCharges(tenantId, queryOf(filters, cursor));
          items.push(...page.items);
          nextCursor = page.nextCursor ?? null;
          cursor = nextCursor ?? undefined;
        } while (!cancelled && nextCursor !== null && items.length < target);
        if (!cancelled) setResult({ scope, revision, state: { state: 'ready', data: { items, nextCursor } } });
      } catch (error) {
        if (!cancelled) setResult({ scope, revision, state: { state: 'failed', reason: chargeReadReason(error) } });
      } finally {
        if (!cancelled) refetching.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
    // `filters` is folded into `scope`; the scope and the revision decide a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, scope, revision]);

  // A refetch keeps the last list on screen until it lands; a scope change or reload() reads as loading.
  const current = tenantId !== null && result !== null && result.scope === scope ? result.state : null;

  const loadMore = useCallback(() => {
    if (tenantId === null || refetching.current || current === null || current.state !== 'ready' || current.data.nextCursor === null) return;
    const base = current.data;
    const cursor = base.nextCursor!;
    const mine = ++seq.current;
    setMore({ scope, revision, loading: true, error: null });
    (async () => {
      try {
        const page = await fetchApiListClientCharges(tenantId, queryOf(filters, cursor));
        if (mine !== seq.current) return;
        setResult({ scope, revision, state: { state: 'ready', data: { items: [...base.items, ...page.items], nextCursor: page.nextCursor ?? null } } });
        setMore({ scope, revision, loading: false, error: null });
      } catch (error) {
        if (mine !== seq.current) return;
        setMore({ scope, revision, loading: false, error: chargeReadReason(error) });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, current, scope, revision]);

  const reload = useCallback(() => {
    seq.current += 1;
    setResult(null);
    setMore(null);
    bump();
  }, [bump]);

  const moreHere = more !== null && more.scope === scope && more.revision === revision && current !== null ? more : null;
  return {
    ...(current === null ? ({ state: 'loading' } as const) : current),
    reload,
    loadMore,
    loadingMore: moreHere?.loading ?? false,
    moreError: moreHere?.error ?? null,
  };
}

/** The tenant's self-approval limit (member-open; no setting = the ₹10,000 default). */
export function useClientChargePolicy(): ResourceState<ChargePolicyResponse> & Reloadable {
  const tenantId = useTenantId();
  const [revision, bump] = useChargesRevision(false);
  const [result, setResult] = useState<{ tenantId: string; revision: number; state: ResourceState<ChargePolicyResponse> } | null>(null);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchApiClientChargePolicy(tenantId);
        if (!cancelled) setResult({ tenantId, revision, state: { state: 'ready', data } });
      } catch (error) {
        if (!cancelled) setResult({ tenantId, revision, state: { state: 'failed', reason: chargeReadReason(error) } });
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

  const current = tenantId !== null && result !== null && result.tenantId === tenantId && (result.revision === revision || result.state.state === 'ready');
  return { ...(current ? result.state : ({ state: 'loading' } as const)), reload };
}
