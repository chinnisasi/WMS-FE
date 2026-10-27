'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListAwaitingReturns, fetchApiListReturns, fetchApiReturnable } from '@/lib/api/client';
import type { AwaitingDispositionDto, ReturnableOrderDto, ReturnAuthorizationDto } from '@/lib/api/generated';
import { CLIENT_PENDING, type ClientFilter } from '@/lib/active-client';
import { useClientEpoch } from '@/lib/use-client-epoch';
import { readSession, subscribeSession } from '@/lib/auth';
import { readReason } from '@/lib/outbound-orders';
import { RETURNS_CHANGED_EVENT, type ReturnStatus } from '@/lib/returns';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

export interface ReturnsPage {
  readonly items: readonly ReturnAuthorizationDto[];
  readonly nextCursor: string | null;
}

/**
 * Story 13-1 — one keyset page of the warehouse's return authorizations,
 * optionally one status's (a SERVER-side filter), in the house loader shape
 * (`use-asns.ts`): session identity through the external store, a cursor
 * stamped with the scope it was asked for (tenant, warehouse AND status), the
 * stale filter at render, `reload()` clearing first, and a refetch on
 * `RETURNS_CHANGED_EVENT`. No polling.
 */
export function useReturns(
  warehouseId: string | null,
  status: ReturnStatus | null,
  /** Story 1-5a — the screen's active-client filter (`useActiveClient().filter`); pending sends nothing. */
  clientFilter: ClientFilter,
): ResourceState<ReturnsPage> & Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const pending = clientFilter === CLIENT_PENDING;
  const clientId: string | null = clientFilter === CLIENT_PENDING ? null : clientFilter;
  const clientEpoch = useClientEpoch(clientId, pending);
  const scope =
    tenantId === null || warehouseId === null || pending
      ? null
      : `${tenantId}|${warehouseId}|${status ?? 'all'}|${clientId ?? '*'}#${clientEpoch}`;
  const [requested, setRequested] = useState<{ scope: string; cursor: string | null } | null>(null);
  const activeCursor = requested !== null && requested.scope === scope ? requested.cursor : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    scope: string;
    requested: string | null;
    state: ResourceState<ReturnsPage>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(RETURNS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(RETURNS_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || warehouseId === null || scope === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListReturns(tenantId, {
          warehouseId,
          ...(status === null ? {} : { status }),
          ...(clientId === null ? {} : { clientId }),
          ...(activeCursor === null ? {} : { cursor: activeCursor }),
        });
        if (!cancelled) {
          setResult({
            scope,
            requested: activeCursor,
            state: { state: 'ready', data: { items: page.items, nextCursor: page.nextCursor ?? null } },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({ scope, requested: activeCursor, state: { state: 'failed', reason: readReason(error, 'returns') } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, status, clientId, scope, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (scope === null) return;
      setRequested({ scope, cursor });
    },
    [scope],
  );
  const reload = useCallback(() => {
    setResult(null);
    setRequested(null);
    setRevision((r) => r + 1);
  }, []);

  const stale = scope === null || result === null || result.scope !== scope || result.requested !== activeCursor;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload };
}

/**
 * Story 13-1 — one order's returnable read, fetched when the create form
 * MOUNTS (it renders only once opened — never on a row expand). `reload()`
 * clears first; the form calls it after a 409 that changed what is
 * returnable.
 */
export function useReturnable(orderId: string): ResourceState<ReturnableOrderDto> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    revision: number;
    state: ResourceState<ReturnableOrderDto>;
  } | null>(null);
  const key = tenantId === null ? null : `${tenantId}|${orderId}`;

  useEffect(() => {
    if (tenantId === null || key === null) return;
    let cancelled = false;
    (async () => {
      try {
        const read = await fetchApiReturnable(tenantId, orderId);
        if (!cancelled) setResult({ key, revision, state: { state: 'ready', data: read } });
      } catch (error) {
        if (!cancelled) setResult({ key, revision, state: { state: 'failed', reason: readReason(error, 'the returnable quantities') } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, orderId, key, revision]);

  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);

  const stale = key === null || result === null || result.key !== key || result.revision !== revision;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}

export interface AwaitingReturnsPage {
  readonly items: readonly AwaitingDispositionDto[];
  readonly nextCursor: string | null;
}

/** The queue's page size — the route's ceiling. */
export const AWAITING_PAGE_LIMIT = 100;

/**
 * Story 4-7a — one keyset page of the warehouse's received return lines still
 * awaiting a disposition, OLDEST first (the server's `receivedAt` order — the
 * longest-waiting unit is the first thing the eye lands on). The `useReturns`
 * loader shape: session identity through the external store, the cursor
 * stamped with the scope it was asked for (tenant, warehouse, client and the
 * client epoch), the stale filter at render, `reload()` clearing first, and a
 * refetch on `RETURNS_CHANGED_EVENT` (a disposition, a receipt). No polling.
 */
export function useAwaitingReturns(
  warehouseId: string | null,
  /** Story 1-5a — the screen's active-client filter; pending sends nothing. */
  clientFilter: ClientFilter,
): ResourceState<AwaitingReturnsPage> & Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const pending = clientFilter === CLIENT_PENDING;
  const clientId: string | null = clientFilter === CLIENT_PENDING ? null : clientFilter;
  const clientEpoch = useClientEpoch(clientId, pending);
  const scope =
    tenantId === null || warehouseId === null || pending ? null : `${tenantId}|${warehouseId}|${clientId ?? '*'}#${clientEpoch}`;
  const [requested, setRequested] = useState<{ scope: string; cursor: string | null } | null>(null);
  const activeCursor = requested !== null && requested.scope === scope ? requested.cursor : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    scope: string;
    requested: string | null;
    state: ResourceState<AwaitingReturnsPage>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(RETURNS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(RETURNS_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || warehouseId === null || scope === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListAwaitingReturns(tenantId, {
          warehouseId,
          limit: AWAITING_PAGE_LIMIT,
          ...(clientId === null ? {} : { clientId }),
          ...(activeCursor === null ? {} : { cursor: activeCursor }),
        });
        if (!cancelled) {
          setResult({
            scope,
            requested: activeCursor,
            state: { state: 'ready', data: { items: page.items, nextCursor: page.nextCursor ?? null } },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({ scope, requested: activeCursor, state: { state: 'failed', reason: readReason(error, 'the returns awaiting a decision') } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, clientId, scope, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (scope === null) return;
      setRequested({ scope, cursor });
    },
    [scope],
  );
  const reload = useCallback(() => {
    setResult(null);
    setRequested(null);
    setRevision((r) => r + 1);
  }, []);

  const stale = scope === null || result === null || result.scope !== scope || result.requested !== activeCursor;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload };
}
