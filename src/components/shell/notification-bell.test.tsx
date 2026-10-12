import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act } from 'react';
import type { ComponentType } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';

/**
 * Story 9-2 — the header bell, driven through a stubbed `fetch` with
 * `next/navigation` mocked (`usePathname` is how the shell tells a route
 * change from a query-only change; the drill-screens precedent). Pins:
 *   1. the dot shows for `hasNew`, is aria-hidden and never a number, and
 *      the trigger's name carries it; opening the panel clears it;
 *   2. exactly ONE status read per pathname change — none for a re-render
 *      at the same pathname (a query-only change), none on a timer;
 *   3. the panel body is lazy: no list, catalog or warehouse read until it
 *      opens; opening lists the newest 10 and records the open;
 *   4. open and resolved entries render differently, each linking its source;
 *   5. Esc, an outside click and opening the palette close it; focus moves
 *      into the panel and returns to the bell.
 */

let pathname = '/';
let NotificationBell: ComponentType<{ paletteOpen: boolean }>;

beforeAll(async () => {
  const real = await import('next/navigation');
  mock.module('next/navigation', () => ({
    ...real,
    useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
    usePathname: () => pathname,
  }));
  ({ NotificationBell } = await import('./notification-bell'));
});

const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const W = '0198f7a2-1b3c-7d4e-8f90-99aabbccdd01';
const SKU_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
const SKU = { id: SKU_ID, code: 'SPICE-01', name: 'Turmeric', uom: 'kg', uomPrecision: 3 };
const WAREHOUSES = [{ id: W, code: 'MAIN', name: 'Chennai DC' }];

const OPEN_OVER_RECEIPT = {
  id: 'n-1',
  sourceType: 'over-receipt',
  sourceId: '0198f7a2-1b3c-7d4e-8f90-000000000001',
  warehouseId: W,
  summary: { grnCode: 'GRN-0042', skuId: SKU_ID, excessQty: 3 },
  raisedAt: '2026-10-06T04:30:00.000Z',
  resolvedAt: null,
  resolution: null,
};
const RESOLVED_QC = {
  id: 'n-2',
  sourceType: 'qc-hold',
  sourceId: '0198f7a2-1b3c-7d4e-8f90-000000000002',
  warehouseId: W,
  summary: { skuId: SKU_ID, reason: 'Seal broken' },
  raisedAt: '2026-10-06T04:00:00.000Z',
  resolvedAt: '2026-10-06T04:20:00.000Z',
  resolution: 'released',
};
const OPEN_BATCH = {
  id: 'n-3',
  sourceType: 'batch-alert',
  sourceId: '0198f7a2-1b3c-7d4e-8f90-000000000003',
  warehouseId: W,
  summary: { kind: 'aged', skuId: SKU_ID, batchCode: 'LOT-7', ageDays: 40 },
  raisedAt: '2026-10-06T03:00:00.000Z',
  resolvedAt: null,
  resolution: null,
};
const OPEN_CHANNEL = {
  id: 'n-4',
  sourceType: 'channel-sync',
  sourceId: '0198f7a2-1b3c-7d4e-8f90-000000000004',
  warehouseId: null,
  summary: { connectionId: '0198f7a2-1b3c-7d4e-8f90-00000000c0de' },
  raisedAt: '2026-10-06T02:00:00.000Z',
  resolvedAt: null,
  resolution: null,
};

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly params: URLSearchParams;
}

let requests: Recorded[] = [];
let hasNew = true;
let items: unknown[] = [OPEN_OVER_RECEIPT, RESOLVED_QC, OPEN_BATCH, OPEN_CHANNEL];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubApi(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    requests.push({ method, pathname: url.pathname, params: url.searchParams });
    const p = url.pathname;
    if (method === 'POST' && p === `/api/v1/tenants/${T}/notifications/opened`) return json(200, { hasNew: false });
    if (method !== 'GET') return json(404, { code: 'not-found', title: 'Unrouted', status: 404 });
    if (p === `/api/v1/tenants/${T}/notifications/status`) return json(200, { hasNew });
    if (p === `/api/v1/tenants/${T}/notifications`) return json(200, { items, nextCursor: null });
    if (p === `/api/v1/tenants/${T}/catalog/skus`) return json(200, { items: [SKU], nextCursor: null });
    if (p === `/api/v1/tenants/${T}/warehouses`) return json(200, { items: WAREHOUSES, nextCursor: null });
    return json(404, { code: 'not-found', title: 'Unrouted', status: 404 });
  }) as typeof fetch);
}

function session(): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: T, name: 'Priya Spices', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role: 'owner', status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  } as StoredSession;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const calls = (method: string, suffix: string) => requests.filter((r) => r.method === method && r.pathname.endsWith(suffix));

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  hasNew = true;
  items = [OPEN_OVER_RECEIPT, RESOLVED_QC, OPEN_BATCH, OPEN_CHANNEL];
  pathname = '/';
  stubApi();
  writeSession(session());
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
});

async function mount(paletteOpen = false): Promise<Rendered> {
  view = render(<NotificationBell paletteOpen={paletteOpen} />);
  await settle();
  return view;
}

const details = () => view!.container.querySelector('details')!;
const trigger = () => view!.container.querySelector('summary')!;
const dot = () => view!.container.querySelector('[data-notification-dot]');

async function openPanel(): Promise<void> {
  await act(async () => {
    trigger().click();
  });
  await settle();
}

describe('the bell', () => {
  test('the dot shows for hasNew — aria-hidden, never a number; the trigger is a button whose name carries it', async () => {
    await mount();
    expect(trigger().getAttribute('role')).toBe('button');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().getAttribute('aria-label')).toBe('Notifications, new');
    expect(dot()).not.toBeNull();
    expect(dot()!.getAttribute('aria-hidden')).toBe('true');
    expect(trigger().textContent ?? '').not.toMatch(/\d/);

    view!.unmount();
    view = undefined;
    hasNew = false;
    await mount();
    expect(trigger().getAttribute('aria-label')).toBe('Notifications');
    expect(dot()).toBeNull();
  });

  test('exactly one status read per pathname change — none for the same pathname (query-only), none on a timer', async () => {
    await mount();
    expect(calls('GET', '/notifications/status')).toHaveLength(1);
    // A re-render at the same pathname (a query-only navigation keeps it).
    view!.rerender(<NotificationBell paletteOpen={false} />);
    await settle();
    expect(calls('GET', '/notifications/status')).toHaveLength(1);
    // A route change: one more.
    pathname = '/inbound';
    view!.rerender(<NotificationBell paletteOpen={false} />);
    await settle();
    expect(calls('GET', '/notifications/status')).toHaveLength(2);
    // Time passing reads nothing (no polling).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    await settle();
    expect(calls('GET', '/notifications/status')).toHaveLength(2);
  });

  test('the panel body is lazy: no list, catalog or warehouse read before it opens; opening lists 10, records the open and clears the dot', async () => {
    await mount();
    expect(calls('GET', '/notifications')).toHaveLength(0);
    expect(calls('GET', '/catalog/skus')).toHaveLength(0);
    expect(calls('GET', '/warehouses')).toHaveLength(0);
    expect(calls('POST', '/notifications/opened')).toHaveLength(0);
    expect(view!.container.querySelector('[role="region"]')).toBeNull();

    await openPanel();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    const lists = calls('GET', '/notifications');
    expect(lists).toHaveLength(1);
    expect([...lists[0]!.params.entries()]).toEqual([['limit', '10']]);
    expect(calls('POST', '/notifications/opened')).toHaveLength(1);
    // The opened route takes no Idempotency-Key (the documented exception).
    expect(calls('GET', '/catalog/skus')).toHaveLength(1);
    expect(dot()).toBeNull();
    expect(trigger().getAttribute('aria-label')).toBe('Notifications');
    // "See all" goes to the page.
    const seeAll = [...view!.container.querySelectorAll('a')].find((a) => a.textContent === 'See all')!;
    expect(seeAll.getAttribute('href')).toBe('/notifications');
  });

  test('open entries are amber and say Open; resolved ones are muted with "Resolved · …"; each links its source', async () => {
    await mount();
    await openPanel();
    const entry = (sourceType: string) => view!.container.querySelector(`a[data-notification="${sourceType}"]`)!;

    const overReceipt = entry('over-receipt');
    expect(overReceipt.getAttribute('data-state')).toBe('open');
    expect(overReceipt.className).toContain('border-(--warning)');
    expect(overReceipt.textContent).toContain('Over-receipt awaiting approval');
    expect(overReceipt.textContent).toContain('GRN-0042 · SPICE-01 · 3.000 kg over · MAIN Chennai DC');
    expect(overReceipt.textContent).toContain('Open');
    expect(overReceipt.getAttribute('href')).toBe(`/conflicts?list=over-receipts&warehouseId=${W}&status=pending`);
    expect(overReceipt.querySelector('time')!.getAttribute('title')).toBe('06 Oct 2026, 10:00 IST');

    const qc = entry('qc-hold');
    expect(qc.getAttribute('data-state')).toBe('resolved');
    expect(qc.className).not.toContain('border-(--warning)');
    expect(qc.textContent).toContain('Resolved · released');
    expect(qc.getAttribute('href')).toBe('/inbound');

    expect(entry('batch-alert').getAttribute('href')).toBe(`/replenishment?list=batch-alerts&warehouseId=${W}&kind=aged`);
    expect(entry('channel-sync').getAttribute('href')).toBe('/channels');
    // No action button anywhere in the panel.
    expect(view!.container.querySelectorAll('[role="region"] button')).toHaveLength(0);
  });

  test('an empty list is the API’s empty answer', async () => {
    items = [];
    hasNew = false;
    await mount();
    await openPanel();
    expect(view!.container.textContent).toContain('Nothing needs your attention.');
  });

  test('focus moves into the panel on open; Esc closes it and returns focus to the bell', async () => {
    await mount();
    await openPanel();
    const region = view!.container.querySelector('[role="region"]')!;
    expect(document.activeElement).toBe(region);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await settle();
    expect(details().open).toBe(false);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(view!.container.querySelector('[role="region"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  test('an outside click closes it; following a link closes it', async () => {
    await mount();
    await openPanel();
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    await settle();
    expect(details().open).toBe(false);

    await openPanel();
    const link = view!.container.querySelector('a[data-notification="qc-hold"]') as HTMLAnchorElement;
    await act(async () => {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(details().open).toBe(false);
  });

  test('opening the palette closes it; Esc is the palette’s while the palette is open', async () => {
    await mount();
    await openPanel();
    view!.rerender(<NotificationBell paletteOpen={true} />);
    await settle();
    expect(details().open).toBe(false);

    // With the palette open, the bell's Esc handler stands down.
    await act(async () => {
      details().open = true;
    });
    await settle();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await settle();
    expect(details().open).toBe(true);
  });
});
