import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { HandoverBuilder } from './handover-builder';
import { HandoversCard } from './handovers-card';
import { OutboundPackDispatch } from './pack-dispatch';

/**
 * Story 4-4a — the staff surfaces of client-arranged shipping, driven through
 * a stubbed `fetch` (guide §8): what a lib test cannot pin — the Shipping
 * cell renders for the right rows, Hand over REPLACES Dispatch for a
 * client-arranged order, the verify sends the verb it says with a key, the
 * builder's scan → tick → AWB flow and the body it posts, a refused parcel
 * marked on its row with the draft kept, and the role gates hide (never
 * disable).
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';
const CLIENT_A = '0198f7a2-1b3c-7d4e-8f90-aaaaaaaaaaaa';
const ORDER_A = '0198f7a2-1b3c-7d4e-8f90-000000000001';
const ORDER_B = '0198f7a2-1b3c-7d4e-8f90-000000000002';

function session(role: StoredSession['user']['role']): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Three PL Co', gstin: null },
    user: { id: 'u-1', email: 'ops@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  };
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
    clientOrderRef: id === ORDER_A ? 'SO-1' : 'SO-2',
    clientId: CLIENT_A,
    destination: null,
    createdAt: '2026-10-30T10:00:00.000Z',
    updatedAt: '2026-10-30T10:00:00.000Z',
  };
}

function shipment(orderId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `sh-${orderId.slice(-1)}`,
    orderId,
    tenantId: TENANT_ID,
    warehouseId: WAREHOUSE_ID,
    status: 'labelled',
    kind: 'client-label',
    carrierConnectionId: null,
    carrierCode: null,
    carrierName: 'Delhivery',
    trackingNumber: '123456789012',
    labelDocumentRef: null,
    weightGrams: null,
    dimensionsMm: null,
    labelledBy: 'ops@example.com',
    labelledAt: '2026-10-30T10:00:00.000Z',
    manifestId: null,
    labelVerifiedAt: null,
    ...over,
  };
}

function clientShipmentView(orderId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `sh-${orderId.slice(-1)}`,
    orderId,
    kind: 'client-label',
    status: 'labelled',
    courierName: 'Delhivery',
    awb: '123456789012',
    packageCount: 1,
    transporterId: null,
    labelAttachmentId: 'att-1',
    labelVerifiedAt: null,
    labelVerifyMethod: null,
    recordedSurface: 'portal',
    labelledAt: '2026-10-30T10:00:00.000Z',
    labelledBy: 'u-2',
    handoverId: null,
    handedOverAt: null,
    weightGrams: null,
    voidedAt: null,
    voidReason: null,
    ...over,
  };
}

function shippingRead(orderId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    shipment: clientShipmentView(orderId),
    history: [],
    label: {
      id: 'att-1',
      purpose: 'shipping-label',
      docKind: null,
      fileName: 'SO-1-label.pdf',
      contentType: 'application/pdf',
      byteSize: 2048,
      pageCount: 1,
      source: 'portal',
      uploadedAt: '2026-10-30T10:00:00.000Z',
      uploadedBy: 'u-2',
      url: 'https://files.example/label?sig=1',
      urlExpiresAt: '2099-01-01T00:00:00.000Z',
    },
    documents: [],
    handover: null,
    parcelTagCode: 'O8F90000000000001',
    storageEnabled: true,
    ...over,
  };
}

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly search: string;
  readonly key: string | null;
  readonly body: unknown;
}

let requests: Recorded[] = [];
let orderStatuses: Record<string, string> = {};
let shipments: Record<string, unknown> = {};
let shippingReads: Record<string, unknown> = {};
let candidates: unknown[] = [];
let handoverReply: { status: number; body: unknown } = { status: 503, body: { code: 'unavailable', status: 503, title: 'Down' } };
let verifyReply: { status: number; body: unknown } = { status: 503, body: { code: 'unavailable', status: 503, title: 'Down' } };
let handoverRows: unknown[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();
    const raw = method === 'GET' ? '' : await request.text();
    requests.push({ method, pathname, search: url.search, key: request.headers.get('Idempotency-Key'), body: raw === '' ? null : JSON.parse(raw) });
    if (method === 'POST' && pathname.endsWith('/outbound/handovers')) return json(handoverReply.status, handoverReply.body);
    if (method === 'POST' && pathname.endsWith('/shipment/verify')) return json(verifyReply.status, verifyReply.body);
    if (method === 'POST') return json(503, { code: 'unavailable', status: 503, title: 'Unrouted POST' });
    if (pathname.endsWith('/outbound/orders')) {
      return json(200, { items: Object.entries(orderStatuses).map(([id, status]) => orderRow(id, status)), nextCursor: null });
    }
    if (/\/outbound\/orders\/[^/]+\/shipment$/.test(pathname)) {
      const orderId = pathname.split('/').at(-2)!;
      return shipments[orderId] === undefined ? json(404, { code: 'not-found', status: 404, title: 'No shipment' }) : json(200, { shipment: shipments[orderId] });
    }
    if (/\/outbound\/orders\/[^/]+\/shipping$/.test(pathname)) {
      const orderId = pathname.split('/').at(-2)!;
      return json(200, shippingReads[orderId] ?? shippingRead(orderId, { shipment: null, label: null }));
    }
    if (/\/outbound\/orders\/[^/]+\/(rates|restock-plan)$/.test(pathname)) return json(404, { code: 'not-found', status: 404, title: 'None' });
    if (/\/outbound\/orders\/[^/]+$/.test(pathname)) {
      const id = pathname.split('/').pop()!;
      return json(200, { order: { ...orderRow(id, orderStatuses[id] ?? 'accepted'), lines: [] } });
    }
    if (pathname.endsWith('/outbound/handover-candidates')) return json(200, { items: candidates, nextCursor: null });
    if (pathname.endsWith(`/warehouses/${WAREHOUSE_ID}/outbound/handovers`)) return json(200, { items: handoverRows, nextCursor: null });
    if (pathname.endsWith(`/tenants/${TENANT_ID}/clients`)) {
      return json(200, { items: [{ id: CLIENT_A, code: 'BRAND-A', name: 'Brand A', status: 'active', systemOwned: false }] });
    }
    if (pathname.endsWith('/partners')) return json(200, { items: [], nextCursor: null });
    if (pathname.endsWith('/carriers/connections') || pathname.endsWith('/outbound/manifests') || pathname.endsWith('/catalog/skus')) {
      return json(200, { items: [], nextCursor: null });
    }
    return json(404, { code: 'not-found', status: 404, title: 'Unrouted in this test' });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  orderStatuses = { [ORDER_A]: 'ready_to_dispatch', [ORDER_B]: 'accepted' };
  shipments = {};
  shippingReads = {};
  candidates = [];
  handoverRows = [];
  handoverReply = { status: 503, body: { code: 'unavailable', status: 503, title: 'Down' } };
  verifyReply = { status: 503, body: { code: 'unavailable', status: 503, title: 'Down' } };
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

function byTestId<T extends Element = HTMLElement>(root: ParentNode, id: string): T | null {
  return root.querySelector<T>(`[data-testid="${id}"]`);
}

async function click(element: Element): Promise<void> {
  await act(async () => void element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await settle();
}

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

async function submit(form: HTMLFormElement): Promise<void> {
  await act(async () => void form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await settle();
}

async function expand(label: string): Promise<void> {
  const toggle = [...view!.container.querySelectorAll('button[aria-expanded]')].find((b) => b.textContent?.includes(label));
  expect(toggle).toBeDefined();
  await click(toggle!);
}

const KEY_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('Pack & Dispatch — client-arranged shipping (A20)', () => {
  test('the Shipping cell renders for the open rows: a client label not verified (amber word) and none', async () => {
    writeSession(session('operator'));
    shipments = { [ORDER_A]: shipment(ORDER_A) };
    view = render(<OutboundPackDispatch tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH1 Main" role="operator" />);
    await settle();
    const cells = [...view.container.querySelectorAll('[data-testid="shipping-cell"]')].map((c) => c.textContent);
    expect(cells).toEqual(['Client label · AWB …9012 · not verified', 'No courier record yet']);
  });

  test('a client-arranged order offers Hand over INSTEAD of Dispatch; a carrier-free order keeps Dispatch', async () => {
    writeSession(session('operator'));
    shipments = { [ORDER_A]: shipment(ORDER_A, { labelVerifiedAt: '2026-10-30T10:05:00.000Z' }) };
    shippingReads = { [ORDER_A]: shippingRead(ORDER_A) };
    view = render(<OutboundPackDispatch tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH1 Main" role="operator" />);
    await settle();
    await expand('SO-1');
    expect(byTestId(view.container, 'open-hand-over')?.textContent).toBe('Hand over');
    const labels = [...view.container.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).not.toContain('Dispatch this order');
    expect(labels).not.toContain('Generate label');
    expect(byTestId(view.container, 'shipping-panel')?.textContent).toContain('Client label · Delhivery · AWB 123456789012 · 1 parcel');
    expect(byTestId<HTMLAnchorElement>(view.container, 'print-client-label')?.getAttribute('href')).toBe('https://files.example/label?sig=1');
  });

  test('without a client-arranged shipment the per-order Dispatch stays', async () => {
    writeSession(session('operator'));
    orderStatuses = { [ORDER_A]: 'ready_to_dispatch' };
    view = render(<OutboundPackDispatch tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH1 Main" role="operator" />);
    await settle();
    await expand('SO-1');
    expect(byTestId(view.container, 'open-hand-over')).toBeNull();
    expect([...view.container.querySelectorAll('button')].map((b) => b.textContent)).toContain('Dispatch this order');
  });

  test('Verify label posts the normalised scan with the scan method and a key; a mismatch renders the server words', async () => {
    writeSession(session('operator'));
    shipments = { [ORDER_A]: shipment(ORDER_A) };
    shippingReads = { [ORDER_A]: shippingRead(ORDER_A) };
    verifyReply = {
      status: 422,
      body: { code: 'label-mismatch', status: 422, title: 'Label does not match the order', detail: 'This label reads …4410 — order SO-1’s AWB ends …9012.' },
    };
    view = render(<OutboundPackDispatch tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH1 Main" role="operator" />);
    await settle();
    await expand('SO-1');
    const form = byTestId<HTMLFormElement>(view.container, 'verify-label')!;
    setValue(byTestId<HTMLInputElement>(form, 'verify-label-input')!, ' 9999-4444 4410 ');
    await submit(form);
    const posted = requests.filter((r) => r.method === 'POST');
    expect(posted).toHaveLength(1);
    expect(posted[0]!.pathname).toEndWith(`/outbound/orders/${ORDER_A}/shipment/verify`);
    expect(posted[0]!.body).toEqual({ scannedCode: '999944444410', method: 'scan' });
    expect(posted[0]!.key).toMatch(KEY_RE);
    expect(form.textContent).toContain('This label reads …4410');
    // The same scan again reuses the key (a retry replays).
    setValue(byTestId<HTMLInputElement>(form, 'verify-label-input')!, '999944444410');
    await submit(form);
    const again = requests.filter((r) => r.method === 'POST');
    expect(again[1]!.key).toBe(posted[0]!.key);
  });

  test('an accountant reads the Shipping panel and is offered no shipping affordance', async () => {
    writeSession(session('accountant'));
    shipments = { [ORDER_A]: shipment(ORDER_A) };
    shippingReads = { [ORDER_A]: shippingRead(ORDER_A) };
    view = render(<OutboundPackDispatch tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH1 Main" role={'accountant'} />);
    await settle();
    await expand('SO-1');
    const panel = byTestId(view.container, 'shipping-panel')!;
    expect(panel.textContent).toContain('AWB 123456789012');
    for (const id of ['verify-label', 'open-client-label', 'open-record-awb', 'open-void-shipment', 'document-upload', 'open-hand-over']) {
      expect(byTestId(view.container, id)).toBeNull();
    }
  });
});

describe('the handover builder (A20, A49)', () => {
  const candidateRows = () => [
    {
      orderId: ORDER_A,
      orderLabel: 'SO-1',
      clientOrderRef: 'SO-1',
      externalEventId: null,
      followOnSeq: null,
      parcelTagCode: 'O8F90000000000001',
      destinationCity: 'Pune',
      codAmountPaise: 125000,
      packedAt: '2026-10-30T09:00:00.000Z',
      shipment: { kind: 'client-label', awb: '123456789012', courierName: 'Delhivery', packageCount: 1, labelVerified: true },
    },
    {
      orderId: ORDER_B,
      orderLabel: 'SO-2',
      clientOrderRef: 'SO-2',
      externalEventId: null,
      followOnSeq: null,
      parcelTagCode: 'O8F90000000000002',
      destinationCity: null,
      codAmountPaise: null,
      packedAt: '2026-10-30T09:05:00.000Z',
      shipment: null,
    },
  ];

  async function openBuilder(onCreated: (r: unknown) => void = () => {}): Promise<HTMLElement> {
    writeSession(session('operator'));
    candidates = candidateRows();
    view = render(
      <HandoverBuilder tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} initialClientId={CLIENT_A} initialOrderId={null} onClose={() => {}} onCreated={onCreated} />,
    );
    await settle();
    return byTestId(view.container, 'handover-builder')!;
  }

  async function scan(root: HTMLElement, code: string): Promise<void> {
    const input = byTestId<HTMLInputElement>(root, 'handover-scan')!;
    setValue(input, code);
    await act(async () => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await settle();
  }

  test('the candidates are read for the client before scanning; a tag on a row without an AWB asks for it next', async () => {
    const root = await openBuilder();
    const read = requests.find((r) => r.pathname.endsWith('/outbound/handover-candidates'))!;
    expect(read.search).toContain(`clientId=${CLIENT_A}`);
    expect(root.querySelectorAll('[data-testid="handover-row"]')).toHaveLength(2);
    await scan(root, 'O8F90000000000002');
    expect(byTestId(root, 'handover-scan-note')?.textContent).toBe('SO-2 ticked — now scan the courier’s AWB on this parcel.');
    await scan(root, '77001');
    expect(byTestId(root, 'handover-scan-note')?.textContent).toBe('SO-2 — AWB 77001 recorded.');
    await scan(root, '1234 5678 9012');
    expect(byTestId(root, 'handover-scan-note')?.textContent).toBe('SO-1 ticked.');
    expect(byTestId(root, 'handover-confirm')?.textContent).toBe('Hand over 2 parcels');
  });

  test('Confirm posts one body under a key; a per-parcel refusal marks the row and keeps the draft, and the retry reuses the key', async () => {
    const root = await openBuilder();
    await scan(root, '123456789012');
    await scan(root, 'O8F90000000000002');
    await scan(root, '77001');
    setValue(byTestId<HTMLInputElement>(root, 'handover-courier')!, 'Delhivery');
    setValue(byTestId<HTMLInputElement>(root, 'handover-person')!, 'Ravi');
    handoverReply = {
      status: 409,
      body: {
        code: 'handover-parcels-refused',
        status: 409,
        title: 'Some parcels cannot be handed over',
        detail: '1 of 2',
        parcels: [{ orderId: ORDER_B, code: 'awb-in-use', detail: 'AWB 77001 is already on order SO-7.' }],
      },
    };
    await submit(root.querySelector('form')!);
    const posted = requests.filter((r) => r.method === 'POST');
    expect(posted).toHaveLength(1);
    expect(posted[0]!.body).toEqual({
      warehouseId: WAREHOUSE_ID,
      clientId: CLIENT_A,
      courier: { courierName: 'Delhivery' },
      pickupPersonName: 'Ravi',
      parcels: [{ orderId: ORDER_A, awb: '123456789012' }, { orderId: ORDER_B, awb: '77001' }],
    });
    expect(posted[0]!.key).toMatch(KEY_RE);
    const refused = byTestId(root, 'handover-row-refused')!;
    expect(refused.textContent).toBe('✕ This AWB is on another open order — AWB 77001 is already on order SO-7.');
    expect(refused.closest('[data-order-id]')?.getAttribute('data-order-id')).toBe(ORDER_B);
    // An unchanged retry replays under the same key.
    await submit(root.querySelector('form')!);
    expect(requests.filter((r) => r.method === 'POST')[1]!.key).toBe(posted[0]!.key);
  });

  test('a successful handover hands its response up', async () => {
    let created: unknown = null;
    const root = await openBuilder((r) => (created = r));
    await scan(root, '123456789012');
    setValue(byTestId<HTMLInputElement>(root, 'handover-courier')!, 'Delhivery');
    setValue(byTestId<HTMLInputElement>(root, 'handover-person')!, 'Ravi');
    const response = {
      handover: { id: 'ho-1', code: 'HO-0001', courierName: 'Delhivery' },
      parcels: [{ orderId: ORDER_A, shipmentId: 'sh-1', awb: '123456789012', dispatched: true, followOnOrderId: null }],
      refused: [],
      rejectedOpId: null,
    };
    handoverReply = { status: 201, body: response };
    await submit(root.querySelector('form')!);
    expect(created).toEqual(response);
  });

  test('a missing pickup person sends nothing', async () => {
    const root = await openBuilder();
    await scan(root, '123456789012');
    setValue(byTestId<HTMLInputElement>(root, 'handover-courier')!, 'Delhivery');
    await submit(root.querySelector('form')!);
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0);
    expect(root.textContent).toContain('Enter who collected the parcels');
  });
});

describe('the Handovers tab', () => {
  test('lists handovers with the sheet state as a word; New handover is hidden without dispatch.execute', async () => {
    handoverRows = [
      { id: 'ho-1', code: 'HO-0001', clientId: CLIENT_A, clientCode: 'BRAND-A', courierName: 'Delhivery', shipmentCount: 2, packageCount: 3, handedOverAt: '2026-10-30T10:35:00.000Z', sheetPageCount: 0, source: 'web' },
    ];
    writeSession(session('operator'));
    view = render(<HandoversCard tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH1 Main" role="operator" />);
    await settle();
    expect(view.container.textContent).toContain('HO-0001');
    expect(view.container.textContent).toContain('Not uploaded');
    expect(byTestId(view.container, 'new-handover')).not.toBeNull();
    view.unmount();
    writeSession(session('accountant'));
    view = render(<HandoversCard tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH1 Main" role={'accountant'} />);
    await settle();
    expect(byTestId(view.container, 'new-handover')).toBeNull();
    expect(view.container.textContent).toContain('HO-0001');
  });
});
