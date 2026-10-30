'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiFreightCandidates, fetchApiFreightLoad, fetchApiListFreightLoads, type FreightCandidatesStatus } from '@/lib/api/client';
import type { FreightCandidateDto, FreightLoadListRowDto, FreightLoadViewDto } from '@/lib/api/generated';
import { CLIENT_PENDING, type ClientFilter } from '@/lib/active-client';
import { readSession, subscribeSession } from '@/lib/auth';
import { MAX_FREIGHT_CANDIDATES, freightReason, type FreightLoadsListView } from '@/lib/freight';
import { OUTBOUND_CHANGED_EVENT } from '@/lib/outbound';
import type { ResourceState, Reloadable } from '@/lib/resource-state';
import { useClientEpoch } from '@/lib/use-client-epoch';

/**
 * Story 4-9a — the freight reads (A20, A21), in the canonical hook shape
 * (`use-shipping.ts`): the tenant through `useSyncExternalStore`, a revision
 * bumped by OUTBOUND_CHANGED_EVENT, the scope stamped on every result and
 * stale results filtered at render. Mutations live in the components.
 */

function useTenantId(): string | null {
  return useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
}

function useOutboundRevision(): [number, () => void] {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(OUTBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(OUTBOUND_CHANGED_EVENT, onChange);
  }, []);
  return [revision, useCallback(() => setRevision((r) => r + 1), [])];
}

export interface FreightLoadsPage {
  readonly items: readonly FreightLoadListRowDto[];
  readonly nextCursor: string | null;
}

/** One keyset page of the warehouse's loads in a view, newest first, filtered by the active client (A20). */
export function useFreightLoads(
  warehouseId: string | null,
  view: FreightLoadsListView,
  clientFilter: ClientFilter,
): ResourceState<FreightLoadsPage> & Reloadable & { readonly onCursor: (cursor: string | null) => void; readonly epoch: number } {
  const tenantId = useTenantId();
  const pending = clientFilter === CLIENT_PENDING;
  const clientId: string | null = clientFilter === CLIENT_PENDING ? null : clientFilter;
  const clientEpoch = useClientEpoch(clientId, pending);
  const [requested, setRequested] = useState<{ scope: string; cursor: string | null } | null>(null);
  const [epoch, setEpoch] = useState(0);
  const scope = `${tenantId}|${warehouseId}|${view}|${clientId}|${clientEpoch}`;
  const activeCursor = requested !== null && requested.scope === scope ? requested.cursor : null;
  const [revision, bump] = useOutboundRevision();
  const [result, setResult] = useState<{ scope: string; requested: string | null; state: ResourceState<FreightLoadsPage> } | null>(null);

  useEffect(() => {
    if (tenantId === null || warehouseId === null || pending) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListFreightLoads(tenantId, warehouseId, {
          view,
          ...(clientId === null ? {} : { clientId }),
          ...(activeCursor === null ? {} : { cursor: activeCursor }),
        });
        if (!cancelled) setResult({ scope, requested: activeCursor, state: { state: 'ready', data: { items: page.items, nextCursor: page.nextCursor ?? null } } });
      } catch (error) {
        if (!cancelled) setResult({ scope, requested: activeCursor, state: { state: 'failed', reason: freightReason(error, 'read') } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, view, clientId, pending, activeCursor, revision, scope]);

  const onCursor = useCallback((cursor: string | null) => setRequested({ scope, cursor }), [scope]);
  const reload = useCallback(() => {
    setResult(null);
    setRequested(null);
    setEpoch((e) => e + 1);
    bump();
  }, [bump]);
  const stale = tenantId === null || warehouseId === null || pending || result === null || result.scope !== scope || result.requested !== activeCursor;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload, epoch };
}

/**
 * One load's detail (A21), refetched quietly on the outbound broadcast (the
 * last-good view stays on screen); `refresh()` is quiet too and returns the
 * fresh view (the departure dialog rebases its draft on it).
 */
export function useFreightLoad(
  loadId: string | null,
): ResourceState<FreightLoadViewDto> & Reloadable & { refresh: () => Promise<FreightLoadViewDto | null> } {
  const tenantId = useTenantId();
  const [revision, bump] = useOutboundRevision();
  const [result, setResult] = useState<{ key: string; state: ResourceState<FreightLoadViewDto> } | null>(null);
  const key = `${tenantId}|${loadId}`;
  const seq = useRef(0);

  useEffect(() => {
    if (tenantId === null || loadId === null) return;
    let cancelled = false;
    const mine = ++seq.current;
    (async () => {
      try {
        const view = await fetchApiFreightLoad(tenantId, loadId);
        if (!cancelled && mine === seq.current) setResult({ key, state: { state: 'ready', data: view } });
      } catch (error) {
        if (cancelled || mine !== seq.current) return;
        const failed = { state: 'failed', reason: freightReason(error, 'read') } as const;
        // A failed background refetch keeps the last-good view.
        setResult((prev) => (prev !== null && prev.key === key && prev.state.state === 'ready' ? prev : { key, state: failed }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, loadId, key, revision]);

  const reload = useCallback(() => {
    setResult(null);
    bump();
  }, [bump]);
  const refresh = useCallback(async (): Promise<FreightLoadViewDto | null> => {
    if (tenantId === null || loadId === null) return null;
    const mine = ++seq.current;
    const scope = `${tenantId}|${loadId}`;
    try {
      const view = await fetchApiFreightLoad(tenantId, loadId);
      if (mine === seq.current) setResult({ key: scope, state: { state: 'ready', data: view } });
      return view;
    } catch (error) {
      if (mine === seq.current) {
        const failed = { state: 'failed', reason: freightReason(error, 'read') } as const;
        setResult((prev) => (prev !== null && prev.key === scope ? prev : { key: scope, state: failed }));
      }
      return null;
    }
  }, [tenantId, loadId]);
  const stale = tenantId === null || loadId === null || result === null || result.key !== key;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload, refresh };
}

export interface FreightCandidateFilters {
  readonly clientId: string | null;
  readonly state: string;
  readonly city: string;
  readonly pincode: string;
  readonly status: FreightCandidatesStatus;
}

export interface FreightCandidates {
  readonly items: readonly FreightCandidateDto[];
  /** The server's own scan bound was reached, or the walk passed `MAX_FREIGHT_CANDIDATES` (A20, the 4-4a A49 rule). */
  readonly truncated: boolean;
}

/**
 * The candidates picker (A30): the whole chain under the filters, walked to
 * the end (≤ 2,000) before anything is selectable. Not refetched on the
 * outbound broadcast while open (a refetch under a selection would reorder
 * it) — `reload()` does.
 */
export function useFreightCandidates(warehouseId: string | null, filters: FreightCandidateFilters | null): ResourceState<FreightCandidates> & Reloadable {
  const tenantId = useTenantId();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; state: ResourceState<FreightCandidates> } | null>(null);
  const filterKey = filters === null ? 'none' : JSON.stringify(filters);
  const key = `${tenantId}|${warehouseId}|${filterKey}|${revision}`;

  useEffect(() => {
    if (tenantId === null || warehouseId === null || filters === null) return;
    let cancelled = false;
    (async () => {
      try {
        const items: FreightCandidateDto[] = [];
        let cursor: string | null = null;
        let truncated = false;
        for (;;) {
          if (cancelled) return;
          const page = await fetchApiFreightCandidates(tenantId, warehouseId, {
            ...(filters.clientId === null ? {} : { clientId: filters.clientId }),
            ...(filters.state.trim() === '' ? {} : { state: filters.state.trim() }),
            ...(filters.city.trim() === '' ? {} : { city: filters.city.trim() }),
            ...(filters.pincode.trim() === '' ? {} : { pincode: filters.pincode.trim() }),
            status: filters.status,
            limit: 200,
            ...(cursor === null ? {} : { cursor }),
          });
          items.push(...page.items);
          if (page.truncated) truncated = true;
          cursor = page.nextCursor;
          if (cursor === null) break;
          if (items.length >= MAX_FREIGHT_CANDIDATES) {
            truncated = true;
            break;
          }
        }
        if (!cancelled) setResult({ key, state: { state: 'ready', data: { items: items.slice(0, MAX_FREIGHT_CANDIDATES), truncated: truncated || items.length > MAX_FREIGHT_CANDIDATES } } });
      } catch (error) {
        if (!cancelled) setResult({ key, state: { state: 'failed', reason: freightReason(error, 'read') } });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `filters` enters through `key` (its JSON) — the object's identity churns every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, warehouseId, key]);

  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);
  const stale = tenantId === null || warehouseId === null || filters === null || result === null || result.key !== key;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}

