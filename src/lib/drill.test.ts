import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { restoreGlobals, stubGlobal } from './test/globals';
import {
  describeDrill,
  drillBannerWord,
  drillKey,
  ledgerDocHref,
  parseDrill,
  warehouseDisplayLabel,
  type Drill,
  type DrillScreen,
  type ParsedDrill,
  type SearchParamsRecord,
} from './drill';
import {
  fetchBatchAlertsDrill,
  fetchEwayDrill,
  fetchGrnsDrill,
  fetchInvoicesDrill,
  fetchLedgerDrill,
  fetchOrdersDrill,
  fetchOverReceiptsDrill,
  fetchPutawayDrill,
} from './drill-fetch';
import { drillHref } from './drill-routes';

/**
 * Story 9-1b — the drill round trip, end to end in pure code:
 *   tile drill → `drillHref` → the URL's search params → `parseDrill` → the
 *   request the drilled list sends (through the real fetch wrapper, over a
 *   stubbed `fetch`).
 *
 * The claim it pins is the reconciliation chain's web half: the request a
 * drilled section sends carries EXACTLY the drill's keys and values (order-
 * insensitive, `list` excluded) and, for a path-scoped drill, the drill's
 * warehouse in the PATH — never the active warehouse, never a tab's status.
 */

const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const W = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';
const FROM = '2026-10-05T18:30:00.000Z';
const TO = '2026-10-06T10:00:00.000Z';
const HOUR = '2026-10-06T09:00:00.000Z';

const wh = `/tenants/${T}/warehouses/${W}`;
const tn = `/tenants/${T}`;

/** Every LINKED drill shape the backend's tiles build (`kpis.ts`). */
const DRILLS: readonly { name: string; apiPath: string; query: Record<string, string> }[] = [
  { name: 'dock-to-stock (ledger putaway.placed, windowed)', apiPath: `${wh}/inventory/events`, query: { type: 'putaway.placed', from: FROM, to: TO } },
  { name: 'pick lines (ledger pick.picked, last hour)', apiPath: `${wh}/inventory/events`, query: { type: 'pick.picked', from: HOUR, to: TO } },
  { name: 'dispatched lines (ledger, windowed)', apiPath: `${wh}/inventory/events`, query: { type: 'dispatch.dispatched', from: FROM, to: TO } },
  { name: 'a ledger drill with `to` only (live)', apiPath: `${wh}/inventory/events`, query: { type: 'pick.picked', to: TO } },
  {
    name: 'a ledger drill by SKU, order and short-pick flag',
    apiPath: `${wh}/inventory/events`,
    query: {
      type: 'pick.picked',
      skuId: '0198f7a2-1b3c-7d4e-8f90-00000000c001',
      orderId: '0198f7a2-1b3c-7d4e-8f90-00000000c002',
      shortPick: 'true',
      from: FROM,
      to: TO,
    },
  },
  {
    // Story 3-2a — the adjustment outcome's "See it in the ledger": SKU, bin and type.
    name: 'a ledger drill by SKU and bin (an adjustment)',
    apiPath: `${wh}/inventory/events`,
    query: { type: 'stock.adjusted', skuId: '0198f7a2-1b3c-7d4e-8f90-00000000c001', binId: '0198f7a2-1b3c-7d4e-8f90-00000000b001' },
  },
  {
    name: 'a ledger drill with shortPick=false',
    apiPath: `${wh}/inventory/events`,
    query: { type: 'pick.picked', shortPick: 'false', to: TO },
  },
  { name: 'awaiting putaway (live)', apiPath: `${tn}/putaway/tasks`, query: { warehouseId: W } },
  { name: 'over-receipts (windowed)', apiPath: `${tn}/receiving/over-receipts`, query: { warehouseId: W, from: FROM, to: TO } },
  { name: 'pending over-receipts (live)', apiPath: `${tn}/receiving/over-receipts`, query: { warehouseId: W, status: 'pending', to: TO } },
  { name: 'blind GRNs (windowed)', apiPath: `${tn}/receiving/goods-receipts`, query: { warehouseId: W, blind: 'true', from: FROM, to: TO } },
  { name: 'backordered channel orders (windowed)', apiPath: `${wh}/outbound/orders`, query: { source: 'ingested', backordered: 'true', from: FROM, to: TO } },
  { name: 'accepted orders (live)', apiPath: `${wh}/outbound/orders`, query: { status: 'accepted', to: TO } },
  { name: 'ready to dispatch (live)', apiPath: `${wh}/outbound/orders`, query: { status: 'ready_to_dispatch', to: TO } },
  { name: 'open expiry alerts (live)', apiPath: `${tn}/replenishment/batch-alerts`, query: { warehouseId: W, kind: 'expiry_upcoming', status: 'open', to: TO } },
  { name: 'open aged alerts (live)', apiPath: `${tn}/replenishment/batch-alerts`, query: { warehouseId: W, kind: 'aged', status: 'open', to: TO } },
  { name: 'alerts raised (windowed)', apiPath: `${tn}/replenishment/batch-alerts`, query: { warehouseId: W, from: FROM, to: TO } },
  { name: 'eligible e-way bills (windowed)', apiPath: `${tn}/eway/bills`, query: { warehouseId: W, from: FROM, to: TO } },
  { name: 'gateway-generated e-way bills (windowed)', apiPath: `${tn}/eway/bills`, query: { warehouseId: W, source: 'gateway', from: FROM, to: TO } },
  { name: 'invoices issued (windowed)', apiPath: `${tn}/invoices`, query: { warehouseId: W, from: FROM, to: TO } },
];

const SCREEN_OF_ROUTE: Readonly<Record<string, DrillScreen>> = {
  '/inventory/ledger': 'ledger',
  '/outbound': 'outbound',
  '/conflicts': 'conflicts',
  '/inbound': 'inbound',
  '/replenishment': 'replenishment',
  '/compliance': 'compliance',
};

/** URLSearchParams → the shape Next hands a page (a repeated key becomes an array). */
function paramsRecord(search: URLSearchParams): SearchParamsRecord {
  const record: Record<string, string | string[]> = {};
  for (const key of new Set(search.keys())) {
    const all = search.getAll(key);
    record[key] = all.length === 1 ? all[0]! : all;
  }
  return record;
}

/** Follow the link: href → (screen, parsed drill). */
function follow(apiPath: string, query: Record<string, string>): { screen: DrillScreen; drill: ParsedDrill } {
  const href = drillHref({ apiPath, query });
  if (href === null) throw new Error(`no link for ${apiPath}`);
  const [route, search = ''] = href.split('?') as [string, string?];
  const screen = SCREEN_OF_ROUTE[route];
  if (screen === undefined) throw new Error(`no drill screen for ${route}`);
  return { screen, drill: parseDrill(screen, paramsRecord(new URLSearchParams(search))) };
}

let sent: URL[] = [];

beforeEach(() => {
  sent = [];
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    sent.push(new URL(request.url));
    return new Response(JSON.stringify({ items: [], nextCursor: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch);
});

afterEach(() => {
  restoreGlobals();
});

/** The ONE call the drilled section makes for its rows (the hooks call exactly these). */
async function send(drill: Drill, cursor: string | null): Promise<URL> {
  switch (drill.list) {
    case 'ledger':
      await fetchLedgerDrill(T, drill, cursor);
      break;
    case 'orders':
      await fetchOrdersDrill(T, drill, cursor);
      break;
    case 'over-receipts':
      await fetchOverReceiptsDrill(T, drill, cursor);
      break;
    case 'grns':
      await fetchGrnsDrill(T, drill, cursor);
      break;
    case 'putaway':
      await fetchPutawayDrill(T, drill);
      break;
    case 'batch-alerts':
      await fetchBatchAlertsDrill(T, drill, cursor);
      break;
    case 'eway':
      await fetchEwayDrill(T, drill, cursor);
      break;
    case 'invoices':
      await fetchInvoicesDrill(T, drill, cursor);
      break;
  }
  expect(sent).toHaveLength(1);
  return sent[0]!;
}

const sortedEntries = (entries: Iterable<[string, string]>) =>
  [...entries].sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));

describe('the round trip — the drilled request carries exactly the drill', () => {
  test.each([...DRILLS])('$name', async ({ apiPath, query }) => {
    const { drill } = follow(apiPath, query);
    expect(drill).not.toBeNull();
    expect(drill).not.toBe('unsupported');
    const url = await send(drill as Drill, null);

    // The API path is the drill's own (ids filled in) — so a path-scoped
    // drill's warehouse rides in the path, not the active one.
    expect(url.pathname).toBe(`/api/v1${apiPath}`);
    // Exactly the drill's keys and values; `list` never leaves the browser.
    expect(sortedEntries(url.searchParams.entries())).toEqual(sortedEntries(Object.entries(query)));
    expect(url.searchParams.has('list')).toBe(false);
  });

  test('a path-scoped drill sends no warehouseId query (it is in the path)', async () => {
    const { drill } = follow(`${wh}/outbound/orders`, { status: 'accepted', to: TO });
    const url = await send(drill as Drill, null);
    expect(url.searchParams.has('warehouseId')).toBe(false);
    expect(url.pathname).toContain(`/warehouses/${W}/outbound/orders`);
  });

  test('the next page passes the opaque cursor back verbatim, with the drill', async () => {
    const cursor = 'eyJjcmVhdGVkQXQiOiIyMDI2LTEwLTA2VDA5OjU5OjU5Ljk5OTk5OVoiLCJpZCI6IngifQ';
    const { drill } = follow(`${tn}/receiving/over-receipts`, { warehouseId: W, from: FROM, to: TO });
    const url = await send(drill as Drill, cursor);
    expect(url.searchParams.get('cursor')).toBe(cursor);
    expect(url.searchParams.get('from')).toBe(FROM);
    expect(url.searchParams.get('warehouseId')).toBe(W);
  });

  test('instants are sent exactly as linked — never re-formatted', async () => {
    const odd = '2026-10-05T18:30:00Z'; // no milliseconds: still lawful, still verbatim
    const { drill } = follow(`${tn}/invoices`, { warehouseId: W, from: odd, to: TO });
    const url = await send(drill as Drill, null);
    expect(url.searchParams.get('from')).toBe(odd);
  });
});

describe('parseDrill — lawful shapes', () => {
  test('no drill keys → null (a plain visit)', () => {
    expect(parseDrill('outbound', {})).toBeNull();
    expect(parseDrill('outbound', { list: undefined })).toBeNull();
  });

  test('no `list` → null, whatever unrelated or drill-like keys ride along', () => {
    expect(parseDrill('outbound', { utm_source: 'mail' })).toBeNull();
    expect(parseDrill('compliance', { warehouseId: W, from: FROM })).toBeNull();
    expect(parseDrill('compliance', { utm_source: ['a', 'b'] })).toBeNull();
  });

  test('`to` without `from` is lawful (live drills)', () => {
    expect(parseDrill('outbound', { list: 'orders', warehouseId: W, status: 'accepted', to: TO })).toEqual({
      list: 'orders',
      warehouseId: W,
      status: 'accepted',
      to: TO,
    });
  });

  test('`type` parses to a one-element list', () => {
    expect(parseDrill('ledger', { list: 'ledger', warehouseId: W, type: 'pick.picked' })).toEqual({
      list: 'ledger',
      warehouseId: W,
      type: ['pick.picked'],
    });
  });

  test("booleans parse from 'true' and 'false'", () => {
    expect(parseDrill('inbound', { list: 'grns', blind: 'true' })).toEqual({ list: 'grns', blind: true });
    expect(parseDrill('inbound', { list: 'grns', blind: 'false' })).toEqual({ list: 'grns', blind: false });
    expect(parseDrill('ledger', { list: 'ledger', warehouseId: W, shortPick: 'false' })).toEqual({
      list: 'ledger',
      warehouseId: W,
      shortPick: false,
    });
  });

  test('the putaway list on /inbound', () => {
    expect(parseDrill('inbound', { list: 'putaway', warehouseId: W })).toEqual({ list: 'putaway', warehouseId: W });
  });
});

describe('parseDrill — unsupported, all or nothing', () => {
  test.each<[string, DrillScreen, SearchParamsRecord]>([
    ['an unknown key', 'outbound', { list: 'orders', warehouseId: W, sort: 'asc' }],
    ['a key another list owns', 'inbound', { list: 'grns', status: 'pending' }],
    ['a repeated key', 'compliance', { list: 'invoices', warehouseId: [W, W] }],
    ['a repeated type', 'ledger', { list: 'ledger', warehouseId: W, type: ['pick.picked', 'pack.packed'] }],
    ['a repeated list', 'compliance', { list: ['eway', 'invoices'] }],
    ['a malformed uuid', 'conflicts', { list: 'over-receipts', warehouseId: 'not-a-uuid' }],
    ['an empty uuid', 'conflicts', { list: 'over-receipts', warehouseId: '' }],
    ['an instant with no zone', 'compliance', { list: 'invoices', from: '2026-10-05T18:30:00' }],
    ['a date with no time', 'compliance', { list: 'eway', to: '2026-10-05' }],
    ['an impossible instant', 'compliance', { list: 'eway', to: '2026-13-45T99:00:00Z' }],
    ['an unknown enum value', 'replenishment', { list: 'batch-alerts', kind: 'expired' }],
    ['an unregistered ledger type', 'ledger', { list: 'ledger', warehouseId: W, type: 'pick.dropped' }],
    ['a non-boolean flag', 'outbound', { list: 'orders', warehouseId: W, backordered: 'yes' }],
    ['a boolean in another case', 'inbound', { list: 'grns', blind: 'TRUE' }],
    ['a list this screen does not serve', 'outbound', { list: 'invoices', warehouseId: W }],
    ['an unknown list', 'compliance', { list: 'hsn' }],
    ['an unrelated key beside a list', 'outbound', { list: 'orders', warehouseId: W, utm_source: 'mail' }],
    ['an impossible day (30 Feb)', 'compliance', { list: 'invoices', from: '2026-02-30T00:00:00.000Z' }],
    ['an impossible day with an offset', 'compliance', { list: 'invoices', to: '2026-04-31T10:00:00+05:30' }],
    ['hour 24', 'compliance', { list: 'invoices', to: '2026-10-05T24:00:00Z' }],
    ['a path-scoped list without its warehouse', 'ledger', { list: 'ledger', type: 'pick.picked' }],
    ['putaway without its warehouse', 'inbound', { list: 'putaway' }],
  ])('%s', (_name, screen, params) => {
    expect(parseDrill(screen, params)).toBe('unsupported');
  });
});

describe('parseDrill — real calendar instants pass', () => {
  test.each(['2028-02-29T00:00:00Z', '2026-10-05T23:59:59.999+05:30', '2026-12-31T18:30:00-04:00'])('%s', (to) => {
    expect(parseDrill('compliance', { list: 'invoices', to })).toEqual({ list: 'invoices', to });
  });
});

describe('drillKey — the remount key', () => {
  test('no drill and an unsupported drill have fixed keys', () => {
    expect(drillKey(null)).toBe('none');
    expect(drillKey('unsupported')).toBe('unsupported');
  });

  test('canonical: the same drill in any key order yields the same key', () => {
    const a = parseDrill('outbound', { list: 'orders', warehouseId: W, status: 'accepted', to: TO });
    const b = parseDrill('outbound', { to: TO, status: 'accepted', warehouseId: W, list: 'orders' });
    expect(drillKey(a)).toBe(drillKey(b));
  });

  test('a different drill (or none) yields a different key — Clear remounts', () => {
    const today = parseDrill('compliance', { list: 'invoices', warehouseId: W, from: FROM, to: TO });
    const week = parseDrill('compliance', { list: 'invoices', warehouseId: W, from: '2026-09-29T18:30:00.000Z', to: TO });
    const eway = parseDrill('compliance', { list: 'eway', warehouseId: W, from: FROM, to: TO });
    expect(new Set([drillKey(today), drillKey(week), drillKey(eway), drillKey(null)]).size).toBe(4);
  });
});

describe('describeDrill — the banner sentence', () => {
  const WAREHOUSES = [{ id: W, code: 'MAIN', name: 'Chennai DC' }];

  test.each<[string, Drill, string]>([
    [
      'a windowed ledger drill: type label, the IST window, the warehouse by name',
      { list: 'ledger', warehouseId: W, type: ['putaway.placed'], from: FROM, to: TO },
      'Ledger events · Put away · 06 Oct 2026, 00:00 – 06 Oct 2026, 15:30 IST · MAIN Chennai DC',
    ],
    [
      'a live drill reads "as of"',
      { list: 'orders', warehouseId: W, status: 'ready_to_dispatch', to: TO },
      'Orders · Ready to dispatch · as of 06 Oct 2026, 15:30 IST · MAIN Chennai DC',
    ],
    [
      'source and backordered',
      { list: 'orders', warehouseId: W, source: 'ingested', backordered: true, from: FROM, to: TO },
      'Orders · Channel orders · With a backordered line · 06 Oct 2026, 00:00 – 06 Oct 2026, 15:30 IST · MAIN Chennai DC',
    ],
    [
      'blind receipts',
      { list: 'grns', warehouseId: W, blind: true, from: FROM, to: TO },
      'Goods receipts · Blind receipts · 06 Oct 2026, 00:00 – 06 Oct 2026, 15:30 IST · MAIN Chennai DC',
    ],
    [
      'kind and status',
      { list: 'batch-alerts', warehouseId: W, kind: 'expiry_upcoming', status: 'open', to: TO },
      'Batch alerts · Open · Expiry upcoming · as of 06 Oct 2026, 15:30 IST · MAIN Chennai DC',
    ],
    [
      'an e-way gateway source',
      { list: 'eway', warehouseId: W, source: 'gateway', from: FROM, to: TO },
      'E-way bills · All statuses · Generated by gateway · 06 Oct 2026, 00:00 – 06 Oct 2026, 15:30 IST · MAIN Chennai DC',
    ],
    [
      'over-receipts naming no status span them all',
      { list: 'over-receipts', warehouseId: W, from: FROM, to: TO },
      'Over-receipts · All statuses · 06 Oct 2026, 00:00 – 06 Oct 2026, 15:30 IST · MAIN Chennai DC',
    ],
    [
      'batch alerts naming no status span them all',
      { list: 'batch-alerts', warehouseId: W, from: FROM, to: TO },
      'Batch alerts · All statuses · 06 Oct 2026, 00:00 – 06 Oct 2026, 15:30 IST · MAIN Chennai DC',
    ],
    [
      'a list without statuses never says "all statuses"',
      { list: 'grns', warehouseId: W, from: FROM, to: TO },
      'Goods receipts · 06 Oct 2026, 00:00 – 06 Oct 2026, 15:30 IST · MAIN Chennai DC',
    ],
    [
      'the putaway list (no window)',
      { list: 'putaway', warehouseId: W },
      'Awaiting putaway · MAIN Chennai DC',
    ],
    [
      'a drill naming no warehouse',
      { list: 'invoices', from: FROM, to: TO },
      'Invoices · 06 Oct 2026, 00:00 – 06 Oct 2026, 15:30 IST · All warehouses',
    ],
  ])('%s', (_name, drill, expected) => {
    expect(describeDrill(drill, WAREHOUSES)).toBe(expected);
  });

  test('story 3-2a — a ledger drill on one bin names the bin by code when the bins are read, else its id tail', () => {
    const BIN = '0198f7a2-1b3c-7d4e-8f90-00000000b001';
    const SKU = '0198f7a2-1b3c-7d4e-8f90-00000000c001';
    const drill: Drill = { list: 'ledger', warehouseId: W, type: ['stock.adjusted'], skuId: SKU, binId: BIN };
    expect(describeDrill(drill, WAREHOUSES, { [BIN]: 'A-01-01' })).toBe('Ledger events · Stock adjusted · Bin A-01-01 · SKU 0198f7a2 · MAIN Chennai DC');
    expect(describeDrill(drill, WAREHOUSES)).toBe('Ledger events · Stock adjusted · Bin 0000b001 · SKU 0198f7a2 · MAIN Chennai DC');
    expect(describeDrill(drill, WAREHOUSES, {})).toBe('Ledger events · Stock adjusted · Bin 0000b001 · SKU 0198f7a2 · MAIN Chennai DC');
  });

  test('warehouseDisplayLabel — code and name, else the short id', () => {
    expect(warehouseDisplayLabel(WAREHOUSES, W)).toBe('MAIN Chennai DC');
    expect(warehouseDisplayLabel([], W)).toBe('Warehouse 0198f7a2');
    expect(warehouseDisplayLabel(null, W)).toBe('Warehouse 0198f7a2');
  });

  test('an unknown warehouse is named by its short id', () => {
    expect(describeDrill({ list: 'putaway', warehouseId: W }, [])).toBe('Awaiting putaway · Warehouse 0198f7a2');
    expect(describeDrill({ list: 'putaway', warehouseId: W }, null)).toBe('Awaiting putaway · Warehouse 0198f7a2');
  });
});

// ── Story 9-3a — the document drills ("View ledger") ─────────────────────────

describe('document drills — "View ledger" links land on the ledger filtered to one document', () => {
  const WAREHOUSES = [{ id: W, code: 'MAIN', name: 'Chennai DC' }];
  const GRN = '0198f7a2-1b3c-7d4e-8f90-00000000a001';
  const PO = '0198f7a2-1b3c-7d4e-8f90-00000000b001';
  const PEND = '0198f7a2-1b3c-7d4e-8f90-00000000c001';
  const VAR = '0198f7a2-1b3c-7d4e-8f90-00000000d001';
  const ORDER = '0198f7a2-1b3c-7d4e-8f90-00000000e001';

  function parseHref(href: string): ParsedDrill {
    const [route, search = ''] = href.split('?') as [string, string?];
    expect(route).toBe('/inventory/ledger');
    return parseDrill('ledger', paramsRecord(new URLSearchParams(search)));
  }

  test.each([
    ['grn', GRN, 'grnId', 'GRN-0042'],
    ['po', PO, 'poId', 'PO-0007'],
    ['order', ORDER, 'orderId', 'AMZ-401-7712'],
    ['adjustment', PEND, 'adjustmentPendingId', null],
    ['variance', VAR, 'countVarianceId', null],
  ] as const)('%s: href → parse → the request carries the warehouse path and ONLY its key — never doc or label', async (doc, id, key, label) => {
    const drill = parseHref(ledgerDocHref(doc, id, W, label));
    expect(drill).toMatchObject({ list: 'ledger', warehouseId: W, doc, [key]: id });
    const url = await send(drill as Drill, null);
    expect(url.pathname).toBe(`/api/v1/tenants/${T}/warehouses/${W}/inventory/events`);
    expect(sortedEntries(url.searchParams.entries())).toEqual([[key, id]]);
    expect(url.searchParams.has('doc')).toBe(false);
    expect(url.searchParams.has('label')).toBe(false);
  });

  test('the document drill uses ITS warehouse — whatever the link was clicked from', () => {
    const other = '0198f7a2-1b3c-7d4e-8f90-0000000000b2';
    expect(parseHref(ledgerDocHref('grn', GRN, other, 'GRN-1'))).toMatchObject({ warehouseId: other });
  });

  test('unsupported: a doc with another doc\'s key, a doc without its key, a document key without doc, an extra key, a bad doc, an oversized label', () => {
    const p = (params: Record<string, string>) => parseDrill('ledger', { list: 'ledger', warehouseId: W, ...params });
    expect(p({ doc: 'grn', poId: PO })).toBe('unsupported');
    expect(p({ doc: 'grn' })).toBe('unsupported');
    expect(p({ grnId: GRN })).toBe('unsupported');
    expect(p({ label: 'GRN-1', type: 'grn.received' })).toBe('unsupported');
    expect(p({ doc: 'grn', grnId: GRN, type: 'grn.received' })).toBe('unsupported');
    expect(p({ doc: 'grn', grnId: GRN, orderId: ORDER })).toBe('unsupported');
    expect(p({ doc: 'invoice', grnId: GRN })).toBe('unsupported');
    expect(p({ doc: 'grn', grnId: 'not-a-uuid' })).toBe('unsupported');
    expect(p({ doc: 'grn', grnId: GRN, label: 'x'.repeat(121) })).toBe('unsupported');
    // The dashboard's own order drill (orderId without doc) is unchanged.
    expect(p({ orderId: ORDER, type: 'pick.picked' })).toMatchObject({ orderId: ORDER });
  });

  test('the banner and the description name the document; the dashboard wording is unchanged', () => {
    const grn = parseHref(ledgerDocHref('grn', GRN, W, 'GRN-0042')) as Drill;
    expect(drillBannerWord(grn)).toBe('Showing ledger events for GRN GRN-0042');
    expect(describeDrill(grn, WAREHOUSES)).toBe('Ledger events of GRN GRN-0042 · MAIN Chennai DC');
    const po = parseHref(ledgerDocHref('po', PO, W, 'PO-0007')) as Drill;
    expect(drillBannerWord(po)).toBe('Showing ledger receipts for PO PO-0007');
    // No label: the short id stands in.
    const pend = parseHref(ledgerDocHref('adjustment', PEND, W)) as Drill;
    // The id's random tail — a UUIDv7's head is its timestamp, alike across a day.
    expect(drillBannerWord(pend)).toBe('Showing ledger events for adjustment 0000c001');
    const dashboard = parseDrill('ledger', { list: 'ledger', warehouseId: W, type: 'putaway.placed', to: TO }) as Drill;
    expect(drillBannerWord(dashboard)).toBe("Showing the dashboard figure's rows");
  });

  test('a document drill has its own remount key (label included), distinct from a plain visit', () => {
    const a = parseHref(ledgerDocHref('grn', GRN, W, 'GRN-1'));
    expect(drillKey(a)).toBe(drillKey(parseHref(ledgerDocHref('grn', GRN, W, 'GRN-1'))));
    expect(drillKey(a)).not.toBe(drillKey(null));
    expect(drillKey(a)).not.toBe(drillKey(parseHref(ledgerDocHref('grn', GRN, W, 'GRN-2'))));
  });
});
