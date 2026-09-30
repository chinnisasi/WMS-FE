import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { VarianceQueue } from './variance-queue';

/**
 * The escalated-variance review queue (story 5-5). The claims a `src/lib`
 * test cannot make:
 *   1. the resolve POST carries a fresh per-click `Idempotency-Key` and the
 *      statement body it built (the recount arm's `{decision:'recount'}`,
 *      the approve arm's sorted `consideredEventSeqs`),
 *   2. a 409 `variance-resolved` re-reads the queue (the reload IS that
 *      refusal's recovery, never a stranded card),
 *   3. two synchronous clicks on one row send exactly ONE POST (the
 *      re-entry guard runs before the disabled state renders),
 *   4. the ledger panel's checked seqs reach the approve_adjust body —
 *      the panel ticks the stubbed `/inventory/events` timeline,
 *   5. a role holding none of the tab's decision capability (an operator)
 *      renders the rows read-only — no buttons at all.
 *
 * Driven through a stubbed global `fetch` — the generated client is a
 * fetch wrapper — so the wiring under test is the one that ships.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-222222222222';
const ZONE_ID = '0198f7a2-1b3c-7d4e-8f90-333333333333';
const BIN_ID = '0198f7a2-1b3c-7d4e-8f90-444444444444';
const VARIANCE_ID = '0198f7a2-1b3c-7d4e-8f90-555555555555';
const SKU_ID = '0198f7a2-1b3c-7d4e-8f90-666666666666';

const OWNER_SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Priya Spices' },
  user: { id: 'u-1', email: 'priya@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

const OPERATOR_SESSION: StoredSession = { ...OWNER_SESSION, user: { ...OWNER_SESSION.user, role: 'operator' } };

function variance(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: VARIANCE_ID,
    tenantId: TENANT_ID,
    taskId: 'task-1',
    warehouseId: WAREHOUSE_ID,
    binId: BIN_ID,
    skuId: SKU_ID,
    epochConflict: false,
    expectedQuantity: 10,
    countedQuantity: 7,
    delta: -3,
    status: 'open',
    thresholdQuantity: 5,
    resolvedBy: null,
    resolvedAt: null,
    recountTaskId: null,
    consideredEventSeqs: null,
    createdAt: '2026-09-20T00:00:00.000Z',
    ...over,
  };
}

function event(seq: number): Record<string, unknown> {
  return {
    id: `ev-${seq}`,
    seq,
    type: 'stock.received',
    skuId: SKU_ID,
    fromBinId: null,
    toBinId: BIN_ID,
    quantityDelta: 4,
    batchRef: null,
    serialRef: null,
    referenceDoc: null,
    actorUserId: 'u-2',
    occurredAt: '2026-09-19T00:00:00.000Z',
    recordedAt: '2026-09-19T00:00:00.000Z',
    eventHash: 'h',
    createdAt: '2026-09-19T00:00:00.000Z',
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let requests: { method: string; pathname: string; query: string; body: unknown; headers: Record<string, string> }[] = [];
let varianceRows: Record<string, unknown>[] = [];
/** The next resolve answer; a forced non-200 simulates the 409 race arm. */
let nextResolveStatus = 200;
/** Makes the ledger timeline walk fail (the ledger Retry pin). */
let eventsFail = false;

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
        items: [{ id: SKU_ID, code: 'SPICE-01', uom: 'each', uomPrecision: 0, uomConversions: [] }],
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
      return json(200, { items: [{ id: ZONE_ID, code: 'A', name: 'Main hall' }], nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith('/bins')) {
      return json(200, { items: [{ id: BIN_ID, code: 'A-01', zoneId: ZONE_ID }], nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith('/movements/variances')) {
      return json(200, { items: varianceRows, nextCursor: null });
    }
    if (method === 'POST' && pathname.endsWith('/resolve')) {
      if (nextResolveStatus !== 200) {
        const status = nextResolveStatus;
        nextResolveStatus = 200;
        return json(status, {
          code: 'variance-resolved',
          title: 'Already resolved',
          status: 409,
          detail: 'This variance was resolved moments ago.',
        });
      }
      return json(200, {
        variance: variance({ status: 'recounted', recountTaskId: 'task-2', resolvedBy: 'u-1', resolvedAt: '2026-09-21T00:00:00.000Z' }),
      });
    }
    if (method === 'GET' && pathname.endsWith('/inventory/events')) {
      if (eventsFail) {
        return json(500, { code: 'internal-error', title: 'Ledger unavailable', status: 500 });
      }
      return json(200, { items: [event(7), event(11)], nextCursor: null });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  nextResolveStatus = 200;
  eventsFail = false;
  varianceRows = [variance()];
  stubRouter();
  writeSession(OWNER_SESSION);
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

async function mount(session: StoredSession = OWNER_SESSION): Promise<Rendered> {
  if (session !== null) writeSession(session);
  const rendered = render(<VarianceQueue />);
  await settle();
  return rendered;
}

function button(view: Rendered, label: string, scope?: HTMLElement | null): HTMLButtonElement {
  const element = (scope ?? view.container);
  const found = [...element.querySelectorAll('button')].find((b) => b.textContent === label);
  if (found === undefined) {
    throw new Error(`no button labeled "${label}"`);
  }
  return found as HTMLButtonElement;
}

function resolvePosts(): typeof requests {
  return requests.filter((r) => r.method === 'POST' && r.pathname.endsWith('/resolve'));
}

/** A request's header, looked up case-insensitively (fetch may keep the case). */
function header(record: (typeof requests)[number], name: string): string | undefined {
  return Object.entries(record.headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
}

describe('VarianceQueue: the resolve flow (story 5-5)', () => {
  test('the recount POST carries a fresh Idempotency-Key and the decision alone, then re-reads', async () => {
    view = await mount();
    const readsBefore = requests.filter((r) => r.pathname.endsWith('/movements/variances')).length;

    await click(button(view, 'Open a recount'));
    await settle();

    const posts = resolvePosts();
    expect(posts).toHaveLength(1);
    expect(header(posts[0]!, 'idempotency-key')).toBeDefined();
    expect(header(posts[0]!, 'idempotency-key')!.length).toBeGreaterThanOrEqual(26);
    expect(posts[0]!.body).toEqual({ decision: 'recount' });
    // The queue re-reads after the success — the reload IS the review flip.
    const readsAfter = requests.filter((r) => r.pathname.endsWith('/movements/variances')).length;
    expect(readsAfter).toBeGreaterThan(readsBefore);
  });

  test('a 409 variance-resolved renders the refresh copy AND re-reads the queue', async () => {
    view = await mount();
    nextResolveStatus = 409;
    const readsBefore = requests.filter((r) => r.pathname.endsWith('/movements/variances')).length;

    await click(button(view, 'Open a recount'));
    await settle();

    const banner = view.container.textContent ?? '';
    expect(banner).toContain('No recount opened');
    expect(banner).toContain('queue has refreshed');
    // The reload actually ran: one more list read after the refusal.
    expect(requests.filter((r) => r.pathname.endsWith('/movements/variances')).length).toBeGreaterThan(readsBefore);
  });

  test('two synchronous clicks on one row send exactly one POST', async () => {
    view = await mount();
    const recount = button(view, 'Open a recount');

    // Two clicks in the SAME tick — the disabled state cannot have rendered
    // between them, so the guard (not the disabled attribute) must absorb
    // the second click.
    await act(async () => {
      recount.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      recount.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await settle();

    expect(resolvePosts()).toHaveLength(1);
  });
});

describe('VarianceQueue: the ledger panel (story 5-5)', () => {
  test('the checked seqs reach the approve_adjust body, sorted, with the fresh key', async () => {
    view = await mount();
    // The bin-code join's card label, not a raw bin id.
    expect(view.container.textContent).toContain('A-01');

    await click(button(view, 'Ledger'));
    await settle();

    // The bin timeline the panel pulled: wire-real, bin-filtered.
    expect(
      requests.some(
        (r) => r.method === 'GET' && r.pathname.endsWith('/inventory/events') && r.query.includes(`binId=${BIN_ID}`),
      ),
    ).toBe(true);

    const checkboxes = [...view.container.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    expect(checkboxes).toHaveLength(2);
    await click(checkboxes[1]!);
    await click(checkboxes[0]!);
    await settle();
    expect(view.container.textContent).toContain('2 events selected');

    await click(button(view, 'Approve adjustment'));
    await settle();

    const posts = resolvePosts();
    expect(posts).toHaveLength(1);
    expect(header(posts[0]!, 'idempotency-key')).toBeDefined();
    // Ticked out of order; the body sends them normalized ascending — a
    // reordered retry stays a real replay.
    expect(posts[0]!.body).toEqual({ decision: 'approve_adjust', consideredEventSeqs: [7, 11] });
  });

  test('an empty selection keeps the approve button disabled — no unexplained adjustment', async () => {
    view = await mount();
    await click(button(view, 'Ledger'));
    await settle();

    const approve = button(view, 'Approve adjustment');
    expect(approve.disabled).toBe(true);
    expect(view.container.textContent).toContain('No events selected');
    expect(resolvePosts()).toHaveLength(0);
  });

  test('the ledger Retry re-runs the timeline walk (the revision bump)', async () => {
    view = await mount();
    await click(button(view, 'Ledger'));
    await settle();
    eventsFail = true;

    // Collapse and re-expand: the panel remounts and its fresh walk fails.
    await click(button(view, 'Hide ledger'));
    await click(button(view, 'Ledger'));
    await settle();
    expect(view.container.textContent).toContain('Ledger timeline unavailable');

    eventsFail = false;
    await click(button(view, 'Retry'));
    await settle();

    expect(view.container.textContent).toContain('#7');
    // The retry's re-read fired after the failure.
    expect(
      requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/inventory/events')).length,
    ).toBeGreaterThanOrEqual(3);
  });
});

describe('VarianceQueue: the read-only render (story 5-5)', () => {
  test('a role holding no variances.resolve sees the rows with no buttons', async () => {
    view = await mount(OPERATOR_SESSION);
    // The row still renders — flagged cards are never hidden.
    expect(view.container.textContent).toContain('SPICE-01');
    expect(view.container.textContent).toContain('Threshold 5');
    // The only buttons are the status tabs, never a decision affordance.
    const labels = [...view.container.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual(['Open', 'Adjusted', 'Recounted']);
  });
});