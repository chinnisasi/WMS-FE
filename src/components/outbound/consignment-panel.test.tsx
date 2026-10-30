import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { ConsignmentPanel } from './consignment-panel';

/**
 * Story 4-6a (A24, A46) — the Tax documents panel: the gate line and the
 * live version read by every role; Record / Amend for `dispatch.execute`,
 * the exemption and Withdraw only for `orders.manage`; pressing Record sends
 * the record POST with the parsed body under a key; Withdraw sends the
 * withdraw POST with its reason; a 404 (an API without the route) renders
 * nothing.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const ORDER_ID = '0198f7a2-1b3c-7d4e-8f90-aaaaaaaaaaaa';
const CREATED = new Date(Date.now() - 86_400_000).toISOString();

type Role = StoredSession['user']['role'];
const session = (role: Role): StoredSession => ({
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Priya Spices', gstin: null },
  user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
});

const GATE_MISSING = { state: 'missing', blocking: true, requiredBecause: 'policy-b2b', valueFloorPaise: null, nationalThresholdPaise: 5_000_000, expiresToday: false };
const LIVE = {
  id: 'r-1',
  orderId: ORDER_ID,
  seq: 1,
  status: 'live',
  brandDocument: { type: 'invoice', number: 'INV/26-27/0042', date: CREATED.slice(0, 10) },
  consignorGstin: '29ABCDE1234F1Z5',
  consignor: { name: 'Brand A', legalName: 'Brand A Pvt Ltd' },
  declaredValuePaise: 11_800_000,
  destinationStateCode: '27',
  supplyType: 'inter',
  thresholdPaise: 5_000_000,
  thresholdRule: 'national',
  ewayRequired: true,
  eway: { status: 'pending', number: null, date: null, validUntil: null, exemptionReason: null, exemptionNote: null },
  recordedAfterDispatch: false,
  dispatchedAt: null,
  source: 'portal',
  recordedBy: 'u-9',
  recordedAt: CREATED,
  endedAt: null,
  endedBy: null,
  endReason: null,
};

function read(over: Record<string, unknown> = {}): unknown {
  return {
    gate: GATE_MISSING,
    live: null,
    history: [],
    dispatchedRecordId: null,
    duplicates: [],
    consignorStateMismatch: false,
    ewayUsedByOtherClient: null,
    scans: [],
    complianceException: null,
    ...over,
  };
}

let posts: { path: string; key: string | null; body: unknown }[] = [];
let getAnswer: { status: number; body: unknown } = { status: 200, body: read() };
let postAnswer: { status: number; body: unknown } = { status: 201, body: { consignment: { ...LIVE, seq: 1 } } };

function stub(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const path = new URL(request.url).pathname;
    if (request.method.toUpperCase() === 'POST') {
      posts.push({ path, key: request.headers.get('Idempotency-Key'), body: JSON.parse(await request.clone().text()) });
      return new Response(JSON.stringify(postAnswer.body), { status: postAnswer.status, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify(getAnswer.body), { status: getAnswer.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch);
}

let view: Rendered | undefined;
afterEach(() => {
  view?.unmount();
  view = undefined;
  posts = [];
  getAnswer = { status: 200, body: read() };
  postAnswer = { status: 201, body: { consignment: { ...LIVE, seq: 1 } } };
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

function setValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(el: Element | null): Promise<void> {
  expect(el).not.toBeNull();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}

async function submit(form: Element | null): Promise<void> {
  expect(form).not.toBeNull();
  await act(async () => {
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
}

const q = (sel: string) => view!.container.querySelector(sel);
const byTestId = (id: string) => q(`[data-testid="${id}"]`);

async function mount(role: Role, status: 'accepted' | 'ready_to_dispatch' | 'dispatched' = 'ready_to_dispatch'): Promise<void> {
  writeSession(session(role));
  stub();
  view = render(<ConsignmentPanel orderId={ORDER_ID} orderLabel="SO-1" status={status} createdAt={CREATED} clientCode="BRAND-A" />);
  await settle();
}

describe('ConsignmentPanel (story 4-6a)', () => {
  test('missing: the gate line and chip; an operator records — the POST carries the parsed body under a key', async () => {
    await mount('operator');
    expect(byTestId('consignment-gate-line')!.textContent).toBe('Required — B2B order for BRAND-A. Not recorded.');
    expect(byTestId('consignment-gate-chip')!.textContent).toBe('Invoice needed');
    // dispatch.execute records; withdraw is orders.manage (and there is nothing live).
    expect(byTestId('consignment-withdraw')).toBeNull();
    await click(byTestId('consignment-record'));
    // A46 — the operator cannot pick an exemption.
    expect((byTestId('consignment-eway-exempt') as HTMLInputElement).disabled).toBe(true);
    setValue(byTestId('consignment-document-number') as HTMLInputElement, 'INV/26-27/0042');
    setValue(byTestId('consignment-declared-value') as HTMLInputElement, '42000');
    await submit(byTestId('consignment-form'));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe(`/api/v1/tenants/${TENANT_ID}/outbound/orders/${ORDER_ID}/consignment`);
    expect(posts[0]!.key).not.toBeNull();
    expect(posts[0]!.body).toMatchObject({ brandDocument: { type: 'invoice', number: 'INV/26-27/0042' }, declaredValuePaise: 4_200_000 });
    expect(posts[0]!.body).not.toHaveProperty('ewayBill');
    expect(view!.container.textContent).toContain('Recorded — v1');
  });

  test('a client-side problem sends nothing and marks the field', async () => {
    await mount('operator');
    await click(byTestId('consignment-record'));
    setValue(byTestId('consignment-document-number') as HTMLInputElement, 'INV-1');
    await submit(byTestId('consignment-form'));
    expect(posts).toHaveLength(0);
    expect(byTestId('consignment-declared-value')!.getAttribute('aria-invalid')).toBe('true');
  });

  test('a refusal keeps the form and its key: the retry of the same body replays the same key', async () => {
    await mount('ops_manager');
    postAnswer = { status: 409, body: { code: 'eway-bill-in-use', status: 409, title: 'In use', orderId: 'o-9', orderLabel: 'SO-9' } };
    await click(byTestId('consignment-record'));
    setValue(byTestId('consignment-document-number') as HTMLInputElement, 'INV-1');
    setValue(byTestId('consignment-declared-value') as HTMLInputElement, '118000');
    setValue(byTestId('consignment-eway-number') as HTMLInputElement, '123456789012');
    setValue(byTestId('consignment-eway-date') as HTMLInputElement, new Date(Date.now() + 19_800_000).toISOString().slice(0, 10));
    setValue(byTestId('consignment-eway-until') as HTMLInputElement, '2099-01-01');
    await submit(byTestId('consignment-form'));
    expect(view!.container.textContent).toContain('already recorded on order SO-9');
    await submit(byTestId('consignment-form'));
    expect(posts).toHaveLength(2);
    expect(posts[1]!.key).toBe(posts[0]!.key);
    setValue(byTestId('consignment-eway-number') as HTMLInputElement, '123456789013');
    await submit(byTestId('consignment-form'));
    expect(posts[2]!.key).not.toBe(posts[0]!.key);
  });

  test('a live record: its facts, Amend and Withdraw for an office role; Withdraw posts its reason', async () => {
    getAnswer = { status: 200, body: read({ gate: { ...GATE_MISSING, state: 'eway-required', requiredBecause: null }, live: LIVE, duplicates: [{ orderId: 'o-2', orderLabel: 'SO-2' }] }) };
    await mount('ops_manager');
    expect(byTestId('consignment-live-verdict')!.textContent).toBe('Required — ₹1,18,000 is above ₹50,000 (national, inter-state).');
    expect(view!.container.textContent).toContain('recorded on SO-2');
    expect(byTestId('consignment-record')!.textContent).toBe('Amend');
    postAnswer = { status: 200, body: { consignment: null, history: [] } };
    await click(byTestId('consignment-withdraw'));
    setValue(byTestId('consignment-withdraw-reason') as HTMLInputElement, 'Wrong order');
    await submit(byTestId('consignment-withdraw-confirm'));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe(`/api/v1/tenants/${TENANT_ID}/outbound/orders/${ORDER_ID}/consignment/withdraw`);
    expect(posts[0]!.body).toEqual({ reason: 'Wrong order' });
  });

  test('a role without dispatch.execute reads everything and is offered nothing', async () => {
    getAnswer = { status: 200, body: read({ live: LIVE }) };
    await mount('accountant');
    expect(byTestId('consignment-live')).not.toBeNull();
    expect(byTestId('consignment-record')).toBeNull();
    expect(byTestId('consignment-withdraw')).toBeNull();
  });

  test('after dispatch an operator may not amend (A46); an office role amends with a required reason; no Withdraw', async () => {
    getAnswer = { status: 200, body: read({ gate: { ...GATE_MISSING, state: 'dispatched', blocking: false, requiredBecause: null }, live: { ...LIVE, eway: { ...LIVE.eway, status: 'recorded', number: '123456789012', date: CREATED.slice(0, 10), validUntil: '2099-01-01' } } }) };
    await mount('operator', 'dispatched');
    expect(byTestId('consignment-record')).toBeNull();
    view!.unmount();
    await mount('ops_manager', 'dispatched');
    expect(byTestId('consignment-withdraw')).toBeNull();
    await click(byTestId('consignment-record'));
    await submit(byTestId('consignment-form'));
    expect(posts).toHaveLength(0);
    expect(byTestId('consignment-reason')!.getAttribute('aria-invalid')).toBe('true');
  });

  test('keep last good: a refetch that fails after a record keeps the panel, its live version and the outcome', async () => {
    getAnswer = { status: 200, body: read({ gate: { ...GATE_MISSING, state: 'eway-required', requiredBecause: null }, live: LIVE }) };
    await mount('operator');
    getAnswer = { status: 503, body: { code: 'unavailable', status: 503, title: 'Down' } };
    await click(byTestId('consignment-record'));
    setValue(byTestId('consignment-declared-value') as HTMLInputElement, '42000');
    await submit(byTestId('consignment-form'));
    expect(posts).toHaveLength(1);
    expect(view!.container.textContent).toContain('Recorded — v1');
    expect(byTestId('consignment-live')).not.toBeNull();
    expect(view!.container.textContent).not.toContain('Tax documents unavailable');
  });

  test('a refusal that means the order moved re-reads quietly: the form and its refusal stay on screen', async () => {
    await mount('operator');
    await click(byTestId('consignment-record'));
    setValue(byTestId('consignment-document-number') as HTMLInputElement, 'INV-1');
    setValue(byTestId('consignment-declared-value') as HTMLInputElement, '100');
    postAnswer = { status: 409, body: { code: 'order-not-open', status: 409, title: 'Cancelled' } };
    await submit(byTestId('consignment-form'));
    expect(byTestId('consignment-form')).not.toBeNull();
    expect(view!.container.textContent).toContain('The order is cancelled');
  });

  test('A46 — an operator amending an exempt record starts off the exemption and is told why', async () => {
    getAnswer = {
      status: 200,
      body: read({ gate: { ...GATE_MISSING, state: 'ready', blocking: false, requiredBecause: null }, live: { ...LIVE, eway: { ...LIVE.eway, status: 'exempt', exemptionReason: 'customs' } } }),
    };
    await mount('operator');
    await click(byTestId('consignment-record'));
    expect((byTestId('consignment-eway-exempt') as HTMLInputElement).checked).toBe(false);
    expect((byTestId('consignment-eway-none') as HTMLInputElement).checked).toBe(true);
    expect(view!.container.textContent).toContain('Only an office role can keep or change the exemption.');
  });

  test('an API without the route (404) renders nothing', async () => {
    getAnswer = { status: 404, body: { code: 'not-found', status: 404, title: 'Not found' } };
    await mount('ops_manager');
    expect(byTestId('consignment-panel')).toBeNull();
  });
});
