'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListChannelConnections } from '@/lib/api/client';
import type { ChannelConnectionListEntryDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { CHANNELS_CHANGED_EVENT, channelListReason } from '@/lib/channels';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

/**
 * The channels surface's read (story 7-1, the replenishment hooks' shape):
 * the tenant's connections with their sync health, session identity through
 * `useSyncExternalStore`, a `useEffect` fetch, a `revision` counter bumped
 * by the module's window event (and by `reload()`), and stale results
 * (tenant changed) filtered at render. The list read is not cursor-paginated
 * on the wire (the connection set is tens at most, one per provider).
 *
 * The explicit `failed` arm is the house rule: a list that could not load
 * must not render forever as "Loading…" — the connection card column is
 * exactly the surface a silent failure would fake as "no channels
 * connected".
 */
export function useChannelConnections(): ResourceState<
  readonly ChannelConnectionListEntryDto[]
> &
  Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    state: ResourceState<readonly ChannelConnectionListEntryDto[]>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(CHANNELS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CHANNELS_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetchApiListChannelConnections(tenantId);
        if (!cancelled) {
          setResult({
            tenantId,
            state: { state: 'ready', data: response.items },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({
            tenantId,
            state: { state: 'failed', reason: channelListReason(error) },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, revision]);

  // Clearing the result first is what makes Retry visible (the waves shape).
  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);

  const stale = tenantId === null || result === null || result.tenantId !== tenantId;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}