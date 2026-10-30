'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import {
  fetchApiGetClientReturn,
  fetchApiListClientReturns,
  fetchApiReturnableToClient,
  type ClientReturnStatusFilter,
} from '@/lib/api/client';
import type { ClientReturnDto, ClientReturnSummaryDto, ReturnableToClientResponse } from '@/lib/api/generated';
import { CLIENT_PENDING, clientFilterKey, type ClientFilter } from '@/lib/active-client';
import { readSession, subscribeSession } from '@/lib/auth';
import { rtcReason } from '@/lib/client-returns';
import type { Reloadable, ResourceState } from '@/lib/resource-state';
import { RETURNS_CHANGED_EVENT } from '@/lib/returns';
import { useClientEpoch } from '@/lib/use-client-epoch';

/**
 * Story 4-7c — the To client tab's reads, each a `ResourceState` hook (guide
 * §1), the 2-8b shape: the scope stamped into the requested cursor and the
 * result, filtered at render; `cancelled` in the cleanup; `reload()` clearing
 * first. Every RTC mutation fires `notifyReturnsDisposed()` (it moves a
 * receipt line's open quantity and an RMA's split), so the list, the open
 * detail, the returnable read and the awaiting queue re-read on
 * `RETURNS_CHANGED_EVENT`.
 */

function useTenantId(): string | null {
  return useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
}

function useReturnsRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(RETURNS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(RETURNS_CHANGED_EVENT, onChange);
  }, []);
  return revision;
}

export interface ClientReturnsPage {
  readonly items: readonly ClientReturnSummaryDto[];
  readonly nextCursor: string | null;
}

/**
 * One warehouse's returns to client, newest first, on `DataTable` Prev/Next,
 * under the status filter (null = every status) and the active-client filter
 * (§1.12). `reload()` returns to page one and bumps `epoch`, which the
 * table's key joins (§1.11).
 */
export function useClientReturns(
  warehouseId: string | null,
  status: ClientReturnStatusFilter | null,
  clientFilter: ClientFilter,
): ResourceState<ClientReturnsPage> & Reloadable & { onCursor: (cursor: string | null) => void; epoch: number } {
  const tenantId = useTenantId();
  const pending = clientFilter === CLIENT_PENDING;
  const clientId: string | null = clientFilter === CLIENT_PENDING ? null : clientFilter;
  const clientEpoch = useClientEpoch(clientId, pending);
  const scope = `${tenantId ?? '-'}|${warehouseId ?? '-'}|${status ?? '*'}|${clientFilterKey(clientFilter)}#${clientEpoch}`;
  const [epoch, setEpoch] = useState(0);
  const revision = useReturnsRevision();
  const [requested, setRequested] = useState<{ scope: string; epoch: number; cursor: string | null } | null>(null);
  const activeCursor = requested !== null && requested.scope === scope && requested.epoch === epoch ? requested.cursor : null;
  const [result, setResult] = useState<{
    scope: string;
    epoch: number;
    cursor: string | null;
    state: ResourceState<ClientReturnsPage>;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null || warehouseId === null || pending) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListClientReturns(tenantId, {
          warehouseId,
          ...(clientId === null ? {} : { clientId }),
          ...(status === null ? {} : { status }),
          ...(activeCursor === null ? {} : { cursor: activeCursor }),
        });
        if (!cancelled) {
          setResult({ scope, epoch, cursor: activeCursor, state: { state: 'ready', data: { items: page.items, nextCursor: page.nextCursor ?? null } } });
        }
      } catch (error) {
        if (!cancelled) setResult({ scope, epoch, cursor: activeCursor, state: { state: 'failed', reason: rtcReason(error, 'read') } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, status, clientId, pending, scope, activeCursor, revision, epoch]);

  const onCursor = useCallback((cursor: string | null) => setRequested({ scope, epoch, cursor }), [scope, epoch]);
  const reload = useCallback(() => {
    setRequested(null);
    setEpoch((e) => e + 1);
  }, []);
  // A revision bump (a returns change) keeps the old rows while the re-read is in flight.
  const stale =
    tenantId === null ||
    warehouseId === null ||
    pending ||
    result === null ||
    result.scope !== scope ||
    result.cursor !== activeCursor ||
    result.epoch !== epoch;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload, epoch };
}

/** One return to client (the detail panel and the note). Re-read on a returns change; `null` reads nothing. */
export function useClientReturn(clientReturnId: string | null): ResourceState<ClientReturnDto> & Reloadable {
  const tenantId = useTenantId();
  const changes = useReturnsRevision();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; state: ResourceState<ClientReturnDto> } | null>(null);
  const key = tenantId === null || clientReturnId === null ? null : `${tenantId}|${clientReturnId}|${revision}.${changes}`;

  useEffect(() => {
    if (tenantId === null || clientReturnId === null || key === null) return;
    let cancelled = false;
    (async () => {
      try {
        const rtc = await fetchApiGetClientReturn(tenantId, clientReturnId);
        if (!cancelled) setResult({ key, state: { state: 'ready', data: rtc } });
      } catch (error) {
        if (!cancelled) setResult({ key, state: { state: 'failed', reason: rtcReason(error, 'read') } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, clientReturnId, key]);

  const reload = useCallback(() => setRevision((r) => r + 1), []);
  // The last-good detail stays on screen while a change re-reads it (no blanking on every write).
  const same = (a: string, b: string) => a.split('|').slice(0, 2).join('|') === b.split('|').slice(0, 2).join('|');
  const keep = result !== null && key !== null && result.state.state === 'ready' && same(result.key, key);
  const state = result === null || key === null ? null : result.key === key ? result.state : keep ? result.state : null;
  return { ...(state === null ? ({ state: 'loading' } as const) : state), reload };
}

/**
 * What one client can send home from one warehouse (the create dialog): its
 * awaiting receipt lines and its DAMAGED arms after RTV and RTC claims.
 * `clientId` '' reads nothing. Re-read on a returns change and by `reload()`.
 */
export function useReturnableToClient(warehouseId: string | null, clientId: string): ResourceState<ReturnableToClientResponse> & Reloadable {
  const tenantId = useTenantId();
  const changes = useReturnsRevision();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; state: ResourceState<ReturnableToClientResponse> } | null>(null);
  const key = tenantId === null || warehouseId === null || clientId === '' ? null : `${tenantId}|${warehouseId}|${clientId}|${revision}.${changes}`;

  useEffect(() => {
    if (tenantId === null || warehouseId === null || clientId === '' || key === null) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchApiReturnableToClient(tenantId, warehouseId, clientId);
        if (!cancelled) setResult({ key, state: { state: 'ready', data } });
      } catch (error) {
        if (!cancelled) setResult({ key, state: { state: 'failed', reason: rtcReason(error, 'read') } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, clientId, key]);

  const reload = useCallback(() => setRevision((r) => r + 1), []);
  // The last-good read of the same client stays while a returns change re-reads it (the dialog never blanks under a draft).
  const scopeOf = (k: string) => k.split('|').slice(0, 3).join('|');
  const keep = result !== null && key !== null && result.state.state === 'ready' && scopeOf(result.key) === scopeOf(key);
  const state = result === null || key === null ? null : result.key === key || keep ? result.state : null;
  return { ...(state === null ? ({ state: 'loading' } as const) : state), reload };
}
