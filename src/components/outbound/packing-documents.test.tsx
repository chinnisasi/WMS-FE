import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { PACK_PRINT_STORAGE_KEY } from '../../lib/cartons';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { caseLabel, cartonSkusFromPack } from './carton-editor';
import { OutboundPackDispatch } from './pack-dispatch';

/**
 * Story 4-5a (A26, A40, A41) — the web's packing documents, driven end to
 * end through a stubbed `fetch` (the pack-dispatch.test.tsx harness, cut
 * down to the routes this story touches):
 *   1. "Split into cartons" sends the scanned total plus the cartons and no
 *      top-level measurements; a split that does not add up sends nothing;
 *   2. a packed row reads "2 cartons · 6 kg", its panel lists the cartons and
 *      the Print group downloads the remembered choice (ZPL labels by default);
 *   3. without `labels.execute` the Print group offers only the slips;
 *   4. Re-pack into cartons posts the new split with a reason under a key
 *      bound to its body, and words a refusal by its code;
 *   5. a live carrier label hides Re-pack, and the label form warns that one
 *      AWB covers every carton (A41).
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';
const NOW_ISO = '2026-09-16T12:00:00.000Z';

function session(role: StoredSession['user']['role']): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Priya Spices', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  };
}

const SKU_ROWS = [
  { id: 'sku-1', code: 'SPICE-01', name: 'Turmeric', uom: 'each', uomPrecision: 0, catchWeightTracked: false },
  { id: 'sku-2', code: 'FLOUR-01', name: 'Flour', uom: 'each', uomPrecision: 0, catchWeightTracked: false },
];

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
    lines: [
      { id: 'ol-1', orderId: id, skuId: 'sku-1', qty: 10, reservedQty: 10, shortfallQty: 0, status: 'open', reservationId: 'r-1', reservationState: 'committed', parentLineId: null, createdAt: NOW_ISO },
      { id: 'ol-2', orderId: id, skuId: 'sku-2', qty: 4, reservedQty: 4, shortfallQty: 0, status: 'open', reservationId: 'r-2', reservationState: 'committed', parentLineId: null, createdAt: NOW_ISO },
    ],
  };
}

function cartonsFixture(packSeq = 1): unknown {
  return {
    pack: {
      packSeq,
      status: 'live',
      legacy: false,
      partiesFrozen: true,
      cartonCount: 2,
      grossWeightGrams: 6000,
      packedAt: NOW_ISO,
      packedBy: 'priya@example.com',
      cartons: [
        {
          seq: 1,
          code: `O8FE5145B99902272.${packSeq}.1`,
          weightGrams: 3200,
          dimensionsMm: null,
          lineCount: 1,
          totals: [{ uom: 'each', qty: 6 }],
          lines: [{ skuId: 'sku-1', skuCode: 'SPICE-01', skuName: 'Turmeric', uom: 'each', qty: 6, handlingUnitIds: null }],
        },
        {
          seq: 2,
          code: `O8FE5145B99902272.${packSeq}.2`,
          weightGrams: 2800,
          dimensionsMm: null,
          lineCount: 2,
          totals: [{ uom: 'each', qty: 8 }],
          lines: [
            { skuId: 'sku-1', skuCode: 'SPICE-01', skuName: 'Turmeric', uom: 'each', qty: 4, handlingUnitIds: null },
            { skuId: 'sku-2', skuCode: 'FLOUR-01', skuName: 'Flour', uom: 'each', qty: 4, handlingUnitIds: null },
          ],
        },
      ],
    },
    history: [],
  };
}

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly search: string;
  readonly idempotencyKey: string | null;
  readonly body: unknown;
}

let requests: Recorded[] = [];
let orderStatuses: Record<string, string> = {};
let shipmentsByOrder: Record<string, unknown> = {};
let recartonResponder: () => { status: number; body: unknown } = () => ({ status: 201, body: {} });
let downloads: string[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();
    const rawBody = method === 'GET' ? '' : await request.text();
    requests.push({ method, pathname, search: url.search, idempotencyKey: request.headers.get('Idempotency-Key'), body: rawBody === '' ? null : JSON.parse(rawBody) });

    if (method === 'POST' && pathname.endsWith('/pack')) {
      orderStatuses['order-1'] = 'ready_to_dispatch';
      return json(201, { pack: { orderId: 'order-1', tenantId: TENANT_ID, warehouseId: WAREHOUSE_ID, orderStatus: 'ready_to_dispatch', source: 'manual', integrationId: null, externalEventId: null, packedBy: 'priya@example.com', packedAt: NOW_ISO, weightGrams: 6000, dimensionsMm: null, totalUnits: 14, lines: [] } });
    }
    if (method === 'POST' && pathname.endsWith('/cartons')) {
      const answer = recartonResponder();
      return json(answer.status, answer.body);
    }
    if (method === 'GET' && pathname.endsWith('/outbound/orders')) {
      return json(200, { items: Object.entries(orderStatuses).map(([id, status]) => orderRow(id, status)), nextCursor: null });
    }
    if (method === 'GET' && /\/outbound\/orders\/[^/]+\/cartons$/.test(pathname)) {
      const orderId = pathname.split('/')[pathname.split('/').length - 2]!;
      if (orderStatuses[orderId] !== 'ready_to_dispatch' && orderStatuses[orderId] !== 'dispatched') {
        return json(409, { code: 'order-not-packed', title: 'Not packed', status: 409 });
      }
      return json(200, cartonsFixture());
    }
    if (method === 'GET' && /\/outbound\/orders\/[^/]+\/(carton-labels|packing-slip)$/.test(pathname)) {
      return new Response('^XA^XZ', { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    if (method === 'GET' && /\/outbound\/orders\/[^/]+\/shipment$/.test(pathname)) {
      const orderId = pathname.split('/')[pathname.split('/').length - 2]!;
      const shipment = shipmentsByOrder[orderId];
      if (shipment === undefined) return json(404, { code: 'not-found', title: 'No shipment', status: 404 });
      return json(200, { shipment });
    }
    if (method === 'GET' && pathname.endsWith('/carriers/connections')) return json(200, { items: [], nextCursor: null });
    if (method === 'GET' && pathname.endsWith('/outbound/manifests')) return json(200, { items: [], nextCursor: null });
    if (method === 'GET' && /\/outbound\/orders\/[^/]+$/.test(pathname)) {
      const id = pathname.split('/').pop()!;
      return json(200, { order: orderDetail(id, orderStatuses[id] ?? 'accepted') });
    }
    if (method === 'GET' && pathname.endsWith('/catalog/skus')) return json(200, { items: SKU_ROWS, nextCursor: null });
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;
let originalCreate: typeof URL.createObjectURL;
let originalRevoke: typeof URL.revokeObjectURL;
let originalClick: () => void;

beforeEach(() => {
  requests = [];
  downloads = [];
  orderStatuses = { 'order-1': 'accepted', 'order-2': 'ready_to_dispatch' };
  shipmentsByOrder = {};
  recartonResponder = () => ({ status: 201, body: { pack: (cartonsFixture(2) as { pack: unknown }).pack, unchanged: false, clientLabelReverify: false } });
  stubRouter();
  originalCreate = URL.createObjectURL;
  originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (() => 'blob:test') as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
  originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  };
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  try {
    localStorage.clear();
  } catch {
    // no storage
  }
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  HTMLAnchorElement.prototype.click = originalClick;
  restoreGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(role: StoredSession['user']['role']): Promise<Rendered> {
  writeSession(session(role));
  const rendered = render(<OutboundPackDispatch tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="MAIN" role={role} />);
  await settle();
  return rendered;
}

const text = (r: Rendered) => r.container.textContent ?? '';
const buttons = (r: Rendered) => [...r.container.querySelectorAll('button')] as HTMLButtonElement[];

async function press(r: Rendered, label: string): Promise<void> {
  const button = buttons(r).find((b) => b.textContent?.trim() === label);
  if (button === undefined) throw new Error(`No button "${label}" — have: ${buttons(r).map((b) => b.textContent?.trim()).join(' | ')}`);
  await act(async () => {
    button.click();
  });
  await settle();
}

async function expand(r: Rendered, orderId: string): Promise<void> {
  const button = buttons(r).find((b) => b.textContent?.includes(orderId));
  if (button === undefined) throw new Error(`No toggle for ${orderId}`);
  await act(async () => {
    button.click();
  });
  await settle();
}

async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function labelled(r: Rendered, aria: string): HTMLInputElement {
  const input = r.container.querySelector(`input[aria-label="${aria}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`No input "${aria}"`);
  return input;
}

async function chooseSplit(r: Rendered): Promise<void> {
  const radios = [...r.container.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
  const split = radios.find((radio) => radio.parentElement?.textContent?.includes('Split into cartons'));
  if (split === undefined) throw new Error('No split radio');
  await act(async () => {
    split.click();
  });
  await settle();
}

const posts = () => requests.filter((r) => r.method === 'POST');

describe('the pack bench’s cartons (A26)', () => {
  test('one carton is the default and sends today’s exact body', async () => {
    view = await mount('operator');
    await expand(view, 'order-1');
    expect(text(view)).toContain('One carton');
    await press(view, 'Pack this order');
    expect(posts()[0]!.body).toEqual({ scanned: [{ skuId: 'sku-1', qty: 10 }, { skuId: 'sku-2', qty: 4 }] });
  });

  test('a split sends the scanned total and the cartons, and no top-level measurements', async () => {
    view = await mount('operator');
    await expand(view, 'order-1');
    await chooseSplit(view);
    await typeInto(labelled(view, 'SPICE-01 in carton 1'), '6');
    await typeInto(labelled(view, 'SPICE-01 in carton 2'), '4');
    await typeInto(labelled(view, 'FLOUR-01 in carton 1'), '');
    await typeInto(labelled(view, 'FLOUR-01 in carton 2'), '4');
    await typeInto(labelled(view, 'Carton 1 Weight (kg)'), '3.2');
    await typeInto(labelled(view, 'Carton 2 Weight (kg)'), '2.8');
    await press(view, 'Pack this order');
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.body).toEqual({
      scanned: [{ skuId: 'sku-1', qty: 10 }, { skuId: 'sku-2', qty: 4 }],
      cartons: [
        { scanned: [{ skuId: 'sku-1', qty: 6 }], weightGrams: 3200 },
        { scanned: [{ skuId: 'sku-1', qty: 4 }, { skuId: 'sku-2', qty: 4 }], weightGrams: 2800 },
      ],
    });
  });

  test('split, remove carton 2, weigh the one left: the POST carries its weight as today’s top-level weight', async () => {
    view = await mount('operator');
    await expand(view, 'order-1');
    await chooseSplit(view);
    const remove = view.container.querySelector('button[aria-label="Remove carton 2"]');
    if (!(remove instanceof HTMLButtonElement)) throw new Error('No Remove carton 2');
    await act(async () => {
      remove.click();
    });
    await settle();
    await typeInto(labelled(view, 'Carton 1 Weight (kg)'), '1.25');
    await press(view, 'Pack this order');
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.body).toEqual({ scanned: [{ skuId: 'sku-1', qty: 10 }, { skuId: 'sku-2', qty: 4 }], weightGrams: 1250 });
  });

  test('a split that does not add up is refused in words and sends nothing', async () => {
    view = await mount('operator');
    await expand(view, 'order-1');
    await chooseSplit(view);
    await typeInto(labelled(view, 'SPICE-01 in carton 1'), '6');
    await typeInto(labelled(view, 'SPICE-01 in carton 2'), '3');
    await typeInto(labelled(view, 'FLOUR-01 in carton 2'), '');
    expect(text(view)).toContain('Differs — 9 of 10');
    await press(view, 'Pack this order');
    expect(posts()).toHaveLength(0);
    expect(text(view)).toContain('Not packed');
  });

  test('a fractional split of an each-counted SKU is refused (A31)', async () => {
    view = await mount('operator');
    await expand(view, 'order-1');
    await chooseSplit(view);
    await typeInto(labelled(view, 'SPICE-01 in carton 1'), '6.5');
    await typeInto(labelled(view, 'SPICE-01 in carton 2'), '3.5');
    await typeInto(labelled(view, 'FLOUR-01 in carton 1'), '4');
    await press(view, 'Pack this order');
    expect(posts()).toHaveLength(0);
    expect(text(view)).toContain('whole');
  });
});

describe('a packed order’s cartons and prints (A26)', () => {
  test('the packed row reads "2 cartons · 6 kg"; the panel lists the cartons and downloads ZPL labels by default', async () => {
    view = await mount('operator');
    expect(view.container.querySelector('[data-testid="packed-row-cartons"]')?.textContent).toBe('2 cartons · 6 kg');
    await expand(view, 'order-2');
    expect(text(view)).toContain('Carton 1 of 2 — 3.2 kg');
    expect(text(view)).toContain('O8FE5145B99902272.1.2');
    await press(view, 'Download');
    const read = requests.find((r) => r.pathname.endsWith('/carton-labels'));
    expect(read?.search).toBe('?format=zpl&layout=label');
    expect(downloads).toEqual(['order-2-carton-labels.zpl']);
    expect(localStorage.getItem(PACK_PRINT_STORAGE_KEY)).toBe('labels-zpl');
  });

  test('the remembered choice is the default next time (the A4 slip)', async () => {
    localStorage.setItem(PACK_PRINT_STORAGE_KEY, 'slip-a4');
    view = await mount('operator');
    await expand(view, 'order-2');
    await press(view, 'Download');
    const read = requests.find((r) => r.pathname.endsWith('/packing-slip'));
    expect(read?.search).toBe('?format=pdf&layout=a4');
    expect(downloads).toEqual(['order-2-packing-slip.pdf']);
  });

  test('without labels.execute the Print group offers the slips only', async () => {
    view = await mount('accountant');
    await expand(view, 'order-2');
    const options = [...view.container.querySelectorAll('[data-testid="print-pack-documents"] option')].map((o) => o.textContent);
    expect(options).toEqual(['Packing slip (A4 PDF)', 'Carton slips (ZPL)', 'Carton slips (PDF 4×6)']);
    expect(text(view)).not.toContain('Re-pack into cartons');
  });
});

describe('Re-pack into cartons (A8, A26)', () => {
  test('posts the new split with its reason under a key bound to the body; a retry of the same body reuses the key', async () => {
    recartonResponder = () => ({ status: 409, body: { code: 'shipment-labelled-by-carrier', title: 'Labelled', status: 409 } });
    view = await mount('operator');
    await expand(view, 'order-2');
    await press(view, 'Re-pack into cartons');
    const reason = [...view.container.querySelectorAll('[data-testid="recarton-form"] input')].find(
      (i) => (i as HTMLInputElement).placeholder === 'Why the order is re-packed',
    ) as HTMLInputElement;
    await typeInto(reason, 'Box 2 crushed');
    await press(view, 'Re-pack');
    expect(text(view)).toContain('the carrier’s label counts its pieces');
    await press(view, 'Re-pack');
    const sent = posts().filter((p) => p.pathname.endsWith('/cartons'));
    expect(sent).toHaveLength(2);
    expect(sent[0]!.idempotencyKey).toBe(sent[1]!.idempotencyKey);
    expect(sent[0]!.body).toEqual({
      cartons: [
        { scanned: [{ skuId: 'sku-1', qty: 6 }], weightGrams: 3200 },
        { scanned: [{ skuId: 'sku-1', qty: 4 }, { skuId: 'sku-2', qty: 4 }], weightGrams: 2800 },
      ],
      reason: 'Box 2 crushed',
    });

    // An edit mints a fresh key, and a success says the old labels stop scanning.
    recartonResponder = () => ({ status: 201, body: { pack: (cartonsFixture(2) as { pack: unknown }).pack, unchanged: false, clientLabelReverify: true } });
    await typeInto(reason, 'Box 2 crushed in transit');
    await press(view, 'Re-pack');
    const third = posts().filter((p) => p.pathname.endsWith('/cartons'))[2]!;
    expect(third.idempotencyKey).not.toBe(sent[0]!.idempotencyKey);
    expect(text(view)).toContain('Re-packed');
    expect(text(view)).toContain('the old ones no longer scan');
    expect(text(view)).toContain('Re-verify the client label');
  });

  test('a reason is required — nothing is sent without one', async () => {
    view = await mount('operator');
    await expand(view, 'order-2');
    await press(view, 'Re-pack into cartons');
    await press(view, 'Re-pack');
    expect(posts()).toHaveLength(0);
    expect(text(view)).toContain('Say why the order is re-packed');
  });

  test('a live carrier label hides Re-pack and the label form is not shown again (A41)', async () => {
    shipmentsByOrder['order-2'] = {
      id: 'sh-1', orderId: 'order-2', tenantId: TENANT_ID, warehouseId: WAREHOUSE_ID, status: 'labelled', carrierConnectionId: 'conn-1',
      carrierCode: 'sandbox', carrierName: 'Sandbox Express', trackingNumber: 'SBX-1', labelDocumentRef: null, weightGrams: null,
      dimensionsMm: null, labelledBy: 'priya@example.com', labelledAt: NOW_ISO, manifestId: null, kind: 'carrier',
    };
    view = await mount('operator');
    await expand(view, 'order-2');
    expect(text(view)).not.toContain('Re-pack into cartons');
    expect(text(view)).toContain('The carrier’s label counts the pieces');
  });

  test('before buying a carrier label for a multi-carton pack, the form warns one AWB covers every carton (A41)', async () => {
    view = await mount('operator');
    await expand(view, 'order-2');
    expect(text(view)).toContain('One AWB will cover 2 cartons — every carton label prints it.');
  });
});

describe('the re-carton lists catch-weight cases by weight and code (A26)', () => {
  const pack = (handlingUnits: unknown) =>
    ({
      packSeq: 1,
      status: 'live',
      legacy: false,
      partiesFrozen: true,
      cartonCount: 1,
      grossWeightGrams: null,
      packedAt: NOW_ISO,
      packedBy: 'u-1',
      cartons: [
        {
          seq: 1,
          code: 'O8F90000000000001.1.1',
          weightGrams: null,
          dimensionsMm: null,
          lineCount: 1,
          totals: [],
          lines: [
            {
              skuId: 'sku-f',
              skuCode: 'FISH',
              skuName: 'Fish',
              uom: 'KG',
              qty: 2,
              handlingUnitIds: ['0198f7a2-1b3c-7d4e-8f90-0000a1b2c3d4', '0198f7a2-1b3c-7d4e-8f90-0000e5f6a7b8'],
              ...(handlingUnits === undefined ? {} : { handlingUnits }),
            },
          ],
        },
      ],
    }) as never;

  test('a case shows its captured weight and the code’s tail; no weight (or an older api) shows the tail alone', () => {
    const skus = cartonSkusFromPack(
      pack([
        { id: '0198f7a2-1b3c-7d4e-8f90-0000a1b2c3d4', code: '0198f7a2-1b3c-7d4e-8f90-0000a1b2c3d4', weightGrams: 12_400 },
        { id: '0198f7a2-1b3c-7d4e-8f90-0000e5f6a7b8', code: '0198f7a2-1b3c-7d4e-8f90-0000e5f6a7b8', weightGrams: null },
      ]),
      null,
    );
    expect(skus[0]!.cases!.map((c) => c.label)).toEqual(['12.40 kg · …A1B2C3D4', '…E5F6A7B8']);
    expect(cartonSkusFromPack(pack(undefined), null)[0]!.cases!.map((c) => c.label)).toEqual(['…A1B2C3D4', '…E5F6A7B8']);
    expect(caseLabel('x-0000a1b2c3d4', 950)).toBe('0.95 kg · …A1B2C3D4');
  });
});
