import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import type { UserRole } from '../../lib/users';
import { BlindReviewQueue } from './blind-review';
import { ReturnsView } from './returns-view';

/**
 * Story 4-7b — the Unannounced tab's review cards. The claims a `src/lib`
 * test cannot make:
 *   1. the tab lists `origin=blind&reviewStatus=pending` for the warehouse,
 *      and each card reads its detail: client, warehouse, operator, IST time,
 *      parcel reference, the suggested order and its match kind, the units,
 *      the open-RMA flag and the same-parcel line;
 *   2. Accept sends the order it says — the suggestion, a searched order
 *      (the search scoped to client, warehouse and dispatched), or `null`
 *      for "No order" — and the banner names the unlinked lines from the
 *      response;
 *   3. Reject sends nothing until the draft is valid, surfaces a refusal by
 *      code and keeps the dialog; the open-RMA shortcut sends `duplicate`;
 *   4. a parcel whose client the operator chose shows the warning and Accept
 *      waits for the ticked confirmation;
 *   5. the tab is offered to `returns.manage` only.
 * Driven through a stubbed global `fetch`, so the wiring under test ships.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
const ORDER_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000b1';
const OTHER_ORDER_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000b2';
const CLIENT_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000c1';

function session(role: UserRole): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Priya Spices', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function sku(id: string, code: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    tenantId: TENANT_ID,
    clientId: CLIENT_ID,
    code,
    name: code,
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
    barcode: code,
    uomConversions: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

function blindRma(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'rma-42',
    code: 'RMA-0042',
    status: 'received',
    orderId: null,
    orderReference: null,
    warehouseId: WAREHOUSE_ID,
    clientId: CLIENT_ID,
    externalReference: null,
    orderDispatchedAt: null,
    createdAt: '2026-10-30T04:30:00.000Z',
    createdBy: 'u-op',
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    lines: [
      { id: 'rl-1', orderLineId: null, skuId: 'sku-a', authorizedQty: 2, receivedQty: 2, reasonCode: 'unannounced', reasonNote: null, serials: [] },
      { id: 'rl-2', orderLineId: null, skuId: 'sku-s', authorizedQty: 1, receivedQty: 1, reasonCode: 'unannounced', reasonNote: null, serials: [{ id: 's1', serialNumber: 'SN-1' }] },
    ],
    origin: 'blind',
    reviewStatus: 'pending',
    parcelReference: 'AWB123',
    suggestedOrderId: ORDER_ID,
    matchKind: 'awb',
    clientPrompted: false,
    reviewedAt: null,
    reviewedBy: null,
    reviewReasonCode: null,
    reviewNote: null,
    ...over,
  };
}

function receiptLine(id: string, rmaLineId: string, skuId: string, qty: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    rmaLineId,
    skuId,
    qty,
    condition: 'resaleable',
    note: null,
    batchCode: null,
    serialNumber: null,
    weightGrams: null,
    openQty: 0,
    restockedQty: 0,
    scrappedQty: 0,
    onHoldQty: 0,
    failedInspectionQty: 0,
    pendingReviewQty: qty,
    reversedQty: 0,
    ...over,
  };
}

function detail(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...blindRma(over),
    receipts: [
      {
        id: 'rr-1',
        code: 'RRN-0107',
        operatorUserId: 'u-op',
        operatorEmail: 'ravi@example.com',
        occurredAt: '2026-10-30T04:30:00.000Z',
        lines: [
          receiptLine('rrl-1', 'rl-1', 'sku-a', 2, { batchCode: 'B9', condition: 'opened' }),
          receiptLine('rrl-2', 'rl-2', 'sku-s', 1, { serialNumber: 'SN-1' }),
        ],
      },
    ],
    openRmasForSuggestedOrder: [],
    sameParcelRmas: [],
    ...over,
  };
}

const RETURNABLE = {
  orderId: ORDER_ID,
  status: 'dispatched',
  warehouseId: WAREHOUSE_ID,
  orderReference: 'SHOP-1001',
  dispatchedAt: '2026-10-15T00:00:00.000Z',
  lines: [
    { orderLineId: 'ol-a', parentLineId: null, skuId: 'sku-a', kitParent: false, dispatchedQty: 3, authorizedQty: 0, returnableQty: 3, serialTracked: false, returnableSerials: [] },
  ],
};

let requests: { method: string; pathname: string; search: string }[] = [];
let accepts: { pathname: string; body: Record<string, unknown>; key: string | null }[] = [];
let rejects: { pathname: string; body: Record<string, unknown>; key: string | null }[] = [];
let listItems: Record<string, unknown>[] = [];
let detailAnswer: Record<string, unknown> = detail();
let acceptAnswers: Response[] = [];
let rejectAnswers: Response[] = [];

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const { pathname, search } = url;
    const method = request.method.toUpperCase();
    requests.push({ method, pathname, search });
    if (method === 'GET' && pathname.endsWith('/clients')) {
      return json(200, {
        items: [{ id: CLIENT_ID, tenantId: TENANT_ID, code: 'GLOW', name: 'GlowCo', status: 'active', systemOwned: false, createdAt: '', updatedAt: '' }],
      });
    }
    if (method === 'GET' && pathname.endsWith('/catalog/skus')) {
      return json(200, { items: [sku('sku-a', 'PLAIN-A'), sku('sku-s', 'SER-S', { serialTracked: true })], nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith('/returns/returnable')) {
      return json(200, RETURNABLE);
    }
    if (method === 'GET' && pathname.endsWith('/outbound/orders')) {
      return json(200, {
        items: [
          {
            id: OTHER_ORDER_ID,
            tenantId: TENANT_ID,
            warehouseId: WAREHOUSE_ID,
            status: 'dispatched',
            source: 'manual',
            integrationId: null,
            externalEventId: null,
            clientOrderRef: 'SHOP-2002',
            destination: null,
            createdAt: '2026-09-16T10:00:00.000Z',
            updatedAt: '2026-09-16T10:00:00.000Z',
          },
        ],
        nextCursor: null,
      });
    }
    if (method === 'POST' && /\/returns\/[^/]+\/accept$/.test(pathname)) {
      accepts.push({ pathname, body: (await request.json()) as Record<string, unknown>, key: request.headers.get('Idempotency-Key') });
      return acceptAnswers.shift() ?? json(200, { ...blindRma({ reviewStatus: 'accepted', orderId: ORDER_ID, orderReference: 'SHOP-1001' }), unlinkedLines: [] });
    }
    if (method === 'POST' && /\/returns\/[^/]+\/reject$/.test(pathname)) {
      rejects.push({ pathname, body: (await request.json()) as Record<string, unknown>, key: request.headers.get('Idempotency-Key') });
      return rejectAnswers.shift() ?? json(200, blindRma({ reviewStatus: 'rejected', reviewReasonCode: 'mis-scanned' }));
    }
    if (method === 'GET' && pathname === `/api/v1/tenants/${TENANT_ID}/warehouses`) {
      return json(200, { items: [{ id: WAREHOUSE_ID, code: 'WH-1', name: 'Peenya' }], nextCursor: null });
    }
    if (method === 'GET' && /\/returns\/rma-[^/]+$/.test(pathname)) {
      return json(200, detailAnswer);
    }
    if (method === 'GET' && pathname.endsWith(`/tenants/${TENANT_ID}/returns`)) {
      return json(200, { items: listItems, nextCursor: null });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  accepts = [];
  rejects = [];
  listItems = [blindRma()];
  detailAnswer = detail();
  acceptAnswers = [];
  rejectAnswers = [];
  stubRouter();
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
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function setInput(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function setSelect(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function button(container: Element, label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === label);
}

async function press(target: HTMLElement | null | undefined): Promise<void> {
  expect(target).toBeTruthy();
  await act(async () => {
    target!.click();
  });
  await settle();
}

function radio(container: Element, label: string): HTMLInputElement {
  const found = [...container.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label));
  expect(found).toBeDefined();
  return found!.querySelector('input') as HTMLInputElement;
}

function field<T extends Element>(container: Element, label: string): T {
  const element = container.querySelector(`[aria-label="${label}"]`);
  expect(element).not.toBeNull();
  return element as unknown as T;
}

async function mountQueue(): Promise<Rendered> {
  writeSession(session('ops_manager'));
  const rendered = render(<BlindReviewQueue tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH-1 Peenya" />);
  await settle();
  return rendered;
}

const listGets = () => requests.filter((r) => r.method === 'GET' && r.pathname.endsWith(`/tenants/${TENANT_ID}/returns`));

describe('the Unannounced tab — the review cards (story 4-7b)', () => {
  test('lists the warehouse\'s pending blind returns, and each card reads its detail', async () => {
    detailAnswer = detail({
      openRmasForSuggestedOrder: [{ id: 'rma-12', code: 'RMA-0012', status: 'open' }],
      sameParcelRmas: [{ id: 'rma-40', code: 'RMA-0040', reviewStatus: 'rejected' }],
    });
    view = await mountQueue();
    const params = new URLSearchParams(listGets()[0]!.search);
    expect(params.get('warehouseId')).toBe(WAREHOUSE_ID);
    expect(params.get('origin')).toBe('blind');
    expect(params.get('reviewStatus')).toBe('pending');
    const card = view.container.querySelector('[data-testid="blind-review-card"]')!;
    const text = card.textContent ?? '';
    for (const expected of [
      'RMA-0042',
      'Unannounced',
      'Awaiting review',
      'GLOW — GlowCo',
      'WH-1 Peenya',
      'ravi@example.com',
      'AWB123',
      'SHOP-1001',
      'matched by AWB',
      'PLAIN-A',
      'batch B9',
      'serial SN-1',
      'RMA-0012 is open for the suggested order',
      'Also received as RMA-0040 (Reversed)',
      '“No order” links nothing',
    ]) {
      expect(text).toContain(expected);
    }
    // IST: 04:30Z is 10:00 IST.
    expect(card.querySelector('time')?.textContent).toContain('10:00');
    expect(card.querySelector('[data-testid="client-prompted-warning"]')).toBeNull();
  });

  test('Accept with the suggestion: prefilled, previews the links, POSTs {orderId} with a key and shows the banner', async () => {
    view = await mountQueue();
    await press(button(view.container, 'Accept…'));
    const dialog = view.container.querySelector('[aria-label="Accept RMA-0042"]')!;
    expect(radio(dialog, 'The suggested order').checked).toBe(true);
    const preview = dialog.querySelector('[data-testid="link-preview"]')!.textContent ?? '';
    expect(preview).toContain('PLAIN-A × 2 — links to the order');
    expect(preview).toContain('SER-S × 1 — stays unlinked');
    const before = listGets().length;
    await press(button(dialog, 'Accept'));
    expect(accepts).toHaveLength(1);
    expect(accepts[0]!.pathname.endsWith('/returns/rma-42/accept')).toBe(true);
    expect(accepts[0]!.body).toEqual({ orderId: ORDER_ID });
    expect(accepts[0]!.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(view.container.textContent).toContain('RMA-0042 accepted — linked to order SHOP-1001');
    expect(listGets().length).toBeGreaterThan(before);
  });

  test('Accept names the unlinked lines from the response', async () => {
    acceptAnswers = [json(200, { ...blindRma({ reviewStatus: 'accepted', orderId: ORDER_ID, orderReference: 'SHOP-1001' }), unlinkedLines: ['rl-2'] })];
    view = await mountQueue();
    await press(button(view.container, 'Accept…'));
    await press(button(view.container.querySelector('[aria-label="Accept RMA-0042"]')!, 'Accept'));
    expect(view.container.textContent).toContain('Not linked (no order line could take it): SER-S × 1');
  });

  test('Accept with "No order" sends null and says so', async () => {
    acceptAnswers = [json(200, { ...blindRma({ reviewStatus: 'accepted' }), unlinkedLines: ['rl-1', 'rl-2'] })];
    view = await mountQueue();
    await press(button(view.container, 'Accept…'));
    const dialog = view.container.querySelector('[aria-label="Accept RMA-0042"]')!;
    await press(radio(dialog, 'No order'));
    expect(dialog.querySelector('[data-testid="link-preview"]')).toBeNull();
    await press(button(dialog, 'Accept'));
    expect(accepts[0]!.body).toEqual({ orderId: null });
    expect(view.container.textContent).toContain('RMA-0042 accepted with no order');
  });

  test('Accept with another order: the search is scoped to the client, the warehouse and dispatched orders', async () => {
    view = await mountQueue();
    await press(button(view.container, 'Accept…'));
    const dialog = view.container.querySelector('[aria-label="Accept RMA-0042"]')!;
    await press(radio(dialog, 'Another order'));
    // Nothing picked yet: Accept refuses client-side.
    await press(button(dialog, 'Accept'));
    expect(accepts).toHaveLength(0);
    setInput(field<HTMLInputElement>(dialog, 'Order reference'), ' SHOP-2002 ');
    await press(button(dialog, 'Search'));
    const search = requests.filter((r) => r.pathname.endsWith('/outbound/orders')).at(-1)!;
    expect(search.pathname).toContain(`/warehouses/${WAREHOUSE_ID}/`);
    const params = new URLSearchParams(search.search);
    expect(params.get('reference')).toBe('SHOP-2002');
    expect(params.get('clientId')).toBe(CLIENT_ID);
    expect(params.get('status')).toBe('dispatched');
    expect(dialog.textContent).toContain('SHOP-2002');
    await press(button(dialog, 'Accept'));
    expect(accepts[0]!.body).toEqual({ orderId: OTHER_ORDER_ID });
  });

  test('a client the operator chose: the warning shows, and Accept waits for the ticked confirmation', async () => {
    listItems = [blindRma({ clientPrompted: true })];
    detailAnswer = detail({ clientPrompted: true });
    view = await mountQueue();
    expect(view.container.querySelector('[data-testid="client-prompted-warning"]')?.textContent).toContain(
      "Client chosen by the operator — the barcode is also another client's",
    );
    await press(button(view.container, 'Accept…'));
    const dialog = view.container.querySelector('[aria-label="Accept RMA-0042"]')!;
    expect(button(dialog, 'Accept')!.disabled).toBe(true);
    expect(dialog.textContent).toContain("I checked these goods are GLOW — GlowCo's");
    await press(field<HTMLInputElement>(dialog, 'Confirm the client'));
    expect(button(dialog, 'Accept')!.disabled).toBe(false);
    await press(button(dialog, 'Accept'));
    expect(accepts).toHaveLength(1);
  });

  test('Reject: nothing is sent until the draft is valid; a refusal shows by code and keeps the dialog; a retry reuses the key', async () => {
    rejectAnswers = [
      json(409, { type: 'x', title: 'Reject above the write-off threshold', status: 409, code: 'reject-above-threshold', detail: 'd', threshold: 10, totalQty: 12 }),
    ];
    view = await mountQueue();
    await press(button(view.container, 'Reject…'));
    const dialog = view.container.querySelector('[aria-label="Reject RMA-0042"]')!;
    await press(button(dialog, 'Reject and reverse'));
    expect(rejects).toHaveLength(0);
    expect(dialog.textContent).toContain('Pick why this parcel is rejected.');
    setSelect(field<HTMLSelectElement>(dialog, 'Reject reason'), 'other');
    await settle();
    await press(button(dialog, 'Reject and reverse'));
    expect(rejects).toHaveLength(0);
    expect(dialog.textContent).toContain('The reason “Other” needs a note saying why.');
    setSelect(field<HTMLSelectElement>(dialog, 'Reject reason'), 'not-our-goods');
    await settle();
    expect(dialog.querySelector('[data-testid="not-our-goods-hint"]')?.textContent).toContain(
      'Hand these back to the carrier or receive them for the right client',
    );
    setInput(field<HTMLTextAreaElement>(dialog, 'Reject note'), ' wrong brand ');
    await press(button(dialog, 'Reject and reverse'));
    expect(rejects).toHaveLength(1);
    expect(rejects[0]!.body).toEqual({ reasonCode: 'not-our-goods', note: 'wrong brand' });
    expect(view.container.querySelector('[aria-label="Reject RMA-0042"]')).not.toBeNull();
    expect(view.container.textContent).toContain('Rejecting removes 12 units, above your write-off threshold of 10');
    await press(button(view.container.querySelector('[aria-label="Reject RMA-0042"]')!, 'Reject and reverse'));
    expect(rejects).toHaveLength(2);
    expect(rejects[1]!.key).toBe(rejects[0]!.key);
    expect(view.container.textContent).toContain('RMA-0042 rejected');
  });

  test('"Reject as received against RMA-X" sends the duplicate reason with its note', async () => {
    detailAnswer = detail({ openRmasForSuggestedOrder: [{ id: 'rma-12', code: 'RMA-0012', status: 'open' }] });
    view = await mountQueue();
    await press(button(view.container, 'Reject as received against RMA-0012'));
    const dialog = view.container.querySelector('[aria-label="Reject RMA-0042"]')!;
    expect(dialog.querySelector('[data-testid="received-against-hint"]')?.textContent).toContain('Receive these units against RMA-0012');
    await press(button(dialog, 'Reject and reverse'));
    expect(rejects[0]!.body).toEqual({ reasonCode: 'duplicate', note: 'Received against RMA-0012' });
  });

  test('a review decided elsewhere closes the dialog, says so and re-reads the queue', async () => {
    acceptAnswers = [json(409, { type: 'x', title: 'Decided', status: 409, code: 'review-not-pending', detail: 'd', reviewStatus: 'rejected' })];
    view = await mountQueue();
    await press(button(view.container, 'Accept…'));
    const before = listGets().length;
    await press(button(view.container.querySelector('[aria-label="Accept RMA-0042"]')!, 'Accept'));
    expect(view.container.querySelector('[aria-label="Accept RMA-0042"]')).toBeNull();
    expect(view.container.textContent).toContain("This parcel's review is already reversed — the queue has refreshed.");
    expect(listGets().length).toBeGreaterThan(before);
  });

  test('one dialog at a time: another card\'s actions are disabled while one is open', async () => {
    listItems = [blindRma(), blindRma({ id: 'rma-43', code: 'RMA-0043' })];
    view = await mountQueue();
    const cards = [...view.container.querySelectorAll('[data-testid="blind-review-card"]')];
    expect(cards).toHaveLength(2);
    await press(button(cards[0]!, 'Accept…'));
    expect(button(cards[1]!, 'Accept…')!.disabled).toBe(true);
    expect(button(cards[1]!, 'Reject…')!.disabled).toBe(true);
  });
});

describe('the Returns page — the Unannounced tab gate (story 4-7b)', () => {
  test('an ops manager sees the tab with its pending count; an operator sees no tab, and a deep link reads a sentence', async () => {
    writeSession(session('ops_manager'));
    view = render(<ReturnsView />);
    await settle();
    const tab = [...view.container.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.startsWith('Unannounced'));
    expect(tab).toBeDefined();
    expect(tab!.querySelector('[aria-label="1 awaiting review"]')).not.toBeNull();
    view.unmount();
    writeSession(session('operator'));
    view = render(<ReturnsView />);
    await settle();
    expect([...view.container.querySelectorAll('[role="tab"]')].some((t) => t.textContent?.startsWith('Unannounced'))).toBe(false);
    view.unmount();
    view = render(<ReturnsView initialTab="unannounced" />);
    await settle();
    expect(view.container.querySelector('[data-testid="unannounced-denied"]')?.textContent).toBe('Your role cannot review unannounced returns.');
    expect(view.container.querySelector('[data-testid="blind-review-card"]')).toBeNull();
  });

  test('the default list labels a blind return "Unannounced" with its review badge', async () => {
    writeSession(session('ops_manager'));
    view = render(<ReturnsView />);
    await settle();
    const row = [...view.container.querySelectorAll('tr')].find((r) => r.textContent?.includes('RMA-0042'))!;
    expect(row.textContent).toContain('Unannounced');
    expect(row.textContent).toContain('Awaiting review');
  });
});
