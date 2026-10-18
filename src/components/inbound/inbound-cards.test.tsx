import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { writeActiveWarehouseId } from '../../lib/warehouses';
import { InboundCards } from './inbound-cards';

/**
 * Story 1-1 on the Inbound page, driven through a stubbed `fetch`:
 *   1. the Goods receipts list shows a Client column only once the tenant
 *      holds more than its own client — each receipt's stamped client, and
 *      "—" for an older receipt the backfill could not attribute;
 *   2. Awaiting putaway names each task's SKU with its client (two clients
 *      may share a code), and the bare code with one client.
 */

const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const WH = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';

const SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: T, name: 'Priya Spices', gstin: null },
  user: { id: 'u-1', email: 'owner@example.com', role: 'owner', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
} as StoredSession;

const SELF = { id: 'c-self', code: 'self', name: 'Priya Spices', status: 'active', systemOwned: true };
const ACME = { id: 'c-acme', code: 'ACME', name: 'Acme Foods', status: 'active', systemOwned: false };
const BETA = { id: 'c-beta', code: 'BETA', name: 'Beta Brands', status: 'active', systemOwned: false };

let clients: Record<string, unknown>[] = [SELF];

function grn(id: string, code: string, clientId?: string): Record<string, unknown> {
  return {
    id,
    tenantId: T,
    warehouseId: WH,
    code,
    poId: null,
    ...(clientId === undefined ? {} : { clientId }),
    blindReasonCode: 'unannounced-delivery',
    status: 'recorded',
    recordedBy: 'u-1',
    occurredAt: '2026-10-18T05:00:00.000Z',
    recordedAt: '2026-10-18T05:00:00.000Z',
    lineCount: 1,
    totalUnits: 3,
    appliedUnits: 3,
  };
}

function sku(id: string, code: string, clientId: string): Record<string, unknown> {
  return { id, code, name: code, uom: 'each', uomPrecision: 0, clientId };
}

function task(skuId: string, skuCode: string, grnLineId: string): Record<string, unknown> {
  return {
    grnId: 'g-1',
    grnCode: 'GRN-0001',
    grnLineId,
    skuId,
    skuCode,
    batchId: null,
    batchCode: null,
    qty: 2,
    suggestedBin: null,
    rationale: 'no bin has room',
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubRouter(): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname } = new URL(request.url);
    const base = `/api/v1/tenants/${T}`;
    if (pathname === `${base}/warehouses`) {
      return json(200, { items: [{ id: WH, code: 'BLR', name: 'Bengaluru DC' }], nextCursor: null });
    }
    if (pathname === `${base}/clients`) return json(200, { items: clients });
    if (pathname === `${base}/receiving/goods-receipts`) {
      return json(200, {
        items: [grn('g-1', 'GRN-0001', 'c-acme'), grn('g-2', 'GRN-0002', 'c-self'), grn('g-3', 'GRN-0003')],
        nextCursor: null,
      });
    }
    if (pathname === `${base}/catalog/skus`) {
      return json(200, {
        items: [sku('s-acme', 'TSHIRT-M', 'c-acme'), sku('s-beta', 'TSHIRT-M', 'c-beta')],
        nextCursor: null,
      });
    }
    if (pathname === `${base}/putaway/tasks`) {
      return json(200, { items: [task('s-acme', 'TSHIRT-M', 'l-1'), task('s-beta', 'TSHIRT-M', 'l-2')] });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
}

let view: Rendered | undefined;

beforeEach(() => {
  clients = [SELF];
  stubRouter();
  writeSession(SESSION);
  writeActiveWarehouseId(T, WH);
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
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const panel = () => view!.container.querySelector('[role="tabpanel"]') as HTMLElement;
const headers = () => [...panel().querySelectorAll('thead th')].map((th) => th.textContent ?? '');
const rows = () =>
  [...panel().querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent ?? ''));

describe('Goods receipts — the receipt\'s client (story 1-1)', () => {
  test('one client: no Client column', async () => {
    view = render(<InboundCards initialTab="grns" />);
    await settle();
    expect(headers()).toContain('GRN code');
    expect(headers()).not.toContain('Client');
  });

  test('several clients: the Client column names each receipt\'s client, "—" when unattributed', async () => {
    clients = [SELF, ACME, BETA];
    view = render(<InboundCards initialTab="grns" />);
    await settle();
    expect(headers().slice(0, 2)).toEqual(['GRN code', 'Client']);
    expect(rows().map((cells) => cells.slice(0, 2))).toEqual([
      ['GRN-0001', 'ACME'],
      ['GRN-0002', 'Priya Spices'],
      ['GRN-0003', '—'],
    ]);
  });
});

describe('Awaiting putaway — the SKU named with its client (story 1-1)', () => {
  test('several clients: a shared code reads CODE · client on each task', async () => {
    clients = [SELF, ACME, BETA];
    view = render(<InboundCards initialTab="putaway" />);
    await settle();
    const skuColumn = headers().indexOf('SKU');
    expect(rows().map((cells) => cells[skuColumn])).toEqual(['TSHIRT-M · ACME', 'TSHIRT-M · BETA']);
  });

  test('one client: the task\'s own code, unchanged', async () => {
    view = render(<InboundCards initialTab="putaway" />);
    await settle();
    const skuColumn = headers().indexOf('SKU');
    expect(rows().map((cells) => cells[skuColumn])).toEqual(['TSHIRT-M', 'TSHIRT-M']);
  });
});
