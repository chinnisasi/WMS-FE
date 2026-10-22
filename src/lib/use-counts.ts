'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiGetCountPolicies, fetchApiGetCountTask, fetchApiListCountTasks, fetchApiListZones } from '@/lib/api/client';
import type { CountPolicyDto, CountTaskDetailResponse, CountTaskListEntryDto, ZoneResponse } from '@/lib/api/generated';
import { fetchAllPages } from '@/lib/fetch-all-pages';
import { readSession, subscribeSession } from '@/lib/auth';
import { COUNTS_CHANGED_EVENT, countDetailReason, type CountTaskOrigin, type CountTaskStatus } from '@/lib/counts';
import { readReason } from '@/lib/outbound-orders';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

/**
 * Story 3-5a — the Counts surface's reads, in the house shape (frontend
 * guide §1): session identity through `useSyncExternalStore`, the result
 * stamped with its scope and filtered at render, an explicit `failed` arm,
 * `reload()` clearing first, and `COUNTS_CHANGED_EVENT` bumping a revision.
 */

function useTenantId(): string | null {
  return useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
}

function useCountsRevision(): readonly [number, () => void] {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(COUNTS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(COUNTS_CHANGED_EVENT, onChange);
  }, []);
  const bump = useCallback(() => setRevision((r) => r + 1), []);
  return [revision, bump];
}

/** The list page size — newest first; "Load more" appends the next keyset page. */
export const COUNT_TASKS_PAGE_LIMIT = 50;

export interface CountTasksView {
  readonly items: readonly CountTaskListEntryDto[];
  readonly nextCursor: string | null;
}

/**
 * One warehouse's count tasks, newest first, status- and origin-filtered.
 * No client filter: the list is exempt (a bin may hold several clients'
 * goods), and the screen says so with `AllClientsNote`.
 */
export function useCountTasks(
  warehouseId: string | null,
  status: CountTaskStatus | null,
  origin: CountTaskOrigin | null,
): ResourceState<CountTasksView> &
  Reloadable & { readonly loadMore: () => void; readonly loadingMore: boolean; readonly moreError: string | null } {
  const tenantId = useTenantId();
  const scope = `${tenantId ?? ''}|${warehouseId ?? ''}|${status ?? ''}|${origin ?? ''}`;
  const [revision, bump] = useCountsRevision();
  const [result, setResult] = useState<{ scope: string; revision: number; state: ResourceState<CountTasksView> } | null>(null);
  const [more, setMore] = useState<{ scope: string; revision: number; loading: boolean; error: string | null } | null>(null);
  const seq = useRef(0);
  // How many rows the screen holds for this scope — a refetch after a counts
  // change re-reads that many (page by page), so "Load more" progress is kept.
  const loaded = useRef<{ scope: string; count: number } | null>(null);
  useEffect(() => {
    if (result !== null && result.state.state === 'ready') {
      loaded.current = { scope: result.scope, count: result.state.data.items.length };
    }
  }, [result]);

  useEffect(() => {
    if (tenantId === null || warehouseId === null) return;
    seq.current += 1;
    let cancelled = false;
    const target = loaded.current !== null && loaded.current.scope === scope ? loaded.current.count : 0;
    (async () => {
      try {
        const items: CountTaskListEntryDto[] = [];
        let cursor: string | undefined;
        let nextCursor: string | null = null;
        do {
          const page = await fetchApiListCountTasks(tenantId, {
            warehouseId,
            status: status ?? undefined,
            origin: origin ?? undefined,
            ...(cursor === undefined ? {} : { cursor }),
            limit: COUNT_TASKS_PAGE_LIMIT,
          });
          items.push(...page.items);
          nextCursor = page.nextCursor ?? null;
          cursor = nextCursor ?? undefined;
        } while (!cancelled && nextCursor !== null && items.length < target);
        if (!cancelled) {
          setResult({ scope, revision, state: { state: 'ready', data: { items, nextCursor } } });
        }
      } catch (error) {
        if (!cancelled) setResult({ scope, revision, state: { state: 'failed', reason: readReason(error, 'the counts') } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, status, origin, scope, revision]);

  // A refetch after a counts change keeps the last page on screen until it
  // lands (no loading flash); a scope change or reload() reads as loading.
  const current = tenantId !== null && warehouseId !== null && result !== null && result.scope === scope ? result.state : null;

  const loadMore = useCallback(() => {
    if (tenantId === null || warehouseId === null || current === null || current.state !== 'ready' || current.data.nextCursor === null) return;
    const base = current.data;
    const cursor = base.nextCursor!;
    const mine = ++seq.current;
    setMore({ scope, revision, loading: true, error: null });
    (async () => {
      try {
        const page = await fetchApiListCountTasks(tenantId, {
          warehouseId,
          status: status ?? undefined,
          origin: origin ?? undefined,
          cursor,
          limit: COUNT_TASKS_PAGE_LIMIT,
        });
        if (mine !== seq.current) return;
        setResult({ scope, revision, state: { state: 'ready', data: { items: [...base.items, ...page.items], nextCursor: page.nextCursor ?? null } } });
        setMore({ scope, revision, loading: false, error: null });
      } catch (error) {
        if (mine !== seq.current) return;
        setMore({ scope, revision, loading: false, error: readReason(error, 'more counts') });
      }
    })();
  }, [tenantId, warehouseId, status, origin, current, scope, revision]);

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

/** One count task's detail — read when its row is expanded (never on mount of the list). */
export function useCountTaskDetail(taskId: string): ResourceState<CountTaskDetailResponse> & Reloadable {
  const tenantId = useTenantId();
  const scope = `${tenantId ?? ''}|${taskId}`;
  const [revision, bump] = useCountsRevision();
  const [result, setResult] = useState<{ scope: string; revision: number; state: ResourceState<CountTaskDetailResponse> } | null>(null);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const detail = await fetchApiGetCountTask(tenantId, taskId);
        if (!cancelled) setResult({ scope, revision, state: { state: 'ready', data: detail } });
      } catch (error) {
        if (!cancelled) setResult({ scope, revision, state: { state: 'failed', reason: countDetailReason(error) } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, taskId, scope, revision]);

  const reload = useCallback(() => {
    setResult(null);
    bump();
  }, [bump]);
  const fresh = result !== null && result.scope === scope;
  return { ...(fresh ? result.state : ({ state: 'loading' } as const)), reload };
}

/** The warehouse's count schedule (any staff role reads it). */
export function useCountPolicies(warehouseId: string | null): ResourceState<readonly CountPolicyDto[]> & Reloadable {
  const tenantId = useTenantId();
  const scope = `${tenantId ?? ''}|${warehouseId ?? ''}`;
  const [revision, bump] = useCountsRevision();
  const [result, setResult] = useState<{ scope: string; revision: number; state: ResourceState<readonly CountPolicyDto[]> } | null>(null);

  useEffect(() => {
    if (tenantId === null || warehouseId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetchApiGetCountPolicies(tenantId, warehouseId);
        if (!cancelled) setResult({ scope, revision, state: { state: 'ready', data: response.policies } });
      } catch (error) {
        if (!cancelled) setResult({ scope, revision, state: { state: 'failed', reason: readReason(error, 'the count schedule') } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, scope, revision]);

  const reload = useCallback(() => {
    setResult(null);
    bump();
  }, [bump]);
  const fresh = tenantId !== null && warehouseId !== null && result !== null && result.scope === scope;
  return { ...(fresh ? result.state : ({ state: 'loading' } as const)), reload };
}

/**
 * Story 3-5a — one warehouse's zones for the New count form, with an explicit
 * `failed` arm (the shared `useWarehouseZones` swallows a failed read, which
 * would leave the zone picker silently empty).
 */
export function useCountZones(warehouseId: string | null): ResourceState<readonly ZoneResponse[]> & Reloadable {
  const tenantId = useTenantId();
  const scope = `${tenantId ?? ''}|${warehouseId ?? ''}`;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ scope: string; state: ResourceState<readonly ZoneResponse[]> } | null>(null);

  useEffect(() => {
    if (tenantId === null || warehouseId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const items = await fetchAllPages<ZoneResponse>((options) => fetchApiListZones(tenantId, warehouseId, options));
        if (!cancelled) setResult({ scope, state: { state: 'ready', data: items } });
      } catch (error) {
        if (!cancelled) setResult({ scope, state: { state: 'failed', reason: readReason(error, 'the zones') } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, scope, revision]);

  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);
  const fresh = tenantId !== null && warehouseId !== null && result !== null && result.scope === scope;
  return { ...(fresh ? result.state : ({ state: 'loading' } as const)), reload };
}
