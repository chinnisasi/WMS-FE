'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

import {
  fetchApiListAsns,
  fetchApiListGateIns,
  fetchApiListPurchaseOrders,
  fetchApiListPutawayTasks,
  fetchApiListQcHolds,
} from '@/lib/api/client';
import { CLIENT_PENDING, type ClientFilter } from '@/lib/active-client';
import { INBOUND_CHANGED_EVENT } from '@/lib/asns';
import { readSession, subscribeSession } from '@/lib/auth';
import { GATE_IN_PAGE_LIMIT, OPEN_GATE_IN_STATUSES } from '@/lib/gate-ins';
import { sumTabCounts, type CountedInboundTab, type PilledInboundTab, type TabCount } from '@/lib/inbound-tabs';

/** The routes' page-size ceilings (`inbound.dto.ts`, `qc.dto.ts`). */
const PO_PAGE = 200;
const ASN_PAGE = 100;
const QC_PAGE = 200;

export type InboundTabCounts = Partial<Record<PilledInboundTab, TabCount>>;

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
export function useInboundTabCounts(
  warehouseId: string | null,
  /** Story 1-5a — the same active-client filter the tabs' lists take, so a count matches its list. */
  clientFilter: ClientFilter,
): InboundTabCounts {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const pending = clientFilter === CLIENT_PENDING;
  const clientId: string | null = clientFilter === CLIENT_PENDING ? null : clientFilter;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ scope: string; counts: InboundTabCounts } | null>(null);
  const scope =
    tenantId === null || warehouseId === null || pending ? null : `${tenantId}|${warehouseId}|${clientId ?? '*'}|${revision}`;

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(INBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(INBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || warehouseId === null || scope === null) return;
    let cancelled = false;
    const counts: { [K in CountedInboundTab]?: TabCount } = {};
    const client = clientId === null ? {} : { clientId };
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
      fetchApiListPurchaseOrders(tenantId, warehouseId, { status: 'open', limit: PO_PAGE, ...client }).then((r) =>
        page(r.items, r.nextCursor),
      ),
    );
    void settle(
      'asns',
      Promise.all(
        (['announced', 'partially_received'] as const).map((status) =>
          fetchApiListAsns(tenantId, warehouseId, { status, limit: ASN_PAGE, ...client }).then((r) => page(r.items, r.nextCursor)),
        ),
      ).then(sumTabCounts),
    );
    void settle(
      'putaway',
      fetchApiListPutawayTasks(tenantId, warehouseId, client).then((r) => ({ count: r.items.length, more: false })),
    );
    void settle(
      'qc-holds',
      fetchApiListQcHolds(tenantId, { warehouseId, status: 'open', limit: QC_PAGE, ...client }).then((r) =>
        page(r.items, r.nextCursor),
      ),
    );
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, clientId, scope]);

  // Story 2-3a — the Gate-in count: gate-ins not gated out, from ONE
  // multi-status read (`status=gated_in&status=unloading&status=unloaded`,
  // the route's 200 ceiling, "N+" past it). It takes no client — a truck
  // can carry several — so it is scoped and fetched apart from the
  // client-filtered counts and renders while the client filter is pending.
  const gateInScope = tenantId === null || warehouseId === null ? null : `${tenantId}|${warehouseId}|${revision}`;
  const [gateIns, setGateIns] = useState<{ scope: string; count: TabCount } | null>(null);
  useEffect(() => {
    if (tenantId === null || warehouseId === null || gateInScope === null) return;
    let cancelled = false;
    fetchApiListGateIns(tenantId, warehouseId, { status: OPEN_GATE_IN_STATUSES, limit: GATE_IN_PAGE_LIMIT }).then(
      (r) => {
        if (!cancelled) setGateIns({ scope: gateInScope, count: page(r.items, r.nextCursor) });
      },
      // A failed read shows no pill — never a wrong "0".
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, gateInScope]);

  const counts = result !== null && result.scope === scope ? result.counts : {};
  return gateIns !== null && gateIns.scope === gateInScope ? { ...counts, 'gate-ins': gateIns.count } : counts;
}
