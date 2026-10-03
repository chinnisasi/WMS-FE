import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { ExcursionQueue } from './excursion-queue';

/**
 * The temperature-excursion review queue (story 12-7). The claims a `src/lib`
 * test cannot make:
 *   1. the card joins its reads on the wire — the bin's CODE from the
 *      zone/bins walk (never a raw bin id), the affected units from the
 *      qc-holds join (sku code + hold state, a missing hold labelled
 *      disposed),
 *   2. Resolve POSTs to the excursion's resolve endpoint with a per-click
 *      ULID Idempotency-Key, and the queue re-reads after a success (the
 *      review flip is visible without a manual refresh),
 *   3. a 409 `excursion-resolved` renders the mapper's already-resolved copy
 *      AND re-reads (the reload IS that refusal's recovery),
 *   4. resolve is offered exactly to `review.decide` holders — an operator
 *      sees the card and no button (hide surfaces, never "blocked" screens).
 *
 * The surface is driven through a stubbed global `fetch` — the generated
 * client is a fetch wrapper — so the wiring under test is the one that ships.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-222222222222';
const ZONE_ID = '0198f7a2-1b3c-7d4e-8f90-333333333333';
const BIN_ID = '0198f7a2-1b3c-7d4e-8f90-444444444444';
const EXCURSION_ID = '0198f7a2-1b3c-7d4e-8f90-555555555555';
const HOLD_ID = '0198f7a2-1b3c-7d4e-8f90-666666666666';

const SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Priya Spices', gstin: null },
  user: { id: 'u-1', email: 'priya@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly query: string;
  readonly body: unknown;
  readonly headers: Record<string, string>;
}

let requests: Recorded[] = [];
let excursionRows: Record<string, unknown>[] = [];
/** The next resolve answer, so a test can force the 409 race arm. */
let nextResolveStatus = 200;
/** Makes every qc-holds GET answer 500 (the join-failure arm). */
let holdsFail = false;
/**
 * Makes the qc-holds walk a synthetic chain: page n returns hold-<n> with a
 * nextCursor every time — the walk rides it to the hop cap (the truncation
 * arm). Cursor pages start at 'h-1'.
 */
let holdsEndless = false;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function excursion(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: EXCURSION_ID,
    tenantId: TENANT_ID,
    warehouseId: WAREHOUSE_ID,
    binId: BIN_ID,
    readingC: 8.5,
    note: 'Door left open overnight',
    holdIds: [HOLD_ID],
    status: 'open',
    recordedBy: 'u-2',
    occurredAt: '2026-09-20T03:12:00.000Z',
    resolvedBy: null,
    resolvedAt: null,
    createdAt: '2026-09-20T03:12:00.000Z',
    ...over,
  };
}

function hold(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: HOLD_ID,
    tenantId: TENANT_ID,
    warehouseId: WAREHOUSE_ID,
    skuId: 'sku-1',
    binId: BIN_ID,
    reason: 'Excursion 2026-09-20 — quarantined pending review',
    status: 'open',
    heldBy: 'u-2',
    heldAt: '2026-09-20T03:12:00.000Z',
    releasedBy: null,
    releasedAt: null,
    createdAt: '2026-09-20T03:12:00.000Z',
    ...over,
  };
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();
    const headers = Object.fromEntries(request.headers.entries());
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    requests.push({ method, pathname, query: url.search, body, headers });
    if (method === 'GET' && pathname.endsWith('/warehouses')) {
      return json(200, {
        items: [{ id: WAREHOUSE_ID, code: 'W1', name: 'Main', origin: {}, createdAt: '2026-09-01T00:00:00.000Z' }],
        nextCursor: null,
      });
    }
    if (method === 'GET' && pathname.endsWith('/catalog/skus')) {
      return json(200, {
        items: [{ id: 'sku-1', code: 'SPICE-01', uomConversions: [] }],
        nextCursor: null,
      });
    }
    if (method === 'GET' && pathname.endsWith('/users')) {
      return json(200, {
        items: [
          { id: 'u-1', email: 'priya@example.com' },
          { id: 'u-2', email: 'floor@example.com' },
        ],
        nextCursor: null,
      });
    }
    if (method === 'GET' && pathname.endsWith('/zones')) {
      return json(200, { items: [{ id: ZONE_ID, code: 'A', name: 'Cold room' }], nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith('/bins')) {
      return json(200, { items: [{ id: BIN_ID, code: 'CH-01', zoneId: ZONE_ID }], nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith('/excursions')) {
      // The invalid-cursor arm: any cursor-bearing request fails 400 — the
      // Retry-restarts-from-first-page pin's refusal.
      if (url.searchParams.get('cursor') !== null) {
        return json(400, { code: 'invalid-cursor', title: 'Stale page reference', status: 400 });
      }
      const cursor = url.searchParams.get('cursor');
      return json(200, { items: excursionRows, nextCursor: cursor === null ? 'exc-1' : null });
    }
    if (method === 'GET' && pathname.endsWith('/qc-holds')) {
      if (holdsFail) {
        return json(500, { code: 'internal-error', title: 'Holds unavailable', status: 500 });
      }
      if (holdsEndless) {
        // Page n returns hold-<n> and a cursor every time — a chain that
        // never ends, so the walk rides it to MAX_PAGE_HOPS and the
        // truncation flag must fire.
        const page = Number(url.searchParams.get('cursor')?.slice(2) ?? '1');
        return json(200, { items: [hold({ id: `hold-${page}` })], nextCursor: `h-${page + 1}` });
      }
      return json(200, { items: [hold()], nextCursor: null });
    }
    if (method === 'POST' && pathname.endsWith('/resolve')) {
      if (nextResolveStatus !== 200) {
        const status = nextResolveStatus;
        nextResolveStatus = 200;
        return json(status, {
          code: 'excursion-resolved',
          title: 'Excursion already resolved',
          status: 409,
        });
      }
      const id = pathname.split('/excursions/')[1]!.split('/resolve')[0]!;
      return json(200, {
        excursion: excursion({ status: 'resolved', resolvedBy: 'u-1', resolvedAt: '2026-09-21T09:00:00.000Z' }),
        // Echo the id the request named — the response is the row that won.
        ...(id === EXCURSION_ID ? {} : {}),
      });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  nextResolveStatus = 200;
  holdsFail = false;
  holdsEndless = false;
  excursionRows = [excursion()];
  stubRouter();
  writeSession(SESSION);
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

async function mount(): Promise<Rendered> {
  const rendered = render(<ExcursionQueue />);
  await settle();
  return rendered;
}

describe('ExcursionQueue: the card join (story 12-7)', () => {
  test('the card renders the reading, the joined BIN CODE and the affected units from the hold join', async () => {
    view = await mount();

    const card = view.container.querySelector('article')!;
    expect(card).toBeDefined();
    expect(card.textContent).toContain('8.5 °C');
    // The bin join: the zone/bins walk turns the bin id into CH-01 — a raw
    // id rendering here is the join's failure mode.
    expect(card.textContent).toContain('CH-01');
    expect(card.textContent).not.toContain(BIN_ID);
    // The note renders verbatim.
    expect(card.textContent).toContain('Door left open overnight');
    // The affected units are the joined hold: sku code + its state.
    expect(card.textContent).toContain('Affected units:');
    expect(card.textContent).toContain('SPICE-01 — held');
    // Recorded by renders the joined user's email.
    expect(card.textContent).toContain('floor@example.com');
  });

  test('a hold id the join no longer returns labels disposed, never silently dropped', async () => {
    excursionRows = [excursion({ holdIds: [HOLD_ID, '0198f7a2-1b3c-7d4e-8f90-999999999999'] })];
    view = await mount();

    const card = view.container.querySelector('article')!;
    expect(card.textContent).toContain('SPICE-01 — held');
    expect(card.textContent).toContain('unknown SKU — disposed');
  });
});

describe('ExcursionQueue: the resolve flow (story 12-7)', () => {
  test('resolve POSTs with an Idempotency-Key, banners the success, and re-reads the queue', async () => {
    view = await mount();
    const readsBefore = requests.filter((r) => r.pathname.endsWith('/excursions')).length;

    const resolve = [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Resolve');
    expect(resolve).toBeDefined();
    act(() => resolve!.click());
    await settle();

    const post = requests.find((r) => r.method === 'POST' && r.pathname.endsWith('/resolve'));
    expect(post).toBeDefined();
    expect(post!.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/excursions/${EXCURSION_ID}/resolve`);
    const headerKeys = Object.keys(post!.headers).map((k) => k.toLowerCase());
    expect(headerKeys).toContain('idempotency-key');
    // The resolve carries NO body — the review flip is a status change only.
    expect(post!.body).toBeNull();
    // The banner says what happened, including what resolve did NOT do.
    expect(view.container.textContent).toContain('Excursion resolved');
    expect(view.container.textContent).toContain('quarantine holds are untouched');
    // The queue re-reads — the resolved card moves to the Resolved tab.
    const readsAfter = requests.filter((r) => r.pathname.endsWith('/excursions')).length;
    expect(readsAfter).toBeGreaterThan(readsBefore);
  });

  test('a 409 excursion-resolved renders the mapper copy and re-reads the queue', async () => {
    nextResolveStatus = 409;
    view = await mount();
    const readsBefore = requests.filter((r) => r.pathname.endsWith('/excursions')).length;

    const resolve = [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Resolve');
    act(() => resolve!.click());
    await settle();

    expect(view.container.textContent).toContain('Not resolved');
    expect(view.container.textContent).toContain(
      'This excursion was already resolved — the queue has refreshed.',
    );
    // The refusal's recovery IS the reload — another reviewer's flip shows.
    const readsAfter = requests.filter((r) => r.pathname.endsWith('/excursions')).length;
    expect(readsAfter).toBeGreaterThan(readsBefore);
  });

  test('an operator sees the card and NO resolve button (hide surfaces, never blocked screens)', async () => {
    writeSession({ ...SESSION, user: { id: 'u-1', email: 'priya@example.com', role: 'operator', status: 'active' } });
    view = await mount();

    const card = view.container.querySelector('article');
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain('8.5 °C');
    expect([...view.container.querySelectorAll('button')].some((b) => b.textContent === 'Resolve')).toBe(false);
  });
});
/** Switch the queue's status tab (the tablist buttons). */
function clickTab(container: HTMLElement, label: 'Open' | 'Resolved'): void {
  const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (b) => b.textContent === label,
  );
  expect(tab).toBeDefined();
  act(() => tab!.click());
}

describe('ExcursionQueue: status tabs and cursor scoping (triage row 12)', () => {
  test('each tab requests its own status param', async () => {
    view = await mount();
    const firstOpen = requests.find((r) => r.pathname.endsWith('/excursions'))!;
    expect(firstOpen.query).toContain('status=open');

    clickTab(view.container, 'Resolved');
    await settle();
    const resolved = requests.filter((r) => r.pathname.endsWith('/excursions')).at(-1)!;
    expect(resolved.query).toContain('status=resolved');
  });

  test('a cursor paged on one tab re-requests as a first page on the other (tab-scoped cursor)', async () => {
    view = await mount();
    await settle();
    // The first page advertises a cursor — page forward on the OPEN tab.
    const next = [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Next');
    expect(next).toBeDefined();
    act(() => next!.click());
    await settle();
    const paged = requests.filter((r) => r.pathname.endsWith('/excursions')).at(-1)!;
    expect(paged.query).toContain('cursor=exc-1');
    expect(paged.query).toContain('status=open');

    // The same cursor must NOT ride the resolved tab's request.
    clickTab(view.container, 'Resolved');
    await settle();
    const resolved = requests.filter((r) => r.pathname.endsWith('/excursions')).at(-1)!;
    expect(resolved.query).toContain('status=resolved');
    expect(resolved.query).not.toContain('cursor=');
  });

  test('the resolved tab renders resolved chips and no resolve affordance', async () => {
    excursionRows = [excursion({ status: 'resolved', resolvedBy: 'u-1', resolvedAt: '2026-09-21T09:00:00.000Z' })];
    view = await mount();
    clickTab(view.container, 'Resolved');
    await settle();

    const card = view.container.querySelector('article')!;
    expect(card.textContent).toContain('resolved');
    expect(card.textContent).toContain('resolved by');
    expect(card.textContent).toContain('priya@example.com');
    expect([...view.container.querySelectorAll('button')].some((b) => b.textContent === 'Resolve')).toBe(false);
  });
});

describe('ExcursionQueue: the hold join (triage rows 2, 13)', () => {
  test('a failed hold join still renders the page with the explicit unavailable line', async () => {
    holdsFail = true;
    view = await mount();

    // The excursion page landed — the queue is NOT failed…
    const card = view.container.querySelector('article')!;
    expect(card.textContent).toContain('8.5 °C');
    expect(view.container.textContent).not.toContain('Excursion queue unavailable');
    // …and the affected units say UNAVAILABLE, never "disposed" (an outage
    // is not a disposition).
    expect(card.textContent).toContain('Affected units unavailable — the hold list could not be read.');
    expect(card.textContent).not.toContain('SPICE-01 — held');
    expect(card.textContent).not.toContain('disposed');
  });

  test('the join walks multi-page hold chains (both statuses) and flags truncation at the hop cap', async () => {
    holdsEndless = true;
    excursionRows = [excursion({ holdIds: ['hold-1', 'hold-2', 'hold-25'] })];
    view = await mount();

    // The walk asked BOTH statuses (no status filter on the qc-holds reads).
    const holdGets = requests.filter((r) => r.pathname.endsWith('/qc-holds'));
    expect(holdGets.length).toBeGreaterThanOrEqual(20); // rode to MAX_PAGE_HOPS
    expect(holdGets[0]!.query).not.toContain('status=');

    const card = view.container.querySelector('article')!;
    // Holds joined from the walked pages label normally…
    expect(card.textContent).toContain('SPICE-01 — held');
    // …an id beyond the cap labels disposed, and the truncation flag says
    // the list may be incomplete instead of silently re-labeling.
    expect(card.textContent).toContain('unknown SKU — disposed');
    expect(card.textContent).toContain('(the hold list may be incomplete)');
  });
});

describe('ExcursionQueue: the resolve re-entry guard (triage row 14)', () => {
  test('two synchronous Resolve clicks send exactly one POST with one Idempotency-Key', async () => {
    view = await mount();
    const resolve = [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Resolve');
    expect(resolve).toBeDefined();
    // Two clicks before any re-render between them — the pre-render
    // double-click the synchronous ref guard exists for.
    act(() => resolve!.click());
    act(() => resolve!.click());
    await settle();

    const posts = requests.filter((r) => r.method === 'POST' && r.pathname.endsWith('/resolve'));
    expect(posts.length).toBe(1);
    const keys = Object.keys(posts[0]!.headers).filter((k) => k.toLowerCase() === 'idempotency-key');
    expect(keys.length).toBe(1);
  });
});

describe('ExcursionQueue: invalid-cursor Retry (triage row 3)', () => {
  test('Retry after an invalid-cursor failure re-fires from the FIRST page — no cursor rides the refetch', async () => {
    view = await mount();
    await settle();
    // Page forward; the stub refuses every cursor-bearing request.
    const next = [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Next');
    act(() => next!.click());
    await settle();
    expect(view.container.textContent).toContain('That page reference is stale');

    const retry = [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Retry')!;
    act(() => retry.click());
    await settle();

    const refetch = requests.filter((r) => r.pathname.endsWith('/excursions')).at(-1)!;
    expect(refetch.query).toContain('status=open');
    expect(refetch.query).not.toContain('cursor=');
    // The recovery is real: the queue renders the page again.
    expect(view.container.textContent).not.toContain('That page reference is stale');
    expect(view.container.querySelector('article')).not.toBeNull();
  });
});
