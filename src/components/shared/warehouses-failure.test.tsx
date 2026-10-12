import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { InboundCards } from '../inbound/inbound-cards';
import { Outbound } from '../outbound/outbound';
import { useTenantWarehouses } from '../../lib/use-tenant-warehouses';
import { WarehouseSwitcher } from '../shell/warehouse-switcher';

/**
 * Story 21-11b (retro F3) — a failed warehouses read is never "no
 * warehouses". `useTenantWarehouses` used to swallow the failure into
 * `null`, so the switcher said "No warehouse yet — create one in Settings"
 * and every picker rendered empty. Pinned here on the switcher (the compact
 * variant) and on one representative operator picker (`InboundCards`):
 *   1. a 503 renders "Warehouses not loaded" + Retry — never the empty copy;
 *   2. Retry refetches, and the list renders when it answers;
 *   3. a real empty list (`ready`, no warehouses) keeps today's empty copy;
 *   4. a failed REFETCH (after the warehouses-changed event) keeps the
 *      last-good list rather than flipping to the failure, and is NOT
 *      silent (decision 3): `refreshFailed` is set on the ready data and the
 *      one-line "Couldn't refresh warehouses — Retry" note renders — on the
 *      switcher and on a former `useOutboundWarehouses` screen (Outbound);
 *      Retry clears it on success.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const W1 = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';

const SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Priya Logistics', gstin: null },
  user: { id: 'u-1', email: 'priya@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

const WAREHOUSE = {
  id: W1,
  tenantId: TENANT_ID,
  code: 'BLR1',
  name: 'Main',
  createdAt: '2026-01-01T00:00:00.000Z',
};

/** The warehouses read's answer: 'fail' → 503, else the items. */
let warehousesReply: 'fail' | readonly unknown[] = 'fail';
let warehouseReads = 0;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let view: Rendered | undefined;

beforeEach(() => {
  warehousesReply = 'fail';
  warehouseReads = 0;
  writeSession(SESSION);
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname } = new URL(request.url);
    if (pathname.endsWith(`/tenants/${TENANT_ID}/warehouses`)) {
      warehouseReads += 1;
      return warehousesReply === 'fail'
        ? json(503, { code: 'service-unavailable', status: 503, title: 'Unavailable', detail: 'The warehouses read is down.' })
        : json(200, { items: warehousesReply, nextCursor: null });
    }
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

const REFRESH_NOTE = "Couldn't refresh warehouses — Retry";

/** The warehouses-changed event fires and the refetch answers 503. */
async function failRefetch(): Promise<void> {
  warehousesReply = 'fail';
  const before = warehouseReads;
  await act(async () => {
    window.dispatchEvent(new Event('wms-warehouses-changed'));
  });
  await settle();
  expect(warehouseReads).toBe(before + 1);
}

/** The refresh note's Retry, answered with the list. */
async function retryRefresh(container: HTMLElement): Promise<void> {
  warehousesReply = [WAREHOUSE];
  const before = warehouseReads;
  const retry = container.querySelector('[role="status"] button') as HTMLButtonElement | null;
  expect(retry?.textContent).toBe('Retry');
  await act(async () => {
    retry!.click();
  });
  await settle();
  expect(warehouseReads).toBe(before + 1);
}

async function press(container: HTMLElement, label: string): Promise<void> {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent === label);
  expect(button).toBeDefined();
  await act(async () => {
    button!.click();
  });
  await settle();
}

describe('WarehouseSwitcher — a failed read', () => {
  test('a 503 reads "Warehouses not loaded" with Retry — never "No warehouse yet"; Retry refetches', async () => {
    view = render(<WarehouseSwitcher />);
    await settle();
    const text = view.container.textContent ?? '';
    expect(text).toContain('Warehouses not loaded');
    expect(text).not.toContain('No warehouse yet');
    expect(view.container.querySelector('[role="alert"]')!.getAttribute('title')).toBe('The warehouses read is down.');
    const before = warehouseReads;
    warehousesReply = [WAREHOUSE];
    await press(view.container, 'Retry');
    expect(warehouseReads).toBe(before + 1);
    expect(view.container.textContent).toContain('BLR1 Main');
    expect(view.container.textContent).not.toContain('Warehouses not loaded');
  });

  test('a real empty list keeps the empty copy', async () => {
    warehousesReply = [];
    view = render(<WarehouseSwitcher />);
    await settle();
    expect(view.container.textContent).toContain('No warehouse yet — create one in Settings');
    expect(view.container.textContent).not.toContain('Warehouses not loaded');
  });

  test('a failed refetch keeps the last-good list with the refresh note; Retry clears it on success', async () => {
    warehousesReply = [WAREHOUSE];
    view = render(<WarehouseSwitcher />);
    await settle();
    expect(view.container.textContent).toContain('BLR1 Main');
    expect(view.container.textContent).not.toContain(REFRESH_NOTE);
    await failRefetch();
    expect(view.container.textContent).toContain('BLR1 Main');
    expect(view.container.textContent).not.toContain('Warehouses not loaded');
    expect(view.container.textContent).toContain(REFRESH_NOTE);
    expect(view.container.querySelector('[role="status"]')!.getAttribute('title')).toBe('The warehouses read is down.');
    await retryRefresh(view.container);
    expect(view.container.textContent).not.toContain(REFRESH_NOTE);
    expect(view.container.textContent).toContain('BLR1 Main');
  });
});

describe('InboundCards — a representative operator picker', () => {
  test('a 503 renders "Warehouses not loaded" with Retry in place of the cards; Retry refetches', async () => {
    view = render(<InboundCards />);
    await settle();
    const alert = view.container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Warehouses not loaded');
    expect(alert.textContent).toContain('The warehouses read is down.');
    expect(view.container.textContent).not.toContain('Purchase orders');
    const before = warehouseReads;
    warehousesReply = [WAREHOUSE];
    await press(view.container, 'Retry');
    expect(warehouseReads).toBe(before + 1);
    expect(view.container.textContent).not.toContain('Warehouses not loaded');
  });
});

describe('Outbound — a former useOutboundWarehouses screen', () => {
  test('a failed refetch keeps the picker and the tables, with the refresh note; Retry clears it on success', async () => {
    warehousesReply = [WAREHOUSE];
    view = render(<Outbound />);
    await settle();
    expect(view.container.textContent).not.toContain('Warehouses not loaded');
    expect(view.container.textContent).not.toContain(REFRESH_NOTE);
    await failRefetch();
    expect(view.container.textContent).not.toContain('Warehouses not loaded');
    expect(view.container.textContent).toContain(REFRESH_NOTE);
    // The surface stays on the last-good warehouse — not a full failure.
    expect(view.container.textContent).not.toContain('Create a warehouse first');
    await retryRefresh(view.container);
    expect(view.container.textContent).not.toContain(REFRESH_NOTE);
  });
});

describe('useTenantWarehouses — the refresh arm (decision 3)', () => {
  /** Renders the hook's state as JSON, minus the reload function. */
  function Probe() {
    const state = useTenantWarehouses();
    const { reload: _reload, ...rest } = state;
    void _reload;
    return <pre data-probe>{JSON.stringify(rest)}</pre>;
  }
  const read = () => JSON.parse(view!.container.querySelector('[data-probe]')!.textContent ?? '{}');

  test('a failed refetch keeps the data and sets refreshFailed; a successful refetch clears it; a failed FIRST load is failed', async () => {
    warehousesReply = [WAREHOUSE];
    view = render(<Probe />);
    await settle();
    expect(read()).toEqual({ state: 'ready', data: { tenantId: TENANT_ID, items: [WAREHOUSE], refreshFailed: null } });
    await failRefetch();
    expect(read()).toEqual({
      state: 'ready',
      data: { tenantId: TENANT_ID, items: [WAREHOUSE], refreshFailed: 'The warehouses read is down.' },
    });
    warehousesReply = [WAREHOUSE];
    await act(async () => {
      window.dispatchEvent(new Event('wms-warehouses-changed'));
    });
    await settle();
    expect(read().data.refreshFailed).toBeNull();
    view!.unmount();
    warehousesReply = 'fail';
    view = render(<Probe />);
    await settle();
    expect(read()).toEqual({ state: 'failed', reason: 'The warehouses read is down.' });
  });
});
