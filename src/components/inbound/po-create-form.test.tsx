import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { writeActiveClientId } from '../../lib/active-client';
import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import type { UserRole } from '../../lib/users';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { writeActiveWarehouseId } from '../../lib/warehouses';
import { InboundCards } from './inbound-cards';

/**
 * Story 2-1 — the "Raise a purchase order" form on Inbound → Purchase
 * orders, driven through a stubbed global `fetch` (the generated client is a
 * fetch wrapper, so the gates, wiring and wrappers under test are the ones
 * that ship). Its claims a `src/lib` test cannot make:
 *   1. the button is `po.manage`'s — absent (not disabled) for an operator;
 *   2. the client defaults to the active one; the vendor and SKU options come
 *      from the client-scoped server reads (vendors linked to that client,
 *      its active SKUs) and never offer a kit;
 *   3. changing the client clears the vendor and the lines;
 *   4. the loading, empty and failed states (clients, vendors);
 *   5. pressing Raise POSTs the exact body with a key, and a retry after a
 *      dropped request reuses it (one PO); an edit mints a new one;
 *   6. a warehouse switch closes the form and drops its draft;
 *   7. the banner after a 201, with the hidden-by-filter note.
 */

const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WH = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';
const WH2 = '0198f7a2-1b3c-7d4e-8f90-99aabbccddff';

function session(role: UserRole): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: T, name: 'Priya Logistics', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  } as StoredSession;
}

const SELF = { id: 'c-self', code: 'self', name: 'Priya Logistics', status: 'active', systemOwned: true };
const GLOW = { id: 'c-glow', code: 'GLOW', name: 'GlowCo', status: 'active', systemOwned: false };
const BRANDX = { id: 'c-brandx', code: 'BRANDX', name: 'Brand X', status: 'active', systemOwned: false };

let clients: Record<string, unknown>[] = [SELF, GLOW, BRANDX];
let clientsMode: 'ok' | 'fail' = 'ok';
let partnersMode: 'ok' | 'hang' | 'fail' = 'ok';

function link(clientId: string, active = true) {
  return { id: `l-${clientId}`, clientId, role: 'vendor', clientCode: null, active, isDefault: false };
}
function partner(id: string, code: string, name: string, links: unknown[]) {
  return { id, code, name, roles: ['vendor'], status: 'active', links };
}
/** GlowCo's server-side partner read: two linked vendors, one whose GlowCo link is switched off. */
let glowPartners = [
  partner('v-zed', 'V-ZED', 'Zed Supplies', [link('c-glow')]),
  partner('v-krishna', 'V-KRISHNA', 'Krishna Traders', [link('c-glow')]),
  partner('v-off', 'V-OFF', 'Switched Off', [link('c-glow', false), link('c-brandx')]),
];

function sku(id: string, code: string, clientId: string, uom = 'each', uomPrecision = 0) {
  return { id, code, name: `${code} name`, uom, uomPrecision, clientId, status: 'active' };
}
const ALL_GLOW_SKUS = [sku('s-glow-1', 'GLOW-1', 'c-glow'), sku('s-glow-2', 'GLOW-2', 'c-glow', 'kg', 3), sku('s-glow-kit', 'GLOW-KIT', 'c-glow')];
const BRANDX_SKUS = [sku('s-bx-1', 'BX-1', 'c-brandx')];
let GLOW_SKUS = ALL_GLOW_SKUS;
let skusMode: 'ok' | 'fail' = 'ok';
let kitsMode: 'ok' | 'hang' | 'fail' = 'ok';
/** The PO list's first page offers a next page (the page-two test). */
let poListNextCursor: string | null = null;
let kits = [{ skuId: 's-glow-kit', skuCode: 'GLOW-KIT', components: [{ skuId: 's-glow-1', quantity: 1 }] }];

/** What the PO create answers next: a 201 for a client, a problem, or a dropped request. */
let createAnswers: (
  | { kind: 'ok'; clientId: string }
  | { kind: 'problem'; status: number; code: string; detail: string; extensions?: Record<string, unknown> }
  | { kind: 'drop' }
  | { kind: 'hang' }
)[] = [];

let requests: { method: string; url: URL; body: unknown; key: string | null }[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();
    const base = `/api/v1/tenants/${T}`;
    let body: unknown = null;
    try {
      body = await request.clone().json();
    } catch {
      body = null;
    }
    requests.push({ method, url, body, key: request.headers.get('Idempotency-Key') });
    if (pathname === `${base}/warehouses`) {
      return json(200, {
        items: [
          { id: WH, code: 'BLR', name: 'Bengaluru DC' },
          { id: WH2, code: 'HYD', name: 'Hyderabad DC' },
        ],
        nextCursor: null,
      });
    }
    if (pathname === `${base}/clients`) {
      if (clientsMode === 'fail') return json(500, { code: 'internal', title: 'Boom', status: 500 });
      return json(200, { items: clients });
    }
    if (pathname === `${base}/partners`) {
      if (partnersMode === 'hang') return new Promise<Response>(() => undefined);
      if (partnersMode === 'fail') return json(500, { code: 'internal', title: 'Boom', status: 500, detail: 'partners down' });
      const clientId = url.searchParams.get('clientId');
      return json(200, { items: clientId === 'c-glow' ? glowPartners : [], nextCursor: null });
    }
    if (pathname === `${base}/catalog/skus`) {
      if (skusMode === 'fail' && url.searchParams.has('clientId')) {
        return json(500, { code: 'internal', title: 'Boom', status: 500, detail: 'skus down' });
      }
      const clientId = url.searchParams.get('clientId');
      const items = clientId === 'c-glow' ? GLOW_SKUS : clientId === 'c-brandx' ? BRANDX_SKUS : [...GLOW_SKUS, ...BRANDX_SKUS];
      return json(200, { items, nextCursor: null });
    }
    if (pathname === `${base}/catalog/kits`) {
      if (kitsMode === 'hang') return new Promise<Response>(() => undefined);
      if (kitsMode === 'fail') return json(500, { code: 'internal', title: 'Boom', status: 500, detail: 'kits down' });
      return json(200, { items: kits, nextCursor: null });
    }
    if (pathname === `${base}/inbound/purchase-orders` && method === 'POST') {
      const answer = createAnswers.shift() ?? { kind: 'ok', clientId: 'c-glow' };
      if (answer.kind === 'drop') throw new TypeError('Failed to fetch');
      if (answer.kind === 'hang') return new Promise<Response>(() => undefined);
      if (answer.kind === 'problem') {
        return json(answer.status, { code: answer.code, title: answer.detail, detail: answer.detail, status: answer.status, ...(answer.extensions ?? {}) });
      }
      const sent = body as { code: string; vendorId: string; warehouseId: string; lines: { skuId: string; orderedQty: number; unitCostPaise: number }[] };
      return json(201, {
        purchaseOrder: {
          id: 'po-new',
          tenantId: T,
          warehouseId: sent.warehouseId,
          vendorId: sent.vendorId,
          code: sent.code,
          status: 'open',
          carriedFromPoId: null,
          clientId: answer.clientId,
          vendorSnapshot: { v: 1, code: 'V-KRISHNA', name: 'Krishna Traders', legalName: null, gstin: null, stateCode: null, registeredAddress: null, dispatchAddress: null },
          createdAt: '2026-10-20T05:00:00.000Z',
          updatedAt: '2026-10-20T05:00:00.000Z',
          lines: sent.lines.map((line, index) => ({ ...line, id: `pl-${index}`, poId: 'po-new', receivedQty: 0, openQty: line.orderedQty, status: 'open', expectedDate: null, createdAt: '2026-10-20T05:00:00.000Z' })),
        },
      });
    }
    if (pathname.endsWith('/inbound/purchase-orders')) {
      if (url.searchParams.has('status') || poListNextCursor === null) return json(200, { items: [], nextCursor: null });
      const page = url.searchParams.has('cursor') ? 2 : 1;
      return json(200, { items: [poRow(`po-p${page}`, `PO-PAGE-${page}`)], nextCursor: page === 1 ? poListNextCursor : null });
    }
    if (pathname.startsWith(`${base}/inbound/purchase-orders/`)) {
      const id = pathname.split('/').pop()!;
      return json(200, { purchaseOrder: { ...poRow(id, id), lines: [] } });
    }
    if (pathname.endsWith('/inbound/asns')) return json(200, { items: [], nextCursor: null });
    if (pathname.endsWith('/inventory/stock')) return json(200, { items: [], nextCursor: null });
    if (pathname === `${base}/receiving/qc-holds`) return json(200, { items: [], nextCursor: null });
    if (pathname === `${base}/putaway/tasks`) return json(200, { items: [] });
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

function poRow(id: string, code: string): Record<string, unknown> {
  return {
    id, tenantId: T, warehouseId: WH, vendorId: 'v-krishna', code, status: 'open', carriedFromPoId: null, clientId: 'c-glow',
    vendorSnapshot: null, createdAt: '2026-10-18T05:00:00.000Z', updatedAt: '2026-10-18T05:00:00.000Z',
  };
}

let view: Rendered | undefined;

beforeEach(() => {
  clients = [SELF, GLOW, BRANDX];
  clientsMode = 'ok';
  partnersMode = 'ok';
  skusMode = 'ok';
  kitsMode = 'ok';
  poListNextCursor = null;
  GLOW_SKUS = ALL_GLOW_SKUS;
  createAnswers = [];
  requests = [];
  kits = [{ skuId: 's-glow-kit', skuCode: 'GLOW-KIT', components: [{ skuId: 's-glow-1', quantity: 1 }] }];
  stubRouter();
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
  restoreGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 14; i++) {
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
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function button(container: ParentNode, label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === label);
}

async function press(target: HTMLButtonElement | undefined): Promise<void> {
  expect(target).toBeDefined();
  await act(async () => {
    target!.click();
  });
  await settle();
}

async function mount(role: UserRole, activeClient: string | null = 'c-glow'): Promise<void> {
  writeSession(session(role));
  writeActiveWarehouseId(T, WH);
  if (activeClient !== null) writeActiveClientId(T, 'u-1', activeClient);
  view = render(<InboundCards initialTab="pos" />);
  await settle();
}

const form = () => view!.container.querySelector<HTMLFormElement>('form[aria-label="Raise a purchase order"]');
const optionTexts = (select: string) => [...form()!.querySelectorAll(`select[aria-label="${select}"] option`)].map((o) => o.textContent ?? '');
const select = (label: string) => form()!.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
const input = (label: string) => form()!.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const raise = () => [...form()!.querySelectorAll('button')].find((b) => b.textContent === 'Raise')!;
/** The PO LIST's own reads (the tab count's `status=open` read is another reader). */
const listReads = () =>
  requests.filter((r) => r.method === 'GET' && r.url.pathname.endsWith('/inbound/purchase-orders') && !r.url.searchParams.has('status')).length;
const posts = () => requests.filter((r) => r.method === 'POST' && r.url.pathname.endsWith('/inbound/purchase-orders'));

async function openForm(): Promise<void> {
  await press(button(view!.container, 'Raise a purchase order'));
  expect(form()).not.toBeNull();
}

/** A complete GlowCo draft: V-KRISHNA, PO-1001, 2026-10-25, two lines. */
function fillGlowDraft(): void {
  setSelect(select('Vendor')!, 'v-krishna');
  setInput(input('PO code'), ' PO-1001 ');
  setInput(input('Expected date'), '2026-10-25');
  setSelect(select('Line 1 SKU')!, 's-glow-1');
  setInput(input('Line 1 quantity'), '10');
  setInput(input('Line 1 unit cost (₹)'), '12.5');
  act(() => button(form()!, 'Add line')!.click());
  setSelect(select('Line 2 SKU')!, 's-glow-2');
  setInput(input('Line 2 quantity'), '2.5');
  setInput(input('Line 2 unit cost (₹)'), '400');
}

const EXPECTED_BODY = {
  warehouseId: WH,
  vendorId: 'v-krishna',
  code: 'PO-1001',
  lines: [
    { skuId: 's-glow-1', orderedQty: 10, unitCostPaise: 1250, expectedDate: '2026-10-24T18:30:00.000Z' },
    { skuId: 's-glow-2', orderedQty: 2.5, unitCostPaise: 40000, expectedDate: '2026-10-24T18:30:00.000Z' },
  ],
};

describe('PoCreateForm', () => {
  test('an operator (no po.manage) is offered no Raise button — absent, not disabled', async () => {
    await mount('operator');
    expect(button(view!.container, 'Raise a purchase order')).toBeUndefined();
    expect(form()).toBeNull();
  });

  test('GlowCo selected: the client defaults to GlowCo; only its actively linked vendors (by code) and active non-kit SKUs are offered, from client-scoped reads', async () => {
    await mount('ops_manager');
    await openForm();
    expect(select('Client')!.value).toBe('c-glow');
    // V-OFF's GlowCo link is switched off: never offered; sorted by code.
    expect(optionTexts('Vendor')).toEqual(['Pick the vendor…', 'V-KRISHNA — Krishna Traders', 'V-ZED — Zed Supplies']);
    // GLOW-KIT is GlowCo's but a kit: never offered.
    expect(optionTexts('Line 1 SKU')).toEqual(['Pick a SKU…', 'GLOW-1 — GLOW-1 name', 'GLOW-2 — GLOW-2 name']);
    const partnerRead = requests.find((r) => r.url.pathname.endsWith('/partners'))!;
    expect(Object.fromEntries(partnerRead.url.searchParams)).toEqual({ role: 'vendor', clientId: 'c-glow', status: 'active', limit: '200' });
    const skuRead = requests.find((r) => r.url.pathname.endsWith('/catalog/skus') && r.url.searchParams.get('clientId') === 'c-glow')!;
    expect(Object.fromEntries(skuRead.url.searchParams)).toEqual({ clientId: 'c-glow', status: 'active', limit: '200' });
  });

  test('changing the client clears the vendor and the lines; a client with no linked vendor says so and Raise stays disabled', async () => {
    await mount('ops_manager');
    await openForm();
    setSelect(select('Vendor')!, 'v-krishna');
    setSelect(select('Line 1 SKU')!, 's-glow-1');
    setInput(input('Line 1 quantity'), '4');
    setSelect(select('Client')!, 'c-brandx');
    await settle();
    expect(select('Vendor')).toBeNull();
    expect(form()!.textContent).toContain('No vendor is linked to BRANDX — Brand X yet — link one under Settings → Partners.');
    expect(optionTexts('Line 1 SKU')).toEqual(['Pick a SKU…', 'BX-1 — BX-1 name']);
    expect(raise().disabled).toBe(true);
    setSelect(select('Client')!, 'c-glow');
    await settle();
    expect(select('Vendor')!.value).toBe('');
    expect(select('Line 1 SKU')!.value).toBe('');
    expect(input('Line 1 quantity').value).toBe('');
  });

  test('"All clients" with several clients: "Pick the client first", no vendor and no lines, Raise disabled', async () => {
    await mount('owner', null);
    await openForm();
    expect(select('Client')!.value).toBe('');
    expect(form()!.textContent).toContain('Pick the client first');
    expect(select('Vendor')).toBeNull();
    expect(select('Line 1 SKU')).toBeNull();
    expect(raise().disabled).toBe(true);
    expect(requests.some((r) => r.url.pathname.endsWith('/partners'))).toBe(false);
  });

  test('a tenant with only its own client sees no client picker — its own client is the one', async () => {
    clients = [SELF];
    await mount('owner', null);
    await openForm();
    expect(select('Client')).toBeNull();
    expect(requests.some((r) => r.url.pathname.endsWith('/partners') && r.url.searchParams.get('clientId') === 'c-self')).toBe(true);
  });

  test('the clients read failed: "Client list unavailable" and Raise disabled', async () => {
    clientsMode = 'fail';
    await mount('owner', null);
    await openForm();
    expect(form()!.textContent).toContain('Client list unavailable');
    expect(raise().disabled).toBe(true);
  });

  test('vendors loading reads "Loading vendors…"; a failed vendor read shows the failure with Retry', async () => {
    partnersMode = 'hang';
    await mount('ops_manager');
    await openForm();
    expect(form()!.textContent).toContain('Loading vendors…');
    expect(raise().disabled).toBe(true);
    view!.unmount();
    view = undefined;
    partnersMode = 'fail';
    view = render(<InboundCards initialTab="pos" />);
    await settle();
    await openForm();
    expect(form()!.textContent).toContain('Vendors unavailable');
    expect(button(form()!, 'Retry')).toBeDefined();
    partnersMode = 'ok';
    await press(button(form()!, 'Retry'));
    expect(select('Vendor')).not.toBeNull();
  });

  test('Raise POSTs the exact body with a key; a dropped request\'s retry reuses the key; then the banner names the PO and the list re-reads from page one', async () => {
    await mount('ops_manager');
    await openForm();
    fillGlowDraft();
    createAnswers = [{ kind: 'drop' }, { kind: 'ok', clientId: 'c-glow' }];
    await press(raise());
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.body).toEqual(EXPECTED_BODY);
    expect(posts()[0]!.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(form()!.textContent).toContain('The API is unreachable');
    // The values are kept.
    expect(input('PO code').value).toBe(' PO-1001 ');

    const listReadsBefore = listReads();
    await press(raise());
    expect(posts()).toHaveLength(2);
    expect(posts()[1]!.key).toBe(posts()[0]!.key);
    expect(posts()[1]!.body).toEqual(EXPECTED_BODY);
    // Success: the form closes, the banner reads from the response, and the
    // list re-reads (INBOUND_CHANGED_EVENT — onCursor(null) from page one alone would not).
    expect(form()).toBeNull();
    expect(view!.container.textContent).toContain('PO PO-1001 raised');
    expect(view!.container.textContent).toContain('2 lines ordered from Krishna Traders.');
    expect(view!.container.querySelector('[data-testid="hidden-by-client-filter"]')).toBeNull();
    const listReadsAfter = listReads();
    expect(listReadsAfter).toBeGreaterThan(listReadsBefore);
  });

  test('an edit after a refusal mints a new key; a duplicate code shows the server\'s detail and keeps the values', async () => {
    await mount('ops_manager');
    await openForm();
    fillGlowDraft();
    createAnswers = [
      { kind: 'problem', status: 409, code: 'conflict', detail: 'Purchase order code "PO-1001" already exists in this tenant.' },
      { kind: 'ok', clientId: 'c-glow' },
    ];
    await press(raise());
    expect(form()!.querySelector('[role="alert"]')!.textContent).toBe('Purchase order code "PO-1001" already exists in this tenant.');
    expect(select('Vendor')!.value).toBe('v-krishna');
    setInput(input('PO code'), 'PO-1002');
    await press(raise());
    expect(posts()).toHaveLength(2);
    expect(posts()[1]!.key).not.toBe(posts()[0]!.key);
    expect((posts()[1]!.body as { code: string }).code).toBe('PO-1002');
  });

  test('a stale vendor (vendor-not-linked) shows the detail, keeps the draft and re-reads the vendors', async () => {
    await mount('ops_manager');
    await openForm();
    fillGlowDraft();
    const partnerReads = () => requests.filter((r) => r.url.pathname.endsWith('/partners')).length;
    const before = partnerReads();
    createAnswers = [{ kind: 'problem', status: 409, code: 'vendor-not-linked', detail: 'Vendor "V-KRISHNA" has no active link to client GLOW.' }];
    // The link was switched off in another tab: the re-read drops V-KRISHNA.
    glowPartners = glowPartners.filter((p) => p.id !== 'v-krishna');
    try {
      await press(raise());
      expect(form()!.querySelector('[role="alert"]')!.textContent).toBe('Vendor "V-KRISHNA" has no active link to client GLOW.');
      expect(partnerReads()).toBeGreaterThan(before);
      // The dropped vendor stays named, not choosable; Raise waits for a fresh pick.
      expect(optionTexts('Vendor')).toContain('Krishna Traders (not linked / inactive)');
      expect(raise().disabled).toBe(true);
      expect(input('PO code').value).toBe(' PO-1001 ');
    } finally {
      glowPartners = [
        partner('v-zed', 'V-ZED', 'Zed Supplies', [link('c-glow')]),
        partner('v-krishna', 'V-KRISHNA', 'Krishna Traders', [link('c-glow')]),
        partner('v-off', 'V-OFF', 'Switched Off', [link('c-glow', false), link('c-brandx')]),
      ];
    }
  });

  test('a SKU made a kit in another tab: the 409 names it from a fresh kit read', async () => {
    await mount('ops_manager');
    await openForm();
    fillGlowDraft();
    createAnswers = [{ kind: 'problem', status: 409, code: 'kit-cannot-hold-stock', detail: 'Purchase order line names kit SKU(s) "GLOW-2" — …' }];
    kits = [...kits, { skuId: 's-glow-2', skuCode: 'GLOW-2', components: [{ skuId: 's-glow-1', quantity: 1 }] }];
    await press(raise());
    expect(form()!.querySelector('[role="alert"]')!.textContent).toBe('GLOW-2 is a kit — order its component SKUs instead.');
  });

  test('a PO raised for another client than the filter: the banner adds the hidden-by-filter note', async () => {
    await mount('ops_manager');
    await openForm();
    fillGlowDraft();
    createAnswers = [{ kind: 'ok', clientId: 'c-brandx' }];
    await press(raise());

    expect(view!.container.querySelector('[data-testid="hidden-by-client-filter"]')!.textContent).toBe(
      'Created for BRANDX — Brand X — hidden by the client filter',
    );
  });

  test('a warehouse switch closes the form and drops the draft and its key', async () => {
    await mount('ops_manager');
    await openForm();
    fillGlowDraft();
    createAnswers = [{ kind: 'drop' }];
    await press(raise());
    const firstKey = posts()[0]!.key;
    act(() => writeActiveWarehouseId(T, WH2));
    await settle();
    expect(form()).toBeNull();
    act(() => writeActiveWarehouseId(T, WH));
    await settle();
    expect(form()).toBeNull();
    await openForm();
    expect(input('PO code').value).toBe('');
    fillGlowDraft();
    await press(raise());
    expect(posts()).toHaveLength(2);
    expect(posts()[1]!.key).not.toBe(firstKey);
  });
  test('(a) after an edit the draft stays on its client when the active client changes', async () => {
    await mount('ops_manager');
    await openForm();
    setSelect(select('Vendor')!, 'v-krishna');
    setSelect(select('Line 1 SKU')!, 's-glow-1');
    setInput(input('Line 1 quantity'), '4');
    act(() => writeActiveClientId(T, 'u-1', 'c-brandx'));
    await settle();
    expect(select('Client')!.value).toBe('c-glow');
    expect(select('Vendor')!.value).toBe('v-krishna');
    expect(select('Line 1 SKU')!.value).toBe('s-glow-1');
    expect(input('Line 1 quantity').value).toBe('4');
  });

  test('(b) raising a PO from page two returns the list to page one (no cursor, no Prev)', async () => {
    poListNextCursor = 'cursor-page-2';
    await mount('ops_manager');
    const panel = view!.container.querySelector('[role="tabpanel"]') as HTMLElement;
    await press(button(panel, 'Next'));
    expect(panel.textContent).toContain('PO-PAGE-2');
    expect(button(panel, 'Prev')!.disabled).toBe(false);
    await openForm();
    fillGlowDraft();
    const before = requests.length;
    await press(raise());
    const listReadsAfter = requests
      .slice(before)
      .filter((r) => r.method === 'GET' && r.url.pathname.endsWith('/inbound/purchase-orders') && !r.url.searchParams.has('status'));
    expect(listReadsAfter.length).toBeGreaterThan(0);
    expect(listReadsAfter.at(-1)!.url.searchParams.has('cursor')).toBe(false);
    expect(panel.textContent).toContain('PO-PAGE-1');
    expect(button(panel, 'Prev')!.disabled).toBe(true);
  });

  test('(c) a sku-inactive 409 re-reads the SKU options; the parser then names the line "no longer offered"', async () => {
    await mount('ops_manager');
    await openForm();
    fillGlowDraft();
    const skuReads = () => requests.filter((r) => r.url.pathname.endsWith('/catalog/skus') && r.url.searchParams.get('clientId') === 'c-glow').length;
    const before = skuReads();
    createAnswers = [{ kind: 'problem', status: 409, code: 'sku-inactive', detail: 'x', extensions: { skuCodes: ['GLOW-2'] } }];
    GLOW_SKUS = ALL_GLOW_SKUS.filter((entry) => entry.id !== 's-glow-2');
    await press(raise());
    expect(form()!.querySelector('[role="alert"]')!.textContent).toContain('SKU GLOW-2 is inactive');
    expect(skuReads()).toBeGreaterThan(before);
    await press(raise());
    expect(form()!.querySelector('[role="alert"]')!.textContent).toBe('Line 2: that SKU is no longer offered for this client — pick another.');
    expect(posts()).toHaveLength(1);
  });

  test('(d) client-departed resets the picked client, its vendor and lines, re-reads the clients and keeps the words', async () => {
    await mount('ops_manager');
    await openForm();
    fillGlowDraft();
    const clientReads = () => requests.filter((r) => r.url.pathname.endsWith('/clients')).length;
    const before = clientReads();
    createAnswers = [{ kind: 'problem', status: 409, code: 'client-departed', detail: 'GLOW has departed.' }];
    clients = [SELF, { ...GLOW, status: 'departed' }, BRANDX];
    await press(raise());
    expect(clientReads()).toBeGreaterThan(before);
    expect(select('Client')!.value).toBe('');
    expect(optionTexts('Client')).not.toContain('GLOW — GlowCo');
    expect(select('Vendor')).toBeNull();
    expect(select('Line 1 SKU')).toBeNull();
    expect(form()!.querySelector('[role="alert"]')!.textContent).toBe(
      'This client has departed and takes no new work — an owner can reactivate it in Settings → Clients.',
    );
  });

  test('(e) a failed SKU read shows Retry, which re-reads', async () => {
    skusMode = 'fail';
    await mount('ops_manager');
    await openForm();
    expect(form()!.textContent).toContain('SKUs unavailable');
    expect(select('Line 1 SKU')).toBeNull();
    skusMode = 'ok';
    await press(button(form()!, 'Retry'));
    expect(optionTexts('Line 1 SKU')).toEqual(['Pick a SKU…', 'GLOW-1 — GLOW-1 name', 'GLOW-2 — GLOW-2 name']);
  });

  test('(f) while the kits load no SKU row is offered; a failed kit read shows Retry', async () => {
    kitsMode = 'hang';
    await mount('ops_manager');
    await openForm();
    expect(form()!.textContent).toContain('Loading SKUs…');
    expect(select('Line 1 SKU')).toBeNull();
    view!.unmount();
    view = undefined;
    kitsMode = 'fail';
    view = render(<InboundCards initialTab="pos" />);
    await settle();
    await openForm();
    expect(form()!.textContent).toContain('Kit list unavailable');
    expect(select('Line 1 SKU')).toBeNull();
    kitsMode = 'ok';
    await press(button(form()!, 'Retry'));
    expect(optionTexts('Line 1 SKU')).toEqual(['Pick a SKU…', 'GLOW-1 — GLOW-1 name', 'GLOW-2 — GLOW-2 name']);
  });

  test('(g) the inputs are disabled while a create is in flight', async () => {
    await mount('ops_manager');
    await openForm();
    fillGlowDraft();
    createAnswers = [{ kind: 'hang' }];
    await press(raise());
    const fieldset = form()!.querySelector('fieldset')!;
    expect(fieldset.disabled).toBe(true);
    for (const field of [input('PO code'), input('Line 1 quantity'), select('Vendor')!, select('Line 1 SKU')!]) {
      expect(field.closest('fieldset')).toBe(fieldset);
    }
    expect(button(form()!, 'Add line')!.closest('fieldset')).toBe(fieldset);
    expect(raise().disabled).toBe(true);
  });

  test('(h) Add line is disabled at 200 lines', async () => {
    await mount('ops_manager');
    await openForm();
    for (let i = 1; i < 200; i++) act(() => button(form()!, 'Add line')!.click());
    expect(form()!.querySelectorAll('select[aria-label$=" SKU"]')).toHaveLength(200);
    expect(button(form()!, 'Add line')!.disabled).toBe(true);
    act(() => button(form()!, 'Remove')!.click());
    expect(button(form()!, 'Add line')!.disabled).toBe(false);
  });
});
