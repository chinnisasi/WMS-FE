import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import type { AwaitingDispositionDto, ClientDto } from '../../lib/api/generated';
import { notifyReturnsChanged } from '../../lib/returns';
import { RETURNS_CHANGED_EVENT } from '../../lib/returns';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import {
  CLIENT,
  CLIENT_B,
  RRL_1,
  RRL_2,
  T,
  WH,
  awaitingLine,
  clientReturn,
  damagedArm,
  glowClient,
} from '../../lib/test/client-return-fixtures';
import type { UserRole } from '../../lib/users';
import { AwaitingDispositions } from './awaiting-dispositions';

/**
 * Story 4-7c (decision 14, A9, A12) — the awaiting queue's Return to client
 * and the create dialog, through a stubbed global `fetch`. The claims:
 *   1. only `returns.manage` selects; the selection is one client's (another
 *      client's line cannot join it) and a returned case is not offered;
 *   2. Return to client (n) opens the dialog with the selected lines at their
 *      whole open quantity, the return address and the brand's instruction;
 *      a DAMAGED arm can join; Create POSTs exactly that body with a key;
 *   3. a `client-address-missing` refusal links to the client page; the
 *      DAMAGED cap is checked before sending.
 */

function session(role: UserRole): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: T, name: 'Priya Logistics', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  } as StoredSession;
}

const B_CLIENT = { ...glowClient(), id: CLIENT_B, code: 'ZEN', name: 'Zen Foods' } as ClientDto;

let queue: AwaitingDispositionDto[] = [];
let nextCursor: string | null = null;
let hidden = new Set<string>();
let arm = damagedArm();
let glow: ClientDto = glowClient();
let createAnswers: { status: number; body: unknown }[] = [];
let requests: { method: string; url: URL; body: unknown; key: string | null }[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  queue = [
    awaitingLine(),
    awaitingLine({ receiptLineId: RRL_2, rmaCode: 'RMA-0004', openQty: 2, receivedQty: 2 }),
    awaitingLine({ receiptLineId: 'rrl-b', clientId: CLIENT_B, rmaCode: 'RMA-0009' }),
    awaitingLine({ receiptLineId: 'rrl-case', rmaCode: 'RMA-0010', weightGrams: 2340 }),
  ];
  createAnswers = [];
  requests = [];
  nextCursor = null;
  hidden = new Set();
  arm = damagedArm();
  glow = glowClient();
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    let body: unknown = null;
    try {
      body = await request.clone().json();
    } catch {
      body = null;
    }
    requests.push({ method, url, body, key: request.headers.get('Idempotency-Key') });
    const base = `/api/v1/tenants/${T}`;
    if (url.pathname === `${base}/returns/awaiting`) return json(200, { items: queue, nextCursor });
    if (url.pathname === `${base}/clients`) return json(200, { items: [glow, B_CLIENT, { ...glowClient(), id: 'c-self', code: 'self', name: 'Priya Logistics', systemOwned: true }] });
    if (url.pathname === `${base}/warehouses/${WH}/client-returns/returnable`) {
      const clientId = url.searchParams.get('clientId');
      return json(200, {
        warehouseId: WH,
        clientId,
        truncated: false,
        awaiting: queue.filter((line) => line.clientId === clientId && line.weightGrams === null && !hidden.has(line.receiptLineId)),
        damaged: clientId === CLIENT ? [arm] : [],
      });
    }
    if (url.pathname === `${base}/client-returns` && method === 'POST') {
      const answer = createAnswers.shift() ?? { status: 201, body: clientReturn({ id: 'new-rtc', code: 'RTC-0009' }) };
      return json(answer.status, answer.body);
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
});

let view: Rendered | undefined;

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
  for (let i = 0; i < 16; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function click(target: HTMLElement | null | undefined): Promise<void> {
  expect(target).toBeTruthy();
  await act(async () => {
    target!.click();
  });
  await settle();
}

function setValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function mount(role: UserRole, canManage: boolean): Promise<void> {
  writeSession(session(role));
  view = render(<AwaitingDispositions tenantId={T} warehouseId={WH} warehouseLabel="BLR Bengaluru DC" canManage={canManage} />);
  await settle();
}

const box = (label: string) => view!.container.querySelector<HTMLInputElement>(`input[type="checkbox"][aria-label="${label}"]`);
const dialog = () => view!.container.querySelector<HTMLElement>('[role="dialog"][aria-label="New return to client"]');
const creates = () => requests.filter((r) => r.method === 'POST' && r.url.pathname.endsWith('/client-returns'));
const returnButton = () => [...view!.container.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Return to client ('));

describe('the queue selection (A12)', () => {
  test('a role without returns.manage selects nothing', async () => {
    await mount('accountant', false);
    expect(view!.container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  test('one client only: another client’s line and a returned case cannot join; the action counts the selection', async () => {
    await mount('owner', true);
    expect(box('Select SKU-A on RMA-0010')).toBeNull();
    await click(box('Select SKU-A on RMA-0003'));
    expect(box('Select SKU-A on RMA-0009')).toBeNull();
    await click(box('Select SKU-A on RMA-0004'));
    expect(returnButton()!.textContent).toBe('Return to client (2)');
  });
});

describe('the create dialog', () => {
  test('preselected lines at their whole open quantity, a DAMAGED arm joins; Create POSTs the body with a key and the queue re-reads', async () => {
    await mount('owner', true);
    await click(box('Select SKU-A on RMA-0003'));
    await click(box('Select SKU-A on RMA-0004'));
    await click(returnButton());
    const d = dialog()!;
    expect(d).not.toBeNull();
    expect(d.querySelector<HTMLInputElement>('input[aria-label="Return address"]')!.checked).toBe(true);
    expect(d.querySelector<HTMLInputElement>('input[aria-label="Send back SKU-A on RMA-0003"]')!.value).toBe('4');
    expect(d.querySelector<HTMLInputElement>('input[aria-label="Send back SKU-A on RMA-0004"]')!.value).toBe('2');
    expect(d.querySelector<HTMLSelectElement>('select[aria-label="Reason for SKU-A on RMA-0003"]')!.value).toBe('client-instruction');
    expect(d.textContent).toContain('RTV-0002');
    setValue(d.querySelector<HTMLInputElement>('input[aria-label="Send back SKU-D"]')!, '2');
    let changed = 0;
    const onChanged = () => changed++;
    window.addEventListener(RETURNS_CHANGED_EVENT, onChanged);
    await act(async () => {
      d.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
    window.removeEventListener(RETURNS_CHANGED_EVENT, onChanged);
    expect(creates()).toHaveLength(1);
    expect(creates()[0]!.body).toEqual({
      warehouseId: WH,
      consigneeAddress: 'return',
      lines: [
        { source: 'returns', returnReceiptLineId: RRL_1, quantity: 4, reasonCode: 'client-instruction' },
        { source: 'returns', returnReceiptLineId: RRL_2, quantity: 2, reasonCode: 'client-instruction' },
        { source: 'damaged', skuId: damagedArm().skuId, quantity: 2, reasonCode: 'client-instruction' },
      ],
    });
    expect(creates()[0]!.key).not.toBeNull();
    expect(dialog()).toBeNull();
    expect(view!.container.textContent).toContain('RTC-0009 created');
    expect(changed).toBeGreaterThan(0);
  });

  test('the DAMAGED cap is checked before sending; client-address-missing links to the client page', async () => {
    createAnswers = [{ status: 409, body: { code: 'client-address-missing', status: 409, title: 'x', detail: 'x', addressKind: 'return', clientId: CLIENT } }];
    await mount('owner', true);
    await click(box('Select SKU-A on RMA-0003'));
    await click(returnButton());
    const d = dialog()!;
    setValue(d.querySelector<HTMLInputElement>('input[aria-label="Send back SKU-D"]')!, '3');
    await act(async () => {
      d.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(creates()).toHaveLength(0);
    expect(d.textContent).toContain('at most 2 each can go back');
    setValue(d.querySelector<HTMLInputElement>('input[aria-label="Send back SKU-D"]')!, '');
    await act(async () => {
      d.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(creates()).toHaveLength(1);
    expect(d.textContent).toContain('no return address on file');
    const link = d.querySelector<HTMLAnchorElement>('[data-testid="rtc-client-page-link"]')!;
    expect(link.getAttribute('href')).toBe('/settings?tab=clients');
  });
});

async function submitDialog(): Promise<void> {
  await act(async () => {
    dialog()!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
}

const createButton = () => [...dialog()!.querySelectorAll('button')].find((b) => b.textContent === 'Create return to client')!;

describe('code review — the selection is one page’s; the created link', () => {
  test('a page move and a returns change clear the selection', async () => {
    nextCursor = 'c2';
    await mount('owner', true);
    await click(box('Select SKU-A on RMA-0003'));
    expect(returnButton()).toBeDefined();
    await click([...view!.container.querySelectorAll('button')].find((b) => b.textContent === 'Next'));
    expect(returnButton()).toBeUndefined();
    expect(box('Select SKU-A on RMA-0003')!.checked).toBe(false);
    await click(box('Select SKU-A on RMA-0003'));
    expect(returnButton()).toBeDefined();
    await act(async () => notifyReturnsChanged());
    await settle();
    expect(returnButton()).toBeUndefined();
  });

  test('a created return links to the To client tab', async () => {
    await mount('owner', true);
    await click(box('Select SKU-A on RMA-0003'));
    await click(returnButton());
    await submitDialog();
    expect(view!.container.querySelector('[data-testid="rtc-created-link"]')!.getAttribute('href')).toBe('/returns?tab=to-client');
  });
});

describe('code review — the draft is pruned to the fresh read', () => {
  test('a selected line the read no longer offers is left out (said), and Create sends the rest', async () => {
    hidden = new Set([RRL_2]);
    await mount('owner', true);
    await click(box('Select SKU-A on RMA-0003'));
    await click(box('Select SKU-A on RMA-0004'));
    await click(returnButton());
    expect(dialog()!.textContent).toContain('RMA-0004 SKU-A no longer await a decision here');
    await submitDialog();
    expect(creates()).toHaveLength(1);
    expect((creates()[0]!.body as { lines: unknown[] }).lines).toEqual([{ source: 'returns', returnReceiptLineId: RRL_1, quantity: 4, reasonCode: 'client-instruction' }]);
  });

  test('a DAMAGED arm that drops to nothing available after a re-read leaves the draft', async () => {
    await mount('owner', true);
    await click(box('Select SKU-A on RMA-0003'));
    await click(returnButton());
    setValue(dialog()!.querySelector<HTMLInputElement>('input[aria-label="Send back SKU-D"]')!, '2');
    arm = damagedArm({ available: 0, claimedRtc: 2, claimedBy: ['RTC-0005', 'RTV-0002'] });
    // A returns change re-reads the returnable list under the open dialog.
    await act(async () => notifyReturnsChanged());
    await settle();
    expect(dialog()).not.toBeNull();
    await submitDialog();
    expect(creates()).toHaveLength(1);
    expect((creates()[0]!.body as { lines: { source: string }[] }).lines.map((line) => line.source)).toEqual(['returns']);
  });
});

describe('code review — decision 7, no address fallback', () => {
  test('a client without a return address: the return address stays chosen, Create waits for an explicit pick of the registered one', async () => {
    glow = glowClient({ returnAddress: null });
    await mount('owner', true);
    await click(box('Select SKU-A on RMA-0003'));
    await click(returnButton());
    const d = dialog()!;
    expect(d.querySelector<HTMLInputElement>('input[aria-label="Return address"]')!.checked).toBe(true);
    expect(d.querySelector<HTMLInputElement>('input[aria-label="Registered address"]')!.checked).toBe(false);
    const missing = d.querySelector('[data-testid="rtc-chosen-address-missing"]')!;
    expect(missing.textContent).toContain('no return address on file');
    expect(missing.querySelector('a')!.getAttribute('href')).toBe('/settings?tab=clients');
    expect(createButton().disabled).toBe(true);
    await click(d.querySelector<HTMLInputElement>('input[aria-label="Registered address"]'));
    expect(createButton().disabled).toBe(false);
    await submitDialog();
    expect((creates()[0]!.body as { consigneeAddress: string }).consigneeAddress).toBe('registered');
  });

  test('a client with no address at all: Create is disabled with its own message', async () => {
    glow = glowClient({ returnAddress: null, registeredAddress: null });
    await mount('owner', true);
    await click(box('Select SKU-A on RMA-0003'));
    await click(returnButton());
    expect(dialog()!.querySelector('[data-testid="rtc-no-address"]')!.textContent).toContain('has no address on file');
    expect(createButton().disabled).toBe(true);
  });
});
