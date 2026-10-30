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
 *      client's name and the five nav items for a portal session, and reads
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
let PortalService: ComponentType;
let PortalHome: ComponentType;
let PortalReturns: ComponentType;
let PortalRecalls: ComponentType;

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
  ({ PortalService } = await import('./portal-service'));
  ({ PortalHome } = await import('./portal-home'));
  ({ PortalReturns } = await import('./portal-returns'));
  ({ PortalRecalls } = await import('./portal-recalls'));
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
      // Story 4-1c — a multipart upload (the order import) is read as its form fields.
      const multipart = (request.headers.get('content-type') ?? '').includes('multipart/form-data');
      const text = multipart ? '' : await request.clone().text();
      const body: Record<string, unknown> = multipart
        ? Object.fromEntries([...(await request.clone().formData()).entries()].map(([name, value]) => [name, typeof value === "string" ? value : (value as File).name]))
        : text === ''
          ? {}
          : (JSON.parse(text) as Record<string, unknown>);
      posts.push({ path: pathname, key: request.headers.get('Idempotency-Key'), body });
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
    // Story 4-4a — an order's Shipping read a test did not route: an API without the route.
    if (pathname.endsWith('/shipping')) return json(404, { code: 'not-found', status: 404, title: 'Not found' });
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
    expect(replaces).toEqual(['/portal']); // UI-1: the portal's Home
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

  test("a portal session renders the client's name, the portal surfaces and reads portal/me only", async () => {
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
    expect(nav).toEqual(['Home', 'Stock', 'Orders', 'Inbound', 'Returns', 'Recalls', 'Invoices', 'Service']); // UI-1 adds Home, 4-7a Returns, 3-7a Recalls
    // On /portal/stock, Stock is current and Home is not (Home matches exact /portal only).
    const current = [...view.container.querySelectorAll('nav[aria-label="Portal"] a[aria-current="page"]')].map((a) => a.textContent);
    expect(current).toEqual(['Stock']);
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

  test('story 4-2a: an Orders row shows its type, priority, ship-by and payment line; a dispatched order is never Overdue', async () => {
    const row = { status: 'accepted', source: 'manual', externalRef: null, warehouseName: 'Whitefield', destinationName: 'Asha', destinationCity: 'Bengaluru', destinationPincode: '560001', lineCount: 1, createdAt: '2026-10-08T10:00:00.000Z' };
    routes = {
      '/portal/orders': [
        200,
        {
          items: [
            { ...row, id: 'o-open', clientOrderRef: 'SO-1', orderType: 'b2c', priority: 'high', shipByDate: '2020-01-01', codAmountPaise: 149900 },
            { ...row, id: 'o-done', clientOrderRef: 'SO-2', status: 'dispatched', orderType: 'b2b', priority: 'normal', shipByDate: '2020-01-01', codAmountPaise: null },
          ],
          nextCursor: null,
        },
      ],
    };
    view = render(<PortalOrders />);
    await settle();
    const chips = [...view.container.querySelectorAll('[data-testid="order-field-chips"]')].map((node) => node.textContent ?? '');
    expect(chips[0]).toContain('High');
    expect(chips[0]).toContain('01 Jan · Overdue');
    expect(chips[0]).toContain('COD ₹1,499.00');
    expect(chips[1]).toContain('Prepaid');
    expect(chips[1]).not.toContain('Overdue');
    expect(view.container.textContent).toContain('B2C');
    expect(view.container.textContent).toContain('B2B');
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

  test('story 4-2c: a follow-on row is chipped "Backorder"; a dispatched parent says what shipped and what follows', async () => {
    const row = (id: string, over: Record<string, unknown>) => ({
      id,
      status: 'dispatched',
      source: 'manual',
      externalRef: null,
      clientOrderRef: '1042',
      warehouseName: 'Whitefield',
      destinationName: null,
      destinationCity: null,
      destinationPincode: null,
      lineCount: 1,
      createdAt: '2026-10-08T10:00:00.000Z',
      ...over,
    });
    routes = {
      '/portal/orders': [
        200,
        {
          items: [
            row('fo-1', { status: 'accepted', followOnOfOrderId: ORDER_ID, followOnRootOrderId: ORDER_ID, followOnSeq: 1 }),
            row(ORDER_ID, { followOnOrderId: 'fo-1' }),
          ],
          nextCursor: null,
        },
      ],
      [`/portal/orders/${ORDER_ID}`]: [
        200,
        {
          ...row(ORDER_ID, { followOnOrderId: 'fo-1' }),
          lines: [
            { skuCode: 'TEA', skuName: 'Tea', qty: 6, shippedQty: 6, components: [] },
            { skuCode: 'MUG', skuName: 'Mug', qty: 4, shippedQty: 1, components: [] },
          ],
        },
      ],
    };
    view = render(<PortalOrders />);
    await settle();
    const refs = [...view.container.querySelectorAll('[data-testid="portal-order-ref"]')].map((node) => node.textContent);
    expect(refs).toEqual(['1042-BO1', '1042']);
    expect(view.container.querySelectorAll('[data-testid="backorder-chip"]')).toHaveLength(1);
    const lines = [...view.container.querySelectorAll('button')].filter((b) => b.textContent === 'Lines');
    click(lines[1]!);
    await settle();
    expect(view.container.querySelector('[data-testid="portal-shipped-short"]')!.textContent).toBe(
      'Shipped 7 of 10 — 3 follow in 1042-BO1; ask the warehouse to cancel the remainder',
    );
    expect(view.container.querySelector('[data-testid="portal-line-shipped"]')!.textContent).toContain('1 of 4 shipped');
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
      // Story 5-6a — the invoice's notes (none here; the notes have their own test).
      '/portal/invoices/i-1/notes': [200, { notes: [], netDocument: row.totals, netDocumentPayable: row.totals.payable }],
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

  test('UI-2 (A1): after Next, Prev is enabled and returns to page 1 — the table stays mounted through the page load', async () => {
    const stockRow = (code: string) => ({ skuId: code, skuCode: code, skuName: `${code} name`, baseUom: 'each', warehouseId: 'w-1', warehouseName: 'Whitefield', onHand: 1, allocated: 0 });
    routes = {
      '/portal/stock': [200, { items: [stockRow('PAGE1-SKU')], nextCursor: 'CURSOR-2' }],
      '/portal/stock?cursor=CURSOR-2': [200, { items: [stockRow('PAGE2-SKU')], nextCursor: null }],
    };
    view = render(<PortalStock />);
    await settle();
    expect(buttonNamed(view.container, 'Prev').disabled).toBe(true);
    click(buttonNamed(view.container, 'Next'));
    await settle();
    expect(view.container.textContent).toContain('PAGE2-SKU');
    const prev = buttonNamed(view.container, 'Prev');
    expect(prev.disabled).toBe(false);
    click(prev);
    await settle();
    expect(view.container.textContent).toContain('PAGE1-SKU');
    expect(buttonNamed(view.container, 'Prev').disabled).toBe(true);
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

// ── Story 4-1a — placing an order from the portal ───────────────────────────

describe('Place an order (4-1a)', () => {
  const W1 = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
  const W2 = '0198f7a2-1b3c-7d4e-8f90-0000000000a2';
  const SKU1 = '0198f7a2-1b3c-7d4e-8f90-0000000000b1';
  const SKU2 = '0198f7a2-1b3c-7d4e-8f90-0000000000b2';
  const sku = (skuId: string, skuCode: string, skuName: string, baseUom = 'each', uomPrecision = 0) => ({ skuId, skuCode, skuName, baseUom, uomPrecision });
  const stockRow = (skuId: string, warehouseId: string, onHand: number, allocated: number) => ({
    skuId,
    skuCode: 'X',
    skuName: 'X',
    baseUom: 'each',
    warehouseId,
    warehouseName: warehouseId === W1 ? 'Main' : 'Annex',
    onHand,
    allocated,
  });
  const PLACED = { orderId: ORDER_ID, warehouseName: 'Main', lineCount: 1, placedAt: '2026-10-22T05:00:00.000Z' };

  function formRoutes(): void {
    routes = {
      ...routes,
      '/portal/warehouses': [
        200,
        {
          items: [
            { warehouseId: W2, warehouseName: 'Annex', city: 'Chennai' },
            { warehouseId: W1, warehouseName: 'Main', city: 'Bengaluru' },
          ],
        },
      ],
      '/portal/skus': [200, { items: [sku(SKU1, 'TEE-RED', 'Red tee'), sku(SKU2, 'RICE', 'Basmati rice', 'kg', 3)], nextCursor: null }],
      '/portal/stock': [200, { items: [stockRow(SKU1, W1, 10, 3), stockRow(SKU1, W2, 4, 0)], nextCursor: null }],
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

  function find<T extends Element>(container: HTMLElement, selector: string): T {
    const found = container.querySelector(selector);
    expect(found).not.toBeNull();
    return found as T;
  }

  function stateSelect(container: HTMLElement): HTMLSelectElement {
    const found = [...container.querySelectorAll('select')].find((select) => select.options[0]?.textContent === 'Pick a state…');
    expect(found).toBeDefined();
    return found!;
  }

  async function openForm(): Promise<HTMLElement> {
    view = render(<PortalOrders />);
    await settle();
    click(buttonNamed(view.container, 'Place an order'));
    await settle();
    return view.container;
  }

  function fillAddress(container: HTMLElement): void {
    setValue(find<HTMLInputElement>(container, 'input[placeholder="Priya Sharma"]'), 'Asha Rao');
    setValue(find<HTMLInputElement>(container, 'input[placeholder="+91 98450 12345"]'), '+91 90000 00000');
    setValue(find<HTMLInputElement>(container, 'input[placeholder="12, Peenya Industrial Area"]'), '1 MG Road');
    setValue(find<HTMLInputElement>(container, 'input[placeholder="Bengaluru"]'), 'Bengaluru');
    setValue(stateSelect(container), 'Karnataka');
    setValue(find<HTMLInputElement>(container, 'input[placeholder="560066"]'), '560001');
  }

  async function submit(container: HTMLElement): Promise<void> {
    const form = container.querySelector('form[aria-label="Place an order"]') as HTMLFormElement;
    act(() => void form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
  }

  async function fillAndSubmit(container: HTMLElement, opts: { skuId?: string; qty?: string; gstin?: string } = {}): Promise<void> {
    setValue(find<HTMLSelectElement>(container, '[aria-label="Warehouse"]'), W1);
    setValue(find<HTMLSelectElement>(container, '[aria-label="Line 1 SKU"]'), opts.skuId ?? SKU1);
    setValue(find<HTMLInputElement>(container, '[aria-label="Line 1 quantity"]'), opts.qty ?? '2');
    fillAddress(container);
    if (opts.gstin !== undefined) setValue(find<HTMLInputElement>(container, 'input[placeholder="27AAPCD1234K1Z5"]'), opts.gstin);
    await submit(container);
  }

  beforeEach(() => {
    writeSession(PORTAL_SESSION);
    formRoutes();
  });

  test('without orders.place the button and the form are absent (a client session that lost it reads its orders only)', async () => {
    writeSession({ ...PORTAL_SESSION, user: { ...PORTAL_SESSION.user, role: 'accountant' } });
    view = render(<PortalOrders />);
    await settle();
    expect([...view.container.querySelectorAll('button')].some((b) => b.textContent === 'Place an order')).toBe(false);
    expect(view.container.querySelector('form[aria-label="Place an order"]')).toBeNull();
    view.unmount();
    // Meaningful: the client role is offered it, closed by default.
    writeSession(PORTAL_SESSION);
    view = render(<PortalOrders />);
    await settle();
    buttonNamed(view.container, 'Place an order');
    expect(view.container.querySelector('form[aria-label="Place an order"]')).toBeNull();
  });

  test('story 4-2a: the priority offers Normal and High only (Urgent is the warehouse’s); chosen fields ride, an untouched form sends none', async () => {
    postReplies = [[201, PLACED]];
    const container = await openForm();
    const priority = [...container.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent === 'Priority')!.querySelector('select')!;
    expect([...priority.options].map((o) => o.textContent)).toEqual(['Normal', 'High']);
    setValue(priority, 'high');
    const cod = [...container.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent === 'Cash on delivery')!.querySelector('input')!;
    act(() => void cod.click());
    setValue(
      [...container.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent === 'Amount to collect ₹')!.querySelector('input')!,
      '1,499',
    );
    await fillAndSubmit(container);
    // A rupee amount the server would refuse sends nothing.
    expect(posts).toHaveLength(0);
    setValue(
      [...container.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent === 'Amount to collect ₹')!.querySelector('input')!,
      '1499.00',
    );
    await submit(container);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toMatchObject({ priority: 'high', codAmountPaise: 149900 });
    expect('orderType' in posts[0]!.body).toBe(false);
  });

  test('the POST carries {warehouseId, lines[{skuId, quantity}], destination} — never a clientId or a ratePaise — with an Idempotency-Key; only portal routes', async () => {
    postReplies = [[201, PLACED]];
    const container = await openForm();
    await fillAndSubmit(container);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe(`/api/v1/tenants/${TENANT_ID}/portal/orders`);
    expect(Object.keys(posts[0]!.body).sort()).toEqual(['destination', 'lines', 'warehouseId']);
    expect(posts[0]!.body).toEqual({
      warehouseId: W1,
      lines: [{ skuId: SKU1, quantity: 2 }],
      destination: { contactName: 'Asha Rao', phone: '+91 90000 00000', line1: '1 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
    });
    expect(JSON.stringify(posts[0]!.body)).not.toMatch(/clientId|ratePaise/);
    expect(posts[0]!.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(requests.filter((r) => !r.includes(`/api/v1/tenants/${TENANT_ID}/portal/`))).toEqual([]);
  });

  test('a buyer GSTIN rides the body (upper-cased); a decimal quantity is sent as typed', async () => {
    postReplies = [[201, PLACED]];
    const container = await openForm();
    await fillAndSubmit(container, { skuId: SKU2, qty: '2.5', gstin: '29aaacm4321k1z8' });
    expect(posts[0]!.body.consigneeGstin).toBe('29AAACM4321K1Z8');
    expect(posts[0]!.body.lines).toEqual([{ skuId: SKU2, quantity: 2.5 }]);
  });

  test('the key is reused on a retry of the unchanged draft, and cleared by an edit (a line or the address)', async () => {
    postReplies = [
      [503, { code: 'unavailable', status: 503, title: 'Down' }],
      [503, { code: 'unavailable', status: 503, title: 'Down' }],
      [503, { code: 'unavailable', status: 503, title: 'Down' }],
      [503, { code: 'unavailable', status: 503, title: 'Down' }],
    ];
    const container = await openForm();
    await fillAndSubmit(container);
    await submit(container);
    expect(posts).toHaveLength(2);
    expect(posts[1]!.key).toBe(posts[0]!.key);
    setValue(find<HTMLInputElement>(container, '[aria-label="Line 1 quantity"]'), '3');
    await submit(container);
    expect(posts[2]!.key).not.toBe(posts[0]!.key);
    setValue(find<HTMLInputElement>(container, 'input[placeholder="Bengaluru"]'), 'Mysuru');
    await submit(container);
    expect(posts[3]!.key).not.toBe(posts[2]!.key);
  });

  test('each line shows what is free at the CHOSEN warehouse (on hand less allocated) — a hint, never a gate', async () => {
    const container = await openForm();
    setValue(find<HTMLSelectElement>(container, '[aria-label="Line 1 SKU"]'), SKU1);
    expect(container.querySelector('[data-testid="line-hint"]')).toBeNull();
    setValue(find<HTMLSelectElement>(container, '[aria-label="Warehouse"]'), W1);
    expect(find<HTMLElement>(container, '[data-testid="line-hint"]').textContent).toBe('on hand, not yet allocated: 7 each');
    setValue(find<HTMLSelectElement>(container, '[aria-label="Warehouse"]'), W2);
    expect(find<HTMLElement>(container, '[data-testid="line-hint"]').textContent).toBe('on hand, not yet allocated: 4 each');
    // A SKU with no stock row there has none.
    setValue(find<HTMLSelectElement>(container, '[aria-label="Line 1 SKU"]'), SKU2);
    expect(find<HTMLElement>(container, '[data-testid="line-hint"]').textContent).toBe('on hand, not yet allocated: 0 kg');
    // Never a gate: an order above the hint is still sent (the server rules).
    postReplies = [[201, PLACED]];
    await fillAndSubmit(container, { qty: '50' });
    expect(posts).toHaveLength(1);
  });

  test('success shows "Order placed — N lines to {warehouse} ({placedAt IST})" and returns the list to page ONE, refetched', async () => {
    const row = (id: string, ref: string) => ({ id, status: 'accepted', source: 'ingested', externalRef: ref, warehouseName: 'Main', destinationName: null, destinationCity: null, destinationPincode: null, lineCount: 1, createdAt: '2026-10-08T10:00:00.000Z' });
    routes = {
      ...routes,
      '/portal/orders': [200, { items: [row('o-1', 'REF-PAGE-1')], nextCursor: 'ORD-PAGE-2' }],
      '/portal/orders?cursor=ORD-PAGE-2': [200, { items: [row('o-2', 'REF-PAGE-2')], nextCursor: null }],
    };
    view = render(<PortalOrders />);
    await settle();
    click(buttonNamed(view.container, 'Next'));
    await settle();
    expect(view.container.textContent).toContain('REF-PAGE-2');
    click(buttonNamed(view.container, 'Place an order'));
    await settle();
    postReplies = [[201, { ...PLACED, lineCount: 2 }]];
    const listReads = () => urls.filter((url, i) => requests[i]!.startsWith('GET ') && /\/portal\/orders(\?|$)/.test(url));
    const before = listReads().length;
    await fillAndSubmit(view.container);
    expect(view.container.textContent).toContain('Order placed');
    expect(view.container.textContent).toContain('2 lines to Main (22 Oct 2026, 10:30 IST)');
    expect(listReads()).toHaveLength(before + 1);
    expect(listReads().at(-1)).not.toContain('cursor=');
    expect(view.container.textContent).toContain('REF-PAGE-1');
    expect(view.container.textContent).not.toContain('REF-PAGE-2');
    expect(view.container.querySelector('form[aria-label="Place an order"]')).toBeNull();
  });

  test('Discard closes the form and drops the draft and its key: reopened, it is blank and the next POST mints a fresh key', async () => {
    postReplies = [
      [503, { code: 'unavailable', status: 503, title: 'Down' }],
      [201, PLACED],
    ];
    const container = await openForm();
    await fillAndSubmit(container);
    click(buttonNamed(container, 'Discard'));
    await settle();
    expect(container.querySelector('form[aria-label="Place an order"]')).toBeNull();
    click(buttonNamed(container, 'Place an order'));
    await settle();
    expect(find<HTMLInputElement>(container, '[aria-label="Line 1 quantity"]').value).toBe('');
    await fillAndSubmit(container);
    expect(posts).toHaveLength(2);
    expect(posts[1]!.key).not.toBe(posts[0]!.key);
  });

  test('a shortage names the short SKUs from extensions.skuCodes — never the detail — and re-reads the stock for the hints', async () => {
    postReplies = [[409, { code: 'order-backorder-rejected', status: 409, title: 'Not enough stock', detail: 'SERVER WORDS reserved 3 of 7', skuCodes: ['TEE-RED'] }]];
    const container = await openForm();
    const stockReads = () => requests.filter((r) => r.startsWith('GET ') && r.endsWith('/portal/stock')).length;
    const before = stockReads();
    await fillAndSubmit(container);
    expect(stockReads()).toBe(before + 1);
    const alert = find<HTMLElement>(container, 'form [role="alert"]').textContent;
    expect(alert).toBe('Not enough stock at this warehouse for TEE-RED — nothing was placed. Lower the quantities or choose another warehouse.');
    expect(alert).not.toContain('SERVER WORDS');
  });

  test('the licence refusal is the generic sentence — never a site or a holder', async () => {
    postReplies = [[409, { code: 'licence-not-covered', status: 409, title: 'Licence', detail: 'site "WH-1" lacks Form 20B' }]];
    const container = await openForm();
    await fillAndSubmit(container);
    expect(find<HTMLElement>(container, 'form [role="alert"]').textContent).toBe(
      'A licence for one of these products is not on file with the warehouse — nothing was placed. Contact the warehouse.',
    );
  });

  test('a client parse problem sends nothing (no warehouse picked)', async () => {
    const container = await openForm();
    setValue(find<HTMLSelectElement>(container, '[aria-label="Line 1 SKU"]'), SKU1);
    setValue(find<HTMLInputElement>(container, '[aria-label="Line 1 quantity"]'), '1');
    fillAddress(container);
    await submit(container);
    expect(posts).toHaveLength(0);
    expect(find<HTMLElement>(container, 'form [role="alert"]').textContent).toBe('Choose the warehouse the order ships from.');
  });

  test('while the POST is in flight the fieldset is disabled and a second submit sends nothing', async () => {
    let release!: () => void;
    postHold = new Promise<void>((resolve) => {
      release = resolve;
    });
    postReplies = [[201, PLACED]];
    const container = await openForm();
    await fillAndSubmit(container);
    expect(posts).toHaveLength(1);
    const fieldset = container.querySelector('form[aria-label="Place an order"] fieldset') as HTMLFieldSetElement;
    expect(fieldset.disabled).toBe(true);
    expect(fieldset.contains(find<HTMLSelectElement>(container, '[aria-label="Line 1 SKU"]'))).toBe(true);
    expect(fieldset.contains(buttonNamed(container, 'Discard'))).toBe(true);
    await submit(container);
    expect(posts).toHaveLength(1);
    release();
    await settle();
    expect(container.textContent).toContain('Order placed');
  });

  test('a catalogue past the 20-page drain disables the order form with its own too-large sentence', async () => {
    let page = 0;
    const real = globalThis.fetch;
    stubGlobal('fetch', (async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input.toString());
      const { pathname } = new URL(request.url);
      if (pathname.endsWith('/portal/skus')) {
        page += 1;
        return json(200, { items: [sku(`0198f7a2-1b3c-7d4e-8f90-${String(page).padStart(12, '0')}`, `SKU-${page}`, `Sku ${page}`)], nextCursor: `C-${page}` });
      }
      return real(input);
    }) as unknown as typeof fetch);
    const container = await openForm();
    expect(page).toBe(20);
    expect(container.textContent).toContain('Your catalogue is too large for this form — ask the warehouse to place this order for you.');
    expect(container.querySelector('form[aria-label="Place an order"]')).toBeNull();
  });

  test('a single warehouse is chosen without touching the picker', async () => {
    routes = { ...routes, '/portal/warehouses': [200, { items: [{ warehouseId: W1, warehouseName: 'Main', city: 'Bengaluru' }] }] };
    postReplies = [[201, PLACED]];
    const container = await openForm();
    setValue(find<HTMLSelectElement>(container, '[aria-label="Line 1 SKU"]'), SKU1);
    setValue(find<HTMLInputElement>(container, '[aria-label="Line 1 quantity"]'), '1');
    fillAddress(container);
    await submit(container);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body.warehouseId).toBe(W1);
  });

  test('no warehouses: the form is disabled with the ask-the-warehouse sentence', async () => {
    routes = { ...routes, '/portal/warehouses': [200, { items: [] }] };
    const container = await openForm();
    expect(container.textContent).toContain('No warehouses are set up yet — ask the warehouse');
    expect(container.querySelector('form[aria-label="Place an order"]')).toBeNull();
  });

  test('a failed stock read shows ReadFailure with Retry beside the lines, and the order can still be placed', async () => {
    routes = { ...routes, '/portal/stock': [503, { code: 'unavailable', status: 503, title: 'Down', detail: 'The stock read failed.' }] };
    postReplies = [[201, PLACED]];
    const container = await openForm();
    const form = find<HTMLFormElement>(container, 'form[aria-label="Place an order"]');
    expect(form.querySelector('[role="alert"]')!.textContent).toContain('The stock read failed.');
    buttonNamed(container, 'Retry');
    await fillAndSubmit(container);
    expect(posts).toHaveLength(1);
  });

  test('a session gone at submit sends nothing and says so', async () => {
    const container = await openForm();
    setValue(find<HTMLSelectElement>(container, '[aria-label="Warehouse"]'), W1);
    setValue(find<HTMLSelectElement>(container, '[aria-label="Line 1 SKU"]'), SKU1);
    setValue(find<HTMLInputElement>(container, '[aria-label="Line 1 quantity"]'), '1');
    fillAddress(container);
    clearSession();
    await submit(container);
    expect(posts).toHaveLength(0);
    // (The form's reads lose their tenant with the session, so it falls back to its frame — which still says why.)
    const alerts = [...container.querySelectorAll('[aria-label="Place an order"] [role="alert"]')].map((a) => a.textContent);
    expect(alerts).toContain('Your session expired — sign in again.');
  });

  test('a quantity finer than its unit is named by line and sends nothing', async () => {
    const container = await openForm();
    await fillAndSubmit(container, { qty: '1.5' });
    expect(posts).toHaveLength(0);
    expect(find<HTMLElement>(container, 'form [role="alert"]').textContent).toBe('Line 1: TEE-RED is counted in each — whole numbers only (got 1.5).');
  });

  test('no SKUs: the form is disabled with the order sentence', async () => {
    routes = { ...routes, '/portal/skus': [200, { items: [], nextCursor: null }] };
    const container = await openForm();
    expect(container.textContent).toContain('No active SKUs are set up for your company yet — ask the warehouse');
    expect(container.querySelector('form[aria-label="Place an order"]')).toBeNull();
  });

  // ── story 4-1b: the client's own order number ──────────────────────────

  test('story 4-1b: "Your order number" is sent trimmed only when given; the banner names the order by it', async () => {
    postReplies = [[201, { ...PLACED, clientOrderRef: 'SO-7' }]];
    const container = await openForm();
    const ref = [...container.querySelectorAll('label')].find((label) => label.querySelector('span')?.textContent === 'Your order number (optional)')!.querySelector('input')!;
    setValue(ref, '  SO-7 ');
    await fillAndSubmit(container);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body.clientOrderRef).toBe('SO-7');
    expect(view!.container.textContent).toContain('Order SO-7 placed');
  });

  test('story 4-1b: a blank number sends no key; a refused shape sends nothing; a 409 duplicate names the typed number', async () => {
    postReplies = [[409, { code: 'duplicate-client-order-ref', status: 409, title: 'Taken', detail: 'SERVER WORDS' }]];
    const container = await openForm();
    const ref = () => [...container.querySelectorAll('label')].find((label) => label.querySelector('span')?.textContent === 'Your order number (optional)')!.querySelector('input')!;
    setValue(ref(), 'SO-é');
    await fillAndSubmit(container);
    expect(posts).toHaveLength(0);
    expect(container.textContent).toContain('Your order number takes plain letters, digits, spaces and punctuation only');
    setValue(ref(), 'SO-1042');
    await submit(container);
    expect(posts).toHaveLength(1);
    expect(container.textContent).toContain('Order number SO-1042 is already used by one of your open orders — use a different number.');
    expect(container.textContent).not.toContain('SERVER WORDS');
    postReplies = [[201, PLACED]];
    setValue(ref(), '   ');
    await submit(container);
    expect(posts).toHaveLength(2);
    expect('clientOrderRef' in posts[1]!.body).toBe(false);
  });

  test('story 4-1b: the Reference column reads the client number first; the search sends reference and Clear drops it', async () => {
    const row = (id: string, clientOrderRef: string | null, externalRef: string | null) => ({ id, status: 'accepted', source: externalRef === null ? 'manual' : 'ingested', externalRef, clientOrderRef, warehouseName: 'Main', destinationName: null, destinationCity: null, destinationPincode: null, lineCount: 1, createdAt: '2026-10-08T10:00:00.000Z' });
    routes = { ...routes, '/portal/orders': [200, { items: [row('o-1', 'SO-7', null), row('o-2', null, 'SHOP-9'), row('o-3', null, null)], nextCursor: null }] };
    view = render(<PortalOrders />);
    await settle();
    // UI-2 (A5) — the Reference cell also hosts the narrow-width mirror of the
    // priority columns, so read the cell's own content (its first node).
    const cells = [...view.container.querySelectorAll('tbody tr')].map((tr) => tr.querySelectorAll('td')[1]?.firstChild?.textContent);
    expect(cells).toEqual(['SO-7', 'SHOP-9', 'Manual']);
    const box = view.container.querySelector<HTMLInputElement>('form[role="search"] input')!;
    setValue(box, ' SO-7 ');
    act(() => void view!.container.querySelector('form[role="search"]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    expect(urls.filter((url) => /\/portal\/orders\?/.test(url)).at(-1)).toContain('reference=SO-7');
    click(buttonNamed(view.container, 'Clear'));
    await settle();
    expect(urls.filter((url) => /\/portal\/orders(\?|$)/.test(url)).at(-1)).not.toContain('reference=');
  });
  test('story 4-1b: a search resets the cursor — Clear never replays the page-2 cursor of the list before it', async () => {
    const row = (id: string) => ({ id, status: 'accepted', source: 'manual', externalRef: null, clientOrderRef: id, warehouseName: 'Main', destinationName: null, destinationCity: null, destinationPincode: null, lineCount: 1, createdAt: '2026-10-08T10:00:00.000Z' });
    routes = { ...routes, '/portal/orders': [200, { items: [row('P1')], nextCursor: 'ORD-P2' }], '/portal/orders?cursor=ORD-P2': [200, { items: [row('P2')], nextCursor: null }] };
    view = render(<PortalOrders />);
    await settle();
    click(buttonNamed(view.container, 'Next'));
    await settle();
    expect(urls.at(-1)).toContain('cursor=ORD-P2');
    setValue(view.container.querySelector<HTMLInputElement>('form[role="search"] input')!, 'SO-7');
    act(() => void view!.container.querySelector('form[role="search"]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    click(buttonNamed(view.container, 'Clear'));
    await settle();
    const last = urls.filter((url) => /\/portal\/orders(\?|$)/.test(url)).at(-1)!;
    expect(last).not.toContain('cursor=');
    expect(last).not.toContain('reference=');
  });

  test('story 4-1b: placing an order clears the active search, so the new order is visible', async () => {
    postReplies = [[201, PLACED]];
    view = render(<PortalOrders />);
    await settle();
    setValue(view.container.querySelector<HTMLInputElement>('form[role="search"] input')!, 'SO-7');
    act(() => void view!.container.querySelector('form[role="search"]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    expect(urls.filter((url) => /\/portal\/orders\?/.test(url)).at(-1)).toContain('reference=SO-7');
    click(buttonNamed(view.container, 'Place an order'));
    await settle();
    await fillAndSubmit(view.container);
    const last = urls.filter((url) => /\/portal\/orders(\?|$)/.test(url)).at(-1)!;
    expect(last).not.toContain('reference=');
    expect(view.container.querySelector<HTMLInputElement>('form[role="search"] input')!.value).toBe('');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Story 21-8 — the Service page.
// ──────────────────────────────────────────────────────────────────────────
describe('PortalService (21-8)', () => {
  const W1 = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
  const W2 = '0198f7a2-1b3c-7d4e-8f90-0000000000a2';
  const REPORT = {
    from: '2026-09-11',
    to: '2026-10-10',
    warehouseId: null,
    asOf: '2026-10-10T04:30:00.000Z',
    targetHours: 24,
    dockToStock: { medianMinutes: 95, placements: 12 },
    pickAccuracy: { accuracy: null, linesDispatched: 0, linesShortPicked: 0, packFailures: 0, packFailuresCountingSince: null },
    dispatchTimeliness: { ordersDispatched: 5, onTime: 4, onTimeRate: 0.8, medianMinutes: 600, lateNotDispatched: 3 },
  };

  function setValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
    const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
    act(() => {
      setter.call(element, value);
      element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    });
  }

  const serviceUrls = () => urls.filter((url) => url.includes('/portal/service'));

  async function open(): Promise<HTMLElement> {
    view = render(<PortalService />);
    await settle();
    return view.container;
  }

  beforeEach(() => {
    writeSession(PORTAL_SESSION);
    routes = {
      '/portal/service': [200, REPORT],
      '/portal/warehouses': [
        200,
        { items: [{ warehouseId: W1, warehouseName: 'Main', city: 'Bengaluru' }, { warehouseId: W2, warehouseName: 'North', city: 'Delhi' }] },
      ],
    };
  });

  test('renders the three tiles — null reads "No data" — and every request is a portal route, never with a clientId', async () => {
    const container = await open();
    const tiles = [...container.querySelectorAll('[role="group"]')].map((tile) => tile.getAttribute('aria-label'));
    expect(tiles).toEqual(['Dock-to-stock (median): 1 h 35 min', 'Pick accuracy: No data', 'Dispatched within 24 h: 80%']);
    expect(container.textContent).toContain('3 orders late, not yet dispatched');
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.filter((r) => !r.includes(`/api/v1/tenants/${TENANT_ID}/portal/`))).toEqual([]);
    expect(serviceUrls()).toHaveLength(1);
    const query = new URL(`http://x${serviceUrls()[0]!}`).searchParams;
    expect([...query.keys()].sort()).toEqual(['from', 'to']);
  });

  test('changing the period or the warehouse refetches with it; a refused period is never sent', async () => {
    const container = await open();
    const from = container.querySelector('[aria-label="Report from"]') as HTMLInputElement;
    const to = container.querySelector('[aria-label="Report to"]') as HTMLInputElement;
    setValue(from, '2026-09-01');
    setValue(to, '2026-09-30');
    await settle();
    expect(serviceUrls().at(-1)).toContain('from=2026-09-01');
    expect(serviceUrls().at(-1)).toContain('to=2026-09-30');
    setValue(container.querySelector('[aria-label="Report warehouse"]') as HTMLSelectElement, W2);
    await settle();
    expect(serviceUrls().at(-1)).toContain(`warehouseId=${W2}`);
    const sent = serviceUrls().length;
    // 367 days — the server's 400; nothing is sent, the problem shows.
    setValue(from, '2025-09-01');
    setValue(to, '2026-09-02');
    await settle();
    expect(serviceUrls()).toHaveLength(sent);
    expect(container.querySelector('[role="alert"]')!.textContent).toBe('A period covers at most 366 days.');
  });

  test('the warehouse filter shows only when the tenant has more than one warehouse', async () => {
    routes['/portal/warehouses'] = [200, { items: [{ warehouseId: W1, warehouseName: 'Main', city: 'Bengaluru' }] }];
    const container = await open();
    expect(container.querySelector('[aria-label="Report warehouse"]')).toBeNull();
    expect(serviceUrls().every((url) => !url.includes('warehouseId'))).toBe(true);
  });

  test('a 404 reads that the warehouse is gone; a 503 asks for a shorter period', async () => {
    routes['/portal/service'] = [404, { code: 'not-found', status: 404, title: 'Warehouse not found' }];
    let container = await open();
    expect(container.textContent).toContain('That warehouse is no longer available');
    view!.unmount();
    routes['/portal/service'] = [503, { code: 'report-unavailable', status: 503, title: 'Report unavailable', detail: 'slow' }];
    container = await open();
    expect(container.textContent).toContain('The report took too long — try a shorter period');
  });

  test('21-11b: a failed warehouses read takes the picker slot with Retry; the report still reads; Retry refetches', async () => {
    routes['/portal/warehouses'] = [503, { code: 'unavailable', status: 503, title: 'Down', detail: 'The warehouse read failed.' }];
    const container = await open();
    expect(container.querySelector('[aria-label="Report warehouse"]')).toBeNull();
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Warehouses not loaded');
    expect(alert.textContent).toContain('The warehouse read failed.');
    // The report still reads, for every warehouse.
    expect(serviceUrls()).toHaveLength(1);
    expect(serviceUrls()[0]).not.toContain('warehouseId');
    const warehouseReads = () => urls.filter((url) => url.includes('/portal/warehouses')).length;
    const before = warehouseReads();
    routes['/portal/warehouses'] = [
      200,
      { items: [{ warehouseId: W1, warehouseName: 'Main', city: 'Bengaluru' }, { warehouseId: W2, warehouseName: 'North', city: 'Delhi' }] },
    ];
    click(buttonNamed(container, 'Retry'));
    await settle();
    expect(warehouseReads()).toBe(before + 1);
    expect(container.textContent).not.toContain('Warehouses not loaded');
    expect(container.querySelector('[aria-label="Report warehouse"]')).not.toBeNull();
  });

  test('a client-suspended refusal fires the portal event', async () => {
    routes['/portal/service'] = [403, { code: 'client-suspended', status: 403, title: 'Suspended' }];
    let announced = 0;
    const onSuspended = () => void (announced += 1);
    window.addEventListener('wms-portal-suspended', onSuspended);
    const container = await open();
    window.removeEventListener('wms-portal-suspended', onSuspended);
    expect(announced).toBeGreaterThanOrEqual(1);
    expect(container.textContent).toContain("Your company's portal access is suspended.");
  });
});

describe('story UI-1 — the portal Home', () => {
  beforeEach(() => {
    writeSession(PORTAL_SESSION);
  });

  const order = (id: string, status: string, ref: string) => ({
    id,
    status,
    source: 'manual',
    externalRef: null,
    clientOrderRef: ref,
    orderType: 'b2c',
    priority: 'normal',
    shipByDate: null,
    codAmountPaise: null,
    warehouseName: 'Whitefield',
    destinationName: 'Asha',
    destinationCity: 'Bengaluru',
    destinationPincode: '560001',
    lineCount: 1,
    createdAt: '2026-10-08T10:00:00.000Z',
  });

  test('a client without the write capabilities sees no action buttons on Home', async () => {
    writeSession({ ...PORTAL_SESSION, user: { ...PORTAL_SESSION.user, role: 'viewer' as never } });
    routes = { '/portal/service': [503, { code: 'report-unavailable', status: 503, title: 'Report unavailable', detail: 'slow' }] };
    view = render(<PortalHome />);
    await settle();
    const names = [...view.container.querySelectorAll('a')].map((a) => a.textContent);
    expect(names).not.toContain('Place an order');
    expect(names).not.toContain('Announce a shipment');
  });

  test('welcome header with the two writes; counts say "+" when the list has another page; a failed read fails only its tile', async () => {
    routes = {
      '/portal/orders': [200, { items: [order('o-1', 'accepted', 'SO-1'), order('o-2', 'dispatched', 'SO-2')], nextCursor: 'CURSOR-2' }],
      '/portal/inbound/asns': [503, { code: 'unavailable', status: 503, title: 'Down', detail: 'The ASN read failed.' }],
      '/portal/service': [503, { code: 'report-unavailable', status: 503, title: 'Report unavailable', detail: 'slow' }],
    };
    view = render(<PortalHome />);
    await settle();
    const c = view.container;
    expect(c.querySelector('h1')!.textContent).toBe('Welcome, Brand A Apparel');
    const links = [...c.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toContainEqual(['Place an order', '/portal/orders']);
    expect(links).toContainEqual(['Announce a shipment', '/portal/inbound']);
    // One page of two rows with a next cursor: at least 2, never the page size.
    expect(c.querySelector('[aria-label="Being prepared: 2+"]')).not.toBeNull();
    expect(c.querySelector('[aria-label="Packed, awaiting dispatch: 2+"]')).not.toBeNull();
    // The ASN read failed: that tile alone shows the reason and Retry.
    expect(c.textContent).toContain('Shipments expected not loaded');
    expect(c.textContent).toContain('The ASN read failed.');
    expect(c.querySelector('[aria-label^="Shipments expected:"]')).toBeNull();
    // Recent orders: newest first as served, each with its status chip.
    const recent = [...c.querySelectorAll('[data-testid="recent-orders"] li')].map((li) => li.textContent ?? '');
    expect(recent).toHaveLength(2);
    expect(recent[0]).toContain('SO-1');
    expect(recent[0]).toContain('Accepted');
    expect(c.querySelector('[data-testid="recent-orders"] [data-tone="success"]')!.textContent).toBe('Dispatched');
    // Every request is a portal route, and each count tile reads its own status.
    expect(requests.every((r) => r.includes('/portal/'))).toBe(true);
    const orderReads = urls.filter((u) => u.includes('/portal/orders'));
    expect(orderReads.some((u) => u.includes('status=accepted'))).toBe(true);
    expect(orderReads.some((u) => u.includes('status=ready_to_dispatch'))).toBe(true);
    expect(orderReads.some((u) => !u.includes('status='))).toBe(true); // the recent list is unfiltered
  });

  test('a filtered count: only the expected ASNs on the page, with "+" for a further page', async () => {
    const asn = (id: string, status: string) => ({ id, code: id, status, expectedAt: null, warehouseName: 'Whitefield', lineCount: 1, announcedTotal: 1, receivedTotal: 0, createdAt: '2026-10-08T10:00:00.000Z' });
    routes = {
      '/portal/inbound/asns': [200, { items: [asn('A1', 'announced'), asn('A2', 'closed'), asn('A3', 'partially_received')], nextCursor: 'C2' }],
      '/portal/service': [503, { code: 'report-unavailable', status: 503, title: 'Report unavailable', detail: 'slow' }],
    };
    view = render(<PortalHome />);
    await settle();
    expect(view.container.querySelector('[aria-label="Shipments expected: 2+"]')).not.toBeNull();
    expect(view.container.textContent).toContain('No orders yet');
  });

  test('an expanded portal order shows its timeline: Placed with the IST time, then where it is now', async () => {
    routes = {
      '/portal/orders': [200, { items: [order(ORDER_ID, 'ready_to_dispatch', 'SO-9')], nextCursor: null }],
      [`/portal/orders/${ORDER_ID}`]: [200, { ...order(ORDER_ID, 'ready_to_dispatch', 'SO-9'), lines: [] }],
    };
    view = render(<PortalOrders />);
    await settle();
    click(buttonNamed(view.container, 'Lines'));
    await settle();
    const steps = [...view.container.querySelectorAll('[data-testid="status-timeline"] li')];
    expect(steps.map((li) => li.getAttribute('data-state'))).toEqual(['done', 'done', 'current', 'upcoming']);
    expect(steps[0]!.textContent).toContain('8 Oct 2026, 15:30 IST');
    expect(steps[2]!.getAttribute('aria-current')).toBe('step');
  });
});

describe('Inbound — Receipts and their damage photos (story 2-5a)', () => {
  const GRN_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000b7';
  const row = {
    id: GRN_ID,
    code: 'GRN-0042',
    warehouseName: 'Whitefield',
    poCode: null,
    asnCode: 'ASN-001',
    lineCount: 1,
    receivedTotal: 1200,
    damagedTotal: 3,
    shortTotal: 0,
    photoCount: 1,
    receivedAt: '2026-10-13T08:33:00.000Z',
    createdAt: '2026-10-13T08:40:00.000Z',
  };
  const detail = {
    ...row,
    // Story 2-9a — the GRN document's header.
    parties: {
      frozen: true,
      warehouse: { code: 'WF', name: 'Whitefield', legalName: null, gstin: '29AAAAA0000A1Z5', address: null, operatorName: 'Three PL Co' },
      client: { code: 'BRAND-A', name: 'Brand A Apparel', legalName: null, gstin: null, address: null },
      vendor: null,
      supplierNote: 'As announced by the client — ASN ASN-001',
    },
    document: { kind: 'asn', code: 'ASN-001', blindReasonCode: null, blindReasonLabel: null, label: 'ASN ASN-001' },
    arrival: null,
    totals: { lineCount: 1, byUom: [{ uom: 'each', goodQty: 1200, damagedQty: 3, shortQty: 0 }] },
    lines: [
      {
        lineNo: 1,
        skuCode: 'TEE-RED',
        skuName: 'Red tee',
        qty: 1200,
        damagedQty: 3,
        damageReasonCode: 'crushed',
        shortQty: 0,
        shortReasonCode: null,
        damageReasonLabel: 'Crushed',
        shortReasonLabel: null,
        uom: 'each',
        uomPrecision: 0,
        batchCode: 'B-9',
        mfgDate: null,
        expiryDate: '2027-01-31',
        expirySource: 'derived',
        excess: { pendingQty: 20, approvedQty: 0, rejectedQty: 0 },
        qc: { status: 'inspected', heldQty: 20, releasedQty: 0, passedQty: 18, failedQty: 2 },
        serialCount: 0,
        unreadableSerialCount: 0,
        photos: [
          { id: 'ph-1', status: 'attached', url: 'https://bucket.example/ph-1?sig=1', urlExpiresAt: '2999-01-01T00:00:00.000Z', width: 1600, height: 1200, capturedAt: '2026-10-13T08:33:00.000Z' },
          { id: 'ph-2', status: 'removed', url: null, urlExpiresAt: null, width: null, height: null, capturedAt: null },
        ],
      },
    ],
  };

  test('the list reads the portal route only; a row expands to its lines, its photo, and the removed placeholder with no image', async () => {
    writeSession(PORTAL_SESSION);
    routes = {
      '/portal/inbound/goods-receipts': [200, { items: [row], nextCursor: null }],
      [`/portal/inbound/goods-receipts/${GRN_ID}`]: [200, detail],
    };
    view = render(<PortalInbound />);
    await settle();
    expect(view.container.textContent).toContain('Receipts');
    expect(view.container.textContent).toContain('GRN-0042');
    expect(view.container.textContent).toContain('1,200');
    const section = [...view.container.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === 'Receipts')!;
    click(buttonNamed(section as HTMLElement, 'Lines'));
    await settle();
    expect(requests).toContain(`GET /api/v1/tenants/${TENANT_ID}/portal/inbound/goods-receipts/${GRN_ID}`);
    expect(requests.every((r) => !r.includes('/receiving/'))).toBe(true);
    const lines = view.container.querySelector('[data-testid="receipt-lines"]')!;
    expect(lines.textContent).toContain('damaged 3 (Crushed)');
    expect(lines.querySelectorAll('img')).toHaveLength(1);
    const removed = lines.querySelector('[data-testid="portal-photo-removed"]')!;
    expect(removed.textContent).toContain('Removed by the warehouse');
    expect(removed.querySelector('img')).toBeNull();
  });

  test('a photo opens the lightbox (one modal); the removed one shows its placeholder there too', async () => {
    writeSession(PORTAL_SESSION);
    routes = {
      '/portal/inbound/goods-receipts': [200, { items: [row], nextCursor: null }],
      [`/portal/inbound/goods-receipts/${GRN_ID}`]: [200, detail],
    };
    view = render(<PortalInbound />);
    await settle();
    const section = [...view.container.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === 'Receipts')!;
    click(buttonNamed(section as HTMLElement, 'Lines'));
    await settle();
    click(view.container.querySelector('button[aria-label="Open TEE-RED photo 1"]')!);
    const dialog = view.container.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('img')!.getAttribute('src')).toBe('https://bucket.example/ph-1?sig=1');
    expect(dialog.textContent).toContain('1 of 2');
    click(dialog.querySelector('button[aria-label="Next photo"]')!);
    expect(dialog.querySelector('img')).toBeNull();
    expect(dialog.textContent).toContain('Removed by the warehouse');
    expect(view.container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
});

describe('Inbound — the GRN document in the portal (story 2-9a)', () => {
  const GRN_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000c9';
  const detail = {
    id: GRN_ID,
    code: 'GRN-0099',
    warehouseName: 'Whitefield',
    poCode: 'PO-7',
    asnCode: null,
    lineCount: 1,
    receivedTotal: 12.5,
    damagedTotal: 0,
    shortTotal: 0,
    photoCount: 0,
    receivedAt: '2026-10-13T08:33:00.000Z',
    createdAt: '2026-10-13T08:40:00.000Z',
    parties: {
      frozen: false,
      warehouse: { code: 'WF', name: 'Whitefield', legalName: null, gstin: null, address: null, operatorName: 'Three PL Co' },
      client: { code: 'BRAND-A', name: 'Brand A Apparel', legalName: null, gstin: null, address: null },
      vendor: { code: 'V-1', name: 'Fabrics Co', legalName: null, gstin: '24AAACF1234A1Z5', address: null },
      supplierNote: null,
    },
    document: { kind: 'po', code: 'PO-7', blindReasonCode: null, blindReasonLabel: null, label: 'PO PO-7' },
    arrival: {
      gateInCode: 'GI-3', vehicleNo: 'KA01AB1234', containerNo: null, transporterName: 'Swift', lrNumber: null, sealStatus: 'intact', sealNumber: null,
      dockDoor: null, gatedInAt: '2026-10-13T08:00:00.000Z', unloadStartedAt: null, unloadEndedAt: null,
      documents: [{ kind: 'invoice', number: 'INV-1', date: '2026-10-12', ewayBillNo: null }], documentsOmitted: true,
    },
    totals: { lineCount: 1, byUom: [{ uom: 'kg', goodQty: 12.5, damagedQty: 0, shortQty: 0 }] },
    lines: [
      {
        lineNo: 1, skuCode: 'RICE', skuName: 'Rice', qty: 12.5, damagedQty: 0, damageReasonCode: null, shortQty: 0, shortReasonCode: null,
        damageReasonLabel: null, shortReasonLabel: null, uom: 'kg', uomPrecision: 3, batchCode: 'B-1', mfgDate: null, expiryDate: null, expirySource: null,
        excess: { pendingQty: 0, approvedQty: 0, rejectedQty: 0 }, qc: { status: 'on-hold', heldQty: 12.5, releasedQty: 0, passedQty: 0, failedQty: 0 },
        serialCount: 0, unreadableSerialCount: 0, photos: [],
      },
    ],
  };

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  test('A18: ?grn=<id> opens that receipt by id — the list (empty here) is not needed; the header, the client words and the downloads', async () => {
    writeSession(PORTAL_SESSION);
    window.history.replaceState(null, '', `/portal/inbound?grn=${GRN_ID}`);
    routes = {
      '/portal/inbound/goods-receipts': [200, { items: [], nextCursor: null }],
      [`/portal/inbound/goods-receipts/${GRN_ID}`]: [200, detail],
    };
    view = render(<PortalInbound />);
    await settle();
    const panel = view.container.querySelector('[data-testid="receipt-deep-link"]')!;
    expect(panel).not.toBeNull();
    // ONE detail read: the panel's title and its lines share it.
    expect(requests.filter((r) => r === `GET /api/v1/tenants/${TENANT_ID}/portal/inbound/goods-receipts/${GRN_ID}`)).toHaveLength(1);
    const text = panel.textContent ?? '';
    expect(text).toContain('PO PO-7');
    expect(text).toContain('Invoice INV-1 dated 2026-10-12');
    expect(text).toContain('kg: good 12.500');
    expect(text).toContain('Fabrics Co');
    expect(text).toContain('Party details are current, not as at receipt');
    expect(text).toContain('INV-1');
    expect(text).toContain('Other documents of this vehicle are not shown.');
    expect(text).toContain('On quality hold');
    expect(text).toContain('batch B-1');
    expect(buttonNamed(panel as HTMLElement, 'Download GRN (PDF)')).toBeDefined();
    expect(buttonNamed(panel as HTMLElement, 'Export lines (CSV)')).toBeDefined();
    expect(requests.every((r) => !r.includes('/receiving/'))).toBe(true);
  });

  test('the downloads: PDF and CSV read the portal file route with their format, save under the GRN name; a refusal shows inline and the buttons re-enable', async () => {
    writeSession(PORTAL_SESSION);
    window.history.replaceState(null, '', `/portal/inbound?grn=${GRN_ID}`);
    routes = { [`/portal/inbound/goods-receipts/${GRN_ID}`]: [200, detail] };
    const downloads: string[] = [];
    const realClick = HTMLAnchorElement.prototype.click;
    const realCreate = URL.createObjectURL;
    const realRevoke = URL.revokeObjectURL;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    };
    URL.createObjectURL = () => 'blob:test';
    URL.revokeObjectURL = () => undefined;
    try {
      view = render(<PortalInbound />);
      await settle();
      const panel = view.container.querySelector('[data-testid="receipt-deep-link"]') as HTMLElement;
      routes[`/portal/inbound/goods-receipts/${GRN_ID}/document/file`] = [200, { pdf: true }];
      click(buttonNamed(panel, 'Download GRN (PDF)'));
      await settle();
      click(buttonNamed(panel, 'Export lines (CSV)'));
      await settle();
      const fileUrls = urls.filter((u) => u.includes('/document/file'));
      expect(fileUrls).toEqual([
        `/api/v1/tenants/${TENANT_ID}/portal/inbound/goods-receipts/${GRN_ID}/document/file?format=pdf`,
        `/api/v1/tenants/${TENANT_ID}/portal/inbound/goods-receipts/${GRN_ID}/document/file?format=csv`,
      ]);
      expect(downloads).toEqual(['GRN-0099.pdf', 'GRN-0099-lines.csv']);
      routes[`/portal/inbound/goods-receipts/${GRN_ID}/document/file`] = [404, { code: 'not-found', status: 404, title: 'Not found' }];
      click(buttonNamed(panel, 'Download GRN (PDF)'));
      await settle();
      expect(panel.textContent).toContain('The GRN file could not be found');
      expect(buttonNamed(panel, 'Download GRN (PDF)').disabled).toBe(false);
      expect(downloads).toHaveLength(2);
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
    }
  });

  test('A18: an unknown id (404) or a malformed one reads "This receipt is not available", with a way back to the list', async () => {
    writeSession(PORTAL_SESSION);
    window.history.replaceState(null, '', `/portal/inbound?grn=${GRN_ID}`);
    routes = { [`/portal/inbound/goods-receipts/${GRN_ID}`]: [404, { code: 'not-found', status: 404, title: 'Not found' }] };
    view = render(<PortalInbound />);
    await settle();
    expect(view.container.querySelector('[data-testid="receipt-deep-link"]')!.textContent).toContain('This receipt is not available.');
    view.unmount();
    window.history.replaceState(null, '', '/portal/inbound?grn=not-a-uuid');
    view = render(<PortalInbound />);
    await settle();
    const panel = view.container.querySelector('[data-testid="receipt-deep-link"]')!;
    expect(panel.textContent).toContain('This receipt is not available.');
    click(buttonNamed(panel as HTMLElement, 'Go to your receipts'));
    await settle();
    expect(view.container.querySelector('[data-testid="receipt-deep-link"]')).toBeNull();
    expect(window.location.search).toBe('');
  });
});

describe('story 4-7a — the portal Returns', () => {
  const RMA_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000b2';
  const ROW = {
    id: RMA_ID,
    code: 'RMA-0007',
    status: 'received',
    orderId: ORDER_ID,
    orderReference: 'SHOP-#1001',
    externalReference: 'CH-77',
    createdAt: '2026-10-16T04:30:00.000Z',
    lineCount: 1,
    receivedTotal: 4,
    restockedTotal: 2,
    onHoldTotal: 1,
    failedInspectionTotal: 0,
    scrappedTotal: 1,
    openTotal: 0,
  };

  async function flush(): Promise<void> {
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  test('the list shows what became of the units; the filter is server-side; a row expands to its lines and decisions — no bin, user or note', async () => {
    writeSession(PORTAL_SESSION);
    routes = {
      '/portal/returns': [200, { items: [ROW], nextCursor: null }],
      [`/portal/returns/${RMA_ID}`]: [
        200,
        {
          ...ROW,
          lines: [
            {
              skuCode: 'TEE-RED-M',
              skuName: 'Red tee M',
              authorizedQty: 4,
              receivedQty: 4,
              returnReasonCode: 'wrong-item',
              restockedQty: 2,
              onHoldQty: 1,
              failedInspectionQty: 0,
              scrappedQty: 1,
              openQty: 0,
              // Story 4-7c — units on their way back to the brand, and shipped back.
              returningToClientQty: 1,
              returnedToClientQty: 3,
            },
          ],
          dispositions: [
            { skuCode: 'TEE-RED-M', outcome: 'restock', qty: 2, reasonCode: null, occurredAt: '2026-10-17T05:00:00.000Z' },
            { skuCode: 'TEE-RED-M', outcome: 'scrap', qty: 1, reasonCode: 'damaged', occurredAt: '2026-10-17T06:00:00.000Z' },
          ],
        },
      ],
    };
    view = render(<PortalReturns />);
    await flush();
    const text = view.container.textContent ?? '';
    for (const expected of ['RMA-0007', 'SHOP-#1001', 'Received', '2 restocked · 1 held for inspection · 1 scrapped', '↩ Awaiting a decision']) {
      expect(text).toContain(expected);
    }
    expect(urls.some((url) => url.endsWith('/portal/returns'))).toBe(true);
    const select = view.container.querySelector('select[aria-label="Show"]') as HTMLSelectElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(select, 'awaiting');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(urls.some((url) => url.endsWith('/portal/returns?dispositionState=awaiting'))).toBe(true);
    const toggle = view.container.querySelector('button[aria-label="Show the lines of RMA-0007"]') as HTMLButtonElement;
    await act(async () => {
      toggle.click();
    });
    await flush();
    const detail = view.container.querySelector('[data-testid="portal-return-detail"]')!.textContent ?? '';
    expect(detail).toContain('TEE-RED-M');
    expect(detail).toContain('4 of 4 received');
    expect(detail).toContain('returned as Wrong item');
    expect(detail).toContain('1 being returned to you');
    expect(detail).toContain('3 shipped back to you');
    expect(detail).toContain('Restocked 2');
    expect(detail).toContain('Scrapped 1 · Damaged');
    expect(detail).toContain('IST');
    // Every request stayed on the portal routes.
    expect(requests.every((request) => request.includes('/portal/'))).toBe(true);
  });
});

describe('story 3-7a — the portal Recalls', () => {
  const RECALL_ID = '0198f7a2-1b3c-7d4e-8f90-0000000003a1';
  const ZERO = { received: 0, receivedDamaged: 0, onHand: 0, inTransit: 0, heldInOpenOrders: 0, dispatched: 0, returned: 0, returnScrapped: 0, adjustedOut: 0, unaccounted: 0 };
  const ROW = { id: RECALL_ID, code: 'RCL-000001', mode: 'live', status: 'open', externalRef: 'BR-77', openedAt: '2026-10-27T05:00:00.000Z', closedAt: null, lotCount: 1 };

  test('the list and the detail: lots with figures, on hand per warehouse and location (never a bin), its own held orders, the report — portal routes only', async () => {
    writeSession(PORTAL_SESSION);
    routes = {
      '/portal/recalls': [200, { items: [ROW, { ...ROW, id: 'r-2', code: 'RCL-000002', mode: 'mock', status: 'closed', closedAt: '2026-10-28T05:00:00.000Z' }], nextCursor: null }],
      [`/portal/recalls/${RECALL_ID}`]: [
        200,
        {
          ...ROW,
          reasonNote: 'Undeclared peanut',
          closeNote: null,
          lots: [{ batchId: 'b-1', batchCode: 'AB123', skuCode: 'SERUM-30', skuName: 'Serum', uom: 'each', expiryDate: '2027-01-01', figures: { ...ZERO, received: 10, onHand: 4, dispatched: 6 }, closeFigures: null }],
          onHandByWarehouse: [{ warehouseCode: 'BLR', role: 'QC-HOLD', batchCode: 'AB123', quantity: 4 }],
          heldOrders: [{ orderLabel: 'SO-1042', clientOrderRef: 'MY-PO-9', batchCode: 'AB123', quantity: 2 }],
        },
      ],
    };
    view = render(<PortalRecalls />);
    await settle();
    const text = view.container.textContent ?? '';
    expect(text).toContain('RCL-000001');
    expect(text).toContain('Your ref BR-77');
    expect(view.container.querySelectorAll('[data-testid="recall-mock-chip"]')).toHaveLength(1);
    await act(async () => {
      (view!.container.querySelector('button[aria-label="Show recall RCL-000001"]') as HTMLButtonElement).click();
    });
    await settle();
    const detail = view.container.querySelector('[data-testid="portal-recall-detail"]')!;
    const detailText = detail.textContent ?? '';
    expect(detailText).toContain('Undeclared peanut');
    expect(detail.querySelector('[data-testid="recall-figures"]')?.textContent).toContain('Dispatched');
    expect(detail.querySelector('[data-testid="recall-on-hand"]')?.textContent).toContain('QC hold');
    expect(detail.querySelector('[data-testid="portal-recall-held"]')?.textContent).toContain('MY-PO-9');
    expect(detailText).not.toContain('Bin');
    expect([...detail.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Download CSV', 'Download XLSX']);
    expect(requests.every((request) => request.includes('/portal/'))).toBe(true);
  });

  test('a failed list renders the reason with Retry, never an empty list', async () => {
    writeSession(PORTAL_SESSION);
    routes = { '/portal/recalls': [503, { code: 'report-unavailable', status: 503, title: 'Slow' }] };
    view = render(<PortalRecalls />);
    await settle();
    expect(view.container.textContent).toContain('Recalls not loaded');
    expect([...view.container.querySelectorAll('button')].some((b) => b.textContent === 'Retry')).toBe(true);
  });
});

describe('Import orders from a file (4-1c)', () => {
  const W1 = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
  const W2 = '0198f7a2-1b3c-7d4e-8f90-0000000000a2';
  const result = (dryRun: boolean) => ({
    importId: dryRun ? null : 'imp-1',
    dryRun,
    warehouseId: W1,
    fileSha256: 'ab'.repeat(32),
    rowCount: 3,
    orderCount: 2,
    acceptedCount: 1,
    refusedCount: 1,
    complete: true,
    notAttemptedCount: 0,
    orders: [{ orderId: dryRun ? null : ORDER_ID, clientOrderRef: 'SO-1', lineCount: 2, firstRow: 2, replayed: false }],
    errors: [{ rowNumber: 4, orderRef: 'SO-2', sku: 'RICE', quantity: '10', code: 'order-backorder-rejected', detail: 'Not enough stock at this warehouse for "RICE" — nothing was placed.' }],
  });

  beforeEach(() => {
    writeSession(PORTAL_SESSION);
    routes = {
      ...routes,
      '/portal/warehouses': [
        200,
        {
          items: [
            { warehouseId: W2, warehouseName: 'Annex', city: 'Chennai' },
            { warehouseId: W1, warehouseName: 'Main', city: 'Bengaluru' },
          ],
        },
      ],
    };
  });

  function setValue(element: HTMLSelectElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(element, value);
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  function pick(container: HTMLElement, file: File): void {
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Order file"]')!;
    act(() => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  test('orders.place is offered "Import from file"; Check posts to portal/order-imports with the warehouse and no key; Import posts the key, names the shortage and refreshes the list', async () => {
    view = render(<PortalOrders />);
    await settle();
    click(buttonNamed(view.container, 'Import from file'));
    await settle();
    const panel = view.container.querySelector<HTMLElement>('section[aria-label="Import orders from a file"]')!;
    expect(panel).not.toBeNull();
    // No client or rate column is offered to a client.
    expect(panel.textContent).not.toContain('rate (rupees');
    expect(buttonNamed(panel, 'Check file').disabled).toBe(true);
    setValue(view.container.querySelector<HTMLSelectElement>('[aria-label="Warehouse"]')!, W1);
    await settle();
    const fresh = view.container.querySelector<HTMLElement>('section[aria-label="Import orders from a file"]')!;
    pick(fresh, new File(['order_ref,sku,quantity\n'], 'orders.csv', { type: 'text/csv' }));
    postReplies.push([200, result(true)]);
    click(buttonNamed(fresh, 'Check file'));
    await settle();
    expect(posts.at(-1)).toMatchObject({ path: `/api/v1/tenants/${PORTAL_SESSION.tenant.id}/portal/order-imports`, key: null, body: { file: 'orders.csv', warehouseId: W1, dryRun: 'true' } });
    expect(fresh.textContent).toContain('1 order, 2 lines ready');
    expect(fresh.textContent).toContain('an order short of stock is refused then');
    const listReads = requests.filter((entry) => entry.endsWith('/portal/orders')).length;
    postReplies.push([201, result(false)]);
    click(buttonNamed(fresh, 'Import'));
    await settle();
    expect(posts.at(-1)!.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(posts.at(-1)!.body).toEqual({ file: 'orders.csv', warehouseId: W1 });
    expect(fresh.textContent).toContain('1 order placed');
    expect(fresh.textContent).toContain('Not enough stock');
    expect(requests.filter((entry) => entry.endsWith('/portal/orders')).length).toBeGreaterThan(listReads);
  });

  test('C16: a file picked before the warehouse is kept; switching the warehouse drops the checked result and the next Import sends a new key', async () => {
    view = render(<PortalOrders />);
    await settle();
    click(buttonNamed(view.container, 'Import from file'));
    await settle();
    const panel = (): HTMLElement => view!.container.querySelector<HTMLElement>('section[aria-label="Import orders from a file"]')!;
    const select = (): HTMLSelectElement => view!.container.querySelector<HTMLSelectElement>('[aria-label="Warehouse"]')!;
    pick(panel(), new File(['order_ref,sku,quantity\n'], 'orders.csv', { type: 'text/csv', lastModified: 7 }));
    setValue(select(), W1);
    await settle();
    expect(panel().textContent).toContain('Selected: orders.csv');
    postReplies.push([200, result(true)]);
    click(buttonNamed(panel(), 'Check file'));
    await settle();
    postReplies.push([200, { ...result(false), importId: null, complete: false, notAttemptedCount: 1 }]);
    click(buttonNamed(panel(), 'Import'));
    await settle();
    const first = posts.at(-1)!.key;
    expect(panel().textContent).toContain('Import again');
    setValue(select(), W2);
    await settle();
    expect(panel().querySelector('[data-testid="order-import-result"]')).toBeNull();
    expect(buttonNamed(panel(), 'Import').disabled).toBe(true);
    postReplies.push([200, { ...result(true), warehouseId: W2 }]);
    click(buttonNamed(panel(), 'Check file'));
    await settle();
    postReplies.push([201, { ...result(false), warehouseId: W2 }]);
    click(buttonNamed(panel(), 'Import'));
    await settle();
    expect(posts.at(-1)!.body).toEqual({ file: 'orders.csv', warehouseId: W2 });
    expect(posts.at(-1)!.key).not.toBe(first);
  });

  test('without orders.place there is no "Import from file"', async () => {
    writeSession({ ...PORTAL_SESSION, user: { ...PORTAL_SESSION.user, role: 'accountant' } });
    view = render(<PortalOrders />);
    await settle();
    expect([...view.container.querySelectorAll('button')].some((b) => b.textContent === 'Import from file')).toBe(false);
  });
});

describe('story 4-4a — the portal order Shipping section (A21)', () => {
  beforeEach(() => {
    writeSession(PORTAL_SESSION);
  });

  const row = (status: string, extra: Record<string, unknown> = {}) => ({
    id: ORDER_ID,
    status,
    source: 'manual',
    externalRef: null,
    clientOrderRef: 'SO-9',
    orderType: 'b2c',
    priority: 'normal',
    shipByDate: null,
    codAmountPaise: null,
    warehouseName: 'Whitefield',
    destinationName: 'Asha',
    destinationCity: 'Bengaluru',
    destinationPincode: '560001',
    lineCount: 1,
    createdAt: '2026-10-08T10:00:00.000Z',
    ...extra,
  });
  const shipping = (over: Record<string, unknown> = {}) => ({
    status: 'no-label-yet',
    courierName: null,
    awb: null,
    packageCount: null,
    handedOverAt: null,
    vehicleNumber: null,
    handoverCode: null,
    pickupPersonName: null,
    label: null,
    documents: [],
    handoverSheet: [],
    canRecord: true,
    ...over,
  });
  const file = (over: Record<string, unknown>) => ({
    id: 'f-1',
    kind: 'pod',
    fileName: 'SO-9-pod-1.jpg',
    contentType: 'image/jpeg',
    pageCount: null,
    uploadedAt: '2026-10-30T10:40:00.000Z',
    uploadedByYou: false,
    url: 'https://files.example/pod?sig=1',
    urlExpiresAt: '2099-01-01T00:00:00.000Z',
    ...over,
  });

  async function expand(): Promise<HTMLElement> {
    view = render(<PortalOrders />);
    await settle();
    click(buttonNamed(view.container, 'Lines'));
    await settle();
    const section = view.container.querySelector<HTMLElement>('[data-testid="portal-shipping"]');
    expect(section).not.toBeNull();
    return section!;
  }

  test('awaiting a label: the status in client words, Upload label and Send AWB only, the AWB column', async () => {
    routes = {
      '/portal/orders': [200, { items: [row('accepted')], nextCursor: null }],
      [`/portal/orders/${ORDER_ID}`]: [200, { ...row('accepted'), lines: [] }],
      [`/portal/orders/${ORDER_ID}/shipping`]: [200, shipping()],
    };
    const section = await expand();
    expect(section.textContent).toContain('No label yet — upload one, send the AWB, or your courier brings it');
    expect(section.querySelector('[data-testid="portal-open-label"]')?.textContent).toBe('Upload label');
    expect(section.querySelector('[data-testid="portal-open-awb"]')?.textContent).toBe('Send AWB only');
    expect(section.querySelector('[data-testid="portal-document-upload"]')).not.toBeNull();
    // The upload form offers no POD.
    const kinds = [...section.querySelectorAll('[data-testid="portal-document-upload"] option')].map((o) => o.getAttribute('value'));
    expect(kinds).toEqual(['invoice', 'challan', 'eway-bill', 'other']);
  });

  test('handed over: the courier, AWB and IST time; documents are explicit downloads; no label forms', async () => {
    routes = {
      '/portal/orders': [200, { items: [row('dispatched', { awb: '123456789012', courierName: 'Delhivery' })], nextCursor: null }],
      [`/portal/orders/${ORDER_ID}`]: [200, { ...row('dispatched'), lines: [] }],
      [`/portal/orders/${ORDER_ID}/shipping`]: [
        200,
        shipping({
          status: 'handed-over',
          courierName: 'Delhivery',
          awb: '123456789012',
          packageCount: 1,
          handedOverAt: '2026-10-30T10:35:00.000Z',
          vehicleNumber: 'KA01AB1234',
          handoverCode: 'HO-0001',
          pickupPersonName: 'Ravi',
          documents: [file({})],
          handoverSheet: [file({ id: 'f-2', kind: 'signed-sheet', fileName: 'HO-0001-sheet-1.jpg' })],
          canRecord: false,
        }),
      ],
    };
    const section = await expand();
    expect(section.textContent).toContain('Handed over to Delhivery — AWB 123456789012, 30 Oct 2026, 16:05 IST');
    expect(section.textContent).toContain('Handover HO-0001 · collected by Ravi · vehicle KA01AB1234');
    expect(section.querySelector('[data-testid="portal-open-label"]')).toBeNull();
    const links = [...section.querySelectorAll('a')];
    expect(links.map((a) => a.textContent)).toEqual([
      'Download Signed handover sheet · HO-0001-sheet-1.jpg',
      'Download Proof of delivery · SO-9-pod-1.jpg',
    ]);
    expect(links.every((a) => a.hasAttribute('download'))).toBe(true);
    expect(view!.container.textContent).toContain('Delhivery 123456789012');
  });

  test('Send AWB only posts the normalised AWB under a key; a bad AWB sends nothing', async () => {
    routes = {
      '/portal/orders': [200, { items: [row('accepted')], nextCursor: null }],
      [`/portal/orders/${ORDER_ID}`]: [200, { ...row('accepted'), lines: [] }],
      [`/portal/orders/${ORDER_ID}/shipping`]: [200, shipping()],
    };
    const section = await expand();
    click(section.querySelector('[data-testid="portal-open-awb"]')!);
    await settle();
    const form = section.querySelector<HTMLFormElement>('[data-testid="portal-shipment-form"]')!;
    const inputs = form.querySelectorAll<HTMLInputElement>('input');
    const set = (input: HTMLInputElement, value: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    set(inputs[0]!, '12');
    set(inputs[1]!, 'Delhivery');
    await act(async () => void form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    expect(posts).toHaveLength(0);
    expect(form.textContent).toContain('4–50');
    set(inputs[0]!, '7700-1234');
    postReplies = [[201, { shipment: { id: 's-1', orderId: ORDER_ID, kind: 'courier-label', status: 'labelled', courierName: 'Delhivery', awb: '77001234', packageCount: null, recordedAt: 'x' } }]];
    await act(async () => void form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe(`/api/v1/tenants/${TENANT_ID}/portal/orders/${ORDER_ID}/shipment/awb`);
    expect(posts[0]!.body).toEqual({ awb: '77001234', courierName: 'Delhivery' });
    expect(posts[0]!.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('a viewer without orders.place reads everything and is offered no write', async () => {
    writeSession({ ...PORTAL_SESSION, user: { ...PORTAL_SESSION.user, role: 'viewer' as never } });
    routes = {
      '/portal/orders': [200, { items: [row('accepted')], nextCursor: null }],
      [`/portal/orders/${ORDER_ID}`]: [200, { ...row('accepted'), lines: [] }],
      [`/portal/orders/${ORDER_ID}/shipping`]: [200, shipping({ status: 'label-received', courierName: 'Delhivery', awb: '123456789012', label: file({ id: 'l-1', kind: 'label', fileName: 'SO-9-label.pdf' }) })],
    };
    const section = await expand();
    expect(section.textContent).toContain('Label received — Delhivery AWB 123456789012');
    expect(section.querySelector('[data-testid="portal-open-label"]')).toBeNull();
    expect(section.querySelector('[data-testid="portal-document-upload"]')).toBeNull();
    expect(section.textContent).toContain('Your label · SO-9-label.pdf');
  });
});

describe('story 4-4a review — FB9 canRecord, FV5 the ?order= deep link', () => {
  beforeEach(() => {
    writeSession(PORTAL_SESSION);
  });
  const row = { id: ORDER_ID, status: 'accepted', source: 'manual', externalRef: null, clientOrderRef: 'SO-9', orderType: 'b2c', priority: 'normal', shipByDate: null, codAmountPaise: null, warehouseName: 'Whitefield', destinationName: 'Asha', destinationCity: 'Bengaluru', destinationPincode: '560001', lineCount: 1, createdAt: '2026-10-08T10:00:00.000Z' };
  const shippingBody = (canRecord: boolean) => ({
    status: 'awb-received', courierName: 'Sandbox Express', awb: 'SBX0001', packageCount: null, handedOverAt: null, vehicleNumber: null,
    handoverCode: null, pickupPersonName: null, label: null, documents: [], handoverSheet: [], canRecord,
  });
  const setURL = (url: string) => (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);

  test('FB9 — the server’s canRecord: false hides Replace and Send AWB (a warehouse carrier label)', async () => {
    routes = {
      '/portal/orders': [200, { items: [row], nextCursor: null }],
      [`/portal/orders/${ORDER_ID}`]: [200, { ...row, lines: [] }],
      [`/portal/orders/${ORDER_ID}/shipping`]: [200, shippingBody(false)],
    };
    view = render(<PortalOrders />);
    await settle();
    click(buttonNamed(view.container, 'Lines'));
    await settle();
    const section = view.container.querySelector('[data-testid="portal-shipping"]')!;
    expect(section.textContent).toContain('AWB received');
    expect(section.querySelector('[data-testid="portal-open-label"]')).toBeNull();
    expect(section.querySelector('[data-testid="portal-open-awb"]')).toBeNull();
  });

  test('FV5 — ?order=<id> opens that order’s Shipping; close strips the param', async () => {
    setURL(`http://localhost/portal/orders?order=${ORDER_ID}&x=1`);
    routes = {
      '/portal/orders': [200, { items: [], nextCursor: null }],
      [`/portal/orders/${ORDER_ID}`]: [200, { ...row, lines: [] }],
      [`/portal/orders/${ORDER_ID}/shipping`]: [200, shippingBody(true)],
    };
    view = render(<PortalOrders />);
    await settle();
    const link = view.container.querySelector('[data-testid="order-deep-link"]')!;
    expect(link).not.toBeNull();
    expect(link.querySelector('[data-testid="portal-shipping"]')?.textContent).toContain('AWB received');
    click(buttonNamed(link as HTMLElement, 'All orders'));
    await settle();
    expect(view.container.querySelector('[data-testid="order-deep-link"]')).toBeNull();
    expect(window.location.search).toBe('?x=1');
  });

  test('FV5 — a malformed ?order= shows the refusal and reads nothing', async () => {
    setURL('http://localhost/portal/orders?order=not-a-uuid');
    routes = { '/portal/orders': [200, { items: [], nextCursor: null }] };
    view = render(<PortalOrders />);
    await settle();
    expect(view.container.querySelector('[data-testid="order-deep-link"]')?.textContent).toContain('This order is not available');
    expect(urls.some((u) => u.includes('/shipping'))).toBe(false);
    setURL('http://localhost/portal/orders');
  });
});
