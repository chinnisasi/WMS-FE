'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListGoodsReceiptLines } from '@/lib/api/client';
import type { GoodsReceiptLineEntryDto } from '@/lib/api/generated';
import { INBOUND_CHANGED_EVENT } from '@/lib/asns';
import { readSession, subscribeSession } from '@/lib/auth';
import { readReason } from '@/lib/outbound-orders';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

/**
 * Story 2-4a — one GRN's lines for the expandable GRN row (the
 * `useGateInDetail` shape: the scope stamped into the result and filtered at
 * render, `cancelled` in the cleanup, an inbound change refetching). `null`
 * reads nothing.
 */
export function useGoodsReceiptLines(grnId: string | null): ResourceState<readonly GoodsReceiptLineEntryDto[]> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    grnId: string;
    revision: number;
    state: ResourceState<readonly GoodsReceiptLineEntryDto[]>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(INBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(INBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || grnId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const { items } = await fetchApiListGoodsReceiptLines(tenantId, grnId);
        if (!cancelled) setResult({ tenantId, grnId, revision, state: { state: 'ready', data: items } });
      } catch (error) {
        if (!cancelled) setResult({ tenantId, grnId, revision, state: { state: 'failed', reason: readReason(error, 'the receipt lines') } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, grnId, revision]);

  const reload = useCallback(() => setRevision((r) => r + 1), []);
  const stale =
    tenantId === null || grnId === null || result === null || result.tenantId !== tenantId || result.grnId !== grnId || result.revision !== revision;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}
