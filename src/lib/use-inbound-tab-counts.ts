'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

import {
  fetchApiListAsns,
  fetchApiListPurchaseOrders,
  fetchApiListPutawayTasks,
  fetchApiListQcHolds,
} from '@/lib/api/client';
import { INBOUND_CHANGED_EVENT } from '@/lib/asns';
import { readSession, subscribeSession } from '@/lib/auth';
import { sumTabCounts, type CountedInboundTab, type TabCount } from '@/lib/inbound-tabs';

/** The routes' page-size ceilings (`inbound.dto.ts`, `qc.dto.ts`). */
const PO_PAGE = 200;
const ASN_PAGE = 100;
const QC_PAGE = 200;

export type InboundTabCounts = Partial<Record<CountedInboundTab, TabCount>>;

const page = (items: readonly unknown[], nextCursor: string | null | undefined): TabCount => ({
  count: items.length,
  more: nextCursor !== null && nextCursor !== undefined,
});

/**
 * inbound-tabs — the counts on the Inbound tab bar, for one warehouse. Each
 * count loads on its own: a failed read leaves that tab without a count
 * (never a wrong "0"), and nothing blocks the cards. Re-read on a warehouse
 * switch and on every inbound change event (ASN, QC hold writes).
 */
export function useInboundTabCounts(warehouseId: string | null): InboundTabCounts {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ scope: string; counts: InboundTabCounts } | null>(null);
  const scope = tenantId === null || warehouseId === null ? null : `${tenantId}|${warehouseId}|${revision}`;

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(INBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(INBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || warehouseId === null || scope === null) return;
    let cancelled = false;
    const counts: { [K in CountedInboundTab]?: TabCount } = {};
    const settle = (tab: CountedInboundTab, read: Promise<TabCount>) =>
      read.then(
        (count) => {
          counts[tab] = count;
          if (!cancelled) setResult({ scope, counts: { ...counts } });
        },
        () => undefined,
      );
    void settle(
      'pos',
      fetchApiListPurchaseOrders(tenantId, warehouseId, { status: 'open', limit: PO_PAGE }).then((r) =>
        page(r.items, r.nextCursor),
      ),
    );
    void settle(
      'asns',
      Promise.all(
        (['announced', 'partially_received'] as const).map((status) =>
          fetchApiListAsns(tenantId, warehouseId, { status, limit: ASN_PAGE }).then((r) => page(r.items, r.nextCursor)),
        ),
      ).then(sumTabCounts),
    );
    void settle(
      'putaway',
      fetchApiListPutawayTasks(tenantId, warehouseId).then((r) => ({ count: r.items.length, more: false })),
    );
    void settle(
      'qc-holds',
      fetchApiListQcHolds(tenantId, { warehouseId, status: 'open', limit: QC_PAGE }).then((r) =>
        page(r.items, r.nextCursor),
      ),
    );
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, scope]);

  return result !== null && result.scope === scope ? result.counts : {};
}
