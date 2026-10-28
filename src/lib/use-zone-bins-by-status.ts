'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { ApiProblem, fetchApiListBins } from '@/lib/api/client';
import type { BinResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { binMatchesStatus, type BinStatusFilter } from '@/lib/bin-block';
import { MAX_PAGE_HOPS } from '@/lib/fetch-all-pages';
import type { Reloadable, ResourceState } from '@/lib/resource-state';
import { ZONES_CHANGED_EVENT } from '@/lib/zones';

export interface ZoneBinsByStatus {
  /** The zone's bins passing the filter, in the server's order. */
  readonly items: readonly BinResponse[];
  /** True when the walk stopped at `MAX_PAGE_HOPS` with pages left — the list may miss bins. */
  readonly truncated: boolean;
}

/**
 * Story 3-3b — the Status filter (Active / Blocked) over a WHOLE zone. The
 * bins list has no status filter on the server, so a filter applied to the
 * one page shown would hide a blocked bin sitting on page 4. The hook walks
 * the zone's keyset chain (inline, bounded at `MAX_PAGE_HOPS`, with a
 * `truncated` flag — guide §1.2: a cut-off walk must not read as "no blocked
 * bins") and filters it. `all` reads nothing: the paged list serves it. No
 * zone (or no session or warehouse) reads nothing and answers an empty list. Refetches on `ZONES_CHANGED_EVENT` and on `reload()`.
 */
export function useZoneBinsByStatus(
  warehouseId: string | null,
  zoneId: string | null,
  filter: BinStatusFilter,
): ResourceState<ZoneBinsByStatus> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    warehouseId: string;
    zoneId: string;
    filter: BinStatusFilter;
    revision: number;
    state: ResourceState<ZoneBinsByStatus>;
  } | null>(null);
  const active = filter !== 'all';

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(ZONES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(ZONES_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (!active || tenantId === null || warehouseId === null || zoneId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const items: BinResponse[] = [];
        let cursor: string | undefined;
        let truncated = false;
        for (let hops = 0; ; hops++) {
          if (hops === MAX_PAGE_HOPS) {
            truncated = true;
            break;
          }
          const page = await fetchApiListBins(tenantId, warehouseId, zoneId, cursor === undefined ? undefined : { cursor });
          items.push(...page.items.filter((bin) => binMatchesStatus(bin, filter)));
          if (!page.nextCursor) break;
          cursor = page.nextCursor;
        }
        if (!cancelled) {
          setResult({ tenantId, warehouseId, zoneId, filter, revision, state: { state: 'ready', data: { items, truncated } } });
        }
      } catch (error) {
        if (!cancelled) {
          const reason =
            error instanceof ApiProblem
              ? (error.detail ?? `The bins could not be read (${error.code}).`)
              : 'The API is unreachable — is wms-be running?';
          setResult({ tenantId, warehouseId, zoneId, filter, revision, state: { state: 'failed', reason } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, tenantId, warehouseId, zoneId, filter, revision]);

  // reload() bumps the revision; the stale check below hides the old result
  // (a failure included) until the new one lands — no setState in an effect.
  const reload = useCallback(() => setRevision((r) => r + 1), []);

  // Nothing to read (no zone yet, no session, no warehouse): an empty list,
  // never a "loading" that would spin forever.
  if (active && (tenantId === null || warehouseId === null || zoneId === null)) {
    return { state: 'ready', data: { items: [], truncated: false }, reload };
  }
  const stale =
    !active ||
    tenantId === null ||
    warehouseId === null ||
    zoneId === null ||
    result === null ||
    result.tenantId !== tenantId ||
    result.warehouseId !== warehouseId ||
    result.zoneId !== zoneId ||
    result.filter !== filter ||
    result.revision !== revision;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}
