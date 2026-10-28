import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import type { UserRole } from '../../lib/users';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { writeActiveWarehouseId } from '../../lib/warehouses';
import { DockSetupCard } from './dock-setup-card';

/**
 * Story 2-3b — Settings → Warehouses → "Dock doors and schedule" (AC3): an
 * ops manager adds D1–D4 and sets 60-minute slots 06:00–22:00 Mon–Sun — the
 * exact bodies, each with its key; "Using defaults — not yet saved" until a
 * schedule is stored; an operator reads the doors and the schedule and is
 * offered no Add door, Save, Edit or Deactivate (absent, not disabled); a
 * deactivation refused for booked appointments names them.
 */

const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WH = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';

function session(role: UserRole): StoredSession {
  return {
    token: 'header.payload.signature',
    tenant: { id: T, name: 'Priya Logistics', gstin: null },
    user: { id: 'u-1', email: 'priya@example.com', role, status: 'active' },
    expiresAt: Date.now() + 15 * 60_000,
  } as StoredSession;
}

const DEFAULTS = { warehouseId: WH, slotMinutes: 30, opensAt: '09:00', closesAt: '18:00', openDays: [1, 2, 3, 4, 5, 6], graceMinutes: 15, configured: false, updatedAt: null };

let doors: Record<string, unknown>[] = [];
let schedule: Record<string, unknown> = DEFAULTS;
let nextProblem: { status: number; code: string; detail: string; extensions?: Record<string, unknown> } | null = null;
let requests: { method: string; url: URL; body: unknown; key: string | null }[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function door(code: string, active = true): Record<string, unknown> {
  return { id: `door-${code}`, warehouseId: WH, code, name: null, active, createdBy: 'u-1', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' };
}

function stubRouter(): void {
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
    if (url.pathname === `${base}/warehouses`) return json(200, { items: [{ id: WH, code: 'BLR-1', name: 'Bengaluru DC' }], nextCursor: null });
    if (method !== 'GET' && nextProblem !== null) {
      const problem = nextProblem;
      nextProblem = null;
      return json(problem.status, { code: problem.code, title: problem.detail, detail: problem.detail, status: problem.status, ...problem.extensions });
    }
    const doorsPath = `${base}/warehouses/${WH}/dock-doors`;
    if (url.pathname === doorsPath && method === 'GET') return json(200, { items: doors });
    if (url.pathname === doorsPath && method === 'POST') {
      const created = door((body as { code: string }).code);
      doors = [...doors, created];
      return json(201, { dockDoor: created });
    }
    if (url.pathname.startsWith(`${doorsPath}/`) && method === 'PATCH') {
      const id = url.pathname.slice(doorsPath.length + 1);
      const patch = body as { code: string; name: string | null; active: boolean };
      doors = doors.map((d) => (d.id === id ? { ...d, ...patch } : d));
      return json(200, { dockDoor: doors.find((d) => d.id === id) });
    }
    const schedulePath = `${base}/warehouses/${WH}/dock-schedule`;
    if (url.pathname === schedulePath && method === 'GET') return json(200, { schedule });
    if (url.pathname === schedulePath && method === 'PUT') {
      schedule = { ...(body as object), warehouseId: WH, configured: true, updatedAt: '2026-10-28T05:00:00.000Z' };
      return json(200, { schedule });
    }
    return json(404, { code: 'not-found', title: 'Unrouted', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  doors = [];
  schedule = DEFAULTS;
  nextProblem = null;
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

async function mount(role: UserRole): Promise<void> {
  writeSession(session(role));
  writeActiveWarehouseId(T, WH);
  view = render(<DockSetupCard />);
  await settle();
}

const card = () => view!.container.querySelector<HTMLElement>('[data-testid="dock-setup-card"]')!;
const buttonByText = (scope: ParentNode, text: string) => [...scope.querySelectorAll('button')].find((b) => b.textContent === text);
const writes = () => requests.filter((r) => r.method !== 'GET');

async function press(target: HTMLElement | null | undefined): Promise<void> {
  expect(target).toBeTruthy();
  await act(async () => {
    target!.click();
  });
  await settle();
}

function setInput(input: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function setSelect(select: HTMLSelectElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('AC3 — set up', () => {
  test('an ops manager adds D1–D4 and saves 60-minute slots 06:00–22:00 Mon–Sun: the exact bodies, a key each', async () => {
    await mount('ops_manager');
    expect(card().querySelector('#dock-setup') ?? card()).toBeTruthy();
    expect(card().querySelector('[data-testid="dock-schedule-defaults"]')!.textContent).toBe('Using defaults — not yet saved');
    const add = card().querySelector<HTMLFormElement>('form[aria-label="Add a dock door"]')!;
    for (const code of ['d1', 'D2', ' d3 ', 'D4']) {
      setInput(add.querySelector<HTMLInputElement>('input[aria-label="Door code"]')!, code);
      await press(buttonByText(card().querySelector<HTMLFormElement>('form[aria-label="Add a dock door"]')!, 'Add door'));
    }
    const posts = writes().filter((w) => w.method === 'POST');
    expect(posts.map((p) => p.body)).toEqual([{ code: 'D1' }, { code: 'D2' }, { code: 'D3' }, { code: 'D4' }]);
    expect(new Set(posts.map((p) => p.key)).size).toBe(4);
    expect(card().querySelectorAll('tbody tr').length).toBe(4);
    expect(card().querySelector('[data-testid="dock-door-status-D3"]')!.textContent).toBe('Active');

    const form = card().querySelector<HTMLFormElement>('form[aria-label="Dock schedule"]')!;
    setSelect(form.querySelector<HTMLSelectElement>('select[aria-label="Slot length"]')!, '60');
    setSelect(form.querySelector<HTMLSelectElement>('select[aria-label="Opens at"]')!, '06:00');
    setSelect(form.querySelector<HTMLSelectElement>('select[aria-label="Closes at"]')!, '22:00');
    const sunday = buttonByText(form, 'Sun')!;
    expect(sunday.getAttribute('aria-pressed')).toBe('false');
    act(() => sunday.click());
    await press(buttonByText(form, 'Save schedule'));
    const put = writes().find((w) => w.method === 'PUT')!;
    expect(put.url.pathname).toBe(`/api/v1/tenants/${T}/warehouses/${WH}/dock-schedule`);
    expect(put.body).toEqual({ slotMinutes: 60, opensAt: '06:00', closesAt: '22:00', openDays: [1, 2, 3, 4, 5, 6, 7], graceMinutes: 15 });
    expect(put.key).not.toBeNull();
    expect(card().textContent).toContain('Dock schedule saved');
    expect(card().querySelector('[data-testid="dock-schedule-defaults"]')).toBeNull();
  });

  test('a bad schedule is named and nothing is sent; a bad door code too', async () => {
    await mount('owner');
    const form = card().querySelector<HTMLFormElement>('form[aria-label="Dock schedule"]')!;
    setSelect(form.querySelector<HTMLSelectElement>('select[aria-label="Opens at"]')!, '09:15');
    await press(buttonByText(form, 'Save schedule'));
    expect(form.querySelector('[role="alert"]')!.textContent).toBe('Opens at is on the 30-minute slot grid.');
    const add = card().querySelector<HTMLFormElement>('form[aria-label="Add a dock door"]')!;
    setInput(add.querySelector<HTMLInputElement>('input[aria-label="Door code"]')!, 'D 3');
    await press(buttonByText(add, 'Add door'));
    expect(add.querySelector('[role="alert"]')!.textContent).toContain('1–20 letters');
    expect(writes().length).toBe(0);
  });

  test('an operator reads the doors and the schedule but sees no Add door, Save, Edit or Deactivate', async () => {
    doors = [door('D1'), door('D2', false)];
    await mount('operator');
    expect(card().querySelectorAll('tbody tr').length).toBe(2);
    expect(card().querySelector('[data-testid="dock-door-status-D2"]')!.textContent).toBe('Inactive');
    expect(card().querySelector('form[aria-label="Add a dock door"]')).toBeNull();
    expect(card().querySelector('form[aria-label="Dock schedule"]')).toBeNull();
    expect(buttonByText(card(), 'Add door')).toBeUndefined();
    expect(buttonByText(card(), 'Save schedule')).toBeUndefined();
    expect(buttonByText(card(), 'Edit')).toBeUndefined();
    expect(buttonByText(card(), 'Deactivate')).toBeUndefined();
    expect(card().querySelector('[data-testid="dock-schedule-readonly"]')!.textContent).toContain('30 min slots · 09:00–18:00 · Mon–Sat · grace 15 min');
    expect(card().textContent).toContain('Using defaults — not yet saved');
  });

  test('Deactivate confirms inline and PATCHes the full door; a door with bookings to come is refused, naming them', async () => {
    doors = [door('D3')];
    await mount('owner');
    await press(buttonByText(card(), 'Deactivate'));
    const group = card().querySelector<HTMLElement>('[role="group"][aria-label="Deactivate D3"]')!;
    nextProblem = { status: 409, code: 'dock-door-has-appointments', detail: 'x', extensions: { appointmentCount: 1, firstAppointmentCode: 'DA-0001' } };
    await press(buttonByText(group, 'Deactivate'));
    const patch = writes()[0]!;
    expect(patch.method).toBe('PATCH');
    expect(patch.body).toEqual({ code: 'D3', name: null, active: false });
    expect(card().textContent).toContain('The door has 1 booked appointment still to come (first DA-0001)');
    // A fresh confirmation succeeds.
    await press(buttonByText(card(), 'Deactivate'));
    await press(buttonByText(card().querySelector<HTMLElement>('[role="group"][aria-label="Deactivate D3"]')!, 'Deactivate'));
    expect(card().querySelector('[data-testid="dock-door-status-D3"]')!.textContent).toBe('Inactive');
    expect(buttonByText(card(), 'Reactivate')).toBeDefined();
  });
});
