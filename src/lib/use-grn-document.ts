'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { ApiProblem, fetchApiGoodsReceiptDocument } from '@/lib/api/client';
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
export function useGoodsReceiptDocument(grnId: string | null): ResourceState<GoodsReceiptDocumentDto> & Reloadable & { notFound: boolean } {
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
    notFound?: boolean;
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
        if (cancelled) return;
        const failed = {
          tenantId,
          grnId,
          revision,
          state: { state: 'failed', reason: readReason(error, 'the goods receipt') } as const,
          // Decided on the problem CODE, never on the reason's words.
          notFound: error instanceof ApiProblem && error.code === 'not-found',
        };
        // A failed QUIET refetch (an inbound change) keeps the last-good
        // document; Retry (`reload`) clears first, so its failure shows.
        setResult((previous) =>
          previous !== null && previous.tenantId === tenantId && previous.grnId === grnId && previous.state.state === 'ready' ? previous : failed,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, grnId, revision]);

  // An inbound change refetches QUIETLY (the last-good document stays until
  // the answer lands, and stays on a failure); Retry (`reload`) clears first.
  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);
  const stale = tenantId === null || grnId === null || result === null || result.tenantId !== tenantId || result.grnId !== grnId;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload, notFound: !stale && result.notFound === true };
}
