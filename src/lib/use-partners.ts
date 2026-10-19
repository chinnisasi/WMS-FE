'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListPartners } from '@/lib/api/client';
import type { PartnerDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { readReason } from '@/lib/outbound-orders';
import { PARTNERS_CHANGED_EVENT } from '@/lib/partners';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

export interface PartnersPage {
  readonly items: readonly PartnerDto[];
  readonly nextCursor: string | null;
}

/**
 * Story 1-3 — the Settings partner list, one keyset page at a time (by code),
 * in the house loader shape (`use-outbound-waves.ts`): session identity
 * through the external store, the requested cursor stamped with its tenant,
 * the stale result filtered at render, a revision bumped by
 * `PARTNERS_CHANGED_EVENT`, and `reload()` clearing first (and returning to
 * page one — the §1.11 epoch, so the table remounts with an empty stack).
 */
export function usePartners(): ResourceState<PartnersPage> & Reloadable & { onCursor: (cursor: string | null) => void; epoch: number } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [requested, setRequested] = useState<{ tenantId: string; cursor: string | null } | null>(null);
  const activeCursor = requested !== null && requested.tenantId === tenantId ? requested.cursor : null;
  const [revision, setRevision] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    requested: string | null;
    revision: number;
    state: ResourceState<PartnersPage>;
  } | null>(null);

  useEffect(() => {
    // A partner mutation can move rows across the keyset: back to page one.
    const onChange = () => {
      setRequested(null);
      setRevision((r) => r + 1);
      setEpoch((e) => e + 1);
    };
    window.addEventListener(PARTNERS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(PARTNERS_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListPartners(tenantId, activeCursor === null ? undefined : { cursor: activeCursor });
        if (!cancelled) {
          setResult({
            tenantId,
            requested: activeCursor,
            revision,
            state: { state: 'ready', data: { items: page.items, nextCursor: page.nextCursor ?? null } },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({ tenantId, requested: activeCursor, revision, state: { state: 'failed', reason: readReason(error, 'the partners') } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId !== null) setRequested({ tenantId, cursor });
    },
    [tenantId],
  );
  const reload = useCallback(() => {
    setResult(null);
    setRequested(null);
    setRevision((r) => r + 1);
    setEpoch((e) => e + 1);
  }, []);

  const stale = tenantId === null || result === null || result.tenantId !== tenantId || result.requested !== activeCursor;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload, epoch };
}
