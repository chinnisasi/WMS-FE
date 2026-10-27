'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { CLIENT_PENDING, type ClientFilter } from '@/lib/active-client';
import {
  fetchApiListRecalls,
  fetchApiRecallBins,
  fetchApiRecallCandidates,
  fetchApiRecallDetail,
  fetchApiRecallReceipts,
  fetchApiRecallShipments,
  type RecallListQuery,
} from '@/lib/api/client';
import type {
  RecallBinDto,
  RecallCandidatesResponse,
  RecallDetailResponse,
  RecallListEntryDto,
  RecallReceiptDto,
  RecallShipmentDto,
} from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { RECALLS_CHANGED_EVENT, recallReadReason, type RecallMode, type RecallStatus } from '@/lib/recalls';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

/**
 * Story 3-7a — the recall reads, in the house shape (frontend guide §1):
 * session identity through the external store, the requested cursor and the
 * result STAMPED with their scope and filtered at render (never a setState
 * in an effect), a `cancelled` flag in the cleanup, a `failed` arm and a
 * `reload()` that clears first. Every read refetches on
 * `RECALLS_CHANGED_EVENT`; the detail does so QUIETLY (the last-good detail
 * stays on screen while it re-reads — a download only moves its
 * first-report time).
 */

function useTenantId(): string | null {
  return useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
}

function useRecallsRevision(): readonly [number, () => void] {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(RECALLS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(RECALLS_CHANGED_EVENT, onChange);
  }, []);
  const bump = useCallback(() => setRevision((r) => r + 1), []);
  return [revision, bump];
}

export interface RecallPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/** The list's own filters (the client comes from the shell's switcher). */
export interface RecallListFilters {
  readonly status: RecallStatus | null;
  readonly mode: RecallMode | null;
  readonly externalRef: string | null;
}

export const EMPTY_RECALL_FILTERS: RecallListFilters = { status: null, mode: null, externalRef: null };

export const RECALL_LIST_LIMIT = 25;

function listQuery(clientId: string | null, filters: RecallListFilters, cursor: string | null): RecallListQuery {
  return {
    ...(clientId === null ? {} : { clientId }),
    ...(filters.status === null ? {} : { status: filters.status }),
    ...(filters.mode === null ? {} : { mode: filters.mode }),
    ...(filters.externalRef === null ? {} : { externalRef: filters.externalRef }),
    ...(cursor === null ? {} : { cursor }),
    limit: RECALL_LIST_LIMIT,
  };
}

/**
 * A paged read keyed by `scope` (every filter it sends): the requested cursor
 * is stamped with the scope, so a cursor minted under one filter is a
 * first-page request under another; `epoch` moves on every reload and scope
 * change so the caller can key its `DataTable` (guide §1.11).
 */
function usePagedRead<T>(
  scope: string | null,
  subject: string,
  fetchPage: (tenantId: string, cursor: string | null) => Promise<{ items: readonly T[]; nextCursor?: string | null }>,
): ResourceState<RecallPage<T>> & Reloadable & { readonly onCursor: (cursor: string | null) => void; readonly epoch: number } {
  const tenantId = useTenantId();
  const fullScope = tenantId === null || scope === null ? null : `${tenantId}|${scope}`;
  const [requested, setRequested] = useState<{ scope: string | null; cursor: string | null } | null>(null);
  const activeCursor = requested !== null && requested.scope === fullScope ? requested.cursor : null;
  const [revision, bump] = useRecallsRevision();
  const [epoch, setEpoch] = useState(0);
  const [result, setResult] = useState<{ scope: string; requested: string | null; state: ResourceState<RecallPage<T>> } | null>(null);

  useEffect(() => {
    if (tenantId === null || fullScope === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchPage(tenantId, activeCursor);
        if (!cancelled) setResult({ scope: fullScope, requested: activeCursor, state: { state: 'ready', data: { items: page.items, nextCursor: page.nextCursor ?? null } } });
      } catch (error) {
        if (!cancelled) setResult({ scope: fullScope, requested: activeCursor, state: { state: 'failed', reason: recallReadReason(error, subject) } });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `fetchPage` is keyed by `scope` on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, fullScope, activeCursor, revision]);

  const onCursor = useCallback((cursor: string | null) => setRequested({ scope: fullScope, cursor }), [fullScope]);
  const reload = useCallback(() => {
    setResult(null);
    setRequested({ scope: fullScope, cursor: null });
    setEpoch((e) => e + 1);
    bump();
  }, [bump, fullScope]);
  const stale = fullScope === null || result === null || result.scope !== fullScope || result.requested !== activeCursor;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload, epoch };
}

/** The tenant's recalls under the client filter and the list's filters, newest first. */
export function useRecallList(clientFilter: ClientFilter, filters: RecallListFilters) {
  const clientId = clientFilter === CLIENT_PENDING ? null : clientFilter;
  const scope = clientFilter === CLIENT_PENDING ? null : `${clientId ?? 'all'}|${filters.status ?? ''}|${filters.mode ?? ''}|${filters.externalRef ?? ''}`;
  return usePagedRead<RecallListEntryDto>(scope, 'The recalls', (tenantId, cursor) => fetchApiListRecalls(tenantId, listQuery(clientId, filters, cursor)));
}

export type RecallTraceKind = 'bins' | 'shipments' | 'receipts';
type TraceRow = { bins: RecallBinDto; shipments: RecallShipmentDto; receipts: RecallReceiptDto };

const TRACE_SUBJECT: Readonly<Record<RecallTraceKind, string>> = {
  bins: 'The bins',
  shipments: 'The shipments',
  receipts: 'The receipts',
};

export const RECALL_TRACE_LIMIT = 25;

/** One of the recall's paged traces — the bins (staff only), the shipments or the receipts. */
export function useRecallTrace<K extends RecallTraceKind>(kind: K, recallId: string | null) {
  return usePagedRead<TraceRow[K]>(recallId === null ? null : `${kind}|${recallId}`, TRACE_SUBJECT[kind], (tenantId, cursor) => {
    const options = { limit: RECALL_TRACE_LIMIT, ...(cursor === null ? {} : { cursor }) };
    const fetcher = kind === 'bins' ? fetchApiRecallBins : kind === 'shipments' ? fetchApiRecallShipments : fetchApiRecallReceipts;
    return fetcher(tenantId, recallId!, options) as unknown as Promise<{ items: readonly TraceRow[K][]; nextCursor: string | null }>;
  });
}

/** One recall's detail. A recalls change re-reads QUIETLY (last-good stays); `reload()` clears first. */
export function useRecallDetail(recallId: string | null): ResourceState<RecallDetailResponse> & Reloadable {
  const tenantId = useTenantId();
  const [revision, bump] = useRecallsRevision();
  const [result, setResult] = useState<{ tenantId: string; id: string; state: ResourceState<RecallDetailResponse> } | null>(null);

  useEffect(() => {
    if (tenantId === null || recallId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchApiRecallDetail(tenantId, recallId);
        if (!cancelled) setResult({ tenantId, id: recallId, state: { state: 'ready', data } });
      } catch (error) {
        // A failed QUIET refetch keeps the last-good detail on screen.
        if (!cancelled) {
          setResult((prev) =>
            prev !== null && prev.tenantId === tenantId && prev.id === recallId && prev.state.state === 'ready'
              ? prev
              : { tenantId, id: recallId, state: { state: 'failed', reason: recallReadReason(error, 'This recall') } },
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, recallId, revision]);

  const reload = useCallback(() => {
    setResult(null);
    bump();
  }, [bump]);
  const stale = tenantId === null || recallId === null || result === null || result.tenantId !== tenantId || result.id !== recallId;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}

/** The candidates for one (client, lot code) query; `null` reads nothing. */
export function useRecallCandidates(query: { readonly clientId: string; readonly code: string } | null): ResourceState<RecallCandidatesResponse> & Reloadable {
  const tenantId = useTenantId();
  const key = query === null ? null : `${query.clientId}|${query.code}`;
  const [revision, bump] = useRecallsRevision();
  const [result, setResult] = useState<{ tenantId: string; key: string; state: ResourceState<RecallCandidatesResponse> } | null>(null);

  useEffect(() => {
    if (tenantId === null || query === null || key === null) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchApiRecallCandidates(tenantId, query.clientId, query.code);
        if (!cancelled) setResult({ tenantId, key, state: { state: 'ready', data } });
      } catch (error) {
        if (!cancelled) setResult({ tenantId, key, state: { state: 'failed', reason: recallReadReason(error, 'The matching lots') } });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `query` is folded into `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, key, revision]);

  const reload = useCallback(() => {
    setResult(null);
    bump();
  }, [bump]);
  const stale = tenantId === null || key === null || result === null || result.tenantId !== tenantId || result.key !== key;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}

/**
 * A recall's id from its code (a link names the code — the batch views
 * carry only `recallCode`): ONE list call with the exact `code` filter,
 * narrowed when the caller knows the client or that the recall is open.
 * Null when no such recall.
 */
export async function findRecallByCode(
  tenantId: string,
  code: string,
  narrow: { readonly clientId?: string; readonly status?: RecallStatus } = {},
): Promise<RecallListEntryDto | null> {
  const page = await fetchApiListRecalls(tenantId, {
    code,
    ...(narrow.clientId === undefined ? {} : { clientId: narrow.clientId }),
    ...(narrow.status === undefined ? {} : { status: narrow.status }),
    limit: 1,
  });
  return page.items.find((item) => item.code === code) ?? null;
}

/** A recall code from the URL → its id (`ready` with null = no such recall). */
export function useRecallByCode(code: string | null): ResourceState<RecallListEntryDto | null> & Reloadable {
  const tenantId = useTenantId();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ tenantId: string; code: string; state: ResourceState<RecallListEntryDto | null> } | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (tenantId === null || code === null) return;
    let cancelled = false;
    const mine = ++seq.current;
    (async () => {
      try {
        const found = await findRecallByCode(tenantId, code);
        if (!cancelled && mine === seq.current) setResult({ tenantId, code, state: { state: 'ready', data: found } });
      } catch (error) {
        if (!cancelled && mine === seq.current) setResult({ tenantId, code, state: { state: 'failed', reason: recallReadReason(error, `Recall ${code}`) } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, code, revision]);
  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);
  const stale = tenantId === null || code === null || result === null || result.tenantId !== tenantId || result.code !== code;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}
