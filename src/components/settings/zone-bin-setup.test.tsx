import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { ZonesBinsSetup } from './zone-bin-setup';

/**
 * The bins-setup surface's 12-4 location-type behavior — the claims a
 * `src/lib` test cannot make (the surface has no lib-level seam; the
 * conditional payload and the picker filtering live in the JSX):
 *   1. the grid generator's type picker offers only the six grid-able
 *      types — a bulk asset (tank, silo) is never gridded, so the picker
 *      never offers one, and the manual create picker offers the FULL
 *      eight-type vocabulary in the server's tuple order (review 2, triage
 *      #32 — a dropped type would otherwise pass every test),
 *   2. the manual create payload carries `maxWeightGrams` exactly when a
 *      bulk type is picked (the server refuses a bulk asset without one)
 *      and omits it otherwise (an ordinary bin stays unconstrained) —
 *      driven for BOTH bulk types so a per-type typo cannot hide, and
 *   3. a merge refused with `bin-occupancy-conflict` renders the surface's
 *      copy for the single-SKU rule (the switch case, not the default).
 *
 * The surface is driven through a stubbed global `fetch` — the generated
 * client is a fetch wrapper — so the wiring under test is the one that
 * ships (the products-card test's pattern).
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-222222222222';
const ZONE_ID = '0198f7a2-1b3c-7d4e-8f90-333333333333';
const TANK_ID = '0198f7a2-1b3c-7d4e-8f90-444444444444';
const SHELF_ID = '0198f7a2-1b3c-7d4e-8f90-555555555555';

const SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Priya Spices' },
  user: { id: 'u-1', email: 'priya@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly body: unknown;
}

let requests: Recorded[] = [];
/** The next merge answer, so a test can force the occupancy refusal. */
let nextMergeStatus = 200;
let nextMergeBody: unknown = null;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function bin(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SHELF_ID,
    code: 'A-01-01',
    zoneId: ZONE_ID,
    zoneCode: 'A',
    type: 'shelf',
    capacity: 120,
    blocked: false,
    systemOwned: false,
    retiredAt: null,
    storageClass: 'ambient',
    maxWeightGrams: null,
    ...over,
  };
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    requests.push({ method, pathname, body });
    if (method === 'GET' && pathname.endsWith('/warehouses')) {
      return json(200, {
        items: [{ id: WAREHOUSE_ID, code: 'W1', name: 'Main', origin: {}, createdAt: '2026-09-01T00:00:00.000Z' }],
        nextCursor: null,
      });
    }
    if (method === 'GET' && pathname.endsWith('/zones')) {
      return json(200, { items: [{ id: ZONE_ID, code: 'A', name: 'Fast movers' }], nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith('/bins/grid')) {
      return json(400, { code: 'validation-failed', title: 'Validation failed', status: 400 });
    }
    if (method === 'GET' && pathname.endsWith('/bins')) {
      return json(200, { items: [bin(), bin({ id: TANK_ID, code: 'A-01-02', type: 'tank', maxWeightGrams: 1000 })], nextCursor: null });
    }
    if (method === 'POST' && pathname.endsWith('/bins/grid')) {
      return json(201, { generatedCount: 1, firstCode: 'B-01-01', lastCode: 'B-01-01' });
    }
    if (method === 'POST' && pathname.endsWith('/bins')) {
      const over = (body !== null && typeof body === 'object' ? body : {}) as Record<string, unknown>;
      return json(201, bin({ id: '0198f7a2-1b3c-7d4e-8f90-666666666666', code: 'A-01-03', ...over }));
    }
    if (method === 'POST' && pathname.endsWith('/merge')) {
      return json(nextMergeStatus, nextMergeBody ?? { source: bin(), target: bin({ id: TANK_ID }), moved: { skus: 1, units: 1 } });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  nextMergeStatus = 200;
  nextMergeBody = null;
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
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function setSelect(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function mount(): Promise<Rendered> {
  const rendered = render(<ZonesBinsSetup />);
  await settle();
  return rendered;
}

/** The form owning a submit button labelled `label` (zone / grid / manual). */
function formFor(container: HTMLElement, label: string): HTMLFormElement {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent === label);
  expect(button).toBeDefined();
  return button!.closest('form')!;
}

/** A form's labelled select (the ZonePicker / BinTypePicker pattern). */
function typeSelect(form: HTMLFormElement): HTMLSelectElement {
  const label = [...form.querySelectorAll('label')].find((l) => l.textContent!.startsWith('Type'));
  expect(label).toBeDefined();
  return label!.querySelector('select')!;
}

describe('ZonesBinsSetup: the 12-4 location types', () => {
  test("the grid generator's type picker offers the six grid-able types — never tank or silo", async () => {
    view = await mount();
    const gridForm = formFor(view.container, 'Generate bins');
    const options = [...typeSelect(gridForm).querySelectorAll('option')].map((o) => o.value);
    expect(options).toEqual(['shelf', 'pallet', 'floor', 'staging', 'floor-stack', 'yard']);
  });

  // Review 2 (triage #32): the create picker is the vocabulary's FE mirror —
  // pinned here the way the mobile mirror is pinned in its draft test
  // (hardcoded, in the server's tuple order), so a BE vocabulary growth or a
  // local drop fails this suite instead of surfacing as a runtime 400.
  test("the manual create picker offers the full vocabulary — all eight types in the server's tuple order", async () => {
    view = await mount();
    const manualForm = formFor(view.container, 'Create bin');
    const options = [...typeSelect(manualForm).querySelectorAll('option')].map((o) => o.value);
    expect(options).toEqual(['shelf', 'pallet', 'floor', 'staging', 'floor-stack', 'yard', 'tank', 'silo']);
  });

  test('the manual create payload carries maxWeightGrams exactly when a bulk type is picked, and omits it otherwise', async () => {
    view = await mount();
    const manualForm = formFor(view.container, 'Create bin');
    const zonePicker = [...manualForm.querySelectorAll('label')].find((l) => l.textContent!.startsWith('Zone'))!.querySelector('select')!;
    setSelect(zonePicker, ZONE_ID);
    const codeInput = [...manualForm.querySelectorAll('input')].find((i) => i.placeholder === 'A-01-01')!;
    const typePicker = typeSelect(manualForm);

    // An ordinary type: no weight field, no weight key on the wire.
    setSelect(typePicker, 'shelf');
    expect([...manualForm.querySelectorAll('label')].some((l) => l.textContent!.includes('Max weight'))).toBe(false);
    setInput(codeInput, 'A-01-03');
    act(() => manualForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    const shelfPost = requests.find((r) => r.method === 'POST' && r.pathname.endsWith('/bins'))!;
    expect(shelfPost.body).toEqual({ code: 'A-01-03', capacity: 120, type: 'shelf' });

    // A bulk type: the weight input appears, required, and rides the payload.
    setSelect(typePicker, 'tank');
    const weightInput = [...manualForm.querySelectorAll<HTMLInputElement>('input')]
      .find((i) => i.type === 'number' && [...(i.closest('label')?.querySelectorAll('span') ?? [])].some((s) => s.textContent === 'Max weight (grams)'));
    expect(weightInput).toBeDefined();
    setInput(codeInput, 'A-01-04');
    setInput(weightInput!, '5000');
    act(() => manualForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    const tankPost = requests.filter((r) => r.method === 'POST' && r.pathname.endsWith('/bins')).at(-1)!;
    expect(tankPost.body).toEqual({ code: 'A-01-04', capacity: 120, type: 'tank', maxWeightGrams: 5000 });

    // The second bulk type (review 2, triage #32): the conditional spread is
    // keyed on the whole bulk set, so `silo` rides the wire the same way — a
    // per-type typo in the usage would otherwise pass this suite.
    setSelect(typePicker, 'silo');
    const siloWeightInput = [...manualForm.querySelectorAll<HTMLInputElement>('input')]
      .find((i) => i.type === 'number' && [...(i.closest('label')?.querySelectorAll('span') ?? [])].some((s) => s.textContent === 'Max weight (grams)'));
    expect(siloWeightInput).toBeDefined();
    setInput(codeInput, 'A-01-05');
    setInput(siloWeightInput!, '8000');
    act(() => manualForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    const siloPost = requests.filter((r) => r.method === 'POST' && r.pathname.endsWith('/bins')).at(-1)!;
    expect(siloPost.body).toEqual({ code: 'A-01-05', capacity: 120, type: 'silo', maxWeightGrams: 8000 });
  });

  test('a merge refused with bin-occupancy-conflict renders the surface copy', async () => {
    nextMergeStatus = 400;
    // No `detail` — the assertion pins the surface's OWN copy (the switch
    // case), not the server's prose.
    nextMergeBody = { code: 'bin-occupancy-conflict', title: 'Bulk asset cannot hold two SKUs', status: 400 };
    view = await mount();

    // Open the merge flow on the shelf row, pick the tank as target, confirm.
    const row = [...view.container.querySelectorAll('tbody tr')].find((tr) => tr.textContent!.includes('A-01-01'))!;
    const rowMerge = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Merge');
    expect(rowMerge).toBeDefined();
    act(() => rowMerge!.click());
    await settle();
    const targetSelect = [...view.container.querySelectorAll('select')].find((s) =>
      [...s.querySelectorAll('option')].some((o) => o.textContent === 'Pick a target bin…'),
    );
    expect(targetSelect).toBeDefined();
    setSelect(targetSelect!, TANK_ID);
    const confirm = [...view.container.querySelectorAll('button')]
      .filter((b) => b.textContent === 'Merge')
      .find((b) => b.closest('table') === null);
    expect(confirm).toBeDefined();
    act(() => confirm!.click());
    await settle();

    const alert = view.container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain('A bulk asset holds exactly one SKU');
  });
});
