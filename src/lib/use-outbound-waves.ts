'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiGetWave, fetchApiListWavePolicies, fetchApiListWaves } from '@/lib/api/client';
import type { WaveDto, WaveEntryDto, WavePolicyDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { MAX_PAGE_HOPS } from '@/lib/fetch-all-pages';
import { readReason } from '@/lib/outbound-orders';
import { waveDetailReason } from '@/lib/outbound-waves';
import { OUTBOUND_CHANGED_EVENT } from '@/lib/outbound';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

/**
 * The waves surface's reads (story 4.2c), in the shape `use-outbound-orders`
 * established: session identity through `useSyncExternalStore`, a `useEffect`
 * fetch, a `revision` counter bumped by OUTBOUND_CHANGED_EVENT, and stale
 * results (warehouse switched mid-flight, tenant changed) filtered at render
 * rather than by a setState in an effect.
 *
 * Every one of them carries an explicit `failed` arm. The house hooks that
 * swallow a failed fetch into `null` were 4-2b's largest review finding: a
 * surface rendering `null` as "Loading…" tells the viewer a fetch is still in
 * flight forever. A read that fails is reported, with a retry.
 */

export interface OutboundWavesPage {
  items: readonly WaveEntryDto[];
  /** Cursor for the DataTable's Next button; null on the last page. */
  nextCursor: string | null;
}

/**
 * One cursor-paginated page of a warehouse's waves, newest first.
 *
 * The endpoint offers `cursor` + `limit` and nothing else — no status filter,
 * no sort, no search — so the surface's status control filters what this
 * returns and says so.
 */
export function useOutboundWaves(
  warehouseId: string | null,
): ResourceState<OutboundWavesPage> &
  Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  // The cursor the viewer asked for, scoped to the (tenant, warehouse) it was
  // asked for — a cursor left over from another scope is treated as a
  // first-page request, never replayed against the wrong warehouse.
  const [requested, setRequested] = useState<{
    tenantId: string;
    warehouseId: string;
    cursor: string | null;
  } | null>(null);
  const activeCursor =
    requested !== null && requested.tenantId === tenantId && requested.warehouseId === warehouseId
      ? requested.cursor
      : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    warehouseId: string;
    requested: string | null;
    state: ResourceState<OutboundWavesPage>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(OUTBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(OUTBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || warehouseId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListWaves(
          tenantId,
          warehouseId,
          activeCursor === null ? undefined : { cursor: activeCursor },
        );
        if (!cancelled) {
          setResult({
            tenantId,
            warehouseId,
            requested: activeCursor,
            state: {
              state: 'ready',
              data: { items: page.items, nextCursor: page.nextCursor ?? null },
            },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({
            tenantId,
            warehouseId,
            requested: activeCursor,
            state: { state: 'failed', reason: readReason(error, 'waves') },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null || warehouseId === null) return;
      setRequested({ tenantId, warehouseId, cursor });
    },
    [tenantId, warehouseId],
  );
  // Clearing the result first is what makes Retry visible: leaving the old
  // `failed` state in place while the refetch is in flight renders a second
  // identical failure as an inert button.
  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);

  const stale =
    tenantId === null ||
    warehouseId === null ||
    result === null ||
    result.tenantId !== tenantId ||
    result.warehouseId !== warehouseId ||
    result.requested !== activeCursor;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload };
}

/**
 * One wave's detail, fetched when its row expands (`waveId` non-null).
 *
 * There is no picklist endpoint at all: the picklists and every stop on their
 * walks come free with this read, and the list row carries only
 * `picklistCount`. Expanding therefore fetches the wave once — the 4-2b
 * shape, for the same reason.
 *
 * A failure here belongs to one row: the surface renders it inline on that
 * row and leaves the list untouched.
 */
export function useWaveDetail(waveId: string | null): ResourceState<WaveDto> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    waveId: string;
    state: ResourceState<WaveDto>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(OUTBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(OUTBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || waveId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const { wave } = await fetchApiGetWave(tenantId, waveId);
        if (!cancelled) setResult({ tenantId, waveId, state: { state: 'ready', data: wave } });
      } catch (error) {
        if (!cancelled) {
          setResult({ tenantId, waveId, state: { state: 'failed', reason: waveDetailReason(error) } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, waveId, revision]);

  // Clearing the result first is what makes Retry visible: leaving the old
  // `failed` state in place while the refetch is in flight renders a second
  // identical failure as an inert button.
  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);
  const stale =
    waveId === null ||
    tenantId === null ||
    result === null ||
    result.tenantId !== tenantId ||
    result.waveId !== waveId;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}

export interface WavePolicies {
  readonly warehouseId: string;
  readonly items: readonly WavePolicyDto[];
  /**
   * The cursor chain hit its hop cap and more policies exist than were
   * loaded. Every wave row reads its cutoff out of this list, so a silent
   * truncation would make a policy's amber indistinguishable from "this
   * policy has no cutoff" — the surface says so instead.
   */
  readonly truncated: boolean;
}

/**
 * A warehouse's wave policies — the generate form's picker, and the source of
 * every row's carrier cutoff (`WaveEntryDto` carries `policyId` and nothing
 * else about the rule). The whole cursor chain is walked, because a policy
 * missing from the map would leave a wave row unable to show its cutoff at
 * all; there are tens of these per warehouse, not thousands.
 *
 * Explicit `failed` arm, same as its siblings: a generate form cannot
 * honestly offer a policy picker it could not load.
 */
export function useWavePolicies(
  warehouseId: string | null,
): ResourceState<WavePolicies> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    warehouseId: string;
    state: ResourceState<WavePolicies>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(OUTBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(OUTBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || warehouseId === null) return;
    let cancelled = false;
    (async () => {
      try {
        // Walked here rather than through `fetchAllPages`, which caps at
        // MAX_PAGE_HOPS and returns what it has with no signal. The cap is
        // the same; the difference is that a wave row can now say its cutoff
        // may be missing instead of quietly showing none.
        const items: WavePolicyDto[] = [];
        let cursor: string | undefined;
        let truncated = false;
        for (let hops = 0; hops < MAX_PAGE_HOPS; hops++) {
          const page = await fetchApiListWavePolicies(
            tenantId,
            warehouseId,
            cursor === undefined ? undefined : { cursor },
          );
          items.push(...page.items);
          const next = page.nextCursor ?? null;
          if (next === null) break;
          cursor = next;
          truncated = hops === MAX_PAGE_HOPS - 1;
        }
        if (!cancelled) {
          setResult({
            tenantId,
            warehouseId,
            state: { state: 'ready', data: { warehouseId, items, truncated } },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({
            tenantId,
            warehouseId,
            state: { state: 'failed', reason: readReason(error, 'wave policies') },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, revision]);

  // Clearing the result first is what makes Retry visible: leaving the old
  // `failed` state in place while the refetch is in flight renders a second
  // identical failure as an inert button.
  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);
  const stale =
    tenantId === null ||
    warehouseId === null ||
    result === null ||
    result.tenantId !== tenantId ||
    result.warehouseId !== warehouseId;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}
