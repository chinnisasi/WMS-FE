import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { ClientService } from './client-service';

/**
 * Story 21-8 — the operator `/reports` "Client service" section, driven
 * through a stubbed global `fetch`:
 *   - the default period goes out as the last 30 IST days;
 *   - changing the client, the period or the warehouse refetches with it;
 *   - a suspended client is selectable (and reported on);
 *   - a period the server would refuse is never sent;
 *   - null renders "No data"; the 503 copy.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const SELF = '0198f7a2-1b3c-7d4e-8f90-cccccccccc00';
const BRAND_A = '0198f7a2-1b3c-7d4e-8f90-cccccccccc0a';
const BRAND_B = '0198f7a2-1b3c-7d4e-8f90-cccccccccc0b';
const W1 = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
const W2 = '0198f7a2-1b3c-7d4e-8f90-0000000000a2';

const SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Three PL Co', gstin: null },
  user: { id: 'u-1', email: 'ops@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

function client(id: string, code: string, name: string, status: 'active' | 'suspended', systemOwned = false) {
  return {
    id,
    tenantId: TENANT_ID,
    code,
    name,
    status,
    systemOwned,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    taxDetails: { gstin: null, legalName: null, stateCode: null, address: null },
  };
}

function warehouse(id: string, name: string) {
  return { id, tenantId: TENANT_ID, code: name.toUpperCase(), name, origin: null, gstin: null, createdAt: '2026-01-01T00:00:00.000Z' };
}

const REPORT = {
  from: '2026-09-11',
  to: '2026-10-10',
  warehouseId: null,
  asOf: '2026-10-10T04:30:00.000Z',
  targetHours: 24,
  dockToStock: { medianMinutes: null, placements: 0 },
  pickAccuracy: { accuracy: 0.9375, linesDispatched: 16, linesShortPicked: 1, packFailures: 2, packFailuresCountingSince: null },
  dispatchTimeliness: { ordersDispatched: 5, onTime: 4, onTimeRate: 0.8, medianMinutes: 600, lateNotDispatched: 3 },
};

let urls: string[] = [];
let serviceReply: [number, unknown] = [200, REPORT];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let view: Rendered | undefined;

beforeEach(() => {
  urls = [];
  serviceReply = [200, REPORT];
  writeSession(SESSION);
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname, search } = new URL(request.url);
    urls.push(`${pathname}${search}`);
    if (pathname.endsWith('/clients')) {
      return json(200, {
        items: [
          client(SELF, 'self', 'Three PL Co', 'active', true),
          client(BRAND_A, 'BRAND-A', 'Brand A', 'active'),
          client(BRAND_B, 'BRAND-B', 'Brand B', 'suspended'),
        ],
      });
    }
    if (pathname.endsWith('/warehouses')) return json(200, { items: [warehouse(W1, 'Main'), warehouse(W2, 'North')], nextCursor: null });
    if (pathname.endsWith('/service')) return json(serviceReply[0], serviceReply[1]);
    return json(200, { items: [], nextCursor: null });
  }) as unknown as typeof fetch);
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

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

const serviceUrls = () => urls.filter((url) => url.endsWith('/service') || url.includes('/service?'));
const lastService = () => new URL(`http://x${serviceUrls().at(-1)!}`);

async function open(): Promise<HTMLElement> {
  view = render(<ClientService />);
  await settle();
  return view.container;
}

describe('ClientService (21-8)', () => {
  test('the first client, the default 30-day IST period and every warehouse go out; null reads "No data"', async () => {
    const container = await open();
    expect(serviceUrls()).toHaveLength(1);
    const url = lastService();
    expect(url.pathname).toBe(`/api/v1/tenants/${TENANT_ID}/reporting/clients/${SELF}/service`);
    const from = (container.querySelector('[aria-label="Report from"]') as HTMLInputElement).value;
    const to = (container.querySelector('[aria-label="Report to"]') as HTMLInputElement).value;
    expect(url.searchParams.get('from')).toBe(from);
    expect(url.searchParams.get('to')).toBe(to);
    expect((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000).toBe(29);
    expect(url.searchParams.has('warehouseId')).toBe(false);
    const tiles = [...container.querySelectorAll('[role="group"]')].map((tile) => tile.getAttribute('aria-label'));
    expect(tiles).toEqual(['Dock-to-stock (median): No data', 'Pick accuracy: 93.8%', 'Dispatched within 24 h: 80%']);
    expect(container.textContent).toContain('16 lines dispatched · 1 short-picked');
    expect(container.textContent).toContain('3 orders late, not yet dispatched');
  });

  test('a suspended client is offered and reported on; the tenant’s own reads as the company', async () => {
    const container = await open();
    const select = container.querySelector('[aria-label="Report client"]') as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'Three PL Co (your company)',
      'BRAND-A — Brand A',
      'BRAND-B — Brand B (suspended)',
    ]);
    setValue(select, BRAND_B);
    await settle();
    expect(lastService().pathname).toBe(`/api/v1/tenants/${TENANT_ID}/reporting/clients/${BRAND_B}/service`);
  });

  test('changing the client, the period or the warehouse refetches with it', async () => {
    const container = await open();
    setValue(container.querySelector('[aria-label="Report client"]') as HTMLSelectElement, BRAND_A);
    await settle();
    expect(lastService().pathname).toContain(`/clients/${BRAND_A}/service`);
    setValue(container.querySelector('[aria-label="Report from"]') as HTMLInputElement, '2026-09-01');
    setValue(container.querySelector('[aria-label="Report to"]') as HTMLInputElement, '2026-09-30');
    await settle();
    expect(lastService().searchParams.get('from')).toBe('2026-09-01');
    expect(lastService().searchParams.get('to')).toBe('2026-09-30');
    setValue(container.querySelector('[aria-label="Report warehouse"]') as HTMLSelectElement, W2);
    await settle();
    expect(lastService().searchParams.get('warehouseId')).toBe(W2);
    expect(lastService().pathname).toContain(`/clients/${BRAND_A}/service`);
    // Back to every warehouse drops the parameter.
    setValue(container.querySelector('[aria-label="Report warehouse"]') as HTMLSelectElement, '');
    await settle();
    expect(lastService().searchParams.has('warehouseId')).toBe(false);
  });

  test('a period the server would refuse is never sent — the problem shows instead', async () => {
    const container = await open();
    const sent = serviceUrls().length;
    // (Each edit is checked on its own — the end first, so no intermediate draft is valid.)
    setValue(container.querySelector('[aria-label="Report to"]') as HTMLInputElement, '2026-09-01');
    setValue(container.querySelector('[aria-label="Report from"]') as HTMLInputElement, '2026-09-30');
    await settle();
    expect(serviceUrls()).toHaveLength(sent);
    expect(container.querySelector('[role="alert"]')!.textContent).toBe('The start date is after the end date.');
    setValue(container.querySelector('[aria-label="Report to"]') as HTMLInputElement, '2026-09-02');
    setValue(container.querySelector('[aria-label="Report from"]') as HTMLInputElement, '2025-09-01');
    await settle();
    expect(serviceUrls()).toHaveLength(sent);
    expect(container.querySelector('[role="alert"]')!.textContent).toBe('A period covers at most 366 days.');
  });

  test('Refresh reads again; a 503 asks for a shorter period', async () => {
    const container = await open();
    serviceReply = [503, { code: 'report-unavailable', status: 503, title: 'Report unavailable', detail: 'slow' }];
    const refresh = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Refresh')!;
    act(() => void refresh.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();
    expect(serviceUrls()).toHaveLength(2);
    expect(container.textContent).toContain('The report took too long — try a shorter period');
  });
});
