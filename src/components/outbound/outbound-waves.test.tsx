import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { OUTBOUND_CHANGED_EVENT } from '../../lib/outbound';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { AT_RISK_THRESHOLD_MINUTES } from '../../lib/outbound-waves';
import { OutboundWaves } from './outbound-waves';

/**
 * The Outbound waves surface (story 4.2c).
 *
 * These claims cannot be pinned by a `src/lib` test, because each is about
 * what the SCREEN renders or what pressing it actually sends:
 *   1. amber lights for an at-risk PLANNED wave and for nothing else,
 *   2. no release affordance is offered on a cancelled wave,
 *   3. a role without `waves.manage` still reads the whole list and the
 *      expanded stops, and is offered no mutating affordance at all,
 *   4. pressing Release calls RELEASE and pressing Cancel calls CANCEL —
 *      asserting button labels alone left the verb ternary in `submit()`
 *      free to be inverted with the whole repo still green,
 *   5. a mutation refreshes the list and returns it to page one.
 *
 * The surface is driven end to end through a stubbed `fetch` — the generated
 * client is a fetch wrapper — rather than through mocked hooks, so the gates
 * and the wiring being tested are the ones that ship.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';
const POLICY_ID = '0198f7a2-1b3c-7d4e-8f90-bbccddee0011';

/** Fixed instant: 17:30 Asia/Kolkata, half an hour from an 18:00 cutoff. */
const NOW = new Date('2026-09-16T17:30:00+05:30');

function session(role: StoredSession['user']['role']): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Priya Spices' },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: NOW.getTime() + 15 * 60_000,
  };
}

function wave(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wave-planned',
    tenantId: TENANT_ID,
    warehouseId: WAREHOUSE_ID,
    policyId: POLICY_ID,
    status: 'planned',
    releasedAt: null,
    cancelledAt: null,
    picklistCount: 1,
    createdAt: '2026-09-16T10:00:00.000Z',
    updatedAt: '2026-09-16T10:00:00.000Z',
    ...overrides,
  };
}

const POLICY = {
  id: POLICY_ID,
  tenantId: TENANT_ID,
  warehouseId: WAREHOUSE_ID,
  name: 'Evening courier',
  grouping: 'single',
  priority: 0,
  maxOrders: null,
  cutoffLocalTime: '18:00',
  cutoffTimezone: 'Asia/Kolkata',
  carrierRef: null,
  createdAt: '2026-09-16T04:00:00.000Z',
  updatedAt: '2026-09-16T04:00:00.000Z',
};

function picklist(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pl-1',
    waveId: 'wave-planned',
    orderId: 'order-1',
    status: 'planned',
    stopCount: 2,
    createdAt: '2026-09-16T10:00:00.000Z',
    updatedAt: '2026-09-16T10:00:00.000Z',
    lines: [
      {
        id: 'line-1',
        picklistId: 'pl-1',
        orderId: 'order-1',
        orderLineId: 'ol-1',
        skuId: 'sku-1',
        binId: 'bin-1',
        binCode: 'A-01-01',
        batchId: null,
        reservationId: 'r-1',
        qty: 4,
        shortfallQty: 0,
        reasonCode: null,
        sliceSeq: 0,
        walkSeq: 0,
        status: 'planned',
        createdAt: '2026-09-16T10:00:00.000Z',
      },
      {
        id: 'line-2',
        picklistId: 'pl-1',
        orderId: 'order-1',
        orderLineId: 'ol-2',
        skuId: 'sku-2',
        binId: 'bin-2',
        binCode: 'B-02-07',
        batchId: null,
        reservationId: 'r-2',
        qty: 3,
        shortfallQty: 0,
        reasonCode: null,
        sliceSeq: 0,
        walkSeq: 1,
        status: 'planned',
        createdAt: '2026-09-16T10:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

const WAVE_DETAIL = { ...wave(), picklists: [picklist()] };

/* ------------------------------------------------------------------ */
/* The stubbed backend                                                 */
/* ------------------------------------------------------------------ */

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly search: string;
  readonly idempotencyKey: string | null;
}

let requests: Recorded[] = [];
/** Waves the list returns; reassigned mid-test to prove a refetch happened. */
let waveRows: unknown[] = [];
let waveNextCursor: string | null = null;
let policyRows: unknown[] = [POLICY];
/** Answers the release POST; swapped to make the first attempt refuse. */
let releaseResponder: () => { status: number; body: unknown } = () => ({
  status: 200,
  body: { wave: { ...wave({ status: 'released' }), picklists: [picklist({ status: 'ready' })] } },
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A router over the endpoints this surface touches. Every request is
 * recorded, and MUTATIONS are matched on method + path BEFORE any read arm —
 * a `pathname.includes('/outbound/waves/')` catch-all would otherwise answer
 * a release POST with a wave detail and 200, letting a press-the-button test
 * pass without the button being wired to anything. Anything unrouted 404s
 * rather than looking like an empty page.
 */
function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();
    requests.push({
      method,
      pathname,
      search: url.search,
      idempotencyKey: request.headers.get('Idempotency-Key'),
    });

    // ── mutations first ────────────────────────────────────────────────
    if (method === 'POST' && pathname.endsWith('/release')) {
      const answer = releaseResponder();
      return json(answer.status, answer.body);
    }
    if (method === 'POST' && pathname.endsWith('/cancel')) {
      return json(200, {
        wave: { ...wave({ status: 'cancelled' }), picklists: [picklist({ status: 'cancelled' })] },
      });
    }
    if (method === 'POST' && pathname.endsWith('/outbound/waves')) {
      return json(201, { wave: WAVE_DETAIL });
    }
    if (method === 'POST' && pathname.endsWith('/outbound/wave-policies')) {
      return json(201, { policy: POLICY });
    }

    // ── reads ──────────────────────────────────────────────────────────
    if (method === 'GET' && pathname.endsWith('/outbound/wave-policies')) {
      return json(200, { items: policyRows, nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith('/outbound/waves')) {
      return json(200, { items: waveRows, nextCursor: waveNextCursor });
    }
    if (method === 'GET' && /\/outbound\/waves\/[^/]+$/.test(pathname)) {
      return json(200, { wave: WAVE_DETAIL });
    }
    if (method === 'GET' && pathname.endsWith('/outbound/orders')) {
      return json(200, { items: [], nextCursor: null });
    }
    // The wave-detail panel's SKU read (story 10.5): both fixture lines'
    // SKUs are kg at precision 3, so the expanded walk and the totals
    // sentence render at the DECLARED precision — the arm the fallback-only
    // test never exercised.
    if (method === 'GET' && pathname.endsWith('/catalog/skus')) {
      return json(200, {
        items: [
          { id: 'sku-1', code: 'SPICE-01', name: 'Turmeric', uom: 'kg', uomPrecision: 3 },
          { id: 'sku-2', code: 'FLOUR-01', name: 'Flour', uom: 'kg', uomPrecision: 3 },
        ],
        nextCursor: null,
      });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  waveRows = [];
  waveNextCursor = null;
  policyRows = [POLICY];
  releaseResponder = () => ({
    status: 200,
    body: { wave: { ...wave({ status: 'released' }), picklists: [picklist({ status: 'ready' })] } },
  });
  stubRouter();
  // The at-risk derivation reads the browser clock once per tick; pinning it
  // is what makes "30 minutes left" a stable assertion rather than a race
  // against the wall clock of whatever machine runs the suite.
  stubGlobal('Date', pinnedDate());
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
});

/** `Date`, with `new Date()` and `Date.now()` pinned to NOW. */
function pinnedDate(): DateConstructor {
  const Real = Date;
  const fixed = NOW.getTime();
  const Pinned = function (this: unknown, ...args: unknown[]) {
    if (args.length === 0) return new Real(fixed);
    return new (Real as unknown as new (...a: unknown[]) => Date)(...args);
  } as unknown as DateConstructor;
  Object.defineProperty(Pinned, 'prototype', { value: Real.prototype });
  Pinned.now = () => fixed;
  Pinned.parse = Real.parse;
  Pinned.UTC = Real.UTC;
  return Pinned;
}

/** Let every in-flight read settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/**
 * Render the surface with the props the page resolves once (`outbound.tsx`
 * owns the session, the warehouse and the picker now). The role is passed,
 * not the capability, so the `waves.manage` gate under test is the one that
 * ships.
 */
async function mount(role: StoredSession['user']['role']): Promise<Rendered> {
  writeSession(session(role));
  const rendered = render(
    <OutboundWaves
      tenantId={TENANT_ID}
      warehouseId={WAREHOUSE_ID}
      warehouseLabel="MAIN Chennai DC"
      role={role}
    />,
  );
  await settle();
  return rendered;
}

function text(rendered: Rendered): string {
  return rendered.container.textContent ?? '';
}

function buttons(rendered: Rendered): HTMLButtonElement[] {
  return [...rendered.container.querySelectorAll('button')] as HTMLButtonElement[];
}

function buttonLabels(rendered: Rendered): string[] {
  return buttons(rendered).map((b) => b.textContent?.trim() ?? '');
}

function pressButton(rendered: Rendered, label: string): Promise<void> {
  const button = buttons(rendered).find((b) => b.textContent?.trim() === label);
  if (button === undefined) {
    throw new Error(`No button labelled "${label}" — have: ${buttonLabels(rendered).join(' | ')}`);
  }
  return act(async () => {
    button.click();
  });
}

const mutations = () => requests.filter((r) => r.method === 'POST');
const waveListReads = () =>
  requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/outbound/waves'));

/* ------------------------------------------------------------------ */

describe('the amber at-risk indicator', () => {
  test('a planned wave inside the threshold shows amber with the minutes remaining', async () => {
    waveRows = [wave()];
    view = await mount('ops_manager');
    // 17:30 against an 18:00 cutoff — inside the 60-minute window.
    expect(AT_RISK_THRESHOLD_MINUTES).toBe(60);
    expect(text(view)).toContain('At risk — 30 minutes left');
  });

  test('the SAME wave, already released, shows no amber and no countdown', async () => {
    waveRows = [
      wave({ id: 'wave-released', status: 'released', releasedAt: '2026-09-16T11:00:00.000Z' }),
    ];
    view = await mount('ops_manager');
    const body = text(view);
    expect(body).toContain('Released');
    expect(body).not.toContain('At risk');
    // The cell shows the cutoff the policy HAS, never a countdown to a
    // deadline this wave can no longer miss.
    expect(body).toContain('Cutoff 18:00 Asia/Kolkata');
    expect(body).not.toContain('minutes left');
  });

  test('a cancelled wave shows no amber and no countdown either', async () => {
    waveRows = [
      wave({ id: 'wave-cancelled', status: 'cancelled', cancelledAt: '2026-09-16T11:00:00.000Z' }),
    ];
    view = await mount('ops_manager');
    const body = text(view);
    expect(body).not.toContain('At risk');
    expect(body).not.toContain('minutes left');
    expect(body).not.toContain('passed by this browser');
  });

  test('a policy with no cutoff gives no amber and no countdown', async () => {
    policyRows = [{ ...POLICY, cutoffLocalTime: null }];
    waveRows = [wave()];
    view = await mount('ops_manager');
    expect(text(view)).not.toContain('At risk');
    expect(text(view)).toContain('No cutoff');
  });

  test('a cutoff already passed says the server decides, and release is still offered', async () => {
    // 16:00 cutoff against a 17:30 clock: the browser believes it has gone,
    // and says so without claiming the ruling — the server compares whole
    // minutes and is the authority.
    policyRows = [{ ...POLICY, cutoffLocalTime: '16:00' }];
    waveRows = [wave()];
    view = await mount('ops_manager');
    expect(text(view)).toContain("Cutoff 16:00 Asia/Kolkata — passed by this browser's clock");
    expect(text(view)).toContain('the server decides');
    expect(text(view)).not.toContain('At risk');
    expect(buttonLabels(view)).toContain('Release');
  });

  test('a wave whose policy did not load says so — not "no cutoff"', async () => {
    // The policy read succeeded but this wave's policy is not in it (a
    // truncated chain, or a policy created since). Reading that as "no
    // cutoff" would tell the viewer release is always allowed.
    policyRows = [];
    waveRows = [wave()];
    view = await mount('ops_manager');
    expect(text(view)).toContain('Policy not loaded');
    expect(text(view)).not.toContain('No cutoff');
  });
});

describe('the affordances a row can predict', () => {
  test('a planned wave offers both release and cancel', async () => {
    waveRows = [wave()];
    view = await mount('ops_manager');
    const labels = buttonLabels(view);
    expect(labels).toContain('Release');
    expect(labels).toContain('Cancel');
  });

  test('a cancelled wave offers NO release affordance — the one refusal the row can foresee', async () => {
    waveRows = [wave({ id: 'wave-cancelled', status: 'cancelled' })];
    view = await mount('ops_manager');
    expect(buttonLabels(view)).not.toContain('Release');
    // Cancel has no predictable refusal, so it stays offered.
    expect(buttonLabels(view)).toContain('Cancel');
  });

  test('a released wave offers no release either — it already made it', async () => {
    waveRows = [wave({ id: 'wave-released', status: 'released' })];
    view = await mount('ops_manager');
    expect(buttonLabels(view)).not.toContain('Release');
  });

  test('a released wave shows WHEN it went to the floor', async () => {
    waveRows = [
      wave({ id: 'wave-released', status: 'released', releasedAt: '2026-09-16T11:00:00.000Z' }),
    ];
    view = await mount('ops_manager');
    expect(view.container.querySelector('time[datetime="2026-09-16T11:00:00.000Z"]')).not.toBeNull();
  });
});

describe('pressing the row actions', () => {
  test('Release calls the RELEASE endpoint, not cancel', async () => {
    waveRows = [wave()];
    view = await mount('ops_manager');

    await pressButton(view, 'Release');
    expect(text(view)).toContain('Releasing wave');
    await pressButton(view, 'Release this wave');
    await settle();

    const posts = mutations();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/outbound/waves/wave-planned/release`);
    expect(posts[0]!.idempotencyKey).not.toBeNull();
    expect(text(view)).toContain('Wave released');
    // Only the READY picklists are announced as ready.
    expect(text(view)).toContain('1 picklist is ready to pick');
  });

  test('Cancel calls the CANCEL endpoint, not release', async () => {
    waveRows = [wave()];
    view = await mount('ops_manager');

    await pressButton(view, 'Cancel');
    expect(text(view)).toContain('Cancelling wave');
    await pressButton(view, 'Cancel this wave');
    await settle();

    const posts = mutations();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/outbound/waves/wave-planned/cancel`);
    expect(text(view)).toContain('Wave cancelled');
    // A PLANNED wave really did move no stock.
    expect(text(view)).toContain('No reservation and no stock moved.');
  });

  test('cancelling a RELEASED wave does not claim nothing moved', async () => {
    waveRows = [wave({ id: 'wave-planned', status: 'released' })];
    view = await mount('ops_manager');

    await pressButton(view, 'Cancel');
    // The confirmation says it before the press, too.
    expect(text(view)).toContain('Units already picked stay out of their bins');
    await pressButton(view, 'Cancel this wave');
    await settle();

    expect(text(view)).toContain('Units already picked stay out of their bins');
    expect(text(view)).not.toContain('No reservation and no stock moved.');
  });

  test('a refused release shows the server’s words and retries with the SAME idempotency key', async () => {
    waveRows = [wave()];
    const sentence = 'Policy "Evening courier" cuts off at 18:00 Asia/Kolkata; it is 18:20 there now.';
    let attempts = 0;
    releaseResponder = () => {
      attempts += 1;
      return attempts === 1
        ? { status: 409, body: { code: 'cutoff-passed', title: sentence, status: 409, detail: sentence } }
        : {
            status: 200,
            body: {
              wave: { ...wave({ status: 'released' }), picklists: [picklist({ status: 'ready' })] },
            },
          };
    };
    view = await mount('ops_manager');

    await pressButton(view, 'Release');
    await pressButton(view, 'Release this wave');
    await settle();
    expect(text(view)).toContain(sentence);

    // The confirmation is still open; pressing again must REPLAY, not raise a
    // second command.
    await pressButton(view, 'Release this wave');
    await settle();

    const posts = mutations();
    expect(posts).toHaveLength(2);
    expect(posts[0]!.idempotencyKey).toBe(posts[1]!.idempotencyKey);
    expect(text(view)).toContain('Wave released');
  });

  test('a mutation refreshes the list and returns it to page one', async () => {
    waveRows = [wave()];
    waveNextCursor = 'page-2-cursor';
    view = await mount('ops_manager');

    await pressButton(view, 'Next');
    await settle();
    expect(waveListReads().at(-1)!.search).toContain('cursor=page-2-cursor');

    // The mutation's own OUTBOUND_CHANGED_EVENT is what drives this; dispatch
    // it directly so the refresh loop is tested on its own terms.
    waveRows = [wave({ id: 'wave-fresh' })];
    await act(async () => {
      window.dispatchEvent(new Event(OUTBOUND_CHANGED_EVENT));
    });
    await settle();

    expect(waveListReads().at(-1)!.search).toBe('');
    expect(text(view)).toContain('wave-fresh');
  });
});

describe('the waves.manage gate', () => {
  test('an Operator reads the list and the stops, and is offered nothing to press', async () => {
    waveRows = [wave()];
    view = await mount('operator');

    // The list is fully readable.
    expect(text(view)).toContain('wave-planned');
    expect(text(view)).toContain('Evening courier');
    // …including the amber warning, which is information, not an action.
    expect(text(view)).toContain('At risk — 30 minutes left');

    const labels = buttonLabels(view);
    expect(labels).not.toContain('Release');
    expect(labels).not.toContain('Cancel');
    expect(labels).not.toContain('New wave policy');
    expect(labels).not.toContain('Generate wave');
  });

  test('an Operator can expand a wave and read every stop on the walk', async () => {
    waveRows = [wave()];
    view = await mount('operator');

    const toggle = buttons(view).find((b) => b.textContent?.includes('wave-planned'))!;
    await act(async () => {
      toggle.click();
    });
    await settle();

    const body = text(view);
    expect(body).toContain('A-01-01');
    expect(body).toContain('B-02-07');
    // The stops' SKUs RESOLVE (the stub serves the catalog): each stop names
    // its own unit at declared precision — the story 10.5 headline, which a
    // fallback-only fixture could never assert.
    expect(body).toContain('4.000 kg to pick');
    expect(body).toContain('3.000 kg to pick');
    // …and the shared-unit totals render at that unit too.
    expect(body).toContain('1 order · 1 picklist · 2 stops · 2 lines · 7.000 kg to pick');
  });

  test('an Ops Manager is offered the policy and generate affordances', async () => {
    waveRows = [wave()];
    view = await mount('ops_manager');
    const labels = buttonLabels(view);
    expect(labels).toContain('New wave policy');
    expect(labels).toContain('Generate wave');
  });
});

describe('the honest empty and failed states', () => {
  test('with no policies, generation says a policy is needed rather than offering an empty picker', async () => {
    policyRows = [];
    waveRows = [];
    view = await mount('ops_manager');
    expect(text(view)).toContain('Create a wave policy first');
    expect(buttonLabels(view)).not.toContain('Generate wave');
  });

  test('a FAILED policy read never says "create one" — the policies may already exist', async () => {
    stubGlobal('fetch', (async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input.toString());
      const { pathname } = new URL(request.url);
      if (pathname.endsWith('/outbound/wave-policies')) throw new TypeError('Failed to fetch');
      if (pathname.endsWith('/outbound/waves')) return json(200, { items: [], nextCursor: null });
      return json(200, { items: [], nextCursor: null });
    }) as unknown as typeof fetch);

    view = await mount('ops_manager');
    expect(text(view)).toContain('Wave policies unavailable');
    expect(text(view)).toContain('there is nothing to generate under');
    expect(text(view)).not.toContain('Create a wave policy first');
  });

  test('a failed wave read is reported with a retry, never as progress copy', async () => {
    stubGlobal('fetch', (async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input.toString());
      const { pathname } = new URL(request.url);
      if (pathname.endsWith('/outbound/waves')) {
        // Unreachable API: the generated client rejects, and the surface must
        // say so instead of showing "Loading waves…" forever.
        throw new TypeError('Failed to fetch');
      }
      return json(200, { items: policyRows, nextCursor: null });
    }) as unknown as typeof fetch);

    view = await mount('ops_manager');
    expect(text(view)).toContain('Waves unavailable');
    expect(text(view)).toContain('The API is unreachable');
    expect(text(view)).not.toContain('Loading waves…');
    expect(buttonLabels(view)).toContain('Retry');
  });
});
