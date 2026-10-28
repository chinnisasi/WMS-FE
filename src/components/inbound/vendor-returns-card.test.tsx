import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { writeActiveClientId } from '../../lib/active-client';
import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import type { VendorReturnDto } from '../../lib/api/generated';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import {
  CLIENT,
  RTV_ID,
  T,
  TRANSPORTER,
  VENDOR,
  VENDOR_PARTNER,
  WH,
  armA,
  armK,
  dispatchedReturn,
  pickedReturn,
  summaryOf,
  vendorReturn,
} from '../../lib/test/vendor-return-fixtures';
import type { UserRole } from '../../lib/users';
import { RTV_CANCEL_PICKED_INSTRUCTION, RTV_DRAFT_WATERMARK, RTV_NOT_A_TAX_INVOICE } from '../../lib/vendor-returns';
import { writeActiveWarehouseId } from '../../lib/warehouses';
import { InboundCards } from './inbound-cards';

/**
 * Story 2-8b — Inbound → Returns to vendor, driven through a stubbed global
 * `fetch` (the gates, wiring and wrappers under test are the ones that
 * ship). The claims a `src/lib` test cannot make:
 *   1. an accountant reads the list and the detail but is offered no New,
 *      Cancel or Dispatch (absent, not disabled); an operator gets Dispatch on
 *      a picked return only; Print is everyone's;
 *   2. a draft shows the handheld pick guidance; a picked return's cancel
 *      says to put the staged units back;
 *   3. the note: `data-print-root` holds exactly the note, a draft prints
 *      under the watermark, a dispatched one prints three copies of the
 *      frozen values;
 *   4. Create POSTs the exact body with a per-draft key (a retry of the same
 *      draft reuses it, an edit mints a new one), A16's empty state, A15's hint;
 *   5. Dispatch and Cancel send the verb they say, with the body;
 *   6. the tab count is the open (draft + picked) returns.
 */

function session(role: UserRole): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: T, name: 'Priya Logistics', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  } as StoredSession;
}

const SELF = { id: 'c-self', code: 'self', name: 'Priya Logistics', status: 'active', systemOwned: true };
const GLOW = { id: CLIENT, code: 'GLOW', name: 'GlowCo', status: 'active', systemOwned: false };

let rtvs: VendorReturnDto[] = [];
let arms = [armA(), armK()];
let truncated = false;
let writeAnswers: ({ kind: 'ok' } | { kind: 'drop' } | { kind: 'problem'; status: number; code: string; extensions?: Record<string, unknown> })[] = [];
let requests: { method: string; url: URL; body: unknown; key: string | null }[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
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
    if (pathname === `${base}/warehouses`) return json(200, { items: [{ id: WH, code: 'BLR', name: 'Bengaluru DC' }], nextCursor: null });
    if (pathname === `${base}/clients`) return json(200, { items: [SELF, GLOW] });
    if (pathname === `${base}/partners`) {
      if (url.searchParams.get('role') === 'transporter') {
        return json(200, { items: [{ ...VENDOR_PARTNER, id: TRANSPORTER, code: 'TR-VRL', name: 'VRL Logistics', roles: ['transporter'], links: [] }], nextCursor: null });
      }
      return json(200, { items: [VENDOR_PARTNER], nextCursor: null });
    }
    if (pathname === `${base}/warehouses/${WH}/vendor-returns/returnable`) {
      return json(200, { warehouseId: WH, clientId: url.searchParams.get('clientId'), truncated, arms });
    }
    const rtvBase = `${base}/vendor-returns`;
    if (pathname === rtvBase && method === 'GET') {
      const status = url.searchParams.get('status');
      return json(200, { items: rtvs.filter((r) => status === null || r.status === status).map(summaryOf), nextCursor: null });
    }
    if (pathname === rtvBase && method === 'POST') {
      const answer = writeAnswers.shift() ?? { kind: 'ok' };
      if (answer.kind === 'drop') throw new TypeError('Failed to fetch');
      if (answer.kind === 'problem') return json(answer.status, { code: answer.code, status: answer.status, title: 'x', detail: 'x', ...answer.extensions });
      const created = vendorReturn({ id: '0198f7a2-1b3c-7d4e-8f90-0000000000f9', code: 'RTV-0009' });
      rtvs = [created, ...rtvs];
      return json(201, created);
    }
    if (pathname.startsWith(`${rtvBase}/`)) {
      const [id, verb] = pathname.slice(rtvBase.length + 1).split('/');
      const found = rtvs.find((r) => r.id === id);
      if (found === undefined) return json(404, { code: 'not-found', status: 404 });
      if (verb === undefined) return json(200, found);
      const answer = writeAnswers.shift() ?? { kind: 'ok' };
      if (answer.kind === 'drop') throw new TypeError('Failed to fetch');
      if (answer.kind === 'problem') return json(answer.status, { code: answer.code, status: answer.status, title: 'x', detail: 'x', ...answer.extensions });
      const next: VendorReturnDto =
        verb === 'dispatch'
          ? { ...dispatchedReturn(), id: found.id }
          : { ...found, status: 'cancelled', cancellation: { by: 'u-1', byName: 'Priya', at: '2026-10-22T08:00:00.000Z', reason: String((body as { reason?: string }).reason) } };
      rtvs = rtvs.map((r) => (r.id === found.id ? next : r));
      return json(200, next);
    }
    if (pathname === `${base}/catalog/skus`) {
      return json(200, {
        items: [
          { id: armA().skuId, code: 'SKU-A', name: 'Almond butter 200g', uom: 'each', uomPrecision: 0, clientId: CLIENT, status: 'active' },
          { id: armK().skuId, code: 'SKU-K', name: 'Cashews loose', uom: 'kg', uomPrecision: 3, clientId: CLIENT, status: 'active' },
        ],
        nextCursor: null,
      });
    }
    if (pathname.endsWith('/inbound/purchase-orders') || pathname.endsWith('/inbound/asns') || pathname === `${base}/receiving/qc-holds`) {
      return json(200, { items: [], nextCursor: null });
    }
    if (pathname === `${base}/receiving/gate-ins` || pathname === `${base}/catalog/kits` || pathname === `${base}/users`) {
      return json(200, { items: [], nextCursor: null });
    }
    if (pathname === `${base}/putaway/tasks`) return json(200, { items: [] });
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;
let printed = 0;

beforeEach(() => {
  rtvs = [vendorReturn(), { ...pickedReturn(), id: '0198f7a2-1b3c-7d4e-8f90-0000000000f2', code: 'RTV-0002' }];
  arms = [armA(), armK()];
  truncated = false;
  writeAnswers = [];
  requests = [];
  printed = 0;
  stubRouter();
  stubGlobal('print', () => {
    printed += 1;
  });
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
  for (let i = 0; i < 16; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function setValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
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

const buttons = (scope: ParentNode) => [...scope.querySelectorAll('button')];
const button = (scope: ParentNode, label: string) => buttons(scope).find((b) => b.textContent === label);

async function press(target: HTMLElement | undefined): Promise<void> {
  expect(target).toBeDefined();
  await act(async () => {
    target!.click();
  });
  await settle();
}

async function submit(form: HTMLFormElement | null): Promise<void> {
  expect(form).not.toBeNull();
  await act(async () => {
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
}

async function mount(role: UserRole): Promise<void> {
  writeSession(session(role));
  writeActiveWarehouseId(T, WH);
  writeActiveClientId(T, 'u-1', CLIENT);
  view = render(<InboundCards initialTab="rtvs" />);
  await settle();
}

const card = () => view!.container.querySelector<HTMLElement>('[data-testid="vendor-returns-card"]')!;
const expand = async (code: string) => press(card().querySelector<HTMLButtonElement>(`button[aria-label="Show ${code}"]`)!);
const detail = (code: string) => card().querySelector<HTMLElement>(`[data-testid="rtv-detail-${code}"]`);
const writes = (suffix: string) => requests.filter((r) => r.method === 'POST' && r.url.pathname.endsWith(suffix));

describe('Returns to vendor — reads and gates', () => {
  test('the tab sits after QC holds, lists the returns with their status, and counts the open ones (draft + picked)', async () => {
    await mount('owner');
    const tabs = [...view!.container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(tabs.findIndex((t) => t?.startsWith('Returns to vendor'))).toBe(tabs.findIndex((t) => t?.startsWith('QC holds')) + 1);
    expect(card().querySelector('[data-testid="rtv-status-RTV-0001"]')!.textContent).toBe('Draft — awaiting pick');
    expect(card().querySelector('[data-testid="rtv-status-RTV-0002"]')!.textContent).toBe('Picked — ready to dispatch');
    const countReads = requests.filter((r) => r.method === 'GET' && r.url.pathname.endsWith('/vendor-returns') && r.url.searchParams.get('limit') === '100');
    expect(countReads.map((r) => r.url.searchParams.get('status')).sort()).toEqual(['draft', 'picked']);
    expect(countReads.every((r) => r.url.searchParams.get('clientId') === CLIENT)).toBe(true);
    expect(view!.container.querySelector('[data-testid="inbound-tab-count-rtvs"]')!.textContent).toBe('2');
  });

  test('the status filter narrows the list on the server', async () => {
    await mount('owner');
    await press(buttons(card()).find((b) => b.getAttribute('role') === 'tab' && b.textContent === 'Picked'));
    const last = requests.filter((r) => r.method === 'GET' && r.url.pathname.endsWith('/vendor-returns') && !r.url.searchParams.has('limit')).at(-1)!;
    expect(last.url.searchParams.get('status')).toBe('picked');
    expect(card().querySelector('[data-testid="rtv-status-RTV-0001"]')).toBeNull();
  });

  test('an accountant reads the list and the detail but is offered no New, Cancel or Dispatch — Print only', async () => {
    await mount('accountant');
    expect(button(card(), 'New return to vendor')).toBeUndefined();
    await expand('RTV-0002');
    const panel = detail('RTV-0002')!;
    expect(button(panel, 'Dispatch')).toBeUndefined();
    expect(button(panel, 'Cancel return')).toBeUndefined();
    expect(button(panel, 'Print pick list')).toBeDefined();
  });

  test('an operator dispatches a picked return but creates and cancels nothing', async () => {
    await mount('operator');
    expect(button(card(), 'New return to vendor')).toBeUndefined();
    await expand('RTV-0002');
    expect(button(detail('RTV-0002')!, 'Dispatch')).toBeDefined();
    expect(button(detail('RTV-0002')!, 'Cancel return')).toBeUndefined();
  });

  test('a draft shows the handheld guidance and offers Cancel, never Dispatch', async () => {
    await mount('owner');
    await expand('RTV-0001');
    const panel = detail('RTV-0001')!;
    expect(panel.querySelector('[data-testid="rtv-pick-guidance"]')!.textContent).toContain('Pick it on the handheld (Returns out tab)');
    expect(button(panel, 'Dispatch')).toBeUndefined();
    expect(button(panel, 'Cancel return')).toBeDefined();
  });
});

describe('Returns to vendor — the printable note', () => {
  test('a draft: data-print-root holds exactly the note, a pick list under the draft watermark; Print prints', async () => {
    await mount('owner');
    await expand('RTV-0001');
    const roots = view!.container.querySelectorAll('[data-print-root]');
    expect(roots).toHaveLength(1);
    const note = roots[0]!;
    expect(note.getAttribute('aria-label')).toBe('Dispatch note RTV-0001');
    expect(note.querySelector('[data-testid="note-watermark"]')!.textContent).toBe(RTV_DRAFT_WATERMARK);
    expect([...note.querySelectorAll('[data-copy]')].map((c) => c.getAttribute('data-copy'))).toEqual(['Pick list']);
    // Nothing interactive is inside the print root.
    expect(note.querySelectorAll('button, input, select, textarea')).toHaveLength(0);
    expect(note.textContent).toContain('Return to Vendor — Dispatch Note');
    // Each line at its unit's declared precision (the catalog names kg = 3).
    expect([...note.querySelectorAll('[data-testid="note-line"]')].map((r) => r.textContent)).toEqual([
      '1SKU-AAlmond butter 200g20081910B1Damaged5each ',
      '2SKU-KCashews loose——Failed quality check1.250kg ',
    ]);
    await press(button(detail('RTV-0001')!, 'Print pick list'));
    expect(printed).toBe(1);
  });

  test('dispatched: three copies of the frozen values — consignor GSTIN as dispatched, the operator, the vendor GSTIN and state, the capture', async () => {
    rtvs = [dispatchedReturn()];
    await mount('owner');
    await expand('RTV-0001');
    const note = view!.container.querySelector('[data-print-root]')!;
    expect(note.querySelector('[data-testid="note-watermark"]')).toBeNull();
    const copies = [...note.querySelectorAll('[data-copy]')];
    expect(copies.map((c) => c.getAttribute('data-copy'))).toEqual(['Vendor copy', 'Transporter copy', 'Warehouse copy']);
    // The second and third copies print only.
    expect(copies[1]!.className).toContain('hidden');
    const first = copies[0]!;
    expect(first.querySelector('[aria-label="Consignor"]')!.textContent).toContain('29GLOWC1234G1Z5');
    const from = first.querySelector('[aria-label="Dispatched from"]')!.textContent!;
    expect(from).toContain('Dispatched from — operated by Priya Logistics');
    expect(from).not.toContain('GSTIN');
    const to = first.querySelector('[aria-label="Consignee"]')!.textContent!;
    expect(to).toContain('27AAACA1234A1Z5');
    expect(to).toContain('State code: 27 Maharashtra');
    expect(to).toContain('1 Mill Road');
    const consignment = first.querySelector('[aria-label="Consignment"]')!.textContent!;
    expect(consignment).toContain('Delivery challan CH-77');
    expect(consignment).toContain('123456789012');
    expect(consignment).toContain('VRL Logistics (TR-VRL)');
    expect(consignment).toContain('AWB1234');
    // Only the shipped line prints.
    expect(first.querySelectorAll('[data-testid="note-line"]')).toHaveLength(1);
    expect(first.querySelector('[data-testid="note-footer"]')!.textContent).toBe(RTV_NOT_A_TAX_INVOICE);
    expect(button(detail('RTV-0001')!, 'Print dispatch note')).toBeDefined();
  });
});

describe('Returns to vendor — a cancelled print', () => {
  test('a cancelled return prints under the CANCELLED watermark, never the draft one', async () => {
    rtvs = [{ ...vendorReturn(), status: 'cancelled', cancellation: { by: 'u-1', byName: 'Priya', at: '2026-10-22T08:00:00.000Z', reason: 'dup' } }];
    await mount('owner');
    await expand('RTV-0001');
    const note = view!.container.querySelector('[data-print-root]')!;
    expect(note.querySelector('[data-testid="note-watermark"]')!.textContent).toBe('CANCELLED — not dispatched');
    expect(note.textContent).not.toContain('DRAFT');
    expect(button(detail('RTV-0001')!, 'Print cancelled return')).toBeDefined();
    expect(button(detail('RTV-0001')!, 'Cancel return')).toBeUndefined();
  });
});

describe('Returns to vendor — create', () => {
  test('A16 — an empty returnable list says how units reach DAMAGED; A15 — a truncated read hints to filter by SKU', async () => {
    arms = [];
    await mount('owner');
    await press(button(card(), 'New return to vendor'));
    const dialog = card().querySelector<HTMLElement>('[role="dialog"][aria-label="New return to vendor"]')!;
    expect(dialog.querySelector('[data-testid="empty-state"]')!.textContent).toContain('manual QC hold');
    view!.unmount();
    arms = [armA()];
    truncated = true;
    await mount('owner');
    await press(button(card(), 'New return to vendor'));
    expect(card().textContent).toContain('filter by SKU');
  });

  test('the vendor lacking a dispatch address: that kind is disabled and the registered one chosen (A7)', async () => {
    await mount('owner');
    await press(button(card(), 'New return to vendor'));
    const dialog = card().querySelector<HTMLElement>('[role="dialog"]')!;
    const vendorSelect = [...dialog.querySelectorAll<HTMLSelectElement>('select')].find((s) => [...s.options].some((o) => o.value === VENDOR))!;
    setSelect(vendorSelect, VENDOR);
    await settle();
    expect(dialog.querySelector<HTMLInputElement>('input[aria-label="Dispatch address"]')!.disabled).toBe(true);
    expect(dialog.querySelector<HTMLInputElement>('input[aria-label="Registered address"]')!.checked).toBe(true);
  });

  test('Create POSTs the exact body; a retry of the same draft reuses the key, an edit mints a new one; success shows the code', async () => {
    await mount('owner');
    await press(button(card(), 'New return to vendor'));
    const dialog = () => card().querySelector<HTMLElement>('[role="dialog"][aria-label="New return to vendor"]')!;
    const vendorSelect = [...dialog().querySelectorAll<HTMLSelectElement>('select')].find((s) => [...s.options].some((o) => o.value === VENDOR))!;
    setSelect(vendorSelect, VENDOR);
    await settle();
    // The PO source of Acme is the default (A5); its reason "Damaged".
    expect(dialog().querySelector<HTMLSelectElement>('select[aria-label="Source SKU-A batch B1"]')!.value).toBe(armA().sources[0]!.grnLineId);
    setValue(dialog().querySelector<HTMLInputElement>('input[aria-label="Return quantity SKU-A batch B1"]')!, '4');
    await settle();
    writeAnswers = [{ kind: 'drop' }];
    await submit(card().querySelector<HTMLFormElement>('form[aria-label="New return to vendor form"]'));
    expect(card().textContent).toContain('is wms-be running?');
    await submit(card().querySelector<HTMLFormElement>('form[aria-label="New return to vendor form"]'));
    const creates = writes('/vendor-returns');
    expect(creates).toHaveLength(2);
    expect(creates[0]!.key).toBe(creates[1]!.key!);
    expect(creates[1]!.body).toEqual({
      warehouseId: WH,
      vendorId: VENDOR,
      consigneeAddress: 'registered',
      lines: [{ skuId: armA().skuId, batchId: armA().batchId, grnLineId: armA().sources[0]!.grnLineId, quantity: 4, reasonCode: 'damaged' }],
    });
    expect(card().textContent).toContain('RTV-0009 created');
    expect(card().querySelector('[role="dialog"][aria-label="New return to vendor"]')).toBeNull();
  });

  test('an edit after a refusal mints a new key; the pool cap is checked before anything is sent', async () => {
    await mount('owner');
    await press(button(card(), 'New return to vendor'));
    const dialog = () => card().querySelector<HTMLElement>('[role="dialog"][aria-label="New return to vendor"]')!;
    const vendorSelect = [...dialog().querySelectorAll<HTMLSelectElement>('select')].find((s) => [...s.options].some((o) => o.value === VENDOR))!;
    setSelect(vendorSelect, VENDOR);
    await settle();
    const qty = () => dialog().querySelector<HTMLInputElement>('input[aria-label="Return quantity SKU-A batch B1"]')!;
    setValue(qty(), '7');
    await submit(card().querySelector<HTMLFormElement>('form[aria-label="New return to vendor form"]'));
    expect(writes('/vendor-returns')).toHaveLength(0);
    expect(card().textContent).toContain('at most 6 each can go back');
    setValue(qty(), '3');
    writeAnswers = [{ kind: 'problem', status: 409, code: 'rtv-exceeds-damaged', extensions: { onHandQty: 10, claimedQty: 8, availableQty: 2, requestedQty: 3 } }];
    await submit(card().querySelector<HTMLFormElement>('form[aria-label="New return to vendor form"]'));
    expect(card().textContent).toContain('at most 2 can go on a new return (asked 3)');
    setValue(qty(), '2');
    await submit(card().querySelector<HTMLFormElement>('form[aria-label="New return to vendor form"]'));
    const creates = writes('/vendor-returns');
    expect(creates).toHaveLength(2);
    expect(creates[0]!.key).not.toBe(creates[1]!.key);
  });
});

describe('Returns to vendor — dispatch and cancel', () => {
  test('Dispatch POSTs the capture to /dispatch; the threshold rule is stated; a wrong-state consignor GSTIN warns', async () => {
    await mount('owner');
    await expand('RTV-0002');
    await press(button(detail('RTV-0002')!, 'Dispatch'));
    const dialog = () => detail('RTV-0002')!.querySelector<HTMLElement>('[role="dialog"][aria-label="Dispatch RTV-0002"]')!;
    expect(dialog().querySelector('[data-testid="eway-threshold-hint"]')!.textContent).toContain('cannot judge the ₹50,000 threshold');
    const field = (label: string) => {
      const forId = [...dialog().querySelectorAll('label')].find((l) => l.textContent === label)!.getAttribute('for')!;
      return dialog().querySelector<HTMLInputElement>(`#${CSS.escape(forId)}`)!;
    };
    expect(field('Consignor GSTIN').value).toBe('29GLOWC1234G1Z5');
    // Nothing sent while the draft does not parse; the field is marked.
    await submit(dialog().querySelector('form'));
    expect(writes('/dispatch')).toHaveLength(0);
    expect(field('Document number').getAttribute('aria-invalid')).toBe('true');
    setValue(field('Document number'), 'CH-77');
    setValue(field('Consignor GSTIN'), '27GLOWC1234G1Z5');
    await settle();
    expect(dialog().textContent).toContain('registered in Maharashtra, but the goods leave from Karnataka');
    setValue(field('Consignor GSTIN'), '29GLOWC1234G1Z5');
    setSelect(dialog().querySelector<HTMLSelectElement>(`#${CSS.escape([...dialog().querySelectorAll('label')].find((l) => l.textContent === 'Transporter')!.getAttribute('for')!)}`)!, TRANSPORTER);
    setValue(field('AWB / LR number'), ' AWB1234 ');
    setValue(field('Packages'), '1');
    await submit(dialog().querySelector('form'));
    const sent = writes('/dispatch');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url.pathname).toContain('0198f7a2-1b3c-7d4e-8f90-0000000000f2');
    expect(sent[0]!.key).not.toBeNull();
    expect(sent[0]!.body).toMatchObject({
      brandDocument: { type: 'challan', number: 'CH-77' },
      consignorGstin: '29GLOWC1234G1Z5',
      transporterId: TRANSPORTER,
      trackingRef: 'AWB1234',
      packageCount: 1,
    });
    expect(card().textContent).toContain('RTV-0001 dispatched');
  });

  test("Cancel of a picked return says to put the staged units back, needs a reason and POSTs it to /cancel", async () => {
    await mount('owner');
    await expand('RTV-0002');
    await press(button(detail('RTV-0002')!, 'Cancel return'));
    const group = detail('RTV-0002')!.querySelector<HTMLElement>('[role="group"][aria-label="Cancel RTV-0002"]')!;
    expect(group.querySelector('[data-testid="rtv-cancel-sentence"]')!.textContent).toContain(RTV_CANCEL_PICKED_INSTRUCTION);
    await press(button(group, 'Cancel this return'));
    expect(writes('/cancel')).toHaveLength(0);
    expect(group.textContent).toContain('Say why');
    setValue(group.querySelector<HTMLInputElement>('input[aria-label="Cancel reason"]')!, 'vendor will collect');
    await press(button(group, 'Cancel this return'));
    expect(writes('/cancel')).toHaveLength(1);
    expect(writes('/cancel')[0]!.body).toEqual({ reason: 'vendor will collect' });
    expect(card().textContent).toContain('RTV-0002 cancelled');
    expect(card().textContent).toContain(RTV_CANCEL_PICKED_INSTRUCTION);
  });

  test('a stale cancel (rtv-closed) names the status and re-reads', async () => {
    await mount('owner');
    await expand('RTV-0001');
    await press(button(detail('RTV-0001')!, 'Cancel return'));
    const group = detail('RTV-0001')!.querySelector<HTMLElement>('[role="group"]')!;
    setValue(group.querySelector<HTMLInputElement>('input[aria-label="Cancel reason"]')!, 'dup');
    writeAnswers = [{ kind: 'problem', status: 409, code: 'rtv-closed', extensions: { rtvStatus: 'dispatched' } }];
    const reads = requests.filter((r) => r.method === 'GET' && r.url.pathname.endsWith(RTV_ID)).length;
    await press(button(group, 'Cancel this return'));
    expect(card().textContent).toContain('Not cancelled');
    expect(card().textContent).toContain('dispatched');
    expect(requests.filter((r) => r.method === 'GET' && r.url.pathname.endsWith(RTV_ID)).length).toBeGreaterThan(reads);
  });
});
