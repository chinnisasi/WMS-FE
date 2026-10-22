import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { writeActiveClientId } from '../../lib/active-client';
import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { writeActiveWarehouseId } from '../../lib/warehouses';
import { notifyInboundChanged } from '../../lib/asns';
import { InboundCards } from './inbound-cards';

/**
 * Story 1-1 on the Inbound page, driven through a stubbed `fetch`:
 *   1. the Goods receipts list shows a Client column only once the tenant
 *      holds more than its own client — each receipt's stamped client, and
 *      "—" for an older receipt the backfill could not attribute;
 *   2. Awaiting putaway names each task's SKU with its client (two clients
 *      may share a code), and the bare code with one client.
 */

const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WH = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';

const SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: T, name: 'Priya Spices', gstin: null },
  user: { id: 'u-1', email: 'owner@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
} as StoredSession;

const SELF = { id: 'c-self', code: 'self', name: 'Priya Spices', status: 'active', systemOwned: true };
const ACME = { id: 'c-acme', code: 'ACME', name: 'Acme Foods', status: 'active', systemOwned: false };
const BETA = { id: 'c-beta', code: 'BETA', name: 'Beta Brands', status: 'active', systemOwned: false };

let clients: Record<string, unknown>[] = [SELF];
/** Story 1-5a — the clients read: answered, never answered (pending), or failed. */
let clientsMode: 'ok' | 'hang' | 'fail' = 'ok';
/** Story 1-2b — every request the surface sent (method, path + query, body, key). */
let requests: { method: string; url: URL; body: unknown; key: string | null }[] = [];
let qcHolds: Record<string, unknown>[] = [];
/** Story 1-5a — the GRN list's first page offers this next page (the switch test holds a real cursor). */
let grnNextCursor: string | null = null;
function purchaseOrder(id: string, code: string, vendorSnapshot: Record<string, unknown> | null): Record<string, unknown> {
  return {
    id, tenantId: T, warehouseId: WH, vendorId: 'v-1', code, status: 'open', carriedFromPoId: null, clientId: 'c-self',
    vendorSnapshot, createdAt: '2026-10-18T05:00:00.000Z', updatedAt: '2026-10-18T05:00:00.000Z',
  };
}
const purchaseOrders: Record<string, unknown>[] = [
  purchaseOrder('po-1', 'PO-0001', { v: 1, code: 'V-1', name: 'Frozen Vendor Name', legalName: null, gstin: null, stateCode: null, registeredAddress: null, dispatchAddress: null }),
  purchaseOrder('po-2', 'PO-0002', null),
];
let role: 'owner' | 'ops_manager' | 'operator' = 'owner';
const GRN_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000b7';

function hold(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    tenantId: T,
    warehouseId: WH,
    skuId: 's-acme',
    binId: 'bin-recv',
    reason: 'QC on receipt — GRN-0042',
    status: 'open',
    heldBy: 'u-1',
    heldAt: '2026-10-19T05:00:00.000Z',
    releasedBy: null,
    releasedAt: null,
    createdAt: '2026-10-19T05:00:00.000Z',
    kind: 'receipt',
    grnLineId: `line-${id}`,
    grnId: GRN_ID,
    grnCode: 'GRN-0042',
    overReceiptId: null,
    clientId: 'c-acme',
    batchId: 'b-1',
    batchCode: 'LOT-7',
    heldQty: 12,
    ...over,
  };
}

function grn(id: string, code: string, clientId?: string): Record<string, unknown> {
  return {
    id,
    tenantId: T,
    warehouseId: WH,
    code,
    poId: null,
    ...(clientId === undefined ? {} : { clientId }),
    blindReasonCode: 'unannounced-delivery',
    status: 'recorded',
    recordedBy: 'u-1',
    occurredAt: '2026-10-18T05:00:00.000Z',
    recordedAt: '2026-10-18T05:00:00.000Z',
    lineCount: 1,
    totalUnits: 3,
    appliedUnits: 3,
  };
}

function sku(id: string, code: string, clientId: string): Record<string, unknown> {
  return { id, code, name: code, uom: 'each', uomPrecision: 0, clientId };
}

function task(skuId: string, skuCode: string, grnLineId: string): Record<string, unknown> {
  return {
    grnId: 'g-1',
    grnCode: 'GRN-0001',
    grnLineId,
    skuId,
    skuCode,
    batchId: null,
    batchCode: null,
    qty: 2,
    suggestedBin: null,
    rationale: 'no bin has room',
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const { pathname } = url;
    const base = `/api/v1/tenants/${T}`;
    let body: unknown = null;
    try {
      body = await request.clone().json();
    } catch {
      body = null;
    }
    requests.push({ method: request.method.toUpperCase(), url, body, key: request.headers.get('Idempotency-Key') });
    // Story 1-2b — the QC holds list (filterable by grnId) and Release receipt.
    if (pathname === `${base}/receiving/qc-holds`) {
      const grnId = url.searchParams.get('grnId');
      const status = url.searchParams.get('status');
      return json(200, {
        items: qcHolds.filter((h) => (grnId === null || h['grnId'] === grnId) && (status === null || h['status'] === status)),
        nextCursor: null,
      });
    }
    if (pathname === `${base}/receiving/qc-holds/release-receipt`) {
      const released = qcHolds.filter((h) => h['grnId'] === (body as { grnId: string }).grnId && h['status'] === 'open');
      qcHolds = qcHolds.map((h) => (released.includes(h) ? { ...h, status: 'released' } : h));
      return json(200, { grnId: GRN_ID, grnCode: 'GRN-0042', qcHolds: released });
    }
    if (pathname === `${base}/warehouses`) {
      return json(200, { items: [{ id: WH, code: 'BLR', name: 'Bengaluru DC' }], nextCursor: null });
    }
    if (pathname === `${base}/clients`) {
      if (clientsMode === 'hang') return new Promise<Response>(() => undefined);
      if (clientsMode === 'fail') return json(500, { code: 'internal', title: 'Boom', status: 500 });
      return json(200, { items: clients });
    }
    if (pathname === `${base}/warehouses/${WH}/inbound/asns`) return json(200, { items: [], nextCursor: null });
    if (pathname === `${base}/warehouses/${WH}/inventory/stock`) return json(200, { items: qcStock, nextCursor: null });
    // Story 2-4a — the QC hold picker's bin map (code + system flag).
    if (pathname === `${base}/warehouses/${WH}/zones`) return json(200, { items: [{ id: 'z-1', code: 'Z', name: 'Z' }], nextCursor: null });
    if (pathname === `${base}/warehouses/${WH}/zones/z-1/bins`) return json(200, { items: qcBins, nextCursor: null });
    // Story 1-3 — the PO list (headers) and detail (lines), and a partner list
    // whose LIVE name differs from the PO's frozen vendor snapshot.
    if (pathname === `${base}/warehouses/${WH}/inbound/purchase-orders`) return json(200, { items: purchaseOrders, nextCursor: null });
    if (pathname.startsWith(`${base}/inbound/purchase-orders/`)) {
      const po = purchaseOrders.find((row) => pathname.endsWith(`/${row['id'] as string}`));
      return po === undefined ? json(404, { code: 'not-found', title: 'x', status: 404 }) : json(200, { purchaseOrder: { ...po, lines: [] } });
    }
    if (pathname === `${base}/partners`) {
      return json(200, { items: [{ id: 'v-1', code: 'V-1', name: 'Live Partner Name', roles: ['vendor'], status: 'active', links: [] }], nextCursor: null });
    }
    // Story 2-4a — one GRN's lines (the expandable row).
    if (pathname === `${base}/receiving/goods-receipts/g-1/lines`) {
      return json(200, {
        items: [
          { id: 'gl-1', skuId: 's-acme', skuCode: 'TSHIRT-M', skuName: 'T-shirt M', batchId: null, batchCode: 'LOT-9', qty: 3, appliedQty: 3, damagedQty: 2, damageReasonCode: 'crushed', shortQty: 1, shortReasonCode: 'not-shipped' },
          { id: 'gl-2', skuId: 's-beta', skuCode: 'TSHIRT-M', skuName: 'T-shirt M', batchId: null, batchCode: null, qty: 0, appliedQty: 0, damagedQty: 4, damageReasonCode: 'wet' },
        ],
      });
    }
    if (pathname === `${base}/receiving/goods-receipts`) {
      return json(200, {
        items: [{ ...grn('g-1', 'GRN-0001', 'c-acme'), damagedUnits: 6, shortUnits: 1 }, grn('g-2', 'GRN-0002', 'c-self'), grn('g-3', 'GRN-0003')],
        nextCursor: url.searchParams.has('cursor') ? null : grnNextCursor,
      });
    }
    if (pathname === `${base}/catalog/skus`) {
      return json(200, {
        items: [sku('s-acme', 'TSHIRT-M', 'c-acme'), sku('s-beta', 'TSHIRT-M', 'c-beta')],
        nextCursor: null,
      });
    }
    if (pathname === `${base}/putaway/tasks`) {
      return json(200, { items: [task('s-acme', 'TSHIRT-M', 'l-1'), task('s-beta', 'TSHIRT-M', 'l-2')] });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

/** Story 2-4a — the QC hold picker's stock rows and bins (empty unless a test sets them). */
let qcStock: Record<string, unknown>[] = [];
let qcBins: Record<string, unknown>[] = [];

let view: Rendered | undefined;

beforeEach(() => {
  grnNextCursor = null;
  clients = [SELF];
  clientsMode = 'ok';
  requests = [];
  qcHolds = [];
  qcStock = [];
  qcBins = [];
  role = 'owner';
  stubRouter();
  writeSession(SESSION);
  writeActiveWarehouseId(T, WH);
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
  restoreGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const panel = () => view!.container.querySelector('[role="tabpanel"]') as HTMLElement;
const headers = () => [...panel().querySelectorAll('thead th')].map((th) => th.textContent ?? '');
const rows = () =>
  [...panel().querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent ?? ''));

describe('Purchase orders — the vendor as the PO froze it (story 1-3)', () => {
  test('the Vendor column reads vendorSnapshot.name, never a differing live partner name; "—" without a snapshot', async () => {
    view = render(<InboundCards initialTab="pos" />);
    await settle();
    const vendorAt = headers().indexOf('Vendor');
    expect(vendorAt).toBeGreaterThanOrEqual(0);
    expect(rows().map((cells) => [cells[0], cells[vendorAt]])).toEqual([
      ['PO-0001', 'Frozen Vendor Name'],
      ['PO-0002', '—'],
    ]);
    expect(panel().textContent).not.toContain('Live Partner Name');
  });
});

describe('Purchase orders — the list re-reads on INBOUND_CHANGED_EVENT (story 2-1)', () => {
  // Load-bearing: after a PO create the card returns to page one with
  // onCursor(null), which from page one changes nothing the fetch depends on
  // — only this listener refetches the list.
  test('notifyInboundChanged() re-reads the PO list from the server', async () => {
    view = render(<InboundCards initialTab="pos" />);
    await settle();
    const listReads = () =>
      requests.filter((r) => r.method === 'GET' && r.url.pathname === `/api/v1/tenants/${T}/warehouses/${WH}/inbound/purchase-orders` && !r.url.searchParams.has('status')).length;
    const before = listReads();
    expect(before).toBeGreaterThan(0);
    await act(async () => {
      notifyInboundChanged();
    });
    await settle();
    expect(listReads()).toBe(before + 1);
  });
});

describe('Goods receipts — the receipt\'s client (story 1-1)', () => {
  test('one client: no Client column', async () => {
    view = render(<InboundCards initialTab="grns" />);
    await settle();
    expect(headers()).toContain('GRN code');
    expect(headers()).not.toContain('Client');
  });

  test('several clients: the Client column names each receipt\'s client, "—" when unattributed', async () => {
    clients = [SELF, ACME, BETA];
    view = render(<InboundCards initialTab="grns" />);
    await settle();
    expect(headers().slice(0, 2)).toEqual(['GRN code', 'Client']);
    expect(rows().map((cells) => cells.slice(0, 2))).toEqual([
      ['GRN-0001', 'ACME'],
      ['GRN-0002', 'Priya Spices'],
      ['GRN-0003', '—'],
    ]);
  });
});

describe('Awaiting putaway — the SKU named with its client (story 1-1)', () => {
  test('several clients: a shared code reads CODE · client on each task', async () => {
    clients = [SELF, ACME, BETA];
    view = render(<InboundCards initialTab="putaway" />);
    await settle();
    const skuColumn = headers().indexOf('SKU');
    expect(rows().map((cells) => cells[skuColumn])).toEqual(['TSHIRT-M · ACME', 'TSHIRT-M · BETA']);
  });

  test('one client: the task\'s own code, unchanged', async () => {
    view = render(<InboundCards initialTab="putaway" />);
    await settle();
    const skuColumn = headers().indexOf('SKU');
    expect(rows().map((cells) => cells[skuColumn])).toEqual(['TSHIRT-M', 'TSHIRT-M']);
  });
});

describe('QC holds — receipt holds (story 1-2b)', () => {
  const MANUAL = hold('h-manual', {
    kind: 'manual',
    grnLineId: undefined,
    grnId: null,
    grnCode: null,
    reason: 'Seal broken',
    batchId: null,
    batchCode: null,
    heldQty: 4,
  });

  function asRole(next: 'owner' | 'ops_manager' | 'operator') {
    role = next;
    writeSession({ ...SESSION, user: { ...SESSION.user, role } } as StoredSession);
  }
  // The card's own reads (the tab-count read pages at the route maximum — `limit`).
  const listReads = () =>
    requests.filter((r) => r.method === 'GET' && r.url.pathname.endsWith('/receiving/qc-holds') && !r.url.searchParams.has('limit'));
  const column = (name: string) => {
    const index = headers().indexOf(name);
    return rows().map((cells) => cells[index]);
  };

  test('a receipt hold shows its kind, GRN code, client, batch and held quantity; a manual hold reads Manual', async () => {
    clients = [SELF, ACME, BETA];
    qcHolds = [hold('h-1'), MANUAL];
    view = render(<InboundCards initialTab="qc-holds" />);
    await settle();
    expect(headers()).toEqual(
      expect.arrayContaining(['Kind', 'GRN', 'SKU', 'Client', 'Batch', 'Held', 'Origin bin', 'Reason', 'Status']),
    );
    expect(column('Kind')).toEqual(['Auto · QC on receipt', 'Manual']);
    expect(column('GRN')).toEqual(['GRN-0042', '—']);
    expect(column('Client')).toEqual(['ACME', 'ACME']);
    expect(column('Batch')).toEqual(['LOT-7', '—']);
    expect(column('Held')).toEqual(['12 each', '4 each']);
  });

  test('Release receipt (qc.manage) POSTs {grnId} with a fresh key, guards a double click, then re-reads the list', async () => {
    qcHolds = [hold('h-1'), hold('h-2'), MANUAL];
    view = render(<InboundCards initialTab="qc-holds" />);
    await settle();
    // Only the receipt holds carry it; the manual hold keeps its single Release.
    const releaseReceipt = () => [...panel().querySelectorAll('button')].filter((b) => b.textContent === 'Release receipt');
    expect(releaseReceipt()).toHaveLength(2);
    const readsBefore = listReads().length;
    await act(async () => {
      const button = releaseReceipt()[0]!;
      button.click();
      button.click();
    });
    await settle();
    const posts = requests.filter((r) => r.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url.pathname).toBe(`/api/v1/tenants/${T}/receiving/qc-holds/release-receipt`);
    expect(posts[0]!.body).toEqual({ grnId: GRN_ID });
    expect(posts[0]!.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(panel().textContent).toContain('GRN-0042 released from QC');
    expect(panel().textContent).toContain('2 receipt holds released');
    expect(listReads().length).toBeGreaterThan(readsBefore);
    // The list re-read: only the manual hold is still open.
    expect(column('Kind')).toEqual(['Manual']);
  });

  test('without qc.manage: the rows read, and no Release or Release receipt is offered', async () => {
    asRole('operator');
    qcHolds = [hold('h-1')];
    view = render(<InboundCards initialTab="qc-holds" />);
    await settle();
    expect(column('Kind')).toEqual(['Auto · QC on receipt']);
    expect([...panel().querySelectorAll('button')].map((b) => b.textContent)).not.toContain('Release receipt');
    expect([...panel().querySelectorAll('button')].map((b) => b.textContent)).not.toContain('Release');
  });

  test('the GRN filter: clicking a receipt\'s code narrows the read to its grnId; Show all holds clears it', async () => {
    qcHolds = [hold('h-1'), hold('h-9', { grnId: '0198f7a2-1b3c-7d4e-8f90-0000000000c9', grnCode: 'GRN-0043' }), MANUAL];
    view = render(<InboundCards initialTab="qc-holds" />);
    await settle();
    await act(async () => {
      (panel().querySelector('button[aria-label="Show the QC holds of GRN-0042"]') as HTMLButtonElement).click();
    });
    await settle();
    const narrowed = listReads().at(-1)!;
    expect(narrowed.url.searchParams.get('grnId')).toBe(GRN_ID);
    expect(narrowed.url.searchParams.get('status')).toBe('open');
    expect(column('GRN')).toEqual(['GRN-0042']);
    expect(panel().textContent).toContain('Showing the QC holds of GRN-0042');
    await act(async () => {
      [...panel().querySelectorAll('button')].find((b) => b.textContent === 'Show all holds')!.click();
    });
    await settle();
    expect(listReads().at(-1)!.url.searchParams.get('grnId')).toBeNull();
    expect(column('GRN')).toEqual(['GRN-0042', 'GRN-0043', '—']);
  });

  test('opened from the notification link (qcGrnId): the first read is already narrowed, named by the rows\' code', async () => {
    qcHolds = [hold('h-1'), MANUAL];
    view = render(<InboundCards initialTab="qc-holds" qcGrnId={GRN_ID} />);
    await settle();
    expect(listReads().length).toBeGreaterThan(0);
    expect(listReads().every((r) => r.url.searchParams.get('grnId') === GRN_ID)).toBe(true);
    expect(panel().textContent).toContain('Showing the QC holds of GRN-0042');
  });
});

/**
 * Story 1-5a — the client switcher on the Inbound page: every list (and the
 * tab counts) carries the stored client's id and shows the chip; the QC-hold
 * FORM's open-holds read never does (decision 10); a pending clients read
 * sends no list request; a failed one reads every client.
 */
describe('the client filter (story 1-5a)', () => {
  const reads = (suffix: string) => requests.filter((r) => r.method === 'GET' && r.url.pathname.endsWith(suffix));
  const chip = () => view!.container.querySelector('[data-testid="client-filter-chip"]');
  const LISTS: readonly { tab: 'pos' | 'asns' | 'grns' | 'putaway' | 'qc-holds'; path: string }[] = [
    { tab: 'pos', path: '/inbound/purchase-orders' },
    { tab: 'asns', path: '/inbound/asns' },
    { tab: 'grns', path: '/receiving/goods-receipts' },
    { tab: 'putaway', path: '/putaway/tasks' },
    { tab: 'qc-holds', path: '/receiving/qc-holds' },
  ];

  for (const { tab, path } of LISTS) {
    test(`${tab}: under a stored client the list request carries clientId and the chip renders`, async () => {
      clients = [SELF, ACME];
      writeActiveClientId(T, 'u-1', ACME.id);
      view = render(<InboundCards initialTab={tab} />);
      await settle();
      // The tab's own list read (a count read carries a `limit`) carries the client.
      const listed = reads(path).filter((r) => r.url.searchParams.get('limit') === null);
      expect(listed.some((r) => r.url.searchParams.get('clientId') === ACME.id)).toBe(true);
      // Every read of this route carries it too (tab counts included) — except the
      // QC-hold form's own open-holds read, which is never filtered (decision 10).
      if (tab !== 'qc-holds') expect(reads(path).every((r) => r.url.searchParams.get('clientId') === ACME.id)).toBe(true);
      expect(chip()?.textContent).toContain('Client: ACME — Acme Foods');
    });
  }

  test('the tab counts carry the same clientId as the lists', async () => {
    clients = [SELF, ACME];
    writeActiveClientId(T, 'u-1', ACME.id);
    view = render(<InboundCards initialTab="grns" />);
    await settle();
    const counts = [
      ...reads('/inbound/purchase-orders').filter((r) => r.url.searchParams.get('status') === 'open'),
      ...reads('/inbound/asns'),
      ...reads('/putaway/tasks'),
      ...reads('/receiving/qc-holds'),
    ];
    expect(counts.length).toBeGreaterThanOrEqual(4);
    expect(counts.every((r) => r.url.searchParams.get('clientId') === ACME.id)).toBe(true);
  });

  test('the QC-hold form reads every client\'s open holds and says "All clients"; the list stays filtered', async () => {
    clients = [SELF, ACME];
    writeActiveClientId(T, 'u-1', ACME.id);
    view = render(<InboundCards initialTab="qc-holds" />);
    await settle();
    const holds = reads('/receiving/qc-holds').filter((r) => r.url.searchParams.get('limit') === null);
    // Two reads of the open holds: the list's (filtered) and the form's (never).
    expect(holds.some((r) => r.url.searchParams.get('clientId') === ACME.id)).toBe(true);
    expect(holds.some((r) => !r.url.searchParams.has('clientId'))).toBe(true);
    const form = view.container.querySelector('form')!;
    expect(form.querySelector('[data-testid="all-clients-note"]')?.textContent).toBe('All clients');
  });

  test('no stored client: no clientId anywhere, no chip, no "All clients" note', async () => {
    clients = [SELF, ACME];
    view = render(<InboundCards initialTab="qc-holds" />);
    await settle();
    expect(requests.filter((r) => r.url.searchParams.has('clientId'))).toEqual([]);
    expect(chip()).toBeNull();
    expect(view.container.querySelector('[data-testid="all-clients-note"]')).toBeNull();
  });

  test('single-client tenant: a stored id is ignored — no clientId, no chip', async () => {
    clients = [SELF];
    writeActiveClientId(T, 'u-1', SELF.id);
    view = render(<InboundCards initialTab="pos" />);
    await settle();
    expect(reads('/inbound/purchase-orders').length).toBeGreaterThan(0);
    expect(requests.filter((r) => r.url.searchParams.has('clientId'))).toEqual([]);
    expect(chip()).toBeNull();
  });

  test('a stored client absent from the loaded list reads all clients and stays stored', async () => {
    clients = [SELF, ACME];
    writeActiveClientId(T, 'u-1', 'c-gone');
    view = render(<InboundCards initialTab="pos" />);
    await settle();
    expect(reads('/inbound/purchase-orders').length).toBeGreaterThan(0);
    expect(requests.filter((r) => r.url.searchParams.has('clientId'))).toEqual([]);
    expect(chip()).toBeNull();
    expect(localStorage.getItem(`wms-active-client:${T}:u-1`)).toBe('c-gone');
  });

  test('pending: while the clients load, a stored client holds every list request back', async () => {
    clientsMode = 'hang';
    writeActiveClientId(T, 'u-1', ACME.id);
    view = render(<InboundCards initialTab="pos" />);
    await settle();
    for (const { path } of LISTS) expect(reads(path)).toEqual([]);
    expect(reads('/receiving/goods-receipts')).toEqual([]);
  });

  test('failed clients read: the lists read every client (no clientId) and the pick stays stored', async () => {
    clientsMode = 'fail';
    writeActiveClientId(T, 'u-1', ACME.id);
    view = render(<InboundCards initialTab="pos" />);
    await settle();
    expect(reads('/inbound/purchase-orders').length).toBeGreaterThan(0);
    expect(requests.filter((r) => r.url.searchParams.has('clientId'))).toEqual([]);
    expect(chip()).toBeNull();
    expect(localStorage.getItem(`wms-active-client:${T}:u-1`)).toBe(ACME.id);
  });

  test('switching the client restarts the list from page one under the new client — and so does switching back', async () => {
    clients = [SELF, ACME];
    grnNextCursor = 'p2';
    view = render(<InboundCards initialTab="grns" />);
    await settle();
    expect(reads('/receiving/goods-receipts').every((r) => !r.url.searchParams.has('clientId'))).toBe(true);
    // Page 2 under All clients.
    const next = [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Next')!;
    await act(async () => {
      next.click();
    });
    await settle();
    expect(reads('/receiving/goods-receipts').at(-1)!.url.searchParams.get('cursor')).toBe('p2');
    requests = [];
    await act(async () => {
      writeActiveClientId(T, 'u-1', ACME.id);
    });
    await settle();
    const after = reads('/receiving/goods-receipts');
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((r) => r.url.searchParams.get('clientId') === ACME.id && !r.url.searchParams.has('cursor'))).toBe(true);
    expect(chip()?.textContent).toContain('Client: ACME — Acme Foods');
    // "Show all clients" clears the filter — and never replays All's page-2 cursor.
    requests = [];
    const showAll = [...chip()!.querySelectorAll('button')].find((b) => b.textContent === 'Show all clients')!;
    await act(async () => {
      showAll.click();
    });
    await settle();
    expect(reads('/receiving/goods-receipts').length).toBeGreaterThan(0);
    expect(reads('/receiving/goods-receipts').every((r) => !r.url.searchParams.has('clientId') && !r.url.searchParams.has('cursor'))).toBe(true);
    expect(chip()).toBeNull();
  });

});

describe('Goods receipts — damaged and short (story 2-4a)', () => {
  test('the Units column adds "+N damaged" and the short; the code opens the lines: good / damaged (reason) / short (reason)', async () => {
    view = render(<InboundCards initialTab="grns" />);
    await settle();
    const unitsColumn = headers().indexOf('Units');
    expect(rows().map((cells) => cells[unitsColumn])).toEqual(['3 +6 damaged · 1 short', '3', '3']);
    const toggle = view.container.querySelector('button[aria-label="Show the lines of GRN-0001"]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await act(async () => {
      toggle.click();
    });
    await settle();
    expect(requests.some((r) => r.url.pathname.endsWith('/receiving/goods-receipts/g-1/lines'))).toBe(true);
    const lines = [...view.container.querySelectorAll('[data-testid="grn-line"]')].map((line) => line.textContent ?? '');
    expect(lines).toEqual([
      'TSHIRT-M T-shirt M · batch LOT-9 · good 3 · damaged 2 (Crushed) · short 1 (Not shipped)',
      'TSHIRT-M T-shirt M · good 0 · damaged 4 (Wet)',
    ]);
    // Toggling again hides it.
    await act(async () => {
      (view!.container.querySelector('button[aria-label="Hide the lines of GRN-0001"]') as HTMLButtonElement).click();
    });
    await settle();
    expect(view.container.querySelector('[data-testid="grn-line"]')).toBeNull();
  });
});

describe('the QC hold picker skips the SYSTEM bins a hold cannot originate in (story 2-4a, BH5/VG3)', () => {
  test('system QC-HOLD, RETURNS and DAMAGED are not offered; a user bin coded DAMAGED (pre-rule) and a storage bin are', async () => {
    const bin = (id: string, code: string, systemOwned: boolean) => ({ id, code, systemOwned, zoneId: 'z-1', capacity: 1000, type: 'shelf' });
    qcBins = [bin('b-a', 'A-01', false), bin('b-qc', 'QC-HOLD', true), bin('b-ret', 'RETURNS', true), bin('b-dmg', 'DAMAGED', true), bin('b-udmg', 'DAMAGED', false)];
    qcStock = qcBins.map((b, i) => ({ id: `st-${i}`, warehouseId: WH, skuId: 's-acme', binId: b['id'], quantity: 2, createdAt: '2026-10-18T05:00:00.000Z' }));
    view = render(<InboundCards initialTab="qc-holds" />);
    await settle();
    const select = view.container.querySelector('select[aria-label="Stock scope (SKU at bin)"]') as HTMLSelectElement;
    const offered = [...select.querySelectorAll('option')].map((o) => o.value).filter((v) => v !== '');
    expect(offered).toEqual(['s-acme:b-a', 's-acme:b-udmg']);
  });
});
