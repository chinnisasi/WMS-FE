import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { Outbound } from './outbound';

/**
 * The Outbound PAGE (the shell `outbound.tsx` owns).
 *
 * The surface tests mount each surface directly with resolved props, so the
 * page-level wiring — the three mounts, each keyed `...-${warehouseId}` —
 * never executes under them: deleting a surface or its key would ship green.
 * This file drives the real shell through a stubbed `fetch` and pins that
 *   1. all three surfaces render on one page,
 *   2. a row expanded on the pack surface collapses when the warehouse
 *      switches — the key remount resets the expanded panel (and with it the
 *      filter and any pending confirmation, which live in the same subtree).
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WH_MAIN = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';
const WH_SOUTH = '0198f7a2-1b3c-7d4e-8f90-99aabbccdfee';

const NOW = new Date('2026-09-16T17:30:00+05:30');

function session(role: StoredSession['user']['role']): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Priya Spices', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: NOW.getTime() + 15 * 60_000,
  };
}

const WAREHOUSES = [
  { id: WH_MAIN, code: 'MAIN', name: 'Chennai DC' },
  { id: WH_SOUTH, code: 'SOUTH', name: 'Coimbatore DC' },
];

const SKU_ROWS = [
  { id: 'sku-1', code: 'SPICE-01', name: 'Turmeric', uom: 'kg', uomPrecision: 3 },
];

function orderRow(id: string, warehouseId: string, status: string): Record<string, unknown> {
  return {
    id,
    tenantId: TENANT_ID,
    warehouseId,
    status,
    source: 'manual',
    integrationId: null,
    externalEventId: null,
    destination: null,
    createdAt: '2026-09-16T10:00:00.000Z',
    updatedAt: '2026-09-16T10:00:00.000Z',
  };
}

function orderDetail(id: string, warehouseId: string): unknown {
  return {
    ...orderRow(id, warehouseId, 'accepted'),
    lines: [
      {
        id: 'ol-1',
        orderId: id,
        skuId: 'sku-1',
        qty: 4,
        reservedQty: 4,
        shortfallQty: 0,
        status: 'open',
        reservationId: 'r-1',
        reservationState: 'committed',
        parentLineId: null,
        createdAt: '2026-09-16T10:00:00.000Z',
      },
    ],
  };
}

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly search: string;
}

let requests: Recorded[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A router over everything the PAGE reads: the warehouse list, then, for
 * whichever warehouse is active, the three surfaces' reads. Anything
 * unrouted 404s rather than looking like an empty page.
 */
function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();
    requests.push({ method, pathname, search: url.search });

    if (method === 'GET' && pathname === `/api/v1/tenants/${TENANT_ID}/warehouses`) {
      return json(200, { items: WAREHOUSES, nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith('/outbound/orders')) {
      // /api/v1/tenants/{t}/warehouses/{id}/outbound/orders
      const warehouseId = pathname.split('/')[6];
      const items = warehouseId === WH_MAIN ? [orderRow('order-1', WH_MAIN, 'accepted')] : [];
      return json(200, { items, nextCursor: null });
    }
    if (method === 'GET' && /\/outbound\/orders\/[^/]+$/.test(pathname)) {
      return json(200, { order: orderDetail('order-1', WH_MAIN) });
    }
    if (method === 'GET' && pathname.endsWith('/outbound/waves')) {
      return json(200, { items: [], nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith('/outbound/wave-policies')) {
      return json(200, { items: [], nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith('/catalog/skus')) {
      return json(200, { items: SKU_ROWS, nextCursor: null });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  stubRouter();
  stubGlobal('Date', pinnedDate());
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
});

/** `Date`, with `new Date()` and `Date.now()` pinned to NOW. */
function pinnedDate(): DateConstructor {
  const Real = Date;
  const fixed = NOW.getTime();
  const Pinned = function (this: unknown, ...args: unknown[]) {
    if (args.length === 0) return new Real(fixed);
    return new (Real as unknown as new (...a: unknown[]) => Date)(...args);
  } as unknown as DateConstructor;
  Object.defineProperty(Pinned, 'prototype', { value: Real.prototype });
  Pinned.now = () => fixed;
  Pinned.parse = Real.parse;
  Pinned.UTC = Real.UTC;
  return Pinned;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function text(rendered: Rendered): string {
  return rendered.container.textContent ?? '';
}

function buttons(rendered: Rendered): HTMLButtonElement[] {
  return [...rendered.container.querySelectorAll('button')] as HTMLButtonElement[];
}

/**
 * The PACK surface's expand toggle for the order — the LAST toggle naming the
 * id, since the orders surface's own row toggle comes first in the DOM and
 * the pack surface mounts beneath it.
 */
async function pressExpand(orderId: string): Promise<void> {
  const matches = buttons(view!).filter((b) => b.textContent?.includes(orderId));
  const button = matches[matches.length - 1];
  if (button === undefined) throw new Error(`No expand toggle for "${orderId}"`);
  await act(async () => {
    button.click();
  });
  await settle();
}

/** The page's warehouse picker — the FIRST select on the page. */
async function pickWarehouse(id: string): Promise<void> {
  const select = view!.container.querySelector('select') as HTMLSelectElement;
  if (select === null) throw new Error('No warehouse picker select on the page');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(select, id);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}

const listReads = (warehouseId: string) =>
  requests.filter(
    (r) => r.method === 'GET' && r.pathname === `/api/v1/tenants/${TENANT_ID}/warehouses/${warehouseId}/outbound/orders`,
  );

describe('the Outbound page', () => {
  test('all three surfaces render, and a warehouse switch remounts the pack surface', async () => {
    writeSession(session('operator'));
    view = render(<Outbound />);
    await settle();

    const body = text(view);
    expect(body).toContain('Orders');
    expect(body).toContain('Waves');
    expect(body).toContain('Pack & Dispatch');
    // The page reads the ACTIVE warehouse's orders (the orders and waves
    // surfaces each hold their own instance of the read, so more than one
    // request is fine — the point is which warehouse they name).
    expect(listReads(WH_MAIN).length).toBeGreaterThan(0);
    expect(listReads(WH_SOUTH)).toHaveLength(0);

    // Expand a row on the pack surface — its bench panel fetches the detail.
    await pressExpand('order-1');
    expect(text(view)).toContain('Pack this order');

    // Switching the warehouse remounts every surface (each is keyed on the
    // warehouse): the expanded panel — and with it the filter and any
    // pending confirmation — is reset, and the pack surface refetches
    // against the new warehouse.
    await pickWarehouse(WH_SOUTH);
    const picker = view!.container.querySelector('select') as HTMLSelectElement;
    expect(picker.value).toBe(WH_SOUTH);
    expect(text(view)).not.toContain('Pack this order');
    expect(text(view)).toContain('Pack & Dispatch');
    expect(listReads(WH_SOUTH).length).toBeGreaterThan(0);
  });
});
