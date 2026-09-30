import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { RejectedOpsQueue } from './rejected-ops-queue';

/**
 * The rejected-ops queue (story 5-6; the AD-14 spine's web arm). The claims
 * a `src/lib` test cannot make:
 *   1. a resolve POST hits the rejected-op's resolve path with a
 *      machine-armed body (`{decision:'apply'|'recount'|'discard'}`) and a
 *      fresh per-click `Idempotency-Key`,
 *   2. a 409 `rejected-op-resolved` re-reads the queue (the mapper's copy
 *      promises the refresh),
 *   3. two synchronous clicks on one row send exactly ONE POST,
 *   4. a role holding no `review.decide` (an operator) renders no decision
 *      buttons — the rows still render, hide-never-block,
 *   5. a payload-less recount is never sent (the arm's 400 stays a backstop;
 *      the client hides the button where the payload names no bin),
 *   6. a placement payload that names its bin ONLY as `toBinId` still counts
 *      as bin-carrying — the recount arm and the ledger walk probe
 *      `binId ?? toBinId`, exactly the server's recount read (review Entry D),
 *   7. a settled row keeps its Details affordance for the resolver who
 *      settled it, while every decision arm disappears (review Entry O),
 *   8. each status tab pages the list with ITS OWN status query param
 *      (review Entry L — the read's mapping pinned where it ships).
 *
 * Driven through a stubbed global `fetch` — the generated client is a
 * fetch wrapper — so the wiring under test is the one that ships.
 */

const TENANT_ID = '01989f7a-1b3c-7d4e-8f90-112233445566';
const WAREHOUSE_ID = '01989f7a-1b3c-7d4e-8f90-222222222222';
const ZONE_ID = '01989f7a-1b3c-7d4e-8f90-333333333333';
const BIN_ID = '01989f7a-1b3c-7d4e-8f90-444444444444';
const OP_ID = '01989f7a-1b3c-7d4e-8f90-555555555555';
const BINLESS_OP_ID = '01989f7a-1b3c-7d4e-8f90-666666666666';
const PLACEMENT_OP_ID = '01989f7a-1b3c-7d4e-8f90-777777777777';

const OWNER_SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Priya Spices' },
  user: { id: 'u-1', email: 'priya@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

const OPERATOR_SESSION: StoredSession = { ...OWNER_SESSION, user: { ...OWNER_SESSION.user, role: 'operator' } };

function rejectedOp(over: Record<string, unknown> = {}, id: string = OP_ID): Record<string, unknown> {
  return {
    id,
    tenantId: TENANT_ID,
    deviceId: 'dev-1',
    operatorUserId: 'u-2',
    opId: id,
    opType: 'grn.submit',
    classification: 'quarantined',
    problemCode: 'bin-epoch-moved',
    problemDetail: 'the bin moved between snapshot and replay',
    payload: {
      poRef: 'PO-9',
      warehouseId: WAREHOUSE_ID,
      lines: [{ skuId: 'sku-1', qty: 10 }],
      binId: BIN_ID,
      occurredAt: '2026-09-20T00:00:00.000Z',
    },
    attribution: { deviceLabel: 'scanner-1', operatorEmail: 'floor@example.com' },
    opEnqueuedAt: '2026-09-20T00:01:00.000Z',
    opOccurredAt: '2026-09-20T00:00:00.000Z',
    status: 'open',
    resolvedBy: null,
    resolvedAt: null,
    resolvedOutcome: null,
    createdAt: '2026-09-20T00:02:00.000Z',
    updatedAt: '2026-09-20T00:02:00.000Z',
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
let opRows: Record<string, unknown>[] = [];
/** The next resolve answer; a non-null setting simulates the 409/403 refusal arms. */
let nextResolveStatus: { status: number; code: string; title?: string } | null = null;

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
    if (method === 'GET' && pathname.endsWith('/rejected-ops')) {
      return json(200, { items: opRows, nextCursor: null });
    }
    if (method === 'POST' && pathname.endsWith('/resolve')) {
      if (nextResolveStatus !== null) {
        const refusal = nextResolveStatus;
        nextResolveStatus = null;
        return json(refusal.status, {
          code: refusal.code,
          title: refusal.title ?? 'Refused',
          status: refusal.status,
        });
      }
      const decision = (body as { decision: string }).decision;
      const status =
        decision === 'apply' ? 'applied' : decision === 'recount' ? 'recounted' : 'discarded';
      return json(200, {
        rejectedOp: { ...opRows[0]!, status, resolvedBy: 'u-1', resolvedAt: '2026-09-30T00:00:00.000Z' },
        outcome: status === 'recounted' ? { countTaskId: '0198task0000000000000000000' } : null,
      });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  nextResolveStatus = null;
  opRows = [rejectedOp(), rejectedOp({ opId: BINLESS_OP_ID, classification: 'rejected', problemCode: 'kit-cannot-hold-stock', payload: { picklistLineId: 'L-1' } }, BINLESS_OP_ID)];
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
  const rendered = render(<RejectedOpsQueue />);
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

function article(view: Rendered, marker: string): HTMLDivElement & Element {
  const found = [...view.container.querySelectorAll('article')].find((a) => a.textContent?.includes(marker));
  if (found === undefined) {
    throw new Error(`no article containing "${marker}"`);
  }
  return found as HTMLDivElement & Element;
}

function articleButton(article: HTMLElement, label: string): HTMLButtonElement {
  const found = [...article.querySelectorAll('button')].find((b) => b.textContent === label);
  if (found === undefined) {
    throw new Error(`no button labeled "${label}" in the article`);
  }
  return found as HTMLButtonElement;
}

/** A request's header, looked up case-insensitively (fetch may keep the case). */
function header(record: (typeof requests)[number], name: string): string | undefined {
  return Object.entries(record.headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
}

function resolvePosts(): typeof requests {
  return requests.filter((r) => r.method === 'POST' && r.pathname.endsWith('/resolve'));
}

function listReads(): typeof requests {
  return requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/rejected-ops'));
}

function queueReads(): number {
  return requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/rejected-ops')).length;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
}

describe('RejectedOpsQueue: the resolve flow (story 5-6)', () => {
  test('the apply POST carries a machine-armed body and a fresh Idempotency-Key, then re-reads', async () => {
    view = await mount();
    const readsBefore = queueReads();

    await click(articleButton(article(view, 'bin-epoch-moved'), 'Apply (re-execute)'));
    await settle();

    const posts = resolvePosts();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.pathname.endsWith(`/rejected-ops/${OP_ID}/resolve`)).toBe(true);
    expect(posts[0]!.body).toEqual({ decision: 'apply' });
    expect(header(posts[0]!, 'idempotency-key')).toBeDefined();
    expect(header(posts[0]!, 'idempotency-key')!.length).toBeGreaterThanOrEqual(26);
    // The queue re-reads after the success.
    expect(queueReads()).toBeGreaterThan(readsBefore);
    // The banner names the outcome concretely — never a raw fallback word.
    expect(view.container.textContent).toContain('Op applied');
  });

  test("a 409 rejected-op-resolved renders the refresh copy AND re-reads the queue", async () => {
    view = await mount();
    nextResolveStatus = { status: 409, code: 'rejected-op-resolved' };
    const readsBefore = queueReads();

    await click(articleButton(article(view, 'bin-epoch-moved'), 'Apply (re-execute)'));
    await settle();

    expect(view.container.textContent).toContain('Not applied');
    expect(view.container.textContent).toContain('queue has refreshed');
    expect(queueReads()).toBeGreaterThan(readsBefore);
  });

  test('a re-execution refusal (device-revoked 403) renders the server words verbatim and does NOT reload', async () => {
    view = await mount();
    nextResolveStatus = { status: 403, code: 'device-revoked', title: 'Device revoked' };
    const readsBefore = queueReads();

    await click(articleButton(article(view, 'bin-epoch-moved'), 'Apply (re-execute)'));
    await settle();

    expect(view.container.textContent).toContain('Device revoked');
    // No reload: the row is still open on the server — the refusal is the answer.
    expect(queueReads()).toBe(readsBefore);
  });

  test('two synchronous clicks on one row send exactly one POST', async () => {
    view = await mount();
    const apply = articleButton(article(view, 'bin-epoch-moved'), 'Apply (re-execute)');

    // Two clicks in the SAME tick — the disabled state cannot have rendered
    // between them, so the guard (not the disabled attribute) must absorb
    // the second click.
    await act(async () => {
      apply.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      apply.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await settle();

    expect(resolvePosts()).toHaveLength(1);
  });

  test('a discard POST sends the discard arm; a binless payload hides the recount button', async () => {
    view = await mount();
    // The binless (rejected) card carries no recount button — the payload
    // names no bin, and the 400 backstop is never the UI's plan.
    const binless = article(view, 'kit-cannot-hold-stock');
    expect(() => articleButton(binless, 'Open a recount')).toThrow('no button labeled');

    await click(articleButton(article(view, 'kit-cannot-hold-stock'), 'Discard'));
    await settle();

    const posts = resolvePosts();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.pathname.endsWith(`/rejected-ops/${BINLESS_OP_ID}/resolve`)).toBe(true);
    expect(posts[0]!.body).toEqual({ decision: 'discard' });
    expect(view.container.textContent).toContain('Discarded');
  });

  test('a bin-carrying payload shows the recount arm and POSTs it', async () => {
    view = await mount();
    button(view, 'Open a recount'); // present on the quarantined, bin-carrying card
    await click(articleButton(article(view, 'bin-epoch-moved'), 'Open a recount'));
    await settle();

    const posts = resolvePosts();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({ decision: 'recount' });
    expect(view.container.textContent).toContain('Recount opened');
  });

  test('a placement payload naming its bin ONLY as toBinId still shows and POSTs the recount', async () => {
    // The transfer.confirm placement shape the mobile outbox enqueues: no
    // `binId` — the bin lives in `toBinId`. A probe reading `binId` alone
    // hid this row's recount though the server serves it (review Entry D).
    opRows = [
      rejectedOp(
        {
          opType: 'transfer.confirm',
          problemCode: 'bin-epoch-moved',
          payload: { transferId: 'T-9', warehouseId: WAREHOUSE_ID, toBinId: BIN_ID },
        },
        PLACEMENT_OP_ID,
      ),
    ];
    view = await mount();

    // The bin label resolves through the same probe — no "(unknown bin)".
    expect(article(view, 'transfer.confirm').textContent).not.toContain('(unknown bin)');
    await click(articleButton(article(view, 'transfer.confirm'), 'Open a recount'));
    await settle();

    const posts = resolvePosts();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.pathname.endsWith(`/rejected-ops/${PLACEMENT_OP_ID}/resolve`)).toBe(true);
    expect(posts[0]!.body).toEqual({ decision: 'recount' });
  });
});

describe('RejectedOpsQueue: the status → query-param pin (review Entry L)', () => {
  test('each tab pages the list read with its own status param', async () => {
    view = await mount();
    // The open queue is the initial read.
    expect(listReads().at(-1)!.query).toBe('?status=open');
    for (const [label, status] of [
      ['Applied', 'applied'],
      ['Recounted', 'recounted'],
      ['Discarded', 'discarded'],
    ] as const) {
      await click(button(view, label));
      await settle();
      expect(listReads().at(-1)!.query).toBe(`?status=${status}`);
    }
    // Back to the open tab: a fresh open-scoped read, never a stale cursor.
    await click(button(view, 'Open'));
    await settle();
    expect(listReads().at(-1)!.query).toBe('?status=open');
  });
});

describe('RejectedOpsQueue: the card and the read-only render (story 5-6)', () => {
  test('the card pins the refusal verbatim: problem code, detail, device and operator', async () => {
    view = await mount();

    const card = article(view, 'bin-epoch-moved');
    expect(card.textContent).toContain('quarantined · AD-14');
    expect(card.textContent).toContain('the bin moved between snapshot and replay');
    expect(card.textContent).toContain('device scanner-1');
    expect(card.textContent).toContain('operator floor@example.com');
  });

  test('a role holding no review.decide sees the rows with no decision buttons', async () => {
    view = await mount(OPERATOR_SESSION);
    // The rows still render — pending rows are never hidden read-only or not.
    expect(view.container.textContent).toContain('bin-epoch-moved');
    expect(view.container.textContent).toContain('kit-cannot-hold-stock');
    // The only buttons are the status tabs, never a decision affordance.
    const labels = [...view.container.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual(['Open', 'Applied', 'Recounted', 'Discarded']);
  });

  test('settled rows show who resolved and when, with the arm’s marker', async () => {
    opRows = [
      rejectedOp({
        status: 'recounted',
        resolvedBy: 'u-1',
        resolvedAt: '2026-09-29T00:00:00.000Z',
        resolvedOutcome: { countTaskId: '0198task00000000000000000000' },
      }),
    ];
    view = await mount();

    const card = article(view, 'bin-epoch-moved');
    expect(card.textContent).toContain('resolved by priya@example.com');
    expect(card.textContent).toContain('recount task 0198task');
  });

  test('a settled row keeps its Details affordance and no decision arms (review Entry O)', async () => {
    opRows = [
      rejectedOp({
        status: 'applied',
        resolvedBy: 'u-1',
        resolvedAt: '2026-09-29T00:00:00.000Z',
        resolvedOutcome: {},
      }),
    ];
    view = await mount();

    const card = article(view, 'bin-epoch-moved');
    // The resolver who settled the row can still open the payload.
    const details = articleButton(card, 'Details');
    expect(() => articleButton(card, 'Apply (re-execute)')).toThrow('no button labeled');
    expect(() => articleButton(card, 'Discard')).toThrow('no button labeled');
    expect(() => articleButton(card, 'Open a recount')).toThrow('no button labeled');

    await click(details);
    await settle();
    // The panel renders the payload as enqueued, and the ledger walk still
    // follows the probe (this card's payload carries binId).
    expect(card.textContent).toContain("The op's payload as the device enqueued it");
    expect(card.textContent).toContain('poRef"PO-9"');
  });

  test('a role holding no review.decide gets no Details button on settled rows either', async () => {
    opRows = [rejectedOp({ status: 'applied', resolvedBy: 'u-1', resolvedAt: '2026-09-29T00:00:00.000Z' })];
    view = await mount(OPERATOR_SESSION);
    const labels = [...view.container.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual(['Open', 'Applied', 'Recounted', 'Discarded']);
  });
});
