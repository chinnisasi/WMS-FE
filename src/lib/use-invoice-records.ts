'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiClientInvoiceLineRecords } from '@/lib/api/client';
import type { LineRecordsSummaryDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { RECORDS_PAGE_LIMIT, lineRecordsReason, needsInvoiceReload, type ClientInvoiceStatus, type LineRecord, type LineRecordKind } from '@/lib/invoice-records';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

/**
 * Story 21-5b — one client-invoice line's records, in the house shape
 * (frontend guide §1): session identity through `useSyncExternalStore`, the
 * first page fetched in an effect with `cancelled` in the cleanup, the result
 * stamped with the scope it was fetched for and filtered at render, an
 * explicit `failed` arm, and `reload()` clearing first.
 *
 * Paging is "Load more" (no infinite scroll): `loadMore()` is fired from a
 * click, so it carries the seq guard (§1.3) in both arms, and appends the
 * next keyset page. Its failure is kept apart from the page already shown.
 */

export interface LineRecordsView {
  readonly kind: LineRecordKind;
  readonly invoiceStatus: ClientInvoiceStatus;
  /** From the first page (the server sends it only there). */
  readonly summary: LineRecordsSummaryDto | null;
  readonly records: readonly LineRecord[];
  readonly nextCursor: string | null;
}

export function useLineRecords(
  invoiceId: string,
  lineId: string,
  status: ClientInvoiceStatus,
): ResourceState<LineRecordsView> &
  Reloadable & {
    readonly loadMore: () => void;
    readonly loadingMore: boolean;
    readonly moreError: { reason: string; invoiceChanged: boolean } | null;
    /** The first page was refused because the draft was refreshed (404 on a draft): reload the invoice. */
    readonly invoiceChanged: boolean;
  } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  // The status is part of the scope: a status change refetches, and nothing
  // read under the old status (a late "more" page, its error) survives it.
  const scope = `${tenantId ?? ''}|${invoiceId}|${lineId}|${status}`;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ scope: string; revision: number; state: ResourceState<LineRecordsView>; invoiceChanged: boolean } | null>(null);
  const [more, setMore] = useState<{ scope: string; revision: number; loading: boolean; error: { reason: string; invoiceChanged: boolean } | null } | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (tenantId === null) return;
    // A first-page read supersedes any "more" still in flight (its page would
    // merge into the wrong first page); the old more-state is filtered out at
    // render by its (scope, revision) stamp.
    seq.current += 1;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiClientInvoiceLineRecords(tenantId, invoiceId, lineId, { limit: RECORDS_PAGE_LIMIT });
        if (!cancelled) {
          setResult({
            scope,
            revision,
            invoiceChanged: false,
            state: {
              state: 'ready',
              data: { kind: page.kind, invoiceStatus: page.invoiceStatus, summary: page.summary ?? null, records: page.records, nextCursor: page.nextCursor },
            },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({ scope, revision, invoiceChanged: needsInvoiceReload(error, status), state: { state: 'failed', reason: lineRecordsReason(error, status) } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, invoiceId, lineId, scope, revision, status]);

  const fresh = tenantId !== null && result !== null && result.scope === scope && result.revision === revision ? result : null;
  const current = fresh === null ? null : fresh.state;

  const loadMore = useCallback(() => {
    if (tenantId === null || current === null || current.state !== 'ready' || current.data.nextCursor === null) return;
    const base = current.data;
    const cursor = base.nextCursor!;
    const mine = ++seq.current;
    setMore({ scope, revision, loading: true, error: null });
    (async () => {
      try {
        const page = await fetchApiClientInvoiceLineRecords(tenantId, invoiceId, lineId, { cursor, limit: RECORDS_PAGE_LIMIT });
        if (mine !== seq.current) return;
        setResult({
          scope,
          revision,
          invoiceChanged: false,
          state: { state: 'ready', data: { ...base, records: [...base.records, ...page.records], nextCursor: page.nextCursor } },
        });
        setMore({ scope, revision, loading: false, error: null });
      } catch (error) {
        if (mine !== seq.current) return;
        setMore({ scope, revision, loading: false, error: { reason: lineRecordsReason(error, status), invoiceChanged: needsInvoiceReload(error, status) } });
      }
    })();
  }, [tenantId, current, scope, invoiceId, lineId, revision, status]);

  const reload = useCallback(() => {
    seq.current += 1;
    setResult(null);
    setMore(null);
    setRevision((r) => r + 1);
  }, []);

  const moreHere = more !== null && more.scope === scope && more.revision === revision && current !== null ? more : null;
  return {
    ...(current === null ? ({ state: 'loading' } as const) : current),
    reload,
    loadMore,
    loadingMore: moreHere?.loading ?? false,
    moreError: moreHere?.error ?? null,
    invoiceChanged: fresh?.invoiceChanged ?? false,
  };
}
