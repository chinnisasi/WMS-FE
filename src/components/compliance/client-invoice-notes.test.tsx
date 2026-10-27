import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import type { UserRole } from '../../lib/users';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { PortalInvoiceNotes } from '../portal/portal-invoice-notes';
import { NotePolicyCard } from '../settings/note-policy-card';
import { ClientInvoices } from './client-invoices';
import { PrintableClientInvoiceNote } from './client-invoice-notes';

/**
 * Story 5-6a — the credit / debit note surface, the claims a `src/lib` test
 * cannot make:
 *   1. the notes panel sits under the invoice, screen-only, outside the print
 *      root; an Ops Manager reads it and is offered no note action;
 *   2. opening a note REPLACES the invoice view: exactly one `[data-print-root]`
 *      in the invoice view, the note view and the portal note view (A22);
 *   3. the draft form sends what was typed, with a key; "Settles the dispute"
 *      is offered only on a disputed invoice, and "Credit this line" presets it;
 *   4. the note view offers Issue / Discard on a draft and Void on an issued
 *      note, shows a credit draft's s.34(2) deadline, and Issue mints a NEW key
 *      per click;
 *   5. the printed note carries every Rule 53(1A) item (a)–(i), here and in
 *      the portal;
 *   6. the owner toggles the maker/checker setting; anyone else sees it disabled.
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
const ACME = { id: 'c-acme', tenantId: TENANT_ID, code: 'ACME', name: 'Acme Foods', status: 'active', systemOwned: false, createdAt: '2026-03-10T00:00:00.000Z', updatedAt: '2026-03-10T00:00:00.000Z', taxDetails: NO_TAX };

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
    gstin: '29AAACA1111A1Z1',
    stateCode: '29',
    stateName: 'Karnataka',
    address: { line1: '1 MG Road', line2: null, city: 'Bengaluru', stateCode: '29', pincode: '560001' },
  },
};

const LINE = {
  id: 'line-1',
  rateCardId: 'card-a',
  segmentFrom: '2026-09-01',
  segmentTo: '2026-09-30',
  chargeCode: 'pick',
  basis: 'per_pick',
  uom: null,
  quantity: '40',
  unitAmountPaise: 2500,
  amountPaise: 100_000,
  sac: '996719',
  gstBps: 1800,
  placeOfSupply: '29',
  supplyType: 'intra',
  cgstPaise: 9000,
  sgstPaise: 9000,
  igstPaise: 0,
};

function invoice(status: string): Record<string, unknown> {
  return {
    id: 'i-1',
    clientId: ACME.id,
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    status,
    invoiceNo: '29/S2627/000001',
    fyLabel: 'FY-2627',
    supplierGstin: '29AAACT1234A1Z5',
    placeOfSupply: '29',
    supplyType: 'intra',
    totals: { subtotal: 100_000, cgst: 9000, sgst: 9000, igst: 0, tax: 18_000, roundOff: 0, payable: 118_000 },
    issuedAt: '2026-10-05T04:30:00.000Z',
    statusNote: null,
    replacesInvoiceId: null,
    createdAt: '2026-10-05T04:00:00.000Z',
    gaps: [],
    warnings: [],
    party: PARTY,
    lines: [LINE],
  };
}

function note(status: 'draft' | 'issued' | 'void', over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'n-1',
    invoiceId: 'i-1',
    clientId: ACME.id,
    kind: 'credit',
    status,
    reason: 'excess-billed',
    reasonNote: 'Rate keyed wrongly',
    settlesDispute: false,
    noteNo: status === 'draft' ? null : '29/C2627/000001',
    fyLabel: status === 'draft' ? null : 'FY-2627',
    supplierGstin: '29AAACT1234A1Z5',
    placeOfSupply: '29',
    supplyType: 'intra',
    totals: { subtotal: 20_000, cgst: 1800, sgst: 1800, igst: 0, tax: 3600, roundOff: 0, payable: 23_600 },
    issuedAt: status === 'draft' ? null : '2026-10-12T05:00:00.000Z',
    issuedBy: status === 'draft' ? null : 'u-2',
    voidNote: status === 'void' ? 'wrong line' : null,
    voidedAt: status === 'void' ? '2026-10-13T05:00:00.000Z' : null,
    voidedBy: status === 'void' ? 'u-1' : null,
    createdBy: 'u-1',
    createdAt: '2026-10-11T05:00:00.000Z',
    invoiceNo: '29/S2627/000001',
    invoiceIssuedAt: '2026-10-05T04:30:00.000Z',
    creditDeadline: '2027-11-30',
    party: PARTY,
    lines: [
      {
        id: 'nl-1',
        invoiceLineId: 'line-1',
        chargeCode: 'pick',
        basis: 'per_pick',
        uom: null,
        segmentFrom: '2026-09-01',
        segmentTo: '2026-09-30',
        sac: '996719',
        gstBps: 1800,
        placeOfSupply: '29',
        supplyType: 'intra',
        amountPaise: 20_000,
        cgstPaise: 1800,
        sgstPaise: 1800,
        igstPaise: 0,
        overrideReason: null,
      },
    ],
    ...over,
  };
}

const entryOf = (full: Record<string, unknown>): Record<string, unknown> => {
  const entry = { ...full };
  for (const key of ['invoiceNo', 'invoiceIssuedAt', 'creditDeadline', 'party', 'lines']) delete entry[key];
  return entry;
};

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly body: unknown;
  readonly key: string | null;
}
let requests: Recorded[] = [];
let invoiceStatus = 'issued';
let notes: Record<string, unknown>[] = [];
let policy = true;

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
    if (method === 'GET' && pathname.endsWith('/clients')) return json(200, { items: [ACME] });
    if (method === 'GET' && pathname.endsWith('/client-invoices')) {
      const entry: Record<string, unknown> = { ...invoice(invoiceStatus), gapCount: 0 };
      for (const detailOnly of ['gaps', 'warnings', 'party', 'lines']) delete entry[detailOnly];
      return json(200, { items: [entry], nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith('/client-invoices/i-1/notes')) {
      return json(200, { notes: notes.map(entryOf), netDocument: invoice(invoiceStatus).totals, netDocumentPayable: notes.some((n) => n.status === 'issued') ? 94_400 : 118_000 });
    }
    if (method === 'POST' && pathname.endsWith('/client-invoices/i-1/notes')) {
      const drafted = note('draft', { settlesDispute: (body as { settlesDispute?: boolean }).settlesDispute === true });
      notes = [drafted];
      return json(201, { note: drafted });
    }
    if (method === 'GET' && pathname.endsWith('/client-invoices/i-1')) return json(200, { invoice: invoice(invoiceStatus) });
    if (method === 'GET' && pathname.endsWith('/client-invoice-notes/n-1')) return json(200, { note: notes[0] });
    if (method === 'POST' && pathname.endsWith('/client-invoice-notes/n-1/issue')) {
      notes = [note('issued')];
      return json(200, { note: notes[0] });
    }
    if (method === 'POST' && pathname.endsWith('/client-invoice-notes/n-1/void')) {
      notes = [note('void')];
      return json(200, { note: notes[0] });
    }
    if (method === 'GET' && pathname.endsWith('/billing/note-policy')) return json(200, { requireSecondApprover: policy });
    if (method === 'PUT' && pathname.endsWith('/billing/note-policy')) {
      policy = (body as { requireSecondApprover: boolean }).requireSecondApprover;
      return json(200, { requireSecondApprover: policy });
    }
    if (method === 'GET' && pathname.endsWith('/portal/invoices/i-1/notes')) {
      return json(200, {
        notes: [{ id: 'n-1', kind: 'credit', noteNo: '29/C2627/000001', fyLabel: 'FY-2627', issuedAt: '2026-10-12T05:00:00.000Z', status: 'issued', reason: 'excess-billed', reasonNote: 'Rate keyed wrongly', totals: note('issued').totals }],
        netDocument: invoice('issued').totals,
        netDocumentPayable: 94_400,
      });
    }
    if (method === 'GET' && pathname.endsWith('/portal/invoice-notes/n-1')) {
      const full = note('issued');
      const { supplier, recipient } = PARTY;
      return json(200, {
        id: 'n-1',
        kind: 'credit',
        noteNo: '29/C2627/000001',
        fyLabel: 'FY-2627',
        issuedAt: full.issuedAt,
        status: 'issued',
        reason: 'excess-billed',
        reasonNote: 'Rate keyed wrongly',
        totals: full.totals,
        invoiceNo: '29/S2627/000001',
        invoiceIssuedAt: '2026-10-05T04:30:00.000Z',
        placeOfSupply: '29',
        supplyType: 'intra',
        party: {
          supplier: { name: supplier.name, gstin: supplier.gstin, stateCode: supplier.stateCode, stateName: supplier.stateName, address: supplier.address },
          recipient: { name: recipient.name, legalName: recipient.legalName, gstin: recipient.gstin, stateCode: recipient.stateCode, stateName: recipient.stateName, address: recipient.address },
        },
        lines: [{ chargeCode: 'pick', basis: 'per_pick', uom: null, segmentFrom: '2026-09-01', segmentTo: '2026-09-30', sac: '996719', gstBps: 1800, amountPaise: 20_000, cgstPaise: 1800, sgstPaise: 1800, igstPaise: 0 }],
      });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  invoiceStatus = 'issued';
  notes = [];
  policy = true;
  stubRouter();
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
  for (let i = 0; i < 10; i++) {
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

function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

async function openInvoice(container: HTMLElement): Promise<void> {
  await press(buttons(container, 'View')[0]);
}

const RULE_53 = (text: string) => {
  // (a) supplier name, address, GSTIN
  expect(text).toContain('Three PL Co');
  expect(text).toContain('12 Peenya Industrial Area');
  expect(text).toContain('29AAACT1234A1Z5');
  // (b) nature of the document — asserted on the heading by the caller
  // (c) number, (d) date
  expect(text).toContain('29/C2627/000001');
  expect(text).toMatch(/12 Oct 2026/);
  // (e) recipient name, address, GSTIN; state name and code
  expect(text).toContain('Acme Foods Private Limited');
  expect(text).toContain('1 MG Road');
  expect(text).toContain('29AAACA1111A1Z1');
  expect(text).toContain('Karnataka (29)');
  // (g) the original invoice's number and date
  expect(text).toContain('Against invoice 29/S2627/000001');
  expect(text).toMatch(/0?5 Oct 2026/);
  // (h) per line: taxable value, rate, tax; place of supply; reverse charge
  expect(text).toContain('996719');
  expect(text).toContain('₹200.00');
  expect(text).toContain('18%');
  expect(text).toContain('₹18.00');
  expect(text).toContain('Place of supply: Karnataka (29)');
  expect(text).toContain('Reverse charge: No');
  // the reason and its note
  expect(text).toContain('Rate keyed wrongly');
  // (i) signature
  expect(text).toContain('For Three PL Co');
  expect(text).toContain('Authorised signatory');
};

describe('credit and debit notes', () => {
  test('the panel sits under the invoice, screen-only, outside the print root; an ops manager reads it and gets no note action', async () => {
    writeSession(session('ops_manager'));
    notes = [note('issued')];
    view = render(<ClientInvoices />);
    await settle();
    await openInvoice(view.container);
    const panel = view.container.querySelector('section[data-invoice-notes]')!;
    expect(panel).not.toBeNull();
    expect(panel.closest('[data-print-root]')).toBeNull();
    expect(panel.className).toContain('print:hidden');
    expect(panel.textContent).toContain('29/C2627/000001');
    expect(panel.textContent).toContain('−₹236.00');
    expect(panel.textContent).toContain('Document value after notes');
    expect(panel.textContent).toContain('₹944.00');
    expect(buttons(view.container, 'New credit note')).toHaveLength(0);
    expect(buttons(view.container, 'New debit note')).toHaveLength(0);
    expect(view.container.querySelectorAll('[data-print-root]')).toHaveLength(1);
  });

  test('A22: opening a note replaces the invoice view — exactly one print root, the note’s; Back returns to the invoice', async () => {
    writeSession(session('accountant'));
    notes = [note('issued')];
    view = render(<ClientInvoices />);
    await settle();
    await openInvoice(view.container);
    expect(view.container.querySelectorAll('[data-print-root]')).toHaveLength(1);
    await press(buttons(view.container, 'Open')[0]);
    const roots = view.container.querySelectorAll('[data-print-root]');
    expect(roots).toHaveLength(1);
    expect(roots[0]!.getAttribute('aria-label')).toBe('Printable note');
    expect(roots[0]!.querySelector('h3')!.textContent).toBe('Credit Note');
    expect(view.container.querySelector('article[aria-label="Printable client invoice"]')).toBeNull();
    // An issued, non-settling note offers Void, not Issue or Discard.
    expect(buttons(view.container, 'Void')).toHaveLength(1);
    expect(buttons(view.container, 'Issue')).toHaveLength(0);
    await press(buttons(view.container, '← Back to the invoice')[0]);
    expect(view.container.querySelector('article[aria-label="Printable client invoice"]')).not.toBeNull();
  });

  test('the draft form: kinds per status, a key on submit, settle offered only on a disputed invoice', async () => {
    writeSession(session('accountant'));
    view = render(<ClientInvoices />);
    await settle();
    await openInvoice(view.container);
    expect(buttons(view.container, 'New credit note')).toHaveLength(1);
    expect(buttons(view.container, 'New debit note')).toHaveLength(1);
    await press(buttons(view.container, 'New credit note')[0]);
    const form = view.container.querySelector('form[aria-label^="New credit note"]')!;
    expect(form.textContent).toContain('Printed on the note the client receives.');
    expect(form.querySelector('input[aria-label="Settles the dispute"]')).toBeNull();
    // Nothing typed → refused locally, nothing sent.
    await press(buttons(form as HTMLElement, 'Draft credit note')[0]);
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0);
    setValue(form.querySelector('input[aria-label^="Amount for"]') as HTMLInputElement, '200');
    setValue(form.querySelector('select[aria-label="Reason"]') as HTMLSelectElement, 'excess-billed');
    setValue(form.querySelector('textarea[aria-label="Reason note"]') as HTMLTextAreaElement, 'Rate keyed wrongly');
    await press(buttons(form as HTMLElement, 'Draft credit note')[0]);
    const post = requests.find((r) => r.method === 'POST' && r.pathname.endsWith('/notes'))!;
    expect(post.body).toEqual({ kind: 'credit', reason: 'excess-billed', reasonNote: 'Rate keyed wrongly', lines: [{ invoiceLineId: 'line-1', amountPaise: 20_000 }] });
    expect(post.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    // The created draft opens: its deadline shows; Issue and Discard are offered.
    expect(view.container.textContent).toContain('Issue by 30 Nov 2027');
    expect(buttons(view.container, 'Issue')).toHaveLength(1);
    expect(buttons(view.container, 'Discard')).toHaveLength(1);
    expect(view.container.querySelector('[data-print-root] h3')!.textContent).toBe('DRAFT — not a credit note');
  });

  test('a disputed invoice: no debit; "Credit this line" opens the credit form preset to the line with settle ticked', async () => {
    writeSession(session('accountant'));
    invoiceStatus = 'disputed';
    view = render(<ClientInvoices />);
    await settle();
    await openInvoice(view.container);
    expect(buttons(view.container, 'New debit note')).toHaveLength(0);
    await press(buttons(view.container, 'Credit this line')[0]);
    const form = view.container.querySelector('form[aria-label^="New credit note"]')!;
    const settles = form.querySelector('input[aria-label="Settles the dispute"]') as HTMLInputElement;
    expect(settles).not.toBeNull();
    expect(settles.checked).toBe(true);
    expect(form.querySelectorAll('input[aria-label^="Amount for"]')).toHaveLength(1);
  });

  test('Issue mints a NEW key per click', async () => {
    writeSession(session('accountant'));
    notes = [note('draft')];
    // The first issue is refused (another credit since): the second click must not reuse its key.
    let calls = 0;
    const real = globalThis.fetch;
    stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input.toString(), init);
      if (request.method === 'POST' && request.url.endsWith('/issue') && calls++ === 0) {
        requests.push({ method: 'POST', pathname: new URL(request.url).pathname, body: null, key: request.headers.get('Idempotency-Key') });
        return json(409, { code: 'note-figures-changed', title: 'x', status: 409 });
      }
      return real(request);
    }) as unknown as typeof fetch);
    view = render(<ClientInvoices />);
    await settle();
    await openInvoice(view.container);
    await press(buttons(view.container, 'Open')[0]);
    await press(buttons(view.container, 'Issue')[0]);
    expect(view.container.textContent).toContain('discard this draft and create it again');
    await press(buttons(view.container, 'Issue')[0]);
    const keys = requests.filter((r) => r.pathname.endsWith('/issue')).map((r) => r.key);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  test('the printed note carries every Rule 53(1A) item (a)–(i); a debit is titled Debit Note', () => {
    view = render(<PrintableClientInvoiceNote note={note('issued') as never} />);
    const article = view.container.querySelector('[data-print-root]')!;
    expect(article.querySelector('h3')!.textContent).toBe('Credit Note');
    RULE_53(article.textContent ?? '');
    view.unmount();
    view = render(<PrintableClientInvoiceNote note={note('issued', { kind: 'debit', reason: 'short-billed' }) as never} />);
    expect(view.container.querySelector('[data-print-root] h3')!.textContent).toBe('Debit Note');
    view.unmount();
    view = render(<PrintableClientInvoiceNote note={note('void') as never} />);
    expect(view.container.querySelector('[data-print-root] h3')!.textContent).toBe('VOID — Credit Note');
  });

  test('the portal note view: the issued note under the invoice with the document value; opened, one print root with every Rule 53(1A) item', async () => {
    writeSession(session('client'));
    view = render(<PortalInvoiceNotes invoiceId="i-1" />);
    await settle();
    expect(view.container.textContent).toContain('29/C2627/000001');
    expect(view.container.textContent).toContain('Document value after notes');
    expect(view.container.textContent).toContain('₹944.00');
    await press(buttons(view.container, 'Open')[0]);
    const roots = view.container.querySelectorAll('[data-print-root]');
    expect(roots).toHaveLength(1);
    expect(roots[0]!.querySelector('h4')!.textContent).toBe('Credit Note');
    RULE_53(roots[0]!.textContent ?? '');
  });

  test('the owner toggles “Require a second person to issue credit notes” (keyed PUT); an accountant sees it disabled', async () => {
    writeSession(session('owner'));
    view = render(<NotePolicyCard />);
    await settle();
    const box = view.container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(false);
    await act(async () => {
      box.click();
    });
    await settle();
    const put = requests.find((r) => r.method === 'PUT')!;
    expect(put.body).toEqual({ requireSecondApprover: false });
    expect(put.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    view.unmount();
    clearSession();
    writeSession(session('accountant'));
    view = render(<NotePolicyCard />);
    await settle();
    expect((view.container.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBe(true);
    expect(view.container.textContent).toContain('Only the owner can change this.');
  });
});
