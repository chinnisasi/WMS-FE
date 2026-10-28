import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import type { UserRole } from '../../lib/users';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { ClientsCard } from './clients-card';

/**
 * Story 5-2a — the Webhooks panel of Settings → Clients:
 *   1. only an owner is offered Webhooks, and never on the warehouse's own client;
 *   2. the endpoint table reads the status as a word, the held count and the secret's hint;
 *   3. add: the attestation is required locally; the POST carries the body and an
 *      Idempotency-Key; the one-time secret is shown with "you won't see this again";
 *   4. "Deliveries are paused" when the server says sending is off;
 *   5. Send test shows the synchronous outcome;
 *   6. Enable with held deliveries asks release / discard and sends the choice;
 *   7. Deliveries lists the log and opens a body; Redeliver sends a keyed POST.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';

function session(role: UserRole): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Priya Spices', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  };
}

const SELF = {
  id: 'c-self',
  tenantId: TENANT_ID,
  code: 'self',
  name: 'Priya Spices',
  status: 'active',
  systemOwned: true,
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
};
const ACME = { ...SELF, id: 'c-acme', code: 'ACME', name: 'Acme Foods', systemOwned: false };

const ENDPOINT = {
  id: 'e-1',
  clientId: 'c-acme',
  url: 'https://hooks.acme.in/wms',
  description: 'Acme ERP',
  eventTypes: ['receipt.recorded', 'order.dispatched'],
  status: 'disabled',
  disabledReason: 'failing',
  disabledAt: '2026-10-27T08:35:00.000Z',
  schemaVersion: 1,
  secretHint: 'a1B2',
  previousSecretExpiresAt: null,
  consecutiveFailures: 10,
  failingSince: '2026-10-26T08:35:00.000Z',
  lastSuccessAt: null,
  createdAt: '2026-10-20T00:00:00.000Z',
  updatedAt: '2026-10-27T08:35:00.000Z',
  heldCount: 3,
};

const DELIVERY = {
  id: 'd-1',
  endpointId: 'e-1',
  eventId: 'ev-1',
  eventType: 'order.dispatched',
  subjectId: 'o-1',
  status: 'failed',
  attempts: 9,
  nextAttemptAt: null,
  lastAttemptAt: '2026-10-27T08:00:00.000Z',
  lastStatusCode: 503,
  lastErrorCode: 'http-503',
  lastDurationMs: 40,
  succeededAt: null,
  redeliveryCount: 0,
  createdAt: '2026-10-26T08:00:00.000Z',
};

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly body: unknown;
  readonly key: string | null;
}
let requests: Recorded[] = [];
let endpoints: unknown[] = [];
let warnings: string[] = [];
/** When set, the next PATCH answers this 409 once. */
let patchRefusal: { code: string; heldCount: number } | null = null;

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
    if (method === 'GET' && pathname.endsWith('/webhook-endpoints')) return json(200, { items: endpoints, warnings });
    if (method === 'POST' && pathname.endsWith('/webhook-endpoints')) {
      const sent = body as { url: string; eventTypes: string[] };
      return json(201, {
        endpoint: { ...ENDPOINT, id: 'e-new', url: sent.url, eventTypes: sent.eventTypes, status: 'active', disabledReason: null, failingSince: null },
        signingSecret: 'whsec_TOPSECRETbase64valueAAAAAAAAAAAAAAAAAAAAAA=',
        warnings: [],
      });
    }
    if (method === 'POST' && pathname.endsWith('/test')) {
      return json(200, { test: { statusCode: 204, errorCode: null, durationMs: 87 }, warnings: [] });
    }
    if (method === 'POST' && pathname.endsWith('/rotate-secret')) {
      return json(200, { endpoint: { ...ENDPOINT, secretHint: 'Zz99' }, signingSecret: 'whsec_ROTATEDsecretAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', warnings: [] });
    }
    if (method === 'DELETE' && pathname.includes('/webhook-endpoints/')) {
      return json(200, { endpoint: { ...ENDPOINT, status: 'deleted' }, signingSecret: null, warnings: [] });
    }
    if (method === 'POST' && pathname.endsWith('/deliveries/redeliver')) return json(200, { redelivered: 4, remaining: 0 });
    if (method === 'PATCH' && pathname.includes('/webhook-endpoints/') && patchRefusal !== null) {
      const refusal = patchRefusal;
      patchRefusal = null;
      return json(409, { code: refusal.code, title: 'x', status: 409, detail: 'Decide', heldCount: refusal.heldCount });
    }
    if (method === 'PATCH' && pathname.includes('/webhook-endpoints/')) {
      return json(200, { endpoint: { ...ENDPOINT, status: 'active', disabledReason: null }, signingSecret: null, heldReleased: 3, warnings: [] });
    }
    if (method === 'GET' && pathname.endsWith('/deliveries')) return json(200, { items: [DELIVERY], nextCursor: null });
    if (method === 'GET' && pathname.endsWith('/deliveries/d-1')) return json(200, { delivery: { ...DELIVERY, body: '{"id":"ev-1","type":"order.dispatched"}' } });
    if (method === 'POST' && pathname.endsWith('/deliveries/d-1/redeliver')) return json(200, { delivery: { ...DELIVERY, status: 'pending', attempts: 0 } });
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  endpoints = [];
  warnings = [];
  patchRefusal = null;
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

function buttons(container: HTMLElement, label: string): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter((b) => b.textContent === label);
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
  });
  await settle();
}

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function openPanel(): Promise<HTMLElement> {
  writeSession(session('owner'));
  view = render(<ClientsCard />);
  await settle();
  await click(buttons(view.container, 'Webhooks')[0]!);
  return view.container;
}

describe('the Webhooks panel (story 5-2a)', () => {
  test('owner-only, and never on the warehouse’s own client', async () => {
    writeSession(session('owner'));
    view = render(<ClientsCard />);
    await settle();
    expect(buttons(view.container, 'Webhooks')).toHaveLength(1);
    view.unmount();
    for (const role of ['ops_manager', 'accountant'] as const) {
      writeSession(session(role));
      view = render(<ClientsCard />);
      await settle();
      expect(buttons(view.container, 'Webhooks')).toHaveLength(0);
      view.unmount();
    }
    view = undefined;
  });

  test('an empty client offers the first endpoint; the add form needs the attestation, then sends a keyed POST and shows the secret once', async () => {
    const container = await openPanel();
    expect(container.textContent).toContain('No webhooks yet');
    await click(buttons(container, 'Add endpoint')[0]!);
    const form = container.querySelector('form[aria-label="Add endpoint for ACME"]') as HTMLFormElement;
    setInput(form.querySelector('input[placeholder="https://hooks.example.com/wms"]') as HTMLInputElement, 'https://hooks.acme.in/wms');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(container.textContent).toContain('Confirm the client asked for this URL.');
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0);
    const attest = [...form.querySelectorAll('input[type="checkbox"]')].at(-1) as HTMLInputElement;
    await click(attest);
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
    const post = requests.find((r) => r.method === 'POST' && r.pathname.endsWith('/webhook-endpoints'))!;
    expect(post.body).toEqual({ url: 'https://hooks.acme.in/wms', description: null, eventTypes: ['receipt.recorded', 'order.dispatched'] });
    expect(post.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    const secret = container.querySelector('input[aria-label="Signing secret"]') as HTMLInputElement;
    expect(secret.value).toBe('whsec_TOPSECRETbase64valueAAAAAAAAAAAAAAAAAAAAAA=');
    expect(container.textContent).toContain("You won't see it again — rotate to get a new one.");
    await click(buttons(container, 'I have saved it')[0]!);
    expect(container.querySelector('input[aria-label="Signing secret"]')).toBeNull();
  });

  test('the table reads status as a word, the held backlog and the hint; the paused banner shows when sending is off', async () => {
    endpoints = [ENDPOINT];
    warnings = ['webhooks-unavailable'];
    const container = await openPanel();
    const text = container.textContent ?? '';
    expect(text).toContain('Disabled — failing since 26 Oct 2026, 14:05 IST');
    expect(text).toContain('3 deliveries held');
    expect(text).toContain('whsec_…a1B2');
    expect(text).toContain('Deliveries are paused on this server');
    expect(text).toContain('Goods received · Order dispatched');
    // A test send is pointless while sending is off.
    expect(buttons(container, 'Send test')[0]!.disabled).toBe(true);
  });

  test('Send test answers the outcome synchronously', async () => {
    endpoints = [{ ...ENDPOINT, status: 'active', disabledReason: null, failingSince: null, heldCount: 0 }];
    const container = await openPanel();
    await click(buttons(container, 'Send test')[0]!);
    const test = requests.find((r) => r.pathname.endsWith('/test'))!;
    expect(test.method).toBe('POST');
    expect(test.key).not.toBeNull();
    expect(container.textContent).toContain('Test delivered — HTTP 204');
  });

  test('Enable with held deliveries asks send or discard, and sends the choice', async () => {
    endpoints = [ENDPOINT];
    const container = await openPanel();
    await click(buttons(container, 'Enable')[0]!);
    expect(container.textContent).toContain('3 deliveries were held while it was failing.');
    const discard = [...container.querySelectorAll('input[type="radio"]')][1] as HTMLInputElement;
    await click(discard);
    await click(buttons(container, 'Enable endpoint')[0]!);
    const patch = requests.find((r) => r.method === 'PATCH')!;
    expect(patch.body).toEqual({ status: 'active', held: 'discard' });
    expect(container.textContent).toContain('Endpoint enabled');
  });

  test('Deliveries lists the log, opens the exact body, and Redeliver is a keyed POST', async () => {
    endpoints = [{ ...ENDPOINT, status: 'active', disabledReason: null, failingSince: null, heldCount: 0 }];
    const container = await openPanel();
    await click(buttons(container, 'Deliveries')[0]!);
    expect(container.textContent).toContain('Order dispatched');
    expect(container.textContent).toContain('Failed');
    expect(container.textContent).toContain('HTTP 503');
    await click(buttons(container, 'Body')[0]!);
    expect(container.querySelector('pre')?.textContent).toContain('"type": "order.dispatched"');
    await click(buttons(container, 'Redeliver')[0]!);
    const redeliver = requests.find((r) => r.pathname.endsWith('/deliveries/d-1/redeliver'))!;
    expect(redeliver.key).not.toBeNull();
    expect(container.textContent).toContain('Sent again');
  });

  const ACTIVE = { ...ENDPOINT, status: 'active', disabledReason: null, failingSince: null, heldCount: 0 };

  async function more(container: HTMLElement, label: string): Promise<void> {
    // The "More" disclosure's items are in the DOM (a native <details>); press the one wanted.
    await click(buttons(container, label)[0]!);
  }

  test('Rotate sends revokePrevious and shows the new secret once', async () => {
    endpoints = [ACTIVE];
    const container = await openPanel();
    await more(container, 'Rotate secret');
    const revoke = [...container.querySelectorAll('input[type="checkbox"]')].find((input) => input.closest('label')?.textContent?.includes('End the old secret now')) as HTMLInputElement;
    await click(revoke);
    await click(buttons(container, 'Rotate secret').at(-1)!);
    const rotate = requests.find((r) => r.pathname.endsWith('/rotate-secret'))!;
    expect(rotate.body).toEqual({ revokePrevious: true });
    expect(rotate.key).not.toBeNull();
    expect((container.querySelector('input[aria-label="Signing secret"]') as HTMLInputElement).value).toBe('whsec_ROTATEDsecretAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    expect(container.textContent).toContain('New signing secret');
  });

  test('Edit PATCHes the URL, description and events; Disable PATCHes the status; Delete is a keyed DELETE', async () => {
    endpoints = [ACTIVE];
    const container = await openPanel();
    await more(container, 'Edit');
    const form = container.querySelector('form[aria-label="Save endpoint for ACME"]') as HTMLFormElement;
    setInput(form.querySelector('input[placeholder="https://hooks.example.com/wms"]') as HTMLInputElement, 'https://new.acme.in/wms');
    const receipt = form.querySelectorAll('input[type="checkbox"]')[0] as HTMLInputElement;
    await click(receipt);
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
    const edit = requests.find((r) => r.method === 'PATCH')!;
    expect(edit.body).toEqual({ url: 'https://new.acme.in/wms', description: 'Acme ERP', eventTypes: ['order.dispatched'] });
    requests = [];
    await more(container, 'Disable');
    await click(buttons(container, 'Disable endpoint')[0]!);
    expect(requests.find((r) => r.method === 'PATCH')!.body).toEqual({ status: 'disabled' });
    requests = [];
    await more(container, 'Delete');
    await click(buttons(container, 'Delete endpoint')[0]!);
    const del = requests.find((r) => r.method === 'DELETE')!;
    expect(del.pathname.endsWith('/webhook-endpoints/e-1')).toBe(true);
    expect(del.key).not.toBeNull();
    expect(container.textContent).toContain('Endpoint deleted');
  });

  test('Enable on a stale list: a held-decision refusal brings the choice, and the retry sends it (C26)', async () => {
    endpoints = [{ ...ENDPOINT, heldCount: 0 }];
    patchRefusal = { code: 'held-decision-required', heldCount: 7 };
    const container = await openPanel();
    await click(buttons(container, 'Enable')[0]!);
    await click(buttons(container, 'Enable endpoint')[0]!);
    expect(container.textContent).toContain('7 deliveries are held');
    await click(buttons(container, 'Enable endpoint')[0]!);
    const patches = requests.filter((r) => r.method === 'PATCH');
    expect(patches.map((r) => r.body)).toEqual([{ status: 'active' }, { status: 'active', held: 'release' }]);
    expect(patches[1]!.key).not.toBe(patches[0]!.key);
  });

  test('Redeliver failed since… sends an instant frozen when the confirmation opened and, ticked, only the expired (C25)', async () => {
    endpoints = [ACTIVE];
    const container = await openPanel();
    await click(buttons(container, 'Deliveries')[0]!);
    await click(buttons(container, 'Redeliver failed since…')[0]!);
    const expired = [...container.querySelectorAll('input[type="checkbox"]')].find((input) => input.closest('label')?.textContent?.includes('Only those that expired')) as HTMLInputElement;
    await click(expired);
    await click(buttons(container, 'Redeliver').at(-1)!);
    const bulk = requests.find((r) => r.pathname.endsWith('/deliveries/redeliver'))!;
    const body = bulk.body as { since: string; statuses: string[] };
    expect(body.statuses).toEqual(['expired']);
    expect(Math.abs(Date.parse(body.since) - (Date.now() - 24 * 3_600_000))).toBeLessThan(60_000);
    expect(container.textContent).toContain('4 sent again');
  });
});
