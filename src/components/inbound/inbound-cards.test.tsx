import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { writeActiveWarehouseId } from '../../lib/warehouses';
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
/** Story 1-2b — every request the surface sent (method, path + query, body, key). */
let requests: { method: string; url: URL; body: unknown; key: string | null }[] = [];
let qcHolds: Record<string, unknown>[] = [];
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
    if (pathname === `${base}/clients`) return json(200, { items: clients });
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
    if (pathname === `${base}/receiving/goods-receipts`) {
      return json(200, {
        items: [grn('g-1', 'GRN-0001', 'c-acme'), grn('g-2', 'GRN-0002', 'c-self'), grn('g-3', 'GRN-0003')],
        nextCursor: null,
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

let view: Rendered | undefined;

beforeEach(() => {
  clients = [SELF];
  requests = [];
  qcHolds = [];
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
