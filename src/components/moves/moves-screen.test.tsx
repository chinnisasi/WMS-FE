import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import type { UserRole } from '../../lib/users';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { writeActiveWarehouseId } from '../../lib/warehouses';
import { MovesScreen } from './moves-screen';

/**
 * Story 3-1 — the Moves page, driven through a stubbed global `fetch`. Its
 * claims a `src/lib` test cannot make:
 *   1. the form is `stock.move`'s — ABSENT (not disabled) for an accountant,
 *      who still reads the recent moves;
 *   2. the SKU options come from the origin bin's own stock read, with a
 *      failed read's Retry; the target list leaves out blocked, system,
 *      retired, secure (for an operator) and the origin itself;
 *   3. pressing Move POSTs the exact body under a key; a retry after a dropped
 *      request reuses the key; an edit mints a new one;
 *   4. after a 201 the banner names the move and the recent moves reload;
 *   5. the recent moves group a serial move into one row with its reason.
 */

const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WH = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';
const ZONE = '0198f7a2-1b3c-7d4e-8f90-0000000000aa';

function session(role: UserRole): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: T, name: 'Priya Logistics', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  } as StoredSession;
}

function bin(id: string, code: string, overrides: Record<string, unknown> = {}) {
  return {
    id, code, tenantId: T, warehouseId: WH, zoneId: ZONE, capacity: 100, lengthMm: null, widthMm: null, heightMm: null, maxWeightGrams: null,
    storageClass: 'ambient', dedicatedClientId: null, type: 'shelf', blocked: false, systemOwned: false, retiredAt: null, retiredBy: null, ...overrides,
  };
}
const BINS = [
  bin('bin-a', 'A-01'),
  bin('bin-b', 'B-01'),
  bin('bin-blk', 'C-01', { blocked: true }),
  bin('bin-sys', 'RECEIVING', { systemOwned: true }),
  bin('bin-ret', 'D-01', { retiredAt: '2026-10-01T00:00:00.000Z' }),
  bin('bin-sec', 'S-01', { storageClass: 'secure' }),
];
const SKUS = [
  { id: 'sku-plain', code: 'PLAIN', name: 'Plain', uom: 'each', uomPrecision: 0, batchTracked: false, serialTracked: false, catchWeightTracked: false, storageClass: 'ambient', clientId: 'c-self', status: 'active' },
  { id: 'sku-kit', code: 'KIT', name: 'Kit', uom: 'each', uomPrecision: 0, batchTracked: false, serialTracked: false, catchWeightTracked: false, storageClass: 'ambient', clientId: 'c-self', status: 'active' },
];

let stockMode: 'ok' | 'fail' = 'ok';
let moveAnswers: ('ok' | 'drop')[] = [];
let ledgerItems: unknown[] = [];
let requests: { method: string; pathname: string; params: Record<string, string>; body: unknown; key: string | null }[] = [];

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
    try {
      body = await request.clone().json();
    } catch {
      body = null;
    }
    requests.push({ method, pathname, params: Object.fromEntries(url.searchParams), body, key: request.headers.get('Idempotency-Key') });
    const base = `/api/v1/tenants/${T}`;
    if (pathname === `${base}/warehouses`) return json(200, { items: [{ id: WH, code: 'BLR', name: 'Bengaluru DC' }], nextCursor: null });
    if (pathname === `${base}/clients`) return json(200, { items: [{ id: 'c-self', code: 'self', name: 'Priya Logistics', status: 'active', systemOwned: true }] });
    if (pathname === `${base}/catalog/skus`) return json(200, { items: SKUS, nextCursor: null });
    if (pathname === `${base}/catalog/kits`) return json(200, { items: [{ skuId: 'sku-kit', skuCode: 'KIT', components: [] }], nextCursor: null });
    if (pathname === `${base}/users`) return json(200, { items: [{ id: 'u-1', email: 'priya@example.com', role: 'operator', status: 'active' }], nextCursor: null });
    if (pathname === `${base}/warehouses/${WH}/zones`) return json(200, { items: [{ id: ZONE, code: 'A', name: 'Zone A' }], nextCursor: null });
    if (pathname === `${base}/warehouses/${WH}/zones/${ZONE}/bins`) return json(200, { items: BINS, nextCursor: null });
    if (pathname === `${base}/warehouses/${WH}/inventory/stock`) {
      if (stockMode === 'fail') return json(500, { code: 'internal', title: 'Boom', status: 500, detail: 'stock down' });
      return json(200, {
        items: [
          { id: 'r1', warehouseId: WH, skuId: 'sku-plain', binId: 'bin-a', quantity: 30, createdAt: '2026-10-22T00:00:00.000Z' },
          { id: 'r2', warehouseId: WH, skuId: 'sku-kit', binId: 'bin-a', quantity: 1, createdAt: '2026-10-22T00:00:00.000Z' },
        ],
        nextCursor: null,
      });
    }
    if (pathname === `${base}/warehouses/${WH}/inventory/events`) return json(200, { items: ledgerItems, nextCursor: null });
    if (pathname === `${base}/warehouses/${WH}/inventory/moves` && method === 'POST') {
      const answer = moveAnswers.shift() ?? 'ok';
      if (answer === 'drop') throw new TypeError('Failed to fetch');
      const sent = body as { skuId: string; fromBinId: string; toBinId: string; qty: number };
      return json(201, {
        moveId: 'mv-1',
        events: [{ seq: 9, skuId: sent.skuId, quantity: sent.qty, fromBinId: sent.fromBinId, toBinId: sent.toBinId, batchRef: null, serialRef: null, occurredAt: '2026-10-22T09:00:00.000Z' }],
      });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  stockMode = 'ok';
  moveAnswers = [];
  ledgerItems = [];
  requests = [];
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
  for (let i = 0; i < 16; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function setValue(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string): void {
  act(() => {
    const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

async function mount(role: UserRole): Promise<void> {
  writeSession(session(role));
  writeActiveWarehouseId(T, WH);
  view = render(<MovesScreen />);
  await settle();
}

const form = () => view!.container.querySelector<HTMLFormElement>('form[aria-label="Move stock"]');
const field = <E extends Element>(selector: string) => form()!.querySelector<E>(selector)!;
const options = (label: string) => [...form()!.querySelectorAll(`select[aria-label="${label}"] option`)].map((o) => o.textContent ?? '');
const moveButton = () => [...form()!.querySelectorAll('button')].find((b) => b.textContent === 'Move stock')!;
const movePosts = () => requests.filter((r) => r.method === 'POST' && r.pathname.endsWith('/inventory/moves'));
const ledgerReads = () => requests.filter((r) => r.pathname.endsWith('/inventory/events'));

async function fillPlainMove(qty = '20'): Promise<void> {
  setValue(field<HTMLSelectElement>('select[aria-label="From bin"]'), 'bin-a');
  await settle();
  setValue(field<HTMLSelectElement>('select[aria-label="SKU"]'), 'sku-plain');
  await settle();
  setValue(field<HTMLInputElement>('input[aria-label="Quantity"]'), qty);
  setValue(field<HTMLSelectElement>('select[aria-label="To bin"]'), 'bin-b');
  setValue(field<HTMLSelectElement>('select[aria-label="Reason"]'), 'consolidate');
  await settle();
}

async function press(target: HTMLButtonElement): Promise<void> {
  await act(async () => {
    target.click();
  });
  await settle();
}

describe('the Moves page (story 3-1)', () => {
  test('story 3-5b — the page links to Counts and stock takes (/moves/counts)', async () => {
    await mount('accountant');
    const link = [...view!.container.querySelectorAll('a')].find((a) => a.textContent === 'Counts and stock takes');
    expect(link?.getAttribute('href')).toBe('/moves/counts');
  });

  test('an accountant reads the recent moves and is offered no form at all', async () => {
    await mount('accountant');
    expect(form()).toBeNull();
    expect(view!.container.textContent).toContain('Recent moves');
    expect(ledgerReads().at(-1)!.params).toEqual({ type: 'stock.moved' });
  });

  test("the SKU options are the origin's own stock; the target list leaves out blocked, system, retired, secure and the origin; no secure origin for an operator", async () => {
    await mount('operator');
    // A blocked origin is offered; a secure one is not, to a role without secure.move.
    expect(options('From bin')).toEqual(['Pick the bin the stock leaves…', 'A-01', 'B-01', 'C-01 (blocked)']);
    setValue(field<HTMLSelectElement>('select[aria-label="From bin"]'), 'bin-a');
    await settle();
    const stockRead = requests.filter((r) => r.pathname.endsWith('/inventory/stock')).at(-1)!;
    expect(stockRead.params).toEqual({ binId: 'bin-a', nonZero: 'true', limit: '200' });
    expect(options('SKU')).toEqual(['Pick the SKU to move…', 'PLAIN — 30 each here', 'KIT — 1 each here']);
    setValue(field<HTMLSelectElement>('select[aria-label="SKU"]'), 'sku-plain');
    await settle();
    expect(options('To bin')).toEqual(['Pick the bin the stock goes to…', 'B-01']);
    // A kit is refused before the submit.
    setValue(field<HTMLSelectElement>('select[aria-label="SKU"]'), 'sku-kit');
    await settle();
    expect(form()!.textContent).toContain('KIT is a kit — a kit holds no stock; move its component SKUs.');
    expect(form()!.querySelector('select[aria-label="To bin"]')).toBeNull();
  });

  test("a failed read of the origin's stock shows the reason and Retry", async () => {
    stockMode = 'fail';
    await mount('operator');
    setValue(field<HTMLSelectElement>('select[aria-label="From bin"]'), 'bin-a');
    await settle();
    expect(form()!.textContent).toContain('Bin stock unavailable');
    stockMode = 'ok';
    await press([...form()!.querySelectorAll('button')].find((b) => b.textContent === 'Retry')!);
    expect(options('SKU')).toContain('PLAIN — 30 each here');
  });

  test('Move POSTs the exact body under a key; a dropped request retried reuses it; a 201 names the move and reloads the list', async () => {
    await mount('operator');
    await fillPlainMove();
    moveAnswers = ['drop', 'ok'];
    await press(moveButton());
    expect(movePosts()).toHaveLength(1);
    expect(movePosts()[0]!.body).toEqual({
      skuId: 'sku-plain',
      fromBinId: 'bin-a',
      toBinId: 'bin-b',
      qty: 20,
      batchCode: null,
      serials: null,
      reasonCode: 'consolidate',
      note: null,
    });
    expect(form()!.textContent).toContain('Not moved');
    const readsBefore = ledgerReads().length;
    await press(moveButton());
    expect(movePosts()).toHaveLength(2);
    expect(movePosts()[1]!.key).toBe(movePosts()[0]!.key);
    expect(form()!.textContent).toContain('Moved 20 PLAIN A-01 → B-01.');
    expect(ledgerReads().length).toBeGreaterThan(readsBefore);
  });

  test('an edit after a dropped request mints a new key: the changed body never replays the old one', async () => {
    await mount('operator');
    await fillPlainMove();
    moveAnswers = ['drop', 'ok'];
    await press(moveButton());
    expect(movePosts()).toHaveLength(1);
    expect(form()!.textContent).toContain('Not moved');
    // The draft is kept; change only the quantity, then submit again.
    setValue(field<HTMLInputElement>('input[aria-label="Quantity"]'), '5');
    await settle();
    await press(moveButton());
    expect(movePosts()).toHaveLength(2);
    expect((movePosts()[1]!.body as { qty: number }).qty).toBe(5);
    expect(movePosts()[1]!.key).not.toBeNull();
    expect(movePosts()[1]!.key).not.toBe(movePosts()[0]!.key);
  });

  test('the recent moves group a serial move into one row, with its reason and note', async () => {
    const ev = (id: string, serialRef: string) => ({
      id, seq: 1, warehouseId: WH, type: 'stock.moved', skuId: 'sku-plain', quantityDelta: 1, fromBinId: 'bin-a', toBinId: 'bin-b',
      batchRef: null, serialRef, actorUserId: 'u-1', occurredAt: '2026-10-22T03:30:00.000Z', recordedAt: '2026-10-22T03:30:05.000Z',
      referenceDoc: { kind: 'bin-move', moveId: 'mv-9', reasonCode: 'other', note: 'shelf collapsed' },
    });
    ledgerItems = [ev('e1', 's1'), ev('e2', 's2')];
    await mount('owner');
    const rows = [...view!.container.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('22 Oct 2026, 09:00:05');
    expect(rows[0]!.textContent).toContain('2 each');
    expect(rows[0]!.textContent).toContain('A-01 → B-01');
    expect(rows[0]!.textContent).toContain('2 serials');
    expect(rows[0]!.textContent).toContain('Other — “shelf collapsed”');
    expect(rows[0]!.textContent).toContain('priya@example.com');
  });
});
