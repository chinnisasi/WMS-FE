'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import {
  fetchApiGetVendorReturn,
  fetchApiListVendorReturns,
  fetchApiReturnableDamaged,
  type VendorReturnStatusFilter,
} from '@/lib/api/client';
import type { ReturnableDamagedResponse, VendorReturnDto, VendorReturnSummaryDto } from '@/lib/api/generated';
import { CLIENT_PENDING, clientFilterKey, type ClientFilter } from '@/lib/active-client';
import { INBOUND_CHANGED_EVENT } from '@/lib/asns';
import { readSession, subscribeSession } from '@/lib/auth';
import type { Reloadable, ResourceState } from '@/lib/resource-state';
import { useClientEpoch } from '@/lib/use-client-epoch';
import { rtvReason } from '@/lib/vendor-returns';

/**
 * Story 2-8b — the Returns to vendor tab's reads, each a `ResourceState`
 * hook (guide §1): the scope stamped into the requested cursor and the
 * result, filtered at render; `cancelled` in the cleanup; `reload()` clearing
 * first. Every RTV mutation fires `notifyInboundChanged()` (the list, the open
 * detail, the returnable read and the tab count re-read).
 */

function useTenantId(): string | null {
  return useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
}

export interface VendorReturnsPage {
  readonly items: readonly VendorReturnSummaryDto[];
  readonly nextCursor: string | null;
}

/**
 * One warehouse's returns to vendor, newest first, on `DataTable` Prev/Next,
 * under the status filter (null = every status) and the active-client filter
 * (§1.12 — the client and its epoch join every stamp). `reload()` returns to
 * page one and bumps `epoch`, which the table's key joins (§1.11).
 */
export function useVendorReturns(
  warehouseId: string | null,
  status: VendorReturnStatusFilter | null,
  clientFilter: ClientFilter,
): ResourceState<VendorReturnsPage> & Reloadable & { onCursor: (cursor: string | null) => void; epoch: number } {
  const tenantId = useTenantId();
  const pending = clientFilter === CLIENT_PENDING;
  const clientId: string | null = clientFilter === CLIENT_PENDING ? null : clientFilter;
  const clientEpoch = useClientEpoch(clientId, pending);
  const scope = `${tenantId ?? '-'}|${warehouseId ?? '-'}|${status ?? '*'}|${clientFilterKey(clientFilter)}#${clientEpoch}`;
  const [epoch, setEpoch] = useState(0);
  const [revision, setRevision] = useState(0);
  const [requested, setRequested] = useState<{ scope: string; epoch: number; cursor: string | null } | null>(null);
  const activeCursor = requested !== null && requested.scope === scope && requested.epoch === epoch ? requested.cursor : null;
  const [result, setResult] = useState<{
    scope: string;
    epoch: number;
    cursor: string | null;
    state: ResourceState<VendorReturnsPage>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(INBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(INBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || warehouseId === null || pending) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListVendorReturns(tenantId, {
          warehouseId,
          ...(clientId === null ? {} : { clientId }),
          ...(status === null ? {} : { status }),
          ...(activeCursor === null ? {} : { cursor: activeCursor }),
        });
        if (!cancelled) {
          setResult({ scope, epoch, cursor: activeCursor, state: { state: 'ready', data: { items: page.items, nextCursor: page.nextCursor ?? null } } });
        }
      } catch (error) {
        if (!cancelled) setResult({ scope, epoch, cursor: activeCursor, state: { state: 'failed', reason: rtvReason(error, 'read') } });
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
  // A revision bump (an inbound change) keeps the old rows while the re-read is in flight.
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

/** One return to vendor (the detail panel and the note). Re-read on an inbound change; `null` reads nothing. */
export function useVendorReturn(vendorReturnId: string | null): ResourceState<VendorReturnDto> & Reloadable {
  const tenantId = useTenantId();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; state: ResourceState<VendorReturnDto> } | null>(null);
  const key = tenantId === null || vendorReturnId === null ? null : `${tenantId}|${vendorReturnId}|${revision}`;

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(INBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(INBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || vendorReturnId === null || key === null) return;
    let cancelled = false;
    (async () => {
      try {
        const rtv = await fetchApiGetVendorReturn(tenantId, vendorReturnId);
        if (!cancelled) setResult({ key, state: { state: 'ready', data: rtv } });
      } catch (error) {
        if (!cancelled) setResult({ key, state: { state: 'failed', reason: rtvReason(error, 'read') } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, vendorReturnId, key]);

  const reload = useCallback(() => setRevision((r) => r + 1), []);
  // The last-good detail stays on screen while an inbound change re-reads it (no blanking on every write).
  const keep = result !== null && key !== null && result.state.state === 'ready' && result.key.split('|').slice(0, 2).join('|') === key.split('|').slice(0, 2).join('|');
  const state = result === null || key === null ? null : result.key === key ? result.state : keep ? result.state : null;
  return { ...(state === null ? ({ state: 'loading' } as const) : state), reload };
}

/**
 * One client's returnable DAMAGED arms in one warehouse (the create dialog).
 * `clientId` '' reads nothing. Re-read on an inbound change and by `reload()`
 * (after a cap refusal — the figures moved).
 */
export function useReturnableDamaged(
  warehouseId: string | null,
  clientId: string,
  skuId: string | null,
): ResourceState<ReturnableDamagedResponse> & Reloadable {
  const tenantId = useTenantId();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; state: ResourceState<ReturnableDamagedResponse> } | null>(null);
  const key =
    tenantId === null || warehouseId === null || clientId === '' ? null : `${tenantId}|${warehouseId}|${clientId}|${skuId ?? '*'}|${revision}`;

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(INBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(INBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || warehouseId === null || clientId === '' || key === null) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchApiReturnableDamaged(tenantId, warehouseId, clientId, skuId === null ? undefined : { skuId });
        if (!cancelled) setResult({ key, state: { state: 'ready', data } });
      } catch (error) {
        if (!cancelled) setResult({ key, state: { state: 'failed', reason: rtvReason(error, 'read') } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, clientId, skuId, key]);

  const reload = useCallback(() => setRevision((r) => r + 1), []);
  return { ...(result === null || result.key !== key ? ({ state: 'loading' } as const) : result.state), reload };
}
