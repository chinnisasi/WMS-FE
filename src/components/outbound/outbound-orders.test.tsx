import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { writeActiveClientId } from '../../lib/active-client';
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
/** Story 1-1: the tenant's clients (null → the read 404s, the degraded arm). */
let clientsBody: Record<string, unknown>[] | null = null;
/** Story 1-1: the catalog, when a test needs SKUs with clients. */
let skusBody: Record<string, unknown>[] | null = null;
/** Story 1-5a: every order-list GET, with its query. */
let listUrls: URL[] = [];
/** Story 1-5a: the order list's answer per request (default: an empty page). */
let ordersResponder: ((url: URL) => { items: Record<string, unknown>[]; nextCursor: string | null }) | null = null;
/** Story 1-5a: the client the create answers with (absent by default). */
let createdClientId: string | undefined;

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
          // Story 4-1b — echoed as the server stores it (trimmed by the form already).
          clientOrderRef: (body.clientOrderRef as string | undefined) ?? null,
          destination: body.destination,
          ...(createdClientId === undefined ? {} : { clientId: createdClientId }),
          createdAt: '2026-10-03T00:00:00.000Z',
          updatedAt: '2026-10-03T00:00:00.000Z',
          lines: sent.map((l, i) =>
            line({ id: `new-${i}`, orderId: 'order-new', skuId: l.skuId, qty: l.quantity, reservedQty: l.quantity }),
          ),
        },
      });
    }
    if (method === 'GET' && /\/warehouses\/[^/]+\/outbound\/orders$/.test(pathname)) {
      listUrls.push(url);
      return json(200, ordersResponder === null ? { items: [], nextCursor: null } : ordersResponder(url));
    }
    if (method === 'GET' && /\/outbound\/orders\/[^/]+$/.test(pathname)) {
      if (order === null) {
        return json(404, { code: 'not-found', title: 'No such order', status: 404 });
      }
      return json(200, { order });
    }
    if (method === 'GET' && pathname.endsWith(`/tenants/${TENANT_ID}/clients`) && clientsBody !== null) {
      return json(200, { items: clientsBody });
    }
    if (method === 'GET' && pathname.endsWith('/catalog/skus') && skusBody !== null) {
      return json(200, { items: skusBody, nextCursor: null });
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
  clientsBody = null;
  skusBody = null;
  listUrls = [];
  ordersResponder = null;
  createdClientId = undefined;
  stubRouter();
  writeSession(SESSION);
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  try {
    localStorage.clear();
  } catch {
    // no storage to clear
  }
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

  test('story 1-6a: handling badges sit on the SKU actually handled — each kit child and plain line, never the kit parent', async () => {
    skusBody = [
      sku({ fragile: true }),
      sku({ id: 'pad-sku', code: 'PAD-01', name: 'Foam pad', barcode: 'BC-PAD', fragile: true, maxStackLayers: 1 }),
      sku({ id: 'tape-sku', code: 'TAPE-01', name: 'Tape', uom: 'kg', uomPrecision: 3, barcode: 'BC-TAPE' }),
      sku({ id: 'glove-sku', code: 'GLOVE-01', name: 'Gloves', barcode: 'BC-GLOVE', highValue: true }),
    ];
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
        line({ id: 'line-parent', skuId: 'kit-sku', qty: 2, reservedQty: 0, reservationId: null, reservationState: null, parentLineId: null }),
        line({ id: 'line-child-1', skuId: 'pad-sku', qty: 4, reservedQty: 4, parentLineId: 'line-parent' }),
        line({ id: 'line-child-2', skuId: 'tape-sku', qty: 1.5, reservedQty: 1.5, parentLineId: 'line-parent' }),
        line({ id: 'line-plain', skuId: 'glove-sku', qty: 10, reservedQty: 10 }),
      ],
    };
    view = await mount('order-1');
    const topItems = [...view.container.querySelectorAll(':scope > div > ul > li')];
    const parentRow = topItems[0]!.querySelector(':scope > div')!;
    expect(parentRow.querySelector('[data-handling-badge]')).toBeNull();
    const children = [...topItems[0]!.querySelectorAll('ul > li')];
    const badgesOf = (el: Element) => [...el.querySelectorAll('[data-handling-badge]')].map((b) => b.textContent);
    expect(badgesOf(children[0]!)).toEqual(['Fragile', 'Do not stack']);
    expect(badgesOf(children[1]!)).toEqual([]);
    expect(badgesOf(topItems[1]!)).toEqual(['High value']);
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

describe('OrderDetailPanel: "View ledger" (story 9-3a)', () => {
  const ORDER_ID = '0198f7a2-1b3c-7d4e-8f90-00000000e001';
  const WAREHOUSE = '0198f7a2-1b3c-7d4e-8f90-99aabbccdd02';

  function plainOrder() {
    return {
      id: ORDER_ID,
      tenantId: TENANT_ID,
      warehouseId: WAREHOUSE,
      status: 'dispatched',
      source: 'manual',
      integrationId: null,
      externalEventId: null,
      destination: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      lines: [line({ id: 'line-1', skuId: 'pad-sku', qty: 1, parentLineId: null })],
    };
  }

  test('threaded the warehouse (from OrdersTable), it links the order\'s events in that warehouse, labelled by the order label (story 4-1b: no number, no channel ref — the id\'s last 8 characters)', async () => {
    order = plainOrder();
    view = render(<OrderDetailPanel orderId={ORDER_ID} warehouseId={WAREHOUSE} />);
    await settle();
    const link = [...view.container.querySelectorAll('a')].find((a) => a.textContent === 'View ledger');
    expect(link).toBeDefined();
    expect(Object.fromEntries(new URL(`http://x${link!.getAttribute('href')!}`).searchParams)).toEqual({
      list: 'ledger',
      warehouseId: WAREHOUSE,
      doc: 'order',
      orderId: ORDER_ID,
      // Story 4-1b — the order label rule (was the full id): its short form here.
      label: '0000e001',
    });
  });

  test('story 4-1b: an order with a client number is labelled by it — the detail header and the ledger link', async () => {
    order = { ...plainOrder(), clientOrderRef: 'SO-1042', externalEventId: 'AMZ-9' };
    view = render(<OrderDetailPanel orderId={ORDER_ID} warehouseId={WAREHOUSE} />);
    await settle();
    expect(view.container.querySelector('[data-testid="order-detail-header"]')!.textContent).toBe(`SO-1042${ORDER_ID}`);
    const link = [...view.container.querySelectorAll('a')].find((a) => a.textContent === 'View ledger');
    expect(new URL(`http://x${link!.getAttribute('href')!}`).searchParams.get('label')).toBe('SO-1042');
  });

  test('an ingested order is labelled by its channel ref', async () => {
    order = { ...plainOrder(), source: 'ingested', externalEventId: 'AMZ-401-7712' };
    view = render(<OrderDetailPanel orderId={ORDER_ID} warehouseId={WAREHOUSE} />);
    await settle();
    const link = [...view.container.querySelectorAll('a')].find((a) => a.textContent === 'View ledger');
    expect(new URL(`http://x${link!.getAttribute('href')!}`).searchParams.get('label')).toBe('AMZ-401-7712');
  });

  test('without a warehouse it offers no link', async () => {
    order = plainOrder();
    view = await mount(ORDER_ID);
    expect([...view.container.querySelectorAll('a')].some((a) => a.textContent === 'View ledger')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Story 1-1: order entry is client-first                               */
/* ------------------------------------------------------------------ */

function clientRow(id: string, code: string, name: string, systemOwned = false): Record<string, unknown> {
  return {
    id,
    tenantId: TENANT_ID,
    code,
    name,
    status: 'active',
    systemOwned,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    taxDetails: {},
  };
}

const SELF_CLIENT = clientRow('c-self', 'self', 'Priya Spices', true);
const ACME_CLIENT = clientRow('c-acme', 'ACME', 'Acme Foods');

function skuOptions(container: HTMLElement, index = 0): { value: string; text: string; disabled: boolean }[] {
  const select = labelled(container, 'SKU')[index]!.querySelector('select')!;
  return [...select.querySelectorAll('option')].map((o) => ({ value: o.value, text: o.textContent ?? '', disabled: o.disabled }));
}

function clientSelect(container: HTMLElement): HTMLSelectElement | null {
  return labelled(container, 'Client')[0]?.querySelector('select') ?? null;
}

describe('OrderCreateForm: client first (story 1-1)', () => {
  beforeEach(() => {
    clientsBody = [SELF_CLIENT, ACME_CLIENT];
    // Both clients own TSHIRT-M.
    skusBody = [
      sku({ id: 'self-tshirt', code: 'TSHIRT-M', name: 'Own tee', clientId: 'c-self', barcode: 'BC-1' }),
      sku({ id: 'acme-tshirt', code: 'TSHIRT-M', name: 'Acme tee', clientId: 'c-acme', barcode: 'BC-1' }),
      sku({ id: 'acme-cap', code: 'CAP', name: 'Acme cap', clientId: 'c-acme', barcode: 'BC-2' }),
    ];
  });

  test('a required Client select comes first; until one is picked the lines offer nothing but "Pick a client first"', async () => {
    view = await mountForm();
    const select = clientSelect(view.container)!;
    expect(select).not.toBeNull();
    expect(select.required).toBe(true);
    // Before the Ship-to fieldset and the lines.
    const form = select.closest('form')!;
    const order = [...form.querySelectorAll('select')];
    expect(order.indexOf(select)).toBe(0);
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Choose a client…',
      'Priya Spices (your company)',
      'ACME — Acme Foods',
    ]);
    expect(skuOptions(view.container)).toEqual([{ value: '', text: 'Pick a client first', disabled: true }]);

    setSelect(select, 'c-acme');
    expect(skuOptions(view.container).map((o) => o.value)).toEqual(['', 'acme-cap', 'acme-tshirt']);
    expect(skuOptions(view.container)[0]!.text).toBe('Pick a SKU…');
  });

  test('the order sends no clientId — the server derives it from the lines', async () => {
    view = await mountForm();
    setSelect(clientSelect(view.container)!, 'c-acme');
    fillDestination(view.container);
    fillLine(view.container, 0, 'acme-tshirt', '2', '');
    await submitCreate(view.container);
    expect(creates).toHaveLength(1);
    expect('clientId' in creates[0]!.body).toBe(false);
    expect(creates[0]!.body.lines).toEqual([{ skuId: 'acme-tshirt', quantity: 2 }]);
  });

  test('a submit with no client sends nothing and names the problem', async () => {
    view = await mountForm();
    fillDestination(view.container);
    await submitCreate(view.container);
    expect(creates).toHaveLength(0);
    expect(view.container.textContent).toContain('Choose the client this order is for.');
  });

  test('changing the client with lines picked asks first; Keep keeps them, Change clears them', async () => {
    view = await mountForm();
    setSelect(clientSelect(view.container)!, 'c-acme');
    fillLine(view.container, 0, 'acme-tshirt', '2', '');
    addLine(view.container);
    fillLine(view.container, 1, 'acme-cap', '1', '');

    setSelect(clientSelect(view.container)!, 'c-self');
    const confirm = view.container.querySelector('[data-testid="order-client-confirm"]')!;
    expect(confirm.textContent).toContain(
      "Change the client to Priya Spices (your company)? This clears the 2 lines already picked — they are another client's SKUs.",
    );
    // Nothing cleared while the question stands.
    expect(labelled(view.container, 'SKU')).toHaveLength(2);

    const keep = [...confirm.querySelectorAll('button')].find((b) => b.textContent === 'Keep ACME — Acme Foods')!;
    act(() => keep.click());
    expect(view.container.querySelector('[data-testid="order-client-confirm"]')).toBeNull();
    expect(clientSelect(view.container)!.value).toBe('c-acme');
    expect(labelled(view.container, 'SKU')).toHaveLength(2);

    setSelect(clientSelect(view.container)!, 'c-self');
    const change = [...view.container.querySelectorAll('[data-testid="order-client-confirm"] button')].find(
      (b) => b.textContent === 'Change client',
    ) as HTMLButtonElement;
    act(() => change.click());
    expect(clientSelect(view.container)!.value).toBe('c-self');
    // The old client's lines are gone; one blank line offers the new client's SKUs.
    expect(labelled(view.container, 'SKU')).toHaveLength(1);
    expect(skuOptions(view.container).map((o) => o.value)).toEqual(['', 'self-tshirt']);
  });

  // Story 1-2a decision 5 changed this pin: a SUSPENDED client still ships
  // (suspension cuts only the portal) — only a departed one is left out.
  test('a suspended client is offered; a departed one is not (decision 5)', async () => {
    clientsBody = [
      SELF_CLIENT,
      ACME_CLIENT,
      { ...clientRow('c-sus', 'SUS', 'Suspended Co'), status: 'suspended' },
      { ...clientRow('c-gone', 'GONE', 'Departed Co'), status: 'departed' },
    ];
    view = await mountForm();
    expect([...clientSelect(view.container)!.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Choose a client…',
      'Priya Spices (your company)',
      'ACME — Acme Foods',
      'SUS — Suspended Co',
    ]);
  });

  test('one working client among departed ones: no Client select, only its SKUs offered', async () => {
    clientsBody = [SELF_CLIENT, { ...ACME_CLIENT, status: 'departed' }];
    view = await mountForm();
    expect(clientSelect(view.container)).toBeNull();
    expect(skuOptions(view.container).map((o) => o.value)).toEqual(['', 'self-tshirt']);
    expect(skuOptions(view.container)[0]!.text).toBe('Pick a SKU…');
  });

  test('one client: no Client select, every SKU offered — nothing changes', async () => {
    clientsBody = [SELF_CLIENT];
    view = await mountForm();
    expect(clientSelect(view.container)).toBeNull();
    expect(skuOptions(view.container).map((o) => o.value)).toEqual(['', 'acme-cap', 'self-tshirt', 'acme-tshirt']);
    expect(skuOptions(view.container)[0]!.text).toBe('Pick a SKU…');
    expect(view.container.querySelector('[data-testid="order-clients-note"]')).toBeNull();
  });

  test('a failed clients read offers every SKU and says so, with a Retry', async () => {
    clientsBody = null;
    view = await mountForm();
    expect(clientSelect(view.container)).toBeNull();
    expect(view.container.querySelector('[data-testid="order-clients-note"]')!.textContent).toContain(
      'Clients not loaded — every SKU is offered',
    );
    expect(skuOptions(view.container)).toHaveLength(4);
  });
});

/* ------------------------------------------------------------------ */
/* Story 1-5a: the client filter on the orders list and the create form */
/* ------------------------------------------------------------------ */

function entry(id: string, clientId: string): Record<string, unknown> {
  return {
    id,
    tenantId: TENANT_ID,
    warehouseId: 'wh-1',
    status: 'accepted',
    source: 'manual',
    integrationId: null,
    externalEventId: null,
    destination: null,
    clientId,
    createdAt: '2026-10-03T00:00:00.000Z',
    updatedAt: '2026-10-03T00:00:00.000Z',
  };
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement;
}

function chip(container: HTMLElement): string | null {
  return container.querySelector('[data-testid="client-filter-chip"]')?.textContent ?? null;
}

describe('Orders list: the client filter (story 1-5a)', () => {
  beforeEach(() => {
    clientsBody = [SELF_CLIENT, ACME_CLIENT];
    // Page 1 / page 2 under all clients; ACME's own page under the filter.
    ordersResponder = (url) => {
      if (url.searchParams.get('clientId') === 'c-acme') return { items: [entry('acme-1', 'c-acme')], nextCursor: null };
      if (url.searchParams.get('cursor') === 'p2') return { items: [entry('self-3', 'c-self')], nextCursor: null };
      return { items: [entry('self-1', 'c-self'), entry('self-2', 'c-self')], nextCursor: 'p2' };
    };
  });

  test('under a stored client the list request carries clientId and the chip names the client', async () => {
    writeActiveClientId(TENANT_ID, 'u-1', 'c-acme');
    view = await mountForm();
    expect(listUrls.length).toBeGreaterThan(0);
    expect(listUrls.every((url) => url.searchParams.get('clientId') === 'c-acme')).toBe(true);
    expect(chip(view.container)).toContain('Client: ACME — Acme Foods');
    expect(view.container.textContent).toContain('acme-1');
    expect(view.container.textContent).not.toContain('self-1');
  });

  test('a switch restarts from page 1: no cursor, Prev disabled, the old rows gone; back to All sends no clientId', async () => {
    view = await mountForm();
    expect(chip(view.container)).toBeNull();
    act(() => button(view!.container, 'Next').click());
    await settle();
    expect(listUrls.at(-1)!.searchParams.get('cursor')).toBe('p2');
    expect(view.container.textContent).toContain('self-3');
    expect(button(view.container, 'Prev').disabled).toBe(false);

    act(() => writeActiveClientId(TENANT_ID, 'u-1', 'c-acme'));
    await settle();
    const switched = listUrls.at(-1)!;
    expect(switched.searchParams.get('clientId')).toBe('c-acme');
    expect(switched.searchParams.has('cursor')).toBe(false);
    expect(button(view.container, 'Prev').disabled).toBe(true);
    expect(view.container.textContent).toContain('acme-1');
    expect(view.container.textContent).not.toContain('self-3');
    expect(chip(view.container)).toContain('Client: ACME — Acme Foods');

    act(() => button(view!.container, 'Show all clients').click());
    await settle();
    expect(listUrls.at(-1)!.searchParams.has('clientId')).toBe(false);
    expect(chip(view.container)).toBeNull();
  });

  test('back to All after a switch restarts from page 1 too (A → B → A)', async () => {
    view = await mountForm();
    act(() => button(view!.container, 'Next').click());
    await settle();
    act(() => writeActiveClientId(TENANT_ID, 'u-1', 'c-acme'));
    await settle();
    act(() => button(view!.container, 'Show all clients').click());
    await settle();
    expect(listUrls.at(-1)!.searchParams.has('cursor')).toBe(false);
    expect(view.container.textContent).toContain('self-1');
  });

  test('while the clients load, a stored client sends no list request', async () => {
    writeActiveClientId(TENANT_ID, 'u-1', 'c-acme');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inner = globalThis.fetch;
    stubGlobal('fetch', (async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input.toString());
      if (new URL(request.url).pathname.endsWith(`/tenants/${TENANT_ID}/clients`)) await gate;
      return inner(request);
    }) as unknown as typeof fetch);
    view = render(
      <OutboundOrders tenantId={TENANT_ID} warehouseId="wh-1" warehouseLabel="BLR-01 Whitefield" role="owner" />,
    );
    await settle();
    expect(listUrls).toHaveLength(0);
    release();
    await settle();
    expect(listUrls.length).toBeGreaterThan(0);
    expect(listUrls.every((url) => url.searchParams.get('clientId') === 'c-acme')).toBe(true);
  });

  test('a failed clients read lists all clients and keeps the stored pick', async () => {
    clientsBody = null;
    writeActiveClientId(TENANT_ID, 'u-1', 'c-acme');
    view = await mountForm();
    expect(listUrls.length).toBeGreaterThan(0);
    expect(listUrls.every((url) => !url.searchParams.has('clientId'))).toBe(true);
    expect(chip(view.container)).toBeNull();
    expect(localStorage.getItem(`wms-active-client:${TENANT_ID}:u-1`)).toBe('c-acme');
  });

  test('a stored client absent from the loaded list is ignored, never erased', async () => {
    writeActiveClientId(TENANT_ID, 'u-1', 'c-gone');
    view = await mountForm();
    expect(listUrls.every((url) => !url.searchParams.has('clientId'))).toBe(true);
    expect(localStorage.getItem(`wms-active-client:${TENANT_ID}:u-1`)).toBe('c-gone');
  });

  test('a single-client tenant: no chip and no clientId even with a stored id', async () => {
    clientsBody = [SELF_CLIENT];
    writeActiveClientId(TENANT_ID, 'u-1', 'c-self');
    view = await mountForm();
    expect(listUrls.every((url) => !url.searchParams.has('clientId'))).toBe(true);
    expect(chip(view.container)).toBeNull();
  });
});

describe('OrderCreateForm: defaults to the active client (story 1-5a)', () => {
  beforeEach(() => {
    clientsBody = [SELF_CLIENT, ACME_CLIENT];
    skusBody = [
      sku({ id: 'self-tshirt', code: 'TSHIRT-M', name: 'Own tee', clientId: 'c-self', barcode: 'BC-1' }),
      sku({ id: 'acme-tshirt', code: 'TSHIRT-M', name: 'Acme tee', clientId: 'c-acme', barcode: 'BC-1' }),
    ];
  });

  test('the Client select starts on the active client; a create for another client says it is hidden', async () => {
    writeActiveClientId(TENANT_ID, 'u-1', 'c-acme');
    view = await mountForm();
    expect(clientSelect(view.container)!.value).toBe('c-acme');
    expect(skuOptions(view.container).map((o) => o.value)).toEqual(['', 'acme-tshirt']);

    setSelect(clientSelect(view.container)!, 'c-self');
    fillDestination(view.container);
    fillLine(view.container, 0, 'self-tshirt', '1', '');
    createdClientId = 'c-self';
    await submitCreate(view.container);
    expect(creates).toHaveLength(1);
    expect(view.container.querySelector('[data-testid="hidden-by-client-filter"]')!.textContent).toBe(
      'Created for Priya Spices (your company) — hidden by the client filter',
    );
  });

  test('a create for the active client shows no hidden note', async () => {
    writeActiveClientId(TENANT_ID, 'u-1', 'c-acme');
    view = await mountForm();
    fillDestination(view.container);
    fillLine(view.container, 0, 'acme-tshirt', '1', '');
    createdClientId = 'c-acme';
    await submitCreate(view.container);
    expect(creates).toHaveLength(1);
    expect(view.container.querySelector('[data-testid="hidden-by-client-filter"]')).toBeNull();
  });

  test('a switcher change mid-draft never moves the client under drafted lines; an untouched form follows it', async () => {
    writeActiveClientId(TENANT_ID, 'u-1', 'c-acme');
    view = await mountForm();
    // Untouched: the form follows the switcher.
    act(() => writeActiveClientId(TENANT_ID, 'u-1', 'c-self'));
    await settle();
    expect(clientSelect(view.container)!.value).toBe('c-self');
    act(() => writeActiveClientId(TENANT_ID, 'u-1', 'c-acme'));
    await settle();
    expect(clientSelect(view.container)!.value).toBe('c-acme');
    // A drafted line pins the client.
    fillLine(view.container, 0, 'acme-tshirt', '1', '');
    act(() => writeActiveClientId(TENANT_ID, 'u-1', 'c-self'));
    await settle();
    expect(clientSelect(view.container)!.value).toBe('c-acme');
    expect(labelled(view.container, 'SKU')[0]!.querySelector('select')!.value).toBe('acme-tshirt');
  });

  test('without an active client the select still starts empty', async () => {
    view = await mountForm();
    expect(clientSelect(view.container)!.value).toBe('');
  });
});

/* ------------------------------------------------------------------ */
/* Story 4-1b: the client order number                                 */
/* ------------------------------------------------------------------ */

function searchInput(container: HTMLElement): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>('form[role="search"] input');
  expect(found).not.toBeNull();
  return found!;
}

async function submitSearch(container: HTMLElement): Promise<void> {
  const form = container.querySelector('form[role="search"]')!;
  act(() => void form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await settle();
}

describe('the client order number (story 4-1b)', () => {
  test('the create form sends it trimmed, names the order by it, and resets; blank sends no key', async () => {
    view = await mountForm();
    fillDestination(view.container);
    fillLine(view.container, 0, 'glove-sku', '1', '10');
    setInput(input(view.container, 'Client order number (optional)'), '  SO-1042 ');
    await submitCreate(view.container);
    expect(creates).toHaveLength(1);
    expect(creates[0]!.body.clientOrderRef).toBe('SO-1042');
    expect(view.container.querySelector('[role="status"]')!.textContent).toContain('Order SO-1042 accepted');
    expect(input(view.container, 'Client order number (optional)').value).toBe('');

    fillDestination(view.container);
    fillLine(view.container, 0, 'glove-sku', '1', '10');
    setInput(input(view.container, 'Client order number (optional)'), '   ');
    await submitCreate(view.container);
    expect(creates).toHaveLength(2);
    expect('clientOrderRef' in creates[1]!.body).toBe(false);
  });

  test('a shape the server would refuse sends nothing and mints no key; an edit of the number mints a fresh key', async () => {
    view = await mountForm();
    fillDestination(view.container);
    fillLine(view.container, 0, 'glove-sku', '1', '10');
    setInput(input(view.container, 'Client order number (optional)'), 'x'.repeat(65));
    await submitCreate(view.container);
    expect(creates).toHaveLength(0);
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain('Client order number is at most 64 characters');

    createStatus = 503;
    setInput(input(view.container, 'Client order number (optional)'), 'SO-1');
    await submitCreate(view.container);
    await submitCreate(view.container);
    expect(creates).toHaveLength(2);
    expect(creates[1]!.key).toBe(creates[0]!.key);
    setInput(input(view.container, 'Client order number (optional)'), 'SO-2');
    await submitCreate(view.container);
    expect(creates).toHaveLength(3);
    expect(creates[2]!.key).not.toBe(creates[1]!.key);
    expect(creates[2]!.body.clientOrderRef).toBe('SO-2');
  });

  test('the Order column shows the label (number, else channel ref, else short id) with the short id beneath', async () => {
    ordersResponder = () => ({
      items: [
        { ...entry('0198f7a2-1b3c-7d4e-8f90-0000000a0001', 'c-self'), clientOrderRef: 'SO-1042' },
        { ...entry('0198f7a2-1b3c-7d4e-8f90-0000000a0002', 'c-self'), source: 'ingested', integrationId: 'i-1', externalEventId: 'AMZ-9' },
        entry('0198f7a2-1b3c-7d4e-8f90-0000000a0003', 'c-self'),
      ],
      nextCursor: null,
    });
    view = await mountForm();
    const labels = [...view.container.querySelectorAll('[data-testid="order-label"]')].map((node) => node.textContent);
    expect(labels).toEqual(['SO-1042', 'AMZ-9', '000a0003']);
    expect(view.container.textContent).toContain('000a0001');
  });

  test('the search sends reference (trimmed), restarts from page one, and Clear drops it; an empty result names the warehouse', async () => {
    ordersResponder = (url) => {
      if (url.searchParams.get('reference') === 'SO-1042') return { items: [{ ...entry('found-1', 'c-self'), clientOrderRef: 'SO-1042' }], nextCursor: null };
      if (url.searchParams.has('reference')) return { items: [], nextCursor: null };
      if (url.searchParams.get('cursor') === 'p2') return { items: [entry('page-2', 'c-self')], nextCursor: null };
      return { items: [entry('page-1', 'c-self')], nextCursor: 'p2' };
    };
    view = await mountForm();
    act(() => button(view!.container, 'Next').click());
    await settle();
    expect(listUrls.at(-1)!.searchParams.get('cursor')).toBe('p2');

    setInput(searchInput(view.container), '  SO-1042  ');
    await submitSearch(view.container);
    const searched = listUrls.at(-1)!;
    expect(searched.searchParams.get('reference')).toBe('SO-1042');
    expect(searched.searchParams.has('cursor')).toBe(false);
    expect(button(view.container, 'Prev').disabled).toBe(true);
    expect(view.container.textContent).toContain('SO-1042');
    expect(view.container.textContent).not.toContain('page-2');

    setInput(searchInput(view.container), 'NOPE-1');
    await submitSearch(view.container);
    expect(view.container.textContent).toContain('No order in BLR-01 Whitefield has the order number or channel reference "NOPE-1"');

    act(() => button(view!.container, 'Clear').click());
    await settle();
    expect(listUrls.at(-1)!.searchParams.has('reference')).toBe(false);
    expect(view.container.textContent).toContain('page-1');
  });

  test('over 200 characters is refused in the box — nothing is sent', async () => {
    view = await mountForm();
    const before = listUrls.length;
    setInput(searchInput(view.container), 'x'.repeat(201));
    await submitSearch(view.container);
    expect(listUrls.length).toBe(before);
    expect(view.container.querySelector('form[role="search"] [role="alert"]')!.textContent).toContain('at most 200 characters');
  });

  test('under a client filter, an empty search names the client and the show-all-clients hint', async () => {
    clientsBody = [SELF_CLIENT, ACME_CLIENT];
    writeActiveClientId(TENANT_ID, 'u-1', 'c-acme');
    ordersResponder = (url) => (url.searchParams.has('reference') ? { items: [], nextCursor: null } : { items: [entry('acme-1', 'c-acme')], nextCursor: null });
    view = await mountForm();
    setInput(searchInput(view.container), 'SO-9');
    await submitSearch(view.container);
    const last = listUrls.at(-1)!;
    expect(last.searchParams.get('clientId')).toBe('c-acme');
    expect(last.searchParams.get('reference')).toBe('SO-9');
    expect(view.container.textContent).toContain('for ACME — Acme Foods — it may be another client\'s: show all clients to search them all.');
  });
});
