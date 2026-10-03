import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { ColdChainTrace } from './cold-chain-trace';

/**
 * The cold-chain trace viewer (story 12-6's read surfaced by 12-7; triage
 * rows 1, 8, 9, 16). The claims a `src/lib` test cannot make:
 *   1. a malformed order id refuses CLIENT-SIDE — the inline shape copy
 *      renders and no request is spent, and the shape is the BE's real id
 *      vocabulary: a dashed lowercase UUIDv7 (36 chars), not the
 *      Idempotency-Key ULID the first draft wrongly gated on,
 *   2. a loaded trace reconstructs visibly: the order header, the line's
 *      joined SKU code, each chain hop with the bin's CODE and CURRENT class
 *      (from the response's bins dict), the correlated excursion per line,
 *   3. the refusals are the mapped ones, not raw errors — a 409
 *      `order-not-dispatched` renders the server's detail verbatim and a 404
 *      renders the no-such-order copy — and Retry re-fires the read,
 *   4. a bin missing from the response's bins dict renders `(unknown bin)`,
 *      never the raw uuid,
 *   5. switching warehouses resets the loaded order (the trace belongs to
 *      one warehouse; a re-request under the new one reads as a false 404).
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-222222222222';
const OTHER_WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-2b2222222222';
const ORDER_ID = '0198f7a2-1b3c-7d4e-8f90-0011223344ff';
const BIN_ID = '0198f7a2-1b3c-7d4e-8f90-444444444444';

const SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Priya Spices', gstin: null },
  user: { id: 'u-1', email: 'priya@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly body: unknown;
}

let requests: Recorded[] = [];
/** The next trace GET answer, so a test can force each refusal arm. */
let nextTraceStatus = 200;
let nextTraceBody: unknown = null;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function traceResponse(): Record<string, unknown> {
  return {
    order: {
      id: ORDER_ID,
      status: 'dispatched',
      carrierName: 'BlueDart',
      trackingNumber: 'BD-77',
      dispatchedAt: '2026-09-20T10:00:00.000Z',
    },
    bins: [{ id: BIN_ID, code: 'FR-01', storageClass: 'frozen' }],
    lines: [
      {
        orderLineId: '0198f7a2-1b3c-7d4e-8f90-777777777777',
        skuId: 'sku-1',
        dispatchedQty: 5,
        scopes: [
          {
            batchRef: 'BATCH-9',
            serialRef: null,
            chain: [
              {
                seq: 1,
                type: 'putaway',
                skuId: 'sku-1',
                quantityDelta: 5,
                fromBinId: null,
                fromBinStorageClass: null,
                toBinId: BIN_ID,
                toBinStorageClass: 'frozen',
                batchRef: 'BATCH-9',
                serialRef: null,
                occurredAt: '2026-09-19T08:00:00.000Z',
                referenceDoc: { goodsReceiptId: 'grn-1' },
              },
              {
                seq: 2,
                type: 'pick',
                skuId: 'sku-1',
                quantityDelta: -5,
                fromBinId: BIN_ID,
                fromBinStorageClass: 'frozen',
                toBinId: null,
                toBinStorageClass: null,
                batchRef: 'BATCH-9',
                serialRef: null,
                occurredAt: '2026-09-20T09:30:00.000Z',
                referenceDoc: { orderId: ORDER_ID },
              },
            ],
          },
        ],
        excursions: [
          { excursionId: '0198f7a2-1b3c-7d4e-8f90-888888888888', binId: BIN_ID, readingC: -12.5, occurredAt: '2026-09-19T23:00:00.000Z' },
        ],
      },
    ],
  };
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    requests.push({ method, pathname, body });
    if (method === 'GET' && pathname.endsWith('/warehouses')) {
      return json(200, {
        items: [
          { id: WAREHOUSE_ID, code: 'W1', name: 'Main', origin: {}, createdAt: '2026-09-01T00:00:00.000Z' },
          { id: OTHER_WAREHOUSE_ID, code: 'W2', name: 'Annex', origin: {}, createdAt: '2026-09-02T00:00:00.000Z' },
        ],
        nextCursor: null,
      });
    }
    if (method === 'GET' && pathname.endsWith('/catalog/skus')) {
      return json(200, { items: [{ id: 'sku-1', code: 'ICE-01', uomConversions: [] }], nextCursor: null });
    }
    if (method === 'GET' && pathname.includes('/cold-chain/orders/')) {
      if (nextTraceStatus !== 200) {
        const status = nextTraceStatus;
        const refusal = nextTraceBody;
        nextTraceStatus = 200;
        nextTraceBody = null;
        return json(status, refusal);
      }
      return json(200, traceResponse());
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  nextTraceStatus = 200;
  nextTraceBody = null;
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
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(): Promise<Rendered> {
  const rendered = render(<ColdChainTrace />);
  await settle();
  return rendered;
}

/** A controlled React input needs the native setter or React never sees it. */
function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function submitLookup(container: HTMLElement): void {
  const form = container.querySelector('form')!;
  act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

function orderInput(container: HTMLElement): HTMLInputElement {
  // The Order id field is the input inside the surface's single form (the
  // warehouse picker is a label, the lookup is a form).
  const input = container.querySelector('form input');
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}

async function loadOrder(container: HTMLElement, orderId: string): Promise<void> {
  setInput(orderInput(container), orderId);
  submitLookup(container);
  await settle();
}

describe('ColdChainTrace: the order-id gate (triage row 1)', () => {
  test('a malformed order id refuses client-side — the inline copy renders, no request is spent', async () => {
    view = await mount();
    await loadOrder(view.container, 'not-a-uuid');
    expect(view.container.textContent).toContain('36-character UUID');
    expect(requests.some((r) => r.pathname.includes('/cold-chain/orders/'))).toBe(false);
  });

  test('the id vocabulary is the UUID, not the Idempotency-Key ULID — a ULID refuses, a UUIDv7 fetches', async () => {
    view = await mount();
    // A 26-char Crockford ULID is the Idempotency-Key vocabulary — every BE
    // entity id is a dashed UUIDv7, so a ULID must refuse inline.
    await loadOrder(view.container, '01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(view.container.textContent).toContain('36-character UUID');
    expect(requests.some((r) => r.pathname.includes('/cold-chain/orders/'))).toBe(false);

    // The real shape passes — uppercase paste is trimmed and lowercased
    // before the fetch.
    await loadOrder(view.container, ORDER_ID.toUpperCase());
    const traceGet = requests.find((r) => r.pathname.includes('/cold-chain/orders/'));
    expect(traceGet).toBeDefined();
    expect(traceGet!.pathname).toBe(
      `/api/v1/tenants/${TENANT_ID}/warehouses/${WAREHOUSE_ID}/cold-chain/orders/${ORDER_ID}`,
    );
  });

  test('the input accepts a full 36-character paste (maxLength does not truncate)', async () => {
    view = await mount();
    const input = orderInput(view.container);
    expect(input.maxLength).toBe(36);
  });
});

describe('ColdChainTrace: the reconstruction (triage rows 9, 16)', () => {
  test('the trace renders the order header, the joined SKU, every hop with bin code and current class, and the excursion', async () => {
    view = await mount();
    await loadOrder(view.container, ORDER_ID);

    // The order header: id, status, carrier, tracking, dispatched time.
    expect(view.container.textContent).toContain(ORDER_ID);
    expect(view.container.textContent).toContain('dispatched');
    expect(view.container.textContent).toContain('BlueDart');
    expect(view.container.textContent).toContain('BD-77');
    // The line's sku join: ICE-01, never the raw sku id.
    expect(view.container.textContent).toContain('ICE-01');
    expect(view.container.textContent).toContain('5 dispatched');
    // Each hop names the bin through the bins dict — code + CURRENT class.
    expect(view.container.textContent).toContain('FR-01 (frozen)');
    expect(view.container.textContent).not.toContain(BIN_ID);
    expect(view.container.textContent).toContain('#1');
    expect(view.container.textContent).toContain('#2');
    expect(view.container.textContent).toContain('putaway');
    expect(view.container.textContent).toContain('pick');
    expect(view.container.textContent).toContain('batch BATCH-9');
    // The quantity rides verbatim — signed, never client-rounded.
    expect(view.container.textContent).toContain('-5');
    // The correlated excursion, per line, with its reading verbatim.
    expect(view.container.textContent).toContain('Excursions during the chain');
    expect(view.container.textContent).toContain('-12.5 °C');
    // The reference doc renders raw.
    expect(view.container.textContent).toContain('goodsReceiptId');
  });

  test('a bin missing from the bins dict renders (unknown bin), never the raw uuid (triage row 9)', async () => {
    view = await mount();
    // The stub's excursion binId (BIN_ID) is not in the response's bins
    // dict — the join is empty.
    const response = traceResponse();
    (response as { bins: unknown[] }).bins = [];
    stubGlobal('fetch', (async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input.toString());
      const { pathname } = new URL(request.url);
      if (request.method === 'GET' && pathname.endsWith('/warehouses')) {
        return json(200, {
          items: [{ id: WAREHOUSE_ID, code: 'W1', name: 'Main', origin: {}, createdAt: '2026-09-01T00:00:00.000Z' }],
          nextCursor: null,
        });
      }
      if (request.method === 'GET' && pathname.endsWith('/catalog/skus')) {
        return json(200, { items: [{ id: 'sku-1', code: 'ICE-01', uomConversions: [] }], nextCursor: null });
      }
      if (request.method === 'GET' && pathname.includes('/cold-chain/orders/')) {
        return json(200, response);
      }
      return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
    }) as unknown as typeof fetch);
    view.unmount();
    view = await mount();
    await loadOrder(view.container, ORDER_ID);

    expect(view.container.textContent).toContain('-12.5 °C');
    expect(view.container.textContent).toContain('(unknown bin)');
    expect(view.container.textContent).not.toContain(BIN_ID);
  });
});

describe('ColdChainTrace: the refusals and Retry (triage row 16)', () => {
  test('a 409 order-not-dispatched renders the server detail verbatim with a Retry', async () => {
    nextTraceStatus = 409;
    nextTraceBody = {
      code: 'order-not-dispatched',
      title: 'Order not dispatched',
      status: 409,
      detail: `Order ${ORDER_ID} is still picking.`,
    };
    view = await mount();
    await loadOrder(view.container, ORDER_ID);

    expect(view.container.textContent).toContain('Trace unavailable');
    expect(view.container.textContent).toContain(`Order ${ORDER_ID} is still picking.`);
    expect(view.container.textContent).toContain('Retry');
  });

  test('a 404 not-found renders the no-such-order copy, not a raw error', async () => {
    nextTraceStatus = 404;
    nextTraceBody = { code: 'not-found', title: 'Not found', status: 404 };
    view = await mount();
    await loadOrder(view.container, ORDER_ID);

    expect(view.container.textContent).toContain('Trace unavailable');
    expect(view.container.textContent).toContain('No dispatched order with this id exists in this warehouse');
  });

  test('Retry re-fires the read — and once the endpoint recovers, the trace renders', async () => {
    nextTraceStatus = 500;
    nextTraceBody = { code: 'internal-error', title: 'Internal error', status: 500 };
    view = await mount();
    await loadOrder(view.container, ORDER_ID);
    expect(view.container.textContent).toContain('Trace unavailable');

    const readsBefore = requests.filter((r) => r.pathname.includes('/cold-chain/orders/')).length;
    const retry = [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Retry')!;
    act(() => retry.click());
    await settle();
    const readsAfter = requests.filter((r) => r.pathname.includes('/cold-chain/orders/')).length;
    expect(readsAfter).toBeGreaterThan(readsBefore);
    // The forced refusal was one-shot — the retried read lands the trace.
    expect(view.container.textContent).toContain('dispatched');
    expect(view.container.textContent).toContain('BlueDart');
  });
});

describe('ColdChainTrace: the warehouse switch (triage row 8)', () => {
  test('switching warehouses resets the loaded order — no re-request of the order under the new warehouse', async () => {
    view = await mount();
    await loadOrder(view.container, ORDER_ID);
    expect(requests.some((r) => r.pathname.includes('/cold-chain/orders/'))).toBe(true);

    // The surface's warehouse picker (the shell's global switcher writes
    // the same store, so the same reset must hold there).
    const warehouseSelect = view.container.querySelector('select')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(warehouseSelect, OTHER_WAREHOUSE_ID);
      warehouseSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();

    const traceGets = requests.filter((r) => r.pathname.includes('/cold-chain/orders/'));
    // No second trace request fired under the new warehouse.
    expect(traceGets.length).toBe(1);
    // The order id gate cleared: the form is empty again, and the trace
    // body is gone.
    expect(orderInput(view.container).value).toBe('');
    expect(view.container.textContent).not.toContain('BlueDart');
  });
});