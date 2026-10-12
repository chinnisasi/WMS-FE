'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiAuditTrail, fetchApiListUsers } from '@/lib/api/client';
import type { AuditEventDto, UserResponse } from '@/lib/api/generated';
import { auditFilterKey, auditReason, type AuditFilterQuery } from '@/lib/audit';
import { readSession, subscribeSession } from '@/lib/auth';
import { fetchAllPages } from '@/lib/fetch-all-pages';
import { readReason } from '@/lib/outbound-orders';
import type { Reloadable, ResourceState } from '@/lib/resource-state';
import { USERS_CHANGED_EVENT } from '@/lib/users';

export interface AuditTrailPage {
  readonly items: readonly AuditEventDto[];
  readonly nextCursor: string | null;
  /** The backend's system actor id — the "System" actor filter sends it. */
  readonly systemActorId: string;
}

/**
 * Story 9-3a — one page of the audit trail for the `/reports` Audit section,
 * in the house `ResourceState & Reloadable` shape (`use-outbound-waves.ts`).
 *
 * The requested cursor is STAMPED with the filter tuple it was paged under
 * (the `useQcHolds` pattern): a filter change makes the stale cursor a
 * first-page request, never a page of the old filter's keyset under the new
 * one. The result is filtered at render on the same stamp, and `reload()`
 * clears first AND drops the requested cursor — Retry reads page 1 again,
 * and `epoch` (bumped on every reload) keys the table so its Prev/Next stack
 * restarts with it: the hook's cursor and the table's never disagree.
 * `query === null` (a draft the parse refused) reads nothing.
 */
export function useAuditTrail(
  query: AuditFilterQuery | null,
): ResourceState<AuditTrailPage> & Reloadable & { onCursor: (cursor: string | null) => void; epoch: number } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const filterKey = auditFilterKey(query);
  const scope = tenantId === null || query === null ? null : `${tenantId}|${filterKey}`;
  const [requested, setRequested] = useState<{ scope: string; cursor: string | null } | null>(null);
  const activeCursor = requested !== null && requested.scope === scope ? requested.cursor : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ scope: string; cursor: string | null; state: ResourceState<AuditTrailPage> } | null>(null);

  useEffect(() => {
    if (scope === null || tenantId === null || query === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiAuditTrail(tenantId, query, activeCursor === null ? undefined : { cursor: activeCursor });
        if (!cancelled) {
          setResult({
            scope,
            cursor: activeCursor,
            state: {
              state: 'ready',
              data: { items: page.items, nextCursor: page.nextCursor ?? null, systemActorId: page.systemActorId },
            },
          });
        }
      } catch (error) {
        if (!cancelled) setResult({ scope, cursor: activeCursor, state: { state: 'failed', reason: auditReason(error) } });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `scope` carries the tenant and every filter the fetch reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (scope !== null) setRequested({ scope, cursor });
    },
    [scope],
  );
  const reload = useCallback(() => {
    setResult(null);
    setRequested(null);
    setRevision((r) => r + 1);
  }, []);
  const stale = scope === null || result === null || result.scope !== scope || result.cursor !== activeCursor;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload, epoch: revision };
}

/**
 * Story 9-3a — the tenant's members for the actor filter and the Who column:
 * the whole user list through `fetchAllPages` (capped at its 20 hops — 1,000
 * members at the list's page size), with a `failed` arm the section renders
 * (unlike `useUserMap`, which stays silent). Refetches on the users broadcaster.
 */
export function useAuditMembers(): ResourceState<readonly UserResponse[]> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ tenantId: string; state: ResourceState<readonly UserResponse[]> } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(USERS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(USERS_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const users = await fetchAllPages<UserResponse>((options) => fetchApiListUsers(tenantId, options));
        if (!cancelled) setResult({ tenantId, state: { state: 'ready', data: users } });
      } catch (error) {
        if (!cancelled) setResult({ tenantId, state: { state: 'failed', reason: readReason(error, 'members') } });
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
