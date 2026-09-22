import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { KIT_PARENT_HOLDS_LABEL } from '../../lib/outbound-orders';
import { OrderDetailPanel } from './outbound-orders';

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
  tenant: { id: TENANT_ID, name: 'Priya Spices' },
  user: { id: 'u-1', email: 'priya@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

let requests: { method: string; pathname: string }[] = [];
let order: Record<string, unknown> | null = null;

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