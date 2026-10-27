import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { RETURNS_CHANGED_EVENT, RETURNS_DISPOSED_EVENT } from '../../lib/returns';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import type { UserRole } from '../../lib/users';
import { AwaitingDispositions } from './awaiting-dispositions';
import { ReturnsView } from './returns-view';

/**
 * Story 4-7a — the Awaiting disposition queue. The claims a `src/lib` test
 * cannot make:
 *   1. every role reads the queue (oldest first, with the RMA, SKU, open
 *      figure, waiting time and history); only `returns.manage` gets Decide;
 *   2. Restock offers storage bins only (never a system bin or another
 *      client's) and POSTs exactly the restock body with a per-draft key;
 *      success shows the server's answer, re-reads the queue and fires the
 *      disposition event (the RMA detail's epoch, A7);
 *   3. Quarantine is disabled, with the reason, on a serial unit;
 *   4. Scrap asks to confirm inline; a refused scrap keeps its key for a
 *      retry of the same draft and words `scrap-above-threshold`; an edit
 *      mints a new key;
 *   5. the Returns page opens on the queue at `?tab=awaiting`, with a count.
 * Driven through a stubbed global `fetch`, so the wiring under test ships.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
const ZONE_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000e1';

function session(role: UserRole): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: TENANT_ID, name: 'Priya Spices', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function line(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    receiptLineId: 'rrl-1',
    receiptCode: 'RRN-0003',
    receivedAt: '2026-10-01T04:30:00.000Z',
    rmaId: 'rma-1',
    rmaCode: 'RMA-0007',
    orderReference: 'SHOP-#1001',
    clientId: 'client-a',
    warehouseId: WAREHOUSE_ID,
    skuId: 'sku-a',
    skuCode: 'PLAIN-A',
    skuName: 'Plain cotton tee',
    uom: 'each',
    condition: 'resaleable',
    note: null,
    batchCode: null,
    serialNumber: null,
    weightGrams: null,
    receivedQty: 5,
    openQty: 5,
    onHoldQty: 0,
    priorQuarantines: 1,
    lastReasonCode: 'damaged',
    ...over,
  };
}

function bin(id: string, code: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    tenantId: TENANT_ID,
    warehouseId: WAREHOUSE_ID,
    zoneId: ZONE_ID,
    code,
    capacity: 100,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    maxWeightGrams: null,
    storageClass: 'ambient',
    dedicatedClientId: null,
    type: 'shelf',
    blocked: false,
    retiredAt: null,
    retiredBy: null,
    systemOwned: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

let requests: { method: string; pathname: string; search: string }[] = [];
let disposes: { body: Record<string, unknown>; key: string | null }[] = [];
let disposeAnswers: Response[] = [];
let queue: Record<string, unknown>[] = [];

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname, search } = new URL(request.url);
    const method = request.method.toUpperCase();
    requests.push({ method, pathname, search });
    if (method === 'GET' && pathname.endsWith('/returns/awaiting')) return json(200, { items: queue, nextCursor: null });
    if (method === 'POST' && pathname.endsWith('/returns/dispositions')) {
      disposes.push({ body: (await request.json()) as Record<string, unknown>, key: request.headers.get('Idempotency-Key') });
      return (
        disposeAnswers.shift() ??
        json(201, {
          dispositions: [{ id: 'd-1', receiptLineId: 'rrl-1', rmaId: 'rma-1', outcome: 'restock', qty: 3, toBinId: 'bin-1', qcHoldId: null, ledgerEventId: 'e-1' }],
        })
      );
    }
    if (method === 'GET' && pathname.endsWith(`/warehouses/${WAREHOUSE_ID}/zones`)) {
      return json(200, { items: [{ id: ZONE_ID, code: 'A', name: 'A', warehouseId: WAREHOUSE_ID }], nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith(`/zones/${ZONE_ID}/bins`)) {
      return json(200, {
        items: [
          bin('bin-2', 'A-01-02'),
          bin('bin-1', 'A-01-01'),
          bin('bin-returns', 'RETURNS', { systemOwned: true }),
          bin('bin-theirs', 'B-09-01', { dedicatedClientId: 'client-b' }),
        ],
        nextCursor: null,
      });
    }
    if (method === 'GET' && pathname === `/api/v1/tenants/${TENANT_ID}/warehouses`) {
      return json(200, { items: [{ id: WAREHOUSE_ID, code: 'WH-1', name: 'Peenya' }], nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith(`/tenants/${TENANT_ID}/returns`)) return json(200, { items: [], nextCursor: null });
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
  disposes = [];
  disposeAnswers = [];
  queue = [line()];
  stubRouter();
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  try {
    localStorage.clear();
  } catch {
    // no storage to clear
  }
  restoreGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) {
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

function button(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === label);
}

async function press(target: HTMLElement | null | undefined): Promise<void> {
  expect(target).toBeTruthy();
  await act(async () => {
    target!.click();
  });
  await settle();
}

function field<T extends Element>(container: HTMLElement, label: string): T {
  const element = container.querySelector(`[aria-label="${label}"]`);
  expect(element).not.toBeNull();
  return element as unknown as T;
}

function radio(container: HTMLElement, value: string): HTMLInputElement {
  const element = container.querySelector(`input[type="radio"][value="${value}"]`);
  expect(element).not.toBeNull();
  return element as HTMLInputElement;
}

async function mount(role: UserRole, canManage: boolean): Promise<Rendered> {
  writeSession(session(role));
  const rendered = render(<AwaitingDispositions tenantId={TENANT_ID} warehouseId={WAREHOUSE_ID} warehouseLabel="WH-1 Peenya" canManage={canManage} />);
  await settle();
  return rendered;
}

const awaitingGets = () => requests.filter((r) => r.method === 'GET' && r.pathname.endsWith('/returns/awaiting'));

describe('the awaiting-disposition queue (story 4-7a)', () => {
  test('every role reads it, scoped to the warehouse; the row carries the RMA, receipt, SKU, figures, wait and history; no Decide without returns.manage', async () => {
    view = await mount('accountant', false);
    const params = new URLSearchParams(awaitingGets()[0]!.search);
    expect(params.get('warehouseId')).toBe(WAREHOUSE_ID);
    const text = view.container.textContent ?? '';
    for (const expected of ['RMA-0007', 'RRN-0003', 'SHOP-#1001', 'PLAIN-A', 'Plain cotton tee', 'Resaleable', 'Quarantined 1× · last: Damaged']) {
      expect(text).toContain(expected);
    }
    // Received 1 Oct, waited well past a week: flagged in words, never colour alone.
    expect(text).toMatch(/⚠\d+ days/);
    expect(text).toContain('An owner or operations manager decides each one');
    expect(view.container.querySelector('button[aria-label^="Decide"]')).toBeNull();
  });

  test('an empty queue reads as all clear', async () => {
    queue = [];
    view = await mount('ops_manager', true);
    expect(view.container.textContent).toContain('Nothing awaits a decision in WH-1 Peenya');
  });

  test('Restock: storage bins only; POSTs the restock body with a per-draft key; success re-reads and fires the disposition event', async () => {
    view = await mount('ops_manager', true);
    let disposedEvents = 0;
    const onDisposed = () => disposedEvents++;
    window.addEventListener(RETURNS_DISPOSED_EVENT, onDisposed);
    await press(view.container.querySelector<HTMLButtonElement>('button[aria-label="Decide PLAIN-A on RMA-0007"]'));
    await act(async () => {
      radio(view!.container, 'restock').click();
    });
    await settle();
    const select = field<HTMLSelectElement>(view.container, 'Storage bin');
    const options = [...select.options].map((option) => option.textContent);
    expect(options).toEqual(['Pick a bin', 'A-01-01', 'A-01-02']);
    // Nothing sent without a bin.
    await press(button(view.container, 'Restock 5 each'));
    expect(disposes).toHaveLength(0);
    expect(view.container.textContent).toContain('Pick the storage bin the units go to.');
    setValue(field<HTMLInputElement>(view.container, 'Quantity'), '3');
    setValue(field<HTMLSelectElement>(view.container, 'Storage bin'), 'bin-1');
    const before = awaitingGets().length;
    await press(button(view.container, 'Restock 3 each'));
    window.removeEventListener(RETURNS_DISPOSED_EVENT, onDisposed);
    expect(disposes).toHaveLength(1);
    expect(disposes[0]!.body).toEqual({ warehouseId: WAREHOUSE_ID, receiptLineId: 'rrl-1', outcome: 'restock', qty: 3, toBinId: 'bin-1' });
    expect(disposes[0]!.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(view.container.textContent).toContain('Restocked 3 each of PLAIN-A');
    expect(view.container.textContent).toContain('Moved from the Returns bin to A-01-01');
    expect(disposedEvents).toBe(1);
    expect(awaitingGets().length).toBeGreaterThan(before);
    // The panel closed.
    expect(view.container.querySelector('[aria-label="Storage bin"]')).toBeNull();
  });

  test('Quarantine is disabled on a serial unit, with the reason; the quantity is whole', async () => {
    queue = [line({ serialNumber: 'SN-77', receivedQty: 1, openQty: 1 })];
    view = await mount('ops_manager', true);
    await press(view.container.querySelector<HTMLButtonElement>('button[aria-label="Decide PLAIN-A on RMA-0007"]'));
    expect(radio(view.container, 'quarantine').disabled).toBe(true);
    expect(view.container.textContent).toContain("A serial unit can't be quarantined yet");
    expect(radio(view.container, 'scrap').disabled).toBe(false);
    await act(async () => {
      radio(view!.container, 'scrap').click();
    });
    await settle();
    expect(view.container.querySelector('[aria-label="Quantity"]')).toBeNull();
    expect(view.container.textContent).toContain('a serial unit is decided whole');
  });

  test('Scrap confirms inline; a refusal keeps the key for a retry of the same draft and words the threshold; an edit mints a new key', async () => {
    view = await mount('ops_manager', true);
    await press(view.container.querySelector<HTMLButtonElement>('button[aria-label="Decide PLAIN-A on RMA-0007"]'));
    await act(async () => {
      radio(view!.container, 'scrap').click();
    });
    await settle();
    setValue(field<HTMLSelectElement>(view.container, 'Reason'), 'damaged');
    await press(button(view.container, 'Scrap 5 each…'));
    // Asked, not sent.
    expect(disposes).toHaveLength(0);
    expect(view.container.querySelector('[aria-label="Confirm scrap"]')!.textContent).toContain(
      'Scrap 5 each of PLAIN-A from RMA-0007 (Damaged)?',
    );
    disposeAnswers = [json(409, { code: 'scrap-above-threshold', title: 'x', status: 409, awaitingQty: 5, threshold: 3 })];
    await press(button(view.container, 'Confirm scrap'));
    expect(disposes).toHaveLength(1);
    expect(disposes[0]!.body).toEqual({ warehouseId: WAREHOUSE_ID, receiptLineId: 'rrl-1', outcome: 'scrap', qty: 5, reasonCode: 'damaged' });
    expect(view.container.textContent).toContain(
      'Above your write-off threshold of 3 each — scrap at most 3 each at a time or raise the threshold in the adjustment policy.',
    );
    // A retry of the unchanged draft reuses the key.
    disposeAnswers = [json(503, { code: 'unavailable', title: 'x', status: 503 })];
    await press(button(view.container, 'Scrap 5 each…'));
    await press(button(view.container, 'Confirm scrap'));
    expect(disposes[1]!.key).toBe(disposes[0]!.key);
    // An edit is a new intent: a new key.
    setValue(field<HTMLInputElement>(view.container, 'Quantity'), '3');
    disposeAnswers = [
      json(201, { dispositions: [{ id: 'd-2', receiptLineId: 'rrl-1', rmaId: 'rma-1', outcome: 'scrap', qty: 3, toBinId: null, qcHoldId: null, ledgerEventId: 'e-2' }] }),
    ];
    await press(button(view.container, 'Scrap 3 each…'));
    await press(button(view.container, 'Confirm scrap'));
    expect(disposes[2]!.key).not.toBe(disposes[0]!.key);
    expect(view.container.textContent).toContain('Scrapped 3 each of PLAIN-A');
  });

  test('a refusal that moved the line (exceeds-awaiting) names what is left and re-reads the queue', async () => {
    view = await mount('ops_manager', true);
    await press(view.container.querySelector<HTMLButtonElement>('button[aria-label="Decide PLAIN-A on RMA-0007"]'));
    await act(async () => {
      radio(view!.container, 'quarantine').click();
    });
    await settle();
    setValue(field<HTMLSelectElement>(view.container, 'Reason'), 'needs-inspection');
    disposeAnswers = [json(409, { code: 'exceeds-awaiting', title: 'x', status: 409, awaitingQty: 2 })];
    const before = awaitingGets().length;
    await press(button(view.container, 'Quarantine 5 each'));
    expect(disposes[0]!.body).toMatchObject({ outcome: 'quarantine', reasonCode: 'needs-inspection', qty: 5 });
    expect(view.container.textContent).toContain('Only 2 each still await a decision on this line');
    expect(awaitingGets().length).toBeGreaterThan(before);
    // The panel closed: its draft was for figures that no longer hold.
    expect(view.container.querySelector('[aria-label="Reason"]')).toBeNull();
  });

  test('a panel whose line left the queue is closed', async () => {
    view = await mount('ops_manager', true);
    await press(view.container.querySelector<HTMLButtonElement>('button[aria-label="Decide PLAIN-A on RMA-0007"]'));
    expect(view.container.querySelector('[role="group"][aria-label="Decide PLAIN-A on RMA-0007"]')).not.toBeNull();
    queue = [];
    await act(async () => {
      window.dispatchEvent(new Event(RETURNS_CHANGED_EVENT));
    });
    await settle();
    expect(view.container.querySelector('[role="group"][aria-label="Decide PLAIN-A on RMA-0007"]')).toBeNull();
  });
});

describe('the Returns page tabs (story 4-7a)', () => {
  test('?tab=awaiting opens the queue, and the tab counts the lines waiting', async () => {
    queue = [line(), line({ receiptLineId: 'rrl-2', skuCode: 'PLAIN-B' })];
    writeSession(session('ops_manager'));
    view = render(<ReturnsView initialTab="awaiting" />);
    await settle();
    const tab = view.container.querySelector('[role="tab"][data-tab="awaiting"]')!;
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(tab.textContent).toContain('Awaiting disposition');
    expect(tab.querySelector('[aria-label="2 awaiting"]')).not.toBeNull();
    expect(view.container.textContent).toContain('PLAIN-B');
    expect(view.container.querySelector('button[aria-label="Decide PLAIN-A on RMA-0007"]')).not.toBeNull();
  });

  test('the bare route opens the authorizations; no pill when nothing waits', async () => {
    queue = [];
    writeSession(session('operator'));
    view = render(<ReturnsView />);
    await settle();
    expect(view.container.querySelector('[role="tab"][data-tab="authorizations"]')!.getAttribute('aria-selected')).toBe('true');
    expect(view.container.textContent).toContain('No returns yet');
    expect(view.container.querySelector('[role="tab"][data-tab="awaiting"] [aria-label$="awaiting"]')).toBeNull();
  });
});
