import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act } from 'react';
import type { ComponentType, ReactNode } from 'react';

import { clearSession, readSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';

/**
 * Story 21-7 — the claims a `src/lib` test cannot make about the portal:
 *   1. the operator shell issues NO request for a client session (it
 *      redirects before any operator hook mounts) — and does fetch `/me` for
 *      an operator, so the assertion bites;
 *   2. the portal shell sends a staff session back to /settings, renders the
 *      client's name and the four nav items for a portal session, and reads
 *      `portal/me` — never an operator route;
 *   3. a `client-suspended` refusal clears the session and lands on the
 *      login notice;
 *   4. every surface's ready, empty and failed states (with Retry);
 *   5. an order expands to its lines with kit components nested.
 *
 * Driven through a stubbed global `fetch` (the generated client is a fetch
 * wrapper), `next/navigation` mocked with a recording router.
 */

const replaces: string[] = [];
const pushes: string[] = [];
let AppShell: ComponentType<{ children: ReactNode }>;
let PortalShell: ComponentType<{ children: ReactNode }>;
let PortalStock: ComponentType;
let PortalOrders: ComponentType;
let PortalInbound: ComponentType;
let PortalInvoices: ComponentType;

beforeAll(async () => {
  const real = await import('next/navigation');
  mock.module('next/navigation', () => ({
    ...real,
    useRouter: () => ({
      push: (href: string) => void pushes.push(href),
      replace: (href: string) => void replaces.push(href),
      prefetch: () => undefined,
    }),
    usePathname: () => '/portal/stock',
  }));
  ({ AppShell } = await import('../shell/app-shell'));
  ({ PortalShell } = await import('./portal-shell'));
  ({ PortalStock } = await import('./portal-stock'));
  ({ PortalOrders } = await import('./portal-orders'));
  ({ PortalInbound } = await import('./portal-inbound'));
  ({ PortalInvoices } = await import('./portal-invoices'));
});

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const CLIENT_ID = '0198f7a2-1b3c-7d4e-8f90-cccccccccccc';
const ORDER_ID = '0198f7a2-1b3c-7d4e-8f90-000000000001';

const OPERATOR_SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Three PL Co', gstin: null },
  user: { id: 'u-1', email: 'ops@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

const PORTAL_SESSION: StoredSession = {
  ...OPERATOR_SESSION,
  user: { id: 'u-2', email: 'buyer@brand-a.example', role: 'client', status: 'active', clientId: CLIENT_ID },
  client: { id: CLIENT_ID, code: 'BRAND-A', name: 'Brand A Apparel' },
};

const PORTAL_ME = {
  user: { id: 'u-2', email: 'buyer@brand-a.example', role: 'client', status: 'active', clientId: CLIENT_ID },
  client: { id: CLIENT_ID, code: 'BRAND-A', name: 'Brand A Apparel' },
};

let requests: string[] = [];
/** Every request's pathname + query (the paging assertions). */
let urls: string[] = [];
/** pathname suffix (optionally `?cursor=<c>` for a later page) → [status, body] — GETs. */
let routes: Record<string, [number, unknown]> = {};
/** Story 21-7b — every POST as sent: its path, its Idempotency-Key header and its parsed body. */
let posts: { path: string; key: string | null; body: Record<string, unknown> }[] = [];
/** Story 21-7b — the POST replies, in order (one per POST); empty → 503. */
let postReplies: [number, unknown][] = [];
/** Story 21-7b — when set, every POST waits on it before replying (an in-flight submit). */
let postHold: Promise<void> | null = null;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname, search, searchParams } = new URL(request.url);
    requests.push(`${request.method.toUpperCase()} ${pathname}`);
    urls.push(`${pathname}${search}`);
    if (request.method.toUpperCase() === 'POST') {
      const text = await request.clone().text();
      posts.push({ path: pathname, key: request.headers.get('Idempotency-Key'), body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>) });
      if (postHold !== null) await postHold;
      const reply = postReplies.shift() ?? [503, { code: 'unavailable', status: 503, title: 'Down' }];
      return json(reply[0], reply[1]);
    }
    const cursor = searchParams.get('cursor');
    if (cursor !== null) {
      const paged = Object.keys(routes).find((key) => key.includes('?cursor=') && pathname.endsWith(key.split('?')[0]!) && key.endsWith(`?cursor=${cursor}`));
      if (paged !== undefined) return json(routes[paged]![0], routes[paged]![1]);
    }
    const match = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((suffix) => pathname.endsWith(suffix));
    if (match !== undefined) return json(routes[match]![0], routes[match]![1]);
    return json(200, { items: [], nextCursor: null });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  urls = [];
  routes = {};
  posts = [];
  postReplies = [];
  postHold = null;
  replaces.length = 0;
  pushes.length = 0;
  stubRouter();
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

function click(element: Element): void {
  act(() => void element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function buttonNamed(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent === label);
  expect(found).toBeDefined();
  return found!;
}

describe('AppShell — the operator fence on the web', () => {
  test('a client session issues NO request and is sent to the portal; the operator page never mounts', async () => {
    writeSession(PORTAL_SESSION);
    view = render(
      <AppShell>
        <div data-testid="operator-page">operator</div>
      </AppShell>,
    );
    await settle();
    expect(requests).toEqual([]);
    expect(replaces).toEqual(['/portal/stock']);
    expect(view.container.querySelector('[data-testid="operator-page"]')).toBeNull();
  });

  test('an operator session renders the shell and bootstraps /me (the assertion above bites)', async () => {
    writeSession(OPERATOR_SESSION);
    routes = { '/me': [200, { user: { ...OPERATOR_SESSION.user, clientId: null, createdAt: '2026-01-01T00:00:00.000Z' } }] };
    view = render(
      <AppShell>
        <div data-testid="operator-page">operator</div>
      </AppShell>,
    );
    await settle();
    expect(requests).toContain(`GET /api/v1/tenants/${TENANT_ID}/me`);
    expect(replaces).toEqual([]);
    expect(view.container.querySelector('[data-testid="operator-page"]')).not.toBeNull();
  });

  test('no session goes to /login', async () => {
    view = render(
      <AppShell>
        <div data-testid="operator-page">operator</div>
      </AppShell>,
    );
    await settle();
    expect(replaces).toEqual(['/login']);
    expect(requests).toEqual([]);
  });
});

describe('PortalShell', () => {
  test('a staff session is sent back to /settings and nothing renders', async () => {
    writeSession(OPERATOR_SESSION);
    view = render(
      <PortalShell>
        <div data-testid="portal-page">portal</div>
      </PortalShell>,
    );
    await settle();
    expect(replaces).toEqual(['/settings']);
    expect(view.container.querySelector('[data-testid="portal-page"]')).toBeNull();
    expect(requests).toEqual([]);
  });

  test("a portal session renders the client's name, the four portal surfaces and reads portal/me only", async () => {
    writeSession(PORTAL_SESSION);
    routes = { '/portal/me': [200, PORTAL_ME] };
    view = render(
      <PortalShell>
        <div data-testid="portal-page">portal</div>
      </PortalShell>,
    );
    await settle();
    expect(view.container.querySelector('[data-testid="portal-company"]')!.textContent).toBe('Brand A Apparel');
    const nav = [...view.container.querySelectorAll('nav[aria-label="Portal"] a')].map((a) => a.textContent);
    expect(nav).toEqual(['Stock', 'Orders', 'Inbound', 'Invoices']);
    expect(view.container.querySelector('[data-testid="portal-page"]')).not.toBeNull();
    expect(requests).toEqual([`GET /api/v1/tenants/${TENANT_ID}/portal/me`]);
    expect(replaces).toEqual([]);
  });

  test('a client-suspended refusal clears the session and lands on the login notice', async () => {
    writeSession(PORTAL_SESSION);
    routes = {
      '/portal/me': [403, { code: 'client-suspended', status: 403, title: 'Client portal access is suspended' }],
    };
    view = render(
      <PortalShell>
        <div>portal</div>
      </PortalShell>,
    );
    await settle();
    expect(readSession()).toBeNull();
    expect(replaces).toContain('/login?portal=suspended');
    // Clearing the session flips the shell's decision to /login — that
    // redirect must not overwrite the notice: the LAST navigation keeps it.
    expect(replaces.at(-1)).toBe('/login?portal=suspended');
    expect(replaces).not.toContain('/login');
  });
});

describe('the portal surfaces — ready, empty, failed', () => {
  const FAILED: [number, unknown] = [503, { code: 'unavailable', status: 503, title: 'Down', detail: 'The read failed.' }];

  beforeEach(() => {
    writeSession(PORTAL_SESSION);
  });

  test('Stock: rows with on hand and allocated in the base unit, and no bin anywhere', async () => {
    routes = {
      '/portal/stock': [
        200,
        {
          items: [
            { skuId: 's-1', skuCode: 'TEE-RED', skuName: 'Red tee', baseUom: 'each', warehouseId: 'w-1', warehouseName: 'Whitefield', onHand: 1500, allocated: 5 },
            { skuId: 's-2', skuCode: 'RICE', skuName: 'Rice', baseUom: 'kg', warehouseId: 'w-1', warehouseName: 'Whitefield', onHand: 2.5, allocated: 0 },
          ],
          nextCursor: null,
        },
      ],
    };
    view = render(<PortalStock />);
    await settle();
    const text = view.container.textContent ?? '';
    expect(text).toContain('TEE-RED');
    expect(text).toContain('1,500 each');
    expect(text).toContain('5 each');
    expect(text).toContain('2.5 kg');
    expect(text.toLowerCase()).not.toContain('bin');
  });

  test('Stock: empty and failed', async () => {
    view = render(<PortalStock />);
    await settle();
    expect(view.container.textContent).toContain('No stock in the warehouse for your company yet.');
    view.unmount();
    routes = { '/portal/stock': FAILED };
    view = render(<PortalStock />);
    await settle();
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain('The read failed.');
    buttonNamed(view.container, 'Retry');
  });

  test('Orders: ready, then a kit line expands with its components nested', async () => {
    routes = {
      '/portal/orders': [
        200,
        {
          items: [
            {
              id: ORDER_ID,
              status: 'accepted',
              source: 'ingested',
              externalRef: 'SHOP-1001',
              warehouseName: 'Whitefield',
              destinationName: 'Asha',
              destinationCity: 'Bengaluru',
              destinationPincode: '560001',
              lineCount: 1,
              createdAt: '2026-10-08T10:00:00.000Z',
            },
          ],
          nextCursor: null,
        },
      ],
      [`/portal/orders/${ORDER_ID}`]: [
        200,
        {
          lines: [
            {
              skuCode: 'KIT-1',
              skuName: 'Gift kit',
              qty: 1,
              components: [
                { skuCode: 'TEE-RED', skuName: 'Red tee', qty: 2 },
                { skuCode: 'MUG', skuName: 'Mug', qty: 1 },
              ],
            },
          ],
        },
      ],
    };
    view = render(<PortalOrders />);
    await settle();
    expect(view.container.textContent).toContain('SHOP-1001');
    expect(view.container.textContent).toContain('1 line');
    click(buttonNamed(view.container, 'Lines'));
    await settle();
    const components = view.container.querySelector('[data-testid="kit-components"]')!;
    expect(components.textContent).toContain('TEE-RED — Red tee');
    expect(components.textContent).toContain('MUG — Mug');
  });

  test('Orders: empty and failed', async () => {
    view = render(<PortalOrders />);
    await settle();
    expect(view.container.textContent).toContain('No orders for your company yet.');
    view.unmount();
    routes = { '/portal/orders': FAILED };
    view = render(<PortalOrders />);
    await settle();
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain('The read failed.');
  });

  test('Inbound: ASNs and POs ready; both empty; failed', async () => {
    routes = {
      '/portal/inbound/asns': [
        200,
        {
          items: [
            { id: 'a-1', code: 'ASN-001', status: 'partially_received', expectedAt: null, warehouseName: 'Whitefield', lineCount: 2, announcedTotal: 20, receivedTotal: 12, createdAt: '2026-10-08T10:00:00.000Z' },
          ],
          nextCursor: null,
        },
      ],
      '/portal/inbound/purchase-orders': [
        200,
        {
          items: [
            { id: 'p-1', code: 'PO-7', status: 'open', warehouseName: 'Whitefield', lineCount: 1, orderedTotal: 10, receivedTotal: 0, createdAt: '2026-10-08T10:00:00.000Z' },
          ],
          nextCursor: null,
        },
      ],
    };
    view = render(<PortalInbound />);
    await settle();
    expect(view.container.textContent).toContain('ASN-001');
    expect(view.container.textContent).toContain('12 of 20 received');
    expect(view.container.textContent).toContain('PO-7');
    view.unmount();
    routes = {};
    view = render(<PortalInbound />);
    await settle();
    expect(view.container.textContent).toContain('No shipment notices for your company yet.');
    expect(view.container.textContent).toContain('No purchase orders for your company yet.');
    view.unmount();
    routes = { '/portal/inbound/asns': FAILED, '/portal/inbound/purchase-orders': FAILED };
    view = render(<PortalInbound />);
    await settle();
    expect(view.container.querySelectorAll('[role="alert"]')).toHaveLength(2);
  });

  test('Invoices: ready and opened to the frozen party and lines; empty; failed', async () => {
    const row = {
      id: 'i-1',
      invoiceNo: '29/S2627/000001',
      fyLabel: '2026-27',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      status: 'issued',
      issuedAt: '2026-10-02T06:00:00.000Z',
      replacesInvoiceId: null,
      placeOfSupply: '29',
      supplyType: 'intra',
      totals: { subtotal: 100000, cgst: 9000, sgst: 9000, igst: 0, tax: 18000, roundOff: 0, payable: 118000 },
    };
    routes = {
      '/portal/invoices': [200, { items: [row], nextCursor: null }],
      '/portal/invoices/i-1': [
        200,
        {
          ...row,
          party: {
            supplier: { name: 'Three PL Co', gstin: '29AAACT1234A1Z5', stateCode: '29', stateName: 'Karnataka', address: null },
            recipient: { name: 'Brand A', legalName: 'Brand A Pvt Ltd', gstin: null, stateCode: '29', stateName: 'Karnataka', address: { line1: null, line2: null, city: null, stateCode: null, pincode: null } },
          },
          lines: [
            { segmentFrom: '2026-09-01', segmentTo: '2026-09-30', chargeCode: 'pick', basis: 'per_pick', uom: null, quantity: '40', unitAmountPaise: 2500, amountPaise: 100000, sac: '996719', gstBps: 1800, cgstPaise: 9000, sgstPaise: 9000, igstPaise: 0 },
          ],
        },
      ],
    };
    view = render(<PortalInvoices />);
    await settle();
    expect(view.container.textContent).toContain('29/S2627/000001');
    expect(view.container.textContent).toContain('₹1,180.00');
    click(buttonNamed(view.container, 'Open'));
    await settle();
    const doc = view.container.querySelector('[data-testid="portal-invoice"]')!;
    expect(doc.textContent).toContain('Brand A Pvt Ltd');
    expect(doc.textContent).toContain('996719');
    expect(doc.textContent).toContain('40 picks');
    view.unmount();
    routes = {};
    view = render(<PortalInvoices />);
    await settle();
    expect(view.container.textContent).toContain('No invoices issued to your company yet.');
    view.unmount();
    routes = { '/portal/invoices': FAILED };
    view = render(<PortalInvoices />);
    await settle();
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain('The read failed.');
  });

  test('paging: page 1 carries a nextCursor; Next sends cursor= and renders page 2', async () => {
    const stockRow = (code: string) => ({ skuId: code, skuCode: code, skuName: `${code} name`, baseUom: 'each', warehouseId: 'w-1', warehouseName: 'Whitefield', onHand: 1, allocated: 0 });
    routes = {
      '/portal/stock': [200, { items: [stockRow('PAGE1-SKU')], nextCursor: 'CURSOR-2' }],
      '/portal/stock?cursor=CURSOR-2': [200, { items: [stockRow('PAGE2-SKU')], nextCursor: null }],
    };
    view = render(<PortalStock />);
    await settle();
    expect(view.container.textContent).toContain('PAGE1-SKU');
    click(buttonNamed(view.container, 'Next'));
    await settle();
    expect(urls.some((url) => url.endsWith('/portal/stock') || url.includes('/portal/stock?limit'))).toBe(true);
    expect(urls.filter((url) => url.includes('/portal/stock') && url.includes('cursor=CURSOR-2'))).toHaveLength(1);
    expect(view.container.textContent).toContain('PAGE2-SKU');
    expect(view.container.textContent).not.toContain('PAGE1-SKU');
  });

  test('Inbound: an ASN and a PO expand to their lines through their detail reads', async () => {
    routes = {
      '/portal/inbound/asns': [
        200,
        { items: [{ id: 'a-1', code: 'ASN-001', status: 'announced', expectedAt: null, warehouseName: 'Whitefield', lineCount: 1, announcedTotal: 20, receivedTotal: 0, createdAt: '2026-10-08T10:00:00.000Z' }], nextCursor: null },
      ],
      '/portal/inbound/asns/a-1': [200, { lines: [{ skuCode: 'TEE-RED', skuName: 'Red tee', announcedQty: 20, receivedQty: 5 }] }],
      '/portal/inbound/purchase-orders': [
        200,
        { items: [{ id: 'p-1', code: 'PO-7', status: 'open', warehouseName: 'Whitefield', lineCount: 1, orderedTotal: 10, receivedTotal: 0, createdAt: '2026-10-08T10:00:00.000Z' }], nextCursor: null },
      ],
      '/portal/inbound/purchase-orders/p-1': [200, { lines: [{ skuCode: 'MUG', skuName: 'Mug', orderedQty: 10, receivedQty: 3, expectedDate: null }] }],
    };
    view = render(<PortalInbound />);
    await settle();
    const toggles = [...view.container.querySelectorAll('button')].filter((b) => b.textContent === 'Lines');
    expect(toggles).toHaveLength(2);
    click(toggles[0]!);
    await settle();
    click(toggles[1]!);
    await settle();
    expect(requests).toContain(`GET /api/v1/tenants/${TENANT_ID}/portal/inbound/asns/a-1`);
    expect(requests).toContain(`GET /api/v1/tenants/${TENANT_ID}/portal/inbound/purchase-orders/p-1`);
    const asnLines = view.container.querySelector('[data-testid="asn-lines"]')!;
    expect(asnLines.textContent).toContain('TEE-RED');
    expect(asnLines.textContent).toContain('5 of 20 received');
    const poLines = view.container.querySelector('[data-testid="po-lines"]')!;
    expect(poLines.textContent).toContain('MUG');
    expect(poLines.textContent).toContain('3 of 10 received');
  });

  test('a surface read refused client-suspended shows the suspension copy (and announces it)', async () => {
    routes = { '/portal/stock': [403, { code: 'client-suspended', status: 403, title: 'Suspended' }] };
    let announced = 0;
    const onSuspended = () => void (announced += 1);
    window.addEventListener('wms-portal-suspended', onSuspended);
    view = render(<PortalStock />);
    await settle();
    window.removeEventListener('wms-portal-suspended', onSuspended);
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain("Your company's portal access is suspended.");
    expect(announced).toBe(1);
  });
});

// ── Story 21-7b — announcing a shipment from the portal ─────────────────────

describe('Announce a shipment (story 21-7b)', () => {
  const W1 = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
  const W2 = '0198f7a2-1b3c-7d4e-8f90-0000000000a2';
  const W3 = '0198f7a2-1b3c-7d4e-8f90-0000000000a3';
  const SKU1 = '0198f7a2-1b3c-7d4e-8f90-0000000000b1';
  const SKU2 = '0198f7a2-1b3c-7d4e-8f90-0000000000b2';
  const sku = (skuId: string, skuCode: string, skuName: string, baseUom = 'each', uomPrecision = 0) => ({ skuId, skuCode, skuName, baseUom, uomPrecision });
  const asnRow = (id: string, code: string) => ({ id, code, status: 'announced', expectedAt: null, warehouseName: 'Main', lineCount: 1, announcedTotal: 1, receivedTotal: 0, createdAt: '2026-10-08T10:00:00.000Z' });
  const DETAIL = { ...asnRow('a-new', 'ASN-NEW'), lines: [{ skuCode: 'TEE-RED', skuName: 'Red tee', announcedQty: 12, receivedQty: 0 }] };

  /** The form's reads: two Mains told apart by city, an Annex; SKU page 1 → page 2 (the drain). */
  function formRoutes(): void {
    routes = {
      ...routes,
      '/portal/warehouses': [
        200,
        {
          items: [
            { warehouseId: W3, warehouseName: 'Annex', city: 'Chennai' },
            { warehouseId: W1, warehouseName: 'Main', city: 'Bengaluru' },
            { warehouseId: W2, warehouseName: 'Main', city: 'Mysuru' },
          ],
        },
      ],
      '/portal/skus': [200, { items: [sku(SKU1, 'TEE-RED', 'Red tee')], nextCursor: 'SKU-PAGE-2' }],
      '/portal/skus?cursor=SKU-PAGE-2': [200, { items: [sku(SKU2, 'RICE', 'Basmati rice', 'kg', 3)], nextCursor: null }],
    };
  }

  function setValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
    const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
    act(() => {
      setter.call(element, value);
      element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    });
  }

  function field<T extends Element>(container: HTMLElement, label: string): T {
    const found = container.querySelector(`[aria-label="${label}"]`);
    expect(found).not.toBeNull();
    return found as T;
  }

  async function openForm(): Promise<HTMLElement> {
    view = render(<PortalInbound />);
    await settle();
    click(buttonNamed(view.container, 'Announce a shipment'));
    await settle();
    return view.container;
  }

  async function fillAndSubmit(container: HTMLElement, opts: { expectedAt?: string; skuId?: string; qty?: string } = {}): Promise<void> {
    setValue(field<HTMLSelectElement>(container, 'Warehouse'), W2);
    setValue(field<HTMLInputElement>(container, 'Shipment reference'), '  ASN-NEW ');
    if (opts.expectedAt !== undefined) setValue(field<HTMLInputElement>(container, 'Expected arrival'), opts.expectedAt);
    setValue(field<HTMLSelectElement>(container, 'Line 1 SKU'), opts.skuId ?? SKU1);
    setValue(field<HTMLInputElement>(container, 'Line 1 quantity'), opts.qty ?? '12');
    await submit(container);
  }

  async function submit(container: HTMLElement): Promise<void> {
    const form = container.querySelector('form[aria-label="Announce a shipment"]') as HTMLFormElement;
    act(() => void form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
  }

  beforeEach(() => {
    writeSession(PORTAL_SESSION);
    formRoutes();
  });

  test('the POST carries exactly {asnCode, expectedAt, lines, warehouseId} — never a clientId or a line id — with an Idempotency-Key; every request is a portal route', async () => {
    postReplies = [[201, DETAIL]];
    const container = await openForm();
    await fillAndSubmit(container, { expectedAt: '2026-10-20T10:00' });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe(`/api/v1/tenants/${TENANT_ID}/portal/inbound/asns`);
    expect(Object.keys(posts[0]!.body).sort()).toEqual(['asnCode', 'expectedAt', 'lines', 'warehouseId']);
    expect(posts[0]!.body).toMatchObject({ warehouseId: W2, asnCode: 'ASN-NEW', lines: [{ skuId: SKU1, announcedQty: 12 }] });
    expect(Object.keys((posts[0]!.body.lines as Record<string, unknown>[])[0]!).sort()).toEqual(['announcedQty', 'skuId']);
    expect(posts[0]!.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    // Only portal routes, ever.
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.filter((r) => !r.includes(`/api/v1/tenants/${TENANT_ID}/portal/`))).toEqual([]);
  });

  test('a blank expected arrival is ABSENT from the body', async () => {
    postReplies = [[201, DETAIL]];
    const container = await openForm();
    await fillAndSubmit(container);
    expect(Object.keys(posts[0]!.body).sort()).toEqual(['asnCode', 'lines', 'warehouseId']);
  });

  test('the key is reused on a retry of the unchanged draft, and fresh after an edit', async () => {
    postReplies = [
      [503, { code: 'unavailable', status: 503, title: 'Down', detail: 'Try again.' }],
      [503, { code: 'unavailable', status: 503, title: 'Down', detail: 'Try again.' }],
      [503, { code: 'unavailable', status: 503, title: 'Down', detail: 'Try again.' }],
    ];
    const container = await openForm();
    await fillAndSubmit(container);
    await submit(container);
    expect(posts).toHaveLength(2);
    expect(posts[1]!.key).toBe(posts[0]!.key);
    setValue(field<HTMLInputElement>(container, 'Line 1 quantity'), '13');
    await submit(container);
    expect(posts).toHaveLength(3);
    expect(posts[2]!.key).not.toBe(posts[0]!.key);
    expect(posts[2]!.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('a SKU on page 2 of portal/skus is an option (the drain), with its unit and step; equal warehouse names carry their city', async () => {
    const container = await openForm();
    expect(urls.filter((url) => url.includes('/portal/skus') && url.includes('cursor=SKU-PAGE-2'))).toHaveLength(1);
    expect(urls.some((url) => url.includes('/portal/skus') && url.includes('limit=100'))).toBe(true);
    const skuOptions = [...field<HTMLSelectElement>(container, 'Line 1 SKU').options].map((o) => o.textContent);
    expect(skuOptions).toEqual(['Pick a SKU…', 'TEE-RED — Red tee', 'RICE — Basmati rice']);
    const warehouseOptions = [...field<HTMLSelectElement>(container, 'Warehouse').options].map((o) => o.textContent);
    expect(warehouseOptions).toEqual(['Pick the warehouse…', 'Annex', 'Main (Bengaluru)', 'Main (Mysuru)']);
    setValue(field<HTMLSelectElement>(container, 'Line 1 SKU'), SKU2);
    expect(field<HTMLInputElement>(container, 'Line 1 quantity').step).toBe('0.001');
    expect(container.textContent).toContain('kg');
    // And it submits: a page-2 SKU in a decimal quantity.
    postReplies = [[201, DETAIL]];
    await fillAndSubmit(container, { skuId: SKU2, qty: '2.5' });
    expect(posts[0]!.body.lines).toEqual([{ skuId: SKU2, announcedQty: 2.5 }]);
  });

  test('no SKUs: the form is disabled with the ask-the-warehouse sentence', async () => {
    routes = { ...routes, '/portal/skus': [200, { items: [], nextCursor: null }] };
    const container = await openForm();
    expect(container.textContent).toContain('No SKUs are set up for your company yet — ask the warehouse');
    expect(container.querySelector('form[aria-label="Announce a shipment"]')).toBeNull();
  });

  test('a failed read shows ReadFailure with Retry, and no form', async () => {
    routes = { ...routes, '/portal/skus': [503, { code: 'unavailable', status: 503, title: 'Down', detail: 'The SKU read failed.' }] };
    const container = await openForm();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('The SKU read failed.');
    buttonNamed(container, 'Retry');
    expect(container.querySelector('form[aria-label="Announce a shipment"]')).toBeNull();
    view!.unmount();
    formRoutes();
    routes = { ...routes, '/portal/warehouses': [503, { code: 'unavailable', status: 503, title: 'Down', detail: 'The warehouse read failed.' }] };
    const again = await openForm();
    expect(again.querySelector('[role="alert"]')!.textContent).toContain('The warehouse read failed.');
  });

  test('success shows the banner and returns the notices to page ONE, refetched', async () => {
    routes = {
      ...routes,
      '/portal/inbound/asns': [200, { items: [asnRow('a-1', 'ASN-PAGE-1')], nextCursor: 'ASN-PAGE-2' }],
      '/portal/inbound/asns?cursor=ASN-PAGE-2': [200, { items: [asnRow('a-2', 'ASN-PAGE-2')], nextCursor: null }],
    };
    view = render(<PortalInbound />);
    await settle();
    click(buttonNamed(view.container, 'Next'));
    await settle();
    expect(view.container.textContent).toContain('ASN-PAGE-2');
    click(buttonNamed(view.container, 'Announce a shipment'));
    await settle();
    postReplies = [[201, DETAIL]];
    // The notice-list GETs (requests and urls are recorded in step).
    const listReads = () => urls.filter((url, i) => requests[i]!.startsWith('GET ') && /\/portal\/inbound\/asns(\?|$)/.test(url));
    const before = listReads().length;
    await fillAndSubmit(view.container);
    expect(view.container.textContent).toContain('Shipment ASN-NEW announced');
    expect(listReads()).toHaveLength(before + 1);
    expect(listReads().at(-1)).not.toContain('cursor=');
    expect(view.container.textContent).toContain('ASN-PAGE-1');
    expect(view.container.textContent).not.toContain('ASN-PAGE-2');
    expect(view.container.querySelector('form[aria-label="Announce a shipment"]')).toBeNull();
  });

  test('while the POST is in flight the whole form is disabled — a field, the line rows and Discard', async () => {
    let release!: () => void;
    postHold = new Promise<void>((resolve) => {
      release = resolve;
    });
    postReplies = [[201, DETAIL]];
    const container = await openForm();
    await fillAndSubmit(container);
    expect(posts).toHaveLength(1);
    const fieldset = container.querySelector('form[aria-label="Announce a shipment"] fieldset') as HTMLFieldSetElement;
    expect(fieldset.disabled).toBe(true);
    expect(fieldset.contains(field<HTMLInputElement>(container, 'Shipment reference'))).toBe(true);
    expect(fieldset.contains(field<HTMLSelectElement>(container, 'Line 1 SKU'))).toBe(true);
    expect(fieldset.contains(buttonNamed(container, 'Discard'))).toBe(true);
    // (happy-dom does not propagate a disabled fieldset to `:disabled`; a
    // browser disables every control inside it — the containment above is
    // the claim.)
    release();
    await settle();
    expect(container.textContent).toContain('Shipment ASN-NEW announced');
  });

  test('a catalogue past the 20-page drain disables the form with the too-large sentence', async () => {
    let page = 0;
    routes = { ...routes };
    // Every page carries a nextCursor: the stub answers each cursor with another.
    const real = globalThis.fetch;
    stubGlobal('fetch', (async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input.toString());
      const { pathname } = new URL(request.url);
      if (pathname.endsWith('/portal/skus')) {
        page += 1;
        requests.push(`GET ${pathname}`);
        return json(200, { items: [sku(`0198f7a2-1b3c-7d4e-8f90-${String(page).padStart(12, '0')}`, `SKU-${page}`, `Sku ${page}`)], nextCursor: `C-${page}` });
      }
      return real(input);
    }) as unknown as typeof fetch);
    const container = await openForm();
    expect(page).toBe(20);
    expect(container.textContent).toContain('Your catalogue is too large for this form');
    expect(container.querySelector('form[aria-label="Announce a shipment"]')).toBeNull();
  });

  test('a single warehouse is chosen without touching the picker', async () => {
    routes = { ...routes, '/portal/warehouses': [200, { items: [{ warehouseId: W1, warehouseName: 'Main', city: 'Bengaluru' }] }] };
    postReplies = [[201, DETAIL]];
    const container = await openForm();
    setValue(field<HTMLInputElement>(container, 'Shipment reference'), 'ASN-ONE');
    setValue(field<HTMLSelectElement>(container, 'Line 1 SKU'), SKU1);
    setValue(field<HTMLInputElement>(container, 'Line 1 quantity'), '3');
    await submit(container);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body.warehouseId).toBe(W1);
  });

  test('a refusal shows the portal reason in the form (a duplicate code)', async () => {
    postReplies = [[409, { code: 'duplicate-asn-code', status: 409, title: 'ASN code already in use', detail: 'Client BRAND-A already has an advance shipment notice "ASN-NEW".' }]];
    const container = await openForm();
    await fillAndSubmit(container);
    expect(container.querySelector('form [role="alert"]')!.textContent).toBe('You already have a shipment notice with this reference — use another one.');
  });

  test('a client-suspended refusal of the POST fires the portal event', async () => {
    postReplies = [[403, { code: 'client-suspended', status: 403, title: 'Suspended' }]];
    let announced = 0;
    const onSuspended = () => void (announced += 1);
    window.addEventListener('wms-portal-suspended', onSuspended);
    const container = await openForm();
    await fillAndSubmit(container);
    window.removeEventListener('wms-portal-suspended', onSuspended);
    expect(announced).toBe(1);
    expect(container.querySelector('form [role="alert"]')!.textContent).toBe("Your company's portal access is suspended.");
  });
});
