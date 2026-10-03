import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { Invoices } from './invoices';

/**
 * The /compliance Invoices section (story 8-1). The claims a `src/lib` test
 * cannot make:
 *   1. the pricing panel offers EXACTLY the lines the server's gaps name
 *      (structured `orderLineId`), labelled through the order read + SKU map;
 *   2. "Save prices and regenerate" POSTs the rates it says — exact paise,
 *      the order id, an Idempotency-Key — and the list re-reads after;
 *   3. a malformed rupee entry sends NOTHING;
 *   4. an un-issued invoice prints as a DRAFT, an issued one as a tax invoice;
 *   5. a role without `invoice.generate` reads every invoice and is offered
 *      no mutating affordance at all (hidden, not disabled);
 *   6. (8-1b) an ISSUED invoice offers no pricing/regenerate panel even to a
 *      capable role — it is frozen; the print carries Invoice total, Round off
 *      and Payable with the words from the payable; the list shows each
 *      number's supplier GSTIN.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const ORDER_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000aa';
const INVOICE_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000bb';
const LINE_UNPRICED = '0198f7a2-1b3c-7d4e-8f90-0000000000c1';
const LINE_PRICED = '0198f7a2-1b3c-7d4e-8f90-0000000000c2';

function session(role: 'owner' | 'ops_manager' | 'operator' | 'accountant'): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Priya Spices', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  };
}

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly query: string;
  readonly body: unknown;
  readonly headers: Record<string, string>;
}

let requests: Recorded[] = [];
let status: 'awaiting-data' | 'issued' = 'awaiting-data';
/** Queued answers for the next POSTs (default: 200, the invoice issues). */
let postAnswers: { status: number; code: string; thenStatus?: 'awaiting-data' | 'issued' }[] = [];
/** Makes the list read answer 500 until cleared (the read-failure arm). */
let listFails = false;
/** The first list page carries a next cursor (the page-one-after-generate pin). */
let listPaged = false;
/** Replaces the detail's document (the unreadable-document arm). */
let documentOverride: unknown = undefined;
/** Awaiting-data gaps (default: one unpriced line). */
let awaitingGaps: Record<string, unknown>[] = [];

function json(code: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } });
}

function documentFor(current: typeof status): Record<string, unknown> {
  const issued = current === 'issued';
  return {
    header: {
      invoiceNo: issued ? '27/2627/000007' : null,
      fyLabel: issued ? 'FY-2627' : null,
      orderRef: ORDER_ID,
      issuedAt: issued ? '2026-10-03T06:00:00.000Z' : null,
      supplyType: 'intra',
      placeOfSupply: '27',
      originGstin: '27AAAPZ1234C1ZV',
      consigneeGstin: null,
      originAddress: { line1: '22, Chakan MIDC', city: 'Pune', state: 'Maharashtra', pincode: '410501' },
      consigneeAddress: { line1: '4, MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
    },
    seller: { name: 'Priya Spices', gstin: '27AAAPZ1234C1ZV' },
    buyer: { name: 'Asha', gstin: null },
    lines: [
      {
        orderLineId: LINE_PRICED,
        skuCode: 'SPICE-02',
        skuName: 'Chilli',
        hsn: '0904',
        qtyMilli: 2000,
        uom: 'each',
        ratePaise: 10000,
        rateSource: 'order_line',
        taxablePaise: 20000,
        gstBps: 500,
        cgstPaise: 500,
        sgstPaise: 500,
        igstPaise: 0,
        hsnGap: false,
      },
    ],
    // ₹210.49 → payable ₹210.00, round off −₹0.49.
    totals: { subtotal: 20049, gst: 1000, total: 21049, roundOff: -49, payable: 21000 },
    gaps: issued ? [] : awaitingGaps,
    revision: 1,
  };
}

function invoiceDto(): Record<string, unknown> {
  const issued = status === 'issued';
  return {
    id: INVOICE_ID,
    tenantId: TENANT_ID,
    orderId: ORDER_ID,
    warehouseId: 'wh-1',
    invoiceNo: issued ? '27/2627/000007' : null,
    fyLabel: issued ? 'FY-2627' : null,
    seriesSeq: issued ? 7 : null,
    status,
    originGstin: '27AAAPZ1234C1ZV',
    consigneeGstin: null,
    placeOfSupply: '27',
    supplyType: 'intra',
    subtotalPaise: 20049,
    gstPaise: 1000,
    totalPaise: 21049,
    payablePaise: 21000,
    roundOffPaise: -49,
    revision: 1,
    document: documentFor(status),
    lines: [],
    createdAt: '2026-10-03T06:00:00.000Z',
    updatedAt: '2026-10-03T06:00:00.000Z',
  };
}

function entry(): Record<string, unknown> {
  const dto = invoiceDto();
  return {
    id: dto.id,
    orderId: dto.orderId,
    warehouseId: dto.warehouseId,
    invoiceNo: dto.invoiceNo,
    fyLabel: dto.fyLabel,
    originGstin: dto.originGstin,
    status: dto.status,
    supplyType: dto.supplyType,
    placeOfSupply: dto.placeOfSupply,
    subtotalPaise: dto.subtotalPaise,
    gstPaise: dto.gstPaise,
    totalPaise: dto.totalPaise,
    payablePaise: dto.payablePaise,
    roundOffPaise: dto.roundOffPaise,
    revision: dto.revision,
    gapKinds: status === 'issued' ? [] : [...new Set(awaitingGaps.map((gap) => gap.kind as string))],
    createdAt: dto.createdAt,
  };
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
    requests.push({ method, pathname, query: new URL(request.url).search, body, headers: Object.fromEntries(request.headers.entries()) });
    if (method === 'GET' && pathname.endsWith('/invoices')) {
      if (listFails) return json(500, { code: 'internal-error', title: 'List unavailable', status: 500 });
      const cursor = new URL(request.url).searchParams.get('cursor');
      return json(200, { items: [entry()], nextCursor: listPaged && cursor === null ? 'page-2' : null });
    }
    if (method === 'GET' && pathname.endsWith(`/invoices/${INVOICE_ID}`)) {
      const dto = invoiceDto();
      return json(200, { invoice: documentOverride === undefined ? dto : { ...dto, document: documentOverride } });
    }
    if (method === 'POST' && pathname.endsWith('/invoices')) {
      const answer = postAnswers.shift();
      if (answer !== undefined) {
        // A refusal whose server state moved on (invoice-frozen: it issued meanwhile).
        if (answer.thenStatus !== undefined) status = answer.thenStatus;
        return json(answer.status, { code: answer.code, title: 'Refused', status: answer.status });
      }
      status = 'issued';
      return json(200, { invoice: invoiceDto() });
    }
    if (method === 'GET' && pathname.endsWith(`/outbound/orders/${ORDER_ID}`)) {
      return json(200, {
        order: { id: ORDER_ID, lines: [{ id: LINE_UNPRICED, skuId: 'sku-1' }, { id: LINE_PRICED, skuId: 'sku-2' }] },
      });
    }
    if (method === 'GET' && pathname.endsWith('/catalog/skus')) {
      return json(200, {
        items: [
          { id: 'sku-1', code: 'SPICE-01', name: 'Turmeric', uom: 'kg', uomPrecision: 3, uomConversions: [] },
          { id: 'sku-2', code: 'SPICE-02', name: 'Chilli', uom: 'each', uomPrecision: 0, uomConversions: [] },
        ],
        nextCursor: null,
      });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  status = 'awaiting-data';
  postAnswers = [];
  listFails = false;
  listPaged = false;
  documentOverride = undefined;
  awaitingGaps = [{ kind: 'unpriced-line', detail: 'line SPICE-01 has no rate', orderLineId: LINE_UNPRICED }];
  stubRouter();
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mountAs(role: Parameters<typeof session>[0]): Promise<Rendered> {
  writeSession(session(role));
  const rendered = render(<Invoices />);
  await settle();
  return rendered;
}

function button(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === label);
}

async function open(container: HTMLElement): Promise<void> {
  act(() => button(container, 'View')!.click());
  await settle();
}

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit(form: HTMLFormElement): Promise<void> {
  act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
}

const posts = () => requests.filter((r) => r.method === 'POST');
const keyOf = (r: Recorded) => Object.entries(r.headers).find(([name]) => name.toLowerCase() === 'idempotency-key')?.[1];
const detailReads = () => requests.filter((r) => r.method === 'GET' && r.pathname.endsWith(`/invoices/${INVOICE_ID}`)).length;

describe('Invoices: reading (story 8-1)', () => {
  test('the list renders the row; an awaiting-data invoice prints as a DRAFT, never as a tax invoice', async () => {
    view = await mountAs('accountant');
    const row = view.container.querySelector('tbody tr')!;
    expect(row.textContent).toContain('Unnumbered');
    expect(row.textContent).toContain('Awaiting data');
    expect(row.textContent).toContain('₹210.00'); // the list shows the rounded PAYABLE (8-1b)
    expect(row.textContent).not.toContain('₹210.49');
    expect(row.textContent).toContain('Unpriced line');

    await open(view.container);
    const printable = view.container.querySelector('[data-print-root]')!;
    expect(printable.textContent).toContain('Draft — not a tax invoice');
    expect(printable.textContent).not.toContain('Tax invoice');
    expect(printable.textContent).toContain('Blocking — Unpriced line');
  });

  test('an issued invoice prints as a tax invoice with its number, at the unit precision', async () => {
    status = 'issued';
    view = await mountAs('accountant');
    await open(view.container);
    const printable = view.container.querySelector('[data-print-root]')!;
    expect(printable.textContent).toContain('Tax invoice');
    expect(printable.textContent).toContain('27/2627/000007');
    expect(printable.textContent).toContain('2 each'); // 2000 milli at 0 places
    expect(printable.textContent).toContain('₹210.00');
  });

  test('the list shows each issued number with its supplier GSTIN beside it (8-1b)', async () => {
    status = 'issued';
    view = await mountAs('accountant');
    const row = view.container.querySelector('tbody tr')!;
    expect(row.textContent).toContain('27/2627/000007');
    expect(row.textContent).toContain('GSTIN 27AAAPZ1234C1ZV');
  });

  test('the print carries Invoice total, a signed Round off and the Payable, in that order (8-1b)', async () => {
    status = 'issued';
    view = await mountAs('accountant');
    await open(view.container);
    const totals = [...view.container.querySelectorAll('[data-print-root] dl dt')].map((dt) => [
      dt.textContent,
      dt.nextElementSibling?.textContent,
    ]);
    expect(totals.slice(-3)).toEqual([
      ['Invoice total', '₹210.49'],
      ['Round off', '−₹0.49'],
      ['Payable', '₹210.00'],
    ]);
  });

  test('a role without invoice.generate reads everything and is offered NO mutating affordance', async () => {
    view = await mountAs('accountant');
    await open(view.container);
    expect(view.container.querySelector('[data-print-root]')).not.toBeNull();
    expect(view.container.textContent).not.toContain('Generate for a dispatched order');
    expect(button(view.container, 'Save prices and regenerate')).toBeUndefined();
    expect(button(view.container, 'Regenerate')).toBeUndefined();
    expect(view.container.querySelectorAll('input').length).toBe(0);
  });
});

describe('Invoices: pricing and generating (story 8-1)', () => {
  test('the panel offers exactly the server-named unpriced line, and Save POSTs its exact paise, then re-reads', async () => {
    view = await mountAs('ops_manager');
    await open(view.container);

    const rateInputs = [...view.container.querySelectorAll('input[aria-label^="Rate for"]')] as HTMLInputElement[];
    expect(rateInputs).toHaveLength(1); // the priced line is never offered
    expect(rateInputs[0]!.getAttribute('aria-label')).toBe('Rate for SPICE-01 — Turmeric');

    const listReadsBefore = requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/invoices')).length;
    setInput(rateInputs[0]!, '125.50');
    await submit(rateInputs[0]!.closest('form')!);

    expect(posts()).toHaveLength(1);
    const post = posts()[0]!;
    expect(post.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/invoices`);
    expect(post.body).toEqual({ orderId: ORDER_ID, rates: [{ orderLineId: LINE_UNPRICED, ratePaise: 12550 }] });
    // happy-dom keeps the header's original case — match the name case-insensitively.
    const key = Object.entries(post.headers).find(([name]) => name.toLowerCase() === 'idempotency-key')?.[1];
    expect(key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(view.container.textContent).toContain('Invoice issued');
    // The list re-read after the mutation (pessimistic — the server's row, not a patch).
    expect(requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/invoices')).length).toBeGreaterThan(listReadsBefore);
  });

  test('a malformed rupee entry sends nothing and names the line', async () => {
    view = await mountAs('owner');
    await open(view.container);
    const input = view.container.querySelector('input[aria-label^="Rate for"]') as HTMLInputElement;
    setInput(input, '1e3');
    await submit(input.closest('form')!);
    expect(posts()).toHaveLength(0);
    expect(view.container.textContent).toContain('SPICE-01 — Turmeric: Enter a rupee amount');
  });

  test('an ISSUED invoice is frozen: even a capable role is offered no pricing or Regenerate panel (8-1b)', async () => {
    status = 'issued';
    view = await mountAs('owner');
    await open(view.container);
    expect(view.container.querySelector('[data-print-root]')).not.toBeNull();
    expect(button(view.container, 'Regenerate')).toBeUndefined();
    expect(button(view.container, 'Save prices and regenerate')).toBeUndefined();
    expect(view.container.querySelector('input[aria-label^="Rate for"]')).toBeNull();
  });

  test('an awaiting invoice with nothing unpriced offers a plain Regenerate that sends NO rates', async () => {
    awaitingGaps = [{ kind: 'place-of-supply', detail: 'place of supply unresolvable' }];
    view = await mountAs('owner');
    await open(view.container);
    expect(view.container.querySelector('input[aria-label^="Rate for"]')).toBeNull();
    const regenerate = button(view.container, 'Regenerate')!;
    await submit(regenerate.closest('form')!);
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.body).toEqual({ orderId: ORDER_ID });
  });

  test('generate-for-order refuses a non-UUID locally and POSTs a valid one, lower-cased', async () => {
    view = await mountAs('owner');
    const input = view.container.querySelector('input[aria-label="Order id"]') as HTMLInputElement;
    setInput(input, 'not-an-id');
    await submit(input.closest('form')!);
    expect(posts()).toHaveLength(0);
    expect(view.container.textContent).toContain('An order id is a 36-character UUID');

    setInput(input, ` ${ORDER_ID.toUpperCase()} `);
    await submit(input.closest('form')!);
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.body).toEqual({ orderId: ORDER_ID });
  });
});

describe('Invoices: Rule 46 particulars on the printed invoice (story 8-1)', () => {
  test('the print carries per-tax rates, the state NAME, the total in words and a signatory line', async () => {
    status = 'issued';
    view = await mountAs('accountant');
    await open(view.container);
    const printable = view.container.querySelector('[data-print-root]')!;
    expect(printable.textContent).toContain('27 — Maharashtra');
    expect(printable.textContent).toContain('@ 2.5%'); // 5% intra → CGST and SGST at 2.5% each
    // The words are the PAYABLE's (₹210.00), not the exact total's ₹210.49.
    expect(printable.textContent).toContain('Indian Rupees Two Hundred Ten Only');
    expect(printable.textContent).not.toContain('Forty-Nine Paise');
    expect(printable.textContent).toContain('Authorised signatory');
    expect(printable.textContent).toContain('For Priya Spices');
  });
});

describe('Invoices: refusals, keys and recovery (story 8-1)', () => {
  test('an invoice-frozen refusal (it issued meanwhile) re-reads the invoice, drops the panel, and its banner SURVIVES (8-1b)', async () => {
    postAnswers = [{ status: 409, code: 'invoice-frozen', thenStatus: 'issued' }];
    view = await mountAs('owner');
    await open(view.container);
    const input = view.container.querySelector('input[aria-label^="Rate for"]') as HTMLInputElement;
    setInput(input, '125.50');
    const readsBefore = detailReads();
    await submit(input.closest('form')!);
    expect(posts()).toHaveLength(1);
    expect(detailReads()).toBeGreaterThan(readsBefore);
    // The re-read shows the invoice issued: the pricing panel is gone…
    expect(view.container.querySelector('[data-print-root]')!.textContent).toContain('Tax invoice');
    expect(view.container.querySelector('input[aria-label^="Rate for"]')).toBeNull();
    expect(button(view.container, 'Save prices and regenerate')).toBeUndefined();
    // …and the refusal banner, lifted to the section, is still on screen.
    expect(view.container.textContent).toContain('Not generated');
    expect(view.container.textContent).toContain('already issued and is frozen');
  });

  test('a pricing refusal banners beside the KEPT draft, and a stale-line refusal re-reads the invoice', async () => {
    postAnswers = [{ status: 409, code: 'line-already-priced' }];
    view = await mountAs('owner');
    await open(view.container);
    const input = view.container.querySelector('input[aria-label^="Rate for"]') as HTMLInputElement;
    setInput(input, '125.50');
    const readsBefore = detailReads();
    await submit(input.closest('form')!);

    expect(posts()).toHaveLength(1);
    expect(view.container.textContent).toContain('Not generated');
    expect(view.container.textContent).toContain('has been re-read');
    // The copy's claim is true: the invoice was re-read…
    expect(detailReads()).toBeGreaterThan(readsBefore);
    // …and the operator's draft survived it.
    expect((view.container.querySelector('input[aria-label^="Rate for"]') as HTMLInputElement).value).toBe('125.50');
  });

  test('the pricing draft keeps ONE key across a retry of the unchanged draft, and a new key after an edit', async () => {
    postAnswers = [{ status: 409, code: 'conflict' }, { status: 409, code: 'conflict' }];
    view = await mountAs('owner');
    await open(view.container);
    const input = () => view!.container.querySelector('input[aria-label^="Rate for"]') as HTMLInputElement;
    setInput(input(), '125.50');
    await submit(input().closest('form')!);
    await submit(input().closest('form')!); // retry, unchanged
    setInput(input(), '125.75'); // edit
    await submit(input().closest('form')!);

    expect(posts()).toHaveLength(3);
    expect(keyOf(posts()[1]!)).toBe(keyOf(posts()[0]!));
    expect(keyOf(posts()[2]!)).not.toBe(keyOf(posts()[0]!));
  });

  test('generate-for-order keeps its key across a retry and mints a new one after an edit; a refusal banners', async () => {
    postAnswers = [{ status: 409, code: 'order-not-dispatched' }, { status: 409, code: 'order-not-dispatched' }];
    view = await mountAs('owner');
    const input = view.container.querySelector('input[aria-label="Order id"]') as HTMLInputElement;
    setInput(input, ORDER_ID);
    await submit(input.closest('form')!);
    expect(view.container.textContent).toContain('not dispatched yet');
    await submit(input.closest('form')!);
    setInput(input, ORDER_ID.replace(/a$/, 'b'));
    await submit(input.closest('form')!);

    expect(posts()).toHaveLength(3);
    expect(keyOf(posts()[1]!)).toBe(keyOf(posts()[0]!));
    expect(keyOf(posts()[2]!)).not.toBe(keyOf(posts()[0]!));
  });

  test('a failed list read offers Retry, and Retry recovers', async () => {
    listFails = true;
    view = await mountAs('accountant');
    expect(view.container.textContent).toContain('Invoices unavailable');
    listFails = false;
    act(() => button(view!.container, 'Retry')!.click());
    await settle();
    expect(view.container.textContent).not.toContain('Invoices unavailable');
    expect(view.container.querySelector('tbody tr')!.textContent).toContain('Awaiting data');
  });

  test('a document in an unknown shape says so instead of printing a holed invoice', async () => {
    documentOverride = { header: {}, lines: 'nope' };
    view = await mountAs('accountant');
    await open(view.container);
    expect(view.container.textContent).toContain('Document unreadable');
    expect(view.container.querySelector('[data-print-root]')).toBeNull();
  });

  test('a generate returns the list to page one (Prev disabled, a first-page read)', async () => {
    listPaged = true;
    view = await mountAs('owner');
    act(() => button(view!.container, 'Next')!.click());
    await settle();
    expect(requests.some((r) => r.method === 'GET' && r.pathname.endsWith('/invoices') && r.query.includes('cursor=page-2'))).toBe(true);
    expect(button(view.container, 'Prev')!.disabled).toBe(false);

    const input = view.container.querySelector('input[aria-label="Order id"]') as HTMLInputElement;
    setInput(input, ORDER_ID);
    await submit(input.closest('form')!);
    const lastList = requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/invoices')).at(-1)!;
    expect(lastList.query).toBe('');
    expect(button(view.container, 'Prev')!.disabled).toBe(true);
  });

  test('the success banner survives the remount and belongs to its invoice — hiding the invoice hides it', async () => {
    view = await mountAs('owner');
    await open(view.container);
    const input = view.container.querySelector('input[aria-label^="Rate for"]') as HTMLInputElement;
    setInput(input, '125.50');
    await submit(input.closest('form')!);
    expect(view.container.textContent).toContain('Invoice issued');
    act(() => button(view!.container, 'Hide')!.click());
    await settle();
    expect(view.container.textContent).not.toContain('Invoice issued');
  });
});

