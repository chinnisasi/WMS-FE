import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { OverReceiptQueue } from './over-receipt-queue';

/**
 * Story 21-6 — the over-receipt queue is document-neutral: an ASN's excess
 * names "ASN <code>" and its line's announced / received-to-date / open
 * context (read from ONE ASN detail per distinct ASN), a PO's excess keeps
 * "PO <code>" and its ordered context.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const ASN_ID = 'a-1';
const PO_ID = 'po-1';

const SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Priya Logistics', gstin: null },
  user: { id: 'u-1', email: 'priya@example.com', role: 'ops_manager', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

function entry(id: string, refs: Record<string, unknown>, excessQty: number) {
  return {
    id,
    tenantId: TENANT_ID,
    warehouseId: 'wh-1',
    grnId: `g-${id}`,
    grnCode: `GRN-000${id}`,
    grnLineId: `gl-${id}`,
    poId: null,
    poLineId: null,
    skuId: 's-1',
    excessQty,
    status: 'pending',
    requestedBy: 'u-1',
    requestedAt: '2026-10-08T04:30:00.000Z',
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-10-08T04:30:00.000Z',
    ...refs,
  };
}

const ENTRIES = [
  entry('1', { asnId: ASN_ID, asnLineId: 'al-1', asnCode: 'ASN-9' }, 2),
  entry('2', { asnId: ASN_ID, asnLineId: 'al-2', asnCode: 'ASN-9' }, 1),
  entry('3', { poId: PO_ID, poLineId: 'pl-1' }, 3),
];

const SKU = {
  id: 's-1',
  tenantId: TENANT_ID,
  clientId: 'c-1',
  code: 'ACME-1',
  name: 'Acme one',
  uom: 'each',
  uomPrecision: 0,
  gstRateBps: 1800,
  hsn: null,
  barcode: 'BC-1',
  batchTracked: false,
  serialTracked: false,
  catchWeightTracked: false,
  reorderPoint: null,
  reorderQty: null,
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
};

let paths: string[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  paths = [];
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname } = new URL(request.url);
    paths.push(pathname);
    if (pathname.endsWith('/receiving/over-receipts')) return json(200, { items: ENTRIES, nextCursor: null });
    if (pathname.endsWith(`/inbound/asns/${ASN_ID}`)) {
      return json(200, {
        asn: {
          id: ASN_ID,
          code: 'ASN-9',
          clientId: 'c-1',
          status: 'received',
          expectedAt: null,
          lineCount: 2,
          linesComplete: 2,
          announcedTotal: 15,
          receivedTotal: 17,
          createdAt: '2026-10-08T00:00:00.000Z',
          warehouseId: 'wh-1',
          statusNote: null,
          updatedAt: '2026-10-08T00:00:00.000Z',
          lines: [
            { id: 'al-1', skuId: 's-1', announcedQty: 10, receivedQty: 12, openQty: -2 },
            { id: 'al-2', skuId: 's-1', announcedQty: 5, receivedQty: 5, openQty: 0 },
          ],
        },
      });
    }
    if (pathname.endsWith(`/inbound/purchase-orders/${PO_ID}`)) {
      return json(200, {
        purchaseOrder: {
          id: PO_ID,
          tenantId: TENANT_ID,
          warehouseId: 'wh-1',
          vendorId: 'v-1',
          code: 'PO-0004',
          status: 'open',
          carriedFromPoId: null,
          createdAt: '2026-10-08T00:00:00.000Z',
          updatedAt: '2026-10-08T00:00:00.000Z',
          lines: [{ id: 'pl-1', poId: PO_ID, skuId: 's-1', orderedQty: 4, receivedQty: 4, openQty: 0, unitCostPaise: 100, expectedDate: null, status: 'open', createdAt: '2026-10-08T00:00:00.000Z' }],
        },
      });
    }
    if (pathname.endsWith('/catalog/skus')) return json(200, { items: [SKU], nextCursor: null });
    if (pathname.endsWith('/users')) return json(200, { items: [], nextCursor: null });
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
});

let view: Rendered | undefined;

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('OverReceiptQueue — documents (story 21-6)', () => {
  test('an ASN excess names the ASN and its announced · received-to-date · open line; a PO excess keeps its PO context', async () => {
    writeSession(SESSION);
    view = render(<OverReceiptQueue />);
    await settle();
    const cards = [...view.container.querySelectorAll('article')].map((card) => card.textContent ?? '');
    expect(cards).toHaveLength(3);
    expect(cards[0]).toContain('ASN ASN-9');
    expect(cards[0]).toContain('Line: 10 each announced · 12 each received-to-date · -2 each (over-received) open');
    expect(cards[1]).toContain('ASN ASN-9');
    expect(cards[1]).toContain('Line: 5 each announced · 5 each received-to-date · 0 each open');
    expect(cards[2]).toContain('PO PO-0004');
    expect(cards[2]).toContain('Line: 4 each ordered · 4 each received-to-date · 0 each open');
    // Two over-receipts on ONE ASN: one detail read.
    expect(paths.filter((path) => path.endsWith(`/inbound/asns/${ASN_ID}`))).toHaveLength(1);
  });
});
