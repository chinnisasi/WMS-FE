import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import type { UserRole } from '../../lib/users';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { RateCardsCard } from './rate-cards-card';

/**
 * Story 21-3 — the claims a `src/lib` test cannot make (story 21-4 adds the
 * Usage section's: the default period, the notices, the priced / Not billed
 * lines, the custom range refused before it is sent, the refetch on a card
 * change):
 *   1. every role READS a client's cards (states, "Not billed" cells, the
 *      next change), and the tenant's own client is never offered;
 *   2. the "In force" highlight follows the in-force ENDPOINT's answer, not
 *      the browser clock; the not-billed banner shows exactly when nothing
 *      is in force for an active client;
 *   3. only `rates.manage` (owner, accountant) is offered New draft, the
 *      draft row actions and Cancel — absent, not disabled, for an Ops
 *      Manager — and Cancel only on a scheduled card;
 *   4. pressing a button sends the verb it says (create with the parsed
 *      lines, activate with the date, cancel), each with an Idempotency-Key.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';

function session(role: UserRole): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Priya Logistics', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  };
}

const SELF = {
  id: 'c-self',
  tenantId: TENANT_ID,
  code: 'self',
  name: 'Priya Logistics',
  status: 'active',
  systemOwned: true,
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
};
// Created mid-August (IST), so the usage picker offers Oct (in progress), Sep, Aug.
const ACME = { ...SELF, id: 'c-acme', code: 'ACME', name: 'Acme Foods', systemOwned: false, createdAt: '2026-08-15T00:00:00.000Z' };

function card(id: string, overrides: Record<string, unknown>) {
  return {
    id,
    tenantId: TENANT_ID,
    clientId: ACME.id,
    status: 'active',
    effectiveFrom: '2026-10-10',
    effectiveTo: null,
    lines: [],
    createdBy: 'u-1',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    activatedBy: 'u-1',
    activatedAt: '2026-10-01T00:00:00.000Z',
    cancelledBy: null,
    cancelledAt: null,
    ...overrides,
  };
}

const IN_FORCE = card('card-a', {
  status: 'superseded',
  effectiveTo: '2026-11-01',
  lines: [
    { chargeCode: 'storage', basis: 'per_thousand_units_per_day', amountPaise: 330 },
    { chargeCode: 'pick', basis: 'per_pick', amountPaise: 300 },
  ],
});
const SCHEDULED = card('card-b', {
  effectiveFrom: '2026-11-01',
  lines: [
    { chargeCode: 'storage', basis: 'per_thousand_units_per_day', amountPaise: 400 },
    { chargeCode: 'pick', basis: 'per_pick', amountPaise: 300 },
  ],
});
const DRAFT = card('card-d', { status: 'draft', effectiveFrom: null, activatedBy: null, activatedAt: null, lines: [] });

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly body: unknown;
  readonly key: string | null;
  /** The query string (21-5 — the invoices read's filters). */
  readonly search: URLSearchParams;
}
let requests: Recorded[] = [];
/** Story 21-4 — the usage read's storage watermark (null = not measured); the answer echoes the period asked. */
let usageThrough: string | null = '2026-09-30';

function usageFixture(from: string, to: string, storageCompleteThrough: string | null): Record<string, unknown> {
  return {
    clientId: 'c-acme',
    from,
    to,
    asOf: AS_OF_USAGE,
    storageCompleteThrough,
    segments: [
      {
        rateCardId: 'card-a',
        fromDate: from,
        toDate: to,
        storageMeasuredThrough: storageCompleteThrough === null ? null : storageCompleteThrough < to ? storageCompleteThrough : to,
        lines: [
          { chargeCode: 'storage', basis: 'per_thousand_units_per_day', uom: 'kg', quantity: '1234.567', ratePaise: 330, amountPaise: 407 },
          { chargeCode: 'inbound_handling', basis: 'per_receipt_line', uom: null, quantity: '3', ratePaise: null, amountPaise: null },
          { chargeCode: 'pick', basis: 'per_pick', uom: null, quantity: '2', ratePaise: 300, amountPaise: 600 },
          { chargeCode: 'outbound_handling', basis: 'per_order', uom: null, quantity: '1', ratePaise: null, amountPaise: null },
        ],
      },
    ],
    totals: { billedPaise: 1007, unbilledLines: 2 },
  };
}
const AS_OF_USAGE = '2026-10-20T04:30:00.000Z';
let cardRows: unknown[] = [];
/** Story 21-5 — the client's invoices the usage preview reads (null = the read fails). */
let clientInvoiceRows: unknown[] | null = [];
let inForce: unknown = null;
/** The SERVER's asOf: 10:00 IST on 20 Oct 2026 — independent of the test's own clock. */
const AS_OF = '2026-10-20T04:30:00.000Z';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname } = new URL(request.url);
    const method = request.method.toUpperCase();
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    requests.push({ method, pathname, body, key: request.headers.get('Idempotency-Key'), search: new URL(request.url).searchParams });
    if (method === 'GET' && pathname.endsWith('/clients')) return json(200, { items: [SELF, ACME] });
    if (method === 'GET' && pathname.endsWith('/usage')) {
      const query = new URL(request.url).searchParams;
      return json(200, usageFixture(query.get('from')!, query.get('to')!, usageThrough));
    }
    if (method === 'GET' && pathname.endsWith('/client-invoices')) {
      return clientInvoiceRows === null
        ? json(503, { code: 'unavailable', title: 'Down', status: 503 })
        : json(200, { items: clientInvoiceRows, nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith('/rate-cards/in-force')) return json(200, { rateCard: inForce, asOf: AS_OF });
    if (method === 'GET' && pathname.endsWith('/rate-cards')) return json(200, { items: cardRows });
    if (method === 'POST' && pathname.endsWith('/rate-cards')) {
      return json(201, { rateCard: { ...DRAFT, id: 'card-new', lines: (body as { lines: unknown[] }).lines } });
    }
    if (method === 'POST' && pathname.endsWith('/activate')) {
      return json(200, { rateCard: { ...DRAFT, status: 'active', effectiveFrom: (body as { effectiveFrom: string }).effectiveFrom } });
    }
    if (method === 'POST' && pathname.endsWith('/cancel')) return json(200, { rateCard: { ...SCHEDULED, status: 'cancelled' } });
    if (method === 'PUT' && pathname.endsWith('/lines')) {
      return json(200, { rateCard: { ...DRAFT, lines: (body as { lines: unknown[] }).lines } });
    }
    if (method === 'DELETE' && pathname.includes('/rate-cards/')) return new Response(null, { status: 204 });
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  cardRows = [DRAFT, SCHEDULED, IN_FORCE];
  inForce = IN_FORCE;
  usageThrough = '2026-09-30';
  clientInvoiceRows = [];
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

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function buttons(container: HTMLElement, label: string): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter((b) => b.textContent === label);
}

function rowText(container: HTMLElement): string[] {
  return [...container.querySelectorAll('tbody tr')].map((row) => row.textContent ?? '');
}

async function press(button: HTMLButtonElement | undefined): Promise<void> {
  expect(button).toBeDefined();
  await act(async () => {
    button!.click();
  });
  await settle();
}

describe('RateCardsCard', () => {
  test('an ops manager reads every card — states from the server, Not billed cells, the next change — and is offered nothing', async () => {
    writeSession(session('ops_manager'));
    view = render(<RateCardsCard />);
    await settle();
    // The tenant's own client is never offered.
    // (The CLIENT picker's options — 21-4 added the usage period picker beside it.)
    const options = [...view.container.querySelectorAll('select[aria-label="Client"] option')].map((option) => option.textContent);
    expect(options).toEqual(['ACME — Acme Foods']);
    const rows = rowText(view.container);
    expect(rows[0]).toContain('Draft');
    expect(rows[1]).toContain('Scheduled');
    expect(rows[1]).toContain('1 Nov 2026');
    expect(rows[2]).toContain('In force');
    expect(rows[2]).toContain('₹3.30');
    expect(rows[2]).toContain('Not billed');
    const text = view.container.textContent ?? '';
    expect(text).toContain('Storage ₹3.30 → ₹4.00 from 1 Nov 2026');
    expect(text).not.toContain('This client will not be billed');
    // No mutating affordance at all — absent, not disabled.
    for (const label of ['New draft', 'Edit', 'Activate', 'Discard', 'Cancel']) {
      expect(buttons(view.container, label)).toHaveLength(0);
    }
    // Both reads went out: the list and the in-force answer.
    expect(requests.some((r) => r.pathname.endsWith(`/clients/${ACME.id}/rate-cards`))).toBe(true);
    expect(requests.some((r) => r.pathname.endsWith(`/clients/${ACME.id}/rate-cards/in-force`))).toBe(true);
  });

  test('the "In force" highlight follows the endpoint, and the banner shows when nothing is in force', async () => {
    // The server says nothing is in force (e.g. asOf before A began).
    inForce = null;
    writeSession(session('ops_manager'));
    view = render(<RateCardsCard />);
    await settle();
    expect(rowText(view.container).some((row) => row.includes('In force'))).toBe(false);
    expect(view.container.textContent).toContain('This client will not be billed — no rate card is in force.');
  });

  test('an accountant is offered New draft, the draft actions, and Cancel on the scheduled card only', async () => {
    writeSession(session('accountant'));
    view = render(<RateCardsCard />);
    await settle();
    expect(buttons(view.container, 'New draft')).toHaveLength(1);
    expect(buttons(view.container, 'Edit')).toHaveLength(1);
    expect(buttons(view.container, 'Activate')).toHaveLength(1);
    expect(buttons(view.container, 'Discard')).toHaveLength(1);
    // Cancel on the scheduled card B, never on the card in force.
    expect(buttons(view.container, 'Cancel')).toHaveLength(1);
    const rows = [...view.container.querySelectorAll('tbody tr')];
    expect(rows[1]!.textContent).toContain('Cancel');
    expect(rows[2]!.textContent).not.toContain('Cancel');
  });

  test('New draft → Create draft POSTs the parsed lines (blank = not billed) with a key', async () => {
    writeSession(session('owner'));
    view = render(<RateCardsCard />);
    await settle();
    await press(buttons(view.container, 'New draft')[0]);
    const form = view.container.querySelector('form[aria-label="New rate card"]')!;
    expect(form.textContent).toContain('per 1,000 units per day');
    setInput(form.querySelector('input[aria-label="Storage ₹ per 1,000 units per day"]') as HTMLInputElement, '3.30');
    setInput(form.querySelector('input[aria-label="Pick ₹ per pick"]') as HTMLInputElement, '0');
    await act(async () => {
      (form as HTMLFormElement).requestSubmit();
    });
    await settle();
    const create = requests.find((r) => r.method === 'POST' && r.pathname.endsWith(`/clients/${ACME.id}/rate-cards`));
    expect(create?.body).toEqual({
      lines: [
        { chargeCode: 'storage', basis: 'per_thousand_units_per_day', amountPaise: 330 },
        { chargeCode: 'pick', basis: 'per_pick', amountPaise: 0 },
      ],
    });
    expect(create?.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(view.container.textContent).toContain('Draft created');
  });

  test('an amount over the cap is refused in the form and sends nothing', async () => {
    writeSession(session('owner'));
    view = render(<RateCardsCard />);
    await settle();
    await press(buttons(view.container, 'New draft')[0]);
    const form = view.container.querySelector('form[aria-label="New rate card"]')!;
    setInput(form.querySelector('input[aria-label="Storage ₹ per 1,000 units per day"]') as HTMLInputElement, '100000.01');
    await act(async () => {
      (form as HTMLFormElement).requestSubmit();
    });
    await settle();
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain('at most ₹1,00,000.00');
    expect(requests.some((r) => r.method === 'POST')).toBe(false);
  });

  test('Activate sends ACTIVATE with the chosen date; Cancel card sends CANCEL — each with a key', async () => {
    writeSession(session('accountant'));
    view = render(<RateCardsCard />);
    await settle();
    await press(buttons(view.container, 'Activate')[0]);
    const form = view.container.querySelector('form[aria-label="Activate rate card"]')!;
    const date = form.querySelector('input[type="date"]') as HTMLInputElement;
    // A dated card exists, so the minimum is tomorrow (IST) of the SERVER's
    // asOf (20 Oct) — never the browser clock.
    expect(date.min).toBe('2026-10-21');
    setInput(date, '2026-12-01');
    await act(async () => {
      (form as HTMLFormElement).requestSubmit();
    });
    await settle();
    const activate = requests.find((r) => r.method === 'POST' && r.pathname.endsWith(`/rate-cards/${DRAFT.id}/activate`));
    expect(activate?.body).toEqual({ effectiveFrom: '2026-12-01' });
    expect(activate?.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(view.container.textContent).toContain('Card activated');

    await press(buttons(view.container, 'Cancel')[0]);
    expect(view.container.textContent).toContain('Cancel the card from 1 Nov 2026? The card it replaces stays in force.');
    await press(buttons(view.container, 'Cancel card')[0]);
    const cancel = requests.find((r) => r.method === 'POST' && r.pathname.endsWith(`/rate-cards/${SCHEDULED.id}/cancel`));
    expect(cancel).toBeDefined();
    expect(cancel?.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(requests.some((r) => r.pathname.endsWith('/activate') && r.pathname.includes(SCHEDULED.id))).toBe(false);
    expect(view.container.textContent).toContain('Card cancelled');
  });

  test('Edit sends PUT …/lines (no POST); Discard sends DELETE; each mutation re-reads the list and the in-force card', async () => {
    writeSession(session('accountant'));
    view = render(<RateCardsCard />);
    await settle();
    const reads = () =>
      requests.filter((r) => r.method === 'GET' && r.pathname.includes(`/clients/${ACME.id}/rate-cards`)).map((r) => r.pathname);
    const before = reads().length;
    expect(before).toBe(2);

    await press(buttons(view.container, 'Edit')[0]);
    const form = view.container.querySelector('form[aria-label="Edit rate card"]')!;
    setInput(form.querySelector('input[aria-label="Pick ₹ per pick"]') as HTMLInputElement, '2.50');
    await act(async () => {
      (form as HTMLFormElement).requestSubmit();
    });
    await settle();
    const put = requests.find((r) => r.method === 'PUT');
    expect(put?.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/rate-cards/${DRAFT.id}/lines`);
    expect(put?.body).toEqual({ lines: [{ chargeCode: 'pick', basis: 'per_pick', amountPaise: 250 }] });
    expect(put?.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(requests.some((r) => r.method === 'POST')).toBe(false);
    // The list AND the in-force card were read again.
    const afterEdit = reads().slice(before);
    expect(afterEdit.some((path) => path.endsWith('/rate-cards'))).toBe(true);
    expect(afterEdit.some((path) => path.endsWith('/rate-cards/in-force'))).toBe(true);

    const beforeDiscard = reads().length;
    await press(buttons(view.container, 'Discard')[0]);
    await press(buttons(view.container, 'Discard draft')[0]);
    const del = requests.find((r) => r.method === 'DELETE');
    expect(del?.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/rate-cards/${DRAFT.id}`);
    expect(del?.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(view.container.textContent).toContain('Draft discarded');
    const afterDiscard = reads().slice(beforeDiscard);
    expect(afterDiscard.some((path) => path.endsWith('/rate-cards'))).toBe(true);
    expect(afterDiscard.some((path) => path.endsWith('/rate-cards/in-force'))).toBe(true);
  });

  test('Cancel is offered on a scheduled card already superseded by a later one, and the copy says what stays', async () => {
    const LATER = card('card-c', { effectiveFrom: '2026-12-01', lines: [] });
    cardRows = [LATER, { ...SCHEDULED, status: 'superseded', effectiveTo: '2026-12-01' }, IN_FORCE];
    writeSession(session('owner'));
    view = render(<RateCardsCard />);
    await settle();
    // Both B (superseded, not started) and C are scheduled — both cancellable.
    expect(buttons(view.container, 'Cancel')).toHaveLength(2);
    await press(buttons(view.container, 'Cancel')[0]);
    // C's predecessor B is itself still scheduled.
    expect(view.container.textContent).toContain('Cancel the card from 1 Dec 2026? The previous card applies from its own date.');
  });

  // ── story 21-4 — the Usage section ──────────────────────────────────────
  function usageReads(): string[] {
    return requests
      .filter((r) => r.method === 'GET' && r.pathname.endsWith(`/clients/${ACME.id}/usage`))
      .map((r) => r.pathname);
  }

  function selectValue(select: HTMLSelectElement, value: string): void {
    act(() => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  test('usage: every role reads last month by default — the estimate notice, storage through its date, each line priced or Not billed, the totals', async () => {
    writeSession(session('ops_manager'));
    view = render(<RateCardsCard />);
    await settle();
    expect(usageReads()).toHaveLength(1);
    const region = view.container.querySelector('[aria-label="Usage"]')!;
    expect(region).not.toBeNull();
    // The months run on the SERVER's asOf (20 Oct), from ACME's creation (Aug).
    const periods = [...region.querySelectorAll('select[aria-label="Usage period"] option')].map((option) => option.textContent);
    expect(periods).toEqual(['October 2026 — in progress', 'September 2026', 'August 2026', 'Custom range…']);
    expect((region.querySelector('select[aria-label="Usage period"]') as HTMLSelectElement).value).toBe('2026-09');
    const text = region.textContent ?? '';
    expect(text).toContain('Estimate until invoiced · GST-exclusive');
    expect(text).toContain('Storage through 30 Sep 2026');
    expect(text).toContain('1 Sep 2026 – 30 Sep 2026 · card from 10 Oct 2026');
    const rows = [...region.querySelectorAll('tbody tr')].map((row) => row.textContent ?? '');
    expect(rows[0]).toContain('Storage');
    expect(rows[0]).toContain('kg');
    expect(rows[0]).toContain('1,234.567 kg-days');
    expect(rows[0]).toContain('₹3.30 per 1,000 units per day');
    expect(rows[0]).toContain('₹4.07');
    expect(rows[1]).toContain('3 receipt lines');
    expect(rows[1]).toContain('Not billed');
    expect(text).toContain('Segment total ₹10.07');
    expect(text).toContain('Billed total ₹10.07 · 2 lines not billed');
    // A read, never a mutation.
    expect(requests.some((r) => r.method !== 'GET')).toBe(false);
  });

  test('story 21-5: an invoiced month reads "Invoiced as <no.>" (live figures may differ) — never for a draft or a void, and a failed invoices read leaves the estimate as it was', async () => {
    const entry = (status: string, invoiceNo: string | null, periodStart = '2026-09-01') => ({ id: `i-${status}`, clientId: ACME.id, periodStart, status, invoiceNo });
    clientInvoiceRows = [entry('issued', '29/S2627/000001'), entry('draft', null), entry('void', '29/S2627/000000'), entry('issued', '29/S2627/000007', '2026-08-01')];
    writeSession(session('ops_manager'));
    view = render(<RateCardsCard />);
    await settle();
    const text = view.container.querySelector('[aria-label="Usage notices"]')!.textContent ?? '';
    expect(text).toContain('Invoiced as 29/S2627/000001 — the live figures below may differ from the invoice');
    expect(text).not.toContain('000000');
    expect(text).not.toContain('000007');
    // The read is one client's invoices, a big enough page to cover its months.
    const read = requests.find((r) => r.pathname.endsWith('/client-invoices'))!;
    expect(read.search.get('clientId')).toBe(ACME.id);
    expect(read.search.get('limit')).toBe('100');
    view.unmount();
    clientInvoiceRows = null;
    view = render(<RateCardsCard />);
    await settle();
    const fallback = view.container.querySelector('[aria-label="Usage"]')!.textContent ?? '';
    expect(fallback).toContain('Estimate until invoiced · GST-exclusive');
    expect(fallback).not.toContain('Invoiced as');
  });

  test('usage: the period picker sends the month it names, and the in-progress month is marked', async () => {
    writeSession(session('accountant'));
    view = render(<RateCardsCard />);
    await settle();
    const select = view.container.querySelector('select[aria-label="Usage period"]') as HTMLSelectElement;
    const before = usageReads().length;
    selectValue(select, '2026-10');
    await settle();
    expect(usageReads().length).toBeGreaterThan(before);
    const text = view.container.querySelector('[aria-label="Usage"]')!.textContent ?? '';
    // The answer echoes the requested period: Oct 1–31, past the server's today.
    expect(text).toContain('1 Oct 2026 – 31 Oct 2026');
    expect(text).toContain('In progress — the counts run to now.');
  });

  test('usage: a custom range is checked before anything is sent (from ≤ to, at most 366 days)', async () => {
    writeSession(session('owner'));
    view = render(<RateCardsCard />);
    await settle();
    const select = view.container.querySelector('select[aria-label="Usage period"]') as HTMLSelectElement;
    selectValue(select, 'custom');
    await settle();
    const before = usageReads().length;
    const from = view.container.querySelector('input[aria-label="Usage from"]') as HTMLInputElement;
    const to = view.container.querySelector('input[aria-label="Usage to"]') as HTMLInputElement;
    setInput(from, '2026-09-30');
    setInput(to, '2026-09-01');
    await press(buttons(view.container, 'Show')[0]);
    expect(view.container.textContent).toContain('The start date is after the end date.');
    setInput(from, '2025-01-01');
    setInput(to, '2026-09-01');
    await press(buttons(view.container, 'Show')[0]);
    expect(view.container.textContent).toContain('A period covers at most 366 days.');
    expect(usageReads().length).toBe(before);
    setInput(from, '2026-09-10');
    setInput(to, '2026-09-20');
    await press(buttons(view.container, 'Show')[0]);
    expect(usageReads().length).toBe(before + 1);
    expect(view.container.textContent).toContain('10 Sep 2026 – 20 Sep 2026');
  });

  test('usage: storage not measured yet when the server has no watermark; a card change refetches the usage', async () => {
    usageThrough = null;
    writeSession(session('ops_manager'));
    view = render(<RateCardsCard />);
    await settle();
    expect(view.container.textContent).toContain('Storage not measured yet');
    const before = usageReads().length;
    await act(async () => {
      window.dispatchEvent(new Event('wms-rate-cards-changed'));
    });
    await settle();
    expect(usageReads().length).toBeGreaterThan(before);
  });
});
