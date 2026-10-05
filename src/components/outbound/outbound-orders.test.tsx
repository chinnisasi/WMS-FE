import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { KIT_PARENT_HOLDS_LABEL } from '../../lib/outbound-orders';
import { OrderDetailPanel, OutboundOrders } from './outbound-orders';

/**
 * The order detail's kit parent/child rendering (story 11-6). The claims a
 * `src/lib` test cannot make:
 *   1. an exploded kit renders as its parent line with the component
 *      children nested beneath it — not as a flat line list,
 *   2. the parent's hold span reads "Kit — stock held on its components",
 *      never the misleading "Hold: No hold" its null reservation would
 *      otherwise render,
 *   3. a plain order renders exactly one top-level line, untouched.
 *
 * The panel is driven through a stubbed global `fetch` — the generated
 * client is a fetch wrapper — so the wiring under test is the one that ships.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';

const SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Priya Spices', gstin: null },
  user: { id: 'u-1', email: 'priya@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

let requests: { method: string; pathname: string }[] = [];
let order: Record<string, unknown> | null = null;
/** Story 8-1c: every order-create POST, with its JSON body and key. */
let creates: { body: Record<string, unknown>; key: string | null }[] = [];
/** The status the next create answers with — 201 unless a test fails it. */
let createStatus = 201;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sku(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'kit-sku',
    tenantId: TENANT_ID,
    code: 'KIT-01',
    name: 'Starter kit',
    uom: 'each',
    uomPrecision: 0,
    gstRateBps: 1800,
    hsn: null,
    batchTracked: false,
    serialTracked: false,
    catchWeightTracked: false,
    weightGrams: null,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    countryOfOrigin: null,
    reorderPoint: 0,
    reorderQty: 0,
    productId: null,
    variantValues: null,
    barcode: 'BC-KIT',
    uomConversions: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

function line(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'line-1',
    orderId: 'order-1',
    skuId: 'kit-sku',
    qty: 2,
    reservedQty: 0,
    shortfallQty: 0,
    status: 'open',
    reservationId: null,
    reservationState: null,
    parentLineId: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();
    requests.push({ method, pathname });
    if (method === 'POST' && pathname.endsWith(`/tenants/${TENANT_ID}/outbound/orders`)) {
      const body = (await request.json()) as Record<string, unknown>;
      creates.push({ body, key: request.headers.get('Idempotency-Key') });
      if (createStatus !== 201) {
        return json(createStatus, {
          code: 'reservation-store-unavailable',
          title: 'Reservation store unavailable',
          status: createStatus,
        });
      }
      const sent = body.lines as { skuId: string; quantity: number }[];
      return json(201, {
        order: {
          id: 'order-new',
          tenantId: TENANT_ID,
          warehouseId: 'wh-1',
          status: 'accepted',
          source: 'manual',
          integrationId: null,
          externalEventId: null,
          destination: body.destination,
          createdAt: '2026-10-03T00:00:00.000Z',
          updatedAt: '2026-10-03T00:00:00.000Z',
          lines: sent.map((l, i) =>
            line({ id: `new-${i}`, orderId: 'order-new', skuId: l.skuId, qty: l.quantity, reservedQty: l.quantity }),
          ),
        },
      });
    }
    if (method === 'GET' && /\/warehouses\/[^/]+\/outbound\/orders$/.test(pathname)) {
      return json(200, { items: [], nextCursor: null });
    }
    if (method === 'GET' && /\/outbound\/orders\/[^/]+$/.test(pathname)) {
      if (order === null) {
        return json(404, { code: 'not-found', title: 'No such order', status: 404 });
      }
      return json(200, { order });
    }
    if (method === 'GET' && pathname.endsWith('/catalog/skus')) {
      return json(200, {
        items: [
          sku(),
          sku({ id: 'pad-sku', code: 'PAD-01', name: 'Foam pad', barcode: 'BC-PAD' }),
          sku({ id: 'tape-sku', code: 'TAPE-01', name: 'Tape', uom: 'kg', uomPrecision: 3, barcode: 'BC-TAPE' }),
          sku({ id: 'glove-sku', code: 'GLOVE-01', name: 'Gloves', barcode: 'BC-GLOVE' }),
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
  creates = [];
  createStatus = 201;
  stubRouter();
  writeSession(SESSION);
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(orderId: string): Promise<Rendered> {
  const rendered = render(<OrderDetailPanel orderId={orderId} />);
  await settle();
  return rendered;
}

describe('OrderDetailPanel: kit parent/child rendering (story 11-6)', () => {
  test('an exploded kit renders as the parent line with its children nested beneath', async () => {
    order = {
      id: 'order-1',
      tenantId: TENANT_ID,
      warehouseId: 'wh-1',
      status: 'accepted',
      source: 'manual',
      integrationId: null,
      externalEventId: null,
      destination: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      lines: [
        line({
          id: 'line-parent',
          skuId: 'kit-sku',
          qty: 2,
          // A kit parent holds nothing — the reservation belongs to its children.
          reservedQty: 0,
          reservationId: null,
          reservationState: null,
          parentLineId: null,
        }),
        line({
          id: 'line-child-1',
          skuId: 'pad-sku',
          qty: 4,
          reservedQty: 4,
          reservationId: 'res-1',
          reservationState: 'held',
          parentLineId: 'line-parent',
        }),
        line({
          id: 'line-child-2',
          skuId: 'tape-sku',
          qty: 1.5,
          reservedQty: 1,
          shortfallQty: 0.5,
          status: 'backordered',
          reservationId: null,
          reservationState: null,
          parentLineId: 'line-parent',
        }),
        line({ id: 'line-plain', skuId: 'glove-sku', qty: 10, reservedQty: 10 }),
      ],
    };
    view = await mount('order-1');

    // Top-level items: the kit parent and the plain line — the children are
    // nested, not additional top-level rows.
    const topItems = [...view.container.querySelectorAll(':scope > div > ul > li')];
    expect(topItems).toHaveLength(2);
    const parent = topItems[0]!;
    expect(parent.textContent).toContain('KIT-01');
    expect(parent.textContent).toContain('PAD-01');
    expect(parent.textContent).toContain('TAPE-01');
    expect(topItems[1]!.textContent).toContain('GLOVE-01');
    expect(topItems[1]!.textContent).not.toContain('PAD-01');

    // The children hang from a nested list inside the parent's item.
    const nested = parent.querySelector('ul');
    expect(nested).not.toBeNull();
    const children = [...nested!.querySelectorAll(':scope > li')];
    expect(children).toHaveLength(2);
    expect(children[0]!.textContent).toContain('PAD-01');
    expect(children[1]!.textContent).toContain('TAPE-01');
    // The child glyph marks each nested line.
    expect(children.every((child) => child.querySelector('[aria-hidden]') !== null)).toBe(true);

    // The totals count TOP-LEVEL lines only — the kit's children share their
    // parent's quantity, so summing the flat list would double-count (12
    // ordered, not 17.5; 2 lines, not 4).
    const totals = view.container.querySelector(':scope > div > div')!.textContent;
    expect(totals).toContain('2 lines');
    expect(totals).toContain('12');
    expect(totals).not.toContain('17.5');
    expect(totals).not.toContain('4 lines');
  });

  test('the kit parent’s hold span reads the kit sentence, never "No hold"', async () => {
    order = {
      id: 'order-1',
      tenantId: TENANT_ID,
      warehouseId: 'wh-1',
      status: 'accepted',
      source: 'manual',
      integrationId: null,
      externalEventId: null,
      destination: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      lines: [
        line({ id: 'line-parent', skuId: 'kit-sku', qty: 2 }),
        line({
          id: 'line-child-1',
          skuId: 'pad-sku',
          qty: 4,
          reservedQty: 4,
          reservationId: 'res-1',
          reservationState: 'held',
          parentLineId: 'line-parent',
        }),
      ],
    };
    view = await mount('order-1');

    const parent = view.container.querySelector(':scope > div > ul > li')!;
    const spans = [...parent.querySelectorAll(':scope > div > span')].map((s) => s.textContent);
    expect(spans).toContain(KIT_PARENT_HOLDS_LABEL);
    expect(spans).not.toContain('Hold: No hold');
    // The child still renders its own hold.
    expect(parent.querySelector('ul')!.textContent).toContain('Hold: Held');
  });

  test('a dispatched order’s parent stops asserting live holds', async () => {
    order = {
      id: 'order-1',
      tenantId: TENANT_ID,
      warehouseId: 'wh-1',
      status: 'dispatched',
      source: 'manual',
      integrationId: null,
      externalEventId: null,
      destination: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      lines: [
        line({ id: 'line-parent', skuId: 'kit-sku', qty: 2, reservedQty: 0, reservationId: null, reservationState: null }),
        line({
          id: 'line-child-1',
          skuId: 'pad-sku',
          qty: 4,
          reservedQty: 4,
          reservationId: 'res-1',
          reservationState: 'held',
          parentLineId: 'line-parent',
        }),
      ],
    };
    view = await mount('order-1');

    const parent = view.container.querySelector(':scope > div > ul > li')!;
    const spans = [...parent.querySelectorAll(':scope > div > span')].map((s) => s.textContent);
    // The holds were retired at dispatch — the span must not claim stock is
    // held on the components.
    expect(spans).toContain('Kit — dispatched in its components; holds retired');
    expect(spans).not.toContain(KIT_PARENT_HOLDS_LABEL);
  });

  test('a backordered child keeps its chip and its shortfall in the nested line', async () => {
    order = {
      id: 'order-1',
      tenantId: TENANT_ID,
      warehouseId: 'wh-1',
      status: 'accepted',
      source: 'manual',
      integrationId: null,
      externalEventId: null,
      destination: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      lines: [
        line({ id: 'line-parent', skuId: 'kit-sku', qty: 2 }),
        line({
          id: 'line-child-1',
          skuId: 'tape-sku',
          qty: 1.5,
          reservedQty: 1,
          shortfallQty: 0.5,
          status: 'backordered',
          parentLineId: 'line-parent',
        }),
      ],
    };
    view = await mount('order-1');

    const child = view.container.querySelector('ul ul li')!;
    expect(child.textContent).toContain('Backordered');
    // The tape line names its own unit at its own precision.
    expect(child.textContent).toContain('1.500 kg ordered');
    expect(child.textContent).toContain('0.500 kg short');
  });

  test('a plain order renders exactly as before — one top-level line, hold label intact', async () => {
    order = {
      id: 'order-1',
      tenantId: TENANT_ID,
      warehouseId: 'wh-1',
      status: 'accepted',
      source: 'manual',
      integrationId: null,
      externalEventId: null,
      destination: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      lines: [line({ skuId: 'glove-sku', qty: 10, reservedQty: 10 })],
    };
    view = await mount('order-1');

    const items = [...view.container.querySelectorAll(':scope > div > ul > li')];
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain('GLOVE-01');
    expect(items[0]!.textContent).toContain('Hold: No hold');
    expect(items[0]!.textContent).not.toContain(KIT_PARENT_HOLDS_LABEL);
    expect(items[0]!.querySelector('ul')).toBeNull();
  });

  test('a failed order read renders inline on the panel with a Retry', async () => {
    order = null;
    view = await mount('order-1');

    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain('no longer exists');
    const retry = [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
    expect(retry).not.toBeNull();

    // Retry with the order restored refetches and renders.
    order = {
      id: 'order-1',
      tenantId: TENANT_ID,
      warehouseId: 'wh-1',
      status: 'accepted',
      source: 'manual',
      integrationId: null,
      externalEventId: null,
      destination: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      lines: [line({ skuId: 'glove-sku', qty: 10, reservedQty: 10 })],
    };
    act(() => retry!.click());
    await settle();
    expect(view.container.textContent).toContain('GLOVE-01');
  });
});
/* ------------------------------------------------------------------ */
/* Story 8-1c: the order form's rate and buyer-GSTIN inputs             */
/* ------------------------------------------------------------------ */

/**
 * The create form is reached by rendering the whole `OutboundOrders` surface
 * as an `orders.manage` role, through the same stubbed `fetch`, so the body
 * asserted is the one the shipped wrapper sends. Pins:
 *   1. a typed rate rides the line as exact `ratePaise`; a blank one sends no key,
 *   2. a typed buyer GSTIN rides as `consigneeGstin`; a blank one sends no key,
 *   3. a bad rate or GSTIN sends nothing,
 *   4. the per-draft key: reused across a retry of an unchanged draft, fresh
 *      after a rate (or buyer GSTIN) edit following a failed submit.
 */

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** The `<select>` twin: React reads a select's `change` event. */
function setSelect(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function labelled(container: HTMLElement, text: string): HTMLLabelElement[] {
  return [...container.querySelectorAll('label')].filter(
    (l) => l.querySelector('span')?.textContent === text,
  );
}

function input(container: HTMLElement, text: string, index = 0): HTMLInputElement {
  const found = labelled(container, text)[index];
  expect(found).toBeDefined();
  return found!.querySelector('input')!;
}

async function mountForm(): Promise<Rendered> {
  const rendered = render(
    <OutboundOrders tenantId={TENANT_ID} warehouseId="wh-1" warehouseLabel="BLR-01 Whitefield" role="owner" />,
  );
  await settle();
  return rendered;
}

function fillDestination(container: HTMLElement): void {
  setInput(input(container, 'Contact name'), 'Asha Rao');
  setInput(input(container, 'Phone'), '+91 98200 11111');
  setInput(input(container, 'Address line 1'), '4, Linking Road');
  setInput(input(container, 'City'), 'Mumbai');
  // Story 8-1d: State is a select over the official names.
  setSelect(labelled(container, 'State')[0]!.querySelector('select')!, 'Maharashtra');
  setInput(input(container, 'Pincode'), '400050');
}

function fillLine(container: HTMLElement, index: number, skuId: string, quantity: string, rate: string): void {
  setSelect(labelled(container, 'SKU')[index]!.querySelector('select')!, skuId);
  setInput(input(container, 'Quantity', index), quantity);
  setInput(input(container, 'Rate ₹ (optional)', index), rate);
}

function addLine(container: HTMLElement): void {
  const add = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Add line')!;
  act(() => add.click());
}

async function submitCreate(container: HTMLElement): Promise<void> {
  const form = labelled(container, 'Buyer GSTIN (optional, B2B)')[0]!.closest('form')!;
  act(() => void form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await settle();
}

describe('OrderCreateForm: rates and the buyer GSTIN (story 8-1c)', () => {
  test('a priced line sends exact paise, a blank rate sends no key, and the buyer GSTIN rides uppercased', async () => {
    view = await mountForm();
    fillDestination(view.container);
    fillLine(view.container, 0, 'glove-sku', '2', '125.50');
    addLine(view.container);
    fillLine(view.container, 1, 'pad-sku', '3', '');
    setInput(input(view.container, 'Buyer GSTIN (optional, B2B)'), ' 27aapcd1234k1z5 ');
    await submitCreate(view.container);

    expect(creates).toHaveLength(1);
    const lines = creates[0]!.body.lines as Record<string, unknown>[];
    expect(lines[0]).toEqual({ skuId: 'glove-sku', quantity: 2, ratePaise: 12550 });
    expect('ratePaise' in lines[1]!).toBe(false);
    expect(creates[0]!.body.consigneeGstin).toBe('27AAPCD1234K1Z5');
    // The outcome names the unpriced line, and the form resets.
    expect(view.container.querySelector('[role="status"]')!.textContent).toContain(
      '1 of 2 lines unpriced — the invoice will wait for pricing.',
    );
    expect(input(view.container, 'Buyer GSTIN (optional, B2B)').value).toBe('');
    expect(input(view.container, 'Rate ₹ (optional)').value).toBe('');
  });

  test('a blank buyer GSTIN sends no consigneeGstin key', async () => {
    view = await mountForm();
    fillDestination(view.container);
    fillLine(view.container, 0, 'glove-sku', '1', '10');
    setInput(input(view.container, 'Buyer GSTIN (optional, B2B)'), '   ');
    await submitCreate(view.container);

    expect(creates).toHaveLength(1);
    expect('consigneeGstin' in creates[0]!.body).toBe(false);
  });

  test('a bad rate or a malformed buyer GSTIN sends nothing and names the problem', async () => {
    view = await mountForm();
    fillDestination(view.container);
    fillLine(view.container, 0, 'glove-sku', '1', '0');
    await submitCreate(view.container);
    expect(creates).toHaveLength(0);
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain(
      'Line 1: ₹0 is not a rate — leave blank to price it on the invoice later.',
    );

    setInput(input(view.container, 'Rate ₹ (optional)'), '10');
    setInput(input(view.container, 'Buyer GSTIN (optional, B2B)'), '27ABC');
    await submitCreate(view.container);
    expect(creates).toHaveLength(0);
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain('Buyer GSTIN is 15 characters');
  });

  test('refusal order is lines → address → GSTIN: an incomplete address outranks a malformed GSTIN', async () => {
    view = await mountForm();
    fillLine(view.container, 0, 'glove-sku', '1', '10');
    setInput(input(view.container, 'Contact name'), 'Asha Rao');
    setInput(input(view.container, 'Buyer GSTIN (optional, B2B)'), '27ABC');
    await submitCreate(view.container);

    expect(creates).toHaveLength(0);
    const alert = view.container.querySelector('[role="alert"]')!.textContent;
    expect(alert).toContain('The destination needs');
    expect(alert).not.toContain('Buyer GSTIN');
  });

  test('a retry of an unchanged draft reuses the key; a rate edit after a failed submit mints a fresh one', async () => {
    createStatus = 503;
    view = await mountForm();
    fillDestination(view.container);
    fillLine(view.container, 0, 'glove-sku', '1', '10');
    await submitCreate(view.container);
    await submitCreate(view.container);
    expect(creates).toHaveLength(2);
    expect(creates[0]!.key).not.toBeNull();
    expect(creates[1]!.key).toBe(creates[0]!.key);

    setInput(input(view.container, 'Rate ₹ (optional)'), '12');
    await submitCreate(view.container);
    expect(creates).toHaveLength(3);
    expect((creates[2]!.body.lines as Record<string, unknown>[])[0]!.ratePaise).toBe(1200);
    expect(creates[2]!.key).not.toBe(creates[1]!.key);

    // The buyer GSTIN is in the request hash too.
    setInput(input(view.container, 'Buyer GSTIN (optional, B2B)'), '27AAPCD1234K1Z5');
    await submitCreate(view.container);
    expect(creates).toHaveLength(4);
    expect(creates[3]!.key).not.toBe(creates[2]!.key);
  });

  test('the rate inputs carry the permanence copy; the GSTIN input has no pattern', async () => {
    view = await mountForm();
    const gstin = input(view.container, 'Buyer GSTIN (optional, B2B)');
    expect(gstin.hasAttribute('pattern')).toBe(false);
    expect(gstin.maxLength).toBe(20);
    expect(gstin.getAttribute('autocapitalize')).toBe('characters');
    expect(gstin.getAttribute('spellcheck')).toBe('false');
    const gstinHelp = view.container.querySelector(`#${CSS.escape(gstin.getAttribute('aria-describedby')!)}`);
    expect(gstinHelp!.textContent).toBe("Can't be changed after creation yet.");
    const rate = input(view.container, 'Rate ₹ (optional)');
    const help = view.container.querySelector(`#${CSS.escape(rate.getAttribute('aria-describedby')!)}`);
    expect(help!.textContent).toContain("Once set it can't be changed");
  });
});

/* ------------------------------------------------------------------ */
/* Story 8-1d: the State select and the buyer legal name               */
/* ------------------------------------------------------------------ */

describe('OrderCreateForm: the State select and the buyer legal name (story 8-1d)', () => {
  const LEGAL = 'Buyer legal name (optional)';

  test('State is a select over the official names; the chosen name is the destination state', async () => {
    view = await mountForm();
    const select = labelled(view.container, 'State')[0]!.querySelector('select')!;
    expect(select).not.toBeNull();
    expect(select.required).toBe(true);
    expect(select.options[0]!.value).toBe('');
    expect([...select.options].map((o) => o.value)).not.toContain('Other Country');
    fillDestination(view.container);
    fillLine(view.container, 0, 'glove-sku', '1', '10');
    await submitCreate(view.container);
    expect((creates[0]!.body.destination as { state: string }).state).toBe('Maharashtra');
  });

  test('the legal name is offered only once a buyer GSTIN is typed; no maxLength (the parser counts code points)', async () => {
    view = await mountForm();
    expect(labelled(view.container, LEGAL)).toHaveLength(0);
    setInput(input(view.container, 'Buyer GSTIN (optional, B2B)'), '   ');
    expect(labelled(view.container, LEGAL)).toHaveLength(0);
    setInput(input(view.container, 'Buyer GSTIN (optional, B2B)'), '27AAPCD1234K1Z5');
    expect(labelled(view.container, LEGAL)).toHaveLength(1);
    expect(input(view.container, LEGAL).hasAttribute('maxlength')).toBe(false);
  });

  test('a typed legal name rides beside the GSTIN, trimmed; the form resets it on success', async () => {
    view = await mountForm();
    fillDestination(view.container);
    fillLine(view.container, 0, 'glove-sku', '1', '10');
    setInput(input(view.container, 'Buyer GSTIN (optional, B2B)'), '27AAPCD1234K1Z5');
    setInput(input(view.container, LEGAL), '  Mysore Spices Pvt Ltd ');
    await submitCreate(view.container);

    expect(creates).toHaveLength(1);
    expect(creates[0]!.body.consigneeGstin).toBe('27AAPCD1234K1Z5');
    expect(creates[0]!.body.consigneeLegalName).toBe('Mysore Spices Pvt Ltd');
    // Reset: the GSTIN clears (so the input hides) and, once a GSTIN is typed again, the name is empty.
    expect(labelled(view.container, LEGAL)).toHaveLength(0);
    setInput(input(view.container, 'Buyer GSTIN (optional, B2B)'), '27AAPCD1234K1Z5');
    expect(input(view.container, LEGAL).value).toBe('');
  });

  test('clearing the GSTIN keeps the typed name but does not send it; a blank name sends no key', async () => {
    view = await mountForm();
    fillDestination(view.container);
    fillLine(view.container, 0, 'glove-sku', '1', '10');
    setInput(input(view.container, 'Buyer GSTIN (optional, B2B)'), '27AAPCD1234K1Z5');
    setInput(input(view.container, LEGAL), 'Mysore Spices Pvt Ltd');
    setInput(input(view.container, 'Buyer GSTIN (optional, B2B)'), '');
    expect(labelled(view.container, LEGAL)).toHaveLength(0);
    await submitCreate(view.container);
    expect(creates).toHaveLength(1);
    expect('consigneeGstin' in creates[0]!.body).toBe(false);
    expect('consigneeLegalName' in creates[0]!.body).toBe(false);

    // A blank name beside a GSTIN: no key at all.
    view.unmount();
    view = await mountForm();
    fillDestination(view.container);
    fillLine(view.container, 0, 'glove-sku', '1', '10');
    setInput(input(view.container, 'Buyer GSTIN (optional, B2B)'), '27AAPCD1234K1Z5');
    setInput(input(view.container, LEGAL), '   ');
    await submitCreate(view.container);
    expect('consigneeLegalName' in creates[1]!.body).toBe(false);
  });

  test('a GSTIN-kept name returns when the GSTIN is typed again (kept, not discarded)', async () => {
    view = await mountForm();
    setInput(input(view.container, 'Buyer GSTIN (optional, B2B)'), '27AAPCD1234K1Z5');
    setInput(input(view.container, LEGAL), 'Mysore Spices Pvt Ltd');
    setInput(input(view.container, 'Buyer GSTIN (optional, B2B)'), '');
    setInput(input(view.container, 'Buyer GSTIN (optional, B2B)'), '27AAPCD1234K1Z5');
    expect(input(view.container, LEGAL).value).toBe('Mysore Spices Pvt Ltd');
  });

  test('a legal-name edit after a failed submit mints a fresh key (it is in the request hash)', async () => {
    createStatus = 503;
    view = await mountForm();
    fillDestination(view.container);
    fillLine(view.container, 0, 'glove-sku', '1', '10');
    setInput(input(view.container, 'Buyer GSTIN (optional, B2B)'), '27AAPCD1234K1Z5');
    setInput(input(view.container, LEGAL), 'Mysore Spices');
    await submitCreate(view.container);
    await submitCreate(view.container);
    expect(creates[1]!.key).toBe(creates[0]!.key);
    setInput(input(view.container, LEGAL), 'Mysore Spices Pvt Ltd');
    await submitCreate(view.container);
    expect(creates).toHaveLength(3);
    expect(creates[2]!.body.consigneeLegalName).toBe('Mysore Spices Pvt Ltd');
    expect(creates[2]!.key).not.toBe(creates[1]!.key);
  });

  test('a buyer GSTIN whose prefix is not a GST state code sends nothing', async () => {
    view = await mountForm();
    fillDestination(view.container);
    fillLine(view.container, 0, 'glove-sku', '1', '10');
    setInput(input(view.container, 'Buyer GSTIN (optional, B2B)'), '99AAPCD1234K1Z5');
    await submitCreate(view.container);
    expect(creates).toHaveLength(0);
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain('Buyer GSTIN begins "99"');
  });

  test('the 100 cap counts code points after the trim: 101 astral characters are refused inline, 100 padded ones are sent', async () => {
    const astral = '𝐀';
    view = await mountForm();
    fillDestination(view.container);
    fillLine(view.container, 0, 'glove-sku', '1', '10');
    setInput(input(view.container, 'Buyer GSTIN (optional, B2B)'), '27AAPCD1234K1Z5');
    setInput(input(view.container, LEGAL), `A${astral.repeat(100)}`);
    await submitCreate(view.container);
    expect(creates).toHaveLength(0);
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain('Buyer legal name is at most 100 characters (got 101)');

    // 100 code points = 199 UTF-16 units, plus padding: a maxLength of 100 would have cut it.
    setInput(input(view.container, LEGAL), `  A${astral.repeat(99)}  `);
    await submitCreate(view.container);
    expect(creates).toHaveLength(1);
    expect(creates[0]!.body.consigneeLegalName).toBe(`A${astral.repeat(99)}`);
  });

  test('a buyer GSTIN from another state than the ship-to warns inline — never blocking', async () => {
    view = await mountForm();
    fillDestination(view.container); // Maharashtra
    fillLine(view.container, 0, 'glove-sku', '1', '10');
    expect(view.container.querySelector('[data-testid="buyer-state-mismatch"]')).toBeNull();
    setInput(input(view.container, 'Buyer GSTIN (optional, B2B)'), '27AAPCD1234K1Z5');
    expect(view.container.querySelector('[data-testid="buyer-state-mismatch"]')).toBeNull();
    setInput(input(view.container, 'Buyer GSTIN (optional, B2B)'), '29AAPCD1234K1Z5');
    const warning = view.container.querySelector('[data-testid="buyer-state-mismatch"]')!;
    expect(warning.textContent).toContain('registered in Karnataka');
    expect(warning.textContent).toContain('ship-to state is Maharashtra');
    expect(input(view.container, 'Buyer GSTIN (optional, B2B)').getAttribute('aria-describedby')).toContain(warning.id);
    await submitCreate(view.container);
    expect(creates).toHaveLength(1);
    expect(creates[0]!.body.consigneeGstin).toBe('29AAPCD1234K1Z5');
  });
});
