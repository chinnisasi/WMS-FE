import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { DEFAULT_DOCK_URL_STATE, type DockUrlState } from '../../lib/dock-schedule';
import { istInstantOf } from '../../lib/ist';
import type { UserRole } from '../../lib/users';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { writeActiveWarehouseId } from '../../lib/warehouses';
import { InboundCards } from './inbound-cards';

/**
 * Story 2-3b — Inbound → Dock schedule, driven through a stubbed global
 * `fetch` (the gates, wiring and wrappers under test are the ones that ship).
 * The web matrix rows and the claims a `src/lib` test cannot make:
 *   1. AC1 — book from an empty Day cell: the exact body and key; the block
 *      spans its two slots as "Booked"; the Week reads "10:30 DA-0001 ·
 *      Booked" on D3's row; a clash on D3 at 11:00 is refused, the clash named;
 *   2. AC2 — the drawer (`?open=`) shows the gate-in and "Arrived — late 20
 *      min"; the strip counts 1 late and on-time 0 %;
 *   3. a role without `dock.schedule` reads everything and is offered no
 *      Book, Reschedule or Cancel (absent, not disabled);
 *   4. Cancel and Reschedule send the verb they say; a write re-reads;
 *   5. the states: first use (no doors), a closed day, A6's off-schedule
 *      banner, a failed read with Retry, the view in the URL.
 */

const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WH = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';
const DOORS = ['D1', 'D2', 'D3', 'D4'].map((code, index) => ({
  id: `0198f7a2-1b3c-7d4e-8f90-00000000d00${index + 1}`,
  warehouseId: WH,
  code,
  name: null,
  active: true,
  createdBy: 'u-1',
  createdAt: '2029-12-01T00:00:00.000Z',
  updatedAt: '2029-12-01T00:00:00.000Z',
}));
const D3 = DOORS[2]!.id;
const PO = '0198f7a2-1b3c-7d4e-8f90-0000000000f1';
const A1 = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
/** A Tuesday, far enough ahead that no real clock makes its slots past. */
const TUESDAY = '2030-01-15';
const SATURDAY = '2030-01-19';
const SUNDAY = '2030-01-20';

const SCHEDULE = { warehouseId: WH, slotMinutes: 30, opensAt: '09:00', closesAt: '18:00', openDays: [1, 2, 3, 4, 5, 6], graceMinutes: 15, configured: false, updatedAt: null };
const EMPTY_SUMMARY = {
  scheduled: 0, pending: 0, arrived: 0, early: 0, onTime: 0, late: 0, noShow: 0, cancelled: 0,
  onTimeRate: null, bookedMinutes: 0, openMinutes: 0, utilisationRate: null, byDoor: [],
};

function session(role: UserRole): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: T, name: 'Priya Logistics', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  } as StoredSession;
}

function appointment(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: A1, tenantId: T, warehouseId: WH, code: 'DA-0001', status: 'booked', dockDoorId: D3, doorCode: 'D3',
    startsAt: istInstantOf(TUESDAY, 630), endsAt: istInstantOf(TUESDAY, 690), graceMinutes: 15, clientId: 'c-glow',
    vehicleNo: 'KA01AB1234', transporterName: null, note: null,
    documents: [{ kind: 'po', id: PO, code: 'PO-1001', clientId: 'c-glow', vendorName: 'Acme Foods' }],
    gateInId: null, gateInCode: null, gatedInAt: null, linkedAt: null, linkedBy: null, bookedBy: 'u-1',
    cancelledAt: null, cancelledBy: null, cancelReason: null, punctuality: null, punctualityMinutes: null, noShow: false,
    createdAt: '2029-12-01T00:00:00.000Z', updatedAt: '2029-12-01T00:00:00.000Z',
    ...patch,
  };
}

let doors: Record<string, unknown>[] = [];
let schedule: Record<string, unknown> = SCHEDULE;
let appointments: Record<string, unknown>[] = [];
let summary: Record<string, unknown> = EMPTY_SUMMARY;
let windowMode: 'ok' | 'fail' = 'ok';
let writeAnswers: ({ kind: 'ok'; appointment: Record<string, unknown> } | { kind: 'problem'; status: number; code: string; detail: string; extensions?: Record<string, unknown> })[] = [];
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
    if (pathname === `${base}/warehouses`) return json(200, { items: [{ id: WH, code: 'BLR-1', name: 'Bengaluru DC' }], nextCursor: null });
    if (pathname === `${base}/clients`) {
      return json(200, { items: [{ id: 'c-glow', code: 'GLOW', name: 'GlowCo', status: 'active', systemOwned: false }] });
    }
    if (pathname === `${base}/receiving/dock-schedule`) {
      if (windowMode === 'fail') return json(500, { code: 'internal', title: 'Boom', status: 500, detail: 'dock down' });
      return json(200, {
        // The server's clock: well before the fixture dates.
        asOf: '2030-01-14T04:00:00.000Z',
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
        schedule,
        doors,
        appointments: url.searchParams.get('includeCancelled') === 'true' ? appointments : appointments.filter((a) => a.status !== 'cancelled'),
        summary,
        truncated: false,
      });
    }
    const appointmentsBase = `${base}/receiving/dock-appointments`;
    if (pathname.startsWith(`${appointmentsBase}/`) && method === 'GET') {
      const id = pathname.slice(appointmentsBase.length + 1);
      const found = appointments.find((a) => a.id === id);
      return found === undefined ? json(404, { code: 'not-found', title: 'Nope', status: 404, detail: 'no such appointment' }) : json(200, { appointment: found });
    }
    if (pathname.startsWith(appointmentsBase) && method !== 'GET') {
      const answer = writeAnswers.shift();
      if (answer === undefined) return json(500, { code: 'internal', title: 'Unscripted write', status: 500 });
      if (answer.kind === 'problem') return json(answer.status, { code: answer.code, title: answer.detail, detail: answer.detail, status: answer.status, ...answer.extensions });
      // The calendar re-reads after a write: the new state is what it serves.
      appointments = [...appointments.filter((a) => a.id !== answer.appointment.id), answer.appointment];
      return json(method === 'POST' && pathname === appointmentsBase ? 201 : 200, { appointment: answer.appointment });
    }
    if (pathname.endsWith('/inbound/purchase-orders')) {
      return json(200, {
        items:
          url.searchParams.get('status') === 'open'
            ? [{ id: PO, tenantId: T, warehouseId: WH, vendorId: 'v', code: 'PO-1001', status: 'open', clientId: 'c-glow', vendorSnapshot: { name: 'Acme Foods' }, lines: [] }]
            : [],
        nextCursor: null,
      });
    }
    if (pathname.endsWith('/inbound/asns')) return json(200, { items: [], nextCursor: null });
    if (pathname === `${base}/receiving/gate-ins`) return json(200, { items: [], nextCursor: null });
    return json(200, { items: [], nextCursor: null });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;
/** The URLs the card wrote in place (`history.replaceState`), recorded rather than read back from the shared location. */
let urls: string[] = [];
let originalReplace: History['replaceState'];

beforeEach(() => {
  urls = [];
  originalReplace = window.history.replaceState;
  window.history.replaceState = ((_data: unknown, _unused: string, href?: string | URL | null) => {
    urls.push(String(href));
  }) as History['replaceState'];
  doors = DOORS;
  schedule = SCHEDULE;
  appointments = [];
  summary = EMPTY_SUMMARY;
  windowMode = 'ok';
  writeAnswers = [];
  requests = [];
  stubRouter();
});

afterEach(() => {
  window.history.replaceState = originalReplace;
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

async function mount(role: UserRole, dock: Partial<DockUrlState> = {}): Promise<void> {
  writeSession(session(role));
  writeActiveWarehouseId(T, WH);
  view = render(<InboundCards initialTab="dock" dock={{ ...DEFAULT_DOCK_URL_STATE, date: TUESDAY, ...dock }} />);
  await settle();
}

const card = () => view!.container.querySelector<HTMLElement>('[data-testid="dock-schedule-card"]')!;
const drawer = () => view!.container.querySelector<HTMLElement>('[data-testid="dock-drawer"]');
const buttonByText = (scope: ParentNode, text: string) => [...scope.querySelectorAll('button')].find((b) => b.textContent === text);
const buttonByLabel = (scope: ParentNode, label: string) => scope.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const writes = () => requests.filter((r) => r.method !== 'GET');
const windowReads = () => requests.filter((r) => r.method === 'GET' && r.url.pathname.endsWith('/receiving/dock-schedule'));

async function press(target: HTMLElement | null | undefined): Promise<void> {
  expect(target).toBeTruthy();
  await act(async () => {
    target!.click();
  });
  await settle();
}

function setSelect(select: HTMLSelectElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function setInput(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  act(() => {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('AC1 — plan: book from the Day view', () => {
  test('an empty cell books D3 10:30–11:30 against PO-1001: the exact body; the block spans two slots as "Booked"; the Week reads it on D3', async () => {
    await mount('ops_manager');
    // The read: one day, the warehouse, no cancelled.
    const first = windowReads()[0]!;
    expect(first.url.searchParams.get('from')).toBe(TUESDAY);
    expect(first.url.searchParams.get('to')).toBe(TUESDAY);
    expect(first.url.searchParams.has('includeCancelled')).toBe(false);
    const grid = card().querySelector<HTMLElement>('[data-testid="dock-day-grid"]')!;
    expect(grid.querySelectorAll('tbody tr').length).toBe(18);
    expect(grid.querySelectorAll('thead th').length).toBe(5);

    await press(buttonByLabel(grid, 'Book D3 at 10:30'));
    const form = drawer()!.querySelector<HTMLFormElement>('form[aria-label="Book a dock appointment"]')!;
    expect(form.querySelector<HTMLSelectElement>('select[aria-label="Start (IST)"]')!.value).toBe('630');
    expect(form.querySelector<HTMLSelectElement>('select[aria-label="Dock door"]')!.value).toBe(D3);
    setSelect(form.querySelector<HTMLSelectElement>('select[aria-label="Duration"]')!, '60');
    const po = [...form.querySelectorAll('label')].find((l) => l.textContent?.startsWith('PO-1001'))!;
    expect(po.textContent).toBe('PO-1001 · Acme Foods · GlowCo');
    act(() => po.querySelector('input')!.click());

    writeAnswers = [{ kind: 'ok', appointment: appointment() }];
    await press(buttonByText(form, 'Book appointment'));
    const post = writes()[0]!;
    expect(post.url.pathname).toBe(`/api/v1/tenants/${T}/receiving/dock-appointments`);
    expect(post.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(post.body).toEqual({
      warehouseId: WH,
      dockDoorId: D3,
      startsAt: '2030-01-15T05:00:00.000Z',
      endsAt: '2030-01-15T06:00:00.000Z',
      documents: [{ poId: PO }],
    });
    expect(card().textContent).toContain('DA-0001 booked');
    // The booked appointment opens in the drawer; the calendar re-read.
    expect(drawer()!.querySelector('h2')!.textContent).toBe('DA-0001');
    const block = card().querySelector<HTMLElement>('[data-testid="dock-block-DA-0001"]')!;
    expect(block.textContent).toContain('Booked');
    expect(block.closest('td')!.getAttribute('rowspan')).toBe('2');

    await press(buttonByText(card(), 'Week'));
    expect(windowReads().at(-1)!.url.searchParams.get('from')).toBe('2030-01-14');
    expect(windowReads().at(-1)!.url.searchParams.get('to')).toBe('2030-01-20');
    const d3Row = card().querySelector<HTMLElement>('[data-testid="dock-week-row-D3"]')!;
    expect(d3Row.textContent).toContain('10:30 DA-0001 · Booked');
    expect(urls.at(-1)).toBe(`/inbound?tab=dock&view=week&date=${TUESDAY}&open=${A1}`);
  });

  test('a second booking on D3 at 11:00 is refused with the clash named; the calendar re-reads', async () => {
    appointments = [appointment()];
    await mount('operator');
    // The 11:00 cell of D3 is covered by the block: book through "Book a slot".
    expect(buttonByLabel(card(), 'Book D3 at 11:00')).toBeNull();
    await press(buttonByText(card(), 'Book a slot'));
    const form = drawer()!.querySelector<HTMLFormElement>('form')!;
    setSelect(form.querySelector<HTMLSelectElement>('select[aria-label="Start (IST)"]')!, '660');
    setSelect(form.querySelector<HTMLSelectElement>('select[aria-label="Dock door"]')!, D3);
    expect(form.querySelector<HTMLSelectElement>('select[aria-label="Dock door"]')!.selectedOptions[0]!.textContent).toBe('D3 — busy');
    const before = windowReads().length;
    writeAnswers = [
      {
        kind: 'problem', status: 409, code: 'dock-slot-taken', detail: 'taken',
        extensions: { clash: { id: A1, code: 'DA-0001', startsAt: istInstantOf(TUESDAY, 630), endsAt: istInstantOf(TUESDAY, 690) } },
      },
    ];
    await press(buttonByText(form, 'Book appointment'));
    expect(form.querySelector('[role="alert"]')!.textContent).toBe('That door is taken — DA-0001 is booked 10:30–11:30 on Tue 15 Jan. Pick another door or time.');
    expect(windowReads().length).toBeGreaterThan(before);
    // The draft stays for another try.
    expect(drawer()).not.toBeNull();
  });
});

describe('AC2 — arrive: the drawer and the strip', () => {
  test('?open= shows GI-0001 and "Arrived — late 20 min"; the strip counts 1 late, on time 0 %', async () => {
    appointments = [
      appointment({
        status: 'arrived', gateInId: 'g1', gateInCode: 'GI-0001', gatedInAt: istInstantOf(TUESDAY, 650),
        linkedAt: istInstantOf(TUESDAY, 650), linkedBy: 'u-1', punctuality: 'late', punctualityMinutes: 20,
      }),
    ];
    summary = { ...EMPTY_SUMMARY, scheduled: 1, arrived: 1, late: 1, onTimeRate: 0, bookedMinutes: 60, openMinutes: 2160, utilisationRate: 2.8 };
    await mount('owner', { open: A1 });
    const detail = drawer()!;
    expect(detail.querySelector('[data-testid="dock-detail-chip"]')!.textContent).toEndWith('Arrived — late 20 min');
    expect(detail.querySelector('[data-testid="dock-detail-gate-in"]')!.textContent).toContain('GI-0001');
    // Arrived is closed: no Reschedule or Cancel, and it says why.
    expect(buttonByText(detail, 'Reschedule')).toBeUndefined();
    expect(detail.querySelector('[data-testid="dock-closed-note"]')!.textContent).toContain('has arrived');
    const strip = card().querySelector<HTMLElement>('[data-testid="dock-summary"]')!;
    expect(strip.textContent).toContain('1 arrived (0 on time, 0 early, 1 late)');
    expect(strip.textContent).toContain('On time 0 %');
    // Close returns the URL to the calendar.
    await press(buttonByLabel(detail, 'Close DA-0001'));
    expect(drawer()).toBeNull();
    expect(urls.at(-1)).toBe(`/inbound?tab=dock&date=${TUESDAY}`);
  });
});

describe('AC3 — the set-up shows in the Day view', () => {
  test('60-minute slots 06:00–22:00 Mon–Sun with D1–D4: sixteen rows for four doors, Sunday open', async () => {
    schedule = { ...SCHEDULE, slotMinutes: 60, opensAt: '06:00', closesAt: '22:00', openDays: [1, 2, 3, 4, 5, 6, 7], configured: true };
    await mount('owner', { date: SUNDAY });
    const grid = card().querySelector<HTMLElement>('[data-testid="dock-day-grid"]')!;
    expect(grid.querySelectorAll('tbody tr').length).toBe(16);
    expect([...grid.querySelectorAll('thead th')].slice(1).map((th) => th.textContent)).toEqual(['D1', 'D2', 'D3', 'D4']);
    expect(card().querySelector('[data-testid="dock-closed-day"]')).toBeNull();
  });
});

describe('roles', () => {
  test('an accountant reads the grid and the drawer but is offered no Book, Reschedule or Cancel — absent, not disabled', async () => {
    appointments = [appointment()];
    await mount('accountant');
    expect(card().querySelector('[data-testid="dock-block-DA-0001"]')).not.toBeNull();
    expect(buttonByText(card(), 'Book a slot')).toBeUndefined();
    expect(card().querySelectorAll('button[aria-label^="Book "]').length).toBe(0);
    await press(card().querySelector<HTMLElement>('[data-testid="dock-block-DA-0001"]'));
    expect(drawer()!.querySelector('h2')!.textContent).toBe('DA-0001');
    expect(buttonByText(drawer()!, 'Reschedule')).toBeUndefined();
    expect(buttonByText(drawer()!, 'Cancel appointment')).toBeUndefined();
    expect(writes().length).toBe(0);
  });
});

describe('Cancel and Reschedule send what they say', () => {
  test('Cancel: an inline confirmation with a reason POSTs /cancel; the banner says the slot is free', async () => {
    appointments = [appointment()];
    await mount('operator', { open: A1 });
    await press(buttonByText(drawer()!, 'Cancel appointment'));
    const group = drawer()!.querySelector<HTMLElement>('[role="group"][aria-label="Cancel DA-0001"]')!;
    const confirm = [...group.querySelectorAll('button')].find((b) => b.textContent === 'Cancel appointment')!;
    expect(confirm.disabled).toBe(true);
    setInput(group.querySelector<HTMLInputElement>('input[aria-label="Why is it cancelled?"]')!, ' Vendor postponed ');
    writeAnswers = [{ kind: 'ok', appointment: appointment({ status: 'cancelled', cancelledAt: '2030-01-14T05:00:00.000Z', cancelledBy: 'u-1', cancelReason: 'Vendor postponed' }) }];
    await press(confirm);
    const post = writes()[0]!;
    expect(post.method).toBe('POST');
    expect(post.url.pathname).toBe(`/api/v1/tenants/${T}/receiving/dock-appointments/${A1}/cancel`);
    expect(post.body).toEqual({ reason: 'Vendor postponed' });
    expect(post.key).not.toBeNull();
    expect(card().textContent).toContain('DA-0001 cancelled');
    expect(card().textContent).toContain('The slot on D3 is free again.');
  });

  test('Reschedule: a note edit PATCHes the full replacement with the stored window unchanged', async () => {
    appointments = [appointment()];
    await mount('owner', { open: A1 });
    await press(buttonByText(drawer()!, 'Reschedule'));
    const form = drawer()!.querySelector<HTMLFormElement>('form[aria-label="Reschedule DA-0001"]')!;
    setInput(form.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note"]')!, 'Call the gate');
    writeAnswers = [{ kind: 'ok', appointment: appointment({ note: 'Call the gate' }) }];
    await press(buttonByText(form, 'Save changes'));
    const patch = writes()[0]!;
    expect(patch.method).toBe('PATCH');
    expect(patch.url.pathname).toBe(`/api/v1/tenants/${T}/receiving/dock-appointments/${A1}`);
    expect(patch.body).toEqual({
      dockDoorId: D3,
      startsAt: '2030-01-15T05:00:00.000Z',
      endsAt: '2030-01-15T06:00:00.000Z',
      documents: [{ poId: PO }],
      vehicleNo: 'KA01AB1234',
      transporterName: null,
      note: 'Call the gate',
    });
    expect(card().textContent).toContain('DA-0001 saved');
  });

  test('a no-show offers no Reschedule or Cancel — "book a new appointment"', async () => {
    appointments = [appointment({ noShow: true })];
    await mount('owner', { open: A1 });
    expect(drawer()!.querySelector('[data-testid="dock-detail-chip"]')!.textContent).toEndWith('No-show');
    expect(buttonByText(drawer()!, 'Reschedule')).toBeUndefined();
    expect(drawer()!.textContent).toContain('book a new appointment instead');
  });
});

describe('states', () => {
  test('first use: no doors — the sentence and, for a door manager, the link to Settings', async () => {
    doors = [];
    await mount('owner');
    const empty = card().querySelector<HTMLElement>('[data-testid="dock-no-doors"]')!;
    expect(empty.textContent).toContain('No dock doors in BLR-1 — add them in Settings → Warehouses');
    expect(empty.querySelector('a')!.getAttribute('href')).toBe('/settings#dock-setup');
    expect(buttonByText(card(), 'Book a slot')).toBeUndefined();
  });

  test('a closed day with no booking: "Closed on Sunday", no grid', async () => {
    await mount('owner', { date: SUNDAY });
    expect(card().querySelector('[data-testid="dock-closed-day"]')!.textContent).toBe('Closed on Sunday');
    expect(card().querySelector('[data-testid="dock-day-grid"]')).toBeNull();
  });

  test('A6 — a Saturday booking after Saturday closed: the banner above the grid, and the block tagged Outside schedule', async () => {
    schedule = { ...SCHEDULE, openDays: [1, 2, 3, 4, 5] };
    appointments = [appointment({ startsAt: istInstantOf(SATURDAY, 600), endsAt: istInstantOf(SATURDAY, 660) })];
    await mount('owner', { date: SATURDAY });
    expect(card().querySelector('[data-testid="dock-closed-day"]')!.textContent).toContain('Closed on Saturday — 1 appointment booked before the change');
    const block = card().querySelector<HTMLElement>('[data-testid="dock-block-DA-0001"]')!;
    expect(block.textContent).toContain('Outside schedule');
    // Not bookable on a closed day.
    expect(card().querySelectorAll('button[aria-label^="Book "]').length).toBe(0);
  });

  test('a failed read: the reason and Retry, never an empty calendar', async () => {
    windowMode = 'fail';
    await mount('owner');
    expect(card().textContent).toContain('Dock schedule unavailable');
    windowMode = 'ok';
    await press(buttonByText(card(), 'Retry'));
    expect(card().querySelector('[data-testid="dock-day-grid"]')).not.toBeNull();
  });

  test('Refresh re-reads, keeping the calendar on screen; Show cancelled asks for them', async () => {
    await mount('owner');
    const before = windowReads().length;
    await press(buttonByText(card(), 'Refresh'));
    expect(windowReads().length).toBe(before + 1);
    expect(card().querySelector('[data-testid="dock-day-grid"]')).not.toBeNull();
    const toggle = [...card().querySelectorAll('label')].find((l) => l.textContent === 'Show cancelled')!.querySelector('input')!;
    await press(toggle);
    expect(windowReads().at(-1)!.url.searchParams.get('includeCancelled')).toBe('true');
    expect(urls.at(-1)).toBe(`/inbound?tab=dock&date=${TUESDAY}&cancelled=1`);
  });

  test('the Day grid is one tab stop with arrow-key movement', async () => {
    await mount('owner');
    const grid = card().querySelector<HTMLElement>('[data-testid="dock-day-grid"]')!;
    const stops = [...grid.querySelectorAll<HTMLElement>('[data-cell]')].filter((el) => el.tabIndex === 0);
    expect(stops.length).toBe(1);
    act(() => stops[0]!.focus());
    act(() => {
      stops[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toBe('Book D2 at 09:00');
    act(() => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toBe('Book D2 at 09:30');
  });
});
