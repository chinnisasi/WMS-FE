import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { writeActiveClientId } from '../../lib/active-client';
import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { RETURNS_CHANGED_EVENT } from '../../lib/returns';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import type { UserRole } from '../../lib/users';
import { OrderDetailPanel, OutboundOrders } from '../outbound/outbound-orders';
import { ReturnsList, ReturnsView } from './returns-view';

/**
 * Story 13-1 — the web half of return authorizations. The claims a `src/lib`
 * test cannot make:
 *   1. "Create return" renders for a DISPATCHED order and the capability only,
 *      and the returnable read is fetched when the form opens — never on expand;
 *   2. the form groups kit components under their parent, filters and
 *      selects serials, and sends only the lines above zero, with a key per
 *      draft (reused on a retry of an unchanged draft, new after an edit);
 *   3. success shows the RMA code with a link to /returns and fires the
 *      returns change event; a 409 that moved the bound reloads the read and
 *      clears the key;
 *   4. the Returns list reads the active warehouse, filters status on the
 *      server, expands a row into its lines, and offers Cancel — an inline
 *      confirmation with a reason — only to `returns.manage` on an open row.
 * Driven through a stubbed global `fetch`, so the wiring under test ships.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
const ORDER_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000b1';

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

function orderLine(id: string, skuId: string, parentLineId: string | null = null): Record<string, unknown> {
  return {
    id,
    orderId: ORDER_ID,
    skuId,
    qty: 2,
    reservedQty: 0,
    shortfallQty: 0,
    status: 'open',
    reservationId: null,
    reservationState: null,
    parentLineId,
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

const RETURNABLE = {
  orderId: ORDER_ID,
  status: 'dispatched',
  warehouseId: WAREHOUSE_ID,
  orderReference: null,
  dispatchedAt: '2026-10-15T00:00:00.000Z',
  lines: [
    { orderLineId: 'l-plain', parentLineId: null, skuId: 'sku-a', kitParent: false, dispatchedQty: 3, authorizedQty: 1, returnableQty: 2, serialTracked: false, returnableSerials: [] },
    { orderLineId: 'l-kit', parentLineId: null, skuId: 'sku-kit', kitParent: true, dispatchedQty: 0, authorizedQty: 0, returnableQty: 0, serialTracked: false, returnableSerials: [] },
    { orderLineId: 'l-comp', parentLineId: 'l-kit', skuId: 'sku-c', kitParent: false, dispatchedQty: 2, authorizedQty: 0, returnableQty: 2, serialTracked: false, returnableSerials: [] },
    {
      orderLineId: 'l-ser',
      parentLineId: null,
      skuId: 'sku-s',
      kitParent: false,
      dispatchedQty: 3,
      authorizedQty: 0,
      returnableQty: 3,
      serialTracked: true,
      returnableSerials: [
        { id: 's1', serialNumber: 'SN-AB1' },
        { id: 's2', serialNumber: 'SN-AB2' },
        { id: 's3', serialNumber: 'SN-XY3' },
      ],
    },
  ],
};

function rma(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'rma-1',
    code: 'RMA-0007',
    status: 'open',
    orderId: ORDER_ID,
    orderReference: 'SHOP-#1001',
    warehouseId: WAREHOUSE_ID,
    clientId: 'client-1',
    externalReference: 'CH-77',
    orderDispatchedAt: '2026-10-15T00:00:00.000Z',
    createdAt: '2026-10-16T04:30:00.000Z',
    createdBy: 'u-1',
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    lines: [
      { id: 'rl-1', orderLineId: 'l-plain', skuId: 'sku-a', authorizedQty: 2, receivedQty: 0, reasonCode: 'damaged', reasonNote: null, serials: [] },
      {
        id: 'rl-2',
        orderLineId: 'l-ser',
        skuId: 'sku-s',
        authorizedQty: 1,
        receivedQty: 0,
        reasonCode: 'other',
        reasonNote: 'box torn',
        serials: [{ id: 's1', serialNumber: 'SN-AB1' }],
      },
    ],
    ...over,
  };
}

let requests: { method: string; pathname: string; search: string }[] = [];
let creates: { body: Record<string, unknown>; key: string | null }[] = [];
let cancels: { pathname: string; body: Record<string, unknown>; key: string | null }[] = [];
let orderStatus = 'dispatched';
/** Story 1-2a — the order's client and the clients read (null = no clients route answer). */
let orderClientId: string | null = null;
let clientItems: unknown[] | null = null;
let createAnswers: Response[] = [];
let listItems: Record<string, unknown>[] = [];
let returnableAnswer: Record<string, unknown> = RETURNABLE;
let cancelAnswers: Response[] = [];
let detailAnswer: Record<string, unknown> | null = null;

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const { pathname, search } = url;
    const method = request.method.toUpperCase();
    requests.push({ method, pathname, search });
    if (method === 'GET' && /\/outbound\/orders\/[^/]+$/.test(pathname)) {
      return json(200, {
        order: {
          id: ORDER_ID,
          tenantId: TENANT_ID,
          warehouseId: WAREHOUSE_ID,
          status: orderStatus,
          ...(orderClientId === null ? {} : { clientId: orderClientId }),
          source: 'manual',
          integrationId: null,
          externalEventId: null,
          destination: null,
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
          lines: [orderLine('l-plain', 'sku-a'), orderLine('l-kit', 'sku-kit'), orderLine('l-comp', 'sku-c', 'l-kit'), orderLine('l-ser', 'sku-s')],
        },
      });
    }
    if (method === 'GET' && pathname.endsWith('/clients') && clientItems !== null) {
      return json(200, { items: clientItems });
    }
    if (method === 'GET' && pathname.endsWith('/catalog/skus')) {
      return json(200, {
        items: [sku('sku-a', 'PLAIN-A'), sku('sku-kit', 'KIT-1'), sku('sku-c', 'COMP-C'), sku('sku-s', 'SER-S', { serialTracked: true })],
        nextCursor: null,
      });
    }
    if (method === 'GET' && pathname.endsWith('/returns/returnable')) {
      return json(200, returnableAnswer);
    }
    if (method === 'POST' && pathname.endsWith(`/tenants/${TENANT_ID}/returns`)) {
      creates.push({ body: (await request.json()) as Record<string, unknown>, key: request.headers.get('Idempotency-Key') });
      return createAnswers.shift() ?? json(201, rma());
    }
    if (method === 'POST' && /\/returns\/[^/]+\/cancel$/.test(pathname)) {
      cancels.push({ pathname, body: (await request.json()) as Record<string, unknown>, key: request.headers.get('Idempotency-Key') });
      return cancelAnswers.shift() ?? json(200, rma({ status: 'cancelled', cancelReason: 'kept it' }));
    }
    if (method === 'GET' && pathname === `/api/v1/tenants/${TENANT_ID}/warehouses`) {
      return json(200, { items: [{ id: WAREHOUSE_ID, code: 'WH-1', name: 'Peenya' }], nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith('/outbound/orders')) {
      return json(200, {
        items: [
          {
            id: ORDER_ID,
            tenantId: TENANT_ID,
            warehouseId: WAREHOUSE_ID,
            status: 'dispatched',
            source: 'manual',
            integrationId: null,
            externalEventId: null,
            destination: null,
            createdAt: '2026-09-16T10:00:00.000Z',
            updatedAt: '2026-09-16T10:00:00.000Z',
          },
        ],
        nextCursor: null,
      });
    }
    if (method === 'GET' && /\/returns\/rma-[^/]+$/.test(pathname)) {
      return detailAnswer === null ? json(404, { code: 'not-found', title: 'x', status: 404 }) : json(200, detailAnswer);
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
  creates = [];
  cancels = [];
  createAnswers = [];
  listItems = [];
  returnableAnswer = RETURNABLE;
  cancelAnswers = [];
  detailAnswer = null;
  orderStatus = 'dispatched';
  orderClientId = null;
  clientItems = null;
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
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
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

function button(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === label);
}

async function press(target: HTMLElement | null | undefined): Promise<void> {
  expect(target).toBeTruthy();
  await act(async () => {
    target!.click();
  });
  await settle();
}

function field<T extends Element>(container: HTMLElement, label: string): T {
  const element = container.querySelector(`[aria-label="${label}"]`);
  expect(element).not.toBeNull();
  return element as unknown as T;
}

const returnableGets = () => requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/returns/returnable')).length;

async function mountPanel(role: UserRole, canManageReturns: boolean): Promise<Rendered> {
  writeSession(session(role));
  const rendered = render(<OrderDetailPanel orderId={ORDER_ID} warehouseId={WAREHOUSE_ID} canManageReturns={canManageReturns} />);
  await settle();
  return rendered;
}

async function openForm(rendered: Rendered): Promise<void> {
  await press(button(rendered.container, 'Create return'));
  expect(rendered.container.querySelector('form[aria-label="Create return"]')).not.toBeNull();
}

describe('order detail: Create return (story 13-1)', () => {
  // Story 1-2a — a departed client's order offers no Create return; the words say why.
  test('hidden for a departed client’s order, with "Client departed — reactivate to accept returns"', async () => {
    orderClientId = 'c-gone';
    clientItems = [
      { id: 'c-gone', tenantId: TENANT_ID, code: 'GONE', name: 'Gone', status: 'departed', systemOwned: false, createdAt: '', updatedAt: '' },
    ];
    view = await mountPanel('ops_manager', true);
    expect(button(view.container, 'Create return')).toBeUndefined();
    expect(view.container.querySelector('[data-testid="return-client-departed"]')?.textContent).toBe(
      'Client departed — reactivate to accept returns',
    );
    view.unmount();
    clientItems = [
      { id: 'c-gone', tenantId: TENANT_ID, code: 'GONE', name: 'Gone', status: 'suspended', systemOwned: false, createdAt: '', updatedAt: '' },
    ];
    view = await mountPanel('ops_manager', true);
    expect(button(view.container, 'Create return')).toBeDefined();
  });

  test('offered only for a dispatched order with the capability, and nothing is fetched until it is opened', async () => {
    view = await mountPanel('ops_manager', true);
    expect(button(view.container, 'Create return')).toBeDefined();
    expect(returnableGets()).toBe(0);
    view.unmount();

    view = await mountPanel('operator', false);
    expect(button(view.container, 'Create return')).toBeUndefined();
    view.unmount();

    orderStatus = 'accepted';
    view = await mountPanel('owner', true);
    expect(button(view.container, 'Create return')).toBeUndefined();
    expect(returnableGets()).toBe(0);
  });

  test('the form reads the returnable lines on open, groups kit components, and filters and selects serials', async () => {
    view = await mountPanel('owner', true);
    await openForm(view);
    expect(returnableGets()).toBe(1);
    const text = view.container.textContent ?? '';
    expect(text).toContain('Return the components below');
    expect(text).toContain('3 each dispatched · 1 each already on returns · 2 each returnable');
    // The kit parent has no quantity input; its component does.
    expect(view.container.querySelector('[aria-label="Quantity for KIT-1"]')).toBeNull();
    expect(view.container.querySelector('[aria-label="Quantity for COMP-C"]')).not.toBeNull();

    setInput(field<HTMLInputElement>(view.container, 'Filter serials for SER-S'), 'ab');
    const listed = [...view.container.querySelectorAll('li label span.font-mono')].map((s) => s.textContent);
    expect(listed).toEqual(['SN-AB1', 'SN-AB2']);
    await press(button(view.container, 'Select all'));
    expect(field<HTMLElement>(view.container, 'Quantity for SER-S').textContent).toBe('2 selected');
  });

  test('submit sends only the lines above zero with a key per draft; success links to /returns and fires the change event', async () => {
    const fired: string[] = [];
    window.addEventListener(RETURNS_CHANGED_EVENT, () => fired.push(RETURNS_CHANGED_EVENT));
    view = await mountPanel('owner', true);
    await openForm(view);
    setInput(field<HTMLInputElement>(view.container, 'Quantity for PLAIN-A'), '2');
    setSelect(field<HTMLSelectElement>(view.container, 'Reason for PLAIN-A'), 'damaged');
    setInput(field<HTMLInputElement>(view.container, 'Quantity for COMP-C'), '0');
    setSelect(field<HTMLSelectElement>(view.container, 'Reason for COMP-C'), 'defective');
    setInput(field<HTMLInputElement>(view.container, 'Filter serials for SER-S'), 'XY');
    await press(button(view.container, 'Select all'));
    setSelect(field<HTMLSelectElement>(view.container, 'Reason for SER-S'), 'other');
    setInput(field<HTMLInputElement>(view.container, 'Note for SER-S'), 'scratched');

    // A failure first: the retry of the unchanged draft reuses the key.
    createAnswers = [json(409, { code: 'conflict', title: 'Concurrent idempotent request', status: 409, detail: 'retry' })];
    await press(button(view.container, 'Create return'));
    expect(creates).toHaveLength(1);
    await press(button(view.container, 'Create return'));
    expect(creates).toHaveLength(2);
    expect(creates[1]!.key).toBe(creates[0]!.key);
    expect(creates[1]!.body).toEqual({
      orderId: ORDER_ID,
      lines: [
        { orderLineId: 'l-plain', qty: 2, reasonCode: 'damaged' },
        { orderLineId: 'l-ser', qty: 1, reasonCode: 'other', reasonNote: 'scratched', serialNumbers: ['SN-XY3'] },
      ],
    });
    const text = view.container.textContent ?? '';
    expect(text).toContain('Return RMA-0007 created');
    const link = [...view.container.querySelectorAll('a')].find((a) => a.textContent === 'View returns');
    expect(link?.getAttribute('href')).toBe('/returns');
    expect(fired).toEqual([RETURNS_CHANGED_EVENT]);
    // The form closed on success.
    expect(view.container.querySelector('form[aria-label="Create return"]')).toBeNull();
  });

  test('an edit mints a new key; a 409 exceeds-returnable shows its reason, reloads the read and clears the key', async () => {
    view = await mountPanel('owner', true);
    await openForm(view);
    setInput(field<HTMLInputElement>(view.container, 'Quantity for PLAIN-A'), '2');
    setSelect(field<HTMLSelectElement>(view.container, 'Reason for PLAIN-A'), 'damaged');
    createAnswers = [
      json(503, { code: 'reservation-store-unavailable', title: 'x', status: 503, detail: 'try again' }),
      json(409, { code: 'exceeds-returnable', title: 'More', status: 409, detail: 'd', orderLineId: 'l-plain', returnableQty: 1 }),
    ];
    await press(button(view.container, 'Create return'));
    setInput(field<HTMLInputElement>(view.container, 'Quantity for PLAIN-A'), '3');
    await press(button(view.container, 'Create return'));
    expect(creates[1]!.key).not.toBe(creates[0]!.key);
    expect(view.container.textContent).toContain('More than can be returned — 1 left');
    expect(returnableGets()).toBe(2);
    await press(button(view.container, 'Create return'));
    expect(creates[2]!.key).not.toBe(creates[1]!.key);
  });
});

describe('order detail: the draft after a 409 reload (review fix)', () => {
  test('a refused serial and a line with nothing left drop out of the draft — the refusal is not resent', async () => {
    view = await mountPanel('owner', true);
    await openForm(view);
    setInput(field<HTMLInputElement>(view.container, 'Quantity for PLAIN-A'), '2');
    setSelect(field<HTMLSelectElement>(view.container, 'Reason for PLAIN-A'), 'damaged');
    setInput(field<HTMLInputElement>(view.container, 'Filter serials for SER-S'), 'XY');
    await press(button(view.container, 'Select all'));
    setSelect(field<HTMLSelectElement>(view.container, 'Reason for SER-S'), 'damaged');
    createAnswers = [json(409, { code: 'serial-already-authorized', title: 'x', status: 409, detail: 'd', orderLineId: 'l-ser', serialNumber: 'SN-XY3' })];
    // The re-read: SN-XY3 is gone, and PLAIN-A has nothing left.
    returnableAnswer = {
      ...RETURNABLE,
      lines: RETURNABLE.lines.map((line) =>
        line.orderLineId === 'l-plain'
          ? { ...line, authorizedQty: 3, returnableQty: 0 }
          : line.orderLineId === 'l-ser'
            ? { ...line, returnableSerials: line.returnableSerials.filter((serial) => serial.serialNumber !== 'SN-XY3') }
            : line,
      ),
    };
    await press(button(view.container, 'Create return'));
    expect(view.container.textContent).toContain('Serial SN-XY3 is already on a return');
    expect(returnableGets()).toBe(2);
    expect(field<HTMLElement>(view.container, 'Quantity for SER-S').textContent).toBe('0 selected');
    await press(button(view.container, 'Create return'));
    // Nothing left to send: the client says so and sends nothing.
    expect(creates).toHaveLength(1);
    expect(view.container.textContent).toContain('Enter a quantity above zero on at least one line.');
  });
});

describe('returns.manage threading and gating, through the real surfaces (review fix)', () => {
  async function mountOrders(role: UserRole): Promise<Rendered> {
    writeSession(session(role));
    const rendered = render(<OutboundOrders tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH-1 Peenya" role={role} />);
    await settle();
    await press([...rendered.container.querySelectorAll('button')].find((b) => b.textContent?.includes(ORDER_ID)));
    return rendered;
  }

  test('OutboundOrders: an ops manager sees Create return on an expanded dispatched order; an operator does not', async () => {
    view = await mountOrders('ops_manager');
    expect(view.container.textContent).toContain('View ledger');
    expect(button(view.container, 'Create return')).toBeDefined();
    view.unmount();
    view = await mountOrders('operator');
    expect(view.container.textContent).toContain('View ledger');
    expect(button(view.container, 'Create return')).toBeUndefined();
  });

  test('the Returns page (sessioned): Cancel for an ops manager, none for an operator', async () => {
    listItems = [rma()];
    writeSession(session('ops_manager'));
    view = render(<ReturnsView />);
    await settle();
    expect(view.container.textContent).toContain('RMA-0007');
    expect(button(view.container, 'Cancel')).toBeDefined();
    view.unmount();
    writeSession(session('operator'));
    view = render(<ReturnsView />);
    await settle();
    expect(view.container.textContent).toContain('RMA-0007');
    expect(button(view.container, 'Cancel')).toBeUndefined();
  });
});

describe('the Returns list (story 13-1)', () => {
  async function mountList(role: UserRole, canManage: boolean): Promise<Rendered> {
    writeSession(session(role));
    const rendered = render(<ReturnsList tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH-1 Peenya" canManage={canManage} />);
    await settle();
    return rendered;
  }
  const listGets = () => requests.filter((r) => r.method === 'GET' && r.pathname.endsWith(`/tenants/${TENANT_ID}/returns`));

  test('an empty warehouse reads "No returns yet"; the read is scoped to the warehouse', async () => {
    view = await mountList('accountant', false);
    expect(view.container.textContent).toContain('No returns yet');
    expect(new URLSearchParams(listGets()[0]!.search).get('warehouseId')).toBe(WAREHOUSE_ID);
  });

  test('rows show code, order reference, status word, lines summary, external ref; the status filter is server-side; a row expands into lines, reasons and serials', async () => {
    listItems = [rma(), rma({ id: 'rma-2', code: 'RMA-0006', status: 'cancelled', orderReference: null, externalReference: null, cancelReason: 'kept it' })];
    view = await mountList('accountant', false);
    const text = view.container.textContent ?? '';
    for (const expected of ['RMA-0007', 'SHOP-#1001', 'Open', '2 lines · 2 SKUs', 'CH-77', 'RMA-0006', ORDER_ID, 'Cancelled']) {
      expect(text).toContain(expected);
    }
    // No Cancel for a role without the capability.
    expect(button(view.container, 'Cancel')).toBeUndefined();
    setSelect(field<HTMLSelectElement>(view.container, 'Status'), 'cancelled');
    await settle();
    expect(new URLSearchParams(listGets().at(-1)!.search).get('status')).toBe('cancelled');

    setSelect(field<HTMLSelectElement>(view.container, 'Status'), '');
    await settle();
    await press([...view.container.querySelectorAll('button')].find((b) => b.textContent?.includes('RMA-0007')));
    const expanded = view.container.textContent ?? '';
    expect(expanded).toContain('Damaged');
    expect(expanded).toContain('Other — box torn');
    expect(expanded).toContain('SN-AB1');
  });

  test('Cancel: only on an open row for returns.manage; an inline confirmation that needs a reason, then POSTs it with a key and refreshes', async () => {
    listItems = [rma(), rma({ id: 'rma-2', code: 'RMA-0006', status: 'cancelled' })];
    view = await mountList('ops_manager', true);
    const cancelButtons = [...view.container.querySelectorAll('button')].filter((b) => b.textContent === 'Cancel');
    expect(cancelButtons).toHaveLength(1);
    await press(cancelButtons[0]);
    await press(button(view.container, 'Cancel this return'));
    expect(cancels).toHaveLength(0);
    expect(view.container.textContent).toContain('Say why — a reason is required.');
    setInput(field<HTMLInputElement>(view.container, 'Cancel reason'), '  kept it  ');
    const before = listGets().length;
    await press(button(view.container, 'Cancel this return'));
    expect(cancels).toHaveLength(1);
    expect(cancels[0]!.pathname.endsWith('/returns/rma-1/cancel')).toBe(true);
    expect(cancels[0]!.body).toEqual({ reason: 'kept it' });
    expect(cancels[0]!.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(view.container.textContent).toContain('Return RMA-0007 cancelled');
    expect(listGets().length).toBeGreaterThan(before);
  });

  test('a retried cancel reuses the confirmation\'s key; a changed reason or a new confirmation mints a new one', async () => {
    listItems = [rma()];
    view = await mountList('ops_manager', true);
    await press(button(view.container, 'Cancel'));
    setInput(field<HTMLInputElement>(view.container, 'Cancel reason'), 'kept it');
    cancelAnswers = [json(503, { code: 'unavailable', title: 'x', status: 503, detail: 'lost' })];
    await press(button(view.container, 'Cancel this return'));
    await press(button(view.container, 'Cancel this return'));
    expect(cancels).toHaveLength(2);
    expect(cancels[1]!.key).toBe(cancels[0]!.key);
    // The success closed it; a new confirmation is a new intent.
    await press(button(view.container, 'Cancel'));
    setInput(field<HTMLInputElement>(view.container, 'Cancel reason'), 'again');
    await press(button(view.container, 'Cancel this return'));
    expect(cancels[2]!.key).not.toBe(cancels[1]!.key);
  });

  test('a confirmation whose row leaves the page is closed, and does not come back with the row', async () => {
    listItems = [rma()];
    view = await mountList('ops_manager', true);
    await press(button(view.container, 'Cancel'));
    expect(view.container.querySelector('[aria-label="Cancel reason"]')).not.toBeNull();
    listItems = [];
    await act(async () => {
      window.dispatchEvent(new Event(RETURNS_CHANGED_EVENT));
    });
    await settle();
    expect(view.container.querySelector('[aria-label="Cancel reason"]')).toBeNull();
    listItems = [rma()];
    await act(async () => {
      window.dispatchEvent(new Event(RETURNS_CHANGED_EVENT));
    });
    await settle();
    expect(view.container.textContent).toContain('RMA-0007');
    expect(view.container.querySelector('[aria-label="Cancel reason"]')).toBeNull();
  });
});

describe('the Returns list — receipts (story 13-2)', () => {
  async function mountList(role: UserRole, canManage: boolean): Promise<Rendered> {
    writeSession(session(role));
    const rendered = render(<ReturnsList tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH-1 Peenya" canManage={canManage} />);
    await settle();
    return rendered;
  }

  function received(): Record<string, unknown> {
    const base = rma({ status: 'partially_received' });
    const lines = (base.lines as Record<string, unknown>[]).map((line) => (line.id === 'rl-1' ? { ...line, receivedQty: 1 } : line));
    return { ...base, lines };
  }

  test('expanding a row fetches the detail: each line\'s received figure, the amber "↩ Awaiting disposition" badge on received lines, and the receipts with the operator and each unit\'s condition', async () => {
    listItems = [received()];
    detailAnswer = {
      ...received(),
      receipts: [
        {
          id: 'rr-1',
          code: 'RRN-0003',
          occurredAt: '2026-10-16T05:00:00.000Z',
          operatorEmail: 'ravi@example.com',
          lines: [
            { rmaLineId: 'rl-1', skuId: 'sku-a', qty: 1, condition: 'missing-parts', note: 'no charger', batchCode: null, serialNumber: null, weightGrams: null },
          ],
        },
      ],
    };
    view = await mountList('ops_manager', true);
    const text = view.container.textContent ?? '';
    expect(text).toContain('Partly received');
    // Cancel is hidden once anything is received (the status is no longer open).
    expect(button(view.container, 'Cancel')).toBeUndefined();
    // The list never fetched a detail; expanding does.
    expect(requests.some((r) => r.pathname.endsWith('/returns/rma-1'))).toBe(false);
    await press([...view.container.querySelectorAll('button')].find((b) => b.textContent?.includes('RMA-0007')));
    await settle();
    expect(requests.some((r) => r.method === 'GET' && r.pathname.endsWith('/returns/rma-1'))).toBe(true);
    const expanded = view.container.textContent ?? '';
    expect(expanded).toContain('1 of 2 each received');
    expect(expanded).toContain('0 of 1 each received');
    expect([...expanded.matchAll(/↩ Awaiting disposition/g)]).toHaveLength(1);
    expect(expanded).toContain('RRN-0003 · ravi@example.com');
    expect(expanded).toContain('1 × Missing parts · “no charger”');
  });

  test('a failed detail read says so, and the lines still show', async () => {
    listItems = [received()];
    view = await mountList('accountant', false);
    await press([...view.container.querySelectorAll('button')].find((b) => b.textContent?.includes('RMA-0007')));
    await settle();
    const expanded = view.container.textContent ?? '';
    expect(expanded).toContain('Receipts unavailable');
    expect(expanded).toContain('1 of 2 each received');
  });

  test('an expanded row refetches its receipts when the row changes (a receipt landed)', async () => {
    listItems = [rma()];
    detailAnswer = { ...rma(), receipts: [] };
    view = await mountList('ops_manager', true);
    await press([...view.container.querySelectorAll('button')].find((b) => b.textContent?.includes('RMA-0007')));
    await settle();
    const detailReads = () => requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/returns/rma-1')).length;
    expect(detailReads()).toBe(1);
    expect(view.container.textContent).not.toContain('RRN-0004');
    // A receipt landed: the row's status and received total moved — refetch.
    listItems = [received()];
    detailAnswer = {
      ...received(),
      receipts: [
        {
          id: 'rr-1',
          code: 'RRN-0004',
          occurredAt: '2026-10-16T05:00:00.000Z',
          operatorEmail: 'ravi@example.com',
          lines: [{ rmaLineId: 'rl-1', skuId: 'sku-a', qty: 1, condition: 'opened', note: null, batchCode: null, serialNumber: null, weightGrams: null }],
        },
      ],
    };
    await act(async () => {
      window.dispatchEvent(new Event(RETURNS_CHANGED_EVENT));
    });
    await settle();
    expect(detailReads()).toBeGreaterThanOrEqual(2);
    expect(view.container.textContent).toContain('RRN-0004');
  });
});


describe('the Returns list: the client filter (story 1-5a)', () => {
  const client = (id: string, code: string, name: string, systemOwned = false) => ({
    id,
    tenantId: TENANT_ID,
    code,
    name,
    status: 'active',
    systemOwned,
    createdAt: '',
    updatedAt: '',
  });
  const listGets = () => requests.filter((r) => r.method === 'GET' && r.pathname.endsWith(`/tenants/${TENANT_ID}/returns`));

  test('under a stored client the list request carries clientId and the chip renders', async () => {
    clientItems = [client('c-self', 'self', 'Peenya Foods', true), client('c-glow', 'GLOWCO', 'GlowCo')];
    writeSession(session('ops_manager'));
    writeActiveClientId(TENANT_ID, 'u-1', 'c-glow');
    view = render(<ReturnsList tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH-1 Peenya" canManage />);
    await settle();
    expect(listGets().length).toBeGreaterThan(0);
    expect(listGets().every((r) => new URLSearchParams(r.search).get('clientId') === 'c-glow')).toBe(true);
    expect(view.container.querySelector('[data-testid="client-filter-chip"]')!.textContent).toContain(
      'Client: GLOWCO — GlowCo',
    );
  });

  test('no stored client: no clientId and no chip', async () => {
    clientItems = [client('c-self', 'self', 'Peenya Foods', true), client('c-glow', 'GLOWCO', 'GlowCo')];
    writeSession(session('ops_manager'));
    view = render(<ReturnsList tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH-1 Peenya" canManage />);
    await settle();
    expect(listGets().every((r) => !new URLSearchParams(r.search).has('clientId'))).toBe(true);
    expect(view.container.querySelector('[data-testid="client-filter-chip"]')).toBeNull();
  });
});
