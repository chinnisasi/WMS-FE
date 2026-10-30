import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { writeActiveClientId } from '../../lib/active-client';
import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import type { ClientReturnDto } from '../../lib/api/generated';
import { RTC_DRAFT_WATERMARK, RTC_INVOICE_ADVICE, RTC_NOT_A_TAX_INVOICE, RTC_SUSPENDED_WARNING } from '../../lib/client-returns';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import {
  CLIENT,
  SKU_A,
  SKU_D,
  T,
  TRANSPORTER,
  WH,
  clientReturn,
  dispatchedClientReturn,
  glowClient,
  pickedClientReturn,
  rtcSummaryOf,
} from '../../lib/test/client-return-fixtures';
import type { UserRole } from '../../lib/users';
import { ClientReturnsCard } from './client-returns-card';

/**
 * Story 4-7c — Returns → To client, driven through a stubbed global `fetch`
 * (the gates, wiring and wrappers under test are the ones that ship). The
 * claims a `src/lib` test cannot make:
 *   1. an accountant reads the list and the detail but is offered no New,
 *      Cancel or Dispatch; an operator gets Dispatch on a picked return only;
 *      Print is everyone's;
 *   2. the note: `data-print-root` holds exactly the note; a draft prints
 *      under the watermark, grouped by RMA then DAMAGED; a dispatched one
 *      prints three copies with the consignee "Unregistered";
 *   3. Dispatch POSTs the body with no debit note (the field is not offered)
 *      and the consignee GSTIN; the A2 advice follows the GSTINs; a suspended
 *      client is warned (A8);
 *   4. a picked RTC's cancel names the staged units per area (A11) and POSTs
 *      the reason.
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

let rtcs: ClientReturnDto[] = [];
let clientStatus: 'active' | 'suspended' = 'active';
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
    if (pathname === `${base}/clients`) return json(200, { items: [SELF, glowClient({ status: clientStatus })] });
    if (pathname === `${base}/partners`) {
      return json(200, {
        items: [{ id: TRANSPORTER, tenantId: T, code: 'TR-VRL', name: 'VRL Logistics', legalName: null, gstin: null, pan: null, roles: ['transporter'], links: [], status: 'active' }],
        nextCursor: null,
      });
    }
    if (pathname === `${base}/catalog/skus`) {
      return json(200, {
        items: [
          { id: SKU_A, code: 'SKU-A', name: 'Almond butter 200g', uom: 'each', uomPrecision: 0, clientId: CLIENT, status: 'active' },
          { id: SKU_D, code: 'SKU-D', name: 'Dented tin', uom: 'each', uomPrecision: 0, clientId: CLIENT, status: 'active' },
        ],
        nextCursor: null,
      });
    }
    const rtcBase = `${base}/client-returns`;
    if (pathname === rtcBase && method === 'GET') {
      const status = url.searchParams.get('status');
      return json(200, { items: rtcs.filter((r) => status === null || r.status === status).map(rtcSummaryOf), nextCursor: null });
    }
    if (pathname.startsWith(`${rtcBase}/`)) {
      const [id, verb] = pathname.slice(rtcBase.length + 1).split('/');
      const found = rtcs.find((r) => r.id === id);
      if (found === undefined) return json(404, { code: 'not-found', status: 404 });
      if (verb === undefined) return json(200, found);
      const next: ClientReturnDto =
        verb === 'dispatch'
          ? { ...dispatchedClientReturn(), id: found.id, code: found.code }
          : { ...found, status: 'cancelled', cancellation: { by: 'u-1', byName: 'Priya', at: '2026-10-22T08:00:00.000Z', reason: String((body as { reason?: string }).reason) } };
      rtcs = rtcs.map((r) => (r.id === found.id ? next : r));
      return json(200, next);
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  rtcs = [clientReturn(), { ...pickedClientReturn(), id: '0198f7a2-1b3c-7d4e-8f90-0000000003f2', code: 'RTC-0002' }];
  clientStatus = 'active';
  requests = [];
  stubRouter();
  stubGlobal('print', () => undefined);
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

function setValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const buttons = (scope: ParentNode) => [...scope.querySelectorAll('button')];
const button = (scope: ParentNode, label: string) => buttons(scope).find((b) => b.textContent === label);

async function press(target: HTMLElement | undefined | null): Promise<void> {
  expect(target).toBeTruthy();
  await act(async () => {
    target!.click();
  });
  await settle();
}

async function mount(role: UserRole): Promise<void> {
  writeSession(session(role));
  writeActiveClientId(T, 'u-1', CLIENT);
  view = render(<ClientReturnsCard warehouseId={WH} warehouseLabel="BLR Bengaluru DC" />);
  await settle();
}

const card = () => view!.container.querySelector<HTMLElement>('[data-testid="client-returns-card"]')!;
const expand = async (code: string) => press(card().querySelector<HTMLButtonElement>(`button[aria-label="Show ${code}"]`));
const detail = (code: string) => card().querySelector<HTMLElement>(`[data-testid="rtc-detail-${code}"]`)!;
const writes = (suffix: string) => requests.filter((r) => r.method === 'POST' && r.url.pathname.endsWith(suffix));

describe('Returns to client — reads and gates', () => {
  test('lists the returns with their status for the warehouse and the active client', async () => {
    await mount('owner');
    expect(card().querySelector('[data-testid="rtc-status-RTC-0001"]')!.textContent).toBe('Draft — awaiting pick');
    expect(card().querySelector('[data-testid="rtc-status-RTC-0002"]')!.textContent).toBe('Picked — ready to dispatch');
    const read = requests.find((r) => r.method === 'GET' && r.url.pathname.endsWith('/client-returns'))!;
    expect(read.url.searchParams.get('warehouseId')).toBe(WH);
    expect(read.url.searchParams.get('clientId')).toBe(CLIENT);
  });

  test('an accountant reads but is offered no New, Cancel or Dispatch — Print only', async () => {
    await mount('accountant');
    expect(button(card(), 'New return to client')).toBeUndefined();
    await expand('RTC-0002');
    expect(button(detail('RTC-0002'), 'Dispatch')).toBeUndefined();
    expect(button(detail('RTC-0002'), 'Cancel return')).toBeUndefined();
    expect(button(detail('RTC-0002'), 'Print pick list')).toBeDefined();
  });

  test('an operator dispatches a picked return but creates and cancels nothing; a draft offers no Dispatch', async () => {
    await mount('operator');
    expect(button(card(), 'New return to client')).toBeUndefined();
    await expand('RTC-0002');
    expect(button(detail('RTC-0002'), 'Dispatch')).toBeDefined();
    expect(button(detail('RTC-0002'), 'Cancel return')).toBeUndefined();
    expect(detail('RTC-0002').querySelector('[data-testid="rtc-short-pick"]')!.textContent).toContain('raise a count for the RETURNS area');
  });

  test('a draft shows the handheld guidance and offers Cancel to the owner', async () => {
    await mount('owner');
    await expand('RTC-0001');
    expect(detail('RTC-0001').querySelector('[data-testid="rtc-pick-guidance"]')!.textContent).toContain('Returns out tab');
    expect(button(detail('RTC-0001'), 'Dispatch')).toBeUndefined();
    expect(button(detail('RTC-0001'), 'Cancel return')).toBeDefined();
  });
});

describe('Returns to client — the printable note', () => {
  test('a draft: data-print-root holds exactly the note, a pick list under the watermark, grouped by RMA then DAMAGED', async () => {
    await mount('owner');
    await expand('RTC-0001');
    const roots = view!.container.querySelectorAll('[data-print-root]');
    expect(roots).toHaveLength(1);
    const note = roots[0]!;
    expect(note.getAttribute('aria-label')).toBe('Dispatch note RTC-0001');
    expect(note.querySelector('[data-testid="note-watermark"]')!.textContent).toBe(RTC_DRAFT_WATERMARK);
    expect(note.querySelectorAll('button, input, select, textarea')).toHaveLength(0);
    expect(note.textContent).toContain('Return to Client — Dispatch Note');
    expect([...note.querySelectorAll('[data-testid="note-group"]')].map((g) => g.textContent)).toEqual(['RMA-0003 — customer return of order SHOP-1001', 'Damaged stock']);
    expect(note.querySelector('[data-testid="note-line-detail"]')!.textContent).toBe('received opened');
    expect(note.querySelector('[aria-label="Consignee"]')!.textContent).toContain('Return to GlowCo Consumer Pvt Ltd — return address');
  });

  test('dispatched: three copies, the consignee "Unregistered", the declared value by the consignor', async () => {
    rtcs = [dispatchedClientReturn()];
    await mount('owner');
    await expand('RTC-0001');
    const note = view!.container.querySelector('[data-print-root]')!;
    expect(note.querySelector('[data-testid="note-watermark"]')).toBeNull();
    expect([...note.querySelectorAll('[data-copy]')].map((c) => c.getAttribute('data-copy'))).toEqual(['Consignee copy', 'Transporter copy', 'Warehouse copy']);
    const first = note.querySelector('[data-copy]')!;
    expect(first.querySelector('[aria-label="Consignee"]')!.textContent).toContain('GSTIN: Unregistered');
    expect(first.querySelector('[aria-label="Consignment"]')!.textContent).toContain('declared by the consignor');
    expect(first.querySelector('[data-testid="note-footer"]')!.textContent).toBe(RTC_NOT_A_TAX_INVOICE);
    expect(button(detail('RTC-0001'), 'Print dispatch note')).toBeDefined();
  });
});

describe('Returns to client — dispatch and cancel', () => {
  test('Dispatch sends the capture with no debit note, the consignee GSTIN, and a per-draft key; the A2 advice follows the GSTINs', async () => {
    await mount('owner');
    await expand('RTC-0002');
    await press(button(detail('RTC-0002'), 'Dispatch'));
    const form = detail('RTC-0002').querySelector<HTMLFormElement>('form[aria-label="Dispatch RTC-0002 form"]')!;
    expect(form.textContent).not.toContain('Debit note');
    const docType = form.querySelector<HTMLSelectElement>('select')!;
    expect(docType.value).toBe('challan');
    const input = (label: string) => [...form.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label))!.control as HTMLInputElement;
    setValue(input('Consignee GSTIN'), '27AAACA1234A1Z5');
    await settle();
    expect(docType.value).toBe('invoice');
    expect(form.querySelector('[data-testid="rtc-document-advice"]')!.textContent).toContain(RTC_INVOICE_ADVICE);
    setValue(input('Document number'), 'INV-9');
    setValue(input('Packages'), '2');
    setValue(input('AWB / LR number'), '777');
    setValue(input('Declared value'), '12500.50');
    const transporter = [...form.querySelectorAll('label')].find((l) => l.textContent?.startsWith('Transporter'))!.control as HTMLSelectElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(transporter, TRANSPORTER);
      transporter.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
    const sent = writes('/dispatch');
    expect(sent).toHaveLength(1);
    const body = sent[0]!.body as Record<string, unknown>;
    expect(body['debitNoteNumber']).toBeUndefined();
    expect(body).toMatchObject({
      brandDocument: { type: 'invoice', number: 'INV-9' },
      consignorGstin: '29GLOWC1234G1Z5',
      consigneeGstin: '27AAACA1234A1Z5',
      declaredValuePaise: 1250050,
      transporterId: TRANSPORTER,
      trackingRef: '777',
      packageCount: 2,
    });
    expect(sent[0]!.key).not.toBeNull();
    expect(card().textContent).toContain('RTC-0002 dispatched');
  });

  test('A8 — a suspended client is warned at dispatch, never blocked', async () => {
    clientStatus = 'suspended';
    await mount('owner');
    await expand('RTC-0002');
    await press(button(detail('RTC-0002'), 'Dispatch'));
    expect(detail('RTC-0002').querySelector('[data-testid="rtc-suspended-warning"]')!.textContent).toContain(RTC_SUSPENDED_WARNING);
    expect(button(detail('RTC-0002'), 'Dispatch to client')).toBeDefined();
  });

  test('A11 — cancelling a picked return names the staged units per area, then POSTs the reason', async () => {
    await mount('owner');
    await expand('RTC-0002');
    await press(button(detail('RTC-0002'), 'Cancel return'));
    expect(detail('RTC-0002').querySelector('[data-testid="rtc-cancel-sentence"]')!.textContent).toContain(
      'Return the staged units to the Returns area (3) and the Damaged area (3)',
    );
    setValue(detail('RTC-0002').querySelector<HTMLInputElement>('input[aria-label="Cancel reason"]')!, 'brand changed its mind');
    await press(button(detail('RTC-0002'), 'Cancel this return'));
    const sent = writes('/cancel');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual({ reason: 'brand changed its mind' });
    expect(card().textContent).toContain('RTC-0002 cancelled');
  });
});

describe('code review — the New picker', () => {
  test('(d) an owner with no active client picks the client: the system-owned one is not offered, and the returnable read carries the picked client', async () => {
    writeSession(session('owner'));
    view = render(<ClientReturnsCard warehouseId={WH} warehouseLabel="BLR Bengaluru DC" />);
    await settle();
    await press(button(card(), 'New return to client'));
    const dialog = card().querySelector<HTMLElement>('[role="dialog"][aria-label="New return to client"]')!;
    const picker = [...dialog.querySelectorAll('label')].find((l) => l.textContent?.startsWith('Client'))!.control as HTMLSelectElement;
    const offered = [...picker.options].map((o) => o.value).filter((v) => v !== '');
    expect(offered).toEqual([CLIENT]);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(picker, CLIENT);
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    const read = requests.find((r) => r.method === 'GET' && r.url.pathname.endsWith(`/warehouses/${WH}/client-returns/returnable`));
    expect(read).toBeDefined();
    expect(read!.url.searchParams.get('clientId')).toBe(CLIENT);
  });

});
