'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import {
  fetchApiListBreaches,
  fetchApiListReorderPolicies,
  fetchApiListSuggestedPos,
} from '@/lib/api/client';
import type { BreachDto, ReorderPolicyDto, SuggestedPoDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { MAX_PAGE_HOPS } from '@/lib/fetch-all-pages';
import {
  REPLENISHMENT_CHANGED_EVENT,
  replenishmentListReason,
  type BreachStatus,
  type SuggestedPoStatus,
} from '@/lib/replenishment';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

/**
 * The replenishment surface's reads (story 6-1), in the shape
 * `use-outbound-waves.ts`/`use-variance-queue.ts` established: session
 * identity through `useSyncExternalStore`, a `useEffect` fetch, a
 * `revision` counter bumped by the module's window event (and by
 * `reload()`), and stale results (warehouse or tab switched mid-flight,
 * tenant changed) filtered at render rather than by a setState in an
 * effect. The requested cursor is STAMPED with the scope it was asked for —
 * a cursor paged on one warehouse or status tab is a first-page request on
 * another, never replayed against the wrong scope.
 *
 * Every hook carries an explicit `failed` arm. The house hooks that swallow
 * a failed fetch into `null` were 4-2b's largest review finding: a surface
 * rendering `null` as "Loading…" tells the viewer a fetch is still in
 * flight forever.
 */

export interface BreachesPage {
  items: readonly BreachDto[];
  /** Cursor for the queue's Next button; null on the last page. */
  nextCursor: string | null;
}

export interface SuggestedPosPage {
  items: readonly SuggestedPoDto[];
  nextCursor: string | null;
}

/** One warehouse's breaches, newest first, one status tab at a time. */
export function useReplenishmentBreaches(
  warehouseId: string | null,
  status: BreachStatus,
): ResourceState<BreachesPage> & Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  // The requested cursor, STAMPED with the (tenant, warehouse, status) it
  // was asked for (the use-excursions pattern).
  const [requested, setRequested] = useState<{
    tenantId: string;
    warehouseId: string;
    status: BreachStatus;
    cursor: string | null;
  } | null>(null);
  const activeCursor =
    requested !== null &&
    requested.tenantId === tenantId &&
    requested.warehouseId === warehouseId &&
    requested.status === status
      ? requested.cursor
      : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    warehouseId: string;
    status: BreachStatus;
    requested: string | null;
    state: ResourceState<BreachesPage>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(REPLENISHMENT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(REPLENISHMENT_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || warehouseId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListBreaches(
          tenantId,
          activeCursor === null ? { warehouseId, status } : { warehouseId, status, cursor: activeCursor },
        );
        if (!cancelled) {
          setResult({
            tenantId,
            warehouseId,
            status,
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
            status,
            requested: activeCursor,
            state: { state: 'failed', reason: replenishmentListReason(error, 'breaches') },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, status, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null || warehouseId === null) return;
      setRequested({ tenantId, warehouseId, status, cursor });
    },
    [tenantId, warehouseId, status],
  );
  // Clearing the result first is what makes Retry visible — and `requested`
  // resets too, so a Retry never loops a stale cursor's own failure.
  const reload = useCallback(() => {
    setRequested(null);
    setResult(null);
    setRevision((r) => r + 1);
  }, []);

  const stale =
    tenantId === null ||
    warehouseId === null ||
    result === null ||
    result.tenantId !== tenantId ||
    result.warehouseId !== warehouseId ||
    result.status !== status ||
    result.requested !== activeCursor;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload };
}

/** One warehouse's suggested POs, newest first, one status tab at a time. */
export function useReplenishmentSuggestedPos(
  warehouseId: string | null,
  status: SuggestedPoStatus,
): ResourceState<SuggestedPosPage> &
  Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [requested, setRequested] = useState<{
    tenantId: string;
    warehouseId: string;
    status: SuggestedPoStatus;
    cursor: string | null;
  } | null>(null);
  const activeCursor =
    requested !== null &&
    requested.tenantId === tenantId &&
    requested.warehouseId === warehouseId &&
    requested.status === status
      ? requested.cursor
      : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    warehouseId: string;
    status: SuggestedPoStatus;
    requested: string | null;
    state: ResourceState<SuggestedPosPage>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(REPLENISHMENT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(REPLENISHMENT_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || warehouseId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListSuggestedPos(
          tenantId,
          activeCursor === null
            ? { warehouseId, status }
            : { warehouseId, status, cursor: activeCursor },
        );
        if (!cancelled) {
          setResult({
            tenantId,
            warehouseId,
            status,
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
            status,
            requested: activeCursor,
            state: { state: 'failed', reason: replenishmentListReason(error, 'suggested POs') },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, status, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null || warehouseId === null) return;
      setRequested({ tenantId, warehouseId, status, cursor });
    },
    [tenantId, warehouseId, status],
  );
  // Clearing the result first is what makes Retry visible; `requested`
  // resets with it so a Retry never loops a stale cursor's own failure.
  const reload = useCallback(() => {
    setRequested(null);
    setResult(null);
    setRevision((r) => r + 1);
  }, []);

  const stale =
    tenantId === null ||
    warehouseId === null ||
    result === null ||
    result.tenantId !== tenantId ||
    result.warehouseId !== warehouseId ||
    result.status !== status ||
    result.requested !== activeCursor;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload };
}

export interface ReorderPolicies {
  readonly warehouseId: string;
  /** Every override row of the warehouse — the whole cursor chain, bounded. */
  readonly items: readonly ReorderPolicyDto[];
  /**
   * The cursor chain hit its hop cap and more overrides exist than were
   * loaded. An override missing from the map would render as the SKU-column
   * default being the effective point — a policy the tenant set and the
   * surface cannot see — so the truncation is SAID, never silent
   * (the `useWavePolicies` pattern).
   */
  readonly truncated: boolean;
}

/**
 * One warehouse's reorder overrides, walked to the end of the bounded
 * cursor chain (tens of rows — a warehouse's SKUs — not thousands). The
 * policy list fetch carries its warehouseId on EVERY page, the list read's
 * only tenant-scoped filter besides the SKU column.
 *
 * Explicit `failed` arm, same as its siblings: a policy table that could not
 * load must not quietly show every SKU at its default.
 */
export function useReorderPolicies(
  warehouseId: string | null,
): ResourceState<ReorderPolicies> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    warehouseId: string;
    state: ResourceState<ReorderPolicies>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(REPLENISHMENT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(REPLENISHMENT_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || warehouseId === null) return;
    let cancelled = false;
    (async () => {
      try {
        // Walked here rather than through `fetchAllPages` (maxed at 20 hops,
        // which returns what it has with no signal) so a truncation is
        // surfaced instead of silently making an override look absent.
        const items: ReorderPolicyDto[] = [];
        let cursor: string | undefined;
        let truncated = false;
        for (let hops = 0; hops < MAX_PAGE_HOPS; hops++) {
          const page = await fetchApiListReorderPolicies(
            tenantId,
            cursor === undefined ? { warehouseId } : { warehouseId, cursor },
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
            state: { state: 'failed', reason: replenishmentListReason(error, 'reorder policies') },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, revision]);

  // Clearing the result first is what makes Retry visible (the waves shape).
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