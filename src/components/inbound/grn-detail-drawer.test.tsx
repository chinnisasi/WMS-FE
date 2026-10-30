import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { GrnDetailDrawer } from './grn-detail-drawer';

/**
 * Story 2-9a — the GRN details drawer: it reads the document BY ID (A18 — a
 * receipt on another list page still opens), shows the parties, the arrival,
 * the lines in words and the downloads, and an unknown receipt inline.
 */

const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const GRN = '0198f7a2-1b3c-7d4e-8f90-0000000000d1';

const SESSION = {
  token: 'header.payload.signature',
  tenant: { id: T, name: 'Priya Logistics', gstin: null },
  user: { id: 'u-1', email: 'priya@example.com', role: 'operator', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
} as StoredSession;

const DOC = {
  id: GRN,
  code: 'GRN-0042',
  receivedAt: '2026-10-30T05:30:00.000Z',
  recordedAt: '2026-10-30T05:31:00.000Z',
  printedAt: '2026-10-30T09:00:00.000Z',
  parties: {
    frozen: true,
    warehouse: { code: 'W1', name: 'Peenya DC', legalName: null, gstin: '29AAAAA0000A1Z5', address: null, operatorName: 'Priya Logistics' },
    client: { code: 'ACME', name: 'ACME Brand', legalName: null, gstin: null, address: null },
    vendor: { code: 'V-01', name: 'Fabrics Co', legalName: null, gstin: null, address: null },
    supplierNote: null,
  },
  document: { kind: 'po', code: 'PO-7', blindReasonCode: null, blindReasonLabel: null, label: 'PO PO-7' },
  arrival: null,
  lines: [
    {
      id: 'l-1', lineNo: 1, skuCode: 'A-TEE', skuName: 'Acme tee', clientCode: 'ACME', uom: 'each', uomPrecision: 0, batchCode: null,
      mfgDate: null, expiryDate: '2027-09-01', expirySource: 'derived', expectedQty: 100, goodQty: 120, damagedQty: 3, damageReasonCode: 'crushed',
      damageReasonLabel: 'Crushed', shortQty: 2, shortReasonCode: 'not-shipped', shortReasonLabel: 'Not shipped', toleranceQty: 0,
      excess: { pendingQty: 20, approvedQty: 0, rejectedQty: 0 }, qc: { status: 'inspected', heldQty: 20, releasedQty: 0, passedQty: 18, failedQty: 2 },
      serialCount: 0, unreadableSerialCount: 0, rejectedSerialCount: 0, photoCount: 2,
    },
  ],
  totals: { lineCount: 1, byUom: [{ uom: 'each', goodQty: 120, damagedQty: 3, shortQty: 2 }] },
};

let view: Rendered | undefined;
let requests: string[] = [];
let reply: [number, unknown] = [200, DOC];

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  requests = [];
  reply = [200, DOC];
  writeSession(SESSION);
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    requests.push(new URL(request.url).pathname);
    return new Response(JSON.stringify(reply[1]), { status: reply[0], headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch);
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
});

describe('GrnDetailDrawer (story 2-9a)', () => {
  test('A18: opens by id alone (no list read) — parties, lines in words, damage details, downloads', async () => {
    view = render(<GrnDetailDrawer grnId={GRN} onClose={() => undefined} />);
    await settle();
    expect(requests).toEqual([`/api/v1/tenants/${T}/receiving/goods-receipts/${GRN}/document`]);
    const text = view.container.textContent ?? '';
    expect(text).toContain('Goods receipt GRN-0042');
    expect(text).toContain('Frozen at receipt');
    expect(text).toContain('Operated by Priya Logistics');
    expect(text).toContain('V-01 — Fabrics Co');
    expect(text).toContain('2027-09-01 (derived)');
    expect(text).toContain('20 awaiting approval');
    expect(text).toContain('Passed 18 · Failed 2');
    expect(text).toContain('damaged 3 each (Crushed)');
    expect(text).toContain('Download GRN (PDF)');
    expect(text).toContain('Export lines (CSV)');
  });

  test('an unknown receipt (404) reads "This receipt is not available"', async () => {
    reply = [404, { code: 'not-found', status: 404, title: 'Goods receipt not found' }];
    view = render(<GrnDetailDrawer grnId={GRN} onClose={() => undefined} />);
    await settle();
    expect(view.container.textContent).toContain('This receipt is not available.');
  });
});
