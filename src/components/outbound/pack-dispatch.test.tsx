import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { OutboundPackDispatch } from './pack-dispatch';

/**
 * The Outbound pack & dispatch surface (story 4-2d).
 *
 * These claims cannot be pinned by a `src/lib` test, because each is about
 * what the SCREEN renders or what pressing it actually sends:
 *   1. the bench seeds each scanned entry from the line's ORDERED quantity
 *      and sends exactly those entries as the pack body,
 *   2. the slip — the 201 PackResponse — renders on success, and the row
 *      becomes ready_to_dispatch through the broadcaster, not a full reload,
 *   3. the 422 `pack-mismatch` and the 409 arms render the server's own
 *      words verbatim and cause no optimistic state change,
 *   4. the pack key is minted per DRAFT (an edit mints fresh; a retry
 *      reuses) and the dispatch key per CONFIRMATION (minted when it opens,
 *      reused across retries, minted fresh on a field edit),
 *   5. partially-typed dimensions send nothing — the all-or-nothing rule is
 *      enforced client-side,
 *   6. dispatch submits an EMPTY body as a complete dispatch, names the
 *      retired holds, and the row then offers nothing,
 *   7. a role without `pack.execute`/`dispatch.execute` reads everything and
 *      is offered neither affordance,
 *   8. failed reads get their failed arm and a Retry, never a blank list.
 *
 * The surface is driven end to end through a stubbed `fetch` — the generated
 * client is a fetch wrapper — rather than through mocked hooks, so the gates
 * and the wiring being tested are the ones that ship.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';

/** Fixed instant: the pack and dispatch fixtures' timestamps. */
const NOW = new Date('2026-09-16T17:30:00+05:30');
const NOW_ISO = '2026-09-16T12:00:00.000Z';

function session(role: StoredSession['user']['role']): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Priya Spices' },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: NOW.getTime() + 15 * 60_000,
  };
}

const SKU_ROWS = [
  { id: 'sku-1', code: 'SPICE-01', name: 'Turmeric', uom: 'kg', uomPrecision: 3 },
  { id: 'sku-2', code: 'FLOUR-01', name: 'Flour', uom: 'kg', uomPrecision: 3 },
];

/** The order's two lines: 4 kg of spice, 3 kg of flour, both fully reserved. */
function orderLines(orderId: string): unknown[] {
  return [
    {
      id: 'ol-1',
      orderId,
      skuId: 'sku-1',
      qty: 4,
      reservedQty: 4,
      shortfallQty: 0,
      status: 'open',
      reservationId: 'r-1',
      reservationState: 'committed',
      parentLineId: null,
      createdAt: '2026-09-16T10:00:00.000Z',
    },
    {
      id: 'ol-2',
      orderId,
      skuId: 'sku-2',
      qty: 3,
      reservedQty: 3,
      shortfallQty: 0,
      status: 'open',
      reservationId: 'r-2',
      reservationState: 'committed',
      parentLineId: null,
      createdAt: '2026-09-16T10:00:00.000Z',
    },
  ];
}

function orderRow(id: string, status: string): Record<string, unknown> {
  return {
    id,
    tenantId: TENANT_ID,
    warehouseId: WAREHOUSE_ID,
    status,
    source: 'manual',
    integrationId: null,
    externalEventId: null,
    destination: null,
    createdAt: '2026-09-16T10:00:00.000Z',
    updatedAt: '2026-09-16T10:00:00.000Z',
  };
}

function orderDetail(id: string, status: string): unknown {
  return {
    ...orderRow(id, status),
    lines: orderLines(id),
  };
}

function packedFixture(orderId: string): unknown {
  return {
    orderId,
    tenantId: TENANT_ID,
    warehouseId: WAREHOUSE_ID,
    orderStatus: 'ready_to_dispatch',
    source: 'manual',
    integrationId: null,
    externalEventId: null,
    packedBy: 'priya@example.com',
    packedAt: NOW_ISO,
    weightGrams: 2500,
    dimensionsMm: { lengthMm: 300, widthMm: 200, heightMm: 100 },
    totalUnits: 7,
    lines: [
      {
        orderLineId: 'ol-1',
        skuId: 'sku-1',
        skuCode: 'SPICE-01',
        skuName: 'Turmeric',
        orderedQty: 4,
        packedQty: 4,
        shortfallQty: 0,
        ledgerEventId: 'le-1',
      },
      {
        orderLineId: 'ol-2',
        skuId: 'sku-2',
        skuCode: 'FLOUR-01',
        skuName: 'Flour',
        orderedQty: 3,
        packedQty: 3,
        shortfallQty: 0,
        ledgerEventId: 'le-2',
      },
    ],
  };
}

function dispatchedFixture(orderId: string): unknown {
  return {
    orderId,
    tenantId: TENANT_ID,
    warehouseId: WAREHOUSE_ID,
    orderStatus: 'dispatched',
    source: 'manual',
    integrationId: null,
    externalEventId: null,
    dispatchedBy: 'priya@example.com',
    dispatchedAt: NOW_ISO,
    carrierName: 'Blue Dart',
    trackingNumber: 'BD0012345678',
    totalUnits: 7,
    retiredReservationIds: ['r-1', 'r-2'],
    lines: [
      {
        orderLineId: 'ol-1',
        skuId: 'sku-1',
        skuCode: 'SPICE-01',
        skuName: 'Turmeric',
        orderedQty: 4,
        dispatchedQty: 4,
        shortfallQty: 0,
        ledgerEventId: 'le-3',
      },
      {
        orderLineId: 'ol-2',
        skuId: 'sku-2',
        skuCode: 'FLOUR-01',
        skuName: 'Flour',
        orderedQty: 3,
        dispatchedQty: 3,
        shortfallQty: 0,
        ledgerEventId: 'le-4',
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* The stubbed backend                                                 */
/* ------------------------------------------------------------------ */

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly search: string;
  readonly idempotencyKey: string | null;
  /** Parsed JSON body of a mutation; null when the body was empty. */
  readonly body: unknown;
}

let requests: Recorded[] = [];
/** Each order's live status — the pack/dispatch responders flip it. */
let orderStatuses: Record<string, string> = {};
/** Reads the list builds from, so a broadcaster refetch shows the flip. */
let listRows: () => unknown[] = () => [];
let failList = false;
let failDetail = false;
/** Answers the pack POST; swapped per test to make an attempt refuse. */
let packResponder: () => { status: number; body: unknown } = () => ({
  status: 201,
  body: { pack: packedFixture('order-1') },
});
/** Answers the dispatch POST the same way. */
let dispatchResponder: () => { status: number; body: unknown } = () => ({
  status: 201,
  body: { dispatch: dispatchedFixture('order-2') },
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A router over the endpoints this surface touches. Every request is
 * recorded with its parsed body, and MUTATIONS are matched on method + path
 * BEFORE any read arm — a `pathname.includes('/outbound/orders/')` catch-all
 * would otherwise answer a pack POST with an order detail and 200, letting a
 * press-the-button test pass without the button being wired to anything.
 * Anything unrouted 404s rather than looking like an empty page.
 */
function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();
    const rawBody = method === 'GET' ? '' : await request.text();
    requests.push({
      method,
      pathname,
      search: url.search,
      idempotencyKey: request.headers.get('Idempotency-Key'),
      body: rawBody === '' ? null : JSON.parse(rawBody),
    });

    // ── mutations first ────────────────────────────────────────────────
    if (method === 'POST' && pathname.endsWith('/pack')) {
      const answer = packResponder();
      return json(answer.status, answer.body);
    }
    if (method === 'POST' && pathname.endsWith('/dispatch')) {
      const answer = dispatchResponder();
      return json(answer.status, answer.body);
    }

    // ── reads ──────────────────────────────────────────────────────────
    if (method === 'GET' && pathname.endsWith('/outbound/orders')) {
      if (failList) {
        return json(500, { code: 'internal', title: 'Broken', status: 500, detail: 'The list is down.' });
      }
      return json(200, { items: listRows(), nextCursor: null });
    }
    if (method === 'GET' && /\/outbound\/orders\/[^/]+$/.test(pathname)) {
      const id = pathname.split('/').pop()!;
      if (failDetail) {
        return json(500, { code: 'internal', title: 'Broken', status: 500, detail: 'The order is down.' });
      }
      return json(200, { order: orderDetail(id, orderStatuses[id] ?? 'accepted') });
    }
    if (method === 'GET' && pathname.endsWith('/catalog/skus')) {
      return json(200, { items: SKU_ROWS, nextCursor: null });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  orderStatuses = {
    'order-1': 'accepted',
    'order-2': 'ready_to_dispatch',
    'order-3': 'dispatched',
    'order-4': 'cancelled',
  };
  listRows = () => Object.entries(orderStatuses).map(([id, status]) => orderRow(id, status));
  failList = false;
  failDetail = false;
  packResponder = () => {
    orderStatuses['order-1'] = 'ready_to_dispatch';
    return { status: 201, body: { pack: packedFixture('order-1') } };
  };
  dispatchResponder = () => {
    orderStatuses['order-2'] = 'dispatched';
    return { status: 201, body: { dispatch: dispatchedFixture('order-2') } };
  };
  stubRouter();
  // The slip and record render `new Date(packedAt).toLocaleString()`; pinning
  // the clock keeps those strings stable across machines.
  stubGlobal('Date', pinnedDate());
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
});

/** `Date`, with `new Date()` and `Date.now()` pinned to NOW. */
function pinnedDate(): DateConstructor {
  const Real = Date;
  const fixed = NOW.getTime();
  const Pinned = function (this: unknown, ...args: unknown[]) {
    if (args.length === 0) return new Real(fixed);
    return new (Real as unknown as new (...a: unknown[]) => Date)(...args);
  } as unknown as DateConstructor;
  Object.defineProperty(Pinned, 'prototype', { value: Real.prototype });
  Pinned.now = () => fixed;
  Pinned.parse = Real.parse;
  Pinned.UTC = Real.UTC;
  return Pinned;
}

/** Let every in-flight read settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/**
 * Render the surface with the props the page resolves once (`outbound.tsx`
 * owns the session, the warehouse and the picker now). The role is passed,
 * not the capability, so the `pack.execute`/`dispatch.execute` gates under
 * test are the ones that ship.
 */
async function mount(role: StoredSession['user']['role']): Promise<Rendered> {
  writeSession(session(role));
  const rendered = render(
    <OutboundPackDispatch
      tenantId={TENANT_ID}
      warehouseId={WAREHOUSE_ID}
      warehouseLabel="MAIN Chennai DC"
      role={role}
    />,
  );
  await settle();
  return rendered;
}

function text(rendered: Rendered): string {
  return rendered.container.textContent ?? '';
}

function buttons(rendered: Rendered): HTMLButtonElement[] {
  return [...rendered.container.querySelectorAll('button')] as HTMLButtonElement[];
}

function buttonLabels(rendered: Rendered): string[] {
  return buttons(rendered).map((b) => b.textContent?.trim() ?? '');
}

function pressButton(rendered: Rendered, label: string): Promise<void> {
  const button = buttons(rendered).find((b) => b.textContent?.trim() === label);
  if (button === undefined) {
    throw new Error(`No button labelled "${label}" — have: ${buttonLabels(rendered).join(' | ')}`);
  }
  return act(async () => {
    button.click();
  });
}

/** A row's expand toggle contains the order id next to the disclosure arrow. */
async function expand(rendered: Rendered, orderId: string): Promise<void> {
  const button = buttons(rendered).find((b) => b.textContent?.includes(orderId));
  if (button === undefined) {
    throw new Error(`No expand toggle for "${orderId}" — have: ${buttonLabels(rendered).join(' | ')}`);
  }
  await act(async () => {
    button.click();
  });
  await settle();
}

function inputs(rendered: Rendered): HTMLInputElement[] {
  return [...rendered.container.querySelectorAll('input')] as HTMLInputElement[];
}

/** Set an input's value the way a real keystroke would reach React. */
async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const mutations = () => requests.filter((r) => r.method === 'POST');
const orderListReads = () =>
  requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/outbound/orders'));

/* ------------------------------------------------------------------ */
/* The pipeline list                                                   */
/* ------------------------------------------------------------------ */

describe('the pipeline list', () => {
  test('a cancelled order is not on the pipeline page, and the filter says page-scoped', async () => {
    view = await mount('operator');
    const body = text(view);
    expect(body).toContain('order-1');
    expect(body).toContain('order-3');
    expect(body).not.toContain('order-4');
    expect(body).toContain('3 of 4 on this page');
    expect(body).toContain('Filter this page');
  });

  test('a dispatched row offers nothing — no pack, no dispatch, terminal note', async () => {
    view = await mount('operator');
    await expand(view, 'order-3');
    const body = text(view);
    expect(body).toContain('Dispatched — terminal');
    expect(body).not.toContain('Pack this order');
    expect(body).not.toContain('Dispatch this order');
  });
});

/* ------------------------------------------------------------------ */
/* The pack bench                                                      */
/* ------------------------------------------------------------------ */

describe('the pack bench', () => {
  test('entries seed from the ORDERED quantity, and a full pack sends exactly them', async () => {
    view = await mount('operator');
    await expand(view, 'order-1');

    const scanned = inputs(view).filter((i) => i.type === 'number');
    // Two seeded scanned entries, then four empty measurement inputs.
    expect(scanned.map((i) => i.value)).toEqual(['4', '3', '', '', '', '']);

    await pressButton(view, 'Pack this order');
    await settle();

    const posts = mutations();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/outbound/orders/order-1/pack`);
    expect(posts[0]!.idempotencyKey).not.toBeNull();
    expect(posts[0]!.body).toEqual({
      scanned: [
        { skuId: 'sku-1', qty: 4 },
        { skuId: 'sku-2', qty: 3 },
      ],
    });
    expect(posts[0]!.body).not.toHaveProperty('weightGrams');
    expect(posts[0]!.body).not.toHaveProperty('dimensionsMm');
  });

  test('a full pack renders the slip and flips the row through the broadcaster', async () => {
    const readsBefore = orderListReads().length;
    view = await mount('operator');
    await expand(view, 'order-1');
    await pressButton(view, 'Pack this order');
    await settle();

    const body = text(view);
    expect(body).toContain('Packing slip');
    expect(body).toContain('Packed by priya@example.com');
    expect(body).toContain('2,500 g');
    expect(body).toContain('300 × 200 × 100 mm');
    expect(body).toContain('4.000 kg ordered · 4.000 kg packed');
    expect(body).toContain('7.000 kg in the parcel');
    expect(body).toContain('Order packed');
    expect(body).toContain('ready to dispatch');

    // The broadcaster refetched the list, and the row's status pill moved —
    // no full reload, no page remount.
    expect(orderListReads().length).toBeGreaterThan(readsBefore);
    expect(body).toContain('Ready to dispatch');
    expect(buttonLabels(view)).toContain('Dispatch this order');
  });

  test('a scan mismatch is refused verbatim, changes nothing optimistically, and a retry reuses the key', async () => {
    const mismatch =
      'Pack mismatch — SPICE-01 scanned 4.000 kg but picked 3.000 kg; FLOUR-01 scanned 3.000 kg but picked 2.000 kg.';
    packResponder = () => ({
      status: 422,
      body: { code: 'pack-mismatch', title: 'Pack mismatch', status: 422, detail: mismatch },
    });
    view = await mount('operator');
    await expand(view, 'order-1');
    await pressButton(view, 'Pack this order');
    await settle();

    expect(text(view)).toContain(mismatch);
    expect(text(view)).toContain('Not packed');
    // No optimistic state change: the row still reads accepted and the bench
    // is still on screen.
    expect(text(view)).toContain('Accepted');
    expect(text(view)).not.toContain('Packing slip');

    const firstKey = mutations()[0]!.idempotencyKey;
    await pressButton(view, 'Pack this order');
    await settle();
    const posts = mutations();
    expect(posts).toHaveLength(2);
    expect(posts[1]!.idempotencyKey).toBe(firstKey);
  });

  test('a not-fully-picked 409 is refused verbatim', async () => {
    packResponder = () => ({
      status: 409,
      body: {
        code: 'order-not-fully-picked',
        title: 'Order not fully picked',
        status: 409,
        detail: 'Pick line for SPICE-01 is still planned.',
      },
    });
    view = await mount('operator');
    await expand(view, 'order-1');
    await pressButton(view, 'Pack this order');
    await settle();
    expect(text(view)).toContain('Order not fully picked — Pick line for SPICE-01 is still planned.');
    expect(text(view)).toContain('Accepted');
  });

  test('an already-packed 409 is refused verbatim', async () => {
    packResponder = () => ({
      status: 409,
      body: {
        code: 'order-already-packed',
        title: 'Order already packed',
        status: 409,
        detail: 'This order was packed once and cannot be packed again.',
      },
    });
    view = await mount('operator');
    await expand(view, 'order-1');
    await pressButton(view, 'Pack this order');
    await settle();
    expect(text(view)).toContain(
      'Order already packed — This order was packed once and cannot be packed again.',
    );
  });

  test('an edited draft mints a fresh idempotency key', async () => {
    packResponder = () => ({
      status: 422,
      body: { code: 'pack-mismatch', title: 'Pack mismatch', status: 422, detail: 'short by 1.000 kg' },
    });
    view = await mount('operator');
    await expand(view, 'order-1');

    await pressButton(view, 'Pack this order');
    await settle();
    const firstKey = mutations()[0]!.idempotencyKey;

    // The packer edits the draft down — the next attempt is a NEW pack.
    const scanned = inputs(view).filter((i) => i.type === 'number');
    await typeInto(scanned[0]!, '3');
    await pressButton(view, 'Pack this order');
    await settle();

    const posts = mutations();
    expect(posts).toHaveLength(2);
    expect(posts[1]!.idempotencyKey).not.toBe(firstKey);
    expect(posts[1]!.body).toEqual({
      scanned: [
        { skuId: 'sku-1', qty: 3 },
        { skuId: 'sku-2', qty: 3 },
      ],
    });
  });

  test('partially-typed dimensions are refused client-side — nothing is sent', async () => {
    view = await mount('operator');
    await expand(view, 'order-1');

    const numeric = inputs(view).filter((i) => i.type === 'number');
    // The four measurement inputs come after the two scanned entries.
    const [weight, length, width] = numeric.slice(2);
    await typeInto(weight!, '2500');
    await typeInto(length!, '300');
    await typeInto(width!, '200');

    await pressButton(view, 'Pack this order');
    await settle();

    expect(mutations()).toHaveLength(0);
    expect(text(view)).toContain('Dimensions are all three sides together, or none of them.');
  });

  test('measurements ride along when all four are given', async () => {
    view = await mount('operator');
    await expand(view, 'order-1');

    const numeric = inputs(view).filter((i) => i.type === 'number');
    const [weight, length, width, height] = numeric.slice(2);
    await typeInto(weight!, '2500');
    await typeInto(length!, '300');
    await typeInto(width!, '200');
    await typeInto(height!, '100');

    await pressButton(view, 'Pack this order');
    await settle();

    const posts = mutations();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({
      scanned: [
        { skuId: 'sku-1', qty: 4 },
        { skuId: 'sku-2', qty: 3 },
      ],
      weightGrams: 2500,
      dimensionsMm: { lengthMm: 300, widthMm: 200, heightMm: 100 },
    });
  });

  test('a cleared entry sends nothing for that SKU — the server reads absent as zero', async () => {
    view = await mount('operator');
    await expand(view, 'order-1');

    const scanned = inputs(view).filter((i) => i.type === 'number');
    await typeInto(scanned[1]!, '');

    await pressButton(view, 'Pack this order');
    await settle();

    expect(mutations()[0]!.body).toEqual({ scanned: [{ skuId: 'sku-1', qty: 4 }] });
  });
});

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

describe('dispatch', () => {
  test('an empty body is a complete dispatch; the record names the retired holds', async () => {
    view = await mount('operator');
    await expand(view, 'order-2');

    await pressButton(view, 'Dispatch this order');
    expect(text(view)).toContain('no un-dispatch');
    expect(text(view)).toContain('optional free text');

    await pressButton(view, 'Dispatch this order');
    await settle();

    const posts = mutations();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/outbound/orders/order-2/dispatch`);
    expect(posts[0]!.idempotencyKey).not.toBeNull();
    expect(posts[0]!.body).toEqual({});

    const body = text(view);
    expect(body).toContain('Order dispatched');
    expect(body).toContain('2 reservation holds retired');
    expect(body).toContain('there is no un-dispatch');
    expect(body).toContain('Carrier Blue Dart · Tracking BD0012345678');
    // The row went terminal through the broadcaster refetch.
    expect(body).toContain('Dispatched — terminal');
    expect(buttonLabels(view)).not.toContain('Dispatch this order');
  });

  test('carrier and tracking ride along when given', async () => {
    view = await mount('operator');
    await expand(view, 'order-2');

    await pressButton(view, 'Dispatch this order');
    const textInputs = inputs(view).filter((i) => i.type === 'text');
    await typeInto(textInputs[0]!, 'Blue Dart');
    await typeInto(textInputs[1]!, 'BD0012345678');

    await pressButton(view, 'Dispatch this order');
    await settle();

    expect(mutations()[0]!.body).toEqual({
      carrierName: 'Blue Dart',
      trackingNumber: 'BD0012345678',
    });
  });

  test('a 409 keeps the confirmation open and a retry reuses the key', async () => {
    dispatchResponder = () => ({
      status: 409,
      body: {
        code: 'order-not-packed',
        title: 'Order not packed',
        status: 409,
        detail: 'The order reads accepted, not ready_to_dispatch.',
      },
    });
    view = await mount('operator');
    await expand(view, 'order-2');

    await pressButton(view, 'Dispatch this order');
    await pressButton(view, 'Dispatch this order');
    await settle();

    expect(text(view)).toContain('Order not packed — The order reads accepted, not ready_to_dispatch.');
    expect(text(view)).toContain('Not dispatched');
    // The confirmation stayed open — the operator can retry or back out.
    expect(text(view)).toContain('no un-dispatch');
    expect(buttonLabels(view)).toContain('Dispatch this order');

    const firstKey = mutations()[0]!.idempotencyKey;
    await pressButton(view, 'Dispatch this order');
    await settle();
    const posts = mutations();
    expect(posts).toHaveLength(2);
    expect(posts[1]!.idempotencyKey).toBe(firstKey);
  });

  test('editing a carrier field mints a fresh idempotency key', async () => {
    dispatchResponder = () => ({
      status: 409,
      body: { code: 'order-not-packed', title: 'Order not packed', status: 409, detail: 'reads accepted' },
    });
    view = await mount('operator');
    await expand(view, 'order-2');

    await pressButton(view, 'Dispatch this order');
    await pressButton(view, 'Dispatch this order');
    await settle();
    const firstKey = mutations()[0]!.idempotencyKey;

    const textInputs = inputs(view).filter((i) => i.type === 'text');
    await typeInto(textInputs[0]!, 'Blue Dart');
    await pressButton(view, 'Dispatch this order');
    await settle();

    const posts = mutations();
    expect(posts).toHaveLength(2);
    expect(posts[1]!.idempotencyKey).not.toBe(firstKey);
    expect(posts[1]!.body).toEqual({ carrierName: 'Blue Dart' });
  });
});

/* ------------------------------------------------------------------ */
/* The capability gates                                                */
/* ------------------------------------------------------------------ */

describe('the capability gates', () => {
  test('a role without pack.execute or dispatch.execute reads everything and is offered nothing', async () => {
    view = await mount('accountant');
    expect(text(view)).toContain('order-1');

    await expand(view, 'order-1');
    // The lines render read-only — the bench is simply not there.
    expect(text(view)).not.toContain('Pack this order');
    expect(text(view)).toContain('4.000 kg ordered');

    await expand(view, 'order-2');
    expect(text(view)).not.toContain('Dispatch this order');
    expect(text(view)).toContain('Packed and waiting for dispatch.');
  });
});

/* ------------------------------------------------------------------ */
/* Read failures                                                       */
/* ------------------------------------------------------------------ */

describe('read failures', () => {
  test('a failed list read gets its failed arm and Retry recovers', async () => {
    failList = true;
    view = await mount('operator');
    expect(text(view)).toContain('Orders unavailable');
    expect(text(view)).toContain('The list is down.');
    expect(text(view)).not.toContain('order-1');

    failList = false;
    await pressButton(view, 'Retry');
    await settle();
    expect(text(view)).toContain('order-1');
  });

  test('a failed detail read gets its failed arm and Retry recovers', async () => {
    failDetail = true;
    view = await mount('operator');
    await expand(view, 'order-1');
    expect(text(view)).toContain('The order is down.');
    expect(text(view)).not.toContain('Pack this order');

    failDetail = false;
    await pressButton(view, 'Retry');
    await settle();
    expect(text(view)).toContain('Pack this order');
    expect(text(view)).toContain('4.000 kg ordered');
  });
});