'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListAsns } from '@/lib/api/client';
import type { AsnEntryDto } from '@/lib/api/generated';
import { INBOUND_CHANGED_EVENT } from '@/lib/asns';
import { readSession, subscribeSession } from '@/lib/auth';
import { readReason } from '@/lib/outbound-orders';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

export interface AsnsPage {
  readonly items: readonly AsnEntryDto[];
  readonly nextCursor: string | null;
}

/**
 * Story 21-6 — one keyset page of the warehouse's advance shipment notices,
 * in the house loader shape (`use-outbound-waves.ts`): session identity
 * through the external store, a cursor stamped with the scope it was asked
 * for, the stale filter at render, `reload()` clearing first, and a refetch
 * on `INBOUND_CHANGED_EVENT`.
 */
export function useAsns(
  warehouseId: string | null,
): ResourceState<AsnsPage> & Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
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
    state: ResourceState<AsnsPage>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(INBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(INBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || warehouseId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListAsns(
          tenantId,
          warehouseId,
          activeCursor === null ? undefined : { cursor: activeCursor },
        );
        if (!cancelled) {
          setResult({
            tenantId,
            warehouseId,
            requested: activeCursor,
            state: { state: 'ready', data: { items: page.items, nextCursor: page.nextCursor ?? null } },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({
            tenantId,
            warehouseId,
            requested: activeCursor,
            state: { state: 'failed', reason: readReason(error, 'advance shipment notices') },
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
