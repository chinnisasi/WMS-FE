import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { HandoverBuilder } from './handover-builder';
import { HandoversCard } from './handovers-card';
import { OutboundPackDispatch } from './pack-dispatch';
import { ConsignmentsCard } from './consignments-card';

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

/** Story 4-6a — the list rows' optional `consignmentState` (absent: an older API). */
let consignmentStates: Record<string, string> = {};
/** Story 4-6a — the Documents worklist answer, and per-order consignment reads (absent → 404). */
let worklist: unknown = { view: 'needed', needed: [], exceptions: [], truncated: false };
let consignmentReads: Record<string, unknown> = {};

function orderRow(id: string, status: string): Record<string, unknown> {
  return {
    ...(consignmentStates[id] === undefined ? {} : { consignmentState: consignmentStates[id] }),
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
/** POST replies by path suffix (the panel's forms). */
let postReplies: Record<string, { status: number; body: unknown }> = {};
let handoverDetail: unknown = null;
/** Story 4-5a — per-order cartons reads (absent → 404, an API without the route). */
let cartonsReads: Record<string, unknown> = {};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();
    let body: unknown = null;
    if (method !== 'GET') {
      if ((request.headers.get('content-type') ?? '').includes('multipart/form-data')) {
        body = Object.fromEntries([...(await request.formData()).entries()].map(([k, v]) => [k, typeof v === 'string' ? v : `file:${(v as File).name}`]));
      } else {
        const raw = await request.text();
        body = raw === '' ? null : JSON.parse(raw);
      }
    }
    requests.push({ method, pathname, search: url.search, key: request.headers.get('Idempotency-Key'), body });
    if (method === 'POST' && pathname.endsWith('/outbound/handovers')) return json(handoverReply.status, handoverReply.body);
    if (method === 'POST' && pathname.endsWith('/shipment/verify')) return json(verifyReply.status, verifyReply.body);
    if (method === 'POST') {
      const suffix = Object.keys(postReplies).find((k) => pathname.endsWith(k));
      if (suffix !== undefined) return json(postReplies[suffix]!.status, postReplies[suffix]!.body);
    }
    if (method === 'POST') return json(503, { code: 'unavailable', status: 503, title: 'Unrouted POST' });
    if (pathname.endsWith('/outbound/orders')) {
      return json(200, { items: Object.entries(orderStatuses).map(([id, status]) => orderRow(id, status)), nextCursor: null });
    }
    if (/\/outbound\/orders\/[^/]+\/cartons$/.test(pathname)) {
      const orderId = pathname.split('/').at(-2)!;
      return cartonsReads[orderId] === undefined ? json(404, { code: 'not-found', status: 404, title: 'None' }) : json(200, cartonsReads[orderId]);
    }
    if (/\/outbound\/orders\/[^/]+\/carton-labels$/.test(pathname)) return new Response('^XA^XZ', { status: 200, headers: { 'content-type': 'text/plain' } });
    if (/\/outbound\/orders\/[^/]+\/shipment$/.test(pathname)) {
      const orderId = pathname.split('/').at(-2)!;
      return shipments[orderId] === undefined ? json(404, { code: 'not-found', status: 404, title: 'No shipment' }) : json(200, { shipment: shipments[orderId] });
    }
    if (/\/outbound\/orders\/[^/]+\/shipping$/.test(pathname)) {
      const orderId = pathname.split('/').at(-2)!;
      return json(200, shippingReads[orderId] ?? shippingRead(orderId, { shipment: null, label: null }));
    }
    if (pathname.endsWith('/outbound/consignments')) return json(200, worklist);
    if (/\/outbound\/orders\/[^/]+\/consignment$/.test(pathname)) {
      const orderId = pathname.split('/').at(-2)!;
      return consignmentReads[orderId] === undefined ? json(404, { code: 'not-found', status: 404, title: 'None' }) : json(200, consignmentReads[orderId]);
    }
    if (/\/outbound\/orders\/[^/]+\/(rates|restock-plan)$/.test(pathname)) return json(404, { code: 'not-found', status: 404, title: 'None' });
    if (/\/outbound\/orders\/[^/]+$/.test(pathname)) {
      const id = pathname.split('/').pop()!;
      return json(200, { order: { ...orderRow(id, orderStatuses[id] ?? 'accepted'), lines: [] } });
    }
    if (pathname.endsWith('/outbound/handover-candidates')) return json(200, { items: candidates, nextCursor: null });
    if (pathname.endsWith(`/warehouses/${WAREHOUSE_ID}/outbound/handovers`)) return json(200, { items: handoverRows, nextCursor: null });
    if (/\/outbound\/handovers\/[^/]+$/.test(pathname) && handoverDetail !== null) return json(200, { handover: handoverDetail });
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
  consignmentStates = {};
  consignmentReads = {};
  worklist = { view: 'needed', needed: [], exceptions: [], truncated: false };
  handoverRows = [];
  postReplies = {};
  handoverDetail = null;
  cartonsReads = {};
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

  test('story 4-6a (A24) — a candidate whose documents are missing is marked, its tick disabled, and a scan never ticks it', async () => {
    writeSession(session('operator'));
    candidates = candidateRows().map((c, i) =>
      i === 0
        ? { ...c, consignment: { state: 'missing', blocking: true, ewayBillNumber: null, ewayValidUntil: null } }
        : { ...c, consignment: { state: 'ready', blocking: false, ewayBillNumber: '123456789012', ewayValidUntil: '2099-01-01' } },
    );
    view = render(
      <HandoverBuilder tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} initialClientId={CLIENT_A} initialOrderId={ORDER_A} onClose={() => {}} onCreated={() => {}} />,
    );
    await settle();
    const root = byTestId(view.container, 'handover-builder')!;
    const rowA = root.querySelector(`[data-order-id="${ORDER_A}"]`)!;
    expect(byTestId(rowA as HTMLElement, 'handover-row-documents')!.textContent).toBe('⚠ Invoice not recorded — record it first');
    const tick = rowA.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(tick.disabled).toBe(true);
    // Opened from its row, it is still never ticked.
    expect(tick.checked).toBe(false);
    expect(byTestId(root, 'handover-confirm')?.textContent).toBe('Hand over 0 parcels');
    await scan(root, '123456789012');
    expect(byTestId(root, 'handover-scan-note')?.textContent).toBe('SO-1 — Invoice not recorded — record it first. It cannot leave yet.');
    expect(tick.checked).toBe(false);
    const rowB = root.querySelector(`[data-order-id="${ORDER_B}"]`)!;
    expect(byTestId(rowB as HTMLElement, 'handover-row-documents')).toBeNull();
    expect(rowB.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(false);
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

  test('story 4-5a (A21, A37, A44, AC5) — carton scans tick their order, a stale label is refused, and a short or COD-carton-less pickup asks first', async () => {
    writeSession(session('operator'));
    candidates = candidateRows().map((c, i) => (i === 0 ? { ...c, packSeq: 2, cartonCount: 3, defaultWeightGrams: null } : c));
    view = render(
      <HandoverBuilder tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} initialClientId={CLIENT_A} initialOrderId={null} onClose={() => {}} onCreated={() => {}} />,
    );
    await settle();
    const root = byTestId(view.container, 'handover-builder')!;
    // A superseded pack's label is refused on the web (the user reprints).
    await scan(root, 'O8F90000000000001.1.2');
    expect(byTestId(root, 'handover-scan-note')?.textContent).toBe('Old label — this order was re-packed; reprint its labels.');
    // Cartons 2 and 3 of the live pack tick SO-1 ("2/3"); the label is verified, so no AWB is asked.
    await scan(root, 'o8f90000000000001.2.2 ');
    expect(byTestId(root, 'handover-scan-note')?.textContent).toBe('SO-1 — carton 2 (1/3) ticked.');
    await scan(root, 'O8F90000000000001.2.3');
    expect(byTestId(root, 'handover-carton-tally')?.textContent).toBe('Cartons 2/3');
    // The parcels field defaults to the carton count; the over-bound note shows with no weight default.
    const row = root.querySelector(`[data-order-id="${ORDER_A}"]`)!;
    expect(row.querySelectorAll('input')[2]!.getAttribute('placeholder')).toBe('3');
    expect(byTestId(row as HTMLElement, 'handover-row-weight-note')?.textContent).toContain('Over 1,000 kg — record the freight weight on the LR (4-9a)');
    setValue(byTestId<HTMLInputElement>(root, 'handover-courier')!, 'Delhivery');
    setValue(byTestId<HTMLInputElement>(root, 'handover-person')!, 'Ravi');
    // First confirm asks (2 of 3; COD carton 1 unscanned) and sends nothing.
    await submit(root.querySelector('form')!);
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0);
    const asks = byTestId(root, 'handover-carton-confirms')!.textContent!;
    expect(asks).toContain('SO-1: 2 of 3 cartons scanned — hand over all 3?');
    expect(asks).toContain('SO-1: Carton 1 carries the COD label and was not scanned — hand over anyway?');
    // Confirming again sends the scanned cartons, sorted.
    handoverReply = { status: 201, body: { handover: { id: 'ho-1', code: 'HO-0001', courierName: 'Delhivery' }, parcels: [], refused: [], rejectedOpId: null } };
    await submit(root.querySelector('form')!);
    const posted = requests.filter((r) => r.method === 'POST');
    expect(posted).toHaveLength(1);
    expect((posted[0]!.body as { parcels: unknown[] }).parcels).toEqual([{ orderId: ORDER_A, cartonCodes: ['O8F90000000000001.2.2', 'O8F90000000000001.2.3'] }]);
  });

  test('story 4-5a — a carton of a courier-label order asks for its AWB next, and the next AWB attaches to that row', async () => {
    writeSession(session('operator'));
    candidates = candidateRows().map((c, i) =>
      i === 1 ? { ...c, packSeq: 1, cartonCount: 2, shipment: { kind: 'courier-label', awb: '555000111', courierName: 'Delhivery', packageCount: 2, labelVerified: false } } : c,
    );
    view = render(
      <HandoverBuilder tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} initialClientId={CLIENT_A} initialOrderId={null} onClose={() => {}} onCreated={() => {}} />,
    );
    await settle();
    const root = byTestId(view.container, 'handover-builder')!;
    await scan(root, 'O8F90000000000002.1.1');
    expect(byTestId(root, 'handover-scan-note')?.textContent).toBe('SO-2 — carton 1 (1/2) ticked — now scan the courier’s AWB on this parcel.');
    expect(root.textContent).toContain('Scan the courier’s AWB for SO-2');
    await scan(root, '555000111');
    const row = root.querySelector(`[data-order-id="${ORDER_B}"]`)!;
    expect((row.querySelectorAll('input')[1] as HTMLInputElement).value).toBe('555000111');
    expect(byTestId(root, 'handover-carton-tally')?.textContent).toBe('Cartons 1/2');
  });

  test('story 4-5a — an ambiguous carton scan is ticked on the row the user picks', async () => {
    writeSession(session('operator'));
    candidates = candidateRows().map((c) => ({ ...c, parcelTagCode: 'O8F90000000000001', packSeq: 1, cartonCount: 2 }));
    view = render(
      <HandoverBuilder tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} initialClientId={CLIENT_A} initialOrderId={null} onClose={() => {}} onCreated={() => {}} />,
    );
    await settle();
    const root = byTestId(view.container, 'handover-builder')!;
    await scan(root, 'O8F90000000000001.1.2');
    expect(byTestId(root, 'handover-scan-note')?.textContent).toBe('This carton matches two parcels — tick the right one below.');
    const second = root.querySelector(`[data-order-id="${ORDER_B}"]`)!;
    await click(second.querySelector('input[type="checkbox"]')!);
    expect((second.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
    expect(byTestId(second as HTMLElement, 'handover-carton-tally')?.textContent).toBe('Cartons 1/2');
    expect(byTestId(root, 'handover-scan-note')?.textContent).toContain('SO-2 — carton 2 (1/2) ticked');
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

describe('story 4-4a review — FV1 Hand over opens the builder on the order', () => {
  test('the order’s client is selected and the order ticked', async () => {
    writeSession(session('operator'));
    shipments = { [ORDER_A]: shipment(ORDER_A, { labelVerifiedAt: '2026-10-30T10:05:00.000Z' }) };
    shippingReads = { [ORDER_A]: shippingRead(ORDER_A) };
    candidates = [
      {
        orderId: ORDER_A, orderLabel: 'SO-1', clientOrderRef: 'SO-1', externalEventId: null, followOnSeq: null, parcelTagCode: 'O8F90000000000001',
        destinationCity: null, codAmountPaise: null, packedAt: null,
        shipment: { kind: 'client-label', awb: '123456789012', courierName: 'Delhivery', packageCount: 1, labelVerified: true },
      },
    ];
    view = render(<OutboundPackDispatch tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH1 Main" role="operator" />);
    await settle();
    await expand('SO-1');
    await click(byTestId(view.container, 'open-hand-over')!);
    const builder = byTestId(view.container, 'handover-builder')!;
    expect(builder).not.toBeNull();
    expect(byTestId<HTMLSelectElement>(builder, 'handover-client')!.value).toBe(CLIENT_A);
    const row = builder.querySelector(`[data-order-id="${ORDER_A}"] input[type="checkbox"]`) as HTMLInputElement;
    expect(row.checked).toBe(true);
    expect(byTestId(builder, 'handover-confirm')?.textContent).toBe('Hand over 1 parcel');
  });
});

describe('story 4-4a review — FV3 the panel forms for a permitted role', () => {
  async function openPanel(read: Record<string, unknown>): Promise<HTMLElement> {
    writeSession(session('operator'));
    shipments = read.shipment === null ? {} : { [ORDER_A]: shipment(ORDER_A) };
    shippingReads = { [ORDER_A]: read };
    view = render(<OutboundPackDispatch tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH1 Main" role="operator" />);
    await settle();
    await expand('SO-1');
    return byTestId(view.container, 'shipping-panel')!;
  }
  const posts = () => requests.filter((r) => r.method === 'POST');

  test('the forms render; Replace posts the label with replace: true', async () => {
    const panel = await openPanel(shippingRead(ORDER_A));
    for (const id of ['open-client-label', 'open-record-awb', 'open-void-shipment', 'document-upload', 'verify-label']) expect(byTestId(panel, id)).not.toBeNull();
    expect(byTestId(panel, 'open-client-label')?.textContent).toBe('Replace client label');
    await click(byTestId(panel, 'open-client-label')!);
    const form = byTestId<HTMLFormElement>(panel, 'shipment-form')!;
    const fileInput = byTestId<HTMLInputElement>(form, 'client-label-file')!;
    Object.defineProperty(fileInput, 'files', { value: [new File(['%PDF-1.7 label'], 'label.pdf', { type: 'application/pdf' })], configurable: true });
    await act(async () => void fileInput.dispatchEvent(new Event('change', { bubbles: true })));
    const inputs = form.querySelectorAll<HTMLInputElement>('input:not([type="file"])');
    setValue(inputs[0]!, '5555 6666 7777');
    setValue(inputs[1]!, 'Delhivery');
    postReplies = { '/shipment/client-label': { status: 201, body: { shipment: clientShipmentView(ORDER_A, { awb: '555566667777' }) } } };
    await submit(form);
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.pathname).toEndWith(`/outbound/orders/${ORDER_A}/shipment/client-label`);
    expect(posts()[0]!.body).toEqual({ file: 'file:label.pdf', awb: '555566667777', courierName: 'Delhivery', replace: 'true' });
  });

  test('FB1 — Discard then reopen starts clean: no stale file is uploaded', async () => {
    const panel = await openPanel(shippingRead(ORDER_A, { shipment: null, label: null }));
    await click(byTestId(panel, 'open-client-label')!);
    let form = byTestId<HTMLFormElement>(panel, 'shipment-form')!;
    const fileInput = byTestId<HTMLInputElement>(form, 'client-label-file')!;
    Object.defineProperty(fileInput, 'files', { value: [new File(['%PDF-1.7'], 'stale.pdf')], configurable: true });
    await act(async () => void fileInput.dispatchEvent(new Event('change', { bubbles: true })));
    await click([...form.querySelectorAll('button')].find((b) => b.textContent === 'Discard')!);
    await click(byTestId(panel, 'open-client-label')!);
    form = byTestId<HTMLFormElement>(panel, 'shipment-form')!;
    const inputs = form.querySelectorAll<HTMLInputElement>('input:not([type="file"])');
    expect(inputs[0]!.value).toBe('');
    setValue(inputs[0]!, '77001');
    setValue(inputs[1]!, 'Delhivery');
    await submit(form);
    expect(posts()).toHaveLength(0);
    expect(form.textContent).toContain('Choose the client’s label PDF.');
  });

  test('Record AWB: an unchanged retry reuses the key; an edit mints a new one', async () => {
    const panel = await openPanel(shippingRead(ORDER_A, { shipment: null, label: null }));
    await click(byTestId(panel, 'open-record-awb')!);
    const form = byTestId<HTMLFormElement>(panel, 'shipment-form')!;
    const inputs = form.querySelectorAll<HTMLInputElement>('input');
    setValue(inputs[0]!, '77001');
    setValue(inputs[1]!, 'Delhivery');
    postReplies = { '/shipment/awb': { status: 503, body: { code: 'file-storage-busy', status: 503, title: 'Busy' } } };
    await submit(form);
    await submit(form);
    setValue(inputs[0]!, '77002');
    await submit(form);
    const sent = posts();
    expect(sent).toHaveLength(3);
    expect(sent[0]!.body).toEqual({ awb: '77001', courierName: 'Delhivery' });
    expect(sent[1]!.key).toBe(sent[0]!.key);
    expect(sent[2]!.key).not.toBe(sent[0]!.key);
  });

  test('Void posts {reason}; a document upload posts its kind', async () => {
    const panel = await openPanel(shippingRead(ORDER_A));
    await click(byTestId(panel, 'open-void-shipment')!);
    const voidForm = byTestId<HTMLFormElement>(panel, 'void-shipment')!;
    setValue(voidForm.querySelector('input')!, ' Wrong AWB ');
    postReplies = { '/shipment/void': { status: 200, body: { shipment: clientShipmentView(ORDER_A, { status: 'voided' }) } }, '/documents': { status: 201, body: { file: { id: 'f-1' } } } };
    await submit(voidForm);
    expect(posts()[0]!.pathname).toEndWith(`/outbound/orders/${ORDER_A}/shipment/void`);
    expect(posts()[0]!.body).toEqual({ reason: 'Wrong AWB' });

    const upload = byTestId<HTMLFormElement>(view!.container, 'document-upload')!;
    setValue(upload.querySelector('select')!, 'eway-bill');
    const docInput = byTestId<HTMLInputElement>(upload, 'document-file')!;
    Object.defineProperty(docInput, 'files', { value: [new File(['%PDF-1.7 ewb'], 'ewb.pdf', { type: 'application/pdf' })], configurable: true });
    await act(async () => void docInput.dispatchEvent(new Event('change', { bubbles: true })));
    await settle();
    await submit(upload);
    const doc = posts().find((r) => r.pathname.endsWith('/documents'))!;
    expect(doc.pathname).toEndWith(`/outbound/orders/${ORDER_A}/documents`);
    expect(doc.body).toEqual({ file: 'file:ewb.pdf', kind: 'eway-bill' });
    expect(doc.key).toMatch(KEY_RE);
  });
});

describe('story 4-4a review — FV4 the handover sheet', () => {
  const detail = (sheetPages: number) => ({
    id: 'ho-1', code: 'HO-0001', warehouseId: WAREHOUSE_ID, clientId: CLIENT_A, courierName: 'Delhivery', transporterId: null,
    pickupPersonName: 'Ravi', pickupPersonPhone: '+919876543210', vehicleNumber: 'KA01AB1234', handedOverAt: '2026-10-30T10:35:00.000Z',
    shipmentCount: 2, packageCount: 3, codShipmentCount: 1, codTotalPaise: 125000, source: 'web', note: null,
    clientSnapshot: { v: 1, code: 'BRAND-A', name: 'Brand A', legalName: 'Brand A Apparel Pvt Ltd', gstin: '29ABCDE1234F1Z5', registeredAddress: null },
    warehouseSnapshot: { code: 'WH1', name: 'Main DC', gstin: null, originAddress: { line1: '1 Dock Rd', line2: null, city: 'Chennai', stateCode: '33', pincode: '600001' } },
    courierSnapshot: null, createdBy: 'u-1',
    parcels: [
      { orderId: ORDER_A, orderLabel: 'SO-1', shipmentId: 'sh-1', kind: 'client-label', awb: '123456789012', packageCount: 2, weightGrams: 1250, codAmountPaise: 125000, destinationCity: 'Pune',
        cartons: { cartonCount: 3, scanned: 2, legacy: false, codCartonScanned: false, staleCartonLabels: true } },
      { orderId: ORDER_B, orderLabel: 'SO-2', shipmentId: 'sh-2', kind: 'courier-label', awb: '77001', packageCount: 1, weightGrams: null, codAmountPaise: null, destinationCity: null,
        cartons: { cartonCount: 1, scanned: 0, legacy: true, codCartonScanned: null, staleCartonLabels: false } },
    ],
    sheet: Array.from({ length: sheetPages }, (_, i) => ({
      id: `s-${i}`, purpose: 'handover-sheet', docKind: null, fileName: `HO-0001-sheet-${i + 1}.jpg`, contentType: 'image/jpeg', byteSize: 1024, pageCount: null,
      source: 'web', uploadedAt: '2026-10-30T11:00:00.000Z', uploadedBy: 'u-1', url: null, urlExpiresAt: null,
    })),
  });

  async function openSheet(role: StoredSession['user']['role'], sheetPages: number): Promise<HTMLElement> {
    writeSession(session(role));
    handoverDetail = detail(sheetPages);
    handoverRows = [{ id: 'ho-1', code: 'HO-0001', clientId: CLIENT_A, clientCode: 'BRAND-A', courierName: 'Delhivery', shipmentCount: 2, packageCount: 3, handedOverAt: '2026-10-30T10:35:00.000Z', sheetPageCount: sheetPages, source: 'web' }];
    view = render(<HandoversCard tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH1 Main" role={role} />);
    await settle();
    await expand('HO-0001');
    return byTestId(view.container, 'handover-detail')!;
  }

  test('the frozen parties, one row per parcel with the server’s counts, never the pickup phone', async () => {
    const root = await openSheet('operator', 0);
    const sheet = root.querySelector('[data-print-root]')!;
    expect(sheet.textContent).toContain('Brand A Apparel Pvt Ltd');
    expect(sheet.textContent).toContain('Main DC');
    expect(sheet.textContent).toContain('1 Dock Rd');
    expect(sheet.textContent).toContain('Ravi');
    expect(sheet.textContent).not.toContain('9876543210');
    const rows = sheet.querySelectorAll('[data-testid="sheet-parcel"]');
    expect(rows).toHaveLength(2);
    // The Parcels column follows the two story 4-6a document columns.
    expect(rows[0]!.querySelectorAll('td')[5]!.textContent).toBe('2');
    expect(byTestId(root, 'sheet-upload')).not.toBeNull();
  });

  test('story 4-6a (A19, A39) — the stamped document and e-way bill print; "Not recorded" only for a flagged parcel with none; a late record is noted for staff', async () => {
    writeSession(session('operator'));
    const base = detail(0);
    handoverDetail = {
      ...base,
      parcels: [
        { ...base.parcels[0]!, taxDocument: { type: 'invoice', number: 'INV/26-27/0042', date: '2026-10-30' }, ewayBillNumber: '123456789012', ewayValidUntil: '2026-11-01', complianceException: null, lateRecord: null },
        {
          ...base.parcels[1]!,
          taxDocument: null,
          ewayBillNumber: null,
          ewayValidUntil: null,
          complianceException: 'consignment-documents-missing',
          lateRecord: { seq: 2, brandDocument: { type: 'invoice', number: 'INV-9', date: '2026-10-31' }, ewayBillNumber: null, recordedAt: '2026-10-31T08:40:00.000Z' },
        },
      ],
    };
    handoverRows = [{ id: 'ho-1', code: 'HO-0001', clientId: CLIENT_A, clientCode: 'BRAND-A', courierName: 'Delhivery', shipmentCount: 2, packageCount: 3, handedOverAt: '2026-10-30T10:35:00.000Z', sheetPageCount: 0, source: 'web' }];
    view = render(<HandoversCard tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH1 Main" role="operator" />);
    await settle();
    await expand('HO-0001');
    const root = byTestId(view.container, 'handover-detail')!;
    const docs = [...root.querySelectorAll('[data-testid="sheet-parcel-document"]')].map((td) => td.textContent);
    const eways = [...root.querySelectorAll('[data-testid="sheet-parcel-eway"]')].map((td) => td.textContent);
    expect(docs).toEqual(['INV INV/26-27/0042', 'Not recorded']);
    expect(eways).toEqual(['1234 5678 9012 (to 1 Nov 2026)', 'Not recorded']);
    const notes = [...root.querySelectorAll('[data-testid="sheet-parcel-exception"]')].map((n) => n.textContent);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('Left without the brand’s invoice — cleared by a late record (v2,');
  });

  test('story 4-6a — an older API without the keys prints a dash, never "Not recorded"', async () => {
    const root = await openSheet('operator', 0);
    expect([...root.querySelectorAll('[data-testid="sheet-parcel-document"]')].map((td) => td.textContent)).toEqual(['—', '—']);
    expect(root.querySelector('[data-testid="sheet-parcel-exception"]')).toBeNull();
  });

  test('story 4-5a (AC5, A34, A37, A44) — each order’s cartons, the legacy line and the amber flags', async () => {
    const root = await openSheet('operator', 0);
    const lines = root.querySelectorAll('[data-testid="sheet-parcel-cartons"]');
    expect(lines[0]!.textContent).toContain('3 cartons, 2 scanned');
    expect(lines[1]!.textContent).toContain('1 carton (packed before cartons were recorded)');
    const flags = [...root.querySelectorAll('[data-testid="sheet-parcel-carton-flag"]')].map((f) => f.textContent);
    expect(flags).toHaveLength(2);
    expect(flags[0]).toContain('Carton 1 (the COD label) was not scanned');
    expect(flags[1]).toContain('Stale carton labels');
  });

  test('the sheet upload is hidden at 10 pages and without dispatch.execute', async () => {
    let root = await openSheet('operator', 10);
    expect(byTestId(root, 'sheet-upload')).toBeNull();
    view!.unmount();
    view = undefined;
    root = await openSheet('accountant', 0);
    expect(byTestId(root, 'sheet-upload')).toBeNull();
  });
});

describe('story 4-5a — the Shipping panel once packed (A26, A40)', () => {
  const pack = (cartonCount: number) => ({
    pack: {
      packSeq: 1,
      status: 'live',
      legacy: false,
      partiesFrozen: true,
      cartonCount,
      grossWeightGrams: null,
      packedAt: '2026-10-30T10:00:00.000Z',
      packedBy: 'u-1',
      cartons: Array.from({ length: cartonCount }, (_, i) => ({
        seq: i + 1,
        code: `O8F90000000000001.1.${i + 1}`,
        weightGrams: null,
        dimensionsMm: null,
        lineCount: 1,
        totals: [{ uom: 'each', qty: 1 }],
        lines: [{ skuId: 'sku-1', skuCode: 'A', skuName: 'A', uom: 'each', qty: 1, handlingUnitIds: null }],
      })),
    },
    history: [],
  });

  async function openPanel(role: 'operator' | 'accountant'): Promise<HTMLElement> {
    writeSession(session(role));
    shipments = { [ORDER_A]: shipment(ORDER_A) };
    shippingReads = { [ORDER_A]: shippingRead(ORDER_A) };
    view = render(<OutboundPackDispatch tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH1 Main" role={role} />);
    await settle();
    await expand('SO-1');
    return byTestId(view.container, 'shipping-panel')!;
  }

  test('a packed order offers Print carton labels instead of the parcel tag, and warns when the client label has fewer pages than cartons', async () => {
    cartonsReads = { [ORDER_A]: pack(3) };
    const panel = await openPanel('operator');
    expect(byTestId(panel, 'parcel-tag-zpl')).toBeNull();
    expect(byTestId(panel, 'carton-labels-zpl')?.textContent).toBe('Print carton labels');
    expect(byTestId(panel, 'client-label-pages-warning')?.textContent).toBe('The client’s label has 1 page for 3 cartons.');
    await click(byTestId(panel, 'carton-labels-zpl')!);
    const read = requests.find((r) => r.pathname.endsWith('/carton-labels'));
    expect(read?.search).toBe('?format=zpl&layout=label');
  });

  test('an accepted order’s Shipping panel still offers the parcel tag, not carton labels', async () => {
    writeSession(session('operator'));
    view = render(<OutboundPackDispatch tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH1 Main" role="operator" />);
    await settle();
    await expand('SO-2');
    const panel = byTestId(view.container, 'shipping-panel')!;
    expect(byTestId(panel, 'parcel-tag-zpl')).not.toBeNull();
    expect(byTestId(panel, 'parcel-tag-pdf')).not.toBeNull();
    expect(byTestId(panel, 'carton-labels-zpl')).toBeNull();
  });

  test('one carton and a one-page label: no warning; without labels.execute no carton-label print', async () => {
    cartonsReads = { [ORDER_A]: pack(1) };
    const panel = await openPanel('accountant');
    expect(byTestId(panel, 'client-label-pages-warning')).toBeNull();
    expect(byTestId(panel, 'carton-labels-zpl')).toBeNull();
  });
});


describe('story 4-6a — the Docs cell and the Documents tab (A16, A24)', () => {
  test('the Docs cell: the gate’s word on an open row; a dash from an older API', async () => {
    writeSession(session('operator'));
    consignmentStates = { [ORDER_A]: 'missing' };
    view = render(<OutboundPackDispatch tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH1 Main" role="operator" />);
    await settle();
    const cells = [...view.container.querySelectorAll('[data-testid="docs-cell"]')].map((c) => c.textContent);
    expect(cells).toEqual(['Invoice needed']);
  });

  const neededRow = {
    orderId: ORDER_A,
    orderLabel: 'SO-1',
    clientId: CLIENT_A,
    clientCode: 'BRAND-A',
    orderType: 'b2c',
    stage: 'packed',
    state: 'missing',
    requiredBecause: 'value',
    valueFloorPaise: 6_200_000,
    eway: null,
    declaredBelowRatedValue: false,
    createdAt: '2026-10-30T10:00:00.000Z',
    packedAt: '2026-10-30T11:00:00.000Z',
  };

  test('Needed: the word first, why, and Record opens the order’s Tax documents with its form', async () => {
    writeSession(session('operator'));
    worklist = { view: 'needed', needed: [neededRow], exceptions: [], truncated: false };
    consignmentReads = {
      [ORDER_A]: {
        gate: { state: 'missing', blocking: true, requiredBecause: 'value', valueFloorPaise: 6_200_000, nationalThresholdPaise: 5_000_000, expiresToday: false },
        live: null, history: [], dispatchedRecordId: null, duplicates: [], consignorStateMismatch: false, ewayUsedByOtherClient: null, scans: [], complianceException: null,
      },
    };
    view = render(<ConsignmentsCard tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH1 Main" role="operator" />);
    await settle();
    const read = requests.find((r) => r.pathname.endsWith('/outbound/consignments'))!;
    expect(read.search).toBe('');
    expect(byTestId(view.container, 'worklist-needed')!.textContent).toBe('Invoice needed');
    expect(byTestId(view.container, 'worklist-why')!.textContent).toBe('Value ₹62,000 by the order’s own figures — above ₹50,000');
    await act(async () => byTestId<HTMLButtonElement>(view!.container, 'worklist-record')!.click());
    await settle();
    expect(byTestId(view.container, 'consignment-panel')).not.toBeNull();
    expect(byTestId(view.container, 'consignment-form')).not.toBeNull();
  });

  test('Left without documents: the exceptions view is read and each flag worded; an all-clear list says so', async () => {
    writeSession(session('operator'));
    view = render(<ConsignmentsCard tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH1 Main" role="operator" />);
    await settle();
    expect(view.container.textContent).toContain('No open order is waiting for the brand’s documents.');
    worklist = {
      view: 'exceptions',
      needed: [],
      exceptions: [{ orderId: ORDER_A, orderLabel: 'SO-1', clientId: CLIENT_A, clientCode: 'BRAND-A', shipmentId: 'sh-1', handoverId: 'ho-1', handoverCode: 'HO-0001', handedOverAt: '2026-10-30T10:35:00.000Z', code: 'consignment-documents-missing', state: 'missing' }],
      truncated: false,
    };
    await act(async () => byTestId<HTMLButtonElement>(view!.container, 'documents-view-exceptions')!.click());
    await settle();
    expect(requests.filter((r) => r.pathname.endsWith('/outbound/consignments')).at(-1)!.search).toBe('?view=exceptions');
    expect(byTestId(view.container, 'worklist-exception')!.textContent).toBe('Left without the brand’s invoice');
  });
});
