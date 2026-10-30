import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { notifyInboundChanged } from '../../lib/asns';
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

/** A second fixture: an arrival, no vendor (an ASN), a kg line (totals at the UoM's precision). */
const ASN_DOC = {
  ...DOC,
  parties: { ...DOC.parties, vendor: null, supplierNote: 'As announced by the client — ASN A-77' },
  document: { kind: 'asn', code: 'A-77', blindReasonCode: null, blindReasonLabel: null, label: 'ASN A-77' },
  arrival: {
    gateInCode: 'GI-9', vehicleNo: 'KA01AB1234', containerNo: 'MSCU1234567', transporterName: 'Swift', lrNumber: 'LR-5', sealStatus: 'none', sealNumber: null,
    dockDoor: 'D1', gatedInAt: '2026-10-30T04:00:00.000Z', unloadStartedAt: null, unloadEndedAt: null,
    documents: [{ kind: 'bill_of_entry', number: 'BOE-3', date: '2026-10-29', ewayBillNo: '123456789012' }], documentsOmitted: true,
  },
  lines: [{ ...DOC.lines[0], uom: 'kg', uomPrecision: 3, goodQty: 12.5, damagedQty: 0, shortQty: 0, excess: { pendingQty: 0, approvedQty: 0, rejectedQty: 0 } }],
  totals: { lineCount: 1, byUom: [{ uom: 'kg', goodQty: 12.5, damagedQty: 0, shortQty: 0 }] },
};

let view: Rendered | undefined;
let requests: string[] = [];
let reply: [number, unknown] = [200, DOC];
/** Every file request: its path and `format`. */
let files: { path: string; format: string | null }[] = [];
/** The file route's answer. */
let fileReply: [number, unknown] = [200, 'PDFBYTES'];
/** Filenames handed to the browser (the download anchor). */
let downloads: string[] = [];
const realClick = HTMLAnchorElement.prototype.click;
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;

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
  files = [];
  fileReply = [200, 'PDFBYTES'];
  downloads = [];
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  };
  URL.createObjectURL = () => 'blob:test';
  URL.revokeObjectURL = () => undefined;
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    requests.push(url.pathname);
    if (url.pathname.endsWith('/document/file')) {
      files.push({ path: url.pathname, format: url.searchParams.get('format') });
      return fileReply[0] === 200
        ? new Response(String(fileReply[1]), { status: 200, headers: { 'content-type': 'application/pdf' } })
        : new Response(JSON.stringify(fileReply[1]), { status: fileReply[0], headers: { 'content-type': 'application/problem+json' } });
    }
    return new Response(JSON.stringify(reply[1]), { status: reply[0], headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch);
});

afterEach(() => {
  HTMLAnchorElement.prototype.click = realClick;
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
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

  const button = (label: string) => [...view!.container.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;
  const click = async (element: Element) => {
    await act(async () => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();
  };

  test('downloads: PDF and CSV request the file route with their format and save under the server’s name; buttons re-enable', async () => {
    view = render(<GrnDetailDrawer grnId={GRN} onClose={() => undefined} />);
    await settle();
    await click(button('Download GRN (PDF)'));
    await click(button('Export lines (CSV)'));
    expect(files).toEqual([
      { path: `/api/v1/tenants/${T}/receiving/goods-receipts/${GRN}/document/file`, format: 'pdf' },
      { path: `/api/v1/tenants/${T}/receiving/goods-receipts/${GRN}/document/file`, format: 'csv' },
    ]);
    expect(downloads).toEqual(['GRN-0042.pdf', 'GRN-0042-lines.csv']);
    expect(button('Download GRN (PDF)').disabled).toBe(false);
  });

  test('a refused download (4xx) shows the banner inline and the buttons re-enable', async () => {
    fileReply = [404, { code: 'not-found', status: 404, title: 'Goods receipt not found' }];
    view = render(<GrnDetailDrawer grnId={GRN} onClose={() => undefined} />);
    await settle();
    await click(button('Download GRN (PDF)'));
    expect(view.container.textContent).toContain('Download failed');
    expect(downloads).toEqual([]);
    expect(button('Download GRN (PDF)').disabled).toBe(false);
  });

  test('an arrival, no vendor (the supplier note), labelled kinds and seal, totals at the UoM precision', async () => {
    reply = [200, ASN_DOC];
    view = render(<GrnDetailDrawer grnId={GRN} onClose={() => undefined} />);
    await settle();
    const text = view.container.textContent ?? '';
    expect(text).toContain('As announced by the client — ASN A-77');
    expect(text).toContain('Arrival — as recorded on gate-in GI-9');
    expect(text).toContain('Container MSCU1234567');
    expect(text).toContain('LR/AWB LR-5');
    expect(text).toContain('Seal none (unsealed)');
    expect(text).toContain('Bill of entry BOE-3 dated 2026-10-29 · e-way bill 123456789012');
    expect(text).toContain('Other documents of this vehicle are not shown.');
    expect(text).toContain('kg: good 12.500 · damaged 0.000 · short 0.000');
    expect(text).not.toContain('bill_of_entry');
  });

  test('a 5xx shows Retry, which re-reads; a failed quiet refetch (inbound change) keeps the loaded document', async () => {
    reply = [503, { code: 'unavailable', status: 503, title: 'Down' }];
    view = render(<GrnDetailDrawer grnId={GRN} onClose={() => undefined} />);
    await settle();
    expect(view.container.textContent).toContain('Receipt not loaded');
    reply = [200, DOC];
    await click(button('Retry'));
    expect(view.container.textContent).toContain('Goods receipt GRN-0042');
    reply = [503, { code: 'unavailable', status: 503, title: 'Down' }];
    const before = requests.length;
    await act(async () => {
      notifyInboundChanged();
    });
    await settle();
    expect(requests.length).toBeGreaterThan(before);
    expect(view.container.textContent).toContain('Goods receipt GRN-0042');
    expect(view.container.textContent).not.toContain('Receipt not loaded');
  });
});
