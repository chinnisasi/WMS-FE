import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import type { UserRole } from '../../lib/users';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { RateCardsCard } from './rate-cards-card';

/**
 * Story 21-3 — the claims a `src/lib` test cannot make:
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
const ACME = { ...SELF, id: 'c-acme', code: 'ACME', name: 'Acme Foods', systemOwned: false };

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
}
let requests: Recorded[] = [];
let cardRows: unknown[] = [];
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
    requests.push({ method, pathname, body, key: request.headers.get('Idempotency-Key') });
    if (method === 'GET' && pathname.endsWith('/clients')) return json(200, { items: [SELF, ACME] });
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
    const options = [...view.container.querySelectorAll('option')].map((option) => option.textContent);
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
});
