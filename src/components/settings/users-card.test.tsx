import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { UsersCard } from './users-card';

/**
 * Story 21-7 — the Users card's client-portal persona:
 *   1. the invite form offers `Client portal` once client brands exist, and
 *      then a picker of ACTIVE, non-self clients only;
 *   2. a client invite sends `clientId`; a staff invite never does;
 *   3. a client user's row shows its role read-only with the client's code —
 *      no role select — while staff rows keep the four-role select.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';

const OWNER: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Three PL Co', gstin: null },
  user: { id: 'u-owner', email: 'owner@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

const NO_TAX = { legalName: null, gstin: null, billingLine1: null, billingLine2: null, billingCity: null, billingStateCode: null, billingPincode: null };
const SELF = { id: 'c-self', tenantId: TENANT_ID, code: 'self', name: 'Three PL Co', status: 'active', systemOwned: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', taxDetails: NO_TAX };
const BRAND_A = { ...SELF, id: 'c-a', code: 'BRAND-A', name: 'Brand A', systemOwned: false };
const BRAND_B = { ...SELF, id: 'c-b', code: 'BRAND-B', name: 'Brand B', systemOwned: false, status: 'suspended' };

const STAFF_ROW = { id: 'u-op', email: 'op@example.com', role: 'operator', status: 'active', clientId: null, createdAt: '2026-01-02T00:00:00.000Z' };
const CLIENT_ROW = { id: 'u-cl', email: 'buyer@brand-a.example', role: 'client', status: 'invited', clientId: 'c-a', createdAt: '2026-01-03T00:00:00.000Z' };

let posts: Record<string, unknown>[] = [];
let clientRows: unknown[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  posts = [];
  clientRows = [SELF, BRAND_A, BRAND_B];
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname } = new URL(request.url);
    const method = request.method.toUpperCase();
    if (method === 'GET' && pathname.endsWith('/clients')) return json(200, { items: clientRows });
    if (method === 'GET' && pathname.endsWith('/users')) return json(200, { items: [STAFF_ROW, CLIENT_ROW], nextCursor: null });
    if (method === 'POST' && pathname.endsWith('/users')) {
      const body = (await request.json()) as Record<string, unknown>;
      posts.push(body);
      return json(201, { user: { ...CLIENT_ROW, email: body.email }, inviteToken: 'tok', inviteExpiresAt: '2026-10-16T00:00:00.000Z' });
    }
    return json(404, { code: 'not-found', status: 404, title: 'Unrouted' });
  }) as unknown as typeof fetch);
  writeSession(OWNER);
});

let view: Rendered | undefined;

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

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

function roleSelect(container: HTMLElement): HTMLSelectElement {
  return container.querySelector('form select') as HTMLSelectElement;
}

describe('UsersCard — the client-portal persona (story 21-7)', () => {
  test('the invite offers Client portal, then a picker of active non-self clients only', async () => {
    view = render(<UsersCard />);
    await settle();
    const options = [...roleSelect(view.container).options].map((o) => o.value);
    expect(options).toContain('client');
    expect(view.container.querySelector('select[aria-label="Client brand"]')).toBeNull();
    setValue(roleSelect(view.container), 'client');
    const picker = view.container.querySelector('select[aria-label="Client brand"]') as HTMLSelectElement;
    expect([...picker.options].map((o) => o.value)).toEqual(['', 'c-a']);
  });

  test('a single-client (D2C) tenant is never offered the client role', async () => {
    clientRows = [SELF];
    view = render(<UsersCard />);
    await settle();
    expect([...roleSelect(view.container).options].map((o) => o.value)).not.toContain('client');
  });

  test('a client invite sends clientId; a staff invite never does', async () => {
    view = render(<UsersCard />);
    await settle();
    const email = view.container.querySelector('form input[type="email"]') as HTMLInputElement;
    const form = view.container.querySelector('form')!;
    setValue(email, 'buyer2@brand-a.example');
    setValue(roleSelect(view.container), 'client');
    setValue(view.container.querySelector('select[aria-label="Client brand"]') as HTMLSelectElement, 'c-a');
    act(() => void form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    expect(posts).toEqual([{ email: 'buyer2@brand-a.example', role: 'client', clientId: 'c-a' }]);

    setValue(email, 'op2@example.com');
    setValue(roleSelect(view.container), 'operator');
    act(() => void form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    expect(posts[1]).toEqual({ email: 'op2@example.com', role: 'operator' });
  });

  test("a client user's row is read-only with its client's code; staff rows keep the four-role select", async () => {
    view = render(<UsersCard />);
    await settle();
    expect(view.container.querySelector('[data-testid="client-role"]')!.textContent).toBe('Client portal · BRAND-A');
    expect(view.container.querySelector('select[aria-label="Role for buyer@brand-a.example"]')).toBeNull();
    const staff = view.container.querySelector('select[aria-label="Role for op@example.com"]') as HTMLSelectElement;
    expect([...staff.options].map((o) => o.value)).toEqual(['operator', 'accountant', 'ops_manager', 'owner']);
  });
});
