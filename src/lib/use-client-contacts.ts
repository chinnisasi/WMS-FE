'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListClientContacts } from '@/lib/api/client';
import type { ClientContactListItemDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { contactsReadReason } from '@/lib/clients';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

/**
 * Story 1-2a — one client's contacts, in the house `ResourceState &
 * Reloadable` shape (`use-clients.ts`): the tenant through the session
 * subscription, a `cancelled` cleanup, the result stamped with its
 * (tenant, client) scope and filtered at render, and `reload()` clearing the
 * result first so a Retry is visibly in flight. `refresh()` re-reads after a
 * write WITHOUT clearing — the list stays on screen while it updates.
 */
export function useClientContacts(
  clientId: string,
): ResourceState<readonly ClientContactListItemDto[]> & Reloadable & { refresh: () => void } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    clientId: string;
    state: ResourceState<readonly ClientContactListItemDto[]>;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const items = await fetchApiListClientContacts(tenantId, clientId);
        if (!cancelled) setResult({ tenantId, clientId, state: { state: 'ready', data: items } });
      } catch (error) {
        if (!cancelled) setResult({ tenantId, clientId, state: { state: 'failed', reason: contactsReadReason(error) } });
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
  const refresh = useCallback(() => setRevision((r) => r + 1), []);
  const stale = tenantId === null || result === null || result.tenantId !== tenantId || result.clientId !== clientId;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload, refresh };
}
