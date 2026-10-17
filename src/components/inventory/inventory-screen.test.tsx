import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import InventoryPage from '../../app/(app)/inventory/page';
import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { writeActiveWarehouseId } from '../../lib/warehouses';
import { InventoryScreen } from './inventory-screen';

/**
 * The Inventory screen (inventory-screen, 2026-10-17), driven through a
 * stubbed `fetch` (frontend guide §8) — every row of the spec's I/O matrix:
 * the default Stock list (non-zero, bin by bin, system bins in words), the
 * bin and SKU searches (server-side filters, a SKU total only after every
 * page), the maps loading or failed, Load more and its failure, the Batches
 * tab (batch-tracked SKUs only, zero greyed, the detail's other-warehouse
 * bins), the Ledger tab's single failure arm, and a warehouse switch.
 */

const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WH = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';
const WH2 = '0198f7a2-1b3c-7d4e-8f90-99aabbccdfee';
const ZONE = '0198f7a2-1b3c-7d4e-8f90-00000000a001';
const BIN_D1 = '0198f7a2-1b3c-7d4e-8f90-00000000b001';
const BIN_D2 = '0198f7a2-1b3c-7d4e-8f90-00000000b002';
const BIN_RCV = '0198f7a2-1b3c-7d4e-8f90-00000000b003';
const SKU_SERUM = '0198f7a2-1b3c-7d4e-8f90-00000000c001';
const SKU_SPF = '0198f7a2-1b3c-7d4e-8f90-00000000c002';
const SKU_OIL = '0198f7a2-1b3c-7d4e-8f90-00000000c003';
const BATCH_A = '0198f7a2-1b3c-7d4e-8f90-00000000d001';
const BATCH_B = '0198f7a2-1b3c-7d4e-8f90-00000000d002';

const NOW = Date.parse('2026-10-17T10:00:00.000Z');

function session(): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: T, name: 'Glow Co', gstin: null },
    user: { id: 'u-1', email: 'owner@example.com', role: 'owner', status: 'active' },
    expiresAt: NOW + 15 * 60_000 + 10 * 365 * 86_400_000,
  } as StoredSession;
}

const WAREHOUSES = [
  { id: WH, code: 'BLR', name: 'Bengaluru DC' },
  { id: WH2, code: 'MYS', name: 'Mysore DC' },
];

function sku(id: string, code: string, name: string, batchTracked: boolean, uom = 'each', uomPrecision = 0) {
  return { id, code, name, uom, uomPrecision, batchTracked, serialTracked: false, clientId: 'client-self' };
}
const SKUS = [
  sku(SKU_SERUM, 'GLOW-SERUM-30', 'Glow Serum 30ml', true),
  sku(SKU_SPF, 'GLOW-SPF50-50', 'Glow SPF50 50ml', false),
  sku(SKU_OIL, 'ROSE-OIL', 'Rose Oil', false, 'litre', 3),
];
const BINS = [
  { id: BIN_D1, code: 'D-01-01', systemOwned: false },
  { id: BIN_D2, code: 'D-01-02', systemOwned: false },
  { id: BIN_RCV, code: 'RECEIVING', systemOwned: true },
];

function stockRow(id: string, binId: string, binCode: string, skuId: string, quantity: number, system = false) {
  return {
    id,
    warehouseId: WH,
    skuId,
    binId,
    quantity,
    createdAt: '2026-10-17T09:00:00.000Z',
    binCode,
    binSystemOwned: system,
  };
}
const STOCK = [
  stockRow('s-1', BIN_D1, 'D-01-01', SKU_SERUM, 297),
  stockRow('s-2', BIN_D2, 'D-01-02', SKU_SPF, 148),
  stockRow('s-3', BIN_D2, 'D-01-02', SKU_OIL, 2.5),
  stockRow('s-4', BIN_RCV, 'RECEIVING', SKU_SERUM, 3, true),
];

interface Recorded {
  readonly pathname: string;
  readonly params: Record<string, string>;
}
let requests: Recorded[] = [];

/** Per-test overrides of the router: a pathname suffix → a handler. */
let overrides: { match: (pathname: string, params: Record<string, string>) => boolean; respond: () => Response | Promise<Response> }[] = [];
let clients: { id: string; code: string; name: string; systemOwned: boolean; status: string }[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function problem(status: number, code: string): Response {
  return new Response(JSON.stringify({ type: 'about:blank', title: code, status, code, detail: `${code} detail` }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const { pathname } = url;
    const params = Object.fromEntries(url.searchParams);
    requests.push({ pathname, params });
    for (const o of overrides) if (o.match(pathname, params)) return o.respond();

    const base = `/api/v1/tenants/${T}`;
    if (pathname === `${base}/warehouses`) return json(200, { items: WAREHOUSES, nextCursor: null });
    if (pathname === `${base}/catalog/skus`) return json(200, { items: SKUS, nextCursor: null });
    if (pathname === `${base}/clients`) return json(200, { items: clients });
    if (pathname === `${base}/users`) return json(200, { items: [], nextCursor: null });
    if (/\/warehouses\/[^/]+\/zones$/.test(pathname)) return json(200, { items: [{ id: ZONE, code: 'D', name: 'Zone D' }], nextCursor: null });
    if (/\/zones\/[^/]+\/bins$/.test(pathname)) {
      return json(200, { items: pathname.includes(WH) ? BINS : [], nextCursor: null });
    }
    if (pathname.endsWith('/inventory/stock')) {
      const wh = pathname.split('/')[6];
      let rows = wh === WH ? STOCK : [];
      if (params.skuId !== undefined) rows = rows.filter((r) => r.skuId === params.skuId);
      if (params.binId !== undefined) rows = rows.filter((r) => r.binId === params.binId);
      return json(200, { items: rows, nextCursor: null });
    }
    if (pathname.endsWith('/inventory/batches')) {
      return json(200, {
        items: [
          { id: BATCH_A, code: 'LOT-A', mfgDate: '2026-01-01T00:00:00.000Z', expiryDate: '2027-01-01T00:00:00.000Z', status: 'active', quantity: 12 },
          { id: BATCH_B, code: 'LOT-B', mfgDate: null, expiryDate: '2027-06-01T00:00:00.000Z', status: 'active', quantity: 0 },
        ],
      });
    }
    if (pathname === `${base}/inventory/batches/${BATCH_A}`) {
      return json(200, {
        id: BATCH_A,
        skuId: SKU_SERUM,
        code: 'LOT-A',
        mfgDate: null,
        expiryDate: null,
        status: 'active',
        bins: [
          { warehouseId: WH, binId: BIN_D1, quantity: 12 },
          { warehouseId: WH2, binId: '0198f7a2-1b3c-7d4e-8f90-00000000e001', quantity: 5 },
          { warehouseId: WH2, binId: '0198f7a2-1b3c-7d4e-8f90-00000000e002', quantity: 1 },
        ],
        history: [
          { warehouseId: WH, seq: 1, type: 'grn.received', skuId: SKU_SERUM, quantityDelta: 12, fromBinId: null, toBinId: BIN_RCV, serialRef: null, occurredAt: '2026-10-01T05:00:00.000Z', recordedAt: '2026-10-01T05:00:00.000Z', eventHash: 'h1' },
          { warehouseId: WH2, seq: 9, type: 'grn.received', skuId: SKU_SERUM, quantityDelta: 6, fromBinId: null, toBinId: null, serialRef: null, occurredAt: '2026-10-02T05:00:00.000Z', recordedAt: '2026-10-02T05:00:00.000Z', eventHash: 'h9' },
          { warehouseId: WH, seq: 2, type: 'putaway.placed', skuId: SKU_SERUM, quantityDelta: 12, fromBinId: BIN_RCV, toBinId: BIN_D1, serialRef: null, occurredAt: '2026-10-03T05:00:00.000Z', recordedAt: '2026-10-03T05:00:00.000Z', eventHash: 'h2' },
        ],
      });
    }
    if (pathname === `${base}/inventory/batches/${BATCH_B}`) return problem(404, 'not-found');
    if (pathname.endsWith('/inventory/events')) return json(200, { items: [], nextCursor: null });
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  overrides = [];
  clients = [{ id: 'client-self', code: 'SELF', name: 'Glow Co', systemOwned: true, status: 'active' }];
  stubRouter();
  writeSession(session());
  writeActiveWarehouseId(T, WH);
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
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const panel = () => view!.container.querySelector('[role="tabpanel"]') as HTMLElement;
const panelText = () => panel().textContent ?? '';
const stockReads = (wh = WH) => requests.filter((r) => r.pathname === `/api/v1/tenants/${T}/warehouses/${wh}/inventory/stock`);
const batchListReads = () => requests.filter((r) => r.pathname.endsWith('/inventory/batches'));
const tableRows = () => [...panel().querySelectorAll('tbody tr[data-row-id]')] as HTMLTableRowElement[];
const cellTexts = (row: HTMLTableRowElement) => [...row.querySelectorAll('td')].map((td) => td.textContent ?? '');

async function search(value: string, inputName = 'code'): Promise<void> {
  const input = panel().querySelector(`input[name="${inputName}"]`) as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
  });
  await settle();
}

function button(text: string): HTMLButtonElement {
  const found = ([...view!.container.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => b.textContent === text);
  if (found === undefined) throw new Error(`No button "${text}"`);
  return found;
}

describe('the Inventory screen — Stock', () => {
  test('default: the Stock tab, the active warehouse, non-zero rows bin by bin, system bins in words', async () => {
    view = render(<InventoryScreen />);
    await settle();

    const tablist = view.container.querySelector('[role="tablist"][aria-label="Inventory lists"]')!;
    expect([...tablist.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Stock', 'Batches', 'Ledger']);
    expect(tablist.querySelector('[aria-selected="true"]')?.getAttribute('data-tab')).toBe('stock');
    expect(panel().querySelector('h2')?.textContent).toBe('Stock');

    // One read: the active warehouse, bin order, non-zero, a 200-row page.
    expect(stockReads()).toHaveLength(1);
    expect(stockReads()[0]!.params).toEqual({ limit: '200', order: 'location', nonZero: 'true' });
    expect(stockReads(WH2)).toHaveLength(0);

    const rows = tableRows();
    expect(rows.map(cellTexts)).toEqual([
      ['D-01-01', 'GLOW-SERUM-30', 'Glow Serum 30ml', '297 each'],
      ['D-01-02', 'GLOW-SPF50-50', 'Glow SPF50 50ml', '148 each'],
      ['D-01-02', 'ROSE-OIL', 'Rose Oil', '2.500 litre'],
      ['RECEIVINGReceiving (awaiting putaway)', 'GLOW-SERUM-30', 'Glow Serum 30ml', '3 each'],
    ]);
    // Only the system bin is labelled; no id anywhere in the table.
    expect(panelText()).not.toContain(BIN_D1);
    expect(panelText()).not.toContain(SKU_SERUM);
    // One client (the tenant's own) → no client column.
    expect([...panel().querySelectorAll('th')].map((th) => th.textContent)).not.toContain('Client');
  });

  test('a client column appears when the tenant has more than its own client', async () => {
    clients = [...clients, { id: 'client-b', code: 'BRAND', name: 'Brand', systemOwned: false, status: 'active' }];
    view = render(<InventoryScreen />);
    await settle();
    expect([...panel().querySelectorAll('th')].map((th) => th.textContent)).toContain('Client');
    expect(cellTexts(tableRows()[0]!)).toContain('Glow Co');
  });

  test('what is in a bin: a bin code sends binId and lists only that bin\'s rows', async () => {
    view = render(<InventoryScreen />);
    await settle();
    await search('d-01-02');

    const last = stockReads().at(-1)!;
    expect(last.params).toEqual({ binId: BIN_D2, limit: '200', order: 'location', nonZero: 'true' });
    expect(panel().querySelector('[data-testid="search-summary"]')?.textContent).toBe('What is in bin D-01-02.');
    expect([...panel().querySelectorAll('th')].map((th) => th.textContent)).toEqual(['SKU', 'Name', 'On hand']);
    expect(tableRows().map(cellTexts)).toEqual([
      ['GLOW-SPF50-50', 'Glow SPF50 50ml', '148 each'],
      ['ROSE-OIL', 'Rose Oil', '2.500 litre'],
    ]);
    // Clear returns to the whole warehouse.
    await click(button('Clear'));
    expect(stockReads().at(-1)!.params).toEqual({ limit: '200', order: 'location', nonZero: 'true' });
    expect(tableRows()).toHaveLength(4);
  });

  test('where is a SKU: the read sends skuId, walks every page, then totals across bins', async () => {
    // Two pages for the SKU: the total waits for the second.
    overrides.push({
      match: (p, q) => p.endsWith('/inventory/stock') && q.skuId === SKU_SERUM && q.cursor === undefined,
      respond: () => json(200, { items: [STOCK[0]], nextCursor: 'page-2' }),
    });
    overrides.push({
      match: (p, q) => p.endsWith('/inventory/stock') && q.skuId === SKU_SERUM && q.cursor === 'page-2',
      respond: () => json(200, { items: [STOCK[3]], nextCursor: null }),
    });
    view = render(<InventoryScreen />);
    await settle();
    await search('GLOW-SERUM-30');

    const skuReads = stockReads().filter((r) => r.params.skuId === SKU_SERUM);
    expect(skuReads.map((r) => r.params.cursor ?? null)).toEqual([null, 'page-2']);
    expect(skuReads.every((r) => r.params.order === 'location' && r.params.nonZero === 'true')).toBe(true);
    expect([...panel().querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Bin', 'On hand']);
    expect(tableRows().map(cellTexts)).toEqual([
      ['D-01-01', '297 each'],
      ['RECEIVINGReceiving (awaiting putaway)', '3 each'],
    ]);
    expect(panel().querySelector('[data-testid="stock-total"]')?.textContent).toBe('300 each');
    expect(panelText()).toContain('Total across bins');
    // No Load more on a walked SKU search.
    expect(([...panel().querySelectorAll('button')] as HTMLButtonElement[]).some((b) => b.textContent === 'Load more')).toBe(false);
  });

  test('a SKU total never shows while a page is missing', async () => {
    overrides.push({
      match: (p, q) => p.endsWith('/inventory/stock') && q.skuId === SKU_SERUM && q.cursor === undefined,
      respond: () => json(200, { items: [STOCK[0]], nextCursor: 'page-2' }),
    });
    overrides.push({
      match: (p, q) => p.endsWith('/inventory/stock') && q.cursor === 'page-2',
      respond: () => problem(503, 'unavailable'),
    });
    view = render(<InventoryScreen />);
    await settle();
    await search('GLOW-SERUM-30');
    expect(panel().querySelector('[data-testid="stock-total"]')?.textContent).toBe('Loading every bin…');
    expect(panelText()).toContain('More stock unavailable');
  });

  test('an unknown code reads "No bin or SKU with code X found" and sends no read', async () => {
    view = render(<InventoryScreen />);
    await settle();
    const before = stockReads().length;
    await search('ZZ-404');
    expect(panel().querySelector('[data-testid="search-miss"]')?.textContent).toContain('No bin or SKU with code ZZ-404 found.');
    expect(panelText()).not.toContain('not in this warehouse');
    expect(stockReads()).toHaveLength(before);
    expect(tableRows()).toHaveLength(0);
  });

  test('maps loading: the search is disabled with "Loading codes…"', async () => {
    overrides.push({ match: (p) => p.endsWith('/catalog/skus'), respond: () => new Promise<Response>(() => {}) });
    view = render(<InventoryScreen />);
    await settle();
    const input = panel().querySelector('input[name="code"]') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(panel().querySelector('[data-testid="search-note"]')?.textContent).toContain('Loading codes…');
    expect(button('Search').disabled).toBe(true);
  });

  test('a failed map is named, and the other code still searches', async () => {
    overrides.push({ match: (p) => p.endsWith('/catalog/skus'), respond: () => problem(500, 'boom') });
    view = render(<InventoryScreen />);
    await settle();
    const input = panel().querySelector('input[name="code"]') as HTMLInputElement;
    expect(input.disabled).toBe(false);
    expect(panel().querySelector('[data-testid="search-note"]')?.textContent).toContain(
      'SKU codes not loaded — search by bin code only.',
    );
    expect(button('Retry SKU codes')).toBeDefined();
    await search('D-01-01');
    expect(stockReads().at(-1)!.params.binId).toBe(BIN_D1);
    await search('GLOW-SERUM-30');
    expect(panel().querySelector('[data-testid="search-miss"]')?.textContent).toContain(
      'No bin with code GLOW-SERUM-30 found (SKU codes are not loaded).',
    );
  });

  test('Load more fetches the next page in bin order; a failure keeps the rows; Retry resets to page one', async () => {
    let failNext = true;
    overrides.push({
      match: (p, q) => p.endsWith('/inventory/stock') && q.cursor === undefined && q.skuId === undefined && q.binId === undefined,
      respond: () => json(200, { items: STOCK.slice(0, 2), nextCursor: 'p2' }),
    });
    overrides.push({
      match: (p, q) => p.endsWith('/inventory/stock') && q.cursor === 'p2',
      respond: () => (failNext ? problem(500, 'boom') : json(200, { items: STOCK.slice(2), nextCursor: null })),
    });
    view = render(<InventoryScreen />);
    await settle();
    expect(tableRows()).toHaveLength(2);

    await click(button('Load more'));
    expect(stockReads().at(-1)!.params).toEqual({ cursor: 'p2', limit: '200', order: 'location', nonZero: 'true' });
    // The failure keeps the loaded rows, with Retry.
    expect(tableRows()).toHaveLength(2);
    expect(panelText()).toContain('More stock unavailable');

    // Retry resets the cursor and the rows together: page one again.
    failNext = false;
    const reads = stockReads().length;
    await click(button('Retry'));
    expect(stockReads()[reads]!.params.cursor).toBeUndefined();
    expect(tableRows()).toHaveLength(2);
    await click(button('Load more'));
    expect(tableRows().map((r) => r.getAttribute('data-row-id'))).toEqual(['s-1', 's-2', 's-3', 's-4']);
    expect(([...panel().querySelectorAll('button')] as HTMLButtonElement[]).some((b) => b.textContent === 'Load more')).toBe(false);
  });

  test('a failed stock read is the shared ReadFailure with Retry', async () => {
    let fail = true;
    overrides.push({
      match: (p) => p.endsWith('/inventory/stock'),
      respond: () => (fail ? problem(500, 'boom') : json(200, { items: STOCK, nextCursor: null })),
    });
    view = render(<InventoryScreen />);
    await settle();
    expect(panelText()).toContain('Stock unavailable');
    fail = false;
    await click(button('Retry'));
    expect(tableRows()).toHaveLength(4);
  });

  test('a warehouse switch re-reads for the new warehouse and clears the search', async () => {
    view = render(<InventoryScreen />);
    await settle();
    await search('D-01-01');
    expect(panel().querySelector('[data-testid="search-summary"]')).not.toBeNull();

    await act(async () => {
      writeActiveWarehouseId(T, WH2);
    });
    await settle();
    expect((panel().querySelector('input[name="code"]') as HTMLInputElement).value).toBe('');
    expect(panel().querySelector('[data-testid="search-summary"]')).toBeNull();
    expect(stockReads(WH2).at(-1)!.params).toEqual({ limit: '200', order: 'location', nonZero: 'true' });
    expect(panelText()).toContain('MYS Mysore DC');
  });

  test('no warehouses → "Create a warehouse first"; a failed warehouses read → WarehousesFailure', async () => {
    overrides.push({ match: (p) => p === `/api/v1/tenants/${T}/warehouses`, respond: () => json(200, { items: [], nextCursor: null }) });
    view = render(<InventoryScreen />);
    await settle();
    expect(panelText()).toContain('Create a warehouse first');
    expect(stockReads()).toHaveLength(0);
    view.unmount();

    overrides = [{ match: (p) => p === `/api/v1/tenants/${T}/warehouses`, respond: () => problem(500, 'boom') }];
    view = render(<InventoryScreen />);
    await settle();
    expect(panelText()).toContain('Warehouses not loaded');
  });
});

describe('the Inventory screen — Batches', () => {
  test('a non-batch SKU → "This SKU isn\'t batch-tracked", decided before any read; the picker offers batch SKUs only', async () => {
    view = render(<InventoryScreen initialTab="batches" />);
    await settle();
    expect(panel().querySelector('h2')?.textContent).toBe('Batches');
    const options = [...panel().querySelectorAll('datalist option')].map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(['GLOW-SERUM-30']);

    await search('GLOW-SPF50-50', 'sku');
    expect(panel().querySelector('[data-testid="batch-problem"]')?.textContent).toContain("This SKU isn't batch-tracked.");
    expect(batchListReads()).toHaveLength(0);
  });

  test('a batch SKU lists its batches by expiry; a zero batch is greyed "0 in this warehouse"; the detail splits warehouses', async () => {
    view = render(<InventoryScreen initialTab="batches" />);
    await settle();
    await search('glow-serum-30', 'sku');

    expect(batchListReads()).toHaveLength(1);
    expect(batchListReads()[0]!.params).toEqual({ skuId: SKU_SERUM });
    const rows = tableRows();
    expect(rows.map((r) => cellTexts(r)[0])).toEqual(['LOT-A', 'LOT-B']);
    expect(cellTexts(rows[0]!)[4]).toBe('12 each');
    expect(cellTexts(rows[1]!)[4]).toBe('0 in this warehouse');
    expect(rows[1]!.getAttribute('data-zero')).toBe('true');
    expect(rows[0]!.getAttribute('data-zero')).toBeNull();

    await click(rows[0]!.querySelector('button')!);
    const detail = panel().querySelector('[data-testid="batch-detail"]')!;
    expect(detail.textContent).toContain('D-01-01');
    expect(detail.textContent).not.toContain(BIN_D1);
    expect(panel().querySelector('[data-testid="batch-elsewhere"]')?.textContent).toBe(
      '2 more bins in other warehouses: MYS Mysore DC (2)',
    );
    // The history is this warehouse's, oldest first.
    const history = [...panel().querySelectorAll('[data-testid="batch-history"] li')].map((li) => li.textContent ?? '');
    expect(history).toHaveLength(2);
    expect(history[0]).toContain('RECEIVING');
    expect(history[1]).toContain('RECEIVING → D-01-01');
  });

  test('a batch the server no longer has → "Batch not found"', async () => {
    view = render(<InventoryScreen initialTab="batches" />);
    await settle();
    await search('GLOW-SERUM-30', 'sku');
    await click(tableRows()[1]!.querySelector('button')!);
    expect(panelText()).toContain('Batch not found');
  });
});

describe('the Inventory screen — Ledger and the page', () => {
  test('the Ledger tab renders the ledger for the active warehouse, and a failed warehouses read shows once', async () => {
    overrides.push({ match: (p) => p === `/api/v1/tenants/${T}/warehouses`, respond: () => problem(500, 'boom') });
    view = render(<InventoryScreen initialTab="ledger" />);
    await settle();
    expect(panel().querySelector('h2')?.textContent).toBe('Ledger');
    expect((panelText().match(/Warehouses not loaded/g) ?? []).length).toBe(1);
    expect(stockReads()).toHaveLength(0);
  });

  test('the Ledger tab reads the active warehouse\'s events undrilled', async () => {
    view = render(<InventoryScreen initialTab="ledger" />);
    await settle();
    const events = requests.filter((r) => r.pathname.endsWith('/inventory/events'));
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.pathname).toBe(`/api/v1/tenants/${T}/warehouses/${WH}/inventory/events`);
    expect(events[0]!.params).toEqual({});
    expect(panelText()).toContain('No ledger events in this warehouse yet.');
  });

  test('the page parses ?tab=, ignores a stray list=, and keys on none|tab', async () => {
    const element = await InventoryPage({ searchParams: Promise.resolve({ tab: 'batches', list: 'ledger' }) });
    expect(element.key).toBe('none|batches');
    view = render(element);
    await settle();
    expect(view.container.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab')).toBe('batches');

    const bare = await InventoryPage({ searchParams: Promise.resolve({ tab: 'nope' }) });
    expect(bare.key).toBe('none|default');
  });
});
