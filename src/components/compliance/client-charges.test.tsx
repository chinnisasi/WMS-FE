import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { NO_CHARGE_FILTERS } from '../../lib/client-charges';
import type { UserRole } from '../../lib/users';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { ClientCharges } from './client-charges';
import { LineRecordsPanel } from './line-records';

/**
 * Story 5-5a — the Ad-hoc charges tab, the claims a `src/lib` test cannot make:
 *   1. the list renders each charge with its status word and billing cell, and
 *      the URL filters reach the list read;
 *   2. an accountant approves ANOTHER member's pending charge (a fresh key),
 *      and sees Approve disabled — with the reason — on their own;
 *   3. an ops manager records (the body, the key, the 201 warnings shown) but
 *      is offered no approve, and reads the self-approval limit read-only;
 *   4. the minimum adjustment line offers no records toggle.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const ME = 'u-me';
const CLIENT_ID = '0198f7a2-0000-7000-8000-00000000c001';
const WAREHOUSE_ID = '0198f7a2-0000-7000-8000-00000000a001';

function session(role: UserRole): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Three PL Co', gstin: '29AAACT1234A1Z5' },
    user: { id: ME, email: 'me@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  };
}

const NO_TAX = { legalName: null, gstin: null, billingLine1: null, billingLine2: null, billingCity: null, billingStateCode: null, billingPincode: null };
const SELF = { id: 'c-self', tenantId: TENANT_ID, code: 'self', name: 'Three PL Co', status: 'active', systemOwned: true, createdAt: '2026-03-10T00:00:00.000Z', updatedAt: '2026-03-10T00:00:00.000Z', taxDetails: NO_TAX };
const ACME = { ...SELF, id: CLIENT_ID, code: 'ACME', name: 'Acme Foods', systemOwned: false };

function charge(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    clientId: CLIENT_ID,
    warehouseId: WAREHOUSE_ID,
    supplierGstin: '29AAACT1234A1Z5',
    chargeDate: '2026-10-05',
    billMonth: '2026-10-01',
    category: 'extra_labour',
    description: 'Unloading a floor-loaded container',
    sacCode: '996719',
    unit: 'hour',
    quantity: '2.5',
    unitRatePaise: 35_000,
    amountPaise: 87_500,
    reference: null,
    clientAuthorizationRef: null,
    evidenceNote: null,
    status: 'pending',
    recordedBy: 'u-other',
    recordedAt: '2026-10-05T05:00:00.000Z',
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    cancelledBy: null,
    cancelledAt: null,
    cancelNote: null,
    createdAt: '2026-10-05T05:00:00.000Z',
    billing: null,
    ...over,
  };
}

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly body: unknown;
  readonly key: string | null;
  readonly search: URLSearchParams;
}
let requests: Recorded[] = [];
let charges: Record<string, unknown>[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
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
    requests.push({ method, pathname, body, key: request.headers.get('Idempotency-Key'), search: url.searchParams });
    if (method === 'GET' && pathname.endsWith('/clients')) return json(200, { items: [SELF, ACME] });
    if (method === 'GET' && pathname.endsWith('/warehouses')) {
      return json(200, { items: [{ id: WAREHOUSE_ID, code: 'BLR1', name: 'Bengaluru', origin: {}, gstin: '29AAACT1234A1Z5', createdAt: '2026-09-01T00:00:00.000Z' }], nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith('/users')) {
      return json(200, { items: [{ id: 'u-other', email: 'ops@example.com', role: 'ops_manager', status: 'active', clientId: null }], nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith('/client-charge-policy')) return json(200, { selfApproveLimitPaise: 1_000_000, isDefault: true });
    if (method === 'GET' && pathname.endsWith('/client-charges')) return json(200, { items: charges, nextCursor: null });
    if (method === 'POST' && pathname.endsWith('/client-charges')) {
      const recorded = charge('ch-new', { recordedBy: ME });
      charges = [recorded, ...charges];
      return json(201, { charge: recorded, warnings: [{ code: 'charge-may-bring-minimum', detail: 'ACME’s rate card carries a minimum monthly charge.' }] });
    }
    const approve = /\/client-charges\/([^/]+)\/approve$/.exec(pathname);
    if (method === 'POST' && approve !== null) {
      const id = approve[1];
      charges = charges.map((entry) => (entry.id === id ? { ...entry, status: 'approved', decidedBy: ME } : entry));
      return json(200, { charge: charges.find((entry) => entry.id === id) });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  charges = [];
  stubRouter();
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
  restoreGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function button(container: HTMLElement, label: string | RegExp): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((b) => (typeof label === 'string' ? b.textContent === label : label.test(b.textContent ?? '')));
}

async function press(target: HTMLButtonElement | undefined): Promise<void> {
  expect(target).toBeDefined();
  await act(async () => {
    target!.click();
  });
  await settle();
}

function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

describe('the Ad-hoc charges tab', () => {
  test('the list, its words, and the URL filters on the read', async () => {
    writeSession(session('accountant'));
    charges = [charge('ch-1'), charge('ch-2', { status: 'approved', billing: { invoiceId: 'i-1', invoiceNo: '29/S2627/000004', status: 'issued' } })];
    view = render(<ClientCharges initial={{ ...NO_CHARGE_FILTERS, clientId: CLIENT_ID, status: 'pending', month: '2026-10' }} />);
    await settle();
    const text = view.container.textContent ?? '';
    expect(text).toContain('Awaiting approval');
    expect(text).toContain('29/S2627/000004 · issued');
    expect(text).toContain('2.5 hours');
    expect(text).toContain('₹875.00');
    const read = requests.find((r) => r.method === 'GET' && r.pathname.endsWith('/client-charges'))!;
    expect(read.search.get('clientId')).toBe(CLIENT_ID);
    expect(read.search.get('status')).toBe('pending');
    expect(read.search.get('month')).toBe('2026-10');
  });

  test('an accountant approves another member’s pending charge with a fresh key; their own is disabled and says why', async () => {
    writeSession(session('accountant'));
    charges = [charge('ch-1'), charge('ch-own', { recordedBy: ME, description: 'My own' })];
    view = render(<ClientCharges initial={NO_CHARGE_FILTERS} />);
    await settle();
    await press(button(view.container, 'Review'));
    await press(button(view.container, 'Approve ₹875.00'));
    const approve = requests.find((r) => r.method === 'POST' && r.pathname.endsWith('/client-charges/ch-1/approve'))!;
    expect(approve.key).not.toBeNull();
    expect(view.container.textContent).toContain('Charge approved');

    await press(button(view.container, 'Open'));
    const own = button(view.container, 'Approve ₹875.00')!;
    expect(own.disabled).toBe(true);
    expect(view.container.textContent).toContain('You recorded this charge — another member with billing rights must approve it.');
  });

  test('an ops manager records a charge (body + key, the 201 warnings shown), approves nothing, reads the limit read-only', async () => {
    writeSession(session('ops_manager'));
    charges = [charge('ch-1')];
    view = render(<ClientCharges initial={NO_CHARGE_FILTERS} />);
    await settle();
    expect(view.container.textContent).toContain('Only an owner or an accountant can change it.');
    expect(button(view.container, 'Change limit')).toBeUndefined();
    await press(button(view.container, 'Open'));
    expect(button(view.container, /^Approve/)).toBeUndefined();
    expect(view.container.textContent).toContain('Awaiting approval by an owner or an accountant.');

    await press(button(view.container, 'Record a charge'));
    const form = view.container.querySelector('form[aria-label="Record an ad-hoc charge"]')!;
    setValue(form.querySelector('#charge-date') as HTMLInputElement, '2026-10-05');
    setValue(form.querySelector('#charge-category') as HTMLSelectElement, 'extra_labour');
    setValue(form.querySelector('#charge-description') as HTMLInputElement, 'Unloading');
    setValue(form.querySelector('#charge-unit') as HTMLSelectElement, 'hour');
    setValue(form.querySelector('#charge-quantity') as HTMLInputElement, '2.5');
    setValue(form.querySelector('#charge-rate') as HTMLInputElement, '350');
    await settle();
    expect(form.querySelector('[data-amount-preview]')?.textContent).toBe('₹875.00');
    // Other has no fixed SAC: the SAC select appears only for it.
    expect(form.querySelector('#charge-sac')).toBeNull();
    await press(button(view.container, 'Record charge'));
    const record = requests.find((r) => r.method === 'POST' && r.pathname.endsWith('/client-charges'))!;
    expect(record.key).not.toBeNull();
    expect(record.body).toEqual({
      clientId: CLIENT_ID,
      warehouseId: WAREHOUSE_ID,
      chargeDate: '2026-10-05',
      category: 'extra_labour',
      description: 'Unloading',
      unit: 'hour',
      quantity: '2.5',
      unitRatePaise: 35_000,
    });
    const text = view.container.textContent ?? '';
    expect(text).toContain('Charge recorded — awaiting approval');
    expect(text).toContain('May bring the minimum');
  });
});

describe('the minimum adjustment in the line records', () => {
  test('no records toggle; its description instead', async () => {
    writeSession(session('accountant'));
    const line = (id: string, over: Record<string, unknown>) => ({
      id,
      rateCardId: null,
      segmentFrom: '2026-10-01',
      segmentTo: '2026-10-31',
      uom: null,
      quantity: '1',
      unitAmountPaise: 1_874_960,
      amountPaise: 1_874_960,
      sac: '996729',
      gstBps: 1800,
      placeOfSupply: '29',
      supplyType: 'intra',
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      ...over,
    });
    const invoice = {
      id: 'i-1',
      status: 'draft',
      lines: [
        line('l-adhoc', { chargeCode: 'adhoc', basis: 'per_unit', uom: 'hour', quantity: '2.500', unitAmountPaise: 35_000, amountPaise: 87_500, segmentFrom: '2026-10-05', segmentTo: '2026-10-05', description: 'Extra labour — Unloading', adhocChargeId: 'ch-1' }),
        line('l-min', { chargeCode: 'minimum_adjustment', basis: 'per_invoice', description: 'Minimum monthly charge ₹50,000.00 less all charges ₹31,250.40' }),
      ],
    };
    view = render(<LineRecordsPanel invoice={invoice as never} />);
    await settle();
    const toggles = [...view.container.querySelectorAll('button[aria-expanded]')].map((b) => b.textContent ?? '');
    expect(toggles).toEqual(['Show records — Extra labour — Unloading · 5 Oct 2026 · 2.500 hours']);
    expect(view.container.querySelector('[data-not-drillable]')?.textContent).toContain('Minimum monthly charge ₹50,000.00 less all charges ₹31,250.40');
  });
});
