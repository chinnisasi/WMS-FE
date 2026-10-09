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
/** pathname suffix (optionally `?cursor=<c>` for a later page) → [status, body] */
let routes: Record<string, [number, unknown]> = {};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname, search, searchParams } = new URL(request.url);
    requests.push(`${request.method.toUpperCase()} ${pathname}`);
    urls.push(`${pathname}${search}`);
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
