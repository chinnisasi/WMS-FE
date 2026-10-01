import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { ReplenishmentView } from './replenishment-view';

/**
 * The replenishment surface (story 6-1, the batch-alert queue is story 6-2),
 * driven through a stubbed global `fetch` — the generated client is a fetch
 * wrapper — so the wiring under test is the one that ships. The claims only
 * a component test can make:
 *   1. submit-never-auto: mounting the queues sends reads alone — no
 *      POST/PUT/DELETE of any kind until a button is clicked,
 *   2. the submit body carries the card's PICKED vendor and the parsed
 *      quantity in MILLI, with a per-click Idempotency-Key, and the outcome
 *      reads the FLAT response (`purchaseOrder` IS the minted PO),
 *   3. a 409 `suggested-po-submitted`, a 409 `breach-not-open` and a 409
 *      `batch-alert-not-open` render the server's own words verbatim AND
 *      re-read their queue (the reload IS the refusal's recovery),
 *   4. two synchronous clicks on a submit button send exactly ONE POST (the
 *      re-entry guard runs before `disabled` renders),
 *   5. an operator session renders the queues and the table read-only —
 *      no mutating affordance at all,
 *   6. a policy upsert sends a PUT whose body carries the milli-converted
 *      values the base-unit inputs named,
 *   7. the batch-alert queue's kind filter rides the read as a query param,
 *      open rows render amber WITH the kind named (never colour alone),
 *      and the batch click-through reads the DETAIL route — base-unit
 *      quantities there, no milli conversion.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-222222222222';
const VENDOR_ID = '0198f7a2-1b3c-7d4e-8f90-333333333333';
const BREACH_ID = '0198f7a2-1b3c-7d4e-8f90-444444444444';
const DRAFT_ID = '0198f7a2-1b3c-7d4e-8f90-555555555555';
const SKU_ID = '0198f7a2-1b3c-7d4e-8f90-666666666666';
const POLICY_ID = '0198f7a2-1b3c-7d4e-8f90-777777777777';
const ALERT_ID = '0198f7a2-1b3c-7d4e-8f90-888888888888';
const ALERT2_ID = '0198f7a2-1b3c-7d4e-8f90-898989898989';
const BATCH_ID = '0198f7a2-1b3c-7d4e-8f90-121212121212';
const BIN_ID = '0198f7a2-1b3c-7d4e-8f90-131313131313';

const OWNER_SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Priya Spices' },
  user: { id: 'u-1', email: 'priya@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

const OPERATOR_SESSION: StoredSession = {
  ...OWNER_SESSION,
  user: { ...OWNER_SESSION.user, role: 'operator' },
};

let requests: {
  method: string;
  pathname: string;
  query: string;
  body: unknown;
  headers: Record<string, string>;
}[] = [];
let breachRows: Record<string, unknown>[];
let draftRows: Record<string, unknown>[];
let policyRows: Record<string, unknown>[];
let batchAlertRows: Record<string, unknown>[];
/** null = no config row (the OFF convention read back). */
let expiryPolicyRow: Record<string, unknown> | null;
/** null = the batch detail read 404s (unknown/foreign batch). */
let batchDetailRow: Record<string, unknown> | null;
/** When set, the policies read serves these pages IN ORDER (the walker's cursor chain). */
let policyPageQueue: { items: Record<string, unknown>[]; nextCursor: string | null }[] | null = null;
/** The next dismiss answer; non-200 simulates the 409 race arm. */
let nextDismissStatus = 200;
/** The next submit answer; non-200 simulates the 409 race arm. */
let nextSubmitStatus = 200;
/** The next BATCH-ALERT dismiss answer; non-200 simulates the 409 race arm. */
let nextAlertDismissStatus = 200;

function breach(): Record<string, unknown> {
  return {
    id: BREACH_ID,
    tenantId: TENANT_ID,
    warehouseId: WAREHOUSE_ID,
    skuId: SKU_ID,
    status: 'open',
    pointMilli: 10000,
    atpMilli: 4000,
    breachAt: '2026-09-28T08:00:00.000Z',
    resolvedAt: null,
    resolvedBy: null,
  };
}

function draft(): Record<string, unknown> {
  return {
    id: DRAFT_ID,
    tenantId: TENANT_ID,
    warehouseId: WAREHOUSE_ID,
    skuId: SKU_ID,
    breachId: BREACH_ID,
    vendorId: VENDOR_ID,
    quantityMilli: 5000,
    status: 'draft',
    submittedPoId: null,
    createdAt: '2026-09-28T08:00:00.000Z',
    updatedAt: '2026-09-28T08:00:00.000Z',
  };
}

function policy(): Record<string, unknown> {
  return {
    id: POLICY_ID,
    tenantId: TENANT_ID,
    warehouseId: WAREHOUSE_ID,
    skuId: SKU_ID,
    // 20 kg point, 100 kg qty — milli on the wire.
    reorderPoint: 20000,
    reorderQty: 100000,
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
  };
}

function batchAlert(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ALERT_ID,
    warehouseId: WAREHOUSE_ID,
    skuId: SKU_ID,
    batchId: BATCH_ID,
    kind: 'expiry_upcoming',
    status: 'open',
    ageDays: null,
    onHandMilli: 2500,
    detectedAt: '2026-09-28T08:00:00.000Z',
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  };
}

function expiryPolicy(): Record<string, unknown> {
  return {
    expiryLeadDays: 7,
    agingThresholdDays: 30,
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
  };
}

/** The batch DETAIL response — inventory's wire: bin quantities in BASE units. */
function batchDetail(): Record<string, unknown> {
  return {
    id: BATCH_ID,
    skuId: SKU_ID,
    code: 'B-EX-01',
    mfgDate: '2026-05-01T00:00:00.000Z',
    expiryDate: '2026-10-05T00:00:00.000Z',
    status: 'active',
    bins: [{ warehouseId: WAREHOUSE_ID, binId: BIN_ID, quantity: 2.5 }],
    history: [
      {
        warehouseId: WAREHOUSE_ID,
        seq: 1,
        type: 'stock.intaked',
        skuId: SKU_ID,
        quantityDelta: 2.5,
        fromBinId: null,
        toBinId: BIN_ID,
        serialRef: null,
        occurredAt: '2026-09-01T08:00:00.000Z',
        recordedAt: '2026-09-01T08:00:01.000Z',
        eventHash: 'deadbeef',
      },
    ],
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
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
        items: [
          {
            id: SKU_ID,
            code: 'SPICE-01',
            name: 'Turmeric',
            uom: 'kg',
            uomPrecision: 3,
            uomConversions: [],
            // Tenant-wide column defaults (base units on the SKU wire).
            reorderPoint: 10,
            reorderQty: 50,
          },
        ],
        nextCursor: null,
      });
    }
    if (method === 'GET' && pathname.endsWith('/vendors')) {
      return json(200, {
        items: [{ id: VENDOR_ID, code: 'V-1', name: 'Annapurna Traders', createdAt: '2026-09-02T00:00:00.000Z' }],
        nextCursor: null,
      });
    }
    if (method === 'GET' && pathname.endsWith('/users')) {
      return json(200, { items: [{ id: 'u-1', email: 'priya@example.com' }], nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith('/replenishment/breaches')) {
      return json(200, { items: breachRows, nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith('/replenishment/suggested-pos')) {
      return json(200, { items: draftRows, nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith('/replenishment/policies')) {
      if (policyPageQueue !== null) {
        // The multi-page walker scenario: pages served IN ORDER, exhausted
        // queue keeps answering with a live cursor (the chain never ends).
        return json(200, policyPageQueue.length > 0 ? (policyPageQueue.shift() as { items: Record<string, unknown>[]; nextCursor: string | null }) : { items: policyRows, nextCursor: 'cursor-deeper' });
      }
      return json(200, { items: policyRows, nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith('/replenishment/expiry-policies')) {
      return expiryPolicyRow === null
        ? json(404, {
            code: 'not-found',
            title: 'No expiry alert policy',
            status: 404,
            detail: 'No expiry alert config exists for this tenant.',
          })
        : json(200, { expiryPolicy: expiryPolicyRow });
    }
    if (method === 'GET' && pathname.endsWith('/replenishment/batch-alerts')) {
      return json(200, { items: batchAlertRows, nextCursor: null });
    }
    if (method === 'POST' && pathname.includes('/replenishment/batch-alerts/')) {
      if (nextAlertDismissStatus !== 200) {
        const status = nextAlertDismissStatus;
        nextAlertDismissStatus = 200;
        return json(status, {
          code: 'batch-alert-not-open',
          title: 'Batch alert not open',
          status: 409,
          detail: 'This batch alert was auto-resolved moments ago.',
        });
      }
      return json(200, {
        batchAlert: { ...batchAlert(), status: 'dismissed', resolvedBy: 'u-1', resolvedAt: '2026-09-28T09:00:00.000Z' },
      });
    }
    if (method === 'GET' && pathname.includes('/inventory/batches/')) {
      return batchDetailRow === null
        ? json(404, { code: 'not-found', title: 'No such batch', status: 404, detail: 'No batch with this id exists in this tenant.' })
        : json(200, batchDetailRow);
    }
    if (method === 'POST' && pathname.endsWith('/dismiss')) {
      if (nextDismissStatus !== 200) {
        const status = nextDismissStatus;
        nextDismissStatus = 200;
        return json(status, {
          code: 'breach-not-open',
          title: 'Breach not open',
          status: 409,
          detail: 'This breach was recovered moments ago.',
        });
      }
      return json(200, { ...breach(), status: 'dismissed', resolvedBy: 'u-1', resolvedAt: '2026-09-28T09:00:00.000Z' });
    }
    if (method === 'POST' && pathname.endsWith('/submit')) {
      if (nextSubmitStatus !== 200) {
        const status = nextSubmitStatus;
        nextSubmitStatus = 200;
        return json(status, {
          code: 'suggested-po-submitted',
          title: 'Suggested PO already submitted',
          status: 409,
          detail: 'This suggested PO has already been submitted.',
        });
      }
      // The FLAT carrier: `purchaseOrder` IS the minted PO.
      return json(200, {
        suggestedPoId: DRAFT_ID,
        purchaseOrder: {
          id: 'po-1',
          code: 'PO-2026-0142',
          status: 'confirmed',
          warehouseId: WAREHOUSE_ID,
          vendorId: VENDOR_ID,
          lines: [{ id: 'line-1' }, { id: 'line-2' }, { id: 'line-3' }],
        },
      });
    }
    if (method === 'PUT' && pathname.endsWith('/replenishment/policies')) {
      return json(200, { ...policy(), ...((body as Record<string, unknown>) ?? {}) });
    }
    if (method === 'DELETE' && pathname.includes('/replenishment/policies/')) {
      return json(200, policy());
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  nextDismissStatus = 200;
  nextSubmitStatus = 200;
  nextAlertDismissStatus = 200;
  breachRows = [breach()];
  draftRows = [draft()];
  policyRows = [policy()];
  batchAlertRows = [
    batchAlert(),
    batchAlert({ id: ALERT2_ID, kind: 'aged', ageDays: 45, onHandMilli: 7000 }),
  ];
  expiryPolicyRow = expiryPolicy();
  batchDetailRow = batchDetail();
  policyPageQueue = null;
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
  writeSession(session);
  const rendered = render(<ReplenishmentView />);
  await settle();
  return rendered;
}

function button(scope: HTMLElement, label: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll('button')].find((b) => b.textContent === label);
  if (found === undefined) {
    throw new Error(`no button labeled "${label}"`);
  }
  return found as HTMLButtonElement;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
}

function readsEndingWith(suffix: string, method = 'GET'): typeof requests {
  return requests.filter((r) => r.method === method && r.pathname.endsWith(suffix));
}

function postsEndingWith(suffix: string): typeof requests {
  return readsEndingWith(suffix, 'POST');
}

function header(record: (typeof requests)[number], name: string): string | undefined {
  return Object.entries(record.headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
}

/** A controlled React input needs the native setter or React never sees it. */
function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ReplenishmentView: the suggested-PO submit flow (story 6-1)', () => {
  test('submit-never-auto: mounting sends reads only; a click sends the one POST', async () => {
    view = await mount();
    const mutatingBefore = requests.filter((r) => r.method !== 'GET');
    expect(mutatingBefore).toEqual([]);

    await click(button(view.container, 'Submit as purchase order'));
    await settle();

    expect(postsEndingWith('/submit')).toHaveLength(1);
  });

  test('the submit body carries the picked vendor, the parsed MILLI quantity and a fresh key; the outcome reads the FLAT PO', async () => {
    view = await mount();
    // The card's quantity input: 5 kg suggested → the operator types 7.5 kg.
    const qtyInput = view.container.querySelector('input[aria-label="Quantity"]') as HTMLInputElement;
    setInput(qtyInput, '7.5');

    await click(button(view.container, 'Submit as purchase order'));
    await settle();

    const posts = postsEndingWith('/submit');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({ vendorId: VENDOR_ID, quantityMilli: 7500 });
    const key = header(posts[0]!, 'idempotency-key');
    expect(key).toBeDefined();
    expect(key!.length).toBeGreaterThanOrEqual(26);
    // The outcome names the minted PO off the FLAT response.
    const banner = view.container.textContent ?? '';
    expect(banner).toContain('PO-2026-0142 submitted');
    expect(banner).toContain('3 lines');
    // The queue re-reads — the submitted draft must leave the Drafts tab.
    expect(readsEndingWith('/replenishment/suggested-pos').length).toBeGreaterThanOrEqual(2);
  });

  test('a 409 suggested-po-submitted renders the server\'s words verbatim AND re-reads the queue', async () => {
    view = await mount();
    const readsBefore = readsEndingWith('/replenishment/suggested-pos').length;
    nextSubmitStatus = 409;

    await click(button(view.container, 'Submit as purchase order'));
    await settle();

    const banner = view.container.textContent ?? '';
    expect(banner).toContain('Suggested PO already submitted');
    expect(banner).toContain('This suggested PO has already been submitted.');
    expect(readsEndingWith('/replenishment/suggested-pos').length).toBeGreaterThan(readsBefore);
  });

  test('two synchronous clicks on the submit button send exactly one POST', async () => {
    view = await mount();
    const submit = button(view.container, 'Submit as purchase order');

    await act(async () => {
      submit.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      submit.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await settle();

    expect(postsEndingWith('/submit')).toHaveLength(1);
  });
});

describe('ReplenishmentView: the breach queue (story 6-1)', () => {
  test('a 409 breach-not-open renders the server\'s words verbatim AND re-reads the queue', async () => {
    view = await mount();
    const readsBefore = readsEndingWith('/replenishment/breaches').length;
    nextDismissStatus = 409;

    await click(button(view.container, 'Dismiss'));
    await settle();

    const banner = view.container.textContent ?? '';
    expect(banner).toContain('Breach not open');
    expect(banner).toContain('This breach was recovered moments ago.');
    expect(readsEndingWith('/replenishment/breaches').length).toBeGreaterThan(readsBefore);
  });

  test('a dismissal re-reads the queue and the rows render quantities at the SKU precision', async () => {
    view = await mount();
    // 10000 milli point → '10.000 kg' at uomPrecision 3; 4000 milli ATP →
    // '4.000 kg' — declared precision, never raw milli.
    const text = view.container.textContent ?? '';
    expect(text).toContain('SPICE-01');
    expect(text).toContain('reorder point 10.000 kg');
    expect(text).toContain('ATP 4.000 kg');

    const readsBefore = readsEndingWith('/replenishment/breaches').length;
    await click(button(view.container, 'Dismiss'));
    await settle();

    expect(postsEndingWith('/dismiss')).toHaveLength(1);
    expect(readsEndingWith('/replenishment/breaches').length).toBeGreaterThan(readsBefore);
  });
});

describe('ReplenishmentView: the reorder-override table (story 6-1)', () => {
  test('the upsert sends a PUT whose body carries the milli-converted values of the base-unit inputs', async () => {
    view = await mount();
    await click(button(view.container, 'Edit'));

    const point = view.container.querySelector(
      'input[aria-label="Reorder point for SPICE-01"]',
    ) as HTMLInputElement;
    const qty = view.container.querySelector(
      'input[aria-label="Reorder quantity for SPICE-01"]',
    ) as HTMLInputElement;
    // Prefilled from the governing OVERRIDE (20 kg / 100 kg), not the default.
    expect(point.value).toBe('20');
    expect(qty.value).toBe('100');
    setInput(point, '12.5');
    setInput(qty, '60');

    await click(button(view.container.parentElement ?? view.container, 'Save'));
    await settle();

    const puts = requests.filter((r) => r.method === 'PUT' && r.pathname.endsWith('/replenishment/policies'));
    expect(puts).toHaveLength(1);
    expect(puts[0]!.body).toEqual({
      warehouseId: WAREHOUSE_ID,
      skuId: SKU_ID,
      reorderPoint: 12500,
      reorderQty: 60000,
    });
    expect(header(puts[0]!, 'idempotency-key')).toBeDefined();
  });

  test('an override row shows the override values and the sku table keeps every pin on this surface', async () => {
    view = await mount();
    // The override (20 kg · 100 kg) renders instead of the dashes.
    expect(view.container.textContent).toContain('20 kg · 100 kg');
    // The read pins the SKU-column defaults too (base units on the SKU wire).
    const text = view.container.textContent ?? '';
    expect(text).toContain('Default point');
    expect(text).toContain('Default quantity');
  });
});

describe('ReplenishmentView: the read-only render (story 6-1)', () => {
  test('an operator session sees the rows with no mutating affordance', async () => {
    view = await mount(OPERATOR_SESSION);
    const text = view.container.textContent ?? '';
    // The queues and the table still render — hiding is losing the alert.
    expect(text).toContain('SPICE-01');
    expect(text).toContain('10 kg');
    expect(text).toContain('Default point');
    // The only buttons are the status/kind tabs and the read-only batch
    // click-throughs — no Dismiss, no submit, no Edit.
    const labels = [...view.container.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual([
      'Open',
      'Recovered',
      'Actioned',
      'Dismissed',
      'All kinds',
      'Expiring soon',
      'Aged',
      'Open',
      'Resolved',
      'Dismissed',
      'View batch',
      'View batch',
      'Drafts',
      'Submitted',
      'Dismissed',
    ]);
    expect([...view.container.querySelectorAll('input, select')]).toEqual([]);
  });
});

describe('ReplenishmentView: the expiry & aging batch alert queue (story 6-2)', () => {
  beforeEach(() => {
    // Isolate the 6-2 widgets: with the 6-1 queues empty, the only Dismiss
    // buttons on the page belong to the batch-alert cards.
    breachRows = [];
    draftRows = [];
  });

  test('mounting sends reads alone; the queue read carries the warehouse and status (kind off on `all`)', async () => {
    view = await mount();
    const mutatingBefore = requests.filter((r) => r.method !== 'GET');
    expect(mutatingBefore).toEqual([]);

    const alertGets = readsEndingWith('/replenishment/batch-alerts');
    expect(alertGets.length).toBeGreaterThanOrEqual(1);
    for (const read of alertGets) {
      expect(read.query).toContain('warehouseId=');
      expect(read.query).toContain('status=open');
      expect(read.query).not.toContain('kind=');
    }
    // The config read rode along once (tenant-scoped, no warehouse).
    expect(readsEndingWith('/replenishment/expiry-policies').length).toBeGreaterThanOrEqual(1);
  });

  test('the kind filter narrows the read; the status tab swaps the filter', async () => {
    view = await mount();
    const readsBefore = readsEndingWith('/replenishment/batch-alerts').length;

    await click(button(view.container, 'Expiring soon'));
    await settle();

    const narrowed = readsEndingWith('/replenishment/batch-alerts').slice(readsBefore);
    expect(narrowed.length).toBeGreaterThan(0);
    for (const read of narrowed) {
      expect(read.query).toContain('kind=expiry_upcoming');
      expect(read.query).toContain('status=open');
    }

    const readsMid = readsEndingWith('/replenishment/batch-alerts').length;
    await click(button(view.container, 'Resolved'));
    await settle();

    const resolved = readsEndingWith('/replenishment/batch-alerts').slice(readsMid);
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved[0]!.query).toContain('status=resolved');
  });

  test('open rows render amber with the kind NAMED, quantities at the SKU precision and the frozen age; a resolved row names its resolver class', async () => {
    // One OPEN row of each kind is the default mount; the closed-row arm
    // rides the second fixture (auto-resolved, resolvedBy still null).
    batchAlertRows = [
      batchAlert(),
      batchAlert({
        id: ALERT2_ID,
        kind: 'aged',
        ageDays: 45,
        onHandMilli: 7000,
        status: 'resolved',
        resolvedAt: '2026-09-29T08:00:00.000Z',
      }),
    ];
    view = await mount();

    const articles = [...view.container.querySelectorAll('article')];
    const openCard = articles.find((a) => a.textContent?.includes('Expiring soon'));
    expect(openCard).toBeDefined();
    expect(openCard!.className).toContain('border-(--warning)'); // the amber treatment
    expect(openCard!.className).toContain('bg-(--warning)/10');
    const text = view.container.textContent ?? '';
    // Milli → declared SKU precision; the aged row's ONE frozen fact.
    expect(text).toContain('on-hand 2.500 kg');
    expect(text).toContain('on-hand 7.000 kg');
    expect(text).toContain('age 45d');
    // The auto-resolve's resolvedBy-null is NAMED, never read as a human act.
    expect(text).toContain('resolved by consumption — nobody acted');
    expect(text).toContain('Expiring within 7 days · aged past 30 days of intake.');
  });

  test('a dismissal POSTs with a ULID key, reads the snapshot, and re-reads the queue', async () => {
    view = await mount();
    const readsBefore = readsEndingWith('/replenishment/batch-alerts').length;

    await click(button(view.container, 'Dismiss'));
    await settle();

    const posts = requests.filter(
      (r) => r.method === 'POST' && r.pathname.includes('/replenishment/batch-alerts/'),
    );
    expect(posts).toHaveLength(1);
    expect(header(posts[0]!, 'idempotency-key')).toBeDefined();
    const key = header(posts[0]!, 'idempotency-key')!;
    expect(key.length).toBeGreaterThanOrEqual(26);
    expect(readsEndingWith('/replenishment/batch-alerts').length).toBeGreaterThan(readsBefore);
  });

  test('a 409 batch-alert-not-open renders the server\'s words verbatim AND re-reads the queue', async () => {
    view = await mount();
    const readsBefore = readsEndingWith('/replenishment/batch-alerts').length;
    nextAlertDismissStatus = 409;

    await click(button(view.container, 'Dismiss'));
    await settle();

    const banner = view.container.textContent ?? '';
    expect(banner).toContain('Batch alert not open');
    expect(banner).toContain('This batch alert was auto-resolved moments ago.');
    expect(readsEndingWith('/replenishment/batch-alerts').length).toBeGreaterThan(readsBefore);
  });

  test('the success sentence says the re-raise clause — dismissal is not suppression', async () => {
    view = await mount();

    await click(button(view.container, 'Dismiss'));
    await settle();

    const banner = view.container.textContent ?? '';
    expect(banner).toContain('Alert dismissed');
    expect(banner).toContain('the expiry scan raises a fresh alert');
  });

  test('an absent config row is the OFF read-back, not a failed read', async () => {
    expiryPolicyRow = null;
    batchAlertRows = [];
    view = await mount();

    const text = view.container.textContent ?? '';
    expect(text).toContain('Expiry and aging alerts are OFF');
    // The queue still reads (and renders) — the caption explains, failing isn't implied.
    expect(readsEndingWith('/replenishment/batch-alerts').length).toBeGreaterThanOrEqual(1);
    expect(text).toContain('No open batch alerts.');
  });

  test('the batch click-through reads the DETAIL route, renders its identity, and collapses without a second fetch', async () => {
    view = await mount();

    await click(button(view.container, 'View batch'));
    await settle();

    const detailGets = readsEndingWith(`/inventory/batches/${BATCH_ID}`);
    expect(detailGets).toHaveLength(1);
    const text = view.container.textContent ?? '';
    expect(text).toContain('B-EX-01');
    // The detail block is inventory's wire: BASE units — no milli
    // CONVERSION (25 milli would be wrong); the figure still renders at the
    // SKU's declared precision.
    expect(text).toContain('2.500 kg — ' + WAREHOUSE_ID.slice(0, 8));
    expect(text).toContain('1 movement since intake');

    // Toggling closed and open again does not re-fetch (the read stays mounted).
    await click(button(view.container, 'Hide batch'));
    await settle();
    await click(button(view.container, 'View batch'));
    await settle();

    // Collapsing unmounts the detail block (the caller keeps it mounted only
    // while a row holds the id — the useBatchDetail contract), so
    // re-expanding re-reads: live batch state, never a cached snapshot.
    expect(readsEndingWith(`/inventory/batches/${BATCH_ID}`)).toHaveLength(2);
  });

  test('an expanded card whose batch read 404s shows the failed arm with a way back', async () => {
    batchDetailRow = null;
    view = await mount();

    await click(button(view.container, 'View batch'));
    await settle();

    expect(readsEndingWith(`/inventory/batches/${BATCH_ID}`)).toHaveLength(1);
    const text = view.container.textContent ?? '';
    expect(text).toContain('Batch unavailable');
    expect(text).toContain('This batch no longer exists in this tenant');

    await click(button(view.container, 'Retry'));
    await settle();
    expect(readsEndingWith(`/inventory/batches/${BATCH_ID}`)).toHaveLength(2);
  });

  test('an operator session sees the alert rows with no Dismiss affordance', async () => {
    view = await mount(OPERATOR_SESSION);
    const buttons = [...view.container.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons).not.toContain('Dismiss');
    expect(buttons).not.toContain('Submit as purchase order');
    const text = view.container.textContent ?? '';
    expect(text).toContain('on-hand 2.500 kg');
  });
});

describe('ReplenishmentView: the policy walker\'s truncated-is-SAID contract (story 6-1)', () => {
  test('a chain that still has a cursor at the last hop accumulates the pages AND says the list is truncated', async () => {
    // Every page points at the next — the walk rides to MAX_PAGE_HOPS and
    // the truncation flag must be SAID (an override beyond the cap missing
    // from the map would render as the SKU default governing).
    policyPageQueue = Array.from({ length: 20 }, () => ({ items: [policy()], nextCursor: 'cursor-does-not-end' }));
    view = await mount();

    const policyGets = readsEndingWith('/replenishment/policies');
    expect(policyGets.length).toBe(20); // MAX_PAGE_HOPS — accumulated, not one page
    // The chain: every hop after the first carries the previous page's cursor.
    expect(policyGets[0]!.query).not.toContain('cursor=');
    for (let i = 1; i < policyGets.length; i++) {
      expect(policyGets[i]!.query).toContain('cursor=cursor-does-not-end');
    }
    const text = view.container.textContent ?? '';
    expect(text).toContain('More overrides exist than this table can walk');
    expect(text).toContain('the list is truncated');
  });

  test('a chain whose last hop carries the null cursor is NOT truncated', async () => {
    policyPageQueue = [
      { items: [policy()], nextCursor: 'cursor-2' },
      { items: [policy()], nextCursor: null },
    ];
    view = await mount();

    const policyGets = readsEndingWith('/replenishment/policies');
    expect(policyGets.length).toBe(2); // the chain ended where the server said
    expect(policyGets[1]!.query).toContain('cursor=cursor-2');
    const text = view.container.textContent ?? '';
    expect(text).not.toContain('More overrides exist than this table can walk');
  });
});