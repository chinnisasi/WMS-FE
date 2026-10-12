import type {
  EwayControllerListBillsData,
  InventoryControllerListEventsData,
  OutboundControllerListOrdersData,
  ReceivingControllerListOverReceiptsData,
  ReplenishmentControllerListBatchAlertsData,
} from '@/lib/api/generated';

/**
 * Story 9-1b — reading an Overview drill out of the URL.
 *
 * A tile links its screen with the drill's exact query plus `list` (which
 * section) and, for a path-scoped drill, `warehouseId` (`drill-routes.ts`).
 * The route's server `page.tsx` awaits `searchParams` and calls `parseDrill`;
 * the screen renders keyed on `drillKey(...)`, so Clear (a soft navigation
 * back to the bare route) REMOUNTS it — no drilled cursor, cached page or
 * DataTable stack survives into the normal view.
 *
 * A drill is all-or-nothing: an unknown key, a repeated key, a malformed
 * value, or a `list` the screen does not serve makes the whole drill
 * `'unsupported'` — the screen shows its normal view plus a notice. A
 * partially applied filter would list rows that are not the figure's.
 *
 * Every value is carried VERBATIM (instants are never re-formatted, ids
 * never re-cased): the request a drilled list sends is exactly the drill's
 * keys and values, which is what the backend's reconciliation suite proves
 * equals the figure.
 */

// ── vocabulary ───────────────────────────────────────────────────────────────

export const DRILL_LISTS = [
  'ledger',
  'orders',
  'over-receipts',
  'grns',
  'putaway',
  'batch-alerts',
  'eway',
  'invoices',
] as const;
export type DrillList = (typeof DRILL_LISTS)[number];

/** The screens that read a drill, and the sections each serves. */
export type DrillScreen = 'ledger' | 'outbound' | 'conflicts' | 'inbound' | 'replenishment' | 'compliance';

export const SCREEN_LISTS: Readonly<Record<DrillScreen, readonly DrillList[]>> = {
  ledger: ['ledger'],
  outbound: ['orders'],
  conflicts: ['over-receipts'],
  inbound: ['grns', 'putaway'],
  replenishment: ['batch-alerts'],
  compliance: ['eway', 'invoices'],
};

type EventsQuery = NonNullable<InventoryControllerListEventsData['query']>;
type OrdersQuery = NonNullable<OutboundControllerListOrdersData['query']>;
type OverReceiptsQuery = NonNullable<ReceivingControllerListOverReceiptsData['query']>;
type BatchAlertsQuery = NonNullable<ReplenishmentControllerListBatchAlertsData['query']>;
type EwayQuery = NonNullable<EwayControllerListBillsData['query']>;

export type LedgerEventType = NonNullable<EventsQuery['type']>[number];

/** The ledger registry's types, as the timeline route accepts them (`?type=`). */
export const LEDGER_EVENT_TYPES = [
  'stock.adjusted',
  'grn.received',
  'qc.held',
  'qc.released',
  'putaway.placed',
  'bin.merged',
  'pick.picked',
  'pack.packed',
  'dispatch.dispatched',
  'excursion.recorded',
  'transfer.outbound',
  'transfer.inbound',
] as const satisfies readonly LedgerEventType[];

/** Record-typed: a new registry type must be labelled to compile. */
export const LEDGER_TYPE_LABEL: Readonly<Record<LedgerEventType, string>> = {
  'stock.adjusted': 'Stock adjusted',
  'grn.received': 'Received',
  'qc.held': 'QC held',
  'qc.released': 'QC released',
  'putaway.placed': 'Put away',
  'bin.merged': 'Bin merged',
  'pick.picked': 'Picked',
  'pack.packed': 'Packed',
  'dispatch.dispatched': 'Dispatched',
  'excursion.recorded': 'Excursion recorded',
  'transfer.outbound': 'Transferred out',
  'transfer.inbound': 'Transferred in',
};

/** A ledger event's type as words; an unregistered type prints as itself. */
export function ledgerTypeLabel(type: string): string {
  return (LEDGER_TYPE_LABEL as Readonly<Record<string, string>>)[type] ?? type;
}

const ORDER_STATUSES = ['accepted', 'ready_to_dispatch', 'dispatched', 'cancelled'] as const satisfies readonly NonNullable<
  OrdersQuery['status']
>[];
const ORDER_SOURCES = ['manual', 'ingested'] as const satisfies readonly NonNullable<OrdersQuery['source']>[];
const OVER_RECEIPT_STATUSES = ['pending', 'approved', 'rejected'] as const satisfies readonly NonNullable<
  OverReceiptsQuery['status']
>[];
const BATCH_ALERT_KINDS = ['expiry_upcoming', 'aged'] as const satisfies readonly NonNullable<BatchAlertsQuery['kind']>[];
const BATCH_ALERT_STATUSES = ['open', 'resolved', 'dismissed'] as const satisfies readonly NonNullable<
  BatchAlertsQuery['status']
>[];
const EWAY_STATUSES = ['pending', 'generated', 'dismissed'] as const satisfies readonly NonNullable<EwayQuery['status']>[];
const EWAY_SOURCES = ['manual', 'gateway'] as const satisfies readonly NonNullable<EwayQuery['source']>[];

// ── the typed drill ──────────────────────────────────────────────────────────

interface DrillWindow {
  /** Inclusive lower bound, verbatim from the link. */
  readonly from?: string;
  /** Exclusive upper bound, verbatim — a live drill carries `to` alone. */
  readonly to?: string;
}

/**
 * Story 9-3a — the documents that link to their ledger events ("View
 * ledger"), and the one `referenceDoc` key each filters on. A document drill
 * names its kind in `doc` (display-only, stripped before the request) and
 * carries EXACTLY that key plus `warehouseId` (and an optional `label`).
 */
export const LEDGER_DOC_KEYS = {
  grn: 'grnId',
  po: 'poId',
  order: 'orderId',
  adjustment: 'adjustmentPendingId',
  variance: 'countVarianceId',
} as const;
export type LedgerDoc = keyof typeof LEDGER_DOC_KEYS;
export const LEDGER_DOCS = Object.keys(LEDGER_DOC_KEYS) as readonly LedgerDoc[];

/** The document's noun on the banner and the page ("ledger events for GRN GRN-0042"). */
export const LEDGER_DOC_NOUN: Readonly<Record<LedgerDoc, string>> = {
  grn: 'GRN',
  po: 'PO',
  order: 'order',
  adjustment: 'adjustment',
  variance: 'count variance',
};

/** A display label's ceiling — it is shown, never sent; a longer one makes the link unsupported. */
export const MAX_DRILL_LABEL_LENGTH = 120;

export interface LedgerDrill extends DrillWindow {
  readonly list: 'ledger';
  /** Path-scoped: the timeline route's `{warehouseId}`. */
  readonly warehouseId: string;
  /** One-element list (the route's `type` is repeatable; a drill names one). */
  readonly type?: readonly LedgerEventType[];
  readonly skuId?: string;
  readonly orderId?: string;
  readonly shortPick?: boolean;
  /** Story 9-3a — a document drill's kind (display-only; never sent). */
  readonly doc?: LedgerDoc;
  /** Story 9-3a — the document's human label, e.g. its GRN code (display-only; never sent). */
  readonly label?: string;
  readonly grnId?: string;
  readonly poId?: string;
  readonly adjustmentPendingId?: string;
  readonly countVarianceId?: string;
}

export interface OrdersDrill extends DrillWindow {
  readonly list: 'orders';
  /** Path-scoped: the orders route's `{warehouseId}`. */
  readonly warehouseId: string;
  readonly status?: NonNullable<OrdersQuery['status']>;
  readonly source?: NonNullable<OrdersQuery['source']>;
  readonly backordered?: boolean;
}

export interface OverReceiptsDrill extends DrillWindow {
  readonly list: 'over-receipts';
  readonly warehouseId?: string;
  readonly status?: NonNullable<OverReceiptsQuery['status']>;
}

export interface GrnsDrill extends DrillWindow {
  readonly list: 'grns';
  readonly warehouseId?: string;
  readonly blind?: boolean;
}

export interface PutawayDrill {
  readonly list: 'putaway';
  /** The task route's required `warehouseId` query. */
  readonly warehouseId: string;
}

export interface BatchAlertsDrill extends DrillWindow {
  readonly list: 'batch-alerts';
  readonly warehouseId?: string;
  readonly kind?: NonNullable<BatchAlertsQuery['kind']>;
  readonly status?: NonNullable<BatchAlertsQuery['status']>;
}

export interface EwayDrill extends DrillWindow {
  readonly list: 'eway';
  readonly warehouseId?: string;
  readonly source?: NonNullable<EwayQuery['source']>;
  readonly status?: NonNullable<EwayQuery['status']>;
}

export interface InvoicesDrill extends DrillWindow {
  readonly list: 'invoices';
  readonly warehouseId?: string;
}

export type Drill =
  | LedgerDrill
  | OrdersDrill
  | OverReceiptsDrill
  | GrnsDrill
  | PutawayDrill
  | BatchAlertsDrill
  | EwayDrill
  | InvoicesDrill;

/** A screen's drill: typed, absent (`null` — no drill keys), or `'unsupported'`. */
export type ParsedDrill = Drill | 'unsupported' | null;

/** The drill for one section of a screen, or null when the drill names another section. */
export function drillFor<L extends DrillList>(drill: ParsedDrill | undefined, list: L): Extract<Drill, { list: L }> | null {
  if (drill === null || drill === undefined || drill === 'unsupported' || drill.list !== list) return null;
  return drill as Extract<Drill, { list: L }>;
}

// ── parsing ──────────────────────────────────────────────────────────────────

type FieldKind = 'uuid' | 'instant' | 'boolean' | 'type' | 'label' | { readonly oneOf: readonly string[] };

interface ListSpec {
  readonly fields: Readonly<Record<string, FieldKind>>;
  /** Keys a lawful drill of this list must carry (the path-scoped warehouse). */
  readonly required: readonly string[];
}

const WINDOW: Readonly<Record<string, FieldKind>> = { from: 'instant', to: 'instant' };

/**
 * The runtime twin of the `Drill` union — the keys each list accepts and how
 * each value parses. Exactly the backend list DTO's filters (minus `cursor`
 * and `limit`, which a link never carries). `drill.test.ts` pins each list.
 */
const SPECS: Readonly<Record<DrillList, ListSpec>> = {
  ledger: {
    fields: {
      warehouseId: 'uuid',
      type: 'type',
      skuId: 'uuid',
      orderId: 'uuid',
      shortPick: 'boolean',
      ...WINDOW,
      // Story 9-3a — the document drill (see `documentDrillShapeOk`).
      doc: { oneOf: LEDGER_DOCS },
      label: 'label',
      grnId: 'uuid',
      poId: 'uuid',
      adjustmentPendingId: 'uuid',
      countVarianceId: 'uuid',
    },
    required: ['warehouseId'],
  },
  orders: {
    fields: {
      warehouseId: 'uuid',
      status: { oneOf: ORDER_STATUSES },
      source: { oneOf: ORDER_SOURCES },
      backordered: 'boolean',
      ...WINDOW,
    },
    required: ['warehouseId'],
  },
  'over-receipts': {
    fields: { warehouseId: 'uuid', status: { oneOf: OVER_RECEIPT_STATUSES }, ...WINDOW },
    required: [],
  },
  grns: { fields: { warehouseId: 'uuid', blind: 'boolean', ...WINDOW }, required: [] },
  putaway: { fields: { warehouseId: 'uuid' }, required: ['warehouseId'] },
  'batch-alerts': {
    fields: {
      warehouseId: 'uuid',
      kind: { oneOf: BATCH_ALERT_KINDS },
      status: { oneOf: BATCH_ALERT_STATUSES },
      ...WINDOW,
    },
    required: [],
  },
  eway: {
    fields: { warehouseId: 'uuid', source: { oneOf: EWAY_SOURCES }, status: { oneOf: EWAY_STATUSES }, ...WINDOW },
    required: [],
  },
  invoices: { fields: { warehouseId: 'uuid', ...WINDOW }, required: [] },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** ISO-8601 with a zone designator — the backend's instant rule. */
const INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * A real calendar instant: the fields, read back through `Date.UTC` (which
 * rolls 30 Feb over to 2 Mar, hour 25 to the next day), must be unchanged.
 * The check is on the string's own fields, so the offset never matters.
 */
function isCalendarInstant(raw: string): boolean {
  const m = INSTANT_RE.exec(raw);
  if (m === null) return false;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number) as [
    number, number, number, number, number, number,
  ];
  const back = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return (
    back.getUTCFullYear() === y &&
    back.getUTCMonth() === mo - 1 &&
    back.getUTCDate() === d &&
    back.getUTCHours() === h &&
    back.getUTCMinutes() === mi &&
    back.getUTCSeconds() === s &&
    !Number.isNaN(Date.parse(raw))
  );
}

/** One parsed value, or `undefined` when the value is malformed. */
function parseValue(kind: FieldKind, raw: string): string | boolean | readonly string[] | undefined {
  if (kind === 'uuid') return UUID_RE.test(raw) ? raw : undefined;
  if (kind === 'instant') return isCalendarInstant(raw) ? raw : undefined;
  if (kind === 'boolean') return raw === 'true' ? true : raw === 'false' ? false : undefined;
  if (kind === 'type') return (LEDGER_EVENT_TYPES as readonly string[]).includes(raw) ? [raw] : undefined;
  if (kind === 'label') return raw.trim() !== '' && raw.length <= MAX_DRILL_LABEL_LENGTH ? raw : undefined;
  return kind.oneOf.includes(raw) ? raw : undefined;
}

/** The shape Next 16 hands a page: each value `string | string[]`. */
export type SearchParamsRecord = Readonly<Record<string, string | readonly string[] | undefined>>;

/**
 * The drill a screen should show, from its URL's search params. `null` when
 * the params carry no `list` at all — a plain visit, whatever unrelated keys
 * ride along (`utm_source`…). With a `list`, the rules are strict:
 * `'unsupported'` when any key is unknown for the drill's list, repeated,
 * malformed, or the list is not one this screen serves. Pure.
 */
export function parseDrill(screen: DrillScreen, params: SearchParamsRecord): ParsedDrill {
  const keys = Object.keys(params).filter((key) => params[key] !== undefined);
  if (!keys.includes('list')) return null;
  const single: Record<string, string> = {};
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string') single[key] = value;
    else return 'unsupported'; // a repeated key — every drill key is single-valued
  }
  const list = single.list!;
  if (!(SCREEN_LISTS[screen] as readonly string[]).includes(list)) return 'unsupported';
  const spec = SPECS[list as DrillList];
  const drill: Record<string, string | boolean | readonly string[]> = { list };
  for (const key of keys) {
    if (key === 'list') continue;
    const kind = spec.fields[key];
    if (kind === undefined) return 'unsupported';
    const value = parseValue(kind, single[key]!);
    if (value === undefined) return 'unsupported';
    drill[key] = value;
  }
  if (spec.required.some((key) => drill[key] === undefined)) return 'unsupported';
  if (list === 'ledger' && !documentDrillShapeOk(drill)) return 'unsupported';
  // `SPECS` is the runtime twin of the `Drill` union: every key was checked
  // against its list's fields and parsed to that field's type above.
  return drill as unknown as Drill;
}

/** The keys only a document drill may carry (`orderId` is also a dashboard key). */
const DOCUMENT_ONLY_KEYS: readonly string[] = ['doc', 'label', 'grnId', 'poId', 'adjustmentPendingId', 'countVarianceId'];

/**
 * Story 9-3a — a ledger drill's document rule: with a `doc`, exactly its key
 * (`LEDGER_DOC_KEYS`) is present, beside `warehouseId` and an optional
 * `label` — nothing else (`doc=grn&poId=X` is unsupported). Without a `doc`,
 * none of the document-only keys may appear (the dashboard's drills never
 * carry them).
 */
function documentDrillShapeOk(drill: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(drill).filter((key) => key !== 'list');
  const doc = drill.doc as LedgerDoc | undefined;
  if (doc === undefined) return !keys.some((key) => DOCUMENT_ONLY_KEYS.includes(key));
  const allowed = new Set(['doc', 'label', 'warehouseId', LEDGER_DOC_KEYS[doc]]);
  return drill[LEDGER_DOC_KEYS[doc]] !== undefined && keys.every((key) => allowed.has(key));
}

/**
 * Story 9-3a — the "View ledger" link of one document: `/inventory/ledger`
 * filtered to the document's own warehouse and its one reference key, with
 * the document's kind and label for the banner (display-only — the request
 * strips both). `parseDrill('ledger', …)` reads it back to the same drill.
 */
export function ledgerDocHref(doc: LedgerDoc, id: string, warehouseId: string, label?: string | null): string {
  const params = new URLSearchParams({ list: 'ledger', warehouseId, doc, [LEDGER_DOC_KEYS[doc]]: id });
  const shown = label?.trim();
  if (shown !== undefined && shown !== '') params.set('label', shown.slice(0, MAX_DRILL_LABEL_LENGTH));
  return `/inventory/ledger?${params.toString()}`;
}

/**
 * The canonical key a page mounts its screen under: `'none'`, `'unsupported'`,
 * or the list plus its sorted keys — the same drill always yields the same
 * key, and any change of drill (Clear included) remounts the screen.
 */
export function drillKey(drill: ParsedDrill): string {
  if (drill === null) return 'none';
  if (drill === 'unsupported') return 'unsupported';
  const entries = Object.entries(drill)
    .filter(([key]) => key !== 'list')
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`)
    .sort();
  return `${drill.list}?${entries.join('&')}`;
}

/**
 * The drill's filter for its list route, minus `list` — the keys a drilled
 * list sends, exactly. For a path-scoped list (ledger, orders) the caller
 * moves `warehouseId` into the path.
 */
export function drillFilter<D extends Drill>(drill: D): Omit<D, 'list'> {
  const filter: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(drill)) if (key !== 'list') filter[key] = value;
  return filter as Omit<D, 'list'>;
}

/** Story 9-3a — the document drill's display-only keys, which a request never carries. */
export const DISPLAY_ONLY_DRILL_KEYS = ['doc', 'label'] as const;

/** Story 9-3a — the document a ledger drill names, or null for a dashboard drill. */
export function ledgerDrillDocument(drill: Drill): { doc: LedgerDoc; id: string; label: string } | null {
  if (drill.list !== 'ledger' || drill.doc === undefined) return null;
  const id = drill[LEDGER_DOC_KEYS[drill.doc]] ?? '';
  return { doc: drill.doc, id, label: drill.label ?? id.slice(0, 8) };
}

/** Story 9-3a — "GRN GRN-0042", "PO PO-0007", "order 01a2b3c4" — the document as words. */
export function ledgerDocName(document: { doc: LedgerDoc; label: string }): string {
  return `${LEDGER_DOC_NOUN[document.doc]} ${document.label}`;
}

/** The banner's headline: the dashboard wording, or "Showing ledger events for GRN GRN-0042" for a document drill. */
export function drillBannerWord(drill: Drill): string {
  const document = ledgerDrillDocument(drill);
  if (document === null) return "Showing the dashboard figure's rows";
  return document.doc === 'po'
    ? `Showing ledger receipts for ${ledgerDocName(document)}`
    : `Showing ledger events for ${ledgerDocName(document)}`;
}

// ── the banner's words ───────────────────────────────────────────────────────

const LIST_LABEL: Readonly<Record<DrillList, string>> = {
  ledger: 'Ledger events',
  orders: 'Orders',
  'over-receipts': 'Over-receipts',
  grns: 'Goods receipts',
  putaway: 'Awaiting putaway',
  'batch-alerts': 'Batch alerts',
  eway: 'E-way bills',
  invoices: 'Invoices',
};

const STATUS_LABEL: Readonly<Record<string, string>> = {
  accepted: 'Accepted',
  ready_to_dispatch: 'Ready to dispatch',
  dispatched: 'Dispatched',
  cancelled: 'Cancelled',
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  open: 'Open',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
  generated: 'Generated',
};

/** Lists whose rows carry a status the normal view tabs on — a drill naming none spans them all. */
const STATUS_BEARING: readonly DrillList[] = ['over-receipts', 'batch-alerts', 'eway'];

const KIND_LABEL: Readonly<Record<string, string>> = { expiry_upcoming: 'Expiry upcoming', aged: 'Aged stock' };

const ORDER_SOURCE_LABEL: Readonly<Record<string, string>> = { ingested: 'Channel orders', manual: 'Manual orders' };
const EWAY_SOURCE_LABEL: Readonly<Record<string, string>> = { gateway: 'Generated by gateway', manual: 'Recorded by hand' };

const IST_PARTS = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * A drill instant on the IST clock, `06 Oct 2026, 15:30` — display only; the
 * sent value is untouched. Composed from parts so the joining words of one
 * ICU build ("at", ",") never leak in.
 */
export function drillInstantLabel(iso: string): string {
  const parts = IST_PARTS.formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')}`;
}

/** The minimum a warehouse row needs to be named. */
export interface DrillWarehouse {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/**
 * The banner's sentence: the list, each filter in words, the window on the
 * IST clock ("as of …" for a live drill), and the warehouse by name (its
 * short id when it is not in hand). Pure.
 */
export function describeDrill(drill: Drill, warehouses: readonly DrillWarehouse[] | null): string {
  // Story 9-3a — a document drill names the document, then its warehouse.
  const document = ledgerDrillDocument(drill);
  if (document !== null) {
    return [
      document.doc === 'po' ? `Receipt events of ${ledgerDocName(document)}` : `Ledger events of ${ledgerDocName(document)}`,
      warehouseDisplayLabel(warehouses, drill.warehouseId!),
    ].join(' · ');
  }
  const parts: string[] = [LIST_LABEL[drill.list]];
  if ('type' in drill && drill.type !== undefined) parts.push(drill.type.map(ledgerTypeLabel).join(', '));
  if ('status' in drill && drill.status !== undefined) parts.push(STATUS_LABEL[drill.status] ?? drill.status);
  else if (STATUS_BEARING.includes(drill.list)) parts.push('All statuses');
  if ('kind' in drill && drill.kind !== undefined) parts.push(KIND_LABEL[drill.kind] ?? drill.kind);
  if ('source' in drill && drill.source !== undefined) {
    const table = drill.list === 'eway' ? EWAY_SOURCE_LABEL : ORDER_SOURCE_LABEL;
    parts.push(table[drill.source] ?? drill.source);
  }
  if ('backordered' in drill && drill.backordered !== undefined) {
    parts.push(drill.backordered ? 'With a backordered line' : 'No backordered line');
  }
  if ('blind' in drill && drill.blind !== undefined) {
    parts.push(drill.blind ? 'Blind receipts' : 'Document-backed receipts');
  }
  if ('shortPick' in drill && drill.shortPick !== undefined) {
    parts.push(drill.shortPick ? 'Short-pick draws' : 'Not short-pick draws');
  }
  if ('skuId' in drill && drill.skuId !== undefined) parts.push(`SKU ${drill.skuId.slice(0, 8)}`);
  if ('orderId' in drill && drill.orderId !== undefined) parts.push(`Order ${drill.orderId.slice(0, 8)}`);
  if ('from' in drill || 'to' in drill) {
    const from = 'from' in drill && drill.from !== undefined ? drillInstantLabel(drill.from) : null;
    const to = 'to' in drill && drill.to !== undefined ? drillInstantLabel(drill.to) : null;
    if (from !== null && to !== null) parts.push(`${from} – ${to} IST`);
    else if (to !== null) parts.push(`as of ${to} IST`);
    else if (from !== null) parts.push(`from ${from} IST`);
  }
  parts.push(drill.warehouseId === undefined ? 'All warehouses' : warehouseDisplayLabel(warehouses, drill.warehouseId));
  return parts.join(' · ');
}

/**
 * The ONE warehouse label a drilled view prints: `CODE Name`, or
 * `Warehouse <short id>` when the row is not in hand (loading, failed, or
 * not this list's) — never "Pick a warehouse".
 */
export function warehouseDisplayLabel(warehouses: readonly DrillWarehouse[] | null, id: string): string {
  const warehouse = warehouses?.find((w) => w.id === id);
  return warehouse === undefined ? `Warehouse ${id.slice(0, 8)}` : `${warehouse.code} ${warehouse.name}`;
}

/** The notice beside a normal view whose link could not be honoured. */
export const UNSUPPORTED_DRILL_COPY = "This link's filter can't be shown here";
