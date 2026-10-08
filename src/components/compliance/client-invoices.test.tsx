import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { invoiceMonthOptions } from '../../lib/client-invoices';
import type { UserRole } from '../../lib/users';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { ClientInvoices } from './client-invoices';

/**
 * Story 21-5 — the claims a `src/lib` test cannot make:
 *   1. every role READS the list and prints an invoice; an Ops Manager is
 *      offered no Prepare, Issue, Refresh, Discard or status action — absent,
 *      not disabled;
 *   2. the tenant's own client is never offered to Prepare, and Prepare sends
 *      the picked month with an Idempotency-Key;
 *   3. pressing Issue sends ISSUE, with a NEW key per click; a `stale` answer
 *      shows "Figures changed — review and issue again";
 *   4. Void refuses without a note (nothing sent), shows the GSTR-1 warning,
 *      and sends the note;
 *   5. the printed invoice carries the Rule 46 fields from the frozen party,
 *      and a draft prints as "DRAFT — not a tax invoice".
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';

function session(role: UserRole): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Three PL Co', gstin: '29AAACT1234A1Z5' },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  };
}

const NO_TAX = { legalName: null, gstin: null, billingLine1: null, billingLine2: null, billingCity: null, billingStateCode: null, billingPincode: null };
const SELF = { id: 'c-self', tenantId: TENANT_ID, code: 'self', name: 'Three PL Co', status: 'active', systemOwned: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', taxDetails: NO_TAX };
const ACME = { ...SELF, id: 'c-acme', code: 'ACME', name: 'Acme Foods', systemOwned: false, createdAt: '2026-03-10T00:00:00.000Z' };

const PARTY = {
  supplier: {
    name: 'Three PL Co',
    gstin: '29AAACT1234A1Z5',
    stateCode: '29',
    stateName: 'Karnataka',
    address: { line1: '12 Peenya Industrial Area', line2: null, city: 'Bengaluru', state: 'Karnataka', pincode: '560066' },
    warehouseCode: 'BLR1',
  },
  recipient: {
    name: 'Acme Foods',
    code: 'ACME',
    legalName: 'Acme Foods Private Limited',
    gstin: '27AAACA1234A1Z5',
    stateCode: '27',
    stateName: 'Maharashtra',
    address: { line1: '5 FC Road', line2: null, city: 'Pune', stateCode: '27', pincode: '411001' },
  },
};

const LINE = {
  id: '01900000-0000-7000-8000-00000000a001',
  rateCardId: 'card-a',
  segmentFrom: '2026-09-01',
  segmentTo: '2026-09-30',
  chargeCode: 'storage',
  basis: 'per_thousand_units_per_day',
  uom: 'each',
  quantity: '1500',
  unitAmountPaise: 330,
  amountPaise: 495,
  sac: '996729',
  gstBps: 1800,
  placeOfSupply: '27',
  supplyType: 'inter',
  cgstPaise: 0,
  sgstPaise: 0,
  igstPaise: 89,
};

function fullInvoice(id: string, status: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    clientId: ACME.id,
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    status,
    invoiceNo: status === 'draft' ? null : '29/S2627/000001',
    fyLabel: status === 'draft' ? null : 'FY-2627',
    supplierGstin: '29AAACT1234A1Z5',
    placeOfSupply: '27',
    supplyType: 'inter',
    totals: { subtotal: 495, cgst: 0, sgst: 0, igst: 89, tax: 89, roundOff: 16, payable: 600 },
    issuedAt: status === 'draft' ? null : '2026-10-07T04:30:00.000Z',
    statusNote: null,
    replacesInvoiceId: null,
    createdAt: '2026-10-07T04:00:00.000Z',
    gaps: [],
    warnings: [],
    party: PARTY,
    lines: [LINE],
    ...over,
  };
}

function entryOf(invoice: Record<string, unknown>): Record<string, unknown> {
  const entry: Record<string, unknown> = { ...invoice, gapCount: (invoice.gaps as unknown[]).length };
  for (const detailOnly of ['gaps', 'warnings', 'party', 'lines']) delete entry[detailOnly];
  return entry;
}

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly body: unknown;
  readonly key: string | null;
}
let requests: Recorded[] = [];
let invoices: Record<string, Record<string, unknown>> = {};
let issueAnswer: 'issued' | 'stale' = 'issued';
/** The first prepare answers 503 (to prove a retry reuses its key and an edit does not). */
let prepareFailsOnce = false;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname } = new URL(request.url);
    const method = request.method.toUpperCase();
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    requests.push({ method, pathname, body, key: request.headers.get('Idempotency-Key') });
    if (method === 'GET' && pathname.endsWith('/clients')) return json(200, { items: [SELF, ACME] });
    if (method === 'GET' && pathname.endsWith('/client-invoices')) {
      return json(200, { items: Object.values(invoices).map(entryOf), nextCursor: null });
    }
    const one = /\/client-invoices\/([^/]+)(?:\/([a-z]+))?$/.exec(pathname);
    if (one !== null) {
      const invoice = invoices[one[1]!];
      if (invoice === undefined) return json(404, { code: 'not-found', title: 'Not found', status: 404 });
      if (method === 'GET') return json(200, { invoice });
      if (method === 'POST' && one[2] === 'issue') {
        return json(200, { outcome: issueAnswer, invoice: issueAnswer === 'stale' ? invoice : { ...invoice, status: 'issued', invoiceNo: '29/S2627/000001' } });
      }
      if (method === 'POST' && one[2] === 'void') return json(200, { invoice: { ...invoice, status: 'void', statusNote: (body as { note: string }).note } });
      if (method === 'POST' && one[2] === 'refresh') return json(200, { invoice });
    }
    if (method === 'POST' && pathname.endsWith(`/clients/${ACME.id}/invoices`) && prepareFailsOnce) {
      prepareFailsOnce = false;
      return json(503, { code: 'unavailable', title: 'Down', status: 503, detail: 'Try again.' });
    }
    if (method === 'POST' && pathname.endsWith(`/clients/${ACME.id}/invoices`)) {
      return json(201, { created: [fullInvoice('i-new', 'draft')], existing: [] });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  issueAnswer = 'issued';
  prepareFailsOnce = false;
  invoices = { 'i-draft': fullInvoice('i-draft', 'draft', { createdAt: '2026-10-07T05:00:00.000Z' }), 'i-issued': fullInvoice('i-issued', 'issued') };
  stubRouter();
});

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

function buttons(container: HTMLElement, label: string): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter((b) => b.textContent === label);
}

async function press(button: HTMLButtonElement | undefined): Promise<void> {
  expect(button).toBeDefined();
  await act(async () => {
    button!.click();
  });
  await settle();
}

/** Toggle the N-th invoice row's View/Hide (expanded panels are rows too, so find the toggles). */
async function open(container: HTMLElement, index: number): Promise<void> {
  // The invoice rows' View/Hide toggles only — an open invoice adds its own
  // (21-5b's line-record toggles), which are not invoice rows.
  const toggles = [...container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].filter((b) => b.textContent === 'View' || b.textContent === 'Hide');
  await press(toggles[index]);
}

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ClientInvoices', () => {
  test('an ops manager reads the list and the printed invoice, and is offered no mutating affordance', async () => {
    writeSession(session('ops_manager'));
    view = render(<ClientInvoices />);
    await settle();
    const rows = [...view.container.querySelectorAll('tbody tr')].map((row) => row.textContent ?? '');
    expect(rows[0]).toContain('Draft');
    expect(rows[0]).toContain('ACME');
    expect(rows[0]).toContain('September 2026');
    expect(rows[0]).toContain('29AAACT1234A1Z5');
    expect(rows[1]).toContain('29/S2627/000001');
    expect(rows[1]).toContain('₹6.00');
    expect(view.container.querySelector('form[aria-label="Prepare client invoices"]')).toBeNull();
    // The draft open (one row opens at a time): no draft action.
    await open(view.container, 0);
    expect(view.container.querySelector('article[data-print-root]')).not.toBeNull();
    for (const label of ['Prepare', 'Issue', 'Refresh', 'Discard']) {
      expect(buttons(view.container, label)).toHaveLength(0);
    }
    // The issued one open: no status action.
    await open(view.container, 1);
    expect(view.container.querySelector('article[data-print-root] h3')!.textContent).toBe('Tax Invoice');
    for (const label of ['Dispute', 'Settle', 'Void']) {
      expect(buttons(view.container, label)).toHaveLength(0);
    }
    expect(buttons(view.container, 'Print').length).toBeGreaterThan(0);
  });

  test('21-5b: the Line records panel sits under the printed invoice — screen-only, never inside data-print-root', async () => {
    writeSession(session('ops_manager'));
    view = render(<ClientInvoices />);
    await settle();
    await open(view.container, 1);
    const panel = view.container.querySelector('section[data-line-records]')!;
    expect(panel).not.toBeNull();
    expect(panel.closest('[data-print-root]')).toBeNull();
    expect(panel.className).toContain('print:hidden');
    const printed = view.container.querySelector('article[data-print-root]')!;
    expect(printed.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(printed.textContent).not.toContain('Line records');
    // One toggle per invoice line, each naming the panel it controls.
    const toggles = [...panel.querySelectorAll('button[aria-expanded]')];
    expect(toggles).toHaveLength(1);
    expect(toggles[0]!.getAttribute('aria-controls')).toBe(`line-records-panel-${LINE.id}`);
  });

  test('the printed invoice: Rule 46 fields from the frozen party; a draft is not a tax invoice', async () => {
    writeSession(session('ops_manager'));
    view = render(<ClientInvoices />);
    await settle();
    await open(view.container, 1);
    const printed = view.container.querySelector('article[data-print-root]')!;
    const text = printed.textContent ?? '';
    expect(printed.querySelector('h3')!.textContent).toBe('Tax Invoice');
    for (const field of [
      'Invoice no. 29/S2627/000001',
      'Date: 07 Oct 2026',
      'Three PL Co',
      '12 Peenya Industrial Area',
      'GSTIN: 29AAACT1234A1Z5',
      'State: Karnataka (29)',
      'Acme Foods Private Limited',
      'GSTIN: 27AAACA1234A1Z5',
      'State: Maharashtra (27)',
      'Place of supply: 27 — Maharashtra',
      'Reverse charge: No',
      'Storage (each) · 1 Sep 2026 – 30 Sep 2026',
      '996729',
      '1,500 each-days',
      '₹3.30 per 1,000 units/day',
      '₹4.95',
      '18%',
      '₹0.89',
      'Round off',
      '+₹0.16',
      'Indian Rupees Six Only',
      'Authorised signatory',
    ]) {
      expect(text).toContain(field);
    }
    await open(view.container, 1); // close it
    await open(view.container, 0);
    const draft = view.container.querySelector('article[data-print-root]')!;
    expect(draft.querySelector('h3')!.textContent).toBe('DRAFT — not a tax invoice');
    expect(draft.textContent).toContain('Invoice no. Unnumbered');
  });

  test('an accountant prepares: the own client is never offered; the month and a key are sent', async () => {
    writeSession(session('accountant'));
    view = render(<ClientInvoices />);
    await settle();
    const options = [...view.container.querySelectorAll('select[aria-label="Invoice client"] option')].map((o) => o.textContent);
    expect(options).toEqual(['ACME — Acme Foods']);
    const expectedMonth = invoiceMonthOptions(ACME.createdAt, Date.now())[0]!.value;
    await press(buttons(view.container, 'Prepare')[0]);
    const prepare = requests.find((r) => r.method === 'POST' && r.pathname.endsWith(`/clients/${ACME.id}/invoices`))!;
    expect(prepare.body).toEqual({ month: expectedMonth });
    expect(prepare.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(view.container.textContent).toContain('1 draft prepared');
  });

  test('pressing Issue sends ISSUE with a new key per click; a stale answer says the figures changed', async () => {
    issueAnswer = 'stale';
    writeSession(session('accountant'));
    view = render(<ClientInvoices />);
    await settle();
    await open(view.container, 0);
    await press(buttons(view.container, 'Issue')[0]);
    expect(view.container.textContent).toContain('Figures changed — review and issue again');
    issueAnswer = 'issued';
    await press(buttons(view.container, 'Issue')[0]);
    const issues = requests.filter((r) => r.method === 'POST' && r.pathname.endsWith('/client-invoices/i-draft/issue'));
    expect(issues).toHaveLength(2);
    expect(issues[0]!.key).not.toBe(issues[1]!.key);
    expect(view.container.textContent).toContain('Issued 29/S2627/000001');
    // An issued invoice is never offered Issue / Refresh / Discard.
    expect(requests.some((r) => r.pathname.endsWith('/refresh'))).toBe(false);
  });

  test('Rule 48(2): an issued invoice prints ORIGINAL and DUPLICATE copies (a page break before the second); a draft prints once', async () => {
    writeSession(session('ops_manager'));
    view = render(<ClientInvoices />);
    await settle();
    await open(view.container, 1);
    const copies = [...view.container.querySelectorAll('article[data-print-root] > section')];
    expect(copies.map((copy) => copy.getAttribute('data-copy'))).toEqual(['ORIGINAL FOR RECIPIENT', 'DUPLICATE FOR SUPPLIER']);
    expect(copies[0]!.textContent).toContain('ORIGINAL FOR RECIPIENT');
    expect(copies[1]!.textContent).toContain('DUPLICATE FOR SUPPLIER');
    // Both copies carry the whole document; the duplicate is paper-only, on its own page.
    for (const copy of copies) {
      expect(copy.textContent).toContain('Invoice no. 29/S2627/000001');
      expect(copy.textContent).toContain('Authorised signatory');
    }
    expect(copies[1]!.className).toContain('print:break-before-page');
    expect(copies[1]!.className).toContain('hidden');
    await open(view.container, 1);
    await open(view.container, 0);
    const draft = [...view.container.querySelectorAll('article[data-print-root] > section')];
    expect(draft).toHaveLength(1);
    expect(draft[0]!.getAttribute('data-copy')).toBeNull();
    expect(draft[0]!.textContent).not.toContain('ORIGINAL FOR RECIPIENT');
  });

  test('a draft with gaps: Issue is disabled with the fix-and-Refresh hint; Refresh stays offered', async () => {
    invoices['i-draft'] = fullInvoice('i-draft', 'draft', { createdAt: '2026-10-07T05:00:00.000Z', gaps: [{ code: 'line-unpriced', detail: 'pick 1 Sep – 30 Sep' }] });
    writeSession(session('accountant'));
    view = render(<ClientInvoices />);
    await settle();
    await open(view.container, 0);
    const issue = buttons(view.container, 'Issue')[0]!;
    expect(issue.disabled).toBe(true);
    expect(view.container.textContent).toContain('Fix the gap below, then Refresh — a draft with gaps cannot issue.');
    expect(buttons(view.container, 'Refresh')[0]!.disabled).toBe(false);
    await act(async () => {
      issue.click();
    });
    await settle();
    expect(requests.some((r) => r.pathname.endsWith('/issue'))).toBe(false);
  });

  test('Prepare: a retry of the same choice reuses its key; changing the month mints a new one', async () => {
    prepareFailsOnce = true;
    writeSession(session('accountant'));
    view = render(<ClientInvoices />);
    await settle();
    await press(buttons(view.container, 'Prepare')[0]);
    expect(view.container.textContent).toContain('Not prepared');
    prepareFailsOnce = true;
    await press(buttons(view.container, 'Prepare')[0]);
    const select = view.container.querySelector('select[aria-label="Invoice month"]') as HTMLSelectElement;
    const second = [...select.options][1]!.value;
    act(() => {
      select.value = second;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await press(buttons(view.container, 'Prepare')[0]);
    const posts = requests.filter((r) => r.method === 'POST' && r.pathname.endsWith(`/clients/${ACME.id}/invoices`));
    expect(posts).toHaveLength(3);
    expect(posts[1]!.key).toBe(posts[0]!.key);
    expect(posts[1]!.body).toEqual(posts[0]!.body);
    expect(posts[2]!.body).toEqual({ month: second });
    expect(posts[2]!.key).not.toBe(posts[0]!.key);
  });

  test('Void: no note → refused locally, nothing sent; the GSTR-1 warning shows; the note is sent', async () => {
    writeSession(session('accountant'));
    view = render(<ClientInvoices />);
    await settle();
    await open(view.container, 1);
    expect(buttons(view.container, 'Issue')).toHaveLength(0);
    expect(buttons(view.container, 'Discard')).toHaveLength(0);
    await press(buttons(view.container, 'Void')[0]);
    expect(view.container.textContent).toContain('a credit note is the correct fix — not supported yet');
    await press(buttons(view.container, 'Void invoice')[0]);
    expect(view.container.textContent).toContain('a note is required to void');
    expect(requests.some((r) => r.pathname.endsWith('/void'))).toBe(false);
    setInput(view.container.querySelector('input[aria-label="Status note"]') as HTMLInputElement, 'Wrong legal name');
    await press(buttons(view.container, 'Void invoice')[0]);
    const voided = requests.find((r) => r.method === 'POST' && r.pathname.endsWith('/client-invoices/i-issued/void'))!;
    expect(voided.body).toEqual({ note: 'Wrong legal name' });
    expect(voided.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});
