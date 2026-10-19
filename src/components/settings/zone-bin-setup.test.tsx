import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { CLIENT_DEPARTED_REASON } from '../../lib/client-departed';
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
  tenant: { id: TENANT_ID, name: 'Priya Spices', gstin: null },
  user: { id: 'u-1', email: 'priya@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

function clientRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: '0198f7a2-1b3c-7d4e-8f90-aaaaaaaaaaa1',
    tenantId: TENANT_ID,
    code: 'GLOW',
    name: 'GlowCo',
    status: 'active',
    systemOwned: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    taxDetails: { legalName: null, gstin: null, billingLine1: null, billingLine2: null, billingCity: null, billingStateCode: null, billingPincode: null },
    registeredAddress: null,
    returnAddress: null,
    ...over,
  };
}
const SELF_CLIENT = clientRow({ id: '0198f7a2-1b3c-7d4e-8f90-aaaaaaaaaaa0', code: 'self', name: 'Priya Spices', systemOwned: true });
const GLOW_ID = '0198f7a2-1b3c-7d4e-8f90-aaaaaaaaaaa1';
const GONE_ID = '0198f7a2-1b3c-7d4e-8f90-aaaaaaaaaaa2';
const GLOW_CLIENT = clientRow({});
const GONE_CLIENT = clientRow({ id: GONE_ID, code: 'GONE', name: 'Gone Co', status: 'departed' });

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly body: unknown;
  readonly headers: Record<string, string>;
}

let requests: Recorded[] = [];
/** The next merge answer, so a test can force the occupancy refusal. */
let nextMergeStatus = 200;
let nextMergeBody: unknown = null;
/** The next bin-PATCH answer, so a class test can force the 409 refusal. */
let nextPatchStatus = 200;
let nextPatchBody: unknown = null;
/** Story 1-5b — the clients read: one client (the D2C default) unless a test widens it; null = the read fails. */
let clientsItems: unknown[] | null = null;
/** Story 1-5b — the next bin-CREATE answer, so a test can force a refusal. */
let nextCreateStatus = 201;
let nextCreateBody: unknown = null;
/** Story 1-5b — the bins list, overridable per test. */
let binsItems: unknown[] | null = null;

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
    dedicatedClientId: null,
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
    requests.push({ method, pathname, body, headers });
    if (method === 'GET' && pathname.endsWith('/clients')) {
      if (clientsItems === null) return json(500, { code: 'internal', title: 'Boom', status: 500 });
      return json(200, { items: clientsItems });
    }
    if (method === 'PATCH' && /\/bins\/[^/]+$/.test(pathname)) {
      if (nextPatchStatus !== 200) {
        const refusal = nextPatchBody;
        const status = nextPatchStatus;
        nextPatchStatus = 200;
        nextPatchBody = null;
        return json(status, refusal);
      }
      // The echo carries the SAVED class — the reload must show the bin as
      // the server now stores it.
      const over = (body !== null && typeof body === 'object' ? body : {}) as Record<string, unknown>;
      return json(200, bin(over));
    }
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
      return json(200, { items: binsItems ?? [bin(), bin({ id: TANK_ID, code: 'A-01-02', type: 'tank', maxWeightGrams: 1000 })], nextCursor: null });
    }
    if (method === 'POST' && pathname.endsWith('/bins/grid')) {
      return json(201, { generatedCount: 1, firstCode: 'B-01-01', lastCode: 'B-01-01' });
    }
    if (method === 'POST' && pathname.endsWith('/bins')) {
      if (nextCreateStatus !== 201) {
        const refusal = nextCreateBody;
        const status = nextCreateStatus;
        nextCreateStatus = 201;
        nextCreateBody = null;
        return json(status, refusal);
      }
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
  nextPatchStatus = 200;
  nextPatchBody = null;
  nextCreateStatus = 201;
  nextCreateBody = null;
  clientsItems = [SELF_CLIENT];
  binsItems = null;
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

/**
 * The bin storage-class edit (story 12-7). The claims a `src/lib` test
 * cannot make:
 *   1. the Edit-class affordance on a live bin PATCHes the structure arm
 *      with `{ storageClass }` ONLY (mutually exclusive with `blocked`) and
 *      carries its per-click ULID Idempotency-Key,
 *   2. the saved banner speaks from the RESPONSE ("A-01-01 storage class set
 *      to chilled") and the editor closes,
 *   3. a stranding change refused 409 `storage-class-conflict` renders the
 *      server's detail VERBATIM and the editor STAYS OPEN so another class
 *      can be picked.
 */
describe('ZonesBinsSetup: the storage-class edit (story 12-7)', () => {
  function setSelect(select: HTMLSelectElement, value: string): void {
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(select, value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  async function openClassEditor(): Promise<void> {
    const row = [...view!.container.querySelectorAll('tbody tr')].find((tr) =>
      tr.textContent!.includes('A-01-01'),
    )!;
    const edit = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Edit class');
    expect(edit).toBeDefined();
    act(() => edit!.click());
    await settle();
  }

  function editorSelect(container: HTMLElement): HTMLSelectElement {
    // Anchor on the Save button, then the panel div that owns it — matching
    // on the panel's prose alone also matches the outer wrapper.
    const save = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save class');
    expect(save).toBeDefined();
    return save!.closest('div')!.querySelector('select')!;
  }

  test('the edit PATCHes the structure arm with the class only, and the saved banner names the response', async () => {
    view = await mount();
    await openClassEditor();

    // The editor opens prefilled from the row's current class.
    const select = editorSelect(view.container);
    expect(select.value).toBe('ambient');
    setSelect(select, 'chilled');

    const save = [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Save class')!;
    act(() => save.click());
    await settle();

    const patch = requests.find((r) => r.method === 'PATCH' && /\/bins\/[^/]+$/.test(r.pathname));
    expect(patch).toBeDefined();
    expect(patch!.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/warehouses/${WAREHOUSE_ID}/bins/${SHELF_ID}`);
    // The structure arm carries the class ONLY — never blocked alongside.
    expect(patch!.body).toEqual({ storageClass: 'chilled' });
    const headerKeys = Object.keys(patch!.headers).map((k) => k.toLowerCase());
    expect(headerKeys).toContain('idempotency-key');
    // The banner speaks from the RESPONSE, and the editor closed.
    expect(view.container.textContent).toContain('A-01-01 storage class set to chilled');
    expect(view.container.textContent).not.toContain('Editing the storage class of');
  });

  test('a stranding class change renders the server detail verbatim and the editor stays open', async () => {
    view = await mount();
    await openClassEditor();

    nextPatchStatus = 409;
    nextPatchBody = {
      code: 'storage-class-conflict',
      title: 'Storage class change would strand stock',
      status: 409,
      detail: 'Bin A-01-01 holds 3 units of SPICE-01 whose SKU is not chilled-compatible — relocate them first.',
    };
    const select = editorSelect(view.container);
    setSelect(select, 'chilled');
    const save = [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Save class')!;
    act(() => save.click());
    await settle();

    const alert = view.container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain('Not updated');
    expect(alert!.textContent).toContain('Bin A-01-01 holds 3 units of SPICE-01');
    // The editor STAYS open — the viewer picks another class or cancels.
    expect(view.container.textContent).toContain('Editing the storage class of');
  });
});

/**
 * The Edit-class affordance's gating and the post-save reload (triage row
 * 15 / finding 15): the BE gates the structure arm on `bin.create`, the FE
 * mirrors that decision by HIDING the affordance from roles without it
 * (hide surfaces, never "blocked" screens), and a successful save reloads
 * the bins list so the table shows the server's answer.
 */
describe('ZonesBinsSetup: the Edit-class gating and reload (triage row 15)', () => {
  test('an operator (no bin.create) sees the rows and NO Edit-class affordance', async () => {
    writeSession({ ...SESSION, user: { id: 'u-1', email: 'priya@example.com', role: 'operator', status: 'active' } });
    view = await mount();

    const row = [...view.container.querySelectorAll('tbody tr')].find((tr) => tr.textContent!.includes('A-01-01'))!;
    expect(row).toBeDefined();
    expect([...row.querySelectorAll('button')].some((b) => b.textContent === 'Edit class')).toBe(false);
    // No editor can open — there is no Save-class button anywhere either.
    expect([...view.container.querySelectorAll('button')].some((b) => b.textContent === 'Save class')).toBe(false);
  });

  test('a successful class save reloads the bins list — the table shows the server answer', async () => {
    view = await mount();
    const binsGetsBefore = requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/bins')).length;

    const row = [...view.container.querySelectorAll('tbody tr')].find((tr) => tr.textContent!.includes('A-01-01'))!;
    const edit = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Edit class')!;
    act(() => edit.click());
    await settle();
    const save = [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Save class')!;
    act(() => save.click());
    await settle();

    expect(requests.find((r) => r.method === 'PATCH' && /\/bins\/[^/]+$/.test(r.pathname))).toBeDefined();
    const binsGetsAfter = requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/bins')).length;
    expect(binsGetsAfter).toBeGreaterThan(binsGetsBefore);
    // The editor closed on success.
    expect(view.container.textContent).not.toContain('Editing the storage class of');
  });
});

/**
 * Story 1-5b — dedicated client bins. The claims a lib test cannot make: the
 * Client column, the Edit-client panel and the create/grid client field exist
 * only for a multi-client tenant and a `bin.create` role; pressing Save sends
 * exactly the body the pick implies (or nothing); refusals render their
 * copy; the merge picker labels a dedicated target.
 */
describe('ZonesBinsSetup: dedicated client bins (story 1-5b)', () => {
  const MULTI = () => [SELF_CLIENT, GLOW_CLIENT, GONE_CLIENT];

  function rowOf(code: string): HTMLTableRowElement {
    const row = [...view!.container.querySelectorAll('tbody tr')].find((tr) => tr.textContent!.includes(code));
    expect(row).toBeDefined();
    return row as HTMLTableRowElement;
  }
  function button(scope: ParentNode, label: string): HTMLButtonElement | undefined {
    return [...scope.querySelectorAll('button')].find((b) => b.textContent === label);
  }
  async function openClientEditor(code = 'A-01-01'): Promise<HTMLSelectElement> {
    const edit = button(rowOf(code), 'Edit client');
    expect(edit).toBeDefined();
    act(() => edit!.click());
    await settle();
    const save = button(view!.container, 'Save client');
    expect(save).toBeDefined();
    return save!.closest('div')!.querySelector('select')!;
  }
  async function save(): Promise<void> {
    act(() => button(view!.container, 'Save client')!.click());
    await settle();
  }
  const patches = () => requests.filter((r) => r.method === 'PATCH' && /\/bins\/[^/]+$/.test(r.pathname));

  test('a single-client tenant sees no Client column, no Edit client and no client field', async () => {
    view = await mount();
    expect([...view.container.querySelectorAll('th')].some((th) => th.textContent === 'Client')).toBe(false);
    expect(button(rowOf('A-01-01'), 'Edit client')).toBeUndefined();
    expect([...view.container.querySelectorAll('label span')].some((s) => s.textContent === 'Client')).toBe(false);
  });

  test('the Client column resolves every client — Shared, a working one, a departed one', async () => {
    clientsItems = MULTI();
    binsItems = [bin(), bin({ id: TANK_ID, code: 'A-01-02', dedicatedClientId: GLOW_ID }), bin({ id: '0198f7a2-1b3c-7d4e-8f90-777777777777', code: 'A-01-09', dedicatedClientId: GONE_ID })];
    view = await mount();
    expect([...view.container.querySelectorAll('th')].some((th) => th.textContent === 'Client')).toBe(true);
    expect(rowOf('A-01-01').textContent).toContain('Shared');
    expect(rowOf('A-01-02').textContent).toContain('GLOW');
    expect(rowOf('A-01-09').textContent).toContain('GONE (departed)');
  });

  test('edit dedicates with { dedicatedClientId } only, and clear sends null', async () => {
    clientsItems = MULTI();
    view = await mount();
    let select = await openClientEditor();
    // Departed clients are not offered for a new dedication.
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Shared', 'Priya Spices', 'GLOW']);
    setSelect(select, GLOW_ID);
    await save();
    expect(patches().at(-1)!.body).toEqual({ dedicatedClientId: GLOW_ID });
    expect(Object.keys(patches().at(-1)!.headers).map((k) => k.toLowerCase())).toContain('idempotency-key');
    expect(view.container.textContent).toContain('A-01-01 dedicated to GLOW');

    binsItems = [bin({ dedicatedClientId: GLOW_ID })];
    view.unmount();
    view = await mount();
    select = await openClientEditor();
    expect(select.value).toBe(GLOW_ID);
    setSelect(select, '');
    await save();
    expect(patches().at(-1)!.body).toEqual({ dedicatedClientId: null });
  });

  test('an unchanged pick sends nothing — including a departed current value kept on Save', async () => {
    clientsItems = MULTI();
    binsItems = [bin({ dedicatedClientId: GONE_ID })];
    view = await mount();
    const select = await openClientEditor();
    expect(select.value).toBe(GONE_ID);
    const current = [...select.querySelectorAll('option')].find((o) => o.value === GONE_ID)!;
    expect(current.disabled).toBe(true);
    expect(current.textContent).toBe('GONE (departed)');
    await save();
    expect(patches()).toHaveLength(0);
    expect(button(view.container, 'Save client')).toBeUndefined();
  });

  for (const [code, status, detail, expected] of [
    ['bin-client-conflict', 409, 'Bin "A-01-01" cannot be dedicated to GLOW: it has another client\'s stock on hand — "S-1".', 'it has another client\'s stock on hand — "S-1"'],
    ['bin-client-mismatch', 400, 'Bin "A-01-01" is dedicated to GLOW; SKU "S-1" belongs to Priya Spices.', 'SKU "S-1" belongs to Priya Spices'],
    ['client-departed', 409, 'GONE has departed', 'This client has departed and takes no new work'],
    ['not-found', 404, 'No client with id …', 'That client no longer exists'],
  ] as const) {
    test(`a ${code} refusal renders its copy and the panel stays open`, async () => {
      clientsItems = MULTI();
      view = await mount();
      const select = await openClientEditor();
      setSelect(select, GLOW_ID);
      nextPatchStatus = status;
      nextPatchBody = { code, title: 'Refused', status, detail };
      await save();
      const alert = view.container.querySelector('[role="alert"]');
      expect(alert).not.toBeNull();
      expect(alert!.textContent).toContain(expected);
      expect(button(view.container, 'Save client')).toBeDefined();
    });
  }

  test('a merge refused bin-client-mismatch renders the server detail; the picker labels a dedicated target', async () => {
    clientsItems = MULTI();
    binsItems = [bin(), bin({ id: TANK_ID, code: 'A-01-02', dedicatedClientId: GLOW_ID })];
    nextMergeStatus = 400;
    nextMergeBody = { code: 'bin-client-mismatch', title: 'x', status: 400, detail: 'Bin "A-01-02" is dedicated to GLOW; SKU "S-1" belongs to Priya Spices.' };
    view = await mount();
    act(() => button(rowOf('A-01-01'), 'Merge')!.click());
    await settle();
    const target = [...view.container.querySelectorAll('select')].find((s) => [...s.querySelectorAll('option')].some((o) => o.textContent === 'Pick a target bin…'))!;
    expect([...target.querySelectorAll('option')].map((o) => o.textContent)).toContain('A-01-02 — GLOW');
    setSelect(target, TANK_ID);
    const confirm = [...view.container.querySelectorAll('button')].filter((b) => b.textContent === 'Merge').find((b) => b.closest('table') === null)!;
    act(() => confirm.click());
    await settle();
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain('SKU "S-1" belongs to Priya Spices');
  });

  test('system and retired bins are inert; a role without bin.create gets no Edit client', async () => {
    clientsItems = MULTI();
    binsItems = [bin({ systemOwned: true, code: 'RECEIVING' }), bin({ id: TANK_ID, code: 'A-01-02', retiredAt: '2026-10-01T00:00:00.000Z' })];
    view = await mount();
    expect(button(rowOf('RECEIVING'), 'Edit client')!.disabled).toBe(true);
    expect(button(rowOf('A-01-02'), 'Edit client')!.disabled).toBe(true);
    view.unmount();

    writeSession({ ...SESSION, user: { id: 'u-1', email: 'priya@example.com', role: 'operator', status: 'active' } });
    binsItems = null;
    view = await mount();
    expect(button(rowOf('A-01-01'), 'Edit client')).toBeUndefined();
    // The column is a read — every member sees it.
    expect([...view.container.querySelectorAll('th')].some((th) => th.textContent === 'Client')).toBe(true);
  });

  test('a failed clients read hides the client affordances and says so', async () => {
    clientsItems = null;
    view = await mount();
    expect(view.container.textContent).toContain('Clients could not be loaded');
    expect(button(rowOf('A-01-01'), 'Edit client')).toBeUndefined();
  });

  test('create and grid carry dedicatedClientId only when a client is chosen', async () => {
    clientsItems = MULTI();
    view = await mount();
    const clientSelect = (form: HTMLFormElement) =>
      [...form.querySelectorAll('label')].find((l) => l.textContent!.startsWith('Client'))!.querySelector('select')!;

    const manual = formFor(view.container, 'Create bin');
    setSelect([...manual.querySelectorAll('label')].find((l) => l.textContent!.startsWith('Zone'))!.querySelector('select')!, ZONE_ID);
    const code = [...manual.querySelectorAll('input')].find((i) => i.placeholder === 'A-01-01')!;
    expect(clientSelect(manual).value).toBe('');
    setInput(code, 'A-02-01');
    act(() => manual.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    expect(requests.filter((r) => r.method === 'POST' && r.pathname.endsWith('/bins')).at(-1)!.body).toEqual({ code: 'A-02-01', capacity: 120, type: 'shelf' });
    setSelect(clientSelect(manual), GLOW_ID);
    setInput(code, 'A-02-02');
    act(() => manual.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    expect(requests.filter((r) => r.method === 'POST' && r.pathname.endsWith('/bins')).at(-1)!.body).toEqual({ code: 'A-02-02', capacity: 120, type: 'shelf', dedicatedClientId: GLOW_ID });

    const grid = formFor(view.container, 'Generate bins');
    setSelect([...grid.querySelectorAll('label')].find((l) => l.textContent!.startsWith('Zone'))!.querySelector('select')!, ZONE_ID);
    act(() => grid.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    const gridPost = () => requests.filter((r) => r.method === 'POST' && r.pathname.endsWith('/bins/grid')).at(-1)!.body as Record<string, unknown>;
    expect('dedicatedClientId' in gridPost()).toBe(false);
    setSelect(clientSelect(grid), GLOW_ID);
    act(() => grid.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    expect(gridPost().dedicatedClientId).toBe(GLOW_ID);
  });

  test('a create with a client chosen: 409 client-departed and 404 not-found render the client-aware copy', async () => {
    clientsItems = MULTI();
    view = await mount();
    const manual = formFor(view.container, 'Create bin');
    setSelect([...manual.querySelectorAll('label')].find((l) => l.textContent!.startsWith('Zone'))!.querySelector('select')!, ZONE_ID);
    setSelect([...manual.querySelectorAll('label')].find((l) => l.textContent!.startsWith('Client'))!.querySelector('select')!, GLOW_ID);
    const code = [...manual.querySelectorAll('input')].find((i) => i.placeholder === 'A-01-01')!;

    nextCreateStatus = 409;
    nextCreateBody = { code: 'client-departed', title: 'Client departed', status: 409, detail: 'GLOW has departed' };
    setInput(code, 'A-03-01');
    act(() => manual.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    expect(view.container.textContent).toContain(CLIENT_DEPARTED_REASON);

    nextCreateStatus = 404;
    nextCreateBody = { code: 'not-found', title: 'Not found', status: 404 };
    setInput(code, 'A-03-02');
    act(() => manual.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    expect(view.container.textContent).toContain('That warehouse, zone or client no longer exists');
  });
});
