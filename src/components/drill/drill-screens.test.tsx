import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act } from 'react';
import type { ComponentType, ReactElement } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { drillKey, parseDrill, type DrillScreen, type ParsedDrill } from '../../lib/drill';
import { parseInboundTab, type InboundTab } from '../../lib/inbound-tabs';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { readActiveWarehouseId, writeActiveWarehouseId } from '../../lib/warehouses';

/**
 * Story 9-1b — every drill target, driven through a stubbed `fetch` with
 * `next/navigation` mocked (the banner's Clear is the only router user).
 * For each screen it pins:
 *   1. drilled mode sends the drill's server filter EXACTLY — no forced
 *      status, kind or tab — and, path-scoped, the drill's warehouse in the
 *      path;
 *   2. the screen's own filter controls (and the outbound picker, the e-way
 *      selection) are hidden;
 *   3. the banner names the filter and the drill's warehouse;
 *   4. drill → Next (verbatim cursor) → Clear pushes the bare route, and the
 *      remounted normal view's first request carries no cursor and no drill
 *      filter, for the ACTIVE warehouse;
 *   5. the active warehouse is never written.
 */

const pushes: string[] = [];
const replaces: string[] = [];
let searchParamsNow: URLSearchParams | null = null;
let pathname = '/';

type Screen = ComponentType<{ drill?: ParsedDrill }>;
type Page = (props: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) => Promise<ReactElement>;
const PAGES: Record<string, Page> = {};
let Outbound: Screen;
let ConflictsQueues: Screen;
let InboundCards: Screen;
let ReplenishmentView: Screen;
let EwayBills: Screen;
let Invoices: Screen;
let Ledger: Screen;
let ledgerDrillEmptyMessage: (drill: never) => string;

beforeAll(async () => {
  const real = await import('next/navigation');
  mock.module('next/navigation', () => ({
    ...real,
    useRouter: () => ({
      push: (href: string) => void pushes.push(href),
      replace: (href: string) => void replaces.push(href),
      prefetch: () => undefined,
    }),
    usePathname: () => pathname,
    // null = outside the App Router (the screens' local-state path); a test
    // sets it to drive Inbound's URL-derived tab.
    useSearchParams: () => searchParamsNow,
  }));
  ({ Outbound } = await import('../outbound/outbound'));
  ({ ConflictsQueues } = await import('../conflicts/queues'));
  ({ InboundCards } = await import('../inbound/inbound-cards'));
  ({ ReplenishmentView } = await import('../replenishment/replenishment-view'));
  ({ EwayBills } = await import('../compliance/eway-bills'));
  ({ Invoices } = await import('../compliance/invoices'));
  ({ Ledger, ledgerDrillEmptyMessage } = await import('../inventory/ledger'));
  PAGES['/outbound'] = (await import('../../app/(app)/outbound/page')).default;
  PAGES['/conflicts'] = (await import('../../app/(app)/conflicts/page')).default;
  PAGES['/inbound'] = (await import('../../app/(app)/inbound/page')).default;
  PAGES['/replenishment'] = (await import('../../app/(app)/replenishment/page')).default;
  PAGES['/compliance'] = (await import('../../app/(app)/compliance/page')).default;
  PAGES['/inventory/ledger'] = (await import('../../app/(app)/inventory/ledger/page')).default;
});

const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
/** The ACTIVE warehouse. */
const W1 = '0198f7a2-1b3c-7d4e-8f90-99aabbccdd01';
/** The DRILL's warehouse — never the active one. */
const W2 = '0198f7a2-1b3c-7d4e-8f90-99aabbccdd02';
const FROM = '2026-10-05T18:30:00.000Z';
const TO = '2026-10-06T10:00:00.000Z';
const CURSOR = 'eyJjcmVhdGVkQXQiOiIyMDI2LTEwLTA2VDA5OjAwOjAwLjEyMzQ1NloiLCJpZCI6IngifQ';

const WAREHOUSES = [
  { id: W1, code: 'MAIN', name: 'Chennai DC' },
  { id: W2, code: 'NORTH', name: 'Delhi DC' },
];

function session(role: StoredSession['user']['role']): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: T, name: 'Priya Spices', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  };
}

const SKU = { id: 'sku-1', code: 'SPICE-01', name: 'Turmeric', uom: 'kg', uomPrecision: 3 };

const LEDGER_EVENT = {
  id: 'ev-1',
  seq: 41,
  type: 'putaway.placed',
  skuId: 'sku-1',
  fromBinId: 'bin-rcv',
  toBinId: 'bin-a1',
  quantityDelta: 2.5,
  batchRef: '0198f7a2-1b3c-7d4e-8f90-0000000000b1',
  serialRef: null,
  referenceDoc: { kind: 'grn-receipt', grnId: '0198f7a2-1b3c-7d4e-8f90-00000000a001' },
  actorUserId: 'u-1',
  occurredAt: '2026-10-06T09:59:00.000Z',
  recordedAt: '2026-10-06T10:00:05.000Z',
  eventHash: 'h',
  createdAt: '2026-10-06T10:00:05.000Z',
};

const PUTAWAY_TASK = {
  grnId: 'grn-1',
  grnCode: 'GRN-0007',
  grnLineId: 'gl-1',
  skuId: 'sku-1',
  skuCode: 'SPICE-01',
  batchId: null,
  batchCode: 'B-42',
  qty: 2.5,
  suggestedBin: { binId: 'bin-a1', binCode: 'A-01' },
  rationale: 'room',
};

/** Rows the DRILLED reads answer with (decision 7: their row actions stay). */
const ORDER_ROW = {
  id: 'order-1',
  tenantId: T,
  warehouseId: W2,
  status: 'accepted',
  source: 'ingested',
  integrationId: null,
  externalEventId: null,
  destination: null,
  createdAt: '2026-10-06T08:00:00.000Z',
  updatedAt: '2026-10-06T08:00:00.000Z',
};

const OVER_RECEIPT_ROW = {
  id: 'or-1',
  tenantId: T,
  warehouseId: W2,
  grnId: 'g-1',
  grnCode: 'GRN-0001',
  grnLineId: 'gl-1',
  poId: null,
  poLineId: null,
  skuId: 'sku-1',
  excessQty: 2,
  status: 'pending',
  requestedBy: 'u-1',
  requestedAt: '2026-10-06T04:30:00.000Z',
  decidedBy: null,
  decidedAt: null,
  createdAt: '2026-10-06T04:30:00.000Z',
};

const ALERT_ROW = {
  id: 'alert-1',
  warehouseId: W2,
  skuId: 'sku-1',
  batchId: 'batch-1',
  kind: 'expiry_upcoming',
  status: 'open',
  ageDays: null,
  batchCode: 'B-EX-01',
  onHandMilli: 2500,
  detectedAt: '2026-10-06T08:00:00.000Z',
  resolvedAt: null,
  resolvedBy: null,
};

function bill(id: string, status: 'pending' | 'generated', overrides: Record<string, unknown> = {}) {
  return {
    id,
    invoiceId: `inv-${id}`,
    invoiceNo: `INV-${id}`,
    invoiceIssuedAt: '2026-10-06T05:00:00.000Z',
    originGstin: '29ABCDE1234F1Z5',
    consigneeGstin: null,
    b2b: false,
    status,
    consignmentValuePaise: 7_080_000,
    thresholdPaise: 5_000_000,
    thresholdRule: 'national',
    transport: null,
    ewbNo: null,
    ewbGeneratedAt: null,
    ewbValidUntil: null,
    source: null,
    dismissedReason: null,
    lastError: null,
    gatewayClaimedAt: null,
    lastExportedAt: null,
    lastExportedBy: null,
    blockers: [],
    gatewayAvailable: false,
    createdAt: '2026-10-06T05:00:00.000Z',
    updatedAt: '2026-10-06T05:00:00.000Z',
    ...overrides,
  };
}
const GENERATED_BILL = bill('b-gen', 'generated', { ewbNo: '391000000001', source: 'gateway' });
const PENDING_BILL = bill('b-pend', 'pending');

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly params: URLSearchParams;
}

let requests: Recorded[] = [];
let putawayItems: unknown[] | 'fail' = [PUTAWAY_TASK];
let warehouseRows: unknown[] = WAREHOUSES;
let warehousesFail = false;
let grnMode: 'ok' | 'fail' | 'hold' = 'ok';
/** Story 9-3a — the rows the GRN and PO cards list (empty unless a test sets them). */
let grnRows: unknown[] = [];
let poRows: unknown[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A paged list: page one offers Next (`CURSOR`), the cursor's page is the last. */
const paged = (params: URLSearchParams, items: unknown[] = []) =>
  json(200, { items, nextCursor: params.has('cursor') ? null : CURSOR });

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    requests.push({ method, pathname: url.pathname, params: url.searchParams });
    const p = url.pathname;
    if (method !== 'GET') return json(404, { code: 'not-found', title: 'Unrouted', status: 404 });
    if (p === `/api/v1/tenants/${T}/warehouses`) {
      return warehousesFail
        ? json(500, { code: 'internal-error', title: 'Internal Server Error', status: 500 })
        : json(200, { items: warehouseRows, nextCursor: null });
    }
    // A drilled read (a window bound, or the drill's warehouse in the path)
    // answers with rows, so the row actions a drilled view keeps are observable.
    const drilled = url.searchParams.has('to') || p.includes(W2);
    if (p.endsWith('/catalog/skus')) return json(200, { items: [SKU], nextCursor: null });
    if (p.endsWith('/users')) {
      return json(200, { items: [{ id: 'u-1', email: 'priya@example.com', role: 'owner', status: 'active' }], nextCursor: null });
    }
    if (p.endsWith('/outbound/orders')) return paged(url.searchParams, drilled ? [ORDER_ROW] : []);
    if (p.endsWith('/receiving/over-receipts')) return paged(url.searchParams, drilled ? [OVER_RECEIPT_ROW] : []);
    if (p.endsWith('/receiving/goods-receipts')) {
      if (grnMode === 'hold') return new Promise<Response>(() => undefined);
      if (grnMode === 'fail') return json(500, { code: 'internal-error', title: 'Internal Server Error', status: 500, detail: 'GRN read failed' });
      return paged(url.searchParams, grnRows);
    }
    if (p.endsWith('/inbound/purchase-orders')) return paged(url.searchParams, poRows);
    if (p.endsWith('/replenishment/batch-alerts')) return paged(url.searchParams, drilled ? [ALERT_ROW] : []);
    if (p.endsWith('/eway/bills')) return paged(url.searchParams, drilled ? [GENERATED_BILL, PENDING_BILL] : []);
    if (p.endsWith('/invoices')) return paged(url.searchParams);
    if (p.endsWith('/inventory/events')) return paged(url.searchParams, [LEDGER_EVENT]);
    if (p.endsWith('/putaway/tasks')) {
      return putawayItems === 'fail'
        ? json(500, { code: 'internal-error', title: 'Internal Server Error', status: 500, detail: 'Putaway read failed' })
        : json(200, { items: putawayItems });
    }
    if (p.endsWith('/zones')) return json(200, { items: [{ id: 'z-1', code: 'Z' }], nextCursor: null });
    if (/\/zones\/[^/]+\/bins$/.test(p)) {
      return json(200, {
        items: [
          { id: 'bin-rcv', code: 'RCV-01' },
          { id: 'bin-a1', code: 'A-01' },
        ],
        nextCursor: null,
      });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  pushes.length = 0;
  replaces.length = 0;
  searchParamsNow = null;
  putawayItems = [PUTAWAY_TASK];
  warehouseRows = WAREHOUSES;
  warehousesFail = false;
  grnMode = 'ok';
  grnRows = [];
  poRows = [];
  try {
    localStorage.clear();
  } catch {
    // happy-dom always has it
  }
  stubRouter();
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
});

const reads = (suffix: string) => requests.filter((r) => r.method === 'GET' && r.pathname.endsWith(suffix));
const entries = (params: URLSearchParams) => [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
const sorted = (query: Record<string, string>) => Object.entries(query).sort(([a], [b]) => a.localeCompare(b));

/** What a page does: parse the URL's params, mount the screen keyed on the drill. */
function page(Component: Screen, screen: DrillScreen, params: Record<string, string>): { drill: ParsedDrill; element: ReactElement } {
  const drill = parseDrill(screen, params);
  // inbound-tabs — Inbound also reads `?tab=` (not a drill key).
  const tab = screen === 'inbound' ? parseInboundTab(params) : null;
  const Tabbed = Component as unknown as (props: { drill: ParsedDrill; initialTab?: InboundTab | null }) => ReactElement;
  return { drill, element: <Tabbed key={`${drillKey(drill)}|${tab ?? 'default'}`} drill={drill} initialTab={tab} /> };
}

async function mount(role: StoredSession['user']['role'], element: ReactElement): Promise<Rendered> {
  writeSession(session(role));
  writeActiveWarehouseId(T, W1);
  const rendered = render(element);
  await settle();
  return rendered;
}

function bannerOf(r: Rendered): HTMLElement {
  const banner = r.container.querySelector<HTMLElement>('[data-testid="drill-banner"]');
  if (banner === null) throw new Error('no drill banner');
  return banner;
}

function buttonIn(root: Element, label: string): HTMLButtonElement {
  const button = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  if (button === undefined) throw new Error(`no "${label}" button`);
  return button as HTMLButtonElement;
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
  });
  await settle();
}

interface Case {
  readonly name: string;
  readonly component: () => Screen;
  readonly screen: DrillScreen;
  readonly route: string;
  readonly params: Record<string, string>;
  /** The list route's path suffix. */
  readonly list: string;
  /** Exactly what the drilled request's query must be. */
  readonly sent: Record<string, string>;
  /** The warehouse a path-scoped list must carry in its path. */
  readonly pathWarehouse?: string;
  /** Words the banner must contain. */
  readonly banner: readonly string[];
  /** Controls present in the normal view and absent when drilled. */
  readonly controls: (r: Rendered) => boolean;
  /** The normal view's first request after Clear (beyond "no cursor, no drill keys"). */
  readonly normal: (r: Recorded) => void;
  /** inbound-tabs — the params Clear lands on (Inbound reopens the drilled list's tab). */
  readonly clearTo?: Record<string, string>;
}

const DRILL_ONLY_KEYS = [
  'from',
  'to',
  'source',
  'backordered',
  'blind',
  'type',
  'skuId',
  'orderId',
  'shortPick',
  'kind',
  'cursor',
  // Story 9-3a — the document drill's keys (and its display-only pair).
  'grnId',
  'poId',
  'adjustmentPendingId',
  'countVarianceId',
  'doc',
  'label',
];

/** Story 9-3a — the GRN a document drill names. */
const GRN_ID = '0198f7a2-1b3c-7d4e-8f90-00000000a001';

const tablist = (label: string) => (r: Rendered) => r.container.querySelector(`[role="tablist"][aria-label="${label}"]`) !== null;

const CASES: readonly Case[] = [
  {
    name: 'Outbound orders (path-scoped)',
    component: () => Outbound,
    screen: 'outbound',
    route: '/outbound',
    params: { list: 'orders', warehouseId: W2, source: 'ingested', backordered: 'true', from: FROM, to: TO },
    list: '/outbound/orders',
    sent: { source: 'ingested', backordered: 'true', from: FROM, to: TO },
    pathWarehouse: W2,
    banner: ['Orders', 'Channel orders', 'With a backordered line', 'NORTH Delhi DC'],
    // The orders section's page-scoped status filter, and the page's warehouse picker.
    controls: (r) => {
      const orders = [...r.container.querySelectorAll('section')].find(
        (s) => s.querySelector('h2')?.textContent === 'Orders',
      );
      const picker = [...r.container.querySelectorAll('label')].some((l) => l.textContent?.startsWith('Warehouse'));
      return (orders?.textContent ?? '').includes('Filter this page') || picker;
    },
    normal: (r) => {
      expect(r.pathname).toContain(`/warehouses/${W1}/outbound/orders`);
      expect([...r.params.keys()]).toEqual([]);
    },
  },
  {
    name: 'Conflicts — over-receipts (no forced status)',
    component: () => ConflictsQueues,
    screen: 'conflicts',
    route: '/conflicts',
    params: { list: 'over-receipts', warehouseId: W2, from: FROM, to: TO },
    list: '/receiving/over-receipts',
    sent: { warehouseId: W2, from: FROM, to: TO },
    banner: ['Over-receipts', 'All statuses', 'IST', 'NORTH Delhi DC'],
    controls: (r) => tablist('Over-receipt status')(r) || tablist('Conflicts queue')(r),
    normal: (r) => expect(entries(r.params)).toEqual([['status', 'pending']]),
  },
  {
    name: 'Inbound — goods receipts',
    component: () => InboundCards,
    screen: 'inbound',
    route: '/inbound',
    params: { list: 'grns', warehouseId: W2, blind: 'true', from: FROM, to: TO },
    list: '/receiving/goods-receipts',
    sent: { warehouseId: W2, blind: 'true', from: FROM, to: TO },
    banner: ['Goods receipts', 'Blind receipts', 'NORTH Delhi DC'],
    controls: () => false, // the GRN card has no filter control of its own
    // The house GRN hook reads tenant-wide while the warehouses load, then the active one.
    normal: (r) => expect([[], [['warehouseId', W1]]]).toContainEqual(entries(r.params)),
    clearTo: { tab: 'grns' },
  },
  {
    name: 'Replenishment — batch alerts (no forced kind or status)',
    component: () => ReplenishmentView,
    screen: 'replenishment',
    route: '/replenishment',
    params: { list: 'batch-alerts', warehouseId: W2, from: FROM, to: TO },
    list: '/replenishment/batch-alerts',
    sent: { warehouseId: W2, from: FROM, to: TO },
    banner: ['Batch alerts', 'All statuses', 'NORTH Delhi DC'],
    controls: (r) =>
      tablist('Batch alert kind')(r) ||
      tablist('Batch alert status')(r) ||
      [...r.container.querySelectorAll('label')].some((l) => l.textContent?.startsWith('Warehouse')),
    normal: (r) => expect(entries(r.params)).toEqual([['status', 'open'], ['warehouseId', W1]]),
  },
  {
    name: 'Compliance — e-way bills (no forced status)',
    component: () => EwayBills,
    screen: 'compliance',
    route: '/compliance',
    params: { list: 'eway', warehouseId: W2, source: 'gateway', from: FROM, to: TO },
    list: '/eway/bills',
    sent: { warehouseId: W2, source: 'gateway', from: FROM, to: TO },
    banner: ['E-way bills', 'All statuses', 'Generated by gateway', 'NORTH Delhi DC'],
    controls: (r) =>
      tablist('E-way bill status')(r) ||
      r.container.querySelector('select[aria-label="Supplier GSTIN"]') !== null ||
      r.container.querySelector('table input[type="checkbox"]') !== null ||
      (r.container.textContent ?? '').includes('Download'),
    normal: (r) => expect(entries(r.params)).toEqual([['status', 'pending']]),
  },
  {
    name: 'Compliance — invoices',
    component: () => Invoices,
    screen: 'compliance',
    route: '/compliance',
    params: { list: 'invoices', warehouseId: W2, from: FROM, to: TO },
    list: '/invoices',
    sent: { warehouseId: W2, from: FROM, to: TO },
    banner: ['Invoices', 'NORTH Delhi DC'],
    controls: () => false, // the invoice list has no filter control
    normal: (r) => expect([...r.params.keys()]).toEqual([]),
  },
  {
    name: 'Ledger (path-scoped)',
    component: () => Ledger,
    screen: 'ledger',
    route: '/inventory/ledger',
    params: { list: 'ledger', warehouseId: W2, type: 'putaway.placed', from: FROM, to: TO },
    list: '/inventory/events',
    sent: { type: 'putaway.placed', from: FROM, to: TO },
    pathWarehouse: W2,
    banner: ['Ledger events', 'Put away', 'NORTH Delhi DC'],
    controls: () => false,
    normal: (r) => {
      expect(r.pathname).toContain(`/warehouses/${W1}/inventory/events`);
      expect([...r.params.keys()]).toEqual([]);
    },
  },
  {
    // Story 9-3a — a GRN card's "View ledger": the GRN's OWN warehouse (W2,
    // not the active W1), its one key — never `doc` or `label`, which are
    // the banner's words only.
    name: 'Ledger — a document drill (GRN, View ledger)',
    component: () => Ledger,
    screen: 'ledger',
    route: '/inventory/ledger',
    params: { list: 'ledger', warehouseId: W2, doc: 'grn', grnId: GRN_ID, label: 'GRN-0042' },
    list: '/inventory/events',
    sent: { grnId: GRN_ID },
    pathWarehouse: W2,
    banner: ['Showing ledger events for GRN GRN-0042', 'Ledger events of GRN GRN-0042', 'NORTH Delhi DC'],
    controls: () => false,
    normal: (r) => {
      expect(r.pathname).toContain(`/warehouses/${W1}/inventory/events`);
      expect([...r.params.keys()]).toEqual([]);
    },
  },
];

describe.each([...CASES])('$name', (c) => {
  test('drilled: exactly the drill is sent; controls hidden; the banner names filter and warehouse', async () => {
    pathname = c.route;
    const { element } = page(c.component(), c.screen, c.params);
    view = await mount('owner', element);

    // A path-scoped drill's section reads the drill warehouse's path; a
    // sibling section on the same page (the waves surface reads orders too)
    // reads the active warehouse, unfiltered.
    const list = reads(c.list).filter(
      (r) => c.pathWarehouse === undefined || r.pathname.includes(`/warehouses/${c.pathWarehouse}/`),
    );
    expect(list.length).toBeGreaterThan(0);
    for (const r of list) expect(entries(r.params)).toEqual(sorted(c.sent));
    if (c.pathWarehouse !== undefined) {
      for (const r of reads(c.list).filter((r) => !list.includes(r))) {
        expect(r.pathname).toContain(`/warehouses/${W1}/`);
        expect([...r.params.keys()]).toEqual([]);
      }
    }
    expect(c.controls(view)).toBe(false);
    const text = bannerOf(view).textContent ?? '';
    for (const word of c.banner) expect(text).toContain(word);
    expect(readActiveWarehouseId(T)).toBe(W1);
  });

  test('drill → Next → Clear: the cursor rides verbatim; Clear remounts the normal view with no cursor and no filter', async () => {
    pathname = c.route;
    const { element } = page(c.component(), c.screen, c.params);
    view = await mount('owner', element);
    const section = bannerOf(view).closest('section')!;

    await click(buttonIn(section, 'Next'));
    const afterNext = reads(c.list).at(-1)!;
    expect(afterNext.params.get('cursor')).toBe(CURSOR);
    expect(entries(afterNext.params).filter(([k]) => k !== 'cursor')).toEqual(sorted(c.sent));

    await click(buttonIn(bannerOf(view), 'Clear'));
    expect(pushes).toEqual([c.clearTo === undefined ? c.route : `${c.route}?${new URLSearchParams(c.clearTo)}`]);

    // What the page does on the soft navigation: the bare URL parses to no
    // drill, and the new key remounts the screen.
    const before = requests.length;
    const bare = page(c.component(), c.screen, c.clearTo ?? {});
    expect(bare.drill).toBeNull();
    view.rerender(bare.element);
    await settle();
    const first = requests.slice(before).find((r) => r.method === 'GET' && r.pathname.endsWith(c.list));
    expect(first).toBeDefined();
    for (const key of DRILL_ONLY_KEYS) expect(first!.params.has(key)).toBe(false);
    // Nor the drill's warehouse, in the query or the path.
    expect(first!.params.get('warehouseId')).not.toBe(W2);
    expect(first!.pathname).not.toContain(W2);
    c.normal(first!);
    expect(view.container.querySelector('[data-testid="drill-banner"]')).toBeNull();
    expect(readActiveWarehouseId(T)).toBe(W1);
  });
});

describe('story 9-3a — "View ledger" on the inbound cards uses the DOCUMENT\'s warehouse, never the active one', () => {
  test('the GRN card links its GRN (code as the label); the PO card links "Receipts in the ledger" for the warehouse it receives into', async () => {
    grnRows = [
      {
        id: GRN_ID,
        tenantId: T,
        warehouseId: W2,
        code: 'GRN-0042',
        poId: null,
        blindReasonCode: 'unannounced-delivery',
        status: 'recorded',
        recordedBy: 'u-1',
        occurredAt: '2026-10-06T08:00:00.000Z',
        recordedAt: '2026-10-06T08:00:00.000Z',
        lineCount: 3,
        totalUnits: 3,
        appliedUnits: 3,
        createdAt: '2026-10-06T08:00:00.000Z',
      },
    ];
    const PO_ID = '0198f7a2-1b3c-7d4e-8f90-00000000b001';
    poRows = [
      {
        id: PO_ID,
        tenantId: T,
        warehouseId: W2,
        vendorId: 'v-1',
        code: 'PO-0007',
        status: 'open',
        carriedFromPoId: null,
        lines: [],
        createdAt: '2026-10-06T08:00:00.000Z',
        updatedAt: '2026-10-06T08:00:00.000Z',
      },
    ];
    pathname = '/inbound';
    // inbound-tabs — one card at a time: the GRN tab, then the PO tab.
    view = await mount('owner', page(InboundCards, 'inbound', { tab: 'grns' }).element);
    const linksNow = () => [...view!.container.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]);
    const grnLinks = linksNow();
    await click(buttonIn(view.container, 'Purchase orders'));
    const links = [...grnLinks, ...linksNow()];
    const grnLink = links.find(([text]) => text === 'View ledger');
    expect(grnLink).toBeDefined();
    const grnParams = new URL(`http://x${grnLink![1]}`).searchParams;
    expect(new URL(`http://x${grnLink![1]}`).pathname).toBe('/inventory/ledger');
    expect(Object.fromEntries(grnParams)).toEqual({ list: 'ledger', warehouseId: W2, doc: 'grn', grnId: GRN_ID, label: 'GRN-0042' });
    const poLink = links.find(([text]) => text === 'Receipts in the ledger');
    expect(poLink).toBeDefined();
    expect(Object.fromEntries(new URL(`http://x${poLink![1]}`).searchParams)).toEqual({
      list: 'ledger',
      warehouseId: W2,
      doc: 'po',
      poId: PO_ID,
      label: 'PO-0007',
    });
    // The active warehouse is untouched.
    expect(readActiveWarehouseId(T)).toBe(W1);
  });
});

describe('story 9-3a — a document drill words the page for its document; the dashboard wording stays', () => {
  test('the GRN drill: the description names the GRN; a dashboard drill keeps "the dashboard figure\'s ledger events"', async () => {
    pathname = '/inventory/ledger';
    view = await mount('owner', page(Ledger, 'ledger', { list: 'ledger', warehouseId: W2, doc: 'grn', grnId: GRN_ID, label: 'GRN-0042' }).element);
    expect(view.container.textContent).toContain('NORTH Delhi DC — the ledger events of GRN GRN-0042, newest first.');
    expect(view.container.textContent).not.toContain("the dashboard figure's");
    view!.unmount();
    view = await mount('owner', page(Ledger, 'ledger', { list: 'ledger', warehouseId: W2, type: 'putaway.placed', to: TO }).element);
    expect(view.container.textContent).toContain("the dashboard figure's ledger events");
    expect(bannerOf(view).textContent).toContain("Showing the dashboard figure's rows");
  });

  test('the PO drill says receipts', async () => {
    pathname = '/inventory/ledger';
    const PO_ID = '0198f7a2-1b3c-7d4e-8f90-00000000b001';
    view = await mount('owner', page(Ledger, 'ledger', { list: 'ledger', warehouseId: W2, doc: 'po', poId: PO_ID, label: 'PO-0007' }).element);
    expect(bannerOf(view).textContent).toContain('Showing ledger receipts for PO PO-0007');
    expect(view.container.textContent).toContain('the receipt events of PO PO-0007');
    // The empty state says receipts too (F6).
    expect(ledgerDrillEmptyMessage(parseDrill('ledger', { list: 'ledger', warehouseId: W2, doc: 'po', poId: PO_ID, label: 'PO-0007' }) as never)).toBe(
      'No receipt events for PO PO-0007 yet.',
    );
    expect(
      ledgerDrillEmptyMessage(parseDrill('ledger', { list: 'ledger', warehouseId: W2, doc: 'grn', grnId: GRN_ID, label: 'GRN-0042' }) as never),
    ).toBe('No ledger events for GRN GRN-0042 yet.');
    const drilled = reads('/inventory/events').filter((r) => r.pathname.includes(W2));
    expect(drilled.length).toBeGreaterThan(0);
    for (const r of drilled) {
      expect(entries(r.params)).toEqual([['poId', PO_ID]]);
    }
  });
});

describe('the normal view still has its controls (so the "hidden" assertions bite)', () => {
  const WITHOUT_CONTROLS = [
    'Inbound — goods receipts',
    'Compliance — invoices',
    'Ledger (path-scoped)',
    'Ledger — a document drill (GRN, View ledger)',
  ];
  test.each(CASES.filter((c) => !WITHOUT_CONTROLS.includes(c.name)))(
    '$name',
    async (c) => {
      pathname = c.route;
      view = await mount('owner', page(c.component(), c.screen, {}).element);
      expect(c.controls(view)).toBe(true);
    },
  );
});

describe('forced filters never ride a drill', () => {
  test('a live expiry drill sends its own kind and status — and nothing of the tabs', async () => {
    pathname = '/replenishment';
    const params = { list: 'batch-alerts', warehouseId: W2, kind: 'aged', status: 'open', to: TO };
    view = await mount('owner', page(ReplenishmentView, 'replenishment', params).element);
    for (const r of reads('/replenishment/batch-alerts')) {
      expect(entries(r.params)).toEqual(sorted({ warehouseId: W2, kind: 'aged', status: 'open', to: TO }));
    }
  });

  test('a pending over-receipt drill (live) sends its status, and the banner reads "as of"', async () => {
    pathname = '/conflicts';
    const params = { list: 'over-receipts', warehouseId: W2, status: 'pending', to: TO };
    view = await mount('owner', page(ConflictsQueues, 'conflicts', params).element);
    for (const r of reads('/receiving/over-receipts')) {
      expect(entries(r.params)).toEqual(sorted({ warehouseId: W2, status: 'pending', to: TO }));
    }
    expect(bannerOf(view).textContent).toContain('as of 06 Oct 2026, 15:30 IST');
  });

  test('the outbound picker (which writes the active warehouse) is hidden only while drilled', async () => {
    pathname = '/outbound';
    view = await mount('owner', page(Outbound, 'outbound', { list: 'orders', warehouseId: W2, status: 'accepted', to: TO }).element);
    const pickers = [...view.container.querySelectorAll('label')].filter((l) => l.textContent?.startsWith('Warehouse'));
    expect(pickers).toHaveLength(0);
    // The waves surface still reads the ACTIVE warehouse.
    expect(reads('/outbound/waves').every((r) => r.pathname.includes(`/warehouses/${W1}/`))).toBe(true);
  });

  test('…and IS present in the normal view', async () => {
    pathname = '/outbound';
    view = await mount('owner', page(Outbound, 'outbound', {}).element);
    const pickers = [...view.container.querySelectorAll('label')].filter((l) => l.textContent?.startsWith('Warehouse'));
    expect(pickers).toHaveLength(1);
  });
});

/** Text of the section whose heading is `title`. */
function sectionText(r: Rendered, title: string): string {
  const section = [...r.container.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === title);
  if (section === undefined) throw new Error(`no "${title}" section`);
  return section.textContent ?? '';
}

const buttons = (root: Element, label: string) =>
  [...root.querySelectorAll('button')].filter((b) => b.textContent?.trim() === label);

describe('decision 7 — row actions stay, bulk and page-level create are hidden while drilled', () => {
  test('outbound: the order row keeps Cancel; the create form is hidden (and shown in the normal view)', async () => {
    pathname = '/outbound';
    view = await mount('owner', page(Outbound, 'outbound', { list: 'orders', warehouseId: W2, status: 'accepted', to: TO }).element);
    const orders = sectionText(view, 'Orders');
    expect(orders).not.toContain('Create order');
    const section = bannerOf(view).closest('section')!;
    expect(buttons(section, 'Cancel')).toHaveLength(1);
    view.rerender(page(Outbound, 'outbound', {}).element);
    await settle();
    expect(sectionText(view, 'Orders')).toContain('Create order');
  });

  test('conflicts: the over-receipt row keeps Approve and Reject', async () => {
    pathname = '/conflicts';
    view = await mount('owner', page(ConflictsQueues, 'conflicts', { list: 'over-receipts', warehouseId: W2, from: FROM, to: TO }).element);
    const section = bannerOf(view).closest('section')!;
    expect(buttons(section, 'Approve')).toHaveLength(1);
    expect(buttons(section, 'Reject')).toHaveLength(1);
  });

  test('replenishment: the open alert keeps Dismiss', async () => {
    pathname = '/replenishment';
    view = await mount('owner', page(ReplenishmentView, 'replenishment', { list: 'batch-alerts', warehouseId: W2, from: FROM, to: TO }).element);
    const section = bannerOf(view).closest('section')!;
    expect(buttons(section, 'Dismiss')).toHaveLength(1);
  });

  test('e-way: no selection or download; Act only on the pending row; the drilled columns render', async () => {
    pathname = '/compliance';
    view = await mount('owner', page(EwayBills, 'compliance', { list: 'eway', warehouseId: W2, from: FROM, to: TO }).element);
    const section = bannerOf(view).closest('section')!;
    expect(section.querySelector('table input[type="checkbox"]')).toBeNull();
    expect(section.textContent).not.toContain('Download');
    const headers = [...section.querySelectorAll('th')].map((th) => th.textContent);
    expect(headers).toEqual(expect.arrayContaining(['Status', 'EWB number', 'Source']));
    const rows = [...section.querySelectorAll('tbody tr')];
    const generated = rows.find((r) => r.textContent?.includes('INV-b-gen'))!;
    const pending = rows.find((r) => r.textContent?.includes('INV-b-pend'))!;
    expect(generated.textContent).toContain('Generated');
    expect(generated.textContent).toContain('391000000001');
    expect(generated.textContent).toContain('Gateway');
    expect(generated.querySelector('button')).toBeNull();
    expect(buttons(pending, 'Act')).toHaveLength(1);
  });

  test('invoices: the generate-for-order form is hidden while drilled, shown in the normal view', async () => {
    pathname = '/compliance';
    view = await mount('owner', page(Invoices, 'compliance', { list: 'invoices', warehouseId: W2, from: FROM, to: TO }).element);
    expect(view.container.textContent).not.toContain('Generate for a dispatched order');
    view.rerender(page(Invoices, 'compliance', {}).element);
    await settle();
    expect(view.container.textContent).toContain('Generate for a dispatched order');
  });
});

describe('the drill never escapes its section', () => {
  test('conflicts: the queue tab strip is hidden while drilled (and shown normally)', async () => {
    pathname = '/conflicts';
    view = await mount('owner', page(ConflictsQueues, 'conflicts', { list: 'over-receipts', warehouseId: W2, from: FROM, to: TO }).element);
    expect(tablist('Conflicts queue')(view)).toBe(false);
    view.rerender(page(ConflictsQueues, 'conflicts', {}).element);
    await settle();
    expect(tablist('Conflicts queue')(view)).toBe(true);
  });

  test('replenishment: the warehouse picker is hidden while drilled (and shown normally)', async () => {
    pathname = '/replenishment';
    const picker = (r: Rendered) => [...r.container.querySelectorAll('label')].some((l) => l.textContent?.startsWith('Warehouse'));
    view = await mount('owner', page(ReplenishmentView, 'replenishment', { list: 'batch-alerts', warehouseId: W2, to: TO }).element);
    expect(picker(view)).toBe(false);
    view.rerender(page(ReplenishmentView, 'replenishment', {}).element);
    await settle();
    expect(picker(view)).toBe(true);
  });
});

describe('Inbound — the goods receipts read states', () => {
  const GRN_DRILL = { list: 'grns', warehouseId: W2, blind: 'true', from: FROM, to: TO };

  test('loading reads "Loading receipts…", never "No receipts match"', async () => {
    grnMode = 'hold';
    pathname = '/inbound';
    view = await mount('owner', page(InboundCards, 'inbound', GRN_DRILL).element);
    const text = sectionText(view, 'Goods receipt notes');
    expect(text).toContain('Loading receipts…');
    expect(text).not.toContain('No receipts match this figure');
  });

  test.each([
    ['drilled', GRN_DRILL, 'No receipts match this figure.'],
    ['normal', { tab: 'grns' }, 'No receipts recorded yet.'],
  ] as const)('%s: a failed read shows ReadFailure with Retry, which re-reads', async (_name, params, empty) => {
    grnMode = 'fail';
    pathname = '/inbound';
    view = await mount('owner', page(InboundCards, 'inbound', params).element);
    const section = [...view.container.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === 'Goods receipt notes')!;
    expect(section.textContent).toContain('Goods receipts unavailable');
    expect(section.textContent).not.toContain(empty);
    grnMode = 'ok';
    const before = reads('/receiving/goods-receipts').length;
    await click(buttonIn(section, 'Retry'));
    expect(reads('/receiving/goods-receipts').length).toBeGreaterThan(before);
    expect(section.textContent).toContain(empty);
  });
});

describe('Conflicts — a role without the over-receipts tab', () => {
  test('reads "This list isn\'t available to you" and sends no over-receipt read', async () => {
    pathname = '/conflicts';
    const params = { list: 'over-receipts', warehouseId: W2, from: FROM, to: TO };
    view = await mount('operator', page(ConflictsQueues, 'conflicts', params).element);
    expect(view.container.querySelector('[data-testid="drill-unavailable"]')?.textContent).toContain(
      "This list isn't available to you",
    );
    expect(reads('/receiving/over-receipts')).toHaveLength(0);
  });
});

describe('Inbound — tabs (inbound-tabs)', () => {
  // These tests rewrite the shared happy-dom URL; restore it EXACTLY as they
  // found it — a later suite's hash handling depends on the starting URL.
  let originalHref = '';
  beforeEach(() => {
    originalHref = window.location.href;
  });
  afterEach(() => window.history.replaceState(null, '', originalHref));

  test('opens on Purchase orders and mounts only that card', async () => {
    pathname = '/inbound';
    view = await mount('owner', page(InboundCards, 'inbound', {}).element);
    const tablist = view.container.querySelector('[role="tablist"]')!;
    expect(tablist.querySelector('[aria-selected="true"]')?.textContent).toBe('Purchase orders');
    expect(reads('/receiving/goods-receipts')).toHaveLength(0);
    expect(reads('/putaway/tasks')).toHaveLength(0);
  });

  test('?tab= opens that tab; an unknown tab falls back to Purchase orders', async () => {
    pathname = '/inbound';
    view = await mount('owner', page(InboundCards, 'inbound', { tab: 'putaway' }).element);
    expect(view.container.querySelector('[role="tablist"] [aria-selected="true"]')?.textContent).toBe('Awaiting putaway');
    expect(view.container.querySelector('[data-testid="awaiting-putaway"]')).not.toBeNull();
    view!.unmount();
    view = await mount('owner', page(InboundCards, 'inbound', { tab: 'nope' }).element);
    expect(view.container.querySelector('[role="tablist"] [aria-selected="true"]')?.textContent).toBe('Purchase orders');
  });

  test('a click switches the card and rewrites the URL in place — no router navigation', async () => {
    pathname = '/inbound';
    view = await mount('owner', page(InboundCards, 'inbound', {}).element);
    await click(buttonIn(view.container.querySelector('[role="tablist"]')!, 'QC holds'));
    expect(view.container.querySelector('[role="tablist"] [aria-selected="true"]')?.textContent).toBe('QC holds');
    expect(window.location.search).toBe('?tab=qc-holds');
    expect(pushes).toEqual([]);
    expect(replaces).toEqual([]);
  });

  test('in the App Router the tab follows the live URL — a later bare /inbound or ?tab= link is never left on a stale pick', async () => {
    pathname = '/inbound';
    searchParamsNow = new URLSearchParams('tab=qc-holds');
    view = await mount('owner', page(InboundCards, 'inbound', { tab: 'qc-holds' }).element);
    const selected = () => view!.container.querySelector('[role="tablist"] [aria-selected="true"]')?.textContent;
    expect(selected()).toBe('QC holds');
    // The sidebar's bare /inbound (same page key as a default load): the URL wins.
    searchParamsNow = new URLSearchParams('');
    view.rerender(page(InboundCards, 'inbound', { tab: 'qc-holds' }).element);
    await settle();
    expect(selected()).toBe('Purchase orders');
    // A bell link back to ?tab=qc-holds.
    searchParamsNow = new URLSearchParams('tab=qc-holds');
    view.rerender(page(InboundCards, 'inbound', { tab: 'qc-holds' }).element);
    await settle();
    expect(selected()).toBe('QC holds');
  });

  test('clicking the default tab writes the bare route; clicking the open tab writes nothing', async () => {
    pathname = '/inbound';
    window.history.replaceState(null, '', '/inbound?tab=asns');
    view = await mount('owner', page(InboundCards, 'inbound', { tab: 'asns' }).element);
    const tablist = view.container.querySelector('[role="tablist"]')!;
    await click(buttonIn(tablist, 'Purchase orders'));
    expect(window.location.pathname + window.location.search).toBe('/inbound');
    window.history.replaceState(null, '', '/inbound?tab=marker');
    await click(buttonIn(tablist, 'Purchase orders'));
    expect(window.location.search).toBe('?tab=marker');
  });
});

describe('Inbound — Awaiting putaway', () => {
  test('its tab shows it for the active warehouse, with its columns', async () => {
    pathname = '/inbound';
    view = await mount('owner', page(InboundCards, 'inbound', { tab: 'putaway' }).element);
    const section = view.container.querySelector('[data-testid="awaiting-putaway"]')!;
    expect(section).not.toBeNull();
    expect(reads('/putaway/tasks').map((r) => entries(r.params))).toEqual([[['warehouseId', W1]]]);
    const text = section.textContent ?? '';
    for (const cell of ['GRN-0007', 'SPICE-01', 'B-42', '2.500 kg', 'A-01']) expect(text).toContain(cell);
    expect(section.querySelector('[data-testid="drill-banner"]')).toBeNull();
  });

  test('a putaway drill scopes it to the drill warehouse, under the banner, on its own tab; another tab leaves the drill', async () => {
    pathname = '/inbound';
    view = await mount('owner', page(InboundCards, 'inbound', { list: 'putaway', warehouseId: W2 }).element);
    expect(reads('/putaway/tasks').map((r) => entries(r.params))).toEqual([[['warehouseId', W2]]]);
    const section = view.container.querySelector('[data-testid="awaiting-putaway"]')!;
    expect(section.querySelector('[data-testid="drill-banner"]')?.textContent).toContain('Awaiting putaway · NORTH Delhi DC');
    // inbound-tabs — the drill opens on its own tab and mounts only that card;
    // another tab leaves the drill through the router (`?tab=`).
    const tablist = view.container.querySelector('[role="tablist"]')!;
    expect(tablist.querySelector('[aria-selected="true"]')?.textContent).toBe('Awaiting putaway');
    expect(reads('/receiving/goods-receipts')).toHaveLength(0);
    await click(buttonIn(tablist, 'Goods receipts'));
    expect(replaces).toEqual(['/inbound?tab=grns']);
    expect(pushes).toEqual([]);
    // What the page does on that soft navigation: no drill, the GRN tab, the
    // active warehouse, no drill-only keys.
    view.rerender(page(InboundCards, 'inbound', { tab: 'grns' }).element);
    await settle();
    expect(view.container.querySelector('[data-testid="drill-banner"]')).toBeNull();
    const grns = reads('/receiving/goods-receipts');
    expect(grns.length).toBeGreaterThan(0);
    expect(entries(grns.at(-1)!.params)).toEqual([['warehouseId', W1]]);
    for (const r of grns) for (const key of DRILL_ONLY_KEYS) expect(r.params.has(key)).toBe(false);
    expect(readActiveWarehouseId(T)).toBe(W1);
  });

  test('empty reads "Nothing awaiting putaway"', async () => {
    putawayItems = [];
    pathname = '/inbound';
    view = await mount('owner', page(InboundCards, 'inbound', { tab: 'putaway' }).element);
    expect(view.container.querySelector('[data-testid="awaiting-putaway"]')?.textContent).toContain('Nothing awaiting putaway');
  });

  test('a failed read renders the shared failure with Retry — never "nothing awaiting"', async () => {
    putawayItems = 'fail';
    pathname = '/inbound';
    view = await mount('owner', page(InboundCards, 'inbound', { tab: 'putaway' }).element);
    const section = view.container.querySelector('[data-testid="awaiting-putaway"]')!;
    expect(section.textContent).toContain('Putaway tasks unavailable');
    expect(section.textContent).not.toContain('Nothing awaiting putaway');
    putawayItems = [];
    await click(buttonIn(section, 'Retry'));
    expect(reads('/putaway/tasks')).toHaveLength(2);
    expect(section.textContent).toContain('Nothing awaiting putaway');
  });
});

describe('Ledger', () => {
  test('the active warehouse\'s events, with every column', async () => {
    pathname = '/inventory/ledger';
    view = await mount('owner', page(Ledger, 'ledger', {}).element);
    expect(reads('/inventory/events')[0]!.pathname).toContain(`/warehouses/${W1}/inventory/events`);
    const row = view.container.querySelector('tbody tr')!;
    const cells = [...row.querySelectorAll('td')].map((td) => td.textContent ?? '');
    expect(cells).toEqual([
      '06 Oct 2026, 15:30:05',
      'Put away',
      'SPICE-01',
      '+2.500 kg',
      'RCV-01 → A-01',
      'batch 0198f7a2',
      'priya@example.com',
      'grn-receipt · GRN 0198f7a2',
    ]);
  });

  test.each([
    ['no warehouses', (): void => void (warehouseRows = [])],
    ['a failed warehouses read', (): void => void (warehousesFail = true)],
  ] as const)('drilled with %s: the drill warehouse\'s events still render, named by short id', async (_name, arrange) => {
    arrange();
    pathname = '/inventory/ledger';
    view = await mount('owner', page(Ledger, 'ledger', { list: 'ledger', warehouseId: W2, type: 'putaway.placed', to: TO }).element);
    expect(reads('/inventory/events')[0]!.pathname).toContain(`/warehouses/${W2}/inventory/events`);
    expect(view.container.querySelector('tbody tr')?.textContent).toContain('Put away');
    expect(view.container.textContent).toContain('Warehouse 0198f7a2');
    expect(view.container.textContent).not.toContain('Create a warehouse first');
    expect(view.container.textContent).not.toContain('Warehouses not loaded');
  });

  test('no warehouses → "Create a warehouse first"', async () => {
    warehouseRows = [];
    pathname = '/inventory/ledger';
    view = await mount('owner', page(Ledger, 'ledger', {}).element);
    expect(view.container.textContent).toContain('Create a warehouse first');
    expect(reads('/inventory/events')).toHaveLength(0);
  });
});

/**
 * The real `page.tsx` files: `await Page({ searchParams })`, rendered. Pins
 * the server half of the pattern — the parse, the remount key, the
 * unsupported notice, and compliance's two keyed sections.
 */
describe('the pages', () => {
  const PAGE_CASES = [
    { route: '/outbound', params: CASES[0]!.params, list: '/outbound/orders' },
    { route: '/conflicts', params: CASES[1]!.params, list: '/receiving/over-receipts' },
    { route: '/inbound', params: CASES[2]!.params, list: '/receiving/goods-receipts', clearTo: { tab: 'grns' } },
    { route: '/replenishment', params: CASES[3]!.params, list: '/replenishment/batch-alerts' },
    { route: '/compliance', params: CASES[4]!.params, list: '/eway/bills' },
    { route: '/inventory/ledger', params: CASES[6]!.params, list: '/inventory/events' },
  ];

  async function renderPage(route: string, params: Record<string, string>): Promise<ReactElement> {
    return PAGES[route]!({ searchParams: Promise.resolve(params) });
  }

  test.each(PAGE_CASES)('$route: a drill reaches its section; re-rendering with {} remounts to the normal view', async ({ route, params, list, ...rest }) => {
    const clearTo = 'clearTo' in rest ? rest.clearTo : undefined;
    pathname = route;
    writeSession(session('owner'));
    writeActiveWarehouseId(T, W1);
    view = render(await renderPage(route, params));
    await settle();
    expect(bannerOf(view)).toBeDefined();
    expect(reads(list).some((r) => r.params.has('to'))).toBe(true);

    const section = bannerOf(view).closest('section')!;
    await click(buttonIn(section, 'Next'));
    expect(reads(list).at(-1)!.params.get('cursor')).toBe(CURSOR);

    const before = requests.length;
    view.rerender(await renderPage(route, clearTo ?? {}));
    await settle();
    const first = requests.slice(before).find((r) => r.method === 'GET' && r.pathname.endsWith(list));
    expect(first).toBeDefined();
    for (const key of DRILL_ONLY_KEYS) expect(first!.params.has(key)).toBe(false);
    expect(view.container.querySelector('[data-testid="drill-banner"]')).toBeNull();
    expect(view.container.querySelector('[data-testid="drill-unsupported"]')).toBeNull();
  });

  test.each(PAGE_CASES)('$route: an unsupported link renders the notice over the normal view', async ({ route, list }) => {
    pathname = route;
    writeSession(session('owner'));
    writeActiveWarehouseId(T, W1);
    view = render(await renderPage(route, { list: 'nonsense', from: FROM }));
    await settle();
    expect(view.container.querySelector('[data-testid="drill-unsupported"]')?.textContent).toContain('Link not applied');
    expect(view.container.querySelector('[data-testid="drill-banner"]')).toBeNull();
    for (const r of reads(list)) expect(r.params.has('from')).toBe(false);
  });

  test('an unrelated param with no `list` is a plain visit — no notice', async () => {
    pathname = '/outbound';
    writeSession(session('owner'));
    view = render(await renderPage('/outbound', { utm_source: 'mail' }));
    await settle();
    expect(view.container.querySelector('[data-testid="drill-unsupported"]')).toBeNull();
    expect(view.container.querySelector('[data-testid="drill-banner"]')).toBeNull();
  });

  test('compliance: `list` picks the keyed section — the other renders normally', async () => {
    pathname = '/compliance';
    writeSession(session('owner'));
    view = render(await renderPage('/compliance', { list: 'invoices', warehouseId: W2, from: FROM, to: TO }));
    await settle();
    expect(sectionText(view, 'Invoices')).toContain("Showing the dashboard figure's rows");
    expect(sectionText(view, 'E-way bills')).not.toContain("Showing the dashboard figure's rows");
    expect(reads('/invoices').every((r) => r.params.get('warehouseId') === W2)).toBe(true);
    expect(reads('/eway/bills').every((r) => entries(r.params).length === 1 && r.params.get('status') === 'pending')).toBe(true);

    requests = [];
    view.rerender(await renderPage('/compliance', { list: 'eway', warehouseId: W2, from: FROM, to: TO }));
    await settle();
    // Both keys changed (`invoices-…`, `eway-…`): both sections remounted and re-read.
    expect(sectionText(view, 'E-way bills')).toContain("Showing the dashboard figure's rows");
    expect(sectionText(view, 'Invoices')).not.toContain("Showing the dashboard figure's rows");
    expect(reads('/invoices').length).toBeGreaterThan(0);
    expect(reads('/invoices').every((r) => !r.params.has('from'))).toBe(true);
    expect(reads('/eway/bills').every((r) => r.params.get('warehouseId') === W2 && !r.params.has('status'))).toBe(true);
  });
});
