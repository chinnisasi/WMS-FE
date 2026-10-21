import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { writeActiveClientId } from '../../lib/active-client';
import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { istLocalToIso } from '../../lib/gate-ins';
import type { UserRole } from '../../lib/users';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { writeActiveWarehouseId } from '../../lib/warehouses';
import { InboundCards } from './inbound-cards';

/**
 * Story 2-3a — Inbound → Gate-in, driven through a stubbed global `fetch`
 * (the generated client is a fetch wrapper, so the gates, wiring and wrappers
 * under test are the ones that ship). One test per web matrix row, plus the
 * claims a `src/lib` test cannot make:
 *   1. an accountant reads the list and the detail but is offered NO Record
 *      button and NO row action (absent, not disabled); the phone is masked;
 *   2. the list's chrome (Hand delivery, "2 short", Seal broken, Open > 7
 *      days, no flag when undeclared) renders for exactly the right rows;
 *   3. expanding a row reads `GET :id` (never on mount), with its own failure;
 *   4. Record POSTs the exact body with a per-draft key (a retry after a
 *      dropped request reuses it, an edit mints a new one);
 *   5. the row actions follow the state and send the verb they say; an
 *      `applied: false` reads "Already recorded at … IST", never a success;
 *   6. the tab count is one multi-status read with no client, shown while
 *      the client filter is pending; the default tab stays Purchase orders;
 *   7. the GRN list shows `GI-x · vehicle`.
 */

const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WH = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';
const WH2 = '0198f7a2-1b3c-7d4e-8f90-99aabbccddff';
const G1 = '0198f7a2-1b3c-7d4e-8f90-0000000000c1';
const G2 = '0198f7a2-1b3c-7d4e-8f90-0000000000c2';
const G3 = '0198f7a2-1b3c-7d4e-8f90-0000000000c3';
const G4 = '0198f7a2-1b3c-7d4e-8f90-0000000000c4';
const PO = '0198f7a2-1b3c-7d4e-8f90-0000000000f1';
const TRANSPORTER = '0198f7a2-1b3c-7d4e-8f90-0000000000a7';

function session(role: UserRole): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: T, name: 'Priya Logistics', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  } as StoredSession;
}

const SELF = { id: 'c-self', code: 'self', name: 'Priya Logistics', status: 'active', systemOwned: true };
const GLOW = { id: 'c-glow', code: 'GLOW', name: 'GlowCo', status: 'active', systemOwned: false };

function entry(id: string, code: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    tenantId: T,
    warehouseId: WH,
    code,
    status: 'gated_in',
    handDelivery: false,
    vehicleNo: 'KA01AB1234',
    containerNo: null,
    transporterPartnerId: null,
    transporterName: 'VRL Logistics',
    transporterSnapshot: null,
    transporterLabel: 'VRL Logistics',
    lrNumber: null,
    driverName: null,
    driverPhone: '98•••••345',
    sealStatus: 'intact',
    sealNumber: 'S-991',
    packagesDeclared: null,
    packagesCounted: null,
    dockDoor: 'D3',
    gatedInAt: '2026-10-21T04:30:00.000Z',
    unloadStartedAt: null,
    unloadEndedAt: null,
    gatedOutAt: null,
    unloadStartedBy: null,
    unloadEndedBy: null,
    gatedOutBy: null,
    createdAt: '2026-10-21T04:30:00.000Z',
    updatedAt: '2026-10-21T04:30:00.000Z',
    documentCount: 0,
    receiptCount: 0,
    packagesFlag: null,
    packagesDifference: null,
    staleOpen: false,
    ...patch,
  };
}

let rows: Record<string, unknown>[] = [];
let countItems: unknown[] = [];
let countNextCursor: string | null = null;
let clientsMode: 'ok' | 'hang' = 'ok';
let transportersMode: 'ok' | 'empty' | 'fail' = 'ok';
let detailMode: 'ok' | 'fail' = 'ok';
let detailPatch: Record<string, unknown> = {};
let createAnswers: ({ kind: 'ok' } | { kind: 'drop' } | { kind: 'problem'; status: number; code: string; detail: string })[] = [];
let actionAnswers: ({ kind: 'ok'; applied?: boolean } | { kind: 'drop' } | { kind: 'problem'; status: number; code: string; detail: string })[] = [];
let grns: Record<string, unknown>[] = [];
let requests: { method: string; url: URL; body: unknown; key: string | null }[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function problem(answer: { status: number; code: string; detail: string }): Response {
  return json(answer.status, { code: answer.code, title: answer.detail, detail: answer.detail, status: answer.status });
}

function detailOf(id: string): Record<string, unknown> {
  const row = rows.find((r) => r.id === id) ?? entry(id, 'GI-0001');
  return {
    ...row,
    recordedBy: 'u-1',
    driverPhone: '9845012345',
    documents: [
      { id: 'd1', position: 0, kind: 'invoice', number: 'INV-77', documentDate: '2026-10-20', ewayBillNo: '123456789012', poId: PO, asnId: null, poCode: 'PO-1001', asnCode: null },
    ],
    receipts: [{ id: 'grn-1', code: 'GRN-0042', clientId: 'c-glow', document: { kind: 'po', code: 'PO-1001' } }],
    ...detailPatch,
  };
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();
    const base = `/api/v1/tenants/${T}`;
    let body: unknown = null;
    try {
      body = await request.clone().json();
    } catch {
      body = null;
    }
    requests.push({ method, url, body, key: request.headers.get('Idempotency-Key') });
    if (pathname === `${base}/warehouses`) {
      return json(200, {
        items: [
          { id: WH, code: 'BLR', name: 'Bengaluru DC' },
          { id: WH2, code: 'HYD', name: 'Hyderabad DC' },
        ],
        nextCursor: null,
      });
    }
    if (pathname === `${base}/clients`) {
      if (clientsMode === 'hang') return new Promise<Response>(() => undefined);
      return json(200, { items: [SELF, GLOW] });
    }
    if (pathname === `${base}/partners`) {
      if (transportersMode === 'fail') return json(500, { code: 'internal', title: 'Boom', status: 500, detail: 'partners down' });
      if (transportersMode === 'empty') return json(200, { items: [], nextCursor: null });
      return json(200, {
        items: [{ id: TRANSPORTER, code: 'TR-VRL', name: 'VRL Logistics', roles: ['transporter'], status: 'active', links: [] }],
        nextCursor: null,
      });
    }
    const gateIns = `${base}/receiving/gate-ins`;
    if (pathname === gateIns && method === 'GET') {
      if (url.searchParams.has('status')) return json(200, { items: countItems, nextCursor: countNextCursor });
      return json(200, { items: rows, nextCursor: null });
    }
    if (pathname === gateIns && method === 'POST') {
      const answer = createAnswers.shift() ?? { kind: 'ok' };
      if (answer.kind === 'drop') throw new TypeError('Failed to fetch');
      if (answer.kind === 'problem') return problem(answer);
      return json(201, { gateIn: { ...entry('g-new', 'GI-0009'), documents: [] } });
    }
    if (pathname.startsWith(`${gateIns}/`)) {
      const [id, verb] = pathname.slice(gateIns.length + 1).split('/');
      if (verb === undefined && method === 'GET') {
        if (detailMode === 'fail') return json(500, { code: 'internal', title: 'Boom', status: 500, detail: 'detail down' });
        return json(200, { gateIn: detailOf(id!) });
      }
      const answer = actionAnswers.shift() ?? { kind: 'ok' };
      if (answer.kind === 'drop') throw new TypeError('Failed to fetch');
      if (answer.kind === 'problem') return problem(answer);
      const row = rows.find((r) => r.id === id) ?? entry(id!, 'GI-0001');
      if (verb === 'unload') {
        return json(200, {
          applied: answer.applied ?? true,
          gateIn: { ...row, unloadStartedAt: '2026-10-21T04:10:00.000Z', unloadEndedAt: '2026-10-21T05:00:00.000Z', packagesCounted: 10, packagesDeclared: 12, documents: [] },
        });
      }
      if (verb === 'gate-out') return json(200, { gateIn: { ...row, status: 'gated_out', gatedOutAt: '2026-10-21T06:00:00.000Z', documents: [] } });
      if (method === 'PATCH') return json(200, { gateIn: { ...row, documents: [] } });
    }
    if (pathname.endsWith('/inbound/purchase-orders')) {
      if (url.searchParams.get('status') === 'open' && !url.searchParams.has('clientId')) {
        return json(200, {
          items: [
            {
              id: PO, tenantId: T, warehouseId: WH, vendorId: 'v-1', code: 'PO-1001', status: 'open', clientId: 'c-glow',
              vendorSnapshot: { v: 1, code: 'V-ACME', name: 'Acme Foods', legalName: null, gstin: null, stateCode: null, registeredAddress: null, dispatchAddress: null },
              createdAt: '2026-10-18T05:00:00.000Z', updatedAt: '2026-10-18T05:00:00.000Z', lines: [],
            },
          ],
          nextCursor: null,
        });
      }
      return json(200, { items: [], nextCursor: null });
    }
    if (pathname.endsWith('/inbound/asns')) return json(200, { items: [], nextCursor: null });
    if (pathname === `${base}/receiving/goods-receipts`) return json(200, { items: grns, nextCursor: null });
    if (pathname.endsWith('/inventory/stock')) return json(200, { items: [], nextCursor: null });
    if (pathname === `${base}/receiving/qc-holds`) return json(200, { items: [], nextCursor: null });
    if (pathname === `${base}/putaway/tasks`) return json(200, { items: [] });
    if (pathname === `${base}/catalog/skus` || pathname === `${base}/catalog/kits` || pathname === `${base}/users`) {
      return json(200, { items: [], nextCursor: null });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  rows = [
    entry(G1, 'GI-0001'),
    entry(G2, 'GI-0002', {
      status: 'unloaded',
      handDelivery: true,
      vehicleNo: null,
      sealStatus: 'broken',
      packagesDeclared: 12,
      packagesCounted: 10,
      packagesFlag: 'short',
      packagesDifference: 2,
      receiptCount: 2,
    }),
    entry(G3, 'GI-0003', { status: 'unloading', staleOpen: true, packagesDeclared: null, packagesCounted: 10 }),
    entry(G4, 'GI-0004', { status: 'gated_out', gatedOutAt: '2026-10-21T06:00:00.000Z' }),
  ];
  countItems = [{}, {}, {}];
  countNextCursor = null;
  clientsMode = 'ok';
  transportersMode = 'ok';
  detailMode = 'ok';
  detailPatch = {};
  createAnswers = [];
  actionAnswers = [];
  grns = [];
  requests = [];
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
  for (let i = 0; i < 14; i++) {
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

function click(target: HTMLElement): void {
  act(() => target.click());
}

function button(container: ParentNode, label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === label);
}

async function press(target: HTMLButtonElement | undefined): Promise<void> {
  expect(target).toBeDefined();
  await act(async () => {
    target!.click();
  });
  await settle();
}

async function mount(role: UserRole, initialTab: 'gate-ins' | 'grns' | null = 'gate-ins', activeClient: string | null = null): Promise<void> {
  writeSession(session(role));
  writeActiveWarehouseId(T, WH);
  if (activeClient !== null) writeActiveClientId(T, 'u-1', activeClient);
  view = render(<InboundCards initialTab={initialTab} />);
  await settle();
}

const card = () => view!.container.querySelector<HTMLElement>('[data-testid="gate-ins-card"]')!;
/** The `<tr>` of one gate-in. */
const row = (code: string) =>
  [...card().querySelectorAll('tbody tr')].find((tr) => tr.querySelector('td')?.textContent === code) as HTMLTableRowElement | undefined;
const rowButtons = (code: string) => [...row(code)!.querySelectorAll('button')].map((b) => b.textContent);
const recordForm = () => view!.container.querySelector<HTMLFormElement>('form[aria-label="Record a gate-in"]');
const field = <E extends Element>(scope: ParentNode, selector: string) => scope.querySelector<E>(selector)!;
const input = (scope: ParentNode, label: string) => field<HTMLInputElement>(scope, `input[aria-label="${label}"]`);
const select = (scope: ParentNode, label: string) => field<HTMLSelectElement>(scope, `select[aria-label="${label}"]`);
/** The writes: the creates (no suffix), or one verb's (`/unload`, `/gate-out`). */
const posts = (suffix = '') =>
  requests.filter(
    (r) => r.method !== 'GET' && r.url.pathname.includes('/receiving/gate-ins') && r.url.pathname.endsWith(suffix === '' ? '/receiving/gate-ins' : suffix),
  );
const listReads = () => requests.filter((r) => r.method === 'GET' && r.url.pathname.endsWith('/receiving/gate-ins') && !r.url.searchParams.has('status')).length;
const detailReads = () => requests.filter((r) => r.method === 'GET' && /\/receiving\/gate-ins\/[^/]+$/.test(r.url.pathname)).length;

describe('the Gate-in tab — reads', () => {
  test('Gate-in is the first tab, but the bare page still opens on Purchase orders (decision 9)', async () => {
    await mount('owner', null);
    const tabs = [...view!.container.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('data-tab'));
    expect(tabs[0]).toBe('gate-ins');
    expect(view!.container.querySelector('[role="tab"][aria-selected="true"]')!.getAttribute('data-tab')).toBe('pos');
    expect(view!.container.querySelector('[data-testid="gate-ins-card"]')).toBeNull();
  });

  test('the list chrome: Hand delivery, "2 short", Seal broken, Open > 7 days, no flag when undeclared, the masked phone, receipts', async () => {
    await mount('owner');
    expect(row('GI-0001')!.textContent).toContain('KA01AB1234');
    expect(row('GI-0002')!.textContent).toContain('Hand delivery');
    expect(card().querySelector('[data-testid="gate-in-packages-GI-0002"]')!.textContent).toBe('10 of 12 · 2 short');
    // Undeclared (decision 11): the count, and no flag.
    expect(card().querySelector('[data-testid="gate-in-packages-GI-0003"]')!.textContent).toBe('10 counted');
    // The badges render on exactly their rows.
    expect([...card().querySelectorAll('[data-testid="seal-broken"]')].map((b) => b.closest('tr') === row('GI-0002')!)).toEqual([true]);
    expect([...card().querySelectorAll('[data-testid="stale-open"]')].map((b) => b.closest('tr') === row('GI-0003')!)).toEqual([true]);
    expect(row('GI-0003')!.textContent).toContain('Open > 7 days');
    expect(row('GI-0001')!.textContent).toContain('98•••••345');
    expect(row('GI-0001')!.textContent).toContain('21 Oct 2026, 10:00');
    expect(row('GI-0002')!.textContent).toContain('Unloaded');
    expect(card().textContent).toContain('Gate-ins show every client — a truck can carry several.');
    // The list is read without a client and without a status.
    const read = requests.find((r) => r.method === 'GET' && r.url.pathname.endsWith('/receiving/gate-ins') && !r.url.searchParams.has('status'))!;
    expect(read.url.searchParams.get('warehouseId')).toBe(WH);
    expect(read.url.searchParams.has('clientId')).toBe(false);
  });

  test('the expanded row reads GET :id on expand only — documents with their PO, receipts with their client — and has its own failure', async () => {
    await mount('owner');
    expect(detailReads()).toBe(0);
    await press(button(row('GI-0001')!, 'GI-0001'));
    expect(detailReads()).toBe(1);
    const detail = card().querySelector('[data-testid="gate-in-detail-GI-0001"]')!;
    expect(detail.querySelector('[data-testid="gate-in-document"]')!.textContent).toContain('Invoice INV-77 · 2026-10-20 · EWB 123456789012 · PO-1001');
    expect(detail.querySelector('[data-testid="gate-in-receipt"]')!.textContent).toBe('GRN-0042 · PO PO-1001 · GlowCo');
    // A gate.manage holder reads the full phone in the detail.
    expect(detail.textContent).toContain('9845012345');

    detailMode = 'fail';
    await press(button(row('GI-0002')!, 'GI-0002'));
    expect(card().textContent).toContain('Gate-in details unavailable');
    detailMode = 'ok';
    await press(button(card(), 'Retry'));
    expect(card().querySelector('[data-testid="gate-in-detail-GI-0002"]')).not.toBeNull();
  });

  test('an accountant reads everything but is offered no Record button and no row action — and the phone stays masked', async () => {
    detailPatch = { driverPhone: '98•••••345' };
    await mount('accountant');
    expect(button(card(), 'Record a gate-in')).toBeUndefined();
    for (const code of ['GI-0001', 'GI-0002', 'GI-0003']) {
      expect(rowButtons(code)).toEqual([code]);
    }
    expect([...card().querySelectorAll('th')].map((th) => th.textContent)).not.toContain('Actions');
    await press(button(row('GI-0001')!, 'GI-0001'));
    const detail = card().querySelector('[data-testid="gate-in-detail-GI-0001"]')!;
    expect(detail.textContent).toContain('98•••••345');
    expect(detail.textContent).not.toContain('9845012345');
    // Refresh is a read — it stays.
    expect(button(card(), 'Refresh')).toBeDefined();
  });

  test('Refresh re-reads the list (a device unload appears on reload), and says so', async () => {
    await mount('operator');
    const before = listReads();
    expect(card().textContent).toContain('Unloads recorded on a handheld appear when the list is refreshed.');
    await press(button(card(), 'Refresh'));
    expect(listReads()).toBe(before + 1);
  });
});

describe('the tab count', () => {
  test('one multi-status read, no client — "N", or "N+" past the page', async () => {
    await mount('owner', null);
    const counts = requests.filter((r) => r.url.pathname.endsWith('/receiving/gate-ins') && r.url.searchParams.has('status'));
    expect(counts.length).toBe(1);
    expect(counts[0]!.url.searchParams.getAll('status')).toEqual(['gated_in', 'unloading', 'unloaded']);
    expect(counts[0]!.url.searchParams.get('limit')).toBe('200');
    expect(counts[0]!.url.searchParams.has('clientId')).toBe(false);
    expect(view!.container.querySelector('[data-testid="inbound-tab-count-gate-ins"]')!.textContent).toBe('3');
    view!.unmount();
    countNextCursor = 'more';
    await mount('owner', null);
    expect(view!.container.querySelector('[data-testid="inbound-tab-count-gate-ins"]')!.textContent).toBe('3+');
  });

  test('it renders while the client filter is pending — the client-filtered counts wait', async () => {
    clientsMode = 'hang';
    await mount('owner', null, 'c-glow');
    expect(view!.container.querySelector('[data-testid="inbound-tab-count-gate-ins"]')!.textContent).toBe('3');
    expect(view!.container.querySelector('[data-testid="inbound-tab-count-pos"]')).toBeNull();
  });
});

describe('Record a gate-in', () => {
  async function openRecord(): Promise<HTMLFormElement> {
    await press(button(card(), 'Record a gate-in'));
    expect(recordForm()).not.toBeNull();
    return recordForm()!;
  }

  /** The matrix gate-in: `ka-01.ab 1234`, TR-VRL, seal intact, a container, 12 declared, an invoice on PO-1001 and a bill of entry, dock D3. */
  function fillMatrixDraft(form: HTMLFormElement): void {
    setInput(input(form, 'Vehicle number'), 'ka-01.ab 1234');
    setInput(input(form, 'Container number'), 'MSKU1234567');
    setSelect(select(form, 'Transporter'), TRANSPORTER);
    setInput(input(form, 'Seal number'), 'S-991, C-12');
    setInput(input(form, 'Packages declared'), '12');
    setInput(input(form, 'Dock door'), 'D3');
    setInput(input(form, 'Document 1 number'), 'INV-77');
    setInput(input(form, 'Document 1 date'), '2026-01-15');
    setInput(input(form, 'Document 1 e-way bill'), '1234 5678 9012');
    setSelect(select(form, 'Document 1 PO or ASN'), `po:${PO}`);
    click(button(form, 'Add document')!);
    setSelect(select(form, 'Document 2 kind'), 'bill_of_entry');
    setInput(input(form, 'Document 2 number'), 'BE-1');
    setInput(input(form, 'Document 2 date'), '2026-01-14');
  }

  test('an operator records the matrix gate-in: the exact body, the key reused on a retry after a drop, a new key after an edit; the banner; the list re-reads', async () => {
    await mount('operator');
    const form = await openRecord();
    // The link options: the warehouse's open POs of every client, labelled.
    expect([...select(form, 'Document 1 PO or ASN').options].map((o) => o.textContent)).toContain('PO-1001 · Acme Foods · GlowCo');
    fillMatrixDraft(form);
    createAnswers = [{ kind: 'drop' }, { kind: 'ok' }];
    await press(button(form, 'Record gate-in'));
    expect(form.querySelector('[role="alert"]')!.textContent).toContain('unreachable');
    const first = posts()[0]!;
    expect(first.body).toEqual({
      warehouseId: WH,
      handDelivery: false,
      vehicleNo: 'KA01AB1234',
      containerNo: 'MSKU1234567',
      transporterPartnerId: TRANSPORTER,
      transporterName: null,
      lrNumber: null,
      driverName: null,
      driverPhone: null,
      sealStatus: 'intact',
      sealNumber: 'S-991, C-12',
      packagesDeclared: 12,
      dockDoor: 'D3',
      // The prefilled (untouched) time is not sent — the server stamps its now at save.
      documents: [
        { kind: 'invoice', number: 'INV-77', documentDate: '2026-01-15', ewayBillNo: '123456789012', poId: PO, asnId: null },
        { kind: 'bill_of_entry', number: 'BE-1', documentDate: '2026-01-14', ewayBillNo: null, poId: null, asnId: null },
      ],
    });
    // The retry of the unchanged draft replays: the same key.
    const before = listReads();
    await press(button(form, 'Record gate-in'));
    expect(posts().length).toBe(2);
    expect(posts()[1]!.key).toBe(first.key);
    expect(recordForm()).toBeNull();
    expect(card().textContent).toContain('GI-0009 recorded');
    expect(listReads()).toBeGreaterThan(before);
  });

  test('an edit after a refusal mints a new key; a bad field is named and nothing is sent', async () => {
    await mount('owner');
    const form = await openRecord();
    fillMatrixDraft(form);
    setInput(input(form, 'Document 1 e-way bill'), '12345678901');
    await press(button(form, 'Record gate-in'));
    expect(form.querySelector('[role="alert"]')!.textContent).toBe('Document 1: the e-way bill number is 12 digits (spaces are ignored).');
    expect(posts().length).toBe(0);
    setInput(input(form, 'Document 1 e-way bill'), '123456789012');
    createAnswers = [{ kind: 'problem', status: 409, code: 'document-warehouse-mismatch', detail: 'x' }];
    await press(button(form, 'Record gate-in'));
    expect(form.querySelector('[role="alert"]')!.textContent).toContain('another warehouse');
    const firstKey = posts()[0]!.key;
    setInput(input(form, 'Dock door'), 'D4');
    await press(button(form, 'Record gate-in'));
    expect(posts()[1]!.key).not.toBe(firstKey);
  });

  test('a hand delivery records with no vehicle; a typed transporter sends the name only', async () => {
    await mount('owner');
    const form = await openRecord();
    click(input(form, 'Hand delivery'));
    click(input(form, 'Not listed — type the name'));
    setInput(input(form, 'Transporter name'), 'Ravi Couriers');
    setSelect(select(form, 'Seal'), 'none');
    expect(form.querySelector('input[aria-label="Seal number"]')).toBeNull();
    await press(button(form, 'Record gate-in'));
    const sent = posts()[0]!.body as Record<string, unknown>;
    expect(sent.handDelivery).toBe(true);
    expect(sent.vehicleNo).toBeNull();
    expect(sent.transporterName).toBe('Ravi Couriers');
    expect(sent.transporterPartnerId).toBeNull();
    expect(sent.sealNumber).toBeNull();
    expect(sent.documents).toEqual([]);
  });

  test('the transporter picker: empty ("type the name"), failed (Retry), and re-read after a not-a-transporter refusal', async () => {
    transportersMode = 'empty';
    await mount('owner');
    let form = await openRecord();
    expect(form.textContent).toContain('No transporters in the master — type the name');
    click(button(form, 'Discard')!);
    view!.unmount();

    transportersMode = 'fail';
    await mount('owner');
    form = await openRecord();
    expect(form.textContent).toContain('Transporters unavailable');
    transportersMode = 'ok';
    await press(button(form, 'Retry'));
    expect(form.querySelector('select[aria-label="Transporter"]')).not.toBeNull();

    fillMatrixDraft(form);
    const partnerReads = () => requests.filter((r) => r.url.pathname.endsWith('/partners')).length;
    const before = partnerReads();
    createAnswers = [{ kind: 'problem', status: 409, code: 'partner-not-transporter', detail: 'x' }];
    await press(button(form, 'Record gate-in'));
    expect(form.querySelector('[role="alert"]')!.textContent).toBe('That partner is not a transporter — pick another, or type the name.');
    expect(partnerReads()).toBe(before + 1);
    expect(requests.filter((r) => r.url.pathname.endsWith('/partners')).at(-1)!.url.searchParams.get('role')).toBe('transporter');
  });

  test('document rows: Add is disabled at 20', async () => {
    await mount('owner');
    const form = await openRecord();
    for (let i = 1; i < 20; i++) click(button(form, 'Add document')!);
    expect(form.querySelectorAll('input[aria-label$=" number"][aria-label^="Document"]').length).toBe(20);
    expect(button(form, 'Add document')!.disabled).toBe(true);
  });
});

describe('row actions follow the state and send what they say', () => {
  test('Start only on gated_in; End on gated_in or unloading; Edit and Gate out on anything not gated_out', async () => {
    await mount('operator');
    expect(rowButtons('GI-0001')).toEqual(['GI-0001', 'Start unload', 'End unload', 'Edit', 'Gate out']);
    expect(rowButtons('GI-0003')).toEqual(['GI-0003', 'End unload', 'Edit', 'Gate out']);
    expect(rowButtons('GI-0002')).toEqual(['GI-0002', 'Edit', 'Gate out']);
    expect(rowButtons('GI-0004')).toEqual(['GI-0004']);
  });

  test('End unload: the count and time frozen in the confirmation; the retry reuses the key, an edited count mints a new one; applied: false is "Already recorded"', async () => {
    await mount('operator');
    await press(button(row('GI-0001')!, 'End unload'));
    const group = card().querySelector<HTMLElement>('[role="group"][aria-label="End unload GI-0001"]')!;
    // Nothing is sent until the count parses.
    expect(button(group, 'End unload')!.disabled).toBe(true);
    setInput(input(group, 'Packages counted'), '10');
    const time = input(group, 'End unload time (IST)').value;
    actionAnswers = [{ kind: 'drop' }, { kind: 'drop' }, { kind: 'ok', applied: false }];
    await press(button(group, 'End unload'));
    const first = posts('/unload')[0]!;
    expect(first.url.pathname).toBe(`/api/v1/tenants/${T}/receiving/gate-ins/${G1}/unload`);
    // The time left at its default is sent UNTRIMMED (the press's instant,
    // in the minute the field shows) — never the minute-truncated value.
    const sentAt = (first.body as { occurredAt: string }).occurredAt;
    expect(first.body).toEqual({ phase: 'end', occurredAt: sentAt, packagesCounted: 10 });
    expect(new Date(Math.floor(Date.parse(sentAt) / 60_000) * 60_000).toISOString()).toBe(istLocalToIso(time)!);
    await press(button(group, 'End unload'));
    expect(posts('/unload')[1]!.key).toBe(first.key);
    expect(posts('/unload')[1]!.body).toEqual(first.body);
    setInput(input(group, 'Packages counted'), '11');
    await press(button(group, 'End unload'));
    expect(posts('/unload')[2]!.key).not.toBe(first.key);
    expect((posts('/unload')[2]!.body as { packagesCounted: number }).packagesCounted).toBe(11);
    // applied: false — never a success.
    const banner = card().querySelector('[data-tone="warning"]')!;
    expect(banner.textContent).toContain('Already recorded at 21 Oct 2026, 10:30 IST');
    expect(card().textContent).not.toContain('Unload ended on');
  });

  test('an EDITED action time is sent as typed (read as IST)', async () => {
    await mount('owner');
    await press(button(row('GI-0001')!, 'Start unload'));
    const group = card().querySelector<HTMLElement>('[role="group"][aria-label="Start unload GI-0001"]')!;
    setInput(input(group, 'Start unload time (IST)'), '2026-10-21T09:41');
    await press(button(group, 'Start unload'));
    expect((posts('/unload')[0]!.body as { occurredAt: string }).occurredAt).toBe('2026-10-21T04:11:00.000Z');
  });

  test('Start unload sends the start phase; a success says so and re-reads the list', async () => {
    await mount('owner');
    await press(button(row('GI-0001')!, 'Start unload'));
    const group = card().querySelector<HTMLElement>('[role="group"][aria-label="Start unload GI-0001"]')!;
    const before = listReads();
    await press(button(group, 'Start unload'));
    const sent = posts('/unload')[0]!.body as Record<string, unknown>;
    expect(sent.phase).toBe('start');
    expect('packagesCounted' in sent).toBe(false);
    expect(card().textContent).toContain('Unload started on GI-0001');
    expect(listReads()).toBeGreaterThan(before);
  });

  test('Gate out confirms "Closes GI-x; no further edits."; a 409 gate-in-closed reads the mapped copy', async () => {
    await mount('owner');
    await press(button(row('GI-0002')!, 'Gate out'));
    const group = card().querySelector<HTMLElement>('[role="group"][aria-label="Gate out GI-0002"]')!;
    expect(group.textContent).toContain('Closes GI-0002; no further edits.');
    actionAnswers = [{ kind: 'problem', status: 409, code: 'gate-in-closed', detail: 'closed' }];
    await press(button(group, 'Gate out'));
    expect(posts('/gate-out')[0]!.url.pathname).toBe(`/api/v1/tenants/${T}/receiving/gate-ins/${G2}/gate-out`);
    expect(card().textContent).toContain('This gate-in is gated out — the visit is closed and takes no further edits.');
    await press(button(group, 'Gate out'));
    expect(card().textContent).toContain('GI-0002 gated out');
  });
});

describe('Edit — a full replacement', () => {
  test('the time is locked once unloading; every field is sent; a saved link that is no longer open still renders and is kept', async () => {
    // GI-0003 is unloading; its document covers a PO that is no longer open.
    const CLOSED_PO = '0198f7a2-1b3c-7d4e-8f90-0000000000f9';
    detailPatch = {
      documents: [
        { id: 'd1', position: 0, kind: 'invoice', number: 'INV-1', documentDate: '2026-01-10', ewayBillNo: null, poId: CLOSED_PO, asnId: null, poCode: 'PO-0999', asnCode: null },
      ],
    };
    await mount('owner');
    await press(button(row('GI-0003')!, 'Edit'));
    const form = card().querySelector<HTMLFormElement>('form[aria-label="Edit GI-0003"]')!;
    expect(input(form, 'Gated in at (IST)').disabled).toBe(true);
    expect(select(form, 'Document 1 PO or ASN').value).toBe(`po:${CLOSED_PO}`);
    expect(select(form, 'Document 1 PO or ASN').selectedOptions[0]!.textContent).toBe('PO-0999 (not open)');
    setInput(input(form, 'Dock door'), '');
    await press(button(form, 'Save'));
    const patch = requests.find((r) => r.method === 'PATCH')!;
    expect(patch.url.pathname).toBe(`/api/v1/tenants/${T}/receiving/gate-ins/${G3}`);
    const body = patch.body as Record<string, unknown>;
    expect(body.dockDoor).toBeNull();
    expect('gatedInAt' in body).toBe(false);
    expect('warehouseId' in body).toBe(false);
    expect(body.documents).toEqual([{ kind: 'invoice', number: 'INV-1', documentDate: '2026-01-10', ewayBillNo: null, poId: CLOSED_PO, asnId: null }]);
    expect(card().textContent).toContain('GI-0003 updated');
  });

  test('decision 16: once the unload ended, Edit locks the seal and the packages declared; a gate-in-field-locked refusal reads the mapped copy', async () => {
    detailPatch = { status: 'unloaded', unloadStartedAt: '2026-10-21T04:10:00.000Z', unloadEndedAt: '2026-10-21T05:00:00.000Z', packagesCounted: 10 };
    await mount('owner');
    await press(button(row('GI-0001')!, 'Edit'));
    const form = card().querySelector<HTMLFormElement>('form[aria-label="Edit GI-0001"]')!;
    expect(select(form, 'Seal').disabled).toBe(true);
    expect(input(form, 'Packages declared').disabled).toBe(true);
    expect(form.textContent).toContain('Seal and packages declared locked — the unload has ended.');
    expect(input(form, 'Dock door').disabled).toBe(false);
    actionAnswers = [{ kind: 'problem', status: 409, code: 'gate-in-field-locked', detail: 'x' }];
    await press(button(form, 'Save'));
    expect(form.querySelector('[role="alert"]')!.textContent).toBe('The seal and the packages declared are locked once the unload ends — leave them as recorded.');
  });

  test('before the unload ends, Edit leaves the seal and the packages declared open', async () => {
    await mount('owner');
    await press(button(row('GI-0001')!, 'Edit'));
    const form = card().querySelector<HTMLFormElement>('form[aria-label="Edit GI-0001"]')!;
    expect(select(form, 'Seal').disabled).toBe(false);
    expect(input(form, 'Packages declared').disabled).toBe(false);
  });

  test('a gate-in-time-locked refusal reads the mapped copy', async () => {
    await mount('owner');
    await press(button(row('GI-0001')!, 'Edit'));
    const form = card().querySelector<HTMLFormElement>('form[aria-label="Edit GI-0001"]')!;
    actionAnswers = [{ kind: 'problem', status: 409, code: 'gate-in-time-locked', detail: 'x' }];
    await press(button(form, 'Save'));
    expect(form.querySelector('[role="alert"]')!.textContent).toBe('The gated-in time is locked once the unload starts — leave it as recorded.');
  });
});

describe('a warehouse switch drops the open confirmation', () => {
  test('the confirmation belongs to the warehouse it opened in', async () => {
    await mount('owner');
    await press(button(row('GI-0001')!, 'Gate out'));
    expect(card().querySelector('[role="group"][aria-label="Gate out GI-0001"]')).not.toBeNull();
    await act(async () => {
      writeActiveWarehouseId(T, WH2);
    });
    await settle();
    expect(view!.container.querySelector('[role="group"][aria-label="Gate out GI-0001"]')).toBeNull();
  });
});

describe('Goods receipts — the Gate-in column', () => {
  test('a linked receipt reads GI-x · vehicle; an unlinked one "—"', async () => {
    grns = [
      { id: 'grn-1', tenantId: T, warehouseId: WH, code: 'GRN-0001', poId: null, blindReasonCode: 'other', status: 'recorded', lineCount: 1, totalUnits: 1, appliedUnits: 1, recordedAt: '2026-10-21T05:00:00.000Z', gateInId: G1, gateInCode: 'GI-0001', vehicleNo: 'KA01AB1234' },
      { id: 'grn-2', tenantId: T, warehouseId: WH, code: 'GRN-0002', poId: null, blindReasonCode: 'other', status: 'recorded', lineCount: 1, totalUnits: 1, appliedUnits: 1, recordedAt: '2026-10-21T05:00:00.000Z' },
    ];
    await mount('owner', 'grns');
    const grnRow = (code: string) => [...view!.container.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes(code))!;
    const headers = [...view!.container.querySelectorAll('th')].map((th) => th.textContent);
    const at = headers.indexOf('Gate-in');
    expect(at).toBeGreaterThan(-1);
    expect(grnRow('GRN-0001').querySelectorAll('td')[at]!.textContent).toBe('GI-0001 · KA01AB1234');
    expect(grnRow('GRN-0002').querySelectorAll('td')[at]!.textContent).toBe('—');
  });
});
