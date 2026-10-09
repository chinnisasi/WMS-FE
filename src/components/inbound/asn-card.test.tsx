import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import type { UserRole } from '../../lib/users';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { AsnsCard } from './asn-card';

/**
 * Story 21-6 — the ASN card's claims a `src/lib` test cannot make:
 *   1. every role READS the list (code, client once the tenant holds more
 *      than its own, status, received of announced) and a row's lines, and
 *      no longer sees the 21-6 handheld notice (retired by 21-6b);
 *   2. only `asn.manage` (owner, ops manager) is offered Announce, Amend,
 *      Close short and Cancel — absent, not disabled, for an operator — and
 *      each transition only where the row's status allows it;
 *   3. the create form's SKU picker offers only the chosen client's SKUs;
 *   4. pressing a button sends the verb it says — create with the parsed
 *      body, close with the note — each with an Idempotency-Key.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WAREHOUSE_ID = 'wh-1';

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

function sku(id: string, code: string, clientId: string) {
  return {
    id,
    tenantId: TENANT_ID,
    clientId,
    code,
    name: `${code} name`,
    uom: 'each',
    uomPrecision: 0,
    gstRateBps: 1800,
    hsn: null,
    barcode: `BC-${code}`,
    batchTracked: false,
    serialTracked: false,
    catchWeightTracked: false,
    reorderPoint: null,
    reorderQty: null,
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
  };
}
const SKUS = [sku('s-acme', 'ACME-1', ACME.id), sku('s-self', 'SELF-1', SELF.id)];

function asn(id: string, code: string, status: string, received: number) {
  return {
    id,
    code,
    clientId: ACME.id,
    status,
    expectedAt: null,
    // Story 21-6 review: progress is LINES received, never the unit totals.
    lineCount: 2,
    linesComplete: received > 0 ? 1 : 0,
    announcedTotal: 10,
    receivedTotal: received,
    createdAt: '2026-10-08T00:00:00.000Z',
  };
}
const PARTIAL = asn('a-partial', 'ASN-PART', 'partially_received', 4);
const ANNOUNCED = asn('a-new', 'ASN-NEW', 'announced', 0);

function detailOf(row: ReturnType<typeof asn>) {
  return {
    ...row,
    warehouseId: WAREHOUSE_ID,
    statusNote: null,
    updatedAt: row.createdAt,
    lines: [{ id: `${row.id}-l1`, skuId: 's-acme', announcedQty: 10, receivedQty: row.receivedTotal, openQty: 10 - row.receivedTotal }],
  };
}

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly body: unknown;
  readonly key: string | null;
}
let requests: Recorded[] = [];

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
    if (method === 'GET' && pathname.endsWith('/catalog/skus')) return json(200, { items: SKUS, nextCursor: null });
    if (method === 'GET' && pathname.endsWith(`/warehouses/${WAREHOUSE_ID}/inbound/asns`)) {
      return json(200, { items: [PARTIAL, ANNOUNCED], nextCursor: null });
    }
    if (method === 'GET' && pathname.endsWith(`/inbound/asns/${PARTIAL.id}`)) return json(200, { asn: detailOf(PARTIAL) });
    if (method === 'GET' && pathname.endsWith(`/inbound/asns/${ANNOUNCED.id}`)) return json(200, { asn: detailOf(ANNOUNCED) });
    if (method === 'POST' && pathname.endsWith('/inbound/asns')) {
      return json(201, { asn: { ...detailOf(asn('a-created', 'ASN-77', 'announced', 0)) } });
    }
    if (method === 'POST' && pathname.endsWith('/close')) {
      return json(200, { asn: { ...detailOf(PARTIAL), status: 'closed', statusNote: (body as { note: string }).note } });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  requests = [];
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

function setSelect(select: HTMLSelectElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function buttons(container: HTMLElement, label: string): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter((b) => b.textContent === label);
}

async function press(button: HTMLButtonElement | undefined): Promise<void> {
  expect(button).toBeDefined();
  await act(async () => {
    button!.click();
  });
  await settle();
}

/** Expands a row's lines (the Detail column's toggle, in row order). */
async function expand(container: HTMLElement, index: number): Promise<void> {
  await press(buttons(container, 'Lines')[index]);
}

async function mount(role: UserRole): Promise<Rendered> {
  writeSession(session(role));
  const rendered = render(<AsnsCard warehouseId={WAREHOUSE_ID} warehouseLabel="Peenya" />);
  await settle();
  return rendered;
}

describe('AsnsCard', () => {
  test('an operator reads the list, the client column and a row’s lines — and is offered no mutation at all', async () => {
    view = await mount('operator');
    const text = view.container.textContent ?? '';
    // Story 21-6b: the handheld receives against ASNs now — the 21-6 notice is gone.
    expect(text).not.toContain('next handheld update');
    // The header copy beside where the notice sat still renders.
    expect(text).toContain('Peenya — newest first. A client announces a shipment; receiving books against it like a PO.');
    const rows = [...view.container.querySelectorAll('tbody tr')].map((row) => row.textContent ?? '');
    expect(rows[0]).toContain('ASN-PART');
    expect(rows[0]).toContain('ACME');
    expect(rows[0]).toContain('Partially received');
    expect(rows[0]).toContain('1 of 2 lines received');
    expect(rows[0]).not.toContain('4 of 10');
    expect(rows[1]).toContain('0 of 2 lines received');
    expect(rows[1]).toContain('Announced');
    await expand(view.container, 0);
    expect(view.container.textContent).toContain('ACME-1');
    expect(view.container.textContent).toContain('announced');
    for (const label of ['Announce a shipment', 'Amend', 'Close short', 'Cancel ASN']) {
      expect(buttons(view.container, label)).toHaveLength(0);
    }
    expect(requests.every((r) => r.method === 'GET')).toBe(true);
  });

  test('a manager is offered Amend + Close short on a partially received ASN, Amend + Cancel on an announced one — never the other', async () => {
    view = await mount('ops_manager');
    await expand(view.container, 0);
    expect(buttons(view.container, 'Amend')).toHaveLength(1);
    expect(buttons(view.container, 'Close short')).toHaveLength(1);
    expect(buttons(view.container, 'Cancel ASN')).toHaveLength(0);
    await press(buttons(view.container, 'Hide')[0]);
    await expand(view.container, 1);
    expect(buttons(view.container, 'Amend')).toHaveLength(1);
    expect(buttons(view.container, 'Cancel ASN')).toHaveLength(1);
    expect(buttons(view.container, 'Close short')).toHaveLength(0);
  });

  test('Close short sends POST …/close with the note and an Idempotency-Key; a blank note sends nothing', async () => {
    view = await mount('ops_manager');
    await expand(view.container, 0);
    await press(buttons(view.container, 'Close short')[0]);
    const form = view.container.querySelector('form[aria-label="Close ASN ASN-PART short"]')!;
    expect(form).not.toBeNull();
    await press(form.querySelector<HTMLButtonElement>('button[type="submit"]')!);
    expect(form.textContent).toContain('Say why — a note is required.');
    expect(requests.some((r) => r.method === 'POST')).toBe(false);

    setInput(form.querySelector<HTMLInputElement>('input[aria-label="Note"]')!, '  six never shipped ');
    await press(form.querySelector<HTMLButtonElement>('button[type="submit"]')!);
    const close = requests.find((r) => r.method === 'POST')!;
    expect(close.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/inbound/asns/${PARTIAL.id}/close`);
    expect(close.body).toEqual({ note: 'six never shipped' });
    expect(close.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(view.container.textContent).toContain('ASN ASN-PART closed short');
  });

  test('Announce: the client picker gates the SKU picker to that client’s SKUs, and the submit POSTs the parsed body with a key', async () => {
    view = await mount('owner');
    await press(buttons(view.container, 'Announce a shipment')[0]);
    const form = view.container.querySelector('form[aria-label="Announce a shipment"]')!;
    // No SKU picker until a client is chosen.
    expect(form.querySelector('select[aria-label="Line 1 SKU"]')).toBeNull();
    const clientOptions = [...form.querySelectorAll('select[aria-label="Client"] option')].map((o) => o.textContent);
    expect(clientOptions).toEqual(['Pick the client…', 'Priya Logistics (your company)', 'ACME — Acme Foods']);
    setSelect(form.querySelector<HTMLSelectElement>('select[aria-label="Client"]')!, ACME.id);
    const skuOptions = [...form.querySelectorAll('select[aria-label="Line 1 SKU"] option')].map((o) => o.textContent);
    expect(skuOptions).toEqual(['Pick a SKU…', 'ACME-1 — ACME-1 name']);

    setInput(form.querySelector<HTMLInputElement>('input[aria-label="ASN code"]')!, ' ASN-77 ');
    setSelect(form.querySelector<HTMLSelectElement>('select[aria-label="Line 1 SKU"]')!, 's-acme');
    setInput(form.querySelector<HTMLInputElement>('input[aria-label="Line 1 quantity"]')!, '12');
    await press(buttons(form as HTMLElement, 'Announce')[0]);
    const created = requests.find((r) => r.method === 'POST')!;
    expect(created.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/inbound/asns`);
    expect(created.body).toEqual({ clientId: ACME.id, warehouseId: WAREHOUSE_ID, asnCode: 'ASN-77', lines: [{ skuId: 's-acme', announcedQty: 12 }] });
    expect(created.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(view.container.textContent).toContain('ASN ASN-77 announced');
  });
});
