'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListWebhookEndpoints } from '@/lib/api/client';
import type { WebhookEndpointListResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { webhooksReadReason } from '@/lib/client-webhooks';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

/**
 * Story 5-2a — one client's webhook endpoints (and the server's
 * `webhooks-unavailable` warning), in the `useClientContacts` shape: the
 * tenant through the session subscription, a `cancelled` cleanup, the result
 * stamped with its (tenant, client) scope, `reload()` clearing first (a
 * visible Retry) and `refresh()` re-reading after a write without blanking.
 */
export function useClientWebhooks(
  clientId: string,
): ResourceState<WebhookEndpointListResponse> & Reloadable & { refresh: () => void } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ tenantId: string; clientId: string; state: ResourceState<WebhookEndpointListResponse> } | null>(null);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchApiListWebhookEndpoints(tenantId, clientId);
        if (!cancelled) setResult({ tenantId, clientId, state: { state: 'ready', data } });
      } catch (error) {
        if (!cancelled) setResult({ tenantId, clientId, state: { state: 'failed', reason: webhooksReadReason(error) } });
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
