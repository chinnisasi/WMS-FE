'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import {
  ApiProblem,
  fetchApiGetBatch,
  fetchApiGetExpiryPolicy,
  fetchApiListBatchAlerts,
  fetchApiListBreaches,
  fetchApiListReorderPolicies,
  fetchApiListSuggestedPos,
} from '@/lib/api/client';
import type {
  BatchAlertDto,
  BatchDetailResponse,
  BreachDto,
  ExpiryPolicyDto,
  ReorderPolicyDto,
  SuggestedPoDto,
} from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { MAX_PAGE_HOPS } from '@/lib/fetch-all-pages';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import {
  REPLENISHMENT_CHANGED_EVENT,
  replenishmentListReason,
  type BatchAlertKindFilter,
  type BatchAlertStatus,
  type BreachStatus,
  type SuggestedPoStatus,
} from '@/lib/replenishment';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

/**
 * The replenishment surface's reads (story 6-1; the batch-alert reads are
 * story 6-2), in the shape
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

export interface BatchAlertsPage {
  items: readonly BatchAlertDto[];
  nextCursor: string | null;
}

/**
 * One warehouse's batch alerts (story 6-2), one kind filter and one status
 * tab at a time — the breach queue's cursor-stamped shape with the kind
 * axis added: `all` sends no `kind` query, and a kind/status tab switch
 * makes any in-flight cursor a first-page request (stamped, never replayed
 * against the wrong scope).
 */
export function useBatchAlerts(
  warehouseId: string | null,
  kind: BatchAlertKindFilter,
  status: BatchAlertStatus,
): ResourceState<BatchAlertsPage> &
  Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [requested, setRequested] = useState<{
    tenantId: string;
    warehouseId: string;
    kind: BatchAlertKindFilter;
    status: BatchAlertStatus;
    cursor: string | null;
  } | null>(null);
  const activeCursor =
    requested !== null &&
    requested.tenantId === tenantId &&
    requested.warehouseId === warehouseId &&
    requested.kind === kind &&
    requested.status === status
      ? requested.cursor
      : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    warehouseId: string;
    kind: BatchAlertKindFilter;
    status: BatchAlertStatus;
    requested: string | null;
    state: ResourceState<BatchAlertsPage>;
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
      // `all` is no query at all — the kind axis is plain `kind`, riding the
      // effect's dependency list directly.
      const kindQuery = kind === 'all' ? undefined : kind;
      try {
        const page = await fetchApiListBatchAlerts(
          tenantId,
          activeCursor === null
            ? { warehouseId, status, ...(kindQuery === undefined ? {} : { kind: kindQuery }) }
            : {
                warehouseId,
                status,
                cursor: activeCursor,
                ...(kindQuery === undefined ? {} : { kind: kindQuery }),
              },
        );
        if (!cancelled) {
          setResult({
            tenantId,
            warehouseId,
            kind,
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
            kind,
            status,
            requested: activeCursor,
            state: { state: 'failed', reason: replenishmentListReason(error, 'batch alerts') },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, kind, status, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null || warehouseId === null) return;
      setRequested({ tenantId, warehouseId, kind, status, cursor });
    },
    [tenantId, warehouseId, kind, status],
  );
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
    result.kind !== kind ||
    result.status !== status ||
    result.requested !== activeCursor;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload };
}

/**
 * The tenant's expiry/aging config (story 6-2), or `null` when no row
 * exists — the null is the DISABLE mechanism read back, not "still
 * loading": the panel's caption says the alerts are off. The GET is open to
 * every member (404 only ever answers "no config row", which `fetchApiGetExpiryPolicy`
 * folds to null).
 */
export function useExpiryPolicy(): ResourceState<ExpiryPolicyDto | null> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    state: ResourceState<ExpiryPolicyDto | null>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(REPLENISHMENT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(REPLENISHMENT_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetchApiGetExpiryPolicy(tenantId);
        if (!cancelled) {
          setResult({
            tenantId,
            state: { state: 'ready', data: response?.expiryPolicy ?? null },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({
            tenantId,
            state: { state: 'failed', reason: expiryPolicyReason(error) },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, revision]);

  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);

  const stale = tenantId === null || result === null || result.tenantId !== tenantId;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}

/**
 * The expiry-config read's failure reasons (story 6-2). The 404
 * `not-found` arm never lands here — `fetchApiGetExpiryPolicy` folds it to
 * null (the disabled convention) — so this mapper's not-found branch is
 * kept for safety only.
 */
function expiryPolicyReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        return 'The alert config is not set — expiry and aging alerts are off.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Could not load the expiry alert config.';
      default:
        return error.detail ?? 'Could not load the expiry alert config.';
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * One batch's detail (story 6-2's click-through): a read-on-demand hook —
 * the caller keeps it mounted only while an expanded row holds the id, so
 * no `null`-id "loading forever" state can render. A foreign or deleted
 * batch (404) is the explicit `failed` arm, not a quiet collapse back to
 * the row.
 */
export function useBatchDetail(
  batchId: string | null,
): ResourceState<BatchDetailResponse> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    batchId: string;
    state: ResourceState<BatchDetailResponse>;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null || batchId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const detail = await fetchApiGetBatch(tenantId, batchId);
        if (!cancelled) {
          setResult({
            tenantId,
            batchId,
            state: { state: 'ready', data: detail },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({
            tenantId,
            batchId,
            state: {
              state: 'failed',
              reason: replenishmentBatchDetailReason(error),
            },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, batchId, revision]);

  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);

  const stale =
    tenantId === null || batchId === null || result === null ||
    result.tenantId !== tenantId || result.batchId !== batchId;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}

/**
 * The batch detail read's failure reasons — a branch on the problem `code`,
 * not prose (the mapper convention).
 */
function replenishmentBatchDetailReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        return 'This batch no longer exists in this tenant — refresh the queue.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'The batch reference is malformed.';
      default:
        return error.detail ?? 'Could not load the batch record.';
    }
  }
  return UNREACHABLE_REASON;
}