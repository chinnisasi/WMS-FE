import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { SegregationMatrixCard } from './segregation-matrix-card';

/**
 * The segregation matrix card (story 12-7). The claim a `src/lib` test
 * cannot make: the rendered 7×7 grid equals the ENDPOINT exactly — the
 * server's `classes` array is the grid's axes and its `incompatible` pair
 * set the only source for every cell, so for EVERY ordered pair the cell
 * reads `NO` exactly when the pair (in either order) is in the response.
 * The card's client-side rule is dumb membership — this test would catch a
 * hardcoded row, a widened predicate or a dropped self-pair.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';

const SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Priya Spices', gstin: null },
  user: { id: 'u-1', email: 'priya@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

/** The 12-1 hazard vocabulary, in the server's tuple order. */
const CLASSES = ['explosive', 'oxidizer', 'flammable', 'corrosive-acid', 'corrosive-base', 'toxic', 'gas'] as const;

/**
 * The server's fully expanded set, in the wire shape the endpoint actually
 * emits: the predicate's own sorted-key convention (`{a, b}` with `a < b`
 * lexicographically), explosive's universal rule enumerated as pairs
 * including the self-pair, plus the four explicit pairs — the exact 11 the
 * BE e2e (`test/segregation-matrix.spec.ts`) asserts. A fixture in an
 * orientation the endpoint never produces would verify a directional change
 * against a lie.
 */
const INCOMPATIBLE: readonly { a: string; b: string }[] = [
  // explosive × every class, self included (7 — the universal rule).
  { a: 'corrosive-acid', b: 'explosive' },
  { a: 'corrosive-base', b: 'explosive' },
  { a: 'explosive', b: 'explosive' },
  { a: 'explosive', b: 'flammable' },
  { a: 'explosive', b: 'gas' },
  { a: 'explosive', b: 'oxidizer' },
  { a: 'explosive', b: 'toxic' },
  // the explicit INCOMPATIBLE_PAIRS (4).
  { a: 'corrosive-acid', b: 'corrosive-base' },
  { a: 'corrosive-acid', b: 'toxic' },
  { a: 'flammable', b: 'oxidizer' },
  { a: 'gas', b: 'oxidizer' },
];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubRouter(matrixStatus: number, matrixBody: unknown): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname } = new URL(request.url);
    if (request.method === 'GET' && pathname.endsWith('/catalog/segregation-matrix')) {
      return json(matrixStatus, matrixBody);
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  stubRouter(200, { classes: [...CLASSES], incompatible: INCOMPATIBLE });
  writeSession(SESSION);
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('SegregationMatrixCard: the grid equals the endpoint (story 12-7)', () => {
  test('every cell is NO exactly when the endpoint names the pair — nothing hardcoded', async () => {
    const view = render(<SegregationMatrixCard />);
    await settle();

    const table = view.container.querySelector('table')!;
    expect(table).toBeDefined();

    // The headers carry the server's vocabulary in the server's order — the
    // card invents no class and reorders none.
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent!);
    expect(headers.slice(1)).toEqual([...CLASSES]);
    const rowHeads = [...table.querySelectorAll('tbody th')].map((th) => th.textContent!);
    expect(rowHeads).toEqual([...CLASSES]);

    // EVERY ordered pair: the cell reads NO exactly when the endpoint's
    // incompatible set contains it (either order). One loop over 49 cells —
    // a per-cell typo in a hardcoded copy cannot hide.
    const rows = [...table.querySelectorAll('tbody tr')];
    for (let r = 0; r < CLASSES.length; r++) {
      const cells = [...rows[r]!.querySelectorAll('td')].map((td) => td.textContent);
      expect(cells.length).toBe(CLASSES.length);
      for (let c = 0; c < CLASSES.length; c++) {
        const a = CLASSES[r]!;
        const b = CLASSES[c]!;
        const named = INCOMPATIBLE.some(
          (pair) => (pair.a === a && pair.b === b) || (pair.a === b && pair.b === a),
        );
        expect(`${a}|${b}: ${cells[c]}`).toBe(`${a}|${b}: ${named ? 'NO' : 'ok'}`);
      }
    }

    // The universal rule's self-pair is the endpoint's own enumeration, not
    // a client-side special case.
    const explosiveRow = rows[0]!;
    expect([...explosiveRow.querySelectorAll('td')][0]!.textContent).toBe('NO');

    // A null hazard class is NOT a class — the grid is exactly the
    // 7-class vocabulary square: no null row, no null column (the SKU
    // table's Hazard column is where a null renders, never the grid).
    expect(rows.length).toBe(CLASSES.length);
    expect(headers.length - 1).toBe(CLASSES.length);
    view.unmount();
  });

  test('a failed matrix read surfaces a banner with a Retry, never an empty grid', async () => {
    stubRouter(500, { code: 'internal-error', title: 'Internal error', status: 500 });
    const view = render(<SegregationMatrixCard />);
    await settle();

    expect(view.container.textContent).toContain('Matrix unavailable');
    expect(view.container.querySelector('table')).toBeNull();
    view.unmount();
  });
});