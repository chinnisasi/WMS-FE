import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import InventoryPage from '../../app/(app)/inventory/page';
import { ACTIVE_CLIENT_STORAGE_KEY, writeActiveClientId } from '../../lib/active-client';
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
  return { id, code, name, uom, uomPrecision, batchTracked, serialTracked: false, clientId: 'client-self', status: 'active' };
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
    if (pathname === `${base}/catalog/kits`) return json(200, { items: [], nextCursor: null });
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
    // Story 3-2a — the owner holds stock.adjust, so the Adjust tab shows.
    expect([...tablist.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Stock', 'Batches', 'Recalls', 'Ledger', 'Adjust']);
    expect(tablist.querySelector('[aria-selected="true"]')?.getAttribute('data-tab')).toBe('stock');
    expect(panel().querySelector('h2')?.textContent).toBe('Stock');

    // One read: the active warehouse, bin order, non-zero, a 200-row page.
    expect(stockReads()).toHaveLength(1);
    expect(stockReads()[0]!.params).toEqual({ limit: '200', order: 'location', nonZero: 'true' });
    expect(stockReads(WH2)).toHaveLength(0);

    const rows = tableRows();
    // Story 3-2a — the owner's Action column: Adjust on storage bins, nothing on RECEIVING.
    expect(rows.map(cellTexts)).toEqual([
      ['D-01-01', 'GLOW-SERUM-30', 'Glow Serum 30ml', '297 each', 'Adjust'],
      ['D-01-02', 'GLOW-SPF50-50', 'Glow SPF50 50ml', '148 each', 'Adjust'],
      ['D-01-02', 'ROSE-OIL', 'Rose Oil', '2.500 litre', 'Adjust'],
      ['RECEIVINGReceiving (awaiting putaway)', 'GLOW-SERUM-30', 'Glow Serum 30ml', '3 each', ''],
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
    expect([...panel().querySelectorAll('th')].map((th) => th.textContent)).toEqual(['SKU', 'Name', 'On hand', 'Action']);
    expect(tableRows().map(cellTexts)).toEqual([
      ['GLOW-SPF50-50', 'Glow SPF50 50ml', '148 each', 'Adjust'],
      ['ROSE-OIL', 'Rose Oil', '2.500 litre', 'Adjust'],
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
    expect([...panel().querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Bin', 'On hand', 'Action']);
    expect(tableRows().map(cellTexts)).toEqual([
      ['D-01-01', '297 each', 'Adjust'],
      ['RECEIVINGReceiving (awaiting putaway)', '3 each', ''],
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
    expect(panel().querySelector('[data-testid="stock-total"]')?.textContent).toBe('Total unavailable — a page failed to load');
    expect(panelText()).toContain('More stock unavailable');
  });

  test('the SKU total sits under On hand when the Client column is shown', async () => {
    clients = [...clients, { id: 'client-b', code: 'BRAND', name: 'Brand', systemOwned: false, status: 'active' }];
    view = render(<InventoryScreen />);
    await settle();
    await search('GLOW-SERUM-30');
    const headers = [...panel().querySelectorAll('thead th')].map((th) => th.textContent);
    // Story 3-2a — the Action column follows On hand; the total stays under On hand.
    expect(headers).toEqual(['Bin', 'Client', 'On hand', 'Action']);
    const footCells = [...panel().querySelectorAll('tfoot td')] as HTMLTableCellElement[];
    expect(footCells.map((td) => td.textContent)).toEqual(['Total across bins', '300 each', '']);
    expect(footCells[0]!.colSpan).toBe(headers.length - 2);
  });

  test('a SKU walk stops at 50 pages and says the total is unavailable', async () => {
    let n = 0;
    overrides.push({
      match: (p, q) => p.endsWith('/inventory/stock') && q.skuId === SKU_SERUM,
      respond: () => {
        n += 1;
        return json(200, { items: [{ ...STOCK[0], id: `w-${n}` }], nextCursor: `c-${n}` });
      },
    });
    view = render(<InventoryScreen />);
    await settle();
    await search('GLOW-SERUM-30');
    for (let i = 0; i < 10; i++) await settle();
    expect(stockReads().filter((r) => r.params.skuId === SKU_SERUM)).toHaveLength(50);
    expect(panel().querySelector('[data-testid="stock-total"]')?.textContent).toBe(
      'Total unavailable — too many bins to total here',
    );
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

  test('a failed bin map is named; Retry bin codes is offered; a SKU search still sends skuId', async () => {
    overrides.push({ match: (p) => /\/zones\/[^/]+\/bins$/.test(p), respond: () => problem(500, 'boom') });
    view = render(<InventoryScreen />);
    await settle();
    expect(panel().querySelector('[data-testid="search-note"]')?.textContent).toContain(
      'Bin codes not loaded — search by SKU code only.',
    );
    expect(button('Retry bin codes')).toBeDefined();
    await search('GLOW-SERUM-30');
    expect(stockReads().at(-1)!.params.skuId).toBe(SKU_SERUM);
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

  test('a batch the server no longer has → "Batch not found" with its own sentence', async () => {
    view = render(<InventoryScreen initialTab="batches" />);
    await settle();
    await search('GLOW-SERUM-30', 'sku');
    await click(tableRows()[1]!.querySelector('button')!);
    expect(panelText()).toContain('Batch not found');
    expect(panelText()).toContain('Batch not found — it may have been removed.');
    expect(panelText()).not.toContain('refresh the queue');
  });

  test('any other batch failure is headed "Batch unavailable"', async () => {
    overrides.push({ match: (p) => p.endsWith(`/inventory/batches/${BATCH_A}`), respond: () => problem(500, 'boom') });
    view = render(<InventoryScreen initialTab="batches" />);
    await settle();
    await search('GLOW-SERUM-30', 'sku');
    await click(tableRows()[0]!.querySelector('button')!);
    expect(panelText()).toContain('Batch unavailable');
    expect(panelText()).not.toContain('Batch not found');
  });

  // ── story 3-3a: block / unblock ─────────────────────────────────────────────

  async function setField(selector: string, value: string): Promise<void> {
    const element = panel().querySelector(selector) as HTMLTextAreaElement | HTMLSelectElement;
    if (element === null) throw new Error(`No field ${selector}`);
    const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    });
  }

  const BLOCKED_A = {
    id: BATCH_A,
    skuId: SKU_SERUM,
    code: 'LOT-A',
    mfgDate: null,
    expiryDate: '2027-01-01T00:00:00.000Z',
    status: 'blocked',
    blockedReason: 'recall',
    blockedNote: null,
    blockedAt: '2026-10-17T09:30:00.000Z',
    blockedBy: 'u-1',
    blockedByName: 'owner',
    expired: false,
  };

  test('3-3a: a qc.manage role blocks a batch — reason and note in the body, one key, the banner, and the list re-read', async () => {
    const posted: { pathname: string; body: unknown; key: string | null }[] = [];
    overrides.push({
      match: (p) => p.endsWith(`/inventory/batches/${BATCH_A}/block`),
      respond: () => json(201, { batch: BLOCKED_A }),
    });
    stubGlobal('fetch', ((original) => async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input.toString(), init);
      if (request.method === 'POST') {
        posted.push({ pathname: new URL(request.url).pathname, body: await request.clone().json(), key: request.headers.get('Idempotency-Key') });
      }
      return original(input, init);
    })(globalThis.fetch) as unknown as typeof fetch);
    view = render(<InventoryScreen initialTab="batches" />);
    await settle();
    await search('GLOW-SERUM-30', 'sku');
    expect(cellTexts(tableRows()[0]!)[3]).toBe('Active');
    await click(button('Block LOT-A'));
    const dialog = panel().querySelector('[data-testid="batch-block-dialog"]')!;
    expect(dialog.getAttribute('aria-label')).toBe('Block batch LOT-A');

    // No reason → refused in the browser, nothing sent.
    await click(button('Block batch'));
    expect(panelText()).toContain('Pick a reason for the block.');
    // Other without a note → refused too.
    await setField('select[aria-label="Block reason"]', 'other');
    await click(button('Block batch'));
    expect(panelText()).toContain('Say why in the note — the reason is Other.');
    expect(posted).toHaveLength(0);

    await setField('select[aria-label="Block reason"]', 'recall');
    await setField('textarea[aria-label="Block note"]', '  Supplier recall R-17 ');
    const listReadsBefore = batchListReads().length;
    await click(button('Block batch'));
    expect(posted).toHaveLength(1);
    expect(posted[0]!.pathname).toBe(`/api/v1/tenants/${T}/inventory/batches/${BATCH_A}/block`);
    expect(posted[0]!.body).toEqual({ reason: 'recall', note: 'Supplier recall R-17' });
    expect(posted[0]!.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(panel().querySelector('[data-testid="batch-block-dialog"]')).toBeNull();
    expect(panelText()).toContain('Batch LOT-A is blocked (recall) in every warehouse');
    expect(batchListReads().length).toBe(listReadsBefore + 1);
  });

  test('3-3a: a blocked batch reads "Blocked — recall (by owner, date)", an expired one "Expired"; Unblock needs a note', async () => {
    overrides.push({
      match: (p) => p.endsWith('/inventory/batches'),
      respond: () =>
        json(200, {
          items: [
            { ...BLOCKED_A, quantity: 12 },
            { id: BATCH_B, code: 'LOT-B', mfgDate: null, expiryDate: '2026-10-01T00:00:00.000Z', status: 'active', blockedReason: null, blockedAt: null, blockedBy: null, blockedByName: null, expired: true, quantity: 3 },
          ],
        }),
    });
    overrides.push({
      match: (p) => p.endsWith(`/inventory/batches/${BATCH_A}/unblock`),
      respond: () => problem(409, 'batch-not-blocked'),
    });
    view = render(<InventoryScreen initialTab="batches" />);
    await settle();
    await search('GLOW-SERUM-30', 'sku');
    expect(cellTexts(tableRows()[0]!)[3]).toBe('Blocked — recall (by owner, 17 Oct 2026)');
    expect(cellTexts(tableRows()[1]!)[3]).toBe('Expired');
    await click(button('Unblock LOT-A'));
    await click(button('Unblock batch'));
    expect(panelText()).toContain('Say why the block is lifted — a note is required.');
    await setField('textarea[aria-label="Unblock note"]', 'Recall withdrawn');
    await click(button('Unblock batch'));
    expect(panelText()).toContain('This batch is not blocked any more — refresh the batches.');
  });

  test('3-3a: Esc is ignored while a block is in flight — the dialog (and its key) survive until the answer', async () => {
    let release: (() => void) | null = null;
    overrides.push({
      match: (p) => p.endsWith(`/inventory/batches/${BATCH_A}/block`),
      respond: () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(json(201, { batch: BLOCKED_A }));
        }),
    });
    view = render(<InventoryScreen initialTab="batches" />);
    await settle();
    await search('GLOW-SERUM-30', 'sku');
    await click(button('Block LOT-A'));
    await setField('select[aria-label="Block reason"]', 'recall');
    await click(button('Block batch'));
    expect(button('Blocking…').disabled).toBe(true);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await settle();
    expect(panel().querySelector('[data-testid="batch-block-dialog"]')).not.toBeNull();
    await act(async () => {
      release!();
    });
    await settle();
    expect(panel().querySelector('[data-testid="batch-block-dialog"]')).toBeNull();
    expect(panelText()).toContain('Batch LOT-A is blocked (recall) in every warehouse');
    // Idle again: Esc closes a freshly opened dialog.
    await click(button('Block LOT-A'));
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await settle();
    expect(panel().querySelector('[data-testid="batch-block-dialog"]')).toBeNull();
  });

  test('3-3a: a 409 batch-already-blocked closes the dialog and re-reads the list (the batch moved on)', async () => {
    overrides.push({
      match: (p) => p.endsWith(`/inventory/batches/${BATCH_A}/block`),
      respond: () => problem(409, 'batch-already-blocked'),
    });
    view = render(<InventoryScreen initialTab="batches" />);
    await settle();
    await search('GLOW-SERUM-30', 'sku');
    await click(button('Block LOT-A'));
    await setField('select[aria-label="Block reason"]', 'recall');
    const before = batchListReads().length;
    await click(button('Block batch'));
    expect(panel().querySelector('[data-testid="batch-block-dialog"]')).toBeNull();
    expect(batchListReads().length).toBe(before + 1);
    expect(panelText()).toContain('This batch is already blocked — refresh the batches.');
  });

  test('3-3a: blocking from an open detail re-fetches the detail, whose status then reads "Blocked — …"', async () => {
    let blockedNow = false;
    overrides.push({
      match: (p) => p.endsWith(`/inventory/batches/${BATCH_A}/block`),
      respond: () => {
        blockedNow = true;
        return json(201, { batch: { ...BLOCKED_A, blockedNote: 'Supplier recall R-17' } });
      },
    });
    overrides.push({
      match: (p) => p === `/api/v1/tenants/${T}/inventory/batches/${BATCH_A}` && blockedNow,
      respond: () =>
        json(200, { ...BLOCKED_A, blockedNote: 'Supplier recall R-17', bins: [{ warehouseId: WH, binId: BIN_D1, quantity: 12 }], history: [] }),
    });
    view = render(<InventoryScreen initialTab="batches" />);
    await settle();
    await search('GLOW-SERUM-30', 'sku');
    await click(tableRows()[0]!.querySelector('button')!);
    const detailReads = () => requests.filter((r) => r.pathname === `/api/v1/tenants/${T}/inventory/batches/${BATCH_A}`).length;
    expect(detailReads()).toBe(1);
    expect(panel().querySelector('[data-testid="batch-detail-status"]')?.textContent).toContain('Active');
    await click(button('Block this batch'));
    await setField('select[aria-label="Block reason"]', 'recall');
    await setField('textarea[aria-label="Block note"]', 'Supplier recall R-17');
    await click(button('Block batch'));
    expect(detailReads()).toBe(2);
    expect(panel().querySelector('[data-testid="batch-detail-status"]')?.textContent).toContain(
      'Blocked — recall: Supplier recall R-17 (by owner, 17 Oct 2026)',
    );
  });

  test('3-3a: a role without qc.manage sees no Block action', async () => {
    writeSession({ ...session(), user: { ...session().user, role: 'accountant' } } as StoredSession);
    view = render(<InventoryScreen initialTab="batches" />);
    await settle();
    await search('GLOW-SERUM-30', 'sku');
    expect(tableRows()).toHaveLength(2);
    expect([...panel().querySelectorAll('button')].some((b) => (b.textContent ?? '').startsWith('Block'))).toBe(false);
  });

  test('a failed bin map on Batches says "Bin codes not loaded" with Retry bin codes', async () => {
    overrides.push({ match: (p) => /\/zones\/[^/]+\/bins$/.test(p), respond: () => problem(500, 'boom') });
    view = render(<InventoryScreen initialTab="batches" />);
    await settle();
    await search('GLOW-SERUM-30', 'sku');
    expect(panel().querySelector('[data-testid="bin-codes-note"]')?.textContent).toContain('Bin codes not loaded');
    expect(button('Retry bin codes')).toBeDefined();
    expect(cellTexts(tableRows()[0]!)[3]).toBe('Active');
  });
});

describe('story 3-7a — a batch under recall (A4)', () => {
  const UNDER_RECALL = {
    id: BATCH_A,
    code: 'LOT-A',
    mfgDate: null,
    expiryDate: '2027-01-01T00:00:00.000Z',
    status: 'blocked',
    blockedReason: 'recall',
    blockedNote: 'RCL-000007: Allergen',
    blockedAt: '2026-10-17T09:30:00.000Z',
    blockedBy: 'u-1',
    blockedByName: 'owner',
    expired: false,
    recallCode: 'RCL-000007',
    quantity: 12,
  };

  async function setSelect(selector: string, value: string): Promise<void> {
    const element = panel().querySelector(selector) as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  test('a lot under an open live recall: the recall badge links to it, and Unblock is not offered — it says why', async () => {
    overrides.push({ match: (p) => p.endsWith('/inventory/batches'), respond: () => json(200, { items: [UNDER_RECALL] }) });
    view = render(<InventoryScreen initialTab="batches" />);
    await settle();
    await search('GLOW-SERUM-30', 'sku');
    const badge = panel().querySelector('[data-testid="batch-recall-badge"]') as HTMLAnchorElement;
    expect(badge.textContent).toContain('Under recall RCL-000007');
    expect(badge.getAttribute('href')).toBe('/inventory?tab=recalls&recall=RCL-000007');
    const unblock = button('Unblock LOT-A');
    expect(unblock.disabled).toBe(true);
    expect(unblock.title).toBe('Under recall RCL-000007 — release it from the recall.');
  });

  test('a lot blocked for another reason before the recall: Unblock waits for the close, and the words say so', async () => {
    overrides.push({ match: (p) => p.endsWith('/inventory/batches'), respond: () => json(200, { items: [{ ...UNDER_RECALL, blockedReason: 'qc-failed' }] }) });
    view = render(<InventoryScreen initialTab="batches" />);
    await settle();
    await search('GLOW-SERUM-30', 'sku');
    const unblock = button('Unblock LOT-A');
    expect(unblock.disabled).toBe(true);
    expect(unblock.title).toBe('Under recall RCL-000007 — blocked for failed QC before the recall; unblock it here once RCL-000007 is closed.');
  });

  test('a 409 batch-under-recall (the recall opened after the list was read) is worded the same way, linked, with no retry', async () => {
    overrides.push({
      match: (p) => p.endsWith('/inventory/batches'),
      respond: () => json(200, { items: [{ ...UNDER_RECALL, recallCode: null }] }),
    });
    overrides.push({
      match: (p) => p.endsWith(`/inventory/batches/${BATCH_A}/unblock`),
      respond: () =>
        new Response(JSON.stringify({ code: 'batch-under-recall', status: 409, title: 'Batch under recall', detail: 'prose', recallCode: 'RCL-000009' }), {
          status: 409,
          headers: { 'content-type': 'application/problem+json' },
        }),
    });
    view = render(<InventoryScreen initialTab="batches" />);
    await settle();
    await search('GLOW-SERUM-30', 'sku');
    await click(button('Unblock LOT-A'));
    const note = panel().querySelector('textarea[aria-label="Unblock note"]') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(note, 'Brand withdrew');
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button('Unblock batch'));
    const said = panel().querySelector('[data-testid="under-recall-note"]')!;
    expect(said.textContent).toContain('Under recall RCL-000009 — release it from the recall');
    expect(said.querySelector('a')?.getAttribute('href')).toBe('/inventory?tab=recalls&recall=RCL-000009');
    expect(button('Unblock batch').disabled).toBe(true);
  });

  test('choosing the standalone recall reason nudges towards a recall document', async () => {
    view = render(<InventoryScreen initialTab="batches" />);
    await settle();
    await search('GLOW-SERUM-30', 'sku');
    await click(button('Block LOT-A'));
    expect(panel().querySelector('[data-testid="open-a-recall-nudge"]')).toBeNull();
    await setSelect('select[aria-label="Block reason"]', 'recall');
    const nudge = panel().querySelector('[data-testid="open-a-recall-nudge"]')!;
    expect(nudge.textContent).toContain('Recalling a lot? Open a recall instead — it blocks, traces and reports.');
    expect(nudge.querySelector('a')?.getAttribute('href')).toBe('/inventory?tab=recalls');
  });
});

describe('story 1-1 — a SKU code two clients share', () => {
  const SKU_SERUM_B = '0198f7a2-1b3c-7d4e-8f90-00000000c009';
  beforeEach(() => {
    clients = [...clients, { id: 'client-b', code: 'BRAND', name: 'Brand', systemOwned: false, status: 'active' }];
    SKUS.push({ ...sku(SKU_SERUM_B, 'GLOW-SERUM-30', 'Brand Serum 30ml', true), clientId: 'client-b' });
  });
  afterEach(() => {
    SKUS.pop();
  });

  test('Stock: the search offers one button per client, sends nothing until one is picked, then names its client', async () => {
    view = render(<InventoryScreen />);
    await settle();
    const before = stockReads().length;
    await search('GLOW-SERUM-30');
    const chooser = panel().querySelector('[data-testid="search-choice"]')!;
    expect(chooser.textContent).toContain('2 SKUs match GLOW-SERUM-30 — pick one.');
    const choices = [...chooser.querySelectorAll('button')] as HTMLButtonElement[];
    expect(choices.map((b) => b.textContent)).toEqual(['GLOW-SERUM-30 · Glow Co', 'GLOW-SERUM-30 · BRAND']);
    // Never a silent pick of the first: no stock read for either SKU yet.
    expect(stockReads().slice(before).some((r) => r.params.skuId !== undefined)).toBe(false);

    await click(choices[1]!);
    expect(stockReads().at(-1)!.params.skuId).toBe(SKU_SERUM_B);
    expect(panel().querySelector('[data-testid="search-summary"]')?.textContent).toBe(
      'Where SKU GLOW-SERUM-30 · BRAND is — one row per bin.',
    );
    expect(panel().querySelector('[data-testid="search-choice"]')).toBeNull();
  });

  test('Batches: the same chooser; the datalist reads name · client', async () => {
    view = render(<InventoryScreen initialTab="batches" />);
    await settle();
    const options = [...panel().querySelectorAll('datalist option')].map((o) => o.textContent);
    expect(options).toEqual(['Glow Serum 30ml · Glow Co', 'Brand Serum 30ml · BRAND']);

    await search('GLOW-SERUM-30', 'sku');
    const choices = [...panel().querySelectorAll('[data-testid="search-choice"] button')] as HTMLButtonElement[];
    expect(choices.map((b) => b.textContent)).toEqual(['GLOW-SERUM-30 · Glow Co', 'GLOW-SERUM-30 · BRAND']);
    expect(batchListReads()).toHaveLength(0);
    await click(choices[1]!);
    expect(batchListReads().at(-1)!.params.skuId).toBe(SKU_SERUM_B);
    expect(panelText()).toContain('Batches of GLOW-SERUM-30 · BRAND');
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
    // UI-1 — the page is a PageHeader then the keyed screen; the key is the screen's.
    const screenKey = (page: typeof element) => (page.props as { children: { key: string | null }[] }).children[1]!.key;
    expect(screenKey(element)).toBe('none|batches');
    view = render(element);
    await settle();
    expect(view.container.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab')).toBe('batches');

    const bare = await InventoryPage({ searchParams: Promise.resolve({ tab: 'nope' }) });
    expect(screenKey(bare)).toBe('none|default');
  });
});

/**
 * Story 1-5a — the client switcher on Inventory: Stock and the Ledger tab
 * send the active client (server-side filter), show the chip, wait while the
 * clients load, ignore a stale or single-client pick without erasing it, and
 * narrow the Stock search's SKU codes to the active client. Batches is not
 * filtered and says "All clients".
 */
describe('story 1-5a — the client filter', () => {
  const GLOW = '0198f7a2-1b3c-7d4e-8f90-0000000a1001';
  const SKU_LIP = '0198f7a2-1b3c-7d4e-8f90-00000000c0a1';
  const storedKey = `${ACTIVE_CLIENT_STORAGE_KEY}:${T}:u-1`;
  const chip = () => view!.container.querySelector('[data-testid="client-filter-chip"]');
  beforeEach(() => {
    clients = [...clients, { id: GLOW, code: 'GLOW', name: 'GlowCo', systemOwned: false, status: 'active' }];
    SKUS.push({ ...sku(SKU_LIP, 'GC-LIP', 'GlowCo Lip Tint', false), clientId: GLOW });
  });
  afterEach(() => {
    SKUS.pop();
  });

  test('Stock under a stored client: the read carries clientId and the chip names the client', async () => {
    writeActiveClientId(T, 'u-1', GLOW);
    view = render(<InventoryScreen />);
    await settle();
    expect(stockReads().length).toBeGreaterThan(0);
    expect(stockReads().every((r) => r.params.clientId === GLOW)).toBe(true);
    expect(chip()?.textContent).toContain('Client: GLOW — GlowCo');
  });

  test('Stock search narrows the SKU codes to the active client', async () => {
    writeActiveClientId(T, 'u-1', GLOW);
    view = render(<InventoryScreen />);
    await settle();
    // The tenant's own SKU is not offered under GlowCo.
    await search('GLOW-SPF50-50');
    expect(panel().querySelector('[data-testid="search-miss"]')).not.toBeNull();
    await search('GC-LIP');
    expect(panel().querySelector('[data-testid="search-miss"]')).toBeNull();
    expect(stockReads().at(-1)!.params).toMatchObject({ skuId: SKU_LIP, clientId: GLOW });
  });

  test('a switch restarts the read for the new client; "Show all clients" drops clientId', async () => {
    view = render(<InventoryScreen />);
    await settle();
    expect(stockReads().at(-1)!.params.clientId).toBeUndefined();
    expect(chip()).toBeNull();
    await act(async () => {
      writeActiveClientId(T, 'u-1', GLOW);
    });
    await settle();
    expect(stockReads().at(-1)!.params.clientId).toBe(GLOW);
    await click(button('Show all clients'));
    expect(stockReads().at(-1)!.params.clientId).toBeUndefined();
    expect(localStorage.getItem(storedKey)).toBeNull();
  });

  test('while the clients load no stock read is sent; it goes out filtered once they arrive', async () => {
    writeActiveClientId(T, 'u-1', GLOW);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    overrides.push({
      match: (p) => p === `/api/v1/tenants/${T}/clients`,
      respond: async () => {
        await gate;
        return json(200, { items: clients });
      },
    });
    view = render(<InventoryScreen />);
    await settle();
    expect(stockReads()).toHaveLength(0);
    release();
    await settle();
    expect(stockReads().length).toBeGreaterThan(0);
    expect(stockReads().every((r) => r.params.clientId === GLOW)).toBe(true);
  });

  test('a failed clients read lists all clients and keeps the stored pick', async () => {
    writeActiveClientId(T, 'u-1', GLOW);
    overrides.push({ match: (p) => p === `/api/v1/tenants/${T}/clients`, respond: () => problem(500, 'boom') });
    view = render(<InventoryScreen />);
    await settle();
    expect(stockReads().length).toBeGreaterThan(0);
    expect(stockReads().every((r) => r.params.clientId === undefined)).toBe(true);
    expect(chip()).toBeNull();
    expect(localStorage.getItem(storedKey)).toBe(GLOW);
  });

  test('a stale stored client (not in the list) reads unfiltered and stays stored', async () => {
    const GONE = '0198f7a2-1b3c-7d4e-8f90-0000000a9999';
    writeActiveClientId(T, 'u-1', GONE);
    view = render(<InventoryScreen />);
    await settle();
    expect(stockReads().length).toBeGreaterThan(0);
    expect(stockReads().every((r) => r.params.clientId === undefined)).toBe(true);
    expect(chip()).toBeNull();
    expect(localStorage.getItem(storedKey)).toBe(GONE);
  });

  test('a single-client tenant never filters, even with a stored id', async () => {
    clients = clients.filter((c) => c.systemOwned);
    writeActiveClientId(T, 'u-1', GLOW);
    view = render(<InventoryScreen />);
    await settle();
    expect(stockReads().every((r) => r.params.clientId === undefined)).toBe(true);
    expect(chip()).toBeNull();
  });

  test('the Ledger tab sends the active client and shows the chip', async () => {
    writeActiveClientId(T, 'u-1', GLOW);
    view = render(<InventoryScreen initialTab="ledger" />);
    await settle();
    const events = requests.filter((r) => r.pathname.endsWith('/inventory/events'));
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((r) => r.params.clientId === GLOW)).toBe(true);
    expect(chip()?.textContent).toContain('Client: GLOW — GlowCo');
  });

  test('Batches is not filtered and says "All clients"', async () => {
    writeActiveClientId(T, 'u-1', GLOW);
    view = render(<InventoryScreen initialTab="batches" />);
    await settle();
    expect(view.container.querySelector('[data-testid="all-clients-note"]')?.textContent).toBe('All clients');
    expect(chip()).toBeNull();
  });
});

describe('story 2-4a — the damaged write-off', () => {
  const BIN_DMG = '0198f7a2-1b3c-7d4e-8f90-00000000b009';
  const DAMAGED_SPF = stockRow('s-9', BIN_DMG, 'DAMAGED', SKU_SPF, 6, true);
  const DAMAGED_SERUM = stockRow('s-10', BIN_DMG, 'DAMAGED', SKU_SERUM, 4, true);
  let posted: { pathname: string; body: Record<string, unknown>; key: string | null }[] = [];

  /** The router, plus DAMAGED rows in the stock read and a recorder for the adjustment POSTs. */
  function withDamaged(answer: () => Response): void {
    const routed = globalThis.fetch;
    posted = [];
    overrides.push({
      match: (pathname) => pathname.endsWith('/inventory/stock'),
      respond: () => json(200, { items: [...STOCK, DAMAGED_SPF, DAMAGED_SERUM], nextCursor: null }),
    });
    stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input.toString(), init);
      const url = new URL(request.url);
      if (request.method === 'POST' && url.pathname === `/api/v1/tenants/${T}/inventory/adjustments`) {
        posted.push({ pathname: url.pathname, body: (await request.clone().json()) as Record<string, unknown>, key: request.headers.get('Idempotency-Key') });
        return answer();
      }
      return routed(request);
    }) as unknown as typeof fetch);
  }

  async function type(selector: string, value: string): Promise<void> {
    const element = panel().querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const proto =
      element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    });
  }

  async function submitWriteOff(): Promise<void> {
    const form = panel().querySelector('form[data-testid="write-off"]') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
  }

  test('a DAMAGED row is labelled and offers Write off; the write-off sends a NEGATIVE damaged adjustment and re-reads', async () => {
    withDamaged(() => json(201, { event: { id: 'e-1', type: 'stock.adjusted' }, onHand: { quantity: 2 } }));
    view = render(<InventoryScreen />);
    await settle();
    expect(panelText()).toContain('Damaged (not sellable)');
    const offers = ([...panel().querySelectorAll('button')] as HTMLButtonElement[]).filter((b) => b.textContent === 'Write off');
    expect(offers).toHaveLength(2); // the two DAMAGED rows only
    const readsBefore = stockReads().length;
    await click(offers[0]!);
    await type('input[aria-label="Quantity to write off"]', '4');
    await submitWriteOff();
    // The note is required — nothing was sent.
    expect(posted).toHaveLength(0);
    expect(panelText()).toContain('Add a note');
    await type('textarea[aria-label="Write-off note"]', 'Crushed cartons scrapped');
    await submitWriteOff();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.body).toEqual({
      warehouseId: WH,
      skuId: SKU_SPF,
      binId: BIN_DMG,
      quantityDelta: -4,
      reasonCode: 'damaged',
      note: 'Crushed cartons scrapped',
    });
    expect(posted[0]!.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(panelText()).toContain('Written off');
    expect(stockReads().length).toBeGreaterThan(readsBefore);
  });

  test('a batch-tracked SKU lists the bin’s batches (binId sent) and writes off one batch with the override reason', async () => {
    withDamaged(() => json(201, { event: { id: 'e-2', type: 'stock.adjusted' }, onHand: { quantity: 0 } }));
    view = render(<InventoryScreen />);
    await settle();
    const offers = ([...panel().querySelectorAll('button')] as HTMLButtonElement[]).filter((b) => b.textContent === 'Write off');
    await click(offers[1]!); // the serum row (batch-tracked)
    const batchRead = batchListReads().at(-1)!;
    expect(batchRead.params).toEqual({ skuId: SKU_SERUM, binId: BIN_DMG });
    // Only batches holding stock are offered (LOT-B is at 0).
    const options = [...panel().querySelectorAll('select option')].map((o) => o.textContent ?? '');
    expect(options.some((o) => o.startsWith('LOT-A'))).toBe(true);
    expect(options.some((o) => o.startsWith('LOT-B'))).toBe(false);
    await type('select', 'LOT-A');
    await type('input[aria-label="Quantity to write off"]', '3');
    await type('textarea[aria-label="Write-off note"]', 'Leaking bottles');
    await submitWriteOff();
    expect(posted[0]!.body).toMatchObject({ quantityDelta: -3, batch: { code: 'LOT-A', overrideReason: 'damaged write-off' } });
  });

  test('over the threshold (202): Pending approval, with a link to the approval queue', async () => {
    withDamaged(() => json(202, { pendingAdjustment: { id: 'p-1', status: 'pending' } }));
    view = render(<InventoryScreen />);
    await settle();
    await click(([...panel().querySelectorAll('button')] as HTMLButtonElement[]).find((b) => b.textContent === 'Write off')!);
    await type('input[aria-label="Quantity to write off"]', '5');
    await type('textarea[aria-label="Write-off note"]', 'Water damage');
    await submitWriteOff();
    expect(panelText()).toContain('Pending approval');
    const link = panel().querySelector('a[href="/conflicts?queue=adjustment-pendings"]');
    expect(link?.textContent).toBe('Open the approval queue');
  });

  test('a refusal is worded by code, and the retry of the SAME draft reuses the key', async () => {
    let calls = 0;
    withDamaged(() => {
      calls += 1;
      return problem(400, 'damaged-bin-write-off-only');
    });
    view = render(<InventoryScreen />);
    await settle();
    await click(([...panel().querySelectorAll('button')] as HTMLButtonElement[]).find((b) => b.textContent === 'Write off')!);
    await type('input[aria-label="Quantity to write off"]', '1');
    await type('textarea[aria-label="Write-off note"]', 'Scrap');
    await submitWriteOff();
    await submitWriteOff();
    expect(calls).toBe(2);
    expect(posted[0]!.key).toBe(posted[1]!.key);
    expect(panelText()).toContain('The DAMAGED bin only takes a write-off');
    // An edit renews the key.
    await type('input[aria-label="Quantity to write off"]', '2');
    await submitWriteOff();
    expect(posted[2]!.key).not.toBe(posted[1]!.key);
  });

  test('EC6: a warehouse switch closes an open write-off and drops the last outcome banner', async () => {
    withDamaged(() => json(201, { event: { id: 'e-9', type: 'stock.adjusted' }, onHand: { quantity: 1 } }));
    view = render(<InventoryScreen />);
    await settle();
    const offer = () => ([...panel().querySelectorAll('button')] as HTMLButtonElement[]).filter((b) => b.textContent === 'Write off');
    await click(offer()[0]!);
    await type('input[aria-label="Quantity to write off"]', '1');
    await type('textarea[aria-label="Write-off note"]', 'Scrap');
    await submitWriteOff();
    expect(panelText()).toContain('Written off');
    await click(offer()[1]!);
    expect(panel().querySelector('form[data-testid="write-off"]')).not.toBeNull();
    await act(async () => {
      writeActiveWarehouseId(T, WH2);
    });
    await settle();
    expect(panel().querySelector('form[data-testid="write-off"]')).toBeNull();
    expect(panelText()).not.toContain('Written off');
  });

  test('a role without stock.adjust sees the DAMAGED rows but no Write off', async () => {
    writeSession({ ...session(), user: { ...session().user, role: 'accountant' } } as StoredSession);
    withDamaged(() => json(201, {}));
    view = render(<InventoryScreen />);
    await settle();
    expect(panelText()).toContain('Damaged (not sellable)');
    expect(([...panel().querySelectorAll('button')] as HTMLButtonElement[]).some((b) => b.textContent === 'Write off')).toBe(false);
  });
});

/**
 * Story 3-2a — the web stock adjustment: the Adjust row action (an inline
 * panel pre-filled for the row's bin and SKU, success → banner + re-read),
 * the Adjust tab (role-filtered, the blank form's pickers), the FEFO
 * preview and its cap, the batch Add dates, the 202 threshold outcome, and
 * the Idempotency-Key's lifetime.
 */
describe('story 3-2a — the stock adjustment', () => {
  let posted: { body: Record<string, unknown>; key: string | null }[] = [];

  /** The router plus a recorder for the adjustment POSTs, answered by `answer`. */
  function withAdjust(answer: () => Response | Promise<Response>): void {
    const routed = globalThis.fetch;
    posted = [];
    stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input.toString(), init);
      const url = new URL(request.url);
      if (request.method === 'POST' && url.pathname === `/api/v1/tenants/${T}/inventory/adjustments`) {
        posted.push({ body: (await request.clone().json()) as Record<string, unknown>, key: request.headers.get('Idempotency-Key') });
        return answer();
      }
      return routed(request);
    }) as unknown as typeof fetch);
  }

  const applied = (delta: number) => () =>
    json(201, {
      event: { id: 'e-1', seq: 7, type: 'stock.adjusted', skuId: SKU_SPF, binId: BIN_D2, quantityDelta: delta, occurredAt: 'x', recordedAt: 'x' },
      onHand: { quantity: 146 },
    });

  async function set(selector: string, value: string): Promise<void> {
    const element = panel().querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    if (element === null) throw new Error(`No element ${selector}`);
    const proto =
      element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    });
    await settle();
  }

  async function choose(label: string): Promise<void> {
    const radio = panel().querySelector(`input[type="radio"][aria-label="${label}"]`) as HTMLInputElement | null;
    if (radio === null) throw new Error(`No radio ${label}`);
    await act(async () => {
      radio.click();
    });
    await settle();
  }

  const form = () => panel().querySelector('form[data-testid="adjust-form"]') as HTMLFormElement | null;

  async function submitAdjust(): Promise<void> {
    await act(async () => {
      form()!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
  }

  const adjustButtons = () => ([...panel().querySelectorAll('button')] as HTMLButtonElement[]).filter((b) => b.textContent === 'Adjust');
  /** The Stock row's Adjust for the row with this id. */
  const adjustOn = (rowId: string) => panel().querySelector(`tr[data-row-id="${rowId}"] button`) as HTMLButtonElement;

  test('the row action: Adjust on bin D-01-02 / SPF, Remove 2 damaged with a note → −2 sent, "Adjusted", the ledger link, the row re-read', async () => {
    withAdjust(applied(-2));
    view = render(<InventoryScreen />);
    await settle();
    // Every storage-bin row offers Adjust; RECEIVING does not (decision 4).
    expect(adjustButtons()).toHaveLength(3);
    expect(panel().querySelector('tr[data-row-id="s-4"] button')).toBeNull();
    const readsBefore = stockReads().length;
    await click(adjustOn('s-2'));
    expect(form()).not.toBeNull();
    expect(form()!.textContent).toContain('Adjust GLOW-SPF50-50 in D-01-02 — 148 each on hand');
    // Pre-filled: no bin or SKU picker in the row panel.
    expect(form()!.querySelector('select[aria-label="Bin"]')).toBeNull();
    expect(form()!.querySelector('select[aria-label="SKU"]')).toBeNull();
    await choose('Remove');
    await set('input[aria-label="Quantity"]', '2');
    await set('select[aria-label="Reason"]', 'damaged');
    await set('textarea[aria-label="Note"]', 'Two crushed in the bin');
    await submitAdjust();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.body).toEqual({
      warehouseId: WH,
      skuId: SKU_SPF,
      binId: BIN_D2,
      quantityDelta: -2,
      reasonCode: 'damaged',
      note: 'Two crushed in the bin',
    });
    expect(posted[0]!.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    // onDone: the panel closes, the banner reads from the response, the list re-reads.
    expect(form()).toBeNull();
    const banner = panel().querySelector('[data-testid="adjust-outcome"]')!;
    expect(banner.textContent).toContain('Adjusted');
    expect(banner.textContent).toContain('GLOW-SPF50-50 −2 each in D-01-02.');
    const link = banner.querySelector('a')!;
    // `from` is a minute before the submit (decision 11's link, narrowed in time).
    expect(link.getAttribute('href')).toMatch(
      new RegExp(`^/inventory/ledger\\?list=ledger&warehouseId=${WH}&skuId=${SKU_SPF}&binId=${BIN_D2}&type=stock\\.adjusted&from=\\d{4}-\\d{2}-\\d{2}T`),
    );
    expect(stockReads().length).toBeGreaterThan(readsBefore);
  });

  test('over the threshold: Add 25 found → 202 "Pending approval — over the 10 threshold" with the queue link', async () => {
    withAdjust(() => json(202, { pendingAdjustment: { id: 'p-1', quantityDelta: 25, thresholdQuantityAtRequest: 10, status: 'pending' } }));
    view = render(<InventoryScreen />);
    await settle();
    await click(adjustOn('s-2'));
    await choose('Add');
    await set('input[aria-label="Quantity"]', '25');
    await set('select[aria-label="Reason"]', 'found');
    await set('textarea[aria-label="Note"]', 'Found a carton behind the rack');
    await submitAdjust();
    expect(posted[0]!.body).toMatchObject({ quantityDelta: 25, reasonCode: 'found' });
    const banner = panel().querySelector('[data-testid="adjust-outcome"]')!;
    expect(banner.textContent).toContain('Pending approval');
    expect(banner.textContent).toContain('Over the 10 threshold');
    expect(banner.querySelector('a')!.getAttribute('href')).toBe('/conflicts?queue=adjustment-pendings');
  });

  test('the key: a retry of the same draft reuses it, an edit mints a new one, a double submit sends once', async () => {
    let release: (() => void) | null = null;
    let calls = 0;
    withAdjust(() => {
      calls += 1;
      if (calls === 4) {
        return new Promise<Response>((resolve) => {
          release = () => resolve(applied(1)());
        });
      }
      return problem(422, 'insufficient-on-hand');
    });
    view = render(<InventoryScreen />);
    await settle();
    await click(adjustOn('s-2'));
    await choose('Remove');
    await set('input[aria-label="Quantity"]', '2');
    await set('select[aria-label="Reason"]', 'shrinkage');
    await set('textarea[aria-label="Note"]', 'Counted short');
    await submitAdjust();
    await submitAdjust();
    expect(posted).toHaveLength(2);
    expect(posted[1]!.key).toBe(posted[0]!.key);
    expect(form()!.textContent).toContain('holds fewer units than that now');
    // An edit renews the key.
    await set('input[aria-label="Quantity"]', '1');
    await submitAdjust();
    expect(posted[2]!.key).not.toBe(posted[1]!.key);
    // A double submit while the first is in flight sends one request.
    await set('textarea[aria-label="Note"]', 'Counted short again');
    await act(async () => {
      form()!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form()!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(posted).toHaveLength(4);
    await act(async () => {
      release!();
    });
    await settle();
    expect(panel().querySelector('[data-testid="adjust-outcome"]')?.textContent).toContain('Adjusted');
  });

  test('a batch-tracked Remove: the FEFO preview names LOT-A, the cap is its quantity, and no batch arm is sent', async () => {
    withAdjust(applied(-2));
    view = render(<InventoryScreen />);
    await settle();
    await click(adjustOn('s-1')); // GLOW-SERUM-30 in D-01-01, batch-tracked
    await choose('Remove');
    expect(batchListReads().at(-1)!.params).toEqual({ skuId: SKU_SERUM, binId: BIN_D1 });
    expect(panel().querySelector('[data-testid="fefo-preview"]')?.textContent).toBe('FEFO takes LOT-A (12 here).');
    await set('input[aria-label="Quantity"]', '13');
    await set('select[aria-label="Reason"]', 'damaged');
    await set('textarea[aria-label="Note"]', 'Broken seals');
    await submitAdjust();
    expect(posted).toHaveLength(0);
    expect(form()!.textContent).toContain('FEFO takes LOT-A (12 here) — remove at most 12, or pick a batch.');
    await set('input[aria-label="Quantity"]', '2');
    await submitAdjust();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.body).toEqual({ warehouseId: WH, skuId: SKU_SERUM, binId: BIN_D1, quantityDelta: -2, reasonCode: 'damaged', note: 'Broken seals' });
  });

  test('a batch-tracked Remove with an override: the picked batch and its reason are sent', async () => {
    withAdjust(applied(-1));
    view = render(<InventoryScreen />);
    await settle();
    await click(adjustOn('s-1'));
    await choose('Remove');
    await choose('Pick a batch');
    // Only batches with stock in the bin are offered (LOT-B holds 0 there).
    const options = [...panel().querySelectorAll('select[aria-label="Batch"] option')].map((o) => o.getAttribute('value'));
    expect(options).toEqual(['', 'LOT-A']);
    await set('select[aria-label="Batch"]', 'LOT-A');
    await set('input[aria-label="Quantity"]', '1');
    await set('select[aria-label="Reason"]', 'expired');
    expect(panel().querySelector('[data-testid="reason-hint"]')?.textContent).toBe('FEFO skips expired batches — pick the batch');
    await set('textarea[aria-label="Note"]', 'Expired lot');
    await submitAdjust();
    expect(posted).toHaveLength(0);
    expect(form()!.textContent).toContain('an override needs a reason');
    await set('input[aria-label="Override reason"]', 'The counted lot');
    await submitAdjust();
    expect(posted[0]!.body).toMatchObject({ quantityDelta: -1, batch: { code: 'LOT-A', overrideReason: 'The counted lot' } });
  });

  test('a batch-tracked Add: a new code sends its IST expiry as the Z instant; an existing code shows its dates and sends none', async () => {
    withAdjust(applied(5));
    view = render(<InventoryScreen />);
    await settle();
    await click(adjustOn('s-1'));
    await choose('Add');
    await set('input[aria-label="Batch code"]', 'LOT-A');
    expect(panel().querySelector('[data-testid="batch-dates"]')?.textContent).toContain('Existing batch — manufactured 01 Jan 2026, expires 01 Jan 2027. Its dates stay as recorded.');
    expect(panel().querySelector('input[aria-label="Expires"]')).toBeNull();
    await set('input[aria-label="Batch code"]', 'L9');
    expect(panel().querySelector('[data-testid="batch-dates"]')).toBeNull();
    await set('input[aria-label="Expires"]', '2027-03-31');
    await set('input[aria-label="Quantity"]', '5');
    await set('select[aria-label="Reason"]', 'found');
    await set('textarea[aria-label="Note"]', 'Unlabelled carton');
    await submitAdjust();
    expect(posted[0]!.body).toMatchObject({ quantityDelta: 5, batch: { code: 'L9', expiryDate: '2027-03-30T18:30:00.000Z' } });
  });

  test('the Adjust tab: the bin picker skips system bins; a dedicated bin offers its client\'s active non-kit SKUs only', async () => {
    const ACME = 'client-acme';
    const SKU_ACME = '0198f7a2-1b3c-7d4e-8f90-00000000c0b1';
    const SKU_KIT = '0198f7a2-1b3c-7d4e-8f90-00000000c0b2';
    const SKU_OFF = '0198f7a2-1b3c-7d4e-8f90-00000000c0b3';
    const active = (s: ReturnType<typeof sku>, clientId = 'client-self') => ({ ...s, status: 'active', clientId, catchWeightTracked: false, storageClass: 'ambient' });
    overrides.push({
      match: (p) => p === `/api/v1/tenants/${T}/catalog/skus`,
      respond: () =>
        json(200, {
          items: [
            ...SKUS.map((s) => active(s)),
            active(sku(SKU_ACME, 'ACME-TEE', 'Acme Tee', false), ACME),
            active(sku(SKU_KIT, 'ACME-BOX', 'Acme Box', false), ACME),
            { ...active(sku(SKU_OFF, 'ACME-OLD', 'Acme Old', false), ACME), status: 'inactive' },
          ],
          nextCursor: null,
        }),
    });
    overrides.push({
      match: (p) => p === `/api/v1/tenants/${T}/catalog/kits`,
      respond: () => json(200, { items: [{ skuId: SKU_KIT, code: 'ACME-BOX', name: 'Acme Box', components: [] }], nextCursor: null }),
    });
    overrides.push({
      match: (p) => /\/zones\/[^/]+\/bins$/.test(p),
      respond: () =>
        json(200, {
          items: [
            { ...BINS[0], retiredAt: null, dedicatedClientId: null, storageClass: 'ambient' },
            { ...BINS[1], retiredAt: null, dedicatedClientId: ACME, storageClass: 'ambient' },
            { ...BINS[2], retiredAt: null, dedicatedClientId: null, storageClass: 'ambient' },
          ],
          nextCursor: null,
        }),
    });
    withAdjust(applied(3));
    view = render(<InventoryScreen initialTab="adjust" />);
    await settle();
    expect(view.container.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab')).toBe('adjust');
    expect(panel().querySelector('h2')?.textContent).toBe('Adjust');
    // Mounting the tab sends no write.
    expect(posted).toHaveLength(0);
    const binOptions = [...panel().querySelectorAll('select[aria-label="Bin"] option')].map((o) => o.textContent);
    expect(binOptions).toEqual(['Pick the bin…', 'D-01-01', 'D-01-02']);
    await set('select[aria-label="Bin"]', BIN_D2);
    await choose('Add');
    const skuOptions = [...panel().querySelectorAll('select[aria-label="SKU"] option')].map((o) => o.getAttribute('value'));
    expect(skuOptions).toEqual(['', SKU_ACME]);
    await set('select[aria-label="SKU"]', SKU_ACME);
    await set('input[aria-label="Quantity"]', '3');
    await set('select[aria-label="Reason"]', 'found');
    await set('textarea[aria-label="Note"]', 'Found on the floor');
    await submitAdjust();
    expect(posted[0]!.body).toEqual({ warehouseId: WH, skuId: SKU_ACME, binId: BIN_D2, quantityDelta: 3, reasonCode: 'found', note: 'Found on the floor' });
    // The tab keeps the form: the outcome shows in place and the draft clears (keeping the bin).
    expect(panel().querySelector('[data-testid="adjust-outcome"]')?.textContent).toContain('Adjusted');
    expect((panel().querySelector('select[aria-label="Bin"]') as HTMLSelectElement).value).toBe(BIN_D2);
    expect((panel().querySelector('textarea[aria-label="Note"]') as HTMLTextAreaElement).value).toBe('');
  });

  test('the Adjust tab, Remove: the SKU list is what the bin holds (the bin read)', async () => {
    withAdjust(applied(-1));
    view = render(<InventoryScreen initialTab="adjust" />);
    await settle();
    await set('select[aria-label="Bin"]', BIN_D2);
    await choose('Remove');
    expect(stockReads().at(-1)!.params).toEqual({ binId: BIN_D2, nonZero: 'true', limit: '200' });
    const skuOptions = [...panel().querySelectorAll('select[aria-label="SKU"] option')].map((o) => o.textContent);
    expect(skuOptions).toEqual(['Pick the SKU…', 'GLOW-SPF50-50 — 148 each here', 'ROSE-OIL — 2.500 litre here']);
  });

  test('an operator: no Adjust tab, a deep link to ?tab=adjust reads "Your role cannot adjust stock" with no form, and no row action', async () => {
    writeSession({ ...session(), user: { ...session().user, role: 'operator' } } as StoredSession);
    view = render(<InventoryScreen initialTab="adjust" />);
    await settle();
    const tabs = [...view.container.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('data-tab'));
    expect(tabs).toEqual(['stock', 'batches', 'recalls', 'ledger']);
    // No tabpanel whose tab is missing: a labelled region instead (aria-labelledby never dangles).
    expect(view.container.querySelector('[role="tabpanel"]')).toBeNull();
    const region = view.container.querySelector('[role="region"][aria-label="Adjust"]')!;
    expect(region.querySelector('[data-testid="adjust-denied"]')?.textContent).toBe('Your role cannot adjust stock.');
    expect(region.querySelector('form')).toBeNull();
    view.unmount();
    view = render(<InventoryScreen />);
    await settle();
    expect(adjustButtons()).toHaveLength(0);
    expect([...panel().querySelectorAll('th')].map((th) => th.textContent)).not.toContain('Action');
    // Kit-ness is read only for a role that can adjust.
    expect(requests.some((r) => r.pathname.endsWith('/catalog/kits'))).toBe(false);
  });

  test('the 2-4a write-off gains the in-flight guard: a double submit sends one write-off', async () => {
    const BIN_DMG = '0198f7a2-1b3c-7d4e-8f90-00000000b009';
    overrides.push({
      match: (pathname) => pathname.endsWith('/inventory/stock'),
      respond: () => json(200, { items: [...STOCK, stockRow('s-9', BIN_DMG, 'DAMAGED', SKU_SPF, 6, true)], nextCursor: null }),
    });
    withAdjust(() => new Promise<Response>((resolve) => setTimeout(() => resolve(json(201, { event: { quantityDelta: -1 }, onHand: {} })), 5)));
    view = render(<InventoryScreen />);
    await settle();
    // The DAMAGED row offers Write off, never Adjust.
    expect(panel().querySelector('tr[data-row-id="s-9"] button')?.textContent).toBe('Write off');
    await click(panel().querySelector('tr[data-row-id="s-9"] button') as HTMLButtonElement);
    await set('input[aria-label="Quantity to write off"]', '1');
    await set('textarea[aria-label="Write-off note"]', 'Scrap');
    const writeOff = panel().querySelector('form[data-testid="write-off"]') as HTMLFormElement;
    await act(async () => {
      writeOff.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      writeOff.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await settle();
    expect(posted).toHaveLength(1);
  });

  test('while a row panel is sending, every row action is disabled', async () => {
    let release: (() => void) | null = null;
    withAdjust(() => new Promise<Response>((resolve) => {
      release = () => resolve(applied(-1)());
    }));
    view = render(<InventoryScreen />);
    await settle();
    await click(adjustOn('s-2'));
    await choose('Remove');
    await set('input[aria-label="Quantity"]', '1');
    await set('select[aria-label="Reason"]', 'shrinkage');
    await set('textarea[aria-label="Note"]', 'Short');
    await act(async () => {
      form()!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(adjustButtons().length).toBeGreaterThan(0);
    expect(adjustButtons().every((b) => b.disabled)).toBe(true);
    await act(async () => {
      release!();
    });
    await settle();
    expect(adjustButtons().every((b) => !b.disabled)).toBe(true);
  });

  test('a failed bins read says adjustments are unavailable, with Retry, instead of hiding the actions silently', async () => {
    overrides.push({ match: (p) => /\/zones\/[^/]+\/bins$/.test(p), respond: () => problem(500, 'boom') });
    view = render(<InventoryScreen />);
    await settle();
    const note = panel().querySelector('[data-testid="adjust-unavailable"]')!;
    expect(note.textContent).toContain('Adjustments unavailable');
    expect(note.querySelector('button')?.textContent).toBe('Retry');
    expect(adjustButtons()).toHaveLength(0);
  });

  test('the Adjust tab, Remove success: the bin and its batches are re-read, "N here" updates, the draft keeps bin + direction, the next edit clears the banner', async () => {
    let serumHere = 297;
    overrides.push({
      match: (p, q) => p.endsWith('/inventory/stock') && q.binId === BIN_D1,
      respond: () => json(200, { items: [stockRow('s-1', BIN_D1, 'D-01-01', SKU_SERUM, serumHere)], nextCursor: null }),
    });
    withAdjust(() => {
      serumHere = 295;
      return applied(-2)();
    });
    view = render(<InventoryScreen initialTab="adjust" />);
    await settle();
    await set('select[aria-label="Bin"]', BIN_D1);
    await choose('Remove');
    expect([...panel().querySelectorAll('select[aria-label="SKU"] option')].map((o) => o.textContent)).toContain('GLOW-SERUM-30 — 297 each here');
    await set('select[aria-label="SKU"]', SKU_SERUM);
    await set('input[aria-label="Quantity"]', '2');
    await set('select[aria-label="Reason"]', 'shrinkage');
    await set('textarea[aria-label="Note"]', 'Counted short');
    const stockBefore = stockReads().length;
    const batchesBefore = batchListReads().length;
    await submitAdjust();
    expect(posted).toHaveLength(1);
    expect(stockReads().length).toBeGreaterThan(stockBefore);
    expect(batchListReads().length).toBeGreaterThanOrEqual(batchesBefore);
    expect([...panel().querySelectorAll('select[aria-label="SKU"] option')].map((o) => o.textContent)).toContain('GLOW-SERUM-30 — 295 each here');
    expect(panel().querySelector('[data-testid="adjust-outcome"]')?.textContent).toContain('Adjusted');
    expect((panel().querySelector('select[aria-label="Bin"]') as HTMLSelectElement).value).toBe(BIN_D1);
    expect((panel().querySelector('input[aria-label="Remove"]') as HTMLInputElement).checked).toBe(true);
    // Picking the SKU again re-reads its batches (the FEFO preview's source) and clears the banner.
    await set('select[aria-label="SKU"]', SKU_SERUM);
    expect(batchListReads().length).toBeGreaterThan(batchesBefore);
    expect(panel().querySelector('[data-testid="adjust-outcome"]')).toBeNull();
  });

  test('the Adjust tab, Remove: a bin with no stock and a bin past one read are both said', async () => {
    overrides.push({
      match: (p, q) => p.endsWith('/inventory/stock') && q.binId === BIN_D1,
      respond: () => json(200, { items: [], nextCursor: null }),
    });
    overrides.push({
      match: (p, q) => p.endsWith('/inventory/stock') && q.binId === BIN_D2,
      respond: () => json(200, { items: [stockRow('s-2', BIN_D2, 'D-01-02', SKU_SPF, 148)], nextCursor: 'more' }),
    });
    view = render(<InventoryScreen initialTab="adjust" />);
    await settle();
    await set('select[aria-label="Bin"]', BIN_D1);
    await choose('Remove');
    expect(panelText()).toContain('D-01-01 holds no stock — choose Add, or pick another bin.');
    await set('select[aria-label="Bin"]', BIN_D2);
    expect(panelText()).toContain('This bin holds more SKUs than one read shows — the first 200 are listed.');
  });

  test('the Adjust tab, Add: the storage-class warning shows and does not block; catch-weight SKUs are not offered', async () => {
    const SKU_ICE = '0198f7a2-1b3c-7d4e-8f90-00000000c0c1';
    const SKU_FISH = '0198f7a2-1b3c-7d4e-8f90-00000000c0c2';
    overrides.push({
      match: (p) => p === `/api/v1/tenants/${T}/catalog/skus`,
      respond: () =>
        json(200, {
          items: [
            { ...sku(SKU_ICE, 'ICE-CREAM', 'Ice cream', false), storageClass: 'frozen', catchWeightTracked: false },
            { ...sku(SKU_FISH, 'FISH', 'Fish', false, 'kg', 3), storageClass: 'ambient', catchWeightTracked: true },
          ],
          nextCursor: null,
        }),
    });
    overrides.push({
      match: (p) => /\/zones\/[^/]+\/bins$/.test(p),
      respond: () => json(200, { items: [{ ...BINS[0], retiredAt: null, dedicatedClientId: null, storageClass: 'ambient' }], nextCursor: null }),
    });
    withAdjust(applied(1));
    view = render(<InventoryScreen initialTab="adjust" />);
    await settle();
    await set('select[aria-label="Bin"]', BIN_D1);
    await choose('Add');
    expect([...panel().querySelectorAll('select[aria-label="SKU"] option')].map((o) => o.getAttribute('value'))).toEqual(['', SKU_ICE]);
    await set('select[aria-label="SKU"]', SKU_ICE);
    expect(panel().querySelector('[data-testid="class-warning"]')?.textContent).toContain('ICE-CREAM is frozen stock and D-01-01 is a ambient bin');
    await set('input[aria-label="Quantity"]', '1');
    await set('select[aria-label="Reason"]', 'found');
    await set('textarea[aria-label="Note"]', 'Found');
    await submitAdjust();
    expect(posted).toHaveLength(1);
  });

  test('a FEFO tie names both batches in the preview', async () => {
    overrides.push({
      match: (p) => p.endsWith('/inventory/batches'),
      respond: () =>
        json(200, {
          items: [
            { id: BATCH_A, code: 'LOT-A', mfgDate: null, expiryDate: '2027-01-01T00:00:00.000Z', status: 'active', quantity: 4 },
            { id: BATCH_B, code: 'LOT-B', mfgDate: null, expiryDate: '2027-01-01T00:00:00.000Z', status: 'active', quantity: 6 },
          ],
        }),
    });
    view = render(<InventoryScreen />);
    await settle();
    await click(adjustOn('s-1'));
    await choose('Remove');
    expect(panel().querySelector('[data-testid="fefo-preview"]')?.textContent).toBe('FEFO takes LOT-A or LOT-B — same expiry (4 here).');
  });

  test('only an expired batch in the bin: FEFO is disabled, "Pick a batch" is forced, and the named batch is sent', async () => {
    overrides.push({
      match: (p) => p.endsWith('/inventory/batches'),
      respond: () =>
        json(200, { items: [{ id: BATCH_A, code: 'LOT-A', mfgDate: null, expiryDate: '2026-01-01T00:00:00.000Z', status: 'active', expired: true, quantity: 12 }] }),
    });
    withAdjust(applied(-1));
    view = render(<InventoryScreen />);
    await settle();
    await click(adjustOn('s-1'));
    await choose('Remove');
    const fefoRadio = panel().querySelector('input[aria-label="FEFO batch"]') as HTMLInputElement;
    expect(fefoRadio.disabled).toBe(true);
    expect((panel().querySelector('input[aria-label="Pick a batch"]') as HTMLInputElement).checked).toBe(true);
    expect(panel().querySelector('[data-testid="fefo-preview"]')?.textContent).toBe(
      'No unexpired, unblocked batch holds stock here — pick the batch to remove, with a reason.',
    );
    expect(panelText()).toContain('(expired)');
    await set('select[aria-label="Batch"]', 'LOT-A');
    await set('input[aria-label="Override reason"]', 'Expired lot scrapped');
    await set('input[aria-label="Quantity"]', '1');
    await set('select[aria-label="Reason"]', 'expired');
    await set('textarea[aria-label="Note"]', 'Expired');
    await submitAdjust();
    expect(posted[0]!.body).toMatchObject({ quantityDelta: -1, batch: { code: 'LOT-A', overrideReason: 'Expired lot scrapped' } });
  });

  test('a named batch the server no longer has (404 "Batch not found") reads the batch sentence and re-reads the batches', async () => {
    withAdjust(
      () =>
        new Response(JSON.stringify({ type: 'about:blank', title: 'Batch not found', status: 404, code: 'not-found', detail: 'x' }), {
          status: 404,
          headers: { 'content-type': 'application/problem+json' },
        }),
    );
    view = render(<InventoryScreen />);
    await settle();
    await click(adjustOn('s-1'));
    await choose('Remove');
    await choose('Pick a batch');
    await set('select[aria-label="Batch"]', 'LOT-A');
    await set('input[aria-label="Override reason"]', 'Counted lot');
    await set('input[aria-label="Quantity"]', '1');
    await set('select[aria-label="Reason"]', 'stock-count');
    await set('textarea[aria-label="Note"]', 'Count');
    const before = batchListReads().length;
    await submitAdjust();
    expect(form()!.textContent).toContain('Batch LOT-A no longer exists for this SKU — reload the batches and pick again.');
    expect(batchListReads().length).toBeGreaterThan(before);
  });

  test('a failed batches read says so, with Retry, and sends nothing', async () => {
    overrides.push({ match: (p) => p.endsWith('/inventory/batches'), respond: () => problem(500, 'boom') });
    withAdjust(applied(-1));
    view = render(<InventoryScreen />);
    await settle();
    await click(adjustOn('s-1'));
    await choose('Remove');
    expect(panelText()).toContain('The batches could not be read — retry.');
    await set('input[aria-label="Quantity"]', '1');
    await set('select[aria-label="Reason"]', 'damaged');
    await set('textarea[aria-label="Note"]', 'x');
    await submitAdjust();
    expect(posted).toHaveLength(0);
    expect(form()!.textContent).not.toContain('Still reading');
  });

  test('a kit or catch-weight row offers no Adjust', async () => {
    overrides.push({
      match: (p) => p === `/api/v1/tenants/${T}/catalog/kits`,
      respond: () => json(200, { items: [{ skuId: SKU_SPF, code: 'GLOW-SPF50-50', name: 'kit', components: [] }], nextCursor: null }),
    });
    overrides.push({
      match: (p) => p === `/api/v1/tenants/${T}/catalog/skus`,
      respond: () => json(200, { items: SKUS.map((s) => (s.id === SKU_OIL ? { ...s, catchWeightTracked: true } : s)), nextCursor: null }),
    });
    view = render(<InventoryScreen />);
    await settle();
    expect(panel().querySelector('tr[data-row-id="s-1"] button')?.textContent).toBe('Adjust');
    expect(panel().querySelector('tr[data-row-id="s-2"] button')).toBeNull(); // the kit
    expect(panel().querySelector('tr[data-row-id="s-3"] button')).toBeNull(); // catch-weight
  });
});
