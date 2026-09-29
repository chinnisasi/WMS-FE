import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { AdjustmentPendingsQueue } from './adjustment-pendings-queue';

/**
 * The adjustment-pendings queue (story 5-5; the 5-2 flow's consumer). The
 * claims a `src/lib` test cannot make:
 *   1. a decide POST hits the pend's approve/reject path with a fresh
 *      per-click `Idempotency-Key` and no body,
 *   2. a 409 `adjustment-pending-decided` (and a bare 409 `conflict` — the
 *      mapper's conflict copy promises a refresh) re-reads the queue,
 *   3. two synchronous clicks on one row send exactly ONE POST,
 *   4. a role holding none of the tab's decision capability (an operator —
 *      adjustments.approve is owner-only) renders the rows read-only.
 *
 * Driven through a stubbed global `fetch` — the generated client is a
 * fetch wrapper — so the wiring under test is the one that ships.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-222222222222';
const ZONE_ID = '0198f7a2-1b3c-7d4e-8f90-333333333333';
const BIN_ID = '0198f7a2-1b3c-7d4e-8f90-444444444444';
const PENDING_ID = '0198f7a2-1b3c-7d4e-8f90-555555555555';
const SKU_ID = '0198f7a2-1b3c-7d4e-8f90-666666666666';

const OWNER_SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Priya Spices' },
  user: { id: 'u-1', email: 'priya@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

const OPERATOR_SESSION: StoredSession = { ...OWNER_SESSION, user: { ...OWNER_SESSION.user, role: 'operator' } };

function pending(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PENDING_ID,
    tenantId: TENANT_ID,
    warehouseId: WAREHOUSE_ID,
    binId: BIN_ID,
    skuId: SKU_ID,
    quantityDelta: 5,
    reasonCode: 'damage',
    note: 'Crushed carton found while staging',
    batchOverrideReason: null,
    batchId: null,
    serialIds: null,
    handlingUnitIds: null,
    occurredAt: '2026-09-20T00:00:00.000Z',
    requestedBy: 'u-2',
    requestedAt: '2026-09-20T00:01:00.000Z',
    status: 'pending',
    decidedBy: null,
    decidedAt: null,
    thresholdQuantityAtRequest: 2,
    ...over,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let requests: { method: string; pathname: string; query: string; body: unknown; headers: Record<string, string> }[] = [];
let pendingRows: Record<string, unknown>[] = [];
/** The next decide answer; a non-null setting simulates the 409 race arms. */
let nextDecideStatus: { status: number; code: string } | null = null;

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
    if (method === 'GET' && pathname.endsWith('/inventory/adjustment-pendings')) {
      return json(200, { items: pendingRows, nextCursor: null });
    }
    if (method === 'POST' && (pathname.endsWith('/approve') || pathname.endsWith('/reject'))) {
      if (nextDecideStatus !== null) {
        const refusal = nextDecideStatus;
        nextDecideStatus = null;
        return json(refusal.status, { code: refusal.code, title: 'Refused', status: refusal.status });
      }
      const status = pathname.endsWith('/approve') ? 'approved' : 'rejected';
      return json(200, {
        id: PENDING_ID,
        status,
        decidedBy: 'u-1',
        decidedAt: '2026-09-21T00:00:00.000Z',
        events: [],
        onHand: null,
      });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  nextDecideStatus = null;
  pendingRows = [pending()];
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
  const rendered = render(<AdjustmentPendingsQueue />);
  await settle();
  return rendered;
}

function button(view: Rendered, label: string): HTMLButtonElement {
  const found = [...view.container.querySelectorAll('button')].find((b) => b.textContent === label);
  if (found === undefined) {
    throw new Error(`no button labeled "${label}"`);
  }
  return found as HTMLButtonElement;
}

/** A request's header, looked up case-insensitively (fetch may keep the case). */
function header(record: (typeof requests)[number], name: string): string | undefined {
  return Object.entries(record.headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
}

function decidePosts(): typeof requests {
  return requests.filter((r) => r.method === 'POST' && (r.pathname.endsWith('/approve') || r.pathname.endsWith('/reject')));
}

function queueReads(): number {
  return requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/inventory/adjustment-pendings')).length;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
}

describe('AdjustmentPendingsQueue: the decide flow (story 5-5)', () => {
  test('the approve POST carries a fresh Idempotency-Key and no body, then re-reads', async () => {
    view = await mount();
    const readsBefore = queueReads();

    await click(button(view, 'Approve'));
    await settle();

    const posts = decidePosts();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.pathname.endsWith(`/adjustment-pendings/${PENDING_ID}/approve`)).toBe(true);
    expect(header(posts[0]!, 'idempotency-key')).toBeDefined();
    expect(header(posts[0]!, 'idempotency-key')!.length).toBeGreaterThanOrEqual(26);
    expect(posts[0]!.body).toBeNull();
    // The queue re-reads after the success.
    expect(queueReads()).toBeGreaterThan(readsBefore);
    // The banner names the outcome concretely — never a raw fallback word.
    expect(view.container.textContent).toContain('Adjustment approved');
  });

  test('a 409 adjustment-pending-decided renders the refresh copy AND re-reads the queue', async () => {
    view = await mount();
    nextDecideStatus = { status: 409, code: 'adjustment-pending-decided' };
    const readsBefore = queueReads();

    await click(button(view, 'Approve'));
    await settle();

    expect(view.container.textContent).toContain('Not approved');
    expect(view.container.textContent).toContain('queue has refreshed');
    expect(queueReads()).toBeGreaterThan(readsBefore);
  });

  test('a bare 409 conflict re-reads too — the mapper copy promises the refresh', async () => {
    view = await mount();
    nextDecideStatus = { status: 409, code: 'conflict' };
    const readsBefore = queueReads();

    await click(button(view, 'Approve'));
    await settle();

    expect(view.container.textContent).toContain('Another decision was in flight');
    // The conflict 409 is in the reload condition: the queue re-reads.
    expect(queueReads()).toBeGreaterThan(readsBefore);
  });

  test('two synchronous clicks on one row send exactly one POST', async () => {
    view = await mount();
    const approve = button(view, 'Approve');

    // Two clicks in the SAME tick — the disabled state cannot have rendered
    // between them, so the guard (not the disabled attribute) must absorb
    // the second click.
    await act(async () => {
      approve.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      approve.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await settle();

    expect(decidePosts()).toHaveLength(1);
  });
});

describe('AdjustmentPendingsQueue: the card and the read-only render (story 5-5)', () => {
  test('a zero delta renders bare "0 each" — never "+0"', async () => {
    pendingRows = [pending({ quantityDelta: 0 })];
    view = await mount();

    const card = view.container.querySelector('article')!;
    expect(card).toBeDefined();
    expect(card.textContent).toContain('0 each');
    expect(card.textContent).not.toContain('+0');
  });

  test('a role holding no adjustments.approve sees the rows with no decision buttons', async () => {
    view = await mount(OPERATOR_SESSION);
    // The row still renders — pending rows are never hidden read-only or not.
    expect(view.container.textContent).toContain('SPICE-01');
    expect(view.container.textContent).toContain('threshold 2 each frozen at request');
    // The only buttons are the status tabs, never a decision affordance.
    const labels = [...view.container.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual(['Pending', 'Approved', 'Rejected']);
  });
});