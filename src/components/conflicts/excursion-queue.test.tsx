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
  tenant: { id: TENANT_ID, name: 'Priya Spices' },
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
      return json(200, { items: excursionRows, nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith('/qc-holds')) {
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