import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from '../../lib/auth';
import { restoreGlobals, stubGlobal } from '../../lib/test/globals';
import { render, type Rendered } from '../../lib/test/render';
import { CustomerShelfLifeSection } from './customer-shelf-life';

/**
 * Story 4-3b — the order detail's "Customer shelf life" section renders for
 * exactly the orders a rule applies to, names an unjudgeable line's SKU and
 * fix, and is absent (not an error) on a backend without the read (404).
 */

const TENANT_ID = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const ORDER_ID = '0198f7a2-1b3c-7d4e-8f90-aaaaaaaaaaaa';

const session: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: TENANT_ID, name: 'Priya Spices', gstin: null },
  user: { id: 'u-1', email: 'priya@example.com', role: 'ops_manager', status: 'active' },
  expiresAt: Date.now() + 15 * 60_000,
};

const LINE = {
  orderLineId: 'ol-1',
  skuId: 's-1',
  skuCode: 'SKU-UJ',
  reservedQty: 2,
  effectiveMinDays: null,
  shelfLifeBaseDays: null,
  judgeable: false,
  qualifyingOnHand: 0,
  qualifyingUnclaimed: 0,
  belowConsigneeMinimumOnHand: 10,
  plannedQty: null,
  shortfallQty: null,
  shortfallCause: null,
};

let paths: string[] = [];
function stub(status: number, body: unknown): void {
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString());
    paths.push(new URL(request.url).pathname);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch);
}

let view: Rendered | undefined;
afterEach(() => {
  view?.unmount();
  view = undefined;
  paths = [];
  clearSession();
  restoreGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('CustomerShelfLifeSection', () => {
  test('a consignee rule: the rule, the line, and the unjudgeable fix with the recovery path', async () => {
    writeSession(session);
    stub(200, {
      orderShelfLife: {
        orderId: ORDER_ID,
        judgedOn: '2026-10-28',
        clientMinShelfLifeDays: null,
        consigneeResolution: 'applied',
        consignee: { partnerId: 'p', code: 'PCT', name: 'Percent Mart', minShelfLifeDays: null, minShelfLifePercent: 70 },
        lines: [LINE],
      },
    });
    view = render(<CustomerShelfLifeSection orderId={ORDER_ID} />);
    await settle();
    expect(paths).toEqual([`/api/v1/tenants/${TENANT_ID}/outbound/orders/${ORDER_ID}/shelf-life`]);
    const section = view.container.querySelector('[data-testid="customer-shelf-life"]');
    expect(section).not.toBeNull();
    expect(section!.textContent).toContain('Percent Mart (PCT) needs ≥ 70 % of total shelf life left.');
    expect(section!.textContent).toContain("SKU-UJ has no total shelf life, so the consignee's percent rule cannot be met");
    expect(section!.textContent).toContain('Receive fresher stock and regenerate the wave (cancel this wave first), or cancel the order line.');
  });

  test('no rule applies: nothing renders', async () => {
    writeSession(session);
    stub(200, {
      orderShelfLife: { orderId: ORDER_ID, judgedOn: '2026-10-28', clientMinShelfLifeDays: null, consigneeResolution: 'no-gstin', consignee: null, lines: [] },
    });
    view = render(<CustomerShelfLifeSection orderId={ORDER_ID} />);
    await settle();
    expect(view.container.textContent).toBe('');
  });

  test('a backend without the read (404): nothing renders, no failure', async () => {
    writeSession(session);
    stub(404, { code: 'not-found', title: 'x', status: 404, detail: 'Cannot GET' });
    view = render(<CustomerShelfLifeSection orderId={ORDER_ID} />);
    await settle();
    expect(view.container.textContent).toBe('');
  });

  test('another failure shows the retryable read failure', async () => {
    writeSession(session);
    stub(500, { code: 'internal', title: 'x', status: 500, detail: 'boom' });
    view = render(<CustomerShelfLifeSection orderId={ORDER_ID} />);
    await settle();
    expect(view.container.textContent).toContain('Customer shelf life unavailable');
  });
});
