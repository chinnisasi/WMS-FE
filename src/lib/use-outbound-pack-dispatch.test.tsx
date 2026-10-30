import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { clearSession, writeSession, type StoredSession } from './auth';
import { notifyOutboundChanged } from './outbound';
import { restoreGlobals, stubGlobal } from './test/globals';
import { render, type Rendered } from './test/render';
import { MAX_CONCURRENT_CARTON_READS, settleLimited, usePackedCartonSummaries } from './use-outbound-pack-dispatch';

const TENANT_ID = '01a18ba8-0000-7000-8000-000000000001';

function session(): StoredSession {
  return {
    accessToken: 'token',
    expiresAt: Date.now() + 3_600_000,
    user: { id: 'u-1', email: 'priya@example.com', role: 'operator', tenantId: TENANT_ID, warehouseIds: [] },
  } as unknown as StoredSession;
}

/** A cartons read the test answers by hand. */
let pending: { orderId: string; answer: (cartonCount: number) => void }[] = [];

function Summaries({ orderIds }: { orderIds: readonly string[] }) {
  const summaries = usePackedCartonSummaries(TENANT_ID, orderIds);
  return <div data-testid="out">{orderIds.map((id) => `${id}:${summaries.get(id) ?? '-'}`).join('|')}</div>;
}

let view: Rendered | undefined;

beforeEach(() => {
  pending = [];
  writeSession(session());
  stubGlobal('fetch', ((input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const orderId = url.pathname.split('/').at(-2)!;
    return new Promise<Response>((resolve) => {
      pending.push({
        orderId,
        answer: (cartonCount) =>
          resolve(
            new Response(JSON.stringify({ pack: { packSeq: 1, status: 'live', legacy: false, partiesFrozen: true, cartonCount, grossWeightGrams: null, packedAt: '2026-10-30T10:00:00.000Z', packedBy: 'u-1', cartons: [] }, history: [] }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          ),
      });
    });
  }) as unknown as typeof fetch);
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  clearSession();
  restoreGlobals();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('the packed rows’ carton summaries', () => {
  test('a refetch after an outbound change keeps the last summaries until it lands', async () => {
    view = render(<Summaries orderIds={['o-1']} />);
    await flush();
    pending.shift()!.answer(2);
    await flush();
    const out = () => view!.container.querySelector('[data-testid="out"]')!.textContent;
    expect(out()).toBe('o-1:2 cartons');
    await act(async () => notifyOutboundChanged());
    await flush();
    expect(pending).toHaveLength(1);
    // The refetch is in flight: the old summary stays.
    expect(out()).toBe('o-1:2 cartons');
    pending.shift()!.answer(3);
    await flush();
    expect(out()).toBe('o-1:3 cartons');
  });

  test('at most four reads are in flight at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const gates: (() => void)[] = [];
    const run = settleLimited([1, 2, 3, 4, 5, 6, 7, 8, 9], MAX_CONCURRENT_CARTON_READS, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => gates.push(resolve));
      inFlight--;
      if (n === 5) throw new Error('boom');
      return n * 10;
    });
    while (gates.length > 0 || inFlight > 0) {
      await Promise.resolve();
      gates.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const settled = await run;
    expect(peak).toBe(4);
    expect(settled.map((s) => (s.status === 'fulfilled' ? s.value : 'x'))).toEqual([10, 20, 30, 40, 'x', 60, 70, 80, 90]);
  });
});
