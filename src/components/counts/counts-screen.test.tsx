import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { writeActiveClientId } from '../../lib/active-client';
import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import type { CountsTab } from '../../lib/page-tabs';
import type { UserRole } from '../../lib/users';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { writeActiveWarehouseId } from '../../lib/warehouses';
import { CountsScreen } from './counts-screen';

/**
 * Story 3-5a — the Counts surface (`/moves/counts`), driven through a stubbed
 * global `fetch` so the wrappers and gates under test are the ones that ship:
 *   1. mounting sends reads only, the list carries no clientId (exempt) and
 *      says "All clients" while a client is active;
 *   2. a row's detail is read on expand only, shows expected beside counted,
 *      and the variance-queue link appears only with `variances.resolve`;
 *   3. an operator gets no New count and no schedule controls;
 *   4. the zone picker never offers a system zone; the bin list drops
 *      system and retired bins; the create POSTs one arm with a per-draft
 *      key (a retry reuses it, an edit mints a new one) and shows created
 *      and skipped from the response;
 *   5. Load more appends the next keyset page;
 *   6. the schedule sets (PUT) and removes (DELETE), each with its own key.
 */

const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WH = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';
const ZA = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
const ZS = '0198f7a2-1b3c-7d4e-8f90-0000000000a2';
const TASK1 = '0198f7a2-1b3c-7d4e-8f90-0000000000c1';
const TASK2 = '0198f7a2-1b3c-7d4e-8f90-0000000000c2';
const TASK3 = '0198f7a2-1b3c-7d4e-8f90-0000000000c3';
const SKU = '0198f7a2-1b3c-7d4e-8f90-0000000000d1';

function session(role: UserRole): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: T, name: 'Priya Logistics', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  } as StoredSession;
}

function task(id: string, binCode: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    warehouseId: WH,
    binId: `bin-${binCode}`,
    binCode,
    status: 'completed',
    origin: 'on_demand',
    createdBy: 'u-1',
    createdAt: '2026-10-21T04:30:00.000Z',
    completedBy: 'u-2',
    completedAt: '2026-10-21T06:00:05.000Z',
    lineCount: 1,
    varianceCount: 1,
    openVarianceCount: 1,
    stockTakeId: null,
    ...patch,
  };
}

function bin(id: string, code: string, zoneId: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, tenantId: T, warehouseId: WH, zoneId, code, capacity: 100, lengthMm: null, widthMm: null, heightMm: null,
    maxWeightGrams: null, storageClass: 'ambient', dedicatedClientId: null, type: 'shelf', blocked: false,
    retiredAt: null, retiredBy: null, systemOwned: false, createdAt: '2026-10-01T00:00:00.000Z', ...patch,
  };
}

let firstPage: { items: Record<string, unknown>[]; nextCursor: string | null };
let secondPage: { items: Record<string, unknown>[]; nextCursor: string | null };
let policies: Record<string, unknown>[];
let createAnswers: ({ kind: 'ok' } | { kind: 'drop' })[] = [];
let requests: { method: string; url: URL; body: unknown; key: string | null }[] = [];
let zonesFail = 0;
let bigZone = false;
let pendingDetailEmpty = false;
const ZB = '0198f7a2-1b3c-7d4e-8f90-0000000000a3';

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
    if (pathname === `${base}/warehouses`) return json(200, { items: [{ id: WH, code: 'BLR', name: 'Bengaluru DC' }], nextCursor: null });
    if (pathname === `${base}/clients`) {
      return json(200, {
        items: [
          { id: 'c-self', code: 'self', name: 'Priya Logistics', status: 'active', systemOwned: true },
          { id: 'c-glow', code: 'GLOW', name: 'GlowCo', status: 'active', systemOwned: false },
        ],
      });
    }
    if (pathname === `${base}/catalog/skus`) {
      return json(200, { items: [{ id: SKU, code: 'SKU-1', name: 'Soap', uom: 'each', uomPrecision: 0 }], nextCursor: null });
    }
    if (pathname === `${base}/users`) {
      return json(200, { items: [{ id: 'u-9', email: 'ravi@example.com', role: 'ops_manager', status: 'active', clientId: null, createdAt: '2026-10-01T00:00:00.000Z' }], nextCursor: null });
    }
    if (pathname === `${base}/warehouses/${WH}/zones/${ZB}/bins`) {
      return json(200, { items: Array.from({ length: 501 }, (_, i) => bin(`big-${i}`, `B-${i}`, ZB)), nextCursor: null });
    }
    if (pathname === `${base}/warehouses/${WH}/zones`) {
      if (zonesFail > 0) {
        zonesFail -= 1;
        return json(500, { code: 'internal', title: 'Zones unavailable', detail: 'Zones unavailable', status: 500 });
      }
      return json(200, {
        items: [
          ...(bigZone ? [{ id: ZB, tenantId: T, warehouseId: WH, code: 'B', name: 'Bulk', createdAt: '2026-10-01T00:00:00.000Z' }] : []),
          { id: ZA, tenantId: T, warehouseId: WH, code: 'A', name: 'Aisle A', createdAt: '2026-10-01T00:00:00.000Z' },
          { id: ZS, tenantId: T, warehouseId: WH, code: 'IN-TRANSIT', name: 'In transit', createdAt: '2026-10-01T00:00:00.000Z' },
        ],
        nextCursor: null,
      });
    }
    if (pathname === `${base}/warehouses/${WH}/zones/${ZA}/bins`) {
      return json(200, {
        items: [bin('b1', 'A-01', ZA), bin('b2', 'A-02', ZA), bin('b3', 'A-03', ZA, { retiredAt: '2026-10-02T00:00:00.000Z' })],
        nextCursor: null,
      });
    }
    if (pathname === `${base}/warehouses/${WH}/zones/${ZS}/bins`) {
      return json(200, { items: [bin('s1', 'IN-TRANSIT', ZS, { systemOwned: true })], nextCursor: null });
    }
    if (pathname === `${base}/movements/counts` && method === 'GET') {
      return json(200, url.searchParams.has('cursor') ? secondPage : firstPage);
    }
    if (pathname === `${base}/movements/counts` && method === 'POST') {
      const answer = createAnswers.shift() ?? { kind: 'ok' };
      if (answer.kind === 'drop') throw new TypeError('Failed to fetch');
      return json(201, {
        created: [{ taskId: 'new-1', binId: 'b2', binCode: 'A-02', lineCount: 0 }],
        skipped: [{ binId: 'b1', binCode: 'A-01', reason: 'count-task-open' }],
      });
    }
    if (pathname === `${base}/movements/counts/${TASK2}` && method === 'GET' && pendingDetailEmpty) {
      return json(200, {
        task: { ...task(TASK2, 'A-02', { status: 'pending', completedAt: null, completedBy: null }), binStateEpoch: null },
        lines: [],
        variances: [],
        recountTaskId: null,
      });
    }
    if (pathname.startsWith(`${base}/movements/counts/`) && method === 'GET') {
      return json(200, {
        task: { ...task(TASK1, 'A-01'), binStateEpoch: 3 },
        lines: [{ skuId: SKU, skuCode: 'SKU-1', skuName: 'Soap', expectedQuantity: 5, countedQuantity: 7 }],
        variances: [{ id: 'v1', skuId: SKU, expectedQuantity: 5, countedQuantity: 7, delta: 2, epochConflict: false, status: 'open', recountTaskId: null }],
        recountTaskId: null,
      });
    }
    // Story 3-5b — the stock takes and the cancel.
    if (pathname === `${base}/movements/stock-takes` && method === 'GET') {
      return json(200, url.searchParams.has('cursor') ? takesSecondPage : takesFirstPage);
    }
    if (pathname === `${base}/movements/stock-takes/${TAKE}` && method === 'GET') return json(200, takeDetail);
    if (pathname === `${base}/movements/stock-takes/${TAKE}/variances`) {
      return json(200, url.searchParams.has('cursor') ? { items: varianceRows.slice(1), nextCursor: null } : { items: varianceRows.slice(0, 1), nextCursor: varianceRows.length > 1 ? 'v-2' : null });
    }
    if (pathname === `${base}/movements/stock-takes/${TAKE}/close` && method === 'POST') {
      return json(200, { stockTake: { ...TAKE_SUMMARY, status: 'closed' }, postedCount: 1, unposted: [] });
    }
    if (pathname === `${base}/movements/stock-takes/${TAKE}/recount` && method === 'POST') {
      const binIds = (body as { binIds: string[] }).binIds;
      return json(200, { stockTake: TAKE_SUMMARY, recounts: binIds.map((binId) => ({ binId, binCode: binId === 'b1' ? 'A-01' : 'A-02', taskId: `r-${binId}` })), recountedVarianceCount: 1 });
    }
    if (pathname === `${base}/movements/stock-takes/${TAKE}/abandon` && method === 'POST') {
      return json(200, { stockTake: { ...TAKE_SUMMARY, status: 'abandoned' }, cancelledTaskCount: 2, releasedTaskCount: 1 });
    }
    if (pathname === `${base}/movements/stock-takes/${TAKE}/report`) {
      return new Response('status,zone_code\nprovisional,A\n', { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8' } });
    }
    if (pathname === `${base}/movements/warehouses/${WH}/stock-takes` && method === 'POST') {
      return json(201, { stockTake: TAKE_SUMMARY, adoptedTaskCount: 0, createdTaskCount: 2, supersededVarianceCount: 0 });
    }
    if (pathname === `${base}/movements/counts/${TASK2}/cancel` && method === 'POST') {
      if (cancelRefusal !== null) return json(409, { code: cancelRefusal, title: 'Refused', detail: 'Refused', status: 409 });
      return json(200, { countTask: { id: TASK2, status: 'cancelled', warehouseId: WH, binId: 'bin-A-02', cancelledBy: 'u-1', cancelledAt: '2026-10-28T08:00:00.000Z' } });
    }
    const policiesPath = `${base}/movements/warehouses/${WH}/count-policies`;
    if (pathname === policiesPath && method === 'GET') return json(200, { policies });
    if (pathname === policiesPath && method === 'PUT') {
      policies = [...policies.filter((p) => p.abcClass !== 'b'), { abcClass: 'b', intervalDays: 7 }];
      return json(200, { policies });
    }
    if (pathname.startsWith(`${policiesPath}/`) && method === 'DELETE') {
      const abcClass = pathname.slice(policiesPath.length + 1);
      policies = policies.filter((p) => p.abcClass !== abcClass);
      return json(200, { policies });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

const TAKE = '0198f7a2-1b3c-7d4e-8f90-0000000000e1';
const TAKE_SUMMARY = {
  id: TAKE, warehouseId: WH, zoneIds: [ZA], status: 'counting', note: null, binCount: 2, startedBy: 'u-1', startedAt: '2026-10-28T04:30:00.000Z',
  approvedBy: null, approvedAt: null, closedBy: null, closedAt: null, abandonedBy: null, abandonedAt: null, postedCount: null, unpostedCount: null,
};
const DIGEST = 'a'.repeat(64);
let takeDetail: Record<string, unknown>;
let takesFirstPage: { items: Record<string, unknown>[]; nextCursor: string | null };
let takesSecondPage: { items: Record<string, unknown>[]; nextCursor: string | null };
let varianceRows: Record<string, unknown>[];
let cancelRefusal: string | null = null;

function variance(id: string, binId: string, binCode: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, taskId: `t-${id}`, binId, binCode, zoneCode: 'A', skuId: SKU, skuCode: 'SKU-1', skuName: 'Soap', clientId: 'c-self',
    expectedQuantity: 5, countedQuantity: 9, delta: 4, status: 'open', thresholdQuantity: 3, overThreshold: true, epochConflict: false,
    latest: true, needsLotCount: false, unpostedCode: null, ...patch,
  };
}

let view: Rendered | undefined;

beforeEach(() => {
  firstPage = { items: [task(TASK1, 'A-01'), task(TASK2, 'A-02', { status: 'pending', origin: 'scheduled', createdBy: null, completedAt: null, completedBy: null, varianceCount: 0, openVarianceCount: 0 })], nextCursor: 'c-2' };
  secondPage = { items: [task(TASK3, 'A-03', { origin: 'recount', varianceCount: 0, openVarianceCount: 0 })], nextCursor: null };
  policies = [{ abcClass: 'a', intervalDays: 30 }];
  createAnswers = [];
  requests = [];
  zonesFail = 0;
  bigZone = false;
  pendingDetailEmpty = false;
  takeDetail = {
    stockTake: TAKE_SUMMARY,
    totals: { bins: 2, counted: 2, pending: 0, recountPending: 0, withVariance: 1, openVariances: 1, overThreshold: 1, deviceWrites: 0 },
    zones: [{ zoneId: ZA, zoneCode: 'A', bins: 2, counted: 2, pending: 0, withVariance: 1 }],
    recountRequiredBins: [],
    recountRequiredCount: 0,
    openVarianceDigest: DIGEST,
  };
  takesFirstPage = { items: [{ stockTake: TAKE_SUMMARY, progress: { bins: 2, counted: 2, pending: 0 } }], nextCursor: null };
  takesSecondPage = { items: [], nextCursor: null };
  varianceRows = [
    variance('tv1', 'b1', 'A-01'),
    variance('tv2', 'b2', 'A-02', { overThreshold: false, delta: 1, countedQuantity: 6, epochConflict: true }),
    variance('tv-old', 'b2', 'A-02', { latest: false, status: 'recounted', delta: 9 }),
  ];
  cancelRefusal = null;
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

function setSelect(select: HTMLSelectElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function button(container: ParentNode, label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === label);
}

async function press(target: HTMLElement | undefined | null): Promise<void> {
  expect(target).toBeTruthy();
  await act(async () => {
    target!.click();
  });
  await settle();
}

async function mount(role: UserRole, initialTab: CountsTab | null = null, activeClient: string | null = null, initialCreating = false): Promise<void> {
  writeSession(session(role));
  writeActiveWarehouseId(T, WH);
  if (activeClient !== null) writeActiveClientId(T, 'u-1', activeClient);
  view = render(<CountsScreen initialTab={initialTab} initialCreating={initialCreating} />);
  await settle();
}

const root = () => view!.container;
const listReads = () => requests.filter((r) => r.method === 'GET' && r.url.pathname.endsWith('/movements/counts'));
const writes = () => requests.filter((r) => r.method !== 'GET');
const row = (code: string) =>
  [...root().querySelectorAll('[data-testid="count-tasks"] tbody tr')].find((tr) => tr.querySelector('td')?.textContent === code) as HTMLElement | undefined;

describe('the Tasks tab', () => {
  test('mount reads only; the list has no clientId and says All clients under an active client', async () => {
    await mount('owner', null, 'c-glow');
    expect(writes()).toEqual([]);
    expect(listReads()).toHaveLength(1);
    expect(Object.fromEntries(listReads()[0]!.url.searchParams)).toEqual({ warehouseId: WH, limit: '50' });
    expect(root().querySelector('[data-testid="all-clients-note"]')).not.toBeNull();
    expect(row('A-01')!.textContent).toContain('On demand');
    expect(row('A-01')!.textContent).toContain('1 (1 open)');
    expect(row('A-01')!.textContent).toContain('21 Oct 2026, 11:30:05'); // completed, IST
    expect(row('A-02')!.textContent).toContain('System');
    expect(row('A-02')!.textContent).toContain('Pending');
    // No detail is read until a row is expanded.
    expect(requests.some((r) => /\/movements\/counts\/[^/]+$/.test(r.url.pathname))).toBe(false);
  });

  test('the filters ride the read as query params', async () => {
    await mount('owner');
    setSelect(root().querySelector<HTMLSelectElement>('select[aria-label="Status"]')!, 'completed');
    await settle();
    setSelect(root().querySelector<HTMLSelectElement>('select[aria-label="Origin"]')!, 'recount');
    await settle();
    expect(Object.fromEntries(listReads().at(-1)!.url.searchParams)).toEqual({ warehouseId: WH, status: 'completed', origin: 'recount', limit: '50' });
  });

  test('Load more appends the next keyset page', async () => {
    await mount('owner');
    expect(row('A-03')).toBeUndefined();
    await press(button(root(), 'Load more'));
    expect(listReads().at(-1)!.url.searchParams.get('cursor')).toBe('c-2');
    expect(row('A-01')).toBeDefined();
    expect(row('A-03')).toBeDefined();
    expect(button(root(), 'Load more')).toBeUndefined();
  });

  test('expanding a row reads the detail: expected beside counted, the variance, the queue link for a resolver', async () => {
    await mount('owner');
    await press(button(row('A-01')!, 'Details'));
    const detail = root().querySelector<HTMLElement>(`[data-testid="count-detail-${TASK1}"]`)!;
    expect(detail.textContent).toContain('SKU-1 · Soap');
    expect(detail.textContent).toContain('5 each');
    expect(detail.textContent).toContain('7 each');
    expect(detail.textContent).toContain('SKU-1: +2 each (Open)');
    const link = detail.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/conflicts?queue=variances');
    expect(link.textContent).toBe('Open the variance queue (all variances, not only this count)');
  });

  test('the planner column names the user from the user list; the viewer reads "You", a system task "System"', async () => {
    firstPage = { items: [task(TASK1, 'A-01', { createdBy: 'u-9' }), task(TASK2, 'A-02', { createdBy: 'u-1' }), task(TASK3, 'A-03', { createdBy: null })], nextCursor: null };
    await mount('owner');
    expect(row('A-01')!.textContent).toContain('ravi@example.com');
    expect(row('A-02')!.textContent).toContain('You');
    expect(row('A-03')!.textContent).toContain('System');
  });

  test('a pending task with no lines says the operator records what they find', async () => {
    pendingDetailEmpty = true;
    await mount('owner');
    await press(button(row('A-02')!, 'Details'));
    const detail = root().querySelector<HTMLElement>(`[data-testid="count-detail-${TASK2}"]`)!;
    expect(detail.textContent).toContain('Nothing is listed yet — the operator records what they find');
  });

  test('a counts change keeps the pages already loaded (re-read page by page), never collapsing to page 1', async () => {
    await mount('owner');
    await press(button(root(), 'Load more'));
    expect(row('A-03')).toBeDefined();
    const before = listReads().length;
    await act(async () => {
      window.dispatchEvent(new Event('wms-counts-changed'));
    });
    await settle();
    const reread = listReads().slice(before);
    expect(reread.map((r) => r.url.searchParams.get('cursor'))).toEqual([null, 'c-2']);
    expect(row('A-01')).toBeDefined();
    expect(row('A-03')).toBeDefined();
  });

  test('an operator reads the list but gets no New count and no Details (the detail shows expected quantities — a gated read)', async () => {
    await mount('operator');
    expect(button(root(), 'New count')).toBeUndefined();
    expect(row('A-01')).toBeDefined();
    expect(button(row('A-01')!, 'Details')).toBeUndefined();
  });

  test('an ops manager (counts.manage) reads the detail', async () => {
    await mount('ops_manager');
    await press(button(row('A-01')!, 'Details'));
    const detail = root().querySelector<HTMLElement>(`[data-testid="count-detail-${TASK1}"]`)!;
    expect(detail.textContent).toContain('7 each');
  });
});

describe('New count', () => {
  test('the zone picker never offers a system zone; the POST carries the zone with a per-draft key reused on retry', async () => {
    await mount('ops_manager');
    await press(button(root(), 'New count'));
    const zone = root().querySelector<HTMLSelectElement>('select[aria-label="Zone"]')!;
    const offered = [...zone.options].map((o) => o.textContent);
    expect(offered).toEqual(['Choose a zone…', 'A Aisle A (2 bins)']);
    setSelect(zone, ZA);
    createAnswers = [{ kind: 'drop' }];
    const form = root().querySelector<HTMLFormElement>('form[aria-label="New count"]')!;
    await press(button(form, 'Create counts'));
    expect(form.textContent).toContain('Not created');
    await press(button(form, 'Create counts'));
    const posts = writes().filter((r) => r.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[0]!.body).toEqual({ warehouseId: WH, zoneId: ZA });
    expect(posts[1]!.key).toBe(posts[0]!.key);
    expect(form.textContent).toContain('1 count created');
    expect(form.textContent).toContain('Skipped 1: A-01 (already has an open count).');
    expect(form.textContent).toContain('no notification is sent');
  });

  test('story UI-2 (A9): two submits in one tick send ONE create — the keyed-submit in-flight guard', async () => {
    await mount('ops_manager');
    await press(button(root(), 'New count'));
    setSelect(root().querySelector<HTMLSelectElement>('select[aria-label="Zone"]')!, ZA);
    const form = root().querySelector<HTMLFormElement>('form[aria-label="New count"]')!;
    await act(async () => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await settle();
    expect(writes().filter((r) => r.method === 'POST')).toHaveLength(1);
  });

  test('story UI-2: ⌘K "New count" opens the form on arrival for a manager, never for an operator', async () => {
    await mount('ops_manager', null, null, true);
    expect(root().querySelector('form[aria-label="New count"]')).not.toBeNull();
    view?.unmount();
    await mount('operator', null, null, true);
    expect(root().querySelector('form[aria-label="New count"]')).toBeNull();
  });

  test('a zone with more than 500 countable bins is offered disabled, with the reason', async () => {
    bigZone = true;
    await mount('owner');
    await press(button(root(), 'New count'));
    const zone = root().querySelector<HTMLSelectElement>('select[aria-label="Zone"]')!;
    const big = [...zone.options].find((o) => o.value === ZB)!;
    expect(big.disabled).toBe(true);
    expect(big.textContent).toContain('501 bins — too many to count whole');
    expect([...zone.options].find((o) => o.value === ZA)!.disabled).toBe(false);
    expect(root().textContent).toContain('Zones with more than 500 countable bins cannot be counted whole — choose their bins instead.');
  });

  test('a failed zones read shows the failure and Retry, which reads again', async () => {
    // The bins walk reads the zones too, so both reads fail here; the zone
    // picker's own failure must show (before 3-5a review it rendered nothing).
    zonesFail = 2;
    await mount('owner');
    await press(button(root(), 'New count'));
    const form = root().querySelector<HTMLFormElement>('form[aria-label="New count"]')!;
    expect(form.textContent).toContain('Zones not loaded');
    expect(form.querySelector('select[aria-label="Zone"]')).toBeNull();
    for (const retry of [...form.querySelectorAll('button')].filter((b) => b.textContent === 'Retry')) await press(retry);
    expect(form.textContent).not.toContain('Zones not loaded');
    expect(form.querySelector('select[aria-label="Zone"]')).not.toBeNull();
  });

  test('chosen bins: system and retired bins are not listed; a selection edit mints a new key', async () => {
    await mount('owner');
    await press(button(root(), 'New count'));
    const form = root().querySelector<HTMLFormElement>('form[aria-label="New count"]')!;
    const modes = form.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    await press(modes[1]!);
    const listed = [...form.querySelectorAll<HTMLInputElement>('[aria-label="Bins"] input[type="checkbox"]')].map((c) => c.getAttribute('aria-label'));
    expect(listed).toEqual(['A-01', 'A-02']);
    await press(form.querySelector<HTMLInputElement>('input[aria-label="A-02"]')!);
    createAnswers = [{ kind: 'drop' }];
    await press(button(form, 'Create counts'));
    await press(form.querySelector<HTMLInputElement>('input[aria-label="A-01"]')!);
    await press(button(form, 'Create counts'));
    const posts = writes().filter((r) => r.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[0]!.body).toEqual({ warehouseId: WH, binIds: ['b2'] });
    expect(posts[1]!.body).toEqual({ warehouseId: WH, binIds: ['b2', 'b1'] });
    expect(posts[1]!.key).not.toBe(posts[0]!.key);
  });
});

describe('the Schedule tab', () => {
  test('a manager sets a class (PUT) and removes one (DELETE), each with its own key', async () => {
    await mount('owner', 'schedule');
    const table = root().querySelector<HTMLElement>('[data-testid="count-schedule"]')!;
    const rowOf = (c: string) => table.querySelector<HTMLElement>(`tr[data-class="${c}"]`)!;
    expect(rowOf('a').textContent).toContain('Every 30 days');
    expect(rowOf('b').textContent).toContain('Not scheduled');
    setInput(rowOf('b').querySelector<HTMLInputElement>('input')!, '7');
    await press(button(rowOf('b'), 'Schedule'));
    const put = writes().find((r) => r.method === 'PUT')!;
    expect(put.body).toEqual({ policies: [{ abcClass: 'b', intervalDays: 7 }] });
    expect(root().textContent).toContain('Class B is counted every 7 days.');
    expect(rowOf('b').textContent).toContain('Every 7 days');
    await press(button(rowOf('a'), 'Remove'));
    // An inline confirmation first — nothing is sent until it is confirmed.
    expect(writes().some((r) => r.method === 'DELETE')).toBe(false);
    const confirm = root().querySelector<HTMLElement>('[aria-label="Confirm remove Class A schedule"]')!;
    expect(confirm.textContent).toContain('Stop scheduling Class A counts? Open counts stay.');
    await press(button(confirm, 'Keep'));
    expect(root().querySelector('[aria-label="Confirm remove Class A schedule"]')).toBeNull();
    expect(writes().some((r) => r.method === 'DELETE')).toBe(false);
    await press(button(rowOf('a'), 'Remove'));
    await press(button(root().querySelector<HTMLElement>('[aria-label="Confirm remove Class A schedule"]')!, 'Remove schedule'));
    const del = writes().find((r) => r.method === 'DELETE')!;
    expect(del.url.pathname.endsWith('/count-policies/a')).toBe(true);
    expect(del.key).not.toBe(put.key);
    expect(rowOf('a').textContent).toContain('Not scheduled');
  });

  test('an operator reads the schedule with no controls', async () => {
    await mount('operator', 'schedule');
    const table = root().querySelector<HTMLElement>('[data-testid="count-schedule"]')!;
    expect(table.textContent).toContain('Every 30 days');
    expect(table.querySelectorAll('button, input')).toHaveLength(0);
  });
});

describe('story 3-5b — the Stock takes tab and the cancel', () => {
  let downloads: { name: string }[];
  let originalCreate: typeof URL.createObjectURL;
  let originalRevoke: typeof URL.revokeObjectURL;
  let originalClick: typeof HTMLAnchorElement.prototype.click;
  beforeEach(() => {
    downloads = [];
    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    originalClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (() => 'blob:test/1') as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      downloads.push({ name: this.download });
    };
  });
  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    HTMLAnchorElement.prototype.click = originalClick;
  });

  const takeWrites = (suffix: string) => writes().filter((r) => r.url.pathname.endsWith(suffix));
  async function openTake(role: UserRole = 'owner'): Promise<void> {
    await mount(role, 'takes');
    await press(button(root().querySelector('[data-testid="stock-takes"]') as HTMLElement, 'Open'));
  }

  test('the list opens a take; the variances are read across two pages; a superseded row is not rendered; the epoch tag shows', async () => {
    await openTake();
    expect(root().textContent).toContain('As of');
    expect(root().querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('100');
    const reads = requests.filter((r) => r.url.pathname.endsWith('/variances'));
    expect(reads.map((r) => r.url.searchParams.get('cursor'))).toEqual([null, 'v-2']);
    expect(root().querySelector('[data-variance-id="tv1"]')).not.toBeNull();
    expect(root().querySelector('[data-variance-id="tv2"]')!.textContent).toContain('moved — recount');
    expect(root().querySelector('[data-variance-id="tv-old"]')).toBeNull();
    expect(root().textContent).toContain('Owner decides');
  });

  test('Post and close re-reads detail and variances together and sends the digest of that read', async () => {
    await openTake();
    const before = requests.length;
    takeDetail = { ...takeDetail, openVarianceDigest: 'b'.repeat(64) };
    await press(button(root(), 'Post and close'));
    const refetched = requests.slice(before).map((r) => r.url.pathname);
    expect(refetched.some((p) => p.endsWith(`/stock-takes/${TAKE}`))).toBe(true);
    expect(refetched.some((p) => p.endsWith('/variances'))).toBe(true);
    expect(root().textContent).toContain('Post 1 variance (1 over the threshold) to the ledger and lift the freeze on 2 bins?');
    await press(button(root(), 'Yes, post and close'));
    const close = takeWrites('/close')[0]!;
    expect(close.body).toEqual({ openVarianceDigest: 'b'.repeat(64) });
    expect(close.key).not.toBeNull();
    expect(root().textContent).toContain('Stock take closed');
  });

  test('Post and close is disabled, with the reason, while counts are pending or bins need a recount; a manager is refused for over-threshold', async () => {
    takeDetail = { ...takeDetail, totals: { ...(takeDetail.totals as object), pending: 2 } };
    await openTake();
    expect(button(root(), 'Post and close')!.disabled).toBe(true);
    expect(root().textContent).toContain('2 counts are still pending — count every bin first.');
    view!.unmount();
    view = undefined;
    takeDetail = { ...takeDetail, totals: { ...(takeDetail.totals as object), pending: 0 } };
    await openTake('ops_manager');
    expect(button(root(), 'Post and close')!.disabled).toBe(true);
    expect(root().textContent).toContain('only the owner can post this take');
  });

  test('the recount-required banner names the bins, says how many more, and Recount these bins posts their ids', async () => {
    takeDetail = { ...takeDetail, recountRequiredBins: [{ binId: 'b1', binCode: 'A-01' }], recountRequiredCount: 3 };
    await openTake();
    expect(root().textContent).toContain('3 counted bins moved since their count: A-01 …and 2 more — recount them before posting.');
    await press(button(root(), 'Recount these bins'));
    const recount = takeWrites('/recount')[0]!;
    expect(recount.body).toEqual({ binIds: ['b1'] });
    expect(recount.key).not.toBeNull();
    expect(root().textContent).toContain('Recount planned');
  });

  test('Recount selected posts the checked bins with a key and shows the outcome', async () => {
    await openTake();
    await act(async () => {
      root().querySelector<HTMLInputElement>('input[aria-label="Recount A-02"]')!.click();
    });
    await settle();
    const action = [...root().querySelectorAll('button')].find((b) => b.textContent?.startsWith('Recount selected'))!;
    expect(action.textContent).toBe('Recount selected (A-02)');
    await press(action);
    expect(takeWrites('/recount')[0]!.body).toEqual({ binIds: ['b2'] });
    expect(root().textContent).toContain('A-02');
  });

  test('Abandon posts {note: null} with a key and says what happened', async () => {
    await openTake();
    await press(button(root(), 'Abandon'));
    await press(button(root(), 'Yes, abandon'));
    const abandon = takeWrites('/abandon')[0]!;
    expect(abandon.body).toEqual({ note: null });
    expect(abandon.key).not.toBeNull();
    expect(root().textContent).toContain('2 pending count(s) cancelled, 1 kept as cycle counts');
  });

  test('the report: format and client ride the query; the file is named here (provisional while counting)', async () => {
    await openTake();
    setSelect(root().querySelector<HTMLSelectElement>('select[aria-label="Client"]')!, 'c-glow');
    setSelect(root().querySelector<HTMLSelectElement>('select[aria-label="Format"]')!, 'xlsx');
    await press(button(root(), 'Download provisional report'));
    const read = requests.find((r) => r.url.pathname.endsWith('/report'))!;
    expect(Object.fromEntries(read.url.searchParams)).toEqual({ format: 'xlsx', clientId: 'c-glow' });
    expect(downloads).toEqual([{ name: 'stock-take-BLR-2026-10-28-GLOW-provisional.xlsx' }]);
  });

  test('a closed take shows no actions and a Download report; a posting take shows Resume posting', async () => {
    takeDetail = { ...takeDetail, stockTake: { ...TAKE_SUMMARY, status: 'closed' } };
    await openTake();
    expect(button(root(), 'Post and close')).toBeUndefined();
    expect(button(root(), 'Abandon')).toBeUndefined();
    expect(button(root(), 'Download report')).toBeDefined();
    view!.unmount();
    view = undefined;
    takeDetail = { ...takeDetail, stockTake: { ...TAKE_SUMMARY, status: 'posting' } };
    await openTake();
    expect(root().textContent).toContain('Posting in progress');
    await press(button(root(), 'Resume posting'));
    expect(takeWrites('/close')[0]!.body).toEqual({ openVarianceDigest: DIGEST });
  });

  test('an operator sees no New stock take, no variance table and no post', async () => {
    await openTake('operator');
    expect(root().querySelector('[data-testid="stock-take-variances"]')).toBeNull();
    expect(button(root(), 'Post and close')).toBeUndefined();
    expect(requests.some((r) => r.url.pathname.endsWith('/variances'))).toBe(false);
  });

  test('the list loads more by keyset cursor', async () => {
    takesFirstPage = { ...takesFirstPage, nextCursor: 'st-2' };
    takesSecondPage = { items: [{ stockTake: { ...TAKE_SUMMARY, id: 'older', status: 'closed' }, progress: { bins: 1, counted: 1, pending: 0 } }], nextCursor: null };
    await mount('owner', 'takes');
    await press(button(root(), 'Load more'));
    expect(requests.filter((r) => r.url.pathname.endsWith('/stock-takes')).at(-1)!.url.searchParams.get('cursor')).toBe('st-2');
    expect(root().querySelector('[data-testid="stock-takes"]')!.textContent).toContain('Closed');
  });

  test('New stock take warns, counts the shared cap, POSTs the zones with a key, then opens the take', async () => {
    await mount('owner', 'takes');
    await press(button(root(), 'New stock take'));
    expect(root().textContent).toContain('Every movement into or out of these bins is refused until the take is closed or abandoned. Sync every handheld first.');
    await act(async () => {
      root().querySelector<HTMLInputElement>('input[aria-label="A"]')!.click();
    });
    await settle();
    // The counting take in the list already freezes 2 bins (the cap is shared).
    expect(root().textContent).toContain('2 bins, and 2 already frozen by other stock takes — at most 3000 can be frozen in one warehouse at once.');
    await press(button(root(), 'Start stock take'));
    const start = writes().find((r) => r.url.pathname.endsWith('/stock-takes'))!;
    expect(start.body).toEqual({ zoneIds: [ZA], note: null });
    expect(start.key).not.toBeNull();
    expect(root().querySelector('form[aria-label="New stock take"]')).toBeNull();
    await press(button(root(), 'Back to the list'));
    expect(root().querySelector('form[aria-label="New stock take"]')).toBeNull();
  });

  test('a pending cycle count can be cancelled (inline confirm, re-read); a take\'s task wears the chip and has no Cancel', async () => {
    firstPage = { items: [...firstPage.items, task('take-task', 'A-09', { status: 'pending', stockTakeId: TAKE, completedAt: null, completedBy: null })], nextCursor: null };
    await mount('owner');
    expect(row('A-09')!.textContent).toContain('Stock take');
    expect(button(row('A-09')!, 'Cancel')).toBeUndefined();
    const reads = listReads().length;
    await press(button(row('A-02')!, 'Cancel'));
    await press(button(row('A-02')!, 'Yes, cancel'));
    const cancel = writes().find((r) => r.url.pathname.endsWith('/cancel'))!;
    expect(cancel.url.pathname).toBe(`/api/v1/tenants/${T}/movements/counts/${TASK2}/cancel`);
    expect(cancel.key).not.toBeNull();
    expect(listReads().length).toBeGreaterThan(reads);
  });

  test('a 409 cancel refusal is shown, re-reads the list and a retry sends a fresh key', async () => {
    cancelRefusal = 'count-task-completed';
    await mount('owner');
    const reads = listReads().length;
    await press(button(row('A-02')!, 'Cancel'));
    await press(button(row('A-02')!, 'Yes, cancel'));
    expect(root().textContent).toContain('This count was already counted — nothing to cancel.');
    expect(listReads().length).toBeGreaterThan(reads);
    await press(button(row('A-02')!, 'Yes, cancel'));
    const keys = writes().filter((r) => r.url.pathname.endsWith('/cancel')).map((r) => r.key);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });
});
