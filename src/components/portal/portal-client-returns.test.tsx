import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { PortalClientReturns } from './portal-client-returns';

/**
 * Story 4-7c (decision 15, A14) — the portal's "Shipments back to you": the
 * client's returns to client, read only. The claims a `src/lib` test cannot
 * make: the A14 status words on the wire's statuses, the row's carrier, AWB
 * and packages, the detail's address, document and lines, no print and no
 * write (no button but the row toggles; no data-print-root), and every
 * request on a portal route.
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const CLIENT_ID = '0198f7a2-1b3c-7d4e-8f90-cccccccccccc';
const RTC_SHIPPED = '0198f7a2-1b3c-7d4e-8f90-0000000003f1';
const RTC_PREPARING = '0198f7a2-1b3c-7d4e-8f90-0000000003f2';

const PORTAL_SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Three PL Co', gstin: null },
  user: { id: 'u-2', email: 'buyer@brand-a.example', role: 'client', status: 'active', clientId: CLIENT_ID },
  client: { id: CLIENT_ID, code: 'BRAND-A', name: 'Brand A Apparel' },
  expiresAt: Date.now() + 15 * 60_000,
} as StoredSession;

const SHIPPED_ROW = {
  id: RTC_SHIPPED,
  code: 'RTC-0001',
  status: 'dispatched',
  createdAt: '2026-10-20T05:00:00.000Z',
  dispatchedAt: '2026-10-22T08:00:00.000Z',
  lineCount: 2,
  totalQuantity: 7,
  shippedQuantity: 7,
  carrierName: null,
  transporterName: 'VRL Logistics',
  trackingRef: '777',
  packageCount: 2,
};
const PREPARING_ROW = {
  ...SHIPPED_ROW,
  id: RTC_PREPARING,
  code: 'RTC-0002',
  status: 'picked',
  dispatchedAt: null,
  shippedQuantity: null,
  transporterName: null,
  trackingRef: null,
  packageCount: null,
};

let requests: string[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  requests = [];
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    const { pathname } = new URL(request.url);
    requests.push(`${request.method.toUpperCase()} ${pathname}`);
    const base = `/api/v1/tenants/${TENANT_ID}/portal`;
    if (pathname === `${base}/client-returns`) return json(200, { items: [SHIPPED_ROW, PREPARING_ROW], nextCursor: null });
    if (pathname === `${base}/client-returns/${RTC_SHIPPED}`) {
      return json(200, {
        ...SHIPPED_ROW,
        consigneeAddress: { kind: 'return', contactName: 'Returns desk', phone: '9845000000', line1: '9 Peenya Ind. Area', line2: null, city: 'Bengaluru', state: 'Karnataka', stateCode: null, pincode: '560058' },
        vehicleNumber: 'KA01AB1234',
        brandDocument: { type: 'challan', number: 'CH-9', date: '2026-10-22' },
        ewayBillNumber: null,
        lines: [
          { lineNo: 1, source: 'returns', skuCode: 'TEE-RED-M', skuName: 'Red tee M', uom: 'each', batchCode: null, serialNumber: null, rmaCode: 'RMA-0003', condition: 'opened', quantity: 4, shippedQuantity: 4 },
          { lineNo: 2, source: 'damaged', skuCode: 'TEE-BLU-L', skuName: 'Blue tee L', uom: 'each', batchCode: 'B1', serialNumber: null, rmaCode: null, condition: null, quantity: 3, shippedQuantity: 3 },
        ],
      });
    }
    return json(404, { code: 'not-found', title: 'Unrouted in this test', status: 404 });
  }) as unknown as typeof fetch);
});

let view: Rendered | undefined;

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('Shipments back to you', () => {
  test('lists the client’s RTCs in its words, expands to the shipment, and offers no print or write', async () => {
    writeSession(PORTAL_SESSION);
    view = render(<PortalClientReturns />);
    await flush();
    const container = view.container;
    expect(container.querySelector('h2')!.textContent).toBe('Shipments back to you');
    expect(container.querySelector('[data-testid="portal-rtc-status-RTC-0001"]')!.textContent).toBe('Shipped');
    expect(container.querySelector('[data-testid="portal-rtc-status-RTC-0002"]')!.textContent).toBe('Being prepared');
    const text = container.textContent ?? '';
    for (const expected of ['VRL Logistics', '777', 'RTC-0002']) expect(text).toContain(expected);

    await act(async () => {
      (container.querySelector('button[aria-label="Show the details of RTC-0001"]') as HTMLButtonElement).click();
    });
    await flush();
    const detail = container.querySelector('[data-testid="portal-client-return-detail"]')!.textContent ?? '';
    for (const expected of ['9 Peenya Ind. Area', 'your return address', 'Delivery challan', 'CH-9', 'KA01AB1234', 'RMA-0003', 'Opened', 'Damaged stock', 'batch B1']) {
      expect(detail).toContain(expected);
    }
    expect(container.querySelectorAll('[data-testid="portal-client-return-line"]')).toHaveLength(2);
    // Read only: no print root, and every button is a row toggle.
    expect(container.querySelector('[data-print-root]')).toBeNull();
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent ?? '');
    expect(labels.filter((label) => /print|cancel|dispatch|create|new/i.test(label))).toEqual([]);
    expect(requests.every((request) => request.startsWith('GET ') && request.includes('/portal/'))).toBe(true);
  });
});
