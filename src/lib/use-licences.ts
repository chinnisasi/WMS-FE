'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiLicenceCoverage, fetchApiListLicences } from '@/lib/api/client';
import type { CoverageGapDto, LicenceListItemDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { LICENCES_CHANGED_EVENT, knownGaps, knownLicences, licenceReason } from '@/lib/licences';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

export interface LicencesView {
  /** The IST date the server judged the badges and the gaps for — never the browser's clock. */
  readonly asOfDate: string;
  readonly items: readonly LicenceListItemDto[];
  readonly gaps: readonly CoverageGapDto[];
}

/**
 * Story 1-6c — the tenant's licences and their coverage gaps, read together
 * (one surface shows both), in the house `ResourceState & Reloadable` shape:
 * the tenant through the session subscription, a `cancelled` cleanup, the
 * result stamped with its tenant and filtered at render, `reload()` clearing
 * first (a visible Retry) and `refresh()` re-reading without clearing after a
 * write. Refetches on `LICENCES_CHANGED_EVENT`. Unknown kinds and needs from
 * a newer backend are dropped at the mapping (§1.7).
 */
export function useLicences(): ResourceState<LicencesView> & Reloadable & { refresh: () => void } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ tenantId: string; state: ResourceState<LicencesView> } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(LICENCES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(LICENCES_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const [list, coverage] = await Promise.all([fetchApiListLicences(tenantId), fetchApiLicenceCoverage(tenantId)]);
        if (!cancelled) {
          setResult({
            tenantId,
            state: {
              state: 'ready',
              data: { asOfDate: coverage.asOfDate, items: knownLicences(list.items), gaps: knownGaps(coverage.gaps) },
            },
          });
        }
      } catch (error) {
        if (!cancelled) setResult({ tenantId, state: { state: 'failed', reason: licenceReason(error, 'read') } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, revision]);

  const reload = useCallback(() => {
    setResult(null);
    setRevision((r) => r + 1);
  }, []);
  const refresh = useCallback(() => setRevision((r) => r + 1), []);
  const stale = tenantId === null || result === null || result.tenantId !== tenantId;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload, refresh };
}
