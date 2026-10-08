import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { writeActiveWarehouseId } from '../../lib/warehouses';
import { OverviewDashboard } from './overview-dashboard';

/**
 * The Overview (story 9-1), driven end to end through a stubbed `fetch` —
 * the generated client is a fetch wrapper, so the hook, the warehouse
 * resolution and the tile wiring under test are the ones that ship.
 *
 * Pins what a `src/lib` test cannot: the tiles render the server's figures
 * and link their drills; an unavailable tile reads the WORD; the stale
 * banner appears for `stale: true` AND for an old `asOf`, and not otherwise;
 * Refresh actually refetches; no warehouse → the Settings empty state.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const W1 = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';
const W2 = '0198f7a2-1b3c-7d4e-8f90-99aabbccdd02';

const NOW = new Date('2026-10-06T10:00:00.000Z');

const SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Priya Spices', gstin: null },
  user: { id: 'u-1', email: 'priya@example.com', role: 'ops_manager', status: 'active' },
  expiresAt: NOW.getTime() + 15 * 60_000,
};

const TODAY_FROM = '2026-10-05T18:30:00.000Z';
const D7_FROM = '2026-09-29T18:30:00.000Z';

function figure(value: number | null, apiPath: string, query: Record<string, string> = {}) {
  return { value, drill: { apiPath, query, reconciles: true } };
}

function windowed(today: number | null, d7: number | null, apiPath: string, query: Record<string, string> = {}) {
  return {
    today: figure(today, apiPath, { ...query, from: TODAY_FROM, to: NOW.toISOString() }),
    d7: figure(d7, apiPath, { ...query, from: D7_FROM, to: NOW.toISOString() }),
  };
}

function overview(warehouseId: string, overrides: { stale?: boolean; asOf?: string; pickState?: 'ok' | 'unavailable' } = {}) {
  const wh = `/tenants/${TENANT_ID}/warehouses/${warehouseId}`;
  const tn = `/tenants/${TENANT_ID}`;
  const ledger = `${wh}/inventory/events`;
  const pickUnavailable = overrides.pickState === 'unavailable';
  return {
    asOf: overrides.asOf ?? NOW.toISOString(),
    stale: overrides.stale ?? false,
    window: {
      todayFrom: TODAY_FROM,
      d7From: D7_FROM,
      to: NOW.toISOString(),
      lastHourFrom: new Date(NOW.getTime() - 3_600_000).toISOString(),
      last24hFrom: new Date(NOW.getTime() - 86_400_000).toISOString(),
    },
    tiles: {
      dockToStock: {
        state: 'ok',
        medianMinutes: windowed(42, 55.5, ledger, { type: 'putaway.placed' }),
        awaitingPutaway: figure(4, `${tn}/putaway/tasks`, { warehouseId }),
      },
      pickRate: {
        state: pickUnavailable ? 'unavailable' : 'ok',
        pickLines: windowed(pickUnavailable ? null : 17, pickUnavailable ? null : 120, ledger, { type: 'pick.picked' }),
        lastHour: figure(pickUnavailable ? null : 6, ledger, { type: 'pick.picked' }),
      },
      shortPicks: {
        state: 'ok',
        shortLines: windowed(3, 9, `${wh}/outbound/picklist-lines`, { status: 'short' }),
      },
      grnVariances: {
        state: 'ok',
        overReceipts: windowed(1, 2, `${tn}/receiving/over-receipts`, { warehouseId }),
        pendingOverReceipts: figure(1, `${tn}/receiving/over-receipts`, { warehouseId, status: 'pending' }),
        blindGrns: windowed(0, 1, `${tn}/receiving/goods-receipts`, { warehouseId, blind: 'true' }),
      },
      orderAccuracy: {
        state: 'ok',
        defectsPer1000: windowed(12.5, null, ledger, { type: 'dispatch.dispatched' }),
        shortLines: windowed(3, 9, `${wh}/outbound/picklist-lines`, { status: 'short' }),
        packFailures: windowed(2, 2, `${wh}/outbound/pack-failures`),
        dispatchedLines: windowed(400, 0, ledger, { type: 'dispatch.dispatched' }),
        countingSince: '2026-10-03T12:00:00.000Z',
      },
      oversell: {
        state: 'ok',
        backorderedOrders: windowed(5, 8, `${wh}/outbound/orders`, { source: 'ingested', backordered: 'true' }),
        prevented: windowed(1, 1, `${wh}/outbound/backorder-refusals`),
        countingSince: '2026-09-01T12:00:00.000Z',
      },
      expiryAlerts: {
        state: 'ok',
        openExpiryUpcoming: figure(7, `${tn}/replenishment/batch-alerts`, { warehouseId, kind: 'expiry_upcoming', status: 'open' }),
        openAged: figure(2, `${tn}/replenishment/batch-alerts`, { warehouseId, kind: 'aged', status: 'open' }),
        raised: windowed(1, 4, `${tn}/replenishment/batch-alerts`, { warehouseId }),
      },
      syncHealth: {
        state: 'ok',
        connections: [
          {
            integrationId: 'i-1',
            provider: 'shopify',
            status: 'connected',
            health: 'error',
            reason: 'ingest-warehouse-unset',
            lagSeconds: 600,
            ingestFailures24h: 3,
          },
        ],
        drill: { apiPath: `${tn}/channels/connections`, query: {}, reconciles: false },
      },
      dispatchPipeline: {
        state: 'ok',
        accepted: figure(11, `${wh}/outbound/orders`, { status: 'accepted' }),
        readyToDispatch: figure(4, `${wh}/outbound/orders`, { status: 'ready_to_dispatch' }),
        labelledNotManifested: figure(2, `${wh}/outbound/orders`, { status: 'ready_to_dispatch' }),
        ordersDispatched: windowed(30, 210, ledger, { type: 'dispatch.dispatched' }),
      },
      sm8: {
        state: 'ok',
        eligible: windowed(4, 10, `${tn}/eway/bills`, { warehouseId }),
        gatewayGenerated: windowed(0, 0, `${tn}/eway/bills`, { warehouseId, source: 'gateway' }),
        gatewayShare: windowed(0, 0, `${tn}/eway/bills`, { warehouseId, source: 'gateway' }),
        invoicesIssued: windowed(5, 20, `${tn}/invoices`, { warehouseId }),
        noManualPricingShare: windowed(0.8, 0.75, `${tn}/invoices`, { warehouseId }),
      },
    },
  };
}

let requests: string[] = [];
let warehouseRows: unknown[] = [];
let overviewFor: (warehouseId: string) => unknown = (w) => overview(w);
/** The next N overview reads answer this status instead of 200. */
let failNextOverviews = 0;
/** The pinned clock (Date.now / new Date()) — a test may move it forward. */
let clock = NOW.getTime();
/** Long timers (≥ 1 min) captured instead of scheduled — the fake timer arm. */
let longTimers: { fn: () => void; delay: number; cleared: boolean }[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname } = new URL(request.url);
    requests.push(`${request.method} ${pathname}`);
    const match = /\/warehouses\/([^/]+)\/reporting\/overview$/.exec(pathname);
    if (request.method === 'GET' && match !== null) {
      if (failNextOverviews > 0) {
        failNextOverviews -= 1;
        return json(500, { code: 'internal-error', title: 'Internal Server Error', status: 500 });
      }
      return json(200, overviewFor(match[1]!));
    }
    if (request.method === 'GET' && pathname.endsWith(`/tenants/${TENANT_ID}/warehouses`)) {
      return json(200, { items: warehouseRows, nextCursor: null });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

function pinnedDate(): DateConstructor {
  const Real = Date;
  const Pinned = function (this: unknown, ...args: unknown[]) {
    if (args.length === 0) return new Real(clock);
    return new (Real as unknown as new (...a: unknown[]) => Date)(...args);
  } as unknown as DateConstructor;
  Object.defineProperty(Pinned, 'prototype', { value: Real.prototype });
  Pinned.now = () => clock;
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

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  warehouseRows = [
    { id: W1, code: 'MAIN', name: 'Chennai DC' },
    { id: W2, code: 'NORTH', name: 'Delhi DC' },
  ];
  overviewFor = (w) => overview(w);
  failNextOverviews = 0;
  clock = NOW.getTime();
  longTimers = [];
  stubRouter();
  stubGlobal('Date', pinnedDate());
  // Long timers are captured, never scheduled; short ones (React, the
  // fetch plumbing) still run for real.
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  stubGlobal('setTimeout', ((fn: () => void, delay?: number, ...rest: unknown[]) => {
    if ((delay ?? 0) >= 60_000) {
      const entry = { fn, delay: delay!, cleared: false };
      longTimers.push(entry);
      return entry as unknown as ReturnType<typeof setTimeout>;
    }
    return realSetTimeout(fn, delay, ...rest);
  }) as unknown as typeof setTimeout);
  stubGlobal('clearTimeout', ((handle: unknown) => {
    const entry = longTimers.find((t) => t === handle);
    if (entry !== undefined) entry.cleared = true;
    else realClearTimeout(handle as ReturnType<typeof setTimeout>);
  }) as unknown as typeof clearTimeout);
  try {
    localStorage.clear();
  } catch {
    // happy-dom always has it
  }
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
});

async function mount(): Promise<Rendered> {
  writeSession(SESSION);
  const rendered = render(<OverviewDashboard health="ok · wms-be" />);
  await settle();
  return rendered;
}

const text = (r: Rendered) => r.container.textContent ?? '';
const overviewReads = () => requests.filter((r) => r.endsWith('/reporting/overview'));

describe('the tiles', () => {
  test('render the server figures, today with the 7-day line, and link their drills', async () => {
    view = await mount();
    const t = text(view);
    expect(t).toContain('As of ');
    expect(t).toContain('Short-picked lines');
    expect(t).toContain('7 days: 9');
    expect(t).toContain('42 min');
    expect(t).toContain('12.5 per 1,000');
    expect(t).toContain('7 days: No data'); // defects d7 null → No data, never 0
    expect(t).toContain('0%'); // SM-8 reads 0 until a live gateway
    expect(t).toContain('80%'); // the no-manual-pricing secondary share
    expect(t).toContain('No ingest warehouse set'); // sync reason as text
    expect(t).toContain('Error');
    expect(t).toContain('API health');

    const over = view.container.querySelector('[aria-label="Over-receipts: 1"]')!;
    expect(over.textContent).toContain('Today (IST)');
    const link = [...over.querySelectorAll('a')].find((a) => a.textContent === 'Open Conflicts & Reviews')!;
    const href = link.getAttribute('href')!;
    expect(href.startsWith('/conflicts?')).toBe(true);
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('warehouseId')).toBe(W1);
    expect(params.get('from')).toBe(TODAY_FROM);
    expect(params.get('to')).toBe(NOW.toISOString());
  });

  test('drills with no web screen (picklist lines, pack failures, refusals) render no link', async () => {
    view = await mount();
    const short = view.container.querySelector('[aria-label="Short-picked lines: 3"]')!;
    expect(short.querySelector('a')).toBeNull();
    const accuracy = view.container.querySelector('[aria-label^="Order accuracy"]')!;
    const hrefs = [...accuracy.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.includes('status=short'))).toBe(false);
    const oversell = view.container.querySelector('[aria-label^="Oversell"]')!;
    const labels = [...oversell.querySelectorAll('a')].map((a) => a.getAttribute('aria-label') ?? '');
    expect(labels.some((l) => l.includes('Prevented'))).toBe(false);
    // The orders drill beside it still links, and says where it goes.
    expect(labels.some((l) => l.startsWith('Open Outbound'))).toBe(true);
  });

  test('a live primary figure shows no 7-day line', async () => {
    view = await mount();
    const ready = view.container.querySelector('[aria-label="Ready to dispatch: 4"]')!;
    expect(ready.querySelector('.data.mt-1')).toBeNull();
    const expiry = view.container.querySelector('[aria-label="Open expiry alerts: 7"]')!;
    expect(expiry.textContent).not.toContain('7 days: 7');
  });

  test('the counting-since note, with the partial-window note only when inside the window', async () => {
    view = await mount();
    const notes = [...view.container.querySelectorAll('[data-testid="counting-since"]')].map((n) => n.textContent ?? '');
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain('Counting since');
    expect(notes[0]).toContain('covers only the days since counting began');
    expect(notes[1]).not.toContain('covers only');
  });

  test('an unavailable tile reads the word Unavailable', async () => {
    overviewFor = (w) => overview(w, { stale: true, pickState: 'unavailable' });
    view = await mount();
    const pick = view.container.querySelector('[aria-label="Pick lines: Unavailable"]')!;
    expect(pick).not.toBeNull();
    expect(pick.textContent).toContain('Unavailable');
    expect(pick.textContent).not.toContain('Last hour');
  });
});

describe('the stale banner', () => {
  const banner = (r: Rendered) => r.container.querySelector('[role="status"][data-tone="warning"]');

  test('absent on a fresh, complete read', async () => {
    view = await mount();
    expect(banner(view)).toBeNull();
  });

  test('shown when the server says stale', async () => {
    overviewFor = (w) => overview(w, { stale: true });
    view = await mount();
    expect(banner(view)).not.toBeNull();
    expect(banner(view)!.textContent).toContain('Unavailable');
  });

  test('shown when asOf is more than 5 minutes old, even with stale false', async () => {
    overviewFor = (w) => overview(w, { asOf: new Date(NOW.getTime() - 6 * 60_000).toISOString() });
    view = await mount();
    expect(banner(view)).not.toBeNull();
    expect(banner(view)!.textContent).toContain('more than 5 minutes old');
  });

  test('appears by itself once asOf crosses 5 minutes — one timer re-renders, nothing refetches', async () => {
    view = await mount();
    expect(banner(view)).toBeNull();
    // (The session-expiry watchdog is the other long timer; the age timer
    // is the one due exactly at asOf + 5 min.)
    const live = longTimers.filter((t) => !t.cleared && t.delay === 5 * 60_000 + 1);
    expect(live).toHaveLength(1);
    clock = NOW.getTime() + 5 * 60_000 + 1;
    await act(async () => {
      live[0]!.fn();
    });
    expect(banner(view)).not.toBeNull();
    expect(banner(view)!.textContent).toContain('more than 5 minutes old');
    expect(overviewReads()).toHaveLength(1);
  });

  test('the age timer is cleared on unmount', async () => {
    view = await mount();
    const timer = longTimers.find((t) => !t.cleared && t.delay === 5 * 60_000 + 1)!;
    view.unmount();
    view = undefined;
    expect(timer.cleared).toBe(true);
  });

  test('Refresh refetches the overview', async () => {
    overviewFor = (w) => overview(w, { stale: true });
    view = await mount();
    expect(overviewReads()).toHaveLength(1);
    const refresh = banner(view)!.querySelector('button')!;
    expect(refresh.textContent).toBe('Refresh');
    overviewFor = (w) => overview(w);
    await act(async () => {
      refresh.click();
    });
    await settle();
    expect(overviewReads()).toHaveLength(2);
    expect(banner(view)).toBeNull();
  });
});

describe('a failed read', () => {
  test('renders ReadFailure, and Retry refetches and renders the tiles', async () => {
    failNextOverviews = 1;
    view = await mount();
    expect(text(view)).toContain('Overview unavailable');
    const retry = [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Retry')!;
    expect(retry).toBeDefined();
    await act(async () => {
      retry.click();
    });
    await settle();
    expect(overviewReads()).toHaveLength(2);
    expect(view.container.querySelector('[aria-label="Short-picked lines: 3"]')).not.toBeNull();
    expect(text(view)).not.toContain('Overview unavailable');
  });
});

describe('the warehouse', () => {
  test('a switch while mounted reads the new warehouse and renders its tiles', async () => {
    overviewFor = (w) => (w === W2 ? overview(w, { stale: true, pickState: 'unavailable' }) : overview(w));
    view = await mount();
    expect(view.container.querySelector('[aria-label="Pick lines: 17"]')).not.toBeNull();
    await act(async () => {
      writeActiveWarehouseId(TENANT_ID, W2);
    });
    await settle();
    expect(overviewReads()).toEqual([
      `GET /api/v1/tenants/${TENANT_ID}/warehouses/${W1}/reporting/overview`,
      `GET /api/v1/tenants/${TENANT_ID}/warehouses/${W2}/reporting/overview`,
    ]);
    expect(view.container.querySelector('[aria-label="Pick lines: Unavailable"]')).not.toBeNull();
    expect(text(view)).toContain('NORTH Delhi DC');
  });

  test('reads the active warehouse when it belongs to the tenant', async () => {
    writeSession(SESSION);
    writeActiveWarehouseId(TENANT_ID, W2);
    view = render(<OverviewDashboard health="ok" />);
    await settle();
    expect(overviewReads()).toEqual([`GET /api/v1/tenants/${TENANT_ID}/warehouses/${W2}/reporting/overview`]);
  });

  test('else the first warehouse', async () => {
    view = await mount();
    expect(overviewReads()).toEqual([`GET /api/v1/tenants/${TENANT_ID}/warehouses/${W1}/reporting/overview`]);
  });

  test('no warehouse → an empty state linking to Settings, and no overview read', async () => {
    warehouseRows = [];
    view = await mount();
    const empty = view.container.querySelector('[data-testid="overview-empty"]')!;
    expect(empty).not.toBeNull();
    expect(empty.querySelector('a')!.getAttribute('href')).toBe('/settings');
    expect(overviewReads()).toHaveLength(0);
  });
});
