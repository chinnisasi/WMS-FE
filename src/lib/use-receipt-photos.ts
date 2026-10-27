'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiListReceiptPhotos } from '@/lib/api/client';
import type { ReceiptPhotosResponse } from '@/lib/api/generated';
import { INBOUND_CHANGED_EVENT } from '@/lib/asns';
import { readSession, subscribeSession } from '@/lib/auth';
import { photosReadReason } from '@/lib/receipt-photos';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

/**
 * Story 2-5a — one goods receipt's damage photos, for the photos dialog.
 *
 * The house loader shape (guide §1): the scope stamped into the result and
 * filtered at render, `cancelled` in the effect cleanup, an inbound change
 * refetching, and a `reload()` that clears first (Retry is visibly in
 * flight). Two additions:
 *
 * - `refresh()` refetches QUIETLY — the last-good photos stay on screen
 *   until the answer lands — and returns a promise, so the expired-URL
 *   refresher (A28) can dedupe on it. A failed quiet refresh keeps the
 *   last-good list (its URLs simply stay broken; the tile offers Retry).
 * - Every fetch, effect or imperative, takes a sequence number, and only
 *   the newest one may land (guide §1.3): a refresh fired from an image
 *   error has no effect cleanup to cancel it.
 */
export function useReceiptPhotos(
  grnId: string | null,
): ResourceState<ReceiptPhotosResponse> & Reloadable & { refresh: () => Promise<void> } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ tenantId: string; grnId: string; state: ResourceState<ReceiptPhotosResponse> } | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(INBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(INBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || grnId === null) return;
    let cancelled = false;
    const mine = ++seq.current;
    (async () => {
      try {
        const data = await fetchApiListReceiptPhotos(tenantId, grnId);
        if (!cancelled && mine === seq.current) setResult({ tenantId, grnId, state: { state: 'ready', data } });
      } catch (error) {
        if (!cancelled && mine === seq.current) setResult({ tenantId, grnId, state: { state: 'failed', reason: photosReadReason(error) } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, grnId, revision]);

  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);

  const refresh = useCallback(async () => {
    if (tenantId === null || grnId === null) return;
    const mine = ++seq.current;
    try {
      const data = await fetchApiListReceiptPhotos(tenantId, grnId);
      if (mine === seq.current) setResult({ tenantId, grnId, state: { state: 'ready', data } });
    } catch {
      // Quiet: the last-good list stays; a broken tile offers its own Retry.
    }
  }, [tenantId, grnId]);

  const stale = tenantId === null || grnId === null || result === null || result.tenantId !== tenantId || result.grnId !== grnId;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload, refresh };
}
