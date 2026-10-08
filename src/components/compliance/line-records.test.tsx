import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import type { ClientInvoiceDto } from '../../lib/api/generated';
import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { CLIENT_INVOICES_CHANGED_EVENT } from '../../lib/client-invoices';
import { actorPseudonym } from '../../lib/invoice-records';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { LineRecordsPanel } from './line-records';

/**
 * Story 21-5b — the claims a `src/lib` test cannot make:
 *   1. the panel is screen-only (`print:hidden`); each line's toggle is a
 *      native button whose `aria-expanded`/`aria-controls` name the panel,
 *      and the panel's heading names the line;
 *   2. the first page is asked for with no cursor; "Load more" sends the
 *      cursor and appends;
 *   3. a mismatch shows the banner its status calls for (drift on an issued
 *      invoice, "Draft may be out of date — Refresh" on a draft), and a
 *      reconciled line shows none;
 *   4. a 404 under a draft reads "Invoice changed — reload" and Reload
 *      re-reads the invoice;
 *   5. a storage day expands to its per-SKU breakdown (the negative SKU shown);
 *   6. Export CSV walks every page at 1,000, re-reads the summary, and writes
 *      pseudonyms — never an email.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const ACTOR = '0198f7a2-0000-7000-8000-00000000beef';
const INVOICE_ID = '0198f7a2-aaaa-7000-8000-000000000001';
const PICK_LINE_ID = '0198f7a2-bbbb-7000-8000-000000000001';
const STORAGE_LINE_ID = '0198f7a2-bbbb-7000-8000-000000000002';

const SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Three PL Co', gstin: '29AAACT1234A1Z5' },
  user: { id: 'u-1', email: 'priya@example.com', role: 'ops_manager', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

const BASE_LINE = {
  rateCardId: 'card-a',
  basis: 'per_pick',
  unitAmountPaise: 300,
  amountPaise: 123600,
  sac: '996719',
  gstBps: 1800,
  placeOfSupply: '29',
  supplyType: 'intra',
  cgstPaise: 0,
  sgstPaise: 0,
  igstPaise: 0,
};

function invoice(status: ClientInvoiceDto['status']): ClientInvoiceDto {
  return {
    id: INVOICE_ID,
    clientId: 'c-acme',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    status,
    invoiceNo: status === 'draft' ? null : '29/S2627/000001',
    fyLabel: null,
    supplierGstin: '29AAACT1234A1Z5',
    placeOfSupply: '29',
    supplyType: 'intra',
    totals: { subtotal: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, roundOff: 0, payable: 0 },
    issuedAt: null,
    statusNote: null,
    replacesInvoiceId: null,
    createdAt: '2026-10-07T04:00:00.000Z',
    gaps: [],
    warnings: [],
    party: { recipient: { code: 'ACME', name: 'Acme', legalName: 'Acme Foods Pvt Ltd' } } as never,
    lines: [
      { ...BASE_LINE, id: PICK_LINE_ID, segmentFrom: '2026-09-15', segmentTo: '2026-09-30', chargeCode: 'pick', uom: null, quantity: '3' },
      { ...BASE_LINE, id: STORAGE_LINE_ID, segmentFrom: '2026-09-01', segmentTo: '2026-09-30', chargeCode: 'storage', basis: 'per_thousand_units_per_day', uom: 'each', quantity: '60' },
    ],
  } as ClientInvoiceDto;
}

function pickRecord(n: number): Record<string, unknown> {
  return {
    kind: 'pick',
    id: `0198f7a2-cccc-7000-8000-00000000000${n}`,
    pickedAt: '2026-09-16T04:30:00.000000Z',
    warehouseId: 'w1',
    warehouseCode: 'BLR1',
    orderRef: { source: 'ingested', externalEventId: `shopify-${n}`, orderId: `o-${n}` },
    skuId: 's1',
    skuCode: 'ACME-PC',
    skuName: 'Acme widget',
    qty: '1',
    binCode: 'A-01-01',
    actorId: ACTOR,
    actorEmail: 'priya@example.com',
  };
}

interface Recorded {
  readonly pathname: string;
  readonly params: URLSearchParams;
}
let requests: Recorded[] = [];
/** What the pick drill answers: its summary and how many records it holds in all. */
let pickSummary = { lineQuantity: '3', recordsQuantity: '3', reconciles: true };
let pickTotal = 3;
let pickPageLimit = 2;
let pickFirstPageStatus = 200;
/** A later pick page that is refused (the cursor it answers, and how). */
let pickFailOn: { cursor: string; status: number } | null = null;
/** A later pick page held until the test releases it. */
let pickHold: { cursor: string; release: Promise<void> } | null = null;
let breakdownStatus = 200;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubRouter(status: ClientInvoiceDto['status']): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    requests.push({ pathname: url.pathname, params: url.searchParams });
    if (url.pathname.endsWith(`/lines/${PICK_LINE_ID}/records`)) {
      const cursor = url.searchParams.get('cursor');
      if (cursor === null && pickFirstPageStatus !== 200) {
        return json(pickFirstPageStatus, { code: 'not-found', title: 'Not found', status: pickFirstPageStatus, detail: 'No line' });
      }
      if (pickFailOn !== null && cursor === pickFailOn.cursor) {
        const code = pickFailOn.status === 404 ? 'not-found' : 'internal';
        return json(pickFailOn.status, { code, title: 'Refused', status: pickFailOn.status, detail: 'Refused in this test' });
      }
      if (pickHold !== null && cursor === pickHold.cursor) await pickHold.release;
      const limit = Math.min(Number(url.searchParams.get('limit') ?? '100'), pickPageLimit);
      const start = cursor === null ? 0 : Number(cursor);
      const end = Math.min(start + limit, pickTotal);
      const records = Array.from({ length: end - start }, (_, i) => pickRecord(start + i + 1));
      return json(200, {
        kind: 'pick',
        invoiceStatus: status,
        ...(cursor === null ? { summary: pickSummary } : {}),
        records,
        nextCursor: end < pickTotal ? String(end) : null,
      });
    }
    if (url.pathname.endsWith(`/lines/${STORAGE_LINE_ID}/records`)) {
      return json(200, {
        kind: 'storage-day',
        invoiceStatus: status,
        summary: { lineQuantity: '60', recordsQuantity: '60', reconciles: true },
        records: [{ kind: 'storage-day', date: '2026-09-05', warehouseId: 'w1', warehouseCode: 'BLR1', uom: 'each', onHand: '60' }],
        nextCursor: null,
      });
    }
    if (url.pathname.endsWith(`/lines/${STORAGE_LINE_ID}/storage-breakdown`)) {
      if (breakdownStatus !== 200) return json(breakdownStatus, { code: 'not-found', title: 'Not found', status: breakdownStatus, detail: 'No line' });
      return json(200, {
        date: url.searchParams.get('date'),
        warehouseId: url.searchParams.get('warehouseId'),
        warehouseCode: 'BLR1',
        uom: 'each',
        skus: [
          { skuId: 's1', skuCode: 'BETA-PC', skuName: 'Beta widget', onHand: '100' },
          { skuId: 's2', skuCode: 'MOVE-X', skuName: 'Moved item', onHand: '-40' },
        ],
        total: '60',
        snapshotOnHand: '60',
        reconciles: true,
      });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  pickSummary = { lineQuantity: '3', recordsQuantity: '3', reconciles: true };
  pickTotal = 3;
  pickPageLimit = 2;
  pickFirstPageStatus = 200;
  pickFailOn = null;
  pickHold = null;
  breakdownStatus = 200;
  writeSession(SESSION);
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function button(container: HTMLElement, text: string | RegExp): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((b) => (typeof text === 'string' ? b.textContent === text : text.test(b.textContent ?? '')));
}

async function press(target: HTMLButtonElement | undefined): Promise<void> {
  expect(target).toBeDefined();
  await act(async () => {
    target!.click();
  });
  await settle();
}

function rowsOf(container: HTMLElement): string[] {
  return [...container.querySelectorAll('table[aria-label="Line records"] tbody tr')].map((row) => row.textContent ?? '');
}

describe('LineRecordsPanel', () => {
  test('screen-only; a native toggle per line whose aria-controls names the panel; the panel heading names the line; nothing fetched until opened', async () => {
    stubRouter('issued');
    view = render(<LineRecordsPanel invoice={invoice('issued')} />);
    await settle();
    const panel = view.container.querySelector('section[data-line-records]')!;
    expect(panel.className).toContain('print:hidden');
    expect(panel.querySelector('h4')!.textContent).toBe('Line records');
    const toggle = button(view.container, /^Show records — Pick/)!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(requests).toHaveLength(0);
    await press(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const region = view.container.querySelector(`#${toggle.getAttribute('aria-controls')}`)!;
    expect(region).not.toBeNull();
    expect(region.querySelector('h5')!.textContent).toBe('Records — Pick · 15 Sep 2026 – 30 Sep 2026');
    // The first page: no cursor, the on-screen limit.
    expect(requests[0]!.params.get('cursor')).toBeNull();
    expect(requests[0]!.params.get('limit')).toBe('100');
    expect(rowsOf(view.container)[0]).toContain('2026-09-16 10:00:00 +05:30');
    expect(rowsOf(view.container)[0]).toContain('shopify-1');
    expect(rowsOf(view.container)[0]).toContain('priya@example.com');
    expect(region.textContent).toContain('Records add up to 3 picks — the invoiced quantity.');
    expect(region.querySelector('[data-tone="warning"]')).toBeNull();
  });

  test('"Load more" sends the cursor and appends; it disappears on the last page', async () => {
    stubRouter('issued');
    view = render(<LineRecordsPanel invoice={invoice('issued')} />);
    await settle();
    await press(button(view.container, /^Show records — Pick/));
    expect(rowsOf(view.container)).toHaveLength(2);
    await press(button(view.container, 'Load more'));
    expect(requests.at(-1)!.params.get('cursor')).toBe('2');
    expect(rowsOf(view.container)).toHaveLength(3);
    expect(rowsOf(view.container)[2]).toContain('shopify-3');
    expect(button(view.container, 'Load more')).toBeUndefined();
  });

  test('a mismatch: the drift alarm on an issued invoice, "Draft may be out of date — Refresh" on a draft', async () => {
    pickSummary = { lineQuantity: '3', recordsQuantity: '4', reconciles: false };
    stubRouter('issued');
    view = render(<LineRecordsPanel invoice={invoice('issued')} />);
    await settle();
    await press(button(view.container, /^Show records — Pick/));
    expect(view.container.querySelector('[data-tone="warning"]')!.textContent).toContain('These records no longer add up to the invoiced quantity');
    view.unmount();
    restoreGlobals();
    stubRouter('draft');
    view = render(<LineRecordsPanel invoice={invoice('draft')} />);
    await settle();
    await press(button(view.container, /^Show records — Pick/));
    expect(view.container.querySelector('[data-tone="warning"]')!.textContent).toContain('Draft may be out of date — Refresh');
  });

  test('a 404 under a draft: "Invoice changed — reload", and Reload re-reads the invoice', async () => {
    pickFirstPageStatus = 404;
    stubRouter('draft');
    let reread = 0;
    const onChanged = () => {
      reread += 1;
    };
    window.addEventListener(CLIENT_INVOICES_CHANGED_EVENT, onChanged);
    try {
      view = render(<LineRecordsPanel invoice={invoice('draft')} />);
      await settle();
      await press(button(view.container, /^Show records — Pick/));
      expect(view.container.textContent).toContain('Invoice changed — reload');
      await press(button(view.container, 'Reload'));
      expect(reread).toBe(1);
    } finally {
      window.removeEventListener(CLIENT_INVOICES_CHANGED_EVENT, onChanged);
    }
  });

  test('a storage day expands to its per-SKU breakdown (the negative SKU shown) through its own toggle', async () => {
    stubRouter('issued');
    view = render(<LineRecordsPanel invoice={invoice('issued')} />);
    await settle();
    await press(button(view.container, /^Show records — Storage/));
    const bySku = button(view.container, 'By SKU')!;
    expect(bySku.getAttribute('aria-expanded')).toBe('false');
    await press(bySku);
    expect(bySku.getAttribute('aria-expanded')).toBe('true');
    const asked = requests.find((r) => r.pathname.endsWith('/storage-breakdown'))!;
    expect([asked.params.get('date'), asked.params.get('warehouseId')]).toEqual(['2026-09-05', 'w1']);
    const breakdown = view.container.querySelector(`#${bySku.getAttribute('aria-controls')}`)!;
    expect(breakdown.textContent).toContain('MOVE-X');
    expect(breakdown.textContent).toContain('−40');
    expect(breakdown.textContent).toContain('adds up');
  });

  test('Export CSV walks every page at 1,000, re-reads the summary, and writes pseudonyms — never an email', async () => {
    pickTotal = 2500;
    pickPageLimit = 1000;
    stubRouter('issued');
    let blob: Blob | null = null;
    const realCreate = URL.createObjectURL;
    const realRevoke = URL.revokeObjectURL;
    URL.createObjectURL = (b: Blob) => {
      blob = b;
      return 'blob:test';
    };
    URL.revokeObjectURL = () => undefined;
    try {
      view = render(<LineRecordsPanel invoice={invoice('issued')} />);
      await settle();
      await press(button(view.container, /^Show records — Pick/));
      requests = [];
      await press(button(view.container, 'Export CSV'));
      await settle();
      expect(requests.map((r) => [r.params.get('cursor'), r.params.get('limit')])).toEqual([
        [null, '1000'],
        ['1000', '1000'],
        ['2000', '1000'],
        [null, '1'],
      ]);
      expect(blob).not.toBeNull();
      const text = await blob!.text();
      const code = await actorPseudonym(TENANT_ID, ACTOR);
      expect(text).toContain('# Invoice: 29/S2627/000001');
      expect(text).toContain(code);
      expect(text).not.toContain('priya@example.com');
      expect(text.trimEnd().split('\n').filter((line) => line.startsWith('"') && !line.startsWith('"#'))).toHaveLength(2500);
    } finally {
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
    }
  });

  test('"Load more" refused under a draft (refreshed): "Invoice changed — reload" with Reload; the rows already shown remain', async () => {
    pickFailOn = { cursor: '2', status: 404 };
    stubRouter('draft');
    let reread = 0;
    const onChanged = () => {
      reread += 1;
    };
    window.addEventListener(CLIENT_INVOICES_CHANGED_EVENT, onChanged);
    try {
      view = render(<LineRecordsPanel invoice={invoice('draft')} />);
      await settle();
      await press(button(view.container, /^Show records — Pick/));
      await press(button(view.container, 'Load more'));
      expect(view.container.textContent).toContain('Invoice changed — reload');
      expect(rowsOf(view.container)).toHaveLength(2);
      await press(button(view.container, 'Reload'));
      expect(reread).toBe(1);
    } finally {
      window.removeEventListener(CLIENT_INVOICES_CHANGED_EVENT, onChanged);
    }
  });

  test('an export refused mid-walk builds no file: under a draft "Invoice changed — reload" with Reload; otherwise "Not exported"', async () => {
    pickTotal = 2500;
    pickPageLimit = 1000;
    let blobs = 0;
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = () => {
      blobs += 1;
      return 'blob:test';
    };
    let reread = 0;
    const onChanged = () => {
      reread += 1;
    };
    window.addEventListener(CLIENT_INVOICES_CHANGED_EVENT, onChanged);
    try {
      pickFailOn = { cursor: '1000', status: 404 };
      stubRouter('draft');
      view = render(<LineRecordsPanel invoice={invoice('draft')} />);
      await settle();
      await press(button(view.container, /^Show records — Pick/));
      await press(button(view.container, 'Export CSV'));
      await settle();
      expect(view.container.textContent).toContain('Invoice changed — reload');
      await press(button(view.container, 'Reload'));
      expect(reread).toBe(1);
      view.unmount();
      restoreGlobals();
      pickFailOn = { cursor: '1000', status: 500 };
      stubRouter('issued');
      view = render(<LineRecordsPanel invoice={invoice('issued')} />);
      await settle();
      await press(button(view.container, /^Show records — Pick/));
      await press(button(view.container, 'Export CSV'));
      await settle();
      expect(view.container.textContent).toContain('Not exported');
      expect(button(view.container, 'Reload')).toBeUndefined();
      expect(blobs).toBe(0);
    } finally {
      URL.createObjectURL = realCreate;
      window.removeEventListener(CLIENT_INVOICES_CHANGED_EVENT, onChanged);
    }
  });

  test('an export in flight stops when the panel unmounts — no further page, no download', async () => {
    pickTotal = 2500;
    pickPageLimit = 1000;
    let release: () => void = () => undefined;
    pickHold = { cursor: '1000', release: new Promise<void>((resolve) => (release = resolve)) };
    let blobs = 0;
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = () => {
      blobs += 1;
      return 'blob:test';
    };
    try {
      stubRouter('issued');
      view = render(<LineRecordsPanel invoice={invoice('issued')} />);
      await settle();
      await press(button(view.container, /^Show records — Pick/));
      await press(button(view.container, 'Export CSV'));
      expect(requests.at(-1)!.params.get('cursor')).toBe('1000');
      view.unmount();
      view = undefined;
      const before = requests.length;
      release();
      await settle();
      expect(requests.length).toBe(before);
      expect(blobs).toBe(0);
    } finally {
      URL.createObjectURL = realCreate;
    }
  });

  test('the breakdown toggle names its day and warehouse; a 404 under a draft offers Reload', async () => {
    breakdownStatus = 404;
    stubRouter('draft');
    view = render(<LineRecordsPanel invoice={invoice('draft')} />);
    await settle();
    await press(button(view.container, /^Show records — Storage/));
    const bySku = button(view.container, 'By SKU')!;
    expect(bySku.getAttribute('aria-label')).toBe('Show SKUs for 2026-09-05 in BLR1');
    await press(bySku);
    expect(bySku.getAttribute('aria-label')).toBe('Hide SKUs for 2026-09-05 in BLR1');
    const breakdown = view.container.querySelector(`#${bySku.getAttribute('aria-controls')}`)!;
    expect(breakdown.textContent).toContain('Invoice changed — reload');
    expect(button(breakdown as HTMLElement, 'Reload')).toBeDefined();
  });
});

