import {
  fetchApiListBatchAlerts,
  fetchApiListEwayBills,
  fetchApiListGoodsReceipts,
  fetchApiListInvoices,
  fetchApiListLedgerEvents,
  fetchApiListOrders,
  fetchApiListOverReceipts,
  fetchApiListPutawayTasks,
} from '@/lib/api/client';
import {
  drillFilter,
  type BatchAlertsDrill,
  type EwayDrill,
  type GrnsDrill,
  type InvoicesDrill,
  type LedgerDrill,
  type OrdersDrill,
  type OverReceiptsDrill,
  type PutawayDrill,
} from '@/lib/drill';

/**
 * Story 9-1b — one drilled page of each list: the drill's whole filter,
 * exactly, plus the opaque cursor passed back verbatim. These are the ONLY
 * calls a drilled section makes for its rows; the screen's own tab, status
 * and kind state never reach them. A path-scoped list (ledger, orders) puts
 * the drill's warehouse in the path; every other list sends it as a query.
 *
 * `drill.test.ts` drives each one through a stubbed `fetch` and pins that the
 * request carries exactly the link's keys and values.
 */

const withCursor = (cursor: string | null) => (cursor === null ? {} : { cursor });

/**
 * Story 9-3a — a document drill's `doc` and `label` are display-only (the
 * banner's words): they are stripped here, so the request carries exactly the
 * filter keys the backend knows (an unknown one would be a 400).
 */
export function fetchLedgerDrill(tenantId: string, drill: LedgerDrill, cursor: string | null) {
  const { warehouseId, doc: _doc, label: _label, ...query } = drillFilter(drill);
  void _doc;
  void _label;
  return fetchApiListLedgerEvents(tenantId, warehouseId, { ...query, ...withCursor(cursor) });
}

export function fetchOrdersDrill(tenantId: string, drill: OrdersDrill, cursor: string | null) {
  const { warehouseId, ...query } = drillFilter(drill);
  return fetchApiListOrders(tenantId, warehouseId, { ...query, ...withCursor(cursor) });
}

export function fetchOverReceiptsDrill(tenantId: string, drill: OverReceiptsDrill, cursor: string | null) {
  return fetchApiListOverReceipts(tenantId, { ...drillFilter(drill), ...withCursor(cursor) });
}

export function fetchGrnsDrill(tenantId: string, drill: GrnsDrill, cursor: string | null) {
  return fetchApiListGoodsReceipts(tenantId, { ...drillFilter(drill), ...withCursor(cursor) });
}

/** Unpaged — the task route returns `{items}` and takes the warehouse alone. */
export function fetchPutawayDrill(tenantId: string, drill: PutawayDrill) {
  return fetchApiListPutawayTasks(tenantId, drill.warehouseId);
}

export function fetchBatchAlertsDrill(tenantId: string, drill: BatchAlertsDrill, cursor: string | null) {
  return fetchApiListBatchAlerts(tenantId, { ...drillFilter(drill), ...withCursor(cursor) });
}

export function fetchEwayDrill(tenantId: string, drill: EwayDrill, cursor: string | null) {
  return fetchApiListEwayBills(tenantId, { ...drillFilter(drill), ...withCursor(cursor) });
}

export function fetchInvoicesDrill(tenantId: string, drill: InvoicesDrill, cursor: string | null) {
  return fetchApiListInvoices(tenantId, { ...drillFilter(drill), ...withCursor(cursor) });
}
