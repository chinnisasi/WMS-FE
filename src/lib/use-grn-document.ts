'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiGoodsReceiptDocument } from '@/lib/api/client';
import type { GoodsReceiptDocumentDto } from '@/lib/api/generated';
import { INBOUND_CHANGED_EVENT } from '@/lib/asns';
import { readSession, subscribeSession } from '@/lib/auth';
import { readReason } from '@/lib/outbound-orders';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

/**
 * Story 2-9a — one GRN as its document, for the details drawer (the
 * `useGoodsReceiptLines` shape: the scope stamped into the result and
 * filtered at render, `cancelled` in the cleanup, an inbound change
 * refetching quietly). `null` reads nothing.
 */
export function useGoodsReceiptDocument(grnId: string | null): ResourceState<GoodsReceiptDocumentDto> & Reloadable {
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
    state: ResourceState<GoodsReceiptDocumentDto>;
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
        const data = await fetchApiGoodsReceiptDocument(tenantId, grnId);
        if (!cancelled) setResult({ tenantId, grnId, revision, state: { state: 'ready', data } });
      } catch (error) {
        if (!cancelled) setResult({ tenantId, grnId, revision, state: { state: 'failed', reason: readReason(error, 'the goods receipt') } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, grnId, revision]);

  // Story 2-5a — an inbound change refetches QUIETLY (the last-good lines
  // stay until the answer lands: a photo added in the photos dialog must not
  // blank the expanded row behind it); Retry (`reload`) clears first.
  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);
  const stale = tenantId === null || grnId === null || result === null || result.tenantId !== tenantId || result.grnId !== grnId;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}
