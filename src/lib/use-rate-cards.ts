'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListRateCards, fetchApiRateCardInForce } from '@/lib/api/client';
import type { RateCardDto, RateCardInForceResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { readReason } from '@/lib/outbound-orders';
import { RATE_CARDS_CHANGED_EVENT } from '@/lib/rate-cards';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

/** One client's cards plus the server's answer to "which is in force now". */
export interface RateCardsView {
  readonly items: readonly RateCardDto[];
  readonly inForce: RateCardInForceResponse;
}

/**
 * Story 21-3 — a client's rate cards, in the house `ResourceState &
 * Reloadable` shape (`use-clients.ts`): the tenant through
 * `useSyncExternalStore`, a `useEffect` fetch keyed on the tenant AND the
 * client with `cancelled` in the cleanup, the stale (other-scope) result
 * filtered at render, and `reload()` clearing first. Refetches on
 * `RATE_CARDS_CHANGED_EVENT`.
 *
 * The list and the in-force read are fetched together: the "In force"
 * highlight and every Scheduled/Ended label are derived from the SERVER's
 * `asOf`, never the browser clock.
 */
export function useRateCards(clientId: string | null): ResourceState<RateCardsView> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    clientId: string;
    state: ResourceState<RateCardsView>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(RATE_CARDS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(RATE_CARDS_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || clientId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const [list, inForce] = await Promise.all([
          fetchApiListRateCards(tenantId, clientId),
          fetchApiRateCardInForce(tenantId, clientId),
        ]);
        if (!cancelled) {
          setResult({ tenantId, clientId, state: { state: 'ready', data: { items: list.items, inForce } } });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({ tenantId, clientId, state: { state: 'failed', reason: readReason(error, 'the rate cards') } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, clientId, revision]);

  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);
  const stale =
    tenantId === null || clientId === null || result === null || result.tenantId !== tenantId || result.clientId !== clientId;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}
