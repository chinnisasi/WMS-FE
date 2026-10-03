import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { ConflictsQueues } from './queues';

/**
 * The Conflicts & Reviews switcher's per-tab capability gate (story 5-5).
 * The claims a `src/lib` test cannot make:
 *   1. the owner sees all four tabs and lands on the over-receipt queue
 *      (the switcher grows, nothing is rebuilt),
 *   2. a role holding NONE of a tab's decision capability never sees the
 *      tab — the accountant (a read-only role) sees zero tabs and the
 *      honest read line, not a blocked screen,
 *   3. an unknown role (the pre-session render) still sees the full tab
 *      list — the sidebar's unknown-role convention; each queue component
 *      renders its own session gate in turn.
 *
 * The switcher is driven through a stubbed global `fetch` like the
 * excursion-queue suite — the queue components' own reads are answered with
 * quiet empty pages; only the switcher's behavior is under test here (the
 * variance and adjustment-pending queues carry their own component-level
 * suites: variance-queue.test.tsx / adjustment-pendings-queue.test.tsx).
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly query: string;
}

let requests: Recorded[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Every list-read the mounted queue fires is answered with an EMPTY page —
 * the switcher's gate is what is under test, not a queue's rows.
 */
function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    requests.push({ method: request.method.toUpperCase(), pathname: url.pathname, query: url.search });
    if (request.method.toUpperCase() === 'GET') {
      return json(200, { items: [], nextCursor: null });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

function sessionFor(role: 'owner' | 'ops_manager' | 'operator' | 'accountant'): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Priya Spices', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  };
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  stubRouter();
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

async function mount(session: StoredSession | null): Promise<Rendered> {
  if (session !== null) writeSession(session);
  const rendered = render(<ConflictsQueues />);
  await settle();
  return rendered;
}

/** The switcher's own tabs — nested queue panels render status tabs too. */
function tabLabels(container: HTMLElement): string[] {
  return [
    ...container.querySelectorAll('[role="tablist"][aria-label="Conflicts queue"] [role="tab"]'),
  ].map((t) => t.textContent ?? '');
}

describe('ConflictsQueues: the per-tab capability gate (story 5-5)', () => {
  test('the owner sees all five queues and lands on the over-receipt queue', async () => {
    view = await mount(sessionFor('owner'));
    const labels = tabLabels(view.container);
    expect(labels).toEqual([
      'Over-receipts',
      'Variances',
      'Adjustment pendings',
      'Excursions',
      'Rejected ops',
    ]);
    // The first tab is active by default and its panel mounts.
    expect(
      view.container.querySelector(
        '[role="tablist"][aria-label="Conflicts queue"] [role="tab"][aria-selected="true"]',
      )?.textContent,
    ).toBe('Over-receipts');
  });

  test('the ops_manager sees three tabs — `adjustments.approve` is owner-only in the mirror', async () => {
    // The segregation-of-duties rule (users.ts, story 5-2): the ops_manager
    // who may raise an adjustment must not also hold the approval pen — the
    // pendings tab is absent for them, by the mirror, like the backend.
    view = await mount(sessionFor('ops_manager'));
    expect(tabLabels(view.container)).toEqual([
      'Over-receipts',
      'Variances',
      'Excursions',
      'Rejected ops',
    ]);
  });

  test('a role holding none of the decision capabilities sees no tabs — the honest read line', async () => {
    view = await mount(sessionFor('accountant'));
    expect(tabLabels(view.container)).toEqual([]);
    expect(view.container.textContent).toContain('No review queues are open to your role');
    // The read line is prose, never a blocked screen.
    expect(view.container.textContent).toContain('readable elsewhere');
  });

  test('the operator — no review.decide, no variances.resolve, no adjustments.approve — sees no tabs', async () => {
    view = await mount(sessionFor('operator'));
    expect(tabLabels(view.container)).toEqual([]);
    expect(view.container.textContent).toContain('No review queues are open to your role');
  });

  test('an unknown role (the pre-session render) sees the full tab list — the sidebar convention', async () => {
    view = await mount(null);
    expect(tabLabels(view.container)).toHaveLength(5);
  });
});

describe('ConflictsQueues: the switcher swap', () => {
  test('clicking Variances swaps the panel and fires the queue read', async () => {
    view = await mount(sessionFor('owner'));

    const variancesTab = [...view.container.querySelectorAll('[role="tablist"][aria-label="Conflicts queue"] [role="tab"]')].find(
      (t) => t.textContent === 'Variances',
    );
    expect(variancesTab).toBeDefined();
    await act(async () => {
      variancesTab!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await settle();

    // The panel is the variance queue (its own sessioned section), not an
    // over-receipt remnant.
    expect(view.container.querySelector('h2')?.textContent).toContain('Variances');
    // The variances queue read is wire-real: the tenant list with status=open.
    const varianceRead = requests.find(
      (r) => r.pathname.endsWith('/movements/variances') && r.query.includes('status=open'),
    );
    expect(varianceRead).toBeDefined();
  });
});
