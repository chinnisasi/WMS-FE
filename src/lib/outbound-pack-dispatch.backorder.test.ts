import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { DispatchDto } from '@/lib/api/generated';
import {
  benchIsShort,
  codShortWarning,
  dispatchFollowOn,
  PACK_NOTHING_PICKED_REASON,
  packReason,
  SHORT_PARCEL_NOTE,
  slipIsShort,
} from '@/lib/outbound-pack-dispatch';

/** Story 4-2c — the short-parcel copy on pack and dispatch. */

const LINE = { orderLineId: 'ol-1', skuId: 'sku-1', skuCode: 'TEA-1', skuName: 'Tea', orderedQty: 10, packedQty: 10, shortfallQty: 0, ledgerEventId: 'le-1' };

function dispatchOf(over: Partial<DispatchDto> = {}): DispatchDto {
  return {
    orderId: '0198f7a2-1b3c-7d4e-8f90-0000a1b2c3d4',
    tenantId: 't',
    warehouseId: 'w',
    orderStatus: 'dispatched',
    source: 'manual',
    integrationId: null,
    externalEventId: null,
    clientOrderRef: '1042',
    dispatchedBy: 'u',
    dispatchedAt: '2026-10-28T06:00:00.000Z',
    carrierName: null,
    trackingNumber: null,
    totalUnits: 7,
    retiredReservationIds: [],
    lines: [{ orderLineId: 'ol-1', skuId: 'sku-1', skuCode: 'TEA-1', skuName: 'Tea', orderedQty: 10, dispatchedQty: 7, shortfallQty: 3, ledgerEventId: 'le-2' }],
    ...over,
  };
}

describe('the slip and the bench (story 4-2c)', () => {
  test('a slip is short when any line packed below its ordered quantity; the note says the rest follows', () => {
    expect(slipIsShort({ lines: [LINE] })).toBe(false);
    expect(slipIsShort({ lines: [LINE, { ...LINE, orderLineId: 'ol-2', packedQty: 7, shortfallQty: 3 }] })).toBe(true);
    expect(SHORT_PARCEL_NOTE).toBe('Items short on this parcel follow in a separate shipment');
  });

  test('the COD warning names the full amount on a short COD parcel — nothing on prepaid or a full parcel', () => {
    expect(codShortWarning(125_000, true)).toBe('Cash on delivery — the courier collects the full ₹1,250.00 on this parcel; the rest follows prepaid');
    expect(codShortWarning(null, true)).toBeNull();
    expect(codShortWarning(undefined, true)).toBeNull();
    expect(codShortWarning(125_000, false)).toBeNull();
  });

  test('before packing: short when a line still awaits stock, or a scan is below the ordered quantity', () => {
    const scan = (scanned: string) => ({ orderLineId: 'ol-1', skuId: 'sku-1', orderedQty: 10, scanned });
    expect(benchIsShort([{ shortfallQty: 0 }], [scan('10')])).toBe(false);
    expect(benchIsShort([{ shortfallQty: 2 }], [scan('10')])).toBe(true);
    expect(benchIsShort([{ shortfallQty: 0 }], [scan('7')])).toBe(true);
    // A blank or unreadable entry is the bench's own problem, not a shortfall.
    expect(benchIsShort([{ shortfallQty: 0 }], [scan('')])).toBe(false);
    expect(benchIsShort([{ shortfallQty: 0 }], [scan('abc')])).toBe(false);
  });
});

describe('the dispatch confirmation names the follow-on (story 4-2c)', () => {
  test('"Shipped short — follow-on 1042-BO1 created for the rest; it ships when stock arrives" (no unit sum across SKUs — code review C33)', () => {
    expect(dispatchFollowOn(dispatchOf({ followOnOrderId: 'fo-1' }))).toEqual({
      orderId: 'fo-1',
      label: '1042-BO1',
      sentence: 'Shipped short — follow-on 1042-BO1 created for the rest; it ships when stock arrives',
    });
  });

  test('a follow-on shipping short opens the next in the chain; an unnamed chain takes the root’s short id', () => {
    const ROOT = '0198f7a2-1b3c-7d4e-8f90-0000a1b2c3d4';
    const followOn = dispatchOf({ orderId: 'x-bo1', clientOrderRef: null, followOnRootOrderId: ROOT, followOnOfOrderId: ROOT, followOnSeq: 1, followOnOrderId: 'fo-2' });
    expect(dispatchFollowOn(followOn)?.label).toBe('a1b2c3d4-BO2');
  });

  test('nothing when the dispatch opened no follow-on (or a stored pre-4-2c record)', () => {
    expect(dispatchFollowOn(dispatchOf({ followOnOrderId: null }))).toBeNull();
    expect(dispatchFollowOn(dispatchOf())).toBeNull();
  });
});

describe('the zero-unit pack refusal (story 4-2c, decision 10)', () => {
  test('409 pack-nothing-picked has its own clear words, never the verbatim 409', () => {
    expect(packReason(new ApiProblem('pack-nothing-picked', 409, 'raw server words', 'Nothing picked'))).toBe(`${PACK_NOTHING_PICKED_REASON}.`);
    expect(PACK_NOTHING_PICKED_REASON).toBe('Nothing was picked for this order — cancel the wave to re-plan it, or cancel the order');
  });
});
