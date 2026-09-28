import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { OUTBOUND_CHANGED_EVENT } from '../../lib/outbound';
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

function shipmentFixture(orderId: string): unknown {
  return {
    id: 'sh-1',
    orderId,
    tenantId: TENANT_ID,
    warehouseId: WAREHOUSE_ID,
    status: 'labelled',
    carrierConnectionId: 'conn-1',
    carrierCode: 'sandbox',
    carrierName: 'Sandbox Express',
    trackingNumber: 'SBX-ABCDEF012345',
    labelDocumentRef: 'sandbox://labels/abc123',
    weightGrams: null,
    dimensionsMm: null,
    labelledBy: 'priya@example.com',
    labelledAt: NOW_ISO,
    manifestId: null,
  };
}

function manifestFixture(manifestId: string): unknown {
  return {
    id: manifestId,
    tenantId: TENANT_ID,
    warehouseId: WAREHOUSE_ID,
    carrierConnectionId: 'conn-1',
    carrierCode: 'sandbox',
    shipmentCount: 1,
    createdBy: 'priya@example.com',
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  };
}

function connectionFixture(): unknown {
  return {
    id: 'conn-1',
    tenantId: TENANT_ID,
    carrierCode: 'sandbox',
    carrierName: 'Sandbox Express',
    accountLabel: 'ops@sandbox.test',
    credentialVersion: 1,
    connectedBy: 'priya@example.com',
    rotatedAt: null,
    rotatedBy: null,
    createdAt: '2026-09-16T10:00:00.000Z',
    updatedAt: '2026-09-16T10:00:00.000Z',
  };
}

/** Story 4.6d — one quoted item and one refused item, sorted by carrierCode. */
function ratesFixture(): unknown {
  return {
    rates: {
      orderId: 'order-2',
      items: [
        {
          connectionId: 'conn-2',
          carrierCode: 'delhivery',
          carrierName: 'Delhivery',
          quote: null,
          refusal: {
            code: 'carrier-transport-unconfigured',
            status: 501,
            title: 'Carrier transport unconfigured',
            detail: 'Carrier "delhivery" has no label transport on this deployment — its real integration has not been configured. Retry once it lands.',
          },
        },
        {
          connectionId: 'conn-1',
          carrierCode: 'sandbox',
          carrierName: 'Sandbox Express',
          quote: { amountPaise: 123456 },
          refusal: null,
        },
      ],
    },
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
let skuFail = false;
/** Story 4.6c — the label station's and manifest section's read failures. */
let failConnections = false;
let failShipment = false;
let failManifests = false;
/** Story 4.6d — the rate shopping read's failure arm. */
let failRates = false;
/** The keyset cursor the list advertises, for the pager test. */
let ordersNextCursor: string | null = null;
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
/* Story 4.6c — the label station and the manifest closure. */
let labelResponder: () => { status: number; body: unknown } = () => ({
  status: 201,
  body: { shipment: shipmentFixture('order-2') },
});
let manifestResponder: () => { status: number; body: unknown } = () => ({
  status: 201,
  body: { manifest: manifestFixture('mf-1') },
});
let connectionRows: unknown[] = [];
/** Per-order shipment read-backs: absent → 404 "no label yet". */
let shipmentsByOrder: Record<string, unknown | null> = {};
/** Story 4.6d — per-order rate responses: absent → 404 (rendered as "no rates"). */
let ratesByOrder: Record<string, unknown> = {};
let manifestRows: unknown[] = [];
/** The keyset cursor the manifests list advertises, for the pager test. */
let manifestsNextCursor: string | null = null;

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
    if (method === 'POST' && pathname.endsWith('/label')) {
      const answer = labelResponder();
      return json(answer.status, answer.body);
    }
    if (method === 'POST' && pathname.endsWith('/outbound/manifests')) {
      const answer = manifestResponder();
      return json(answer.status, answer.body);
    }

    // ── reads ──────────────────────────────────────────────────────────
    if (method === 'GET' && pathname.endsWith('/outbound/orders')) {
      if (failList) {
        return json(500, { code: 'internal', title: 'Broken', status: 500, detail: 'The list is down.' });
      }
      return json(200, { items: listRows(), nextCursor: ordersNextCursor });
    }
    if (method === 'GET' && pathname.endsWith('/carriers/connections')) {
      if (failConnections) {
        return json(500, { code: 'internal', title: 'Broken', status: 500, detail: 'The connections are down.' });
      }
      return json(200, { items: connectionRows, nextCursor: null });
    }
    if (method === 'GET' && /\/outbound\/orders\/[^/]+\/shipment$/.test(pathname)) {
      if (failShipment) {
        return json(500, { code: 'internal', title: 'Broken', status: 500, detail: 'The shipment read is down.' });
      }
      const orderId = pathname.split('/')[pathname.split('/').length - 2]!;
      const shipment = shipmentsByOrder[orderId];
      // The route answers 404 `not-found` when the order has no label yet —
      // the expected state of a ready_to_dispatch order, never a failure.
      if (shipment === undefined) {
        return json(404, { code: 'not-found', title: 'No shipment', status: 404, detail: 'No label yet.' });
      }
      return json(200, { shipment });
    }
    if (method === 'GET' && /\/outbound\/orders\/[^/]+\/rates$/.test(pathname)) {
      if (failRates) {
        return json(500, { code: 'internal', title: 'Broken', status: 500, detail: 'The rates read is down.' });
      }
      const orderId = pathname.split('/')[pathname.split('/').length - 2]!;
      const rates = ratesByOrder[orderId];
      if (rates === undefined) {
        // The route answers 404 for an unknown or foreign order — the hook
        // renders that as "no rates", never a failed read.
        return json(404, { code: 'not-found', title: 'No order', status: 404, detail: 'No such order.' });
      }
      return json(200, rates);
    }
    if (method === 'GET' && pathname.endsWith('/outbound/manifests')) {
      if (failManifests) {
        return json(500, { code: 'internal', title: 'Broken', status: 500, detail: 'The manifests are down.' });
      }
      return json(200, { items: manifestRows, nextCursor: manifestsNextCursor });
    }
    if (method === 'GET' && /\/outbound\/orders\/[^/]+$/.test(pathname)) {
      const id = pathname.split('/').pop()!;
      if (failDetail) {
        return json(500, { code: 'internal', title: 'Broken', status: 500, detail: 'The order is down.' });
      }
      return json(200, { order: orderDetail(id, orderStatuses[id] ?? 'accepted') });
    }
    if (method === 'GET' && pathname.endsWith('/catalog/skus')) {
      if (skuFail) {
        return json(500, { code: 'internal', title: 'Broken', status: 500, detail: 'The SKU list is down.' });
      }
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
  skuFail = false;
  failConnections = false;
  failShipment = false;
  failManifests = false;
  failRates = false;
  ordersNextCursor = null;
  manifestsNextCursor = null;
  packResponder = () => {
    orderStatuses['order-1'] = 'ready_to_dispatch';
    return { status: 201, body: { pack: packedFixture('order-1') } };
  };
  dispatchResponder = () => {
    orderStatuses['order-2'] = 'dispatched';
    return { status: 201, body: { dispatch: dispatchedFixture('order-2') } };
  };
  labelResponder = () => {
    shipmentsByOrder['order-2'] = shipmentFixture('order-2');
    return { status: 201, body: { shipment: shipmentFixture('order-2') } };
  };
  manifestResponder = () => {
    manifestRows = [manifestFixture('mf-1')];
    return { status: 201, body: { manifest: manifestFixture('mf-1') } };
  };
  connectionRows = [];
  shipmentsByOrder = {};
  ratesByOrder = {};
  manifestRows = [];
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
const manifestListReads = () =>
  requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/outbound/manifests'));
const rateReads = () =>
  requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/rates'));

/** Set a labelled <select>'s value the way a real pick would reach React. */
async function selectOption(rendered: Rendered, labelText: string, value: string): Promise<void> {
  const label = [...rendered.container.querySelectorAll('label')].find((l) =>
    l.textContent?.includes(labelText),
  );
  const select = label?.querySelector('select');
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error(`No select labelled "${labelText}"`);
  }
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/* ------------------------------------------------------------------ */
/* The pipeline list                                                   */
/* ------------------------------------------------------------------ */

describe('the pipeline list', () => {
  test('a cancelled order is not on the pipeline page, and the filter counts only what it could show', async () => {
    view = await mount('operator');
    const body = text(view);
    expect(body).toContain('order-1');
    expect(body).toContain('order-3');
    expect(body).not.toContain('order-4');
    // The denominator is the pipeline-filtered set — a cancelled order can
    // never be on this page, so it never counts against the control.
    expect(body).toContain('3 of 3 on this page');
    expect(body).toContain('Filter this page');
  });

  test('the pager carries the keyset cursor to the next page', async () => {
    ordersNextCursor = 'opaque-cursor';
    view = await mount('operator');

    await pressButton(view, 'Next');
    await settle();

    const pages = orderListReads();
    expect(pages).toHaveLength(2);
    expect(pages[0]!.search).toBe('');
    expect(pages[1]!.search).toBe('?cursor=opaque-cursor');
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

  test('a pack whose first attempt dies mid-flight replays the SAME key and renders the slip', async () => {
    // The request never answered — the server may or may not have committed.
    let packAttempt = 0;
    packResponder = () => {
      packAttempt += 1;
      if (packAttempt === 1) throw new Error('Failed to fetch');
      orderStatuses['order-1'] = 'ready_to_dispatch';
      return { status: 201, body: { pack: packedFixture('order-1') } };
    };
    view = await mount('operator');
    await expand(view, 'order-1');

    await pressButton(view, 'Pack this order');
    await settle();

    // The transport-shaped refusal renders, and nothing optimistic happened:
    // the row still reads accepted and no slip exists.
    expect(text(view)).toContain('The API is unreachable — is wms-be running?');
    expect(text(view)).toContain('Accepted');
    expect(text(view)).not.toContain('Packing slip');

    // The retry of the UNEDITED draft re-sends the same body — the server
    // answers 201 with the committed pack, and the slip renders from that
    // replay's response.
    await pressButton(view, 'Pack this order');
    await settle();

    const posts = mutations();
    expect(posts).toHaveLength(2);
    expect(posts[0]!.idempotencyKey).not.toBeNull();
    expect(posts[1]!.idempotencyKey).toBe(posts[0]!.idempotencyKey);
    expect(posts[1]!.body).toEqual(posts[0]!.body);

    const body = text(view);
    expect(body).toContain('Packing slip');
    expect(body).toContain('7.000 kg in the parcel');
    expect(body).toContain('Order packed');
    expect(body).toContain('Ready to dispatch');
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

  test('the SKU map failing leaves the pack flow intact on raw ids and unit-agnostic copy', async () => {
    skuFail = true;
    view = await mount('operator');
    await expand(view, 'order-1');

    // The bench renders on the raw skuIds — the map only decorates, and a
    // decoration read failing must never block the pack flow.
    expect(text(view)).toContain('sku-1');
    expect(text(view)).toContain('4 units ordered');
    expect(buttonLabels(view)).toContain('Pack this order');

    await pressButton(view, 'Pack this order');
    await settle();

    expect(mutations()).toHaveLength(1);
    expect(mutations()[0]!.body).toEqual({
      scanned: [
        { skuId: 'sku-1', qty: 4 },
        { skuId: 'sku-2', qty: 3 },
      ],
    });
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

  test('backing out of the confirm drops the minted key and a re-open mints fresh', async () => {
    // First attempt refuses — its key is now on record; back out instead of
    // retrying.
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
    const attemptedKey = mutations()[0]!.idempotencyKey;

    await pressButton(view, 'Keep it as it is');
    // The confirmation is closed, nothing further was sent, and the
    // affordance is back.
    expect(text(view)).not.toContain('no un-dispatch');
    expect(mutations()).toHaveLength(1);
    expect(buttonLabels(view)).toContain('Dispatch this order');

    // A re-open is a NEW confirmation — it mints a fresh key, not the one
    // the backed-out attempt would have replayed.
    dispatchResponder = () => {
      orderStatuses['order-2'] = 'dispatched';
      return { status: 201, body: { dispatch: dispatchedFixture('order-2') } };
    };
    await pressButton(view, 'Dispatch this order');
    await pressButton(view, 'Dispatch this order');
    await settle();

    const posts = mutations();
    expect(posts).toHaveLength(2);
    expect(posts[1]!.idempotencyKey).not.toBeNull();
    expect(posts[1]!.idempotencyKey).not.toBe(attemptedKey);
    expect(text(view)).toContain('Order dispatched');
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

/* ------------------------------------------------------------------ */
/* The label station (story 4.6c)                                      */
/* ------------------------------------------------------------------ */

describe('the label step (4.6c)', () => {
  test('the label form sends the connection and the record renders from the response', async () => {
    connectionRows = [connectionFixture()];
    view = await mount('operator');
    await expand(view, 'order-2');

    expect(text(view)).toContain('Generate label');
    expect(text(view)).toContain('Carrier connection');

    await selectOption(view, 'Carrier connection', 'conn-1');
    await pressButton(view, 'Generate label');
    await settle();

    const posts = mutations();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/outbound/orders/order-2/label`);
    expect(posts[0]!.idempotencyKey).not.toBeNull();
    // A bare label is the connection alone — measurements stay optional.
    expect(posts[0]!.body).toEqual({ carrierConnectionId: 'conn-1' });

    const body = text(view);
    expect(body).toContain('Carrier Sandbox Express · Tracking SBX-ABCDEF012345');
    expect(body).toContain('Dispatch stamps this carrier and tracking');
    // The label is a station act beside the state machine: the row's status
    // does not move.
    expect(text(view)).toContain('Ready to dispatch');
  });

  test('measurements ride the label body when given, under the pack rule', async () => {
    connectionRows = [connectionFixture()];
    view = await mount('operator');
    await expand(view, 'order-2');

    await selectOption(view, 'Carrier connection', 'conn-1');
    // The label form's four measurement inputs — the only number inputs on
    // this expanded row.
    const numeric = inputs(view).filter((i) => i.type === 'number');
    expect(numeric).toHaveLength(4);
    await typeInto(numeric[0]!, '2500');
    await typeInto(numeric[1]!, '300');
    await typeInto(numeric[2]!, '200');
    await typeInto(numeric[3]!, '100');
    await pressButton(view, 'Generate label');
    await settle();

    expect(mutations()[0]!.body).toEqual({
      carrierConnectionId: 'conn-1',
      weightGrams: 2500,
      dimensionsMm: { lengthMm: 300, widthMm: 200, heightMm: 100 },
    });
    // The record renders from the response shipment — the carrier and
    // tracking, not the posted measurements.
    expect(text(view)).toContain('Carrier Sandbox Express · Tracking SBX-ABCDEF012345');
  });

  test('a 501 unconfigured-carrier refusal renders verbatim and a retry reuses the key', async () => {
    connectionRows = [connectionFixture()];
    labelResponder = () => ({
      status: 501,
      body: {
        code: 'carrier-transport-unconfigured',
        title: 'Carrier transport unconfigured',
        status: 501,
        detail: 'The delhivery carrier has no transport on this deployment. Connect a carrier with one, or record the hand-over on dispatch.',
      },
    });
    view = await mount('operator');
    await expand(view, 'order-2');

    await selectOption(view, 'Carrier connection', 'conn-1');
    await pressButton(view, 'Generate label');
    await settle();

    expect(text(view)).toContain(
      'Carrier transport unconfigured — The delhivery carrier has no transport on this deployment. Connect a carrier with one, or record the hand-over on dispatch.',
    );
    expect(text(view)).toContain('Label not generated');
    // Nothing was written and nothing moved optimistically: the form is still
    // on screen and the row still reads ready_to_dispatch.
    expect(text(view)).toContain('Ready to dispatch');
    expect(text(view)).not.toContain('Tracking SBX-ABCDEF012345');

    const firstKey = mutations()[0]!.idempotencyKey;
    await pressButton(view, 'Generate label');
    await settle();
    const posts = mutations();
    expect(posts).toHaveLength(2);
    expect(posts[1]!.idempotencyKey).toBe(firstKey);
  });

  test('a 503 key-unavailable refusal renders verbatim — retryable inline', async () => {
    connectionRows = [connectionFixture()];
    labelResponder = () => ({
      status: 503,
      body: {
        code: 'carrier-encryption-unavailable',
        title: 'Carrier encryption unavailable',
        status: 503,
        detail: 'The carrier encryption key is not configured. Set CARRIER_ENCRYPTION_KEY and retry — nothing was written.',
      },
    });
    view = await mount('operator');
    await expand(view, 'order-2');

    await selectOption(view, 'Carrier connection', 'conn-1');
    await pressButton(view, 'Generate label');
    await settle();

    expect(text(view)).toContain(
      'Carrier encryption unavailable — The carrier encryption key is not configured. Set CARRIER_ENCRYPTION_KEY and retry — nothing was written.',
    );
    // The retry affordance is the same button — the refusal is inline.
    expect(buttonLabels(view)).toContain('Generate label');
  });

  test('an edited draft mints a fresh idempotency key', async () => {
    connectionRows = [connectionFixture()];
    labelResponder = () => ({
      status: 501,
      body: {
        code: 'carrier-transport-unconfigured',
        title: 'Carrier transport unconfigured',
        status: 501,
        detail: 'no transport',
      },
    });
    view = await mount('operator');
    await expand(view, 'order-2');

    await selectOption(view, 'Carrier connection', 'conn-1');
    await pressButton(view, 'Generate label');
    await settle();
    const firstKey = mutations()[0]!.idempotencyKey;

    // An edit — a measurement — makes the next attempt a NEW label.
    const numeric = inputs(view).filter((i) => i.type === 'number');
    await typeInto(numeric[0]!, '2500');
    await pressButton(view, 'Generate label');
    await settle();

    const posts = mutations();
    expect(posts).toHaveLength(2);
    expect(posts[1]!.idempotencyKey).not.toBe(firstKey);
    expect(posts[1]!.body).toEqual({ carrierConnectionId: 'conn-1', weightGrams: 2500 });
  });

  test('an existing label renders its record instead of the form — one label per order, ever', async () => {
    shipmentsByOrder['order-2'] = shipmentFixture('order-2');
    connectionRows = [connectionFixture()];
    view = await mount('operator');
    await expand(view, 'order-2');

    const body = text(view);
    expect(body).toContain('Carrier Sandbox Express · Tracking SBX-ABCDEF012345');
    expect(body).not.toContain('Generate label');

    // The manifest closure below names the labelled shipment.
    expect(text(view)).toContain('Pick a connection…');
    expect(text(view)).toContain('Sandbox Express');
  });
});

/* ------------------------------------------------------------------ */
/* The manifest section (story 4.6c)                                   */
/* ------------------------------------------------------------------ */

describe('the manifest section (4.6c)', () => {
  test('the closure sends the labelled shipments and states the terminality', async () => {
    shipmentsByOrder['order-2'] = shipmentFixture('order-2');
    connectionRows = [connectionFixture()];
    view = await mount('operator');

    expect(text(view)).toContain('Manifests');
    expect(text(view)).toContain('no un-manifest');
    expect(text(view)).toContain('Pick a connection…');

    await selectOption(view, 'Manifest onto', 'conn-1');
    await settle();
    // The connection's labelled shipments pre-check — the manifest is the
    // hand-over of the batch.
    const checkboxes = [...view.container.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    expect(checkboxes).toHaveLength(1);
    expect(checkboxes[0]!.checked).toBe(true);

    await pressButton(view, 'Create manifest');
    await settle();

    const posts = mutations();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.pathname).toBe(
      `/api/v1/tenants/${TENANT_ID}/warehouses/${WAREHOUSE_ID}/outbound/manifests`,
    );
    expect(posts[0]!.idempotencyKey).not.toBeNull();
    expect(posts[0]!.body).toEqual({ shipmentIds: ['sh-1'] });

    const body = text(view);
    expect(body).toContain('Manifest created');
    expect(body).toContain('1 shipment closed onto sandbox. There is no un-manifest.');
    // The manifest list read back the created record.
    expect(text(view)).toContain('mf-1');
  });

  test('a 409 offender renders verbatim and a selection edit mints a fresh key', async () => {
    // Two labelled shipments on the page, both on the same connection — the
    // builder pre-checks both, so an untick leaves a real (non-empty) set.
    orderStatuses['order-1'] = 'ready_to_dispatch';
    shipmentsByOrder['order-1'] = {
      ...(shipmentFixture('order-1') as Record<string, unknown>),
      id: 'sh-2',
    };
    shipmentsByOrder['order-2'] = shipmentFixture('order-2');
    connectionRows = [connectionFixture()];
    manifestResponder = () => ({
      status: 409,
      body: {
        code: 'manifest-shipments-conflict',
        status: 409,
        detail: '1 of the named shipment(s) do not exist in this tenant.',
      },
    });
    view = await mount('operator');

    await selectOption(view, 'Manifest onto', 'conn-1');
    await settle();
    await pressButton(view, 'Create manifest');
    await settle();

    expect(text(view)).toContain('1 of the named shipment(s) do not exist in this tenant.');
    expect(text(view)).toContain('No manifest');
    // The selection goes as given — the set is the intent, order irrelevant.
    expect(mutations()[0]!.body).toEqual({ shipmentIds: ['sh-2', 'sh-1'] });
    const firstKey = mutations()[0]!.idempotencyKey;

    // Untick one — the next attempt is a NEW manifest with the edited set.
    const checkboxes = [...view.container.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    await act(async () => {
      checkboxes[0]!.click();
    });
    await pressButton(view, 'Create manifest');
    await settle();

    const posts = mutations();
    expect(posts).toHaveLength(2);
    expect(posts[1]!.idempotencyKey).not.toBe(firstKey);
    expect(posts[1]!.body).toEqual({ shipmentIds: ['sh-1'] });
  });

  test('an empty selection is refused client-side — nothing is sent', async () => {
    shipmentsByOrder['order-2'] = shipmentFixture('order-2');
    connectionRows = [connectionFixture()];
    view = await mount('operator');

    await selectOption(view, 'Manifest onto', 'conn-1');
    await settle();
    // Untick the pre-checked shipment, then submit the empty set.
    const checkboxes = [...view.container.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    await act(async () => {
      checkboxes[0]!.click();
    });
    await pressButton(view, 'Create manifest');
    await settle();

    expect(mutations()).toHaveLength(0);
    expect(text(view)).toContain('Pick at least one labelled shipment to manifest.');
  });

  test('the manifests pager carries the keyset cursor to the older page', async () => {
    manifestRows = [manifestFixture('mf-1')];
    manifestsNextCursor = 'older-manifests-cursor';
    view = await mount('operator');

    await pressButton(view, 'Older manifests');
    await settle();

    const pages = manifestListReads();
    expect(pages).toHaveLength(2);
    expect(pages[0]!.search).toBe('');
    expect(pages[1]!.search).toBe('?cursor=older-manifests-cursor');
  });
});

/* ------------------------------------------------------------------ */
/* The 4.6c capability gates                                           */
/* ------------------------------------------------------------------ */

describe('the label and manifest gates (4.6c)', () => {
  test('a role without labels.execute is offered neither the label form nor the manifest builder, and still reads the manifest record', async () => {
    shipmentsByOrder['order-2'] = shipmentFixture('order-2');
    manifestRows = [manifestFixture('mf-1')];
    view = await mount('accountant');
    await expand(view, 'order-2');

    const body = text(view);
    expect(body).not.toContain('Generate label');
    expect(body).not.toContain('Manifest onto');
    expect(body).not.toContain('Create manifest');
    // The dispatch affordance is likewise absent, unchanged from 4-2d.
    expect(body).not.toContain('Dispatch this order');
    expect(body).toContain('Packed and waiting for dispatch.');
    // But the hand-over record itself is readable by every role.
    expect(body).toContain('mf-1');
    expect(body).toContain('1 shipment');
  });
});

/* ------------------------------------------------------------------ */
/* The 4.6c read failures                                              */
/* ------------------------------------------------------------------ */

/**
 * Matrix row 12 — every 4.6c read reports its own failure: a failed arm with
 * its word and the reason, never blank and never an endless "Loading…", and
 * the Retry affordance recovers it.
 */
describe('the 4.6c read failures', () => {
  test('a failed shipment read inside the expanded row renders Label unavailable and Retry recovers', async () => {
    failShipment = true;
    connectionRows = [connectionFixture()];
    view = await mount('operator');
    await expand(view, 'order-2');

    expect(text(view)).toContain('Label unavailable');
    expect(text(view)).toContain('The shipment read is down.');
    // Never blank, never an endless "Loading…": the record is simply not
    // claimed to exist.
    expect(text(view)).not.toContain('Loading label…');

    failShipment = false;
    await pressButton(view, 'Retry');
    await settle();
    expect(text(view)).toContain('Generate label');
  });

  test('a failed connections read renders Connections unavailable and Retry recovers', async () => {
    failConnections = true;
    connectionRows = [connectionFixture()];
    view = await mount('operator');
    await expand(view, 'order-2');

    expect(text(view)).toContain('Connections unavailable');
    expect(text(view)).toContain('The connections are down.');
    expect(text(view)).not.toContain('Loading carrier connections…');

    failConnections = false;
    await pressButton(view, 'Retry');
    await settle();
    expect(text(view)).not.toContain('Connections unavailable');
    expect(text(view)).toContain('Carrier connection');
    expect(text(view)).toContain('Generate label');
  });

  test('a failed manifests list read renders Manifests unavailable and Retry recovers', async () => {
    failManifests = true;
    manifestRows = [manifestFixture('mf-1')];
    view = await mount('operator');

    expect(text(view)).toContain('Manifests unavailable');
    expect(text(view)).toContain('The manifests are down.');
    expect(text(view)).not.toContain('Loading manifests…');

    failManifests = false;
    await pressButton(view, 'Retry');
    await settle();
    expect(text(view)).toContain('mf-1');
  });

  test('a failed per-order shipment read feeding the manifest builder renders Shipments unavailable and Retry recovers', async () => {
    failShipment = true;
    shipmentsByOrder['order-2'] = shipmentFixture('order-2');
    connectionRows = [connectionFixture()];
    view = await mount('operator');

    expect(text(view)).toContain('Shipments unavailable');
    expect(text(view)).toContain('The shipment read is down.');
    expect(text(view)).not.toContain('Checking this page for labelled shipments…');

    failShipment = false;
    await pressButton(view, 'Retry');
    await settle();
    expect(text(view)).not.toContain('Shipments unavailable');
    expect(text(view)).toContain('Pick a connection…');
    expect(text(view)).toContain('Sandbox Express');
  });
});

/* ------------------------------------------------------------------ */
/* The rates strip (story 4.6d)                                        */
/* ------------------------------------------------------------------ */

describe('the rates strip (4.6d)', () => {
  test('quoted and refused items render between the connection picker and the measurements, and the read is a bare GET', async () => {
    connectionRows = [connectionFixture()];
    ratesByOrder['order-2'] = ratesFixture();
    view = await mount('operator');
    await expand(view, 'order-2');

    const body = text(view);
    expect(body).toContain('Rates');
    // The quoted item shows the INR-formatted amount (123456 paise).
    expect(body).toContain('Sandbox Express');
    expect(body).toContain('₹1,234.56');
    // The refused item shows the verbatim refusal chip, in the server's words.
    expect(body).toContain('Delhivery');
    expect(body).toContain('has no label transport on this deployment');
    // The strip sits inside the label form — the picker and the measurements
    // fieldset are both still there.
    expect(body).toContain('Carrier connection');
    expect(body).toContain('Measurements (optional)');
    expect(body).toContain('Generate label');

    // The rates read is a READ: a GET with no Idempotency-Key, recomputed at
    // every read, and nothing is stored or posted by it.
    const rateReads = requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/rates'));
    expect(rateReads).toHaveLength(1);
    expect(rateReads[0]!.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/outbound/orders/order-2/rates`);
    expect(rateReads[0]!.idempotencyKey).toBeNull();
    expect(mutations()).toHaveLength(0);
  });

  test('a failed rates read renders Rates unavailable and Retry recovers', async () => {
    connectionRows = [connectionFixture()];
    ratesByOrder['order-2'] = ratesFixture();
    failRates = true;
    view = await mount('operator');
    await expand(view, 'order-2');

    expect(text(view)).toContain('Rates unavailable');
    expect(text(view)).toContain('The rates read is down.');
    expect(text(view)).not.toContain('Loading rates…');
    // The rest of the form is unaffected by the failed strip.
    expect(text(view)).toContain('Generate label');

    failRates = false;
    await pressButton(view, 'Retry');
    await settle();
    expect(text(view)).not.toContain('Rates unavailable');
    expect(text(view)).toContain('₹1,234.56');
  });

  test('the strip is hidden when the role carries no labels.execute — gating hides, never disables', async () => {
    connectionRows = [connectionFixture()];
    ratesByOrder['order-2'] = ratesFixture();
    view = await mount('accountant');
    await expand(view, 'order-2');

    // The accountant reads the whole surface but is offered neither the label
    // form nor the rates strip.
    const body = text(view);
    expect(body).not.toContain('₹1,234.56');
    expect(body).not.toContain('Generate label');
    expect(body).not.toContain('Measurements (optional)');
  });

  test('a 404 rates read renders as no rates at all, never a failed read', async () => {
    connectionRows = [connectionFixture()];
    view = await mount('operator');
    await expand(view, 'order-2');

    // No rates response was staged → 404 → the hook's null: no strip, no
    // failure arm, and the label form is unaffected.
    expect(text(view)).not.toContain('Rates unavailable');
    expect(text(view)).not.toContain('₹1,234.56');
    expect(text(view)).toContain('Generate label');
  });

  test('the OUTBOUND_CHANGED refetch re-runs the rates read — quotes are recomputed, never served stale', async () => {
    connectionRows = [connectionFixture()];
    ratesByOrder['order-2'] = ratesFixture();
    view = await mount('operator');
    await expand(view, 'order-2');
    expect(rateReads()).toHaveLength(1);
    expect(text(view)).toContain('₹1,234.56');

    // A mutation elsewhere (another operator's label, an API call) broadcasts;
    // the strip re-prices from the new read — nothing was stored, so there is
    // nothing to serve stale (the outbound-waves broadcaster precedent).
    ratesByOrder['order-2'] = {
      rates: {
        orderId: 'order-2',
        items: [
          {
            connectionId: 'conn-1',
            carrierCode: 'sandbox',
            carrierName: 'Sandbox Express',
            quote: { amountPaise: 654321 },
            refusal: null,
          },
        ],
      },
    };
    await act(async () => {
      window.dispatchEvent(new Event(OUTBOUND_CHANGED_EVENT));
    });
    await settle();

    expect(rateReads()).toHaveLength(2);
    expect(text(view)).toContain('₹6,543.21');
    expect(text(view)).not.toContain('₹1,234.56');
  });
});
