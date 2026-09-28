import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { PackDto } from '@/lib/api/generated';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import {
  canDispatchOrder,
  canPackOrder,
  dispatchOutcome,
  dispatchReason,
  dispatchRecordLabel,
  dispatchedLineLabel,
  DISPATCH_TERMINAL_WARNING,
  EMPTY_MEASUREMENTS,
  isPipelineStatus,
  MAX_DIMENSION_MM,
  MAX_WEIGHT_GRAMS,
  MAX_NAMED_SHORT_LINES,
  MAX_QUANTITY_BASE,
  MIN_SCAN_QTY,
  packOutcome,
  packReason,
  packedLineLabel,
  packScanDraftFromLines,
  parcelMeasurementLabel,
  parseDispatchDraft,
  parsePackDraft,
  PIPELINE_STATUSES,
} from '@/lib/outbound-pack-dispatch';
import type { QuantityUom } from '@/lib/format-quantity';
import type { OrderLineDto } from '@/lib/api/generated';

/**
 * The pure derivation the pack & dispatch surface (story 4-2d) renders from.
 *
 * These are the claims that decide what leaves this client on the wire and
 * what the viewer reads when the server refuses — they are load-bearing
 * without any React:
 *   1. the pipeline page's scope is exactly the three lifecycle arms,
 *   2. the pack body drops blank/zero entries (the server reads an absent SKU
 *      as scanned 0), mirrors the backend's bounds, and refuses a
 *      partially-typed measurement before anything is sent,
 *   3. the dispatch body drops blank carrier/tracking fields (an empty body
 *      is a complete dispatch),
 *   4. the 409/422 refusal arms render the server's own words, because the
 *      picked-vs-scanned truth they name exists nowhere in a web read,
 *   5. the outcomes are built from the RESPONSE's own slip/record, never from
 *      the request.
 */

const KG: QuantityUom = { uom: 'kg', uomPrecision: 3 };

const SKU_MAP: Readonly<Record<string, QuantityUom>> = {
  'sku-1': KG,
  'sku-2': KG,
  'sku-3': { uom: 'kg', uomPrecision: 0 },
  'sku-4': { uom: 'each', uomPrecision: 0 },
};
const uomOf = (skuId: string) => SKU_MAP[skuId];

function scan(orderLineId: string, skuId: string, orderedQty: number, scanned: string) {
  return { orderLineId, skuId, orderedQty, scanned };
}

function orderLine(id: string, skuId: string, qty: number): OrderLineDto {
  return {
    id,
    orderId: 'order-1',
    skuId,
    qty,
    reservedQty: qty,
    shortfallQty: 0,
    status: 'open',
    reservationId: 'r-1',
    reservationState: 'committed',
    parentLineId: null,
    createdAt: '2026-09-16T10:00:00.000Z',
  };
}

/* ------------------------------------------------------------------ */
/* The page scope                                                      */
/* ------------------------------------------------------------------ */

describe('the pipeline scope', () => {
  test('the pipeline is exactly the three lifecycle arms — a new arm must opt in', () => {
    expect([...PIPELINE_STATUSES]).toEqual(['accepted', 'ready_to_dispatch', 'dispatched']);
  });

  test('a cancelled order is off the pipeline; every lifecycle arm is on it', () => {
    expect(isPipelineStatus('accepted')).toBe(true);
    expect(isPipelineStatus('ready_to_dispatch')).toBe(true);
    expect(isPipelineStatus('dispatched')).toBe(true);
    expect(isPipelineStatus('cancelled')).toBe(false);
  });

  test('packing is offered for exactly accepted; dispatch for exactly ready_to_dispatch', () => {
    for (const status of ['accepted', 'ready_to_dispatch', 'dispatched', 'cancelled'] as const) {
      expect(canPackOrder(status)).toBe(status === 'accepted');
      expect(canDispatchOrder(status)).toBe(status === 'ready_to_dispatch');
    }
  });
});

/* ------------------------------------------------------------------ */
/* The pack draft                                                      */
/* ------------------------------------------------------------------ */

describe('the pack draft', () => {
  test('entries seed from the ORDERED quantity, as strings for editing', () => {
    const draft = packScanDraftFromLines([
      orderLine('ol-1', 'sku-1', 4),
      orderLine('ol-2', 'sku-2', 3),
    ]);
    expect(draft).toEqual([
      { orderLineId: 'ol-1', skuId: 'sku-1', orderedQty: 4, scanned: '4' },
      { orderLineId: 'ol-2', skuId: 'sku-2', orderedQty: 3, scanned: '3' },
    ]);
  });

  test('a full draft parses to scanned entries with the measurements omitted', () => {
    const parsed = parsePackDraft(
      [scan('ol-1', 'sku-1', 4, '4'), scan('ol-2', 'sku-2', 3, '3')],
      EMPTY_MEASUREMENTS,
    );
    expect(parsed.problem).toBeNull();
    expect(parsed.body).toEqual({
      scanned: [
        { skuId: 'sku-1', qty: 4 },
        { skuId: 'sku-2', qty: 3 },
      ],
    });
    expect(parsed.body).not.toHaveProperty('weightGrams');
    expect(parsed.body).not.toHaveProperty('dimensionsMm');
  });

  test('blank and zero entries are dropped — the server reads an absent SKU as scanned 0', () => {
    const parsed = parsePackDraft(
      [scan('ol-1', 'sku-1', 4, '4'), scan('ol-2', 'sku-2', 3, ''), scan('ol-3', 'sku-3', 2, '0')],
      EMPTY_MEASUREMENTS,
    );
    expect(parsed.body!.scanned).toEqual([{ skuId: 'sku-1', qty: 4 }]);
  });

  test('a scanned value below the milli-unit floor is refused client-side', () => {
    const parsed = parsePackDraft([scan('ol-1', 'sku-1', 4, '0.0005')], EMPTY_MEASUREMENTS);
    expect(parsed.body).toBeNull();
    expect(parsed.problem).toBe(`A scanned quantity is at least ${MIN_SCAN_QTY}.`);
  });

  test('a scanned value past the largest exact milli-unit count is refused client-side', () => {
    const parsed = parsePackDraft(
      [scan('ol-1', 'sku-1', 4, String(MAX_QUANTITY_BASE + 1))],
      EMPTY_MEASUREMENTS,
    );
    expect(parsed.body).toBeNull();
    expect(parsed.problem).toBe(`A scanned quantity is at most ${MAX_QUANTITY_BASE.toLocaleString('en-US')}.`);
    const atTheBound = parsePackDraft(
      [scan('ol-1', 'sku-1', 4, String(MAX_QUANTITY_BASE))],
      EMPTY_MEASUREMENTS,
    );
    expect(atTheBound.body!.scanned).toEqual([{ skuId: 'sku-1', qty: MAX_QUANTITY_BASE }]);
  });

  test('a non-decimal scanned value is refused client-side, never Number()-parsed', () => {
    for (const bad of ['1e3', '0x10', 'abc', '-2', '4.', '.5', 'Infinity']) {
      const parsed = parsePackDraft([scan('ol-1', 'sku-1', 4, bad)], EMPTY_MEASUREMENTS);
      expect(parsed.body).toBeNull();
      expect(parsed.problem).toBe('Every scanned quantity is a decimal number.');
    }
  });

  test('weight bounds mirror the backend — whole grams, 1 to 1,000,000', () => {
    const ok = parsePackDraft([], { ...EMPTY_MEASUREMENTS, weightGrams: '2500' });
    expect(ok.body!.weightGrams).toBe(2500);

    for (const bad of ['1.5', '0', 'abc']) {
      const parsed = parsePackDraft([], { ...EMPTY_MEASUREMENTS, weightGrams: bad });
      expect(parsed.body).toBeNull();
      expect(parsed.problem).toBe('Weight is a whole number of grams, at least 1.');
    }
    const tooHeavy = parsePackDraft([], { ...EMPTY_MEASUREMENTS, weightGrams: String(MAX_WEIGHT_GRAMS + 1) });
    expect(tooHeavy.body).toBeNull();
    expect(tooHeavy.problem).toBe('Weight is at most 1,000,000 grams.');
  });

  test('dimensions are all three sides together, or none of them', () => {
    expect(parsePackDraft([], EMPTY_MEASUREMENTS).body!.dimensionsMm).toBeUndefined();
    expect(parsePackDraft([], EMPTY_MEASUREMENTS).body).toEqual({ scanned: [] });

    const partial = parsePackDraft([], {
      ...EMPTY_MEASUREMENTS,
      lengthMm: '300',
      widthMm: '200',
    });
    expect(partial.body).toBeNull();
    expect(partial.problem).toBe('Dimensions are all three sides together, or none of them.');
  });

  test('each dimension side mirrors the backend — whole millimetres, 1 to 100,000', () => {
    const ok = parsePackDraft([], {
      ...EMPTY_MEASUREMENTS,
      lengthMm: '300',
      widthMm: '200',
      heightMm: '100',
    });
    expect(ok.body!.dimensionsMm).toEqual({ lengthMm: 300, widthMm: 200, heightMm: 100 });

    const zero = parsePackDraft([], { ...EMPTY_MEASUREMENTS, lengthMm: '0', widthMm: '200', heightMm: '100' });
    expect(zero.problem).toBe('Each dimension is a whole number of millimetres.');

    const tooLong = parsePackDraft([], {
      ...EMPTY_MEASUREMENTS,
      lengthMm: String(MAX_DIMENSION_MM + 1),
      widthMm: '200',
      heightMm: '100',
    });
    expect(tooLong.problem).toBe('Each dimension is at most 100,000 mm.');
  });

  test('an over-precise scanned value is NOT clamped — the backend is the authority', () => {
    // sku-3 is kg at precision 0; sending 1.5 for it is the server's refusal
    // (naming the unit), never a silent client-side round to 2.
    const parsed = parsePackDraft([scan('ol-1', 'sku-3', 2, '1.5')], EMPTY_MEASUREMENTS);
    expect(parsed.body!.scanned).toEqual([{ skuId: 'sku-3', qty: 1.5 }]);
  });
});

/* ------------------------------------------------------------------ */
/* The dispatch draft                                                  */
/* ------------------------------------------------------------------ */

describe('the dispatch draft', () => {
  test('an empty confirm sends an empty body — a complete dispatch', () => {
    expect(parseDispatchDraft({ carrierName: '', trackingNumber: '' })).toEqual({});
  });

  test('blank fields are dropped, given fields are trimmed — never sent as blank strings', () => {
    expect(
      parseDispatchDraft({ carrierName: '  Blue Dart  ', trackingNumber: ' ' }),
    ).toEqual({ carrierName: 'Blue Dart' });
    expect(
      parseDispatchDraft({ carrierName: 'Blue Dart', trackingNumber: 'BD0012345678' }),
    ).toEqual({ carrierName: 'Blue Dart', trackingNumber: 'BD0012345678' });
  });

  test('the confirm warns that dispatch is terminal and why ATP moves', () => {
    expect(DISPATCH_TERMINAL_WARNING).toContain('no un-dispatch');
    expect(DISPATCH_TERMINAL_WARNING).toContain('retired');
  });
});

/* ------------------------------------------------------------------ */
/* Outcomes                                                            */
/* ------------------------------------------------------------------ */

function packOf(overrides: Partial<PackDto>): PackDto {
  return {
    orderId: 'order-1',
    tenantId: 't-1',
    warehouseId: 'w-1',
    orderStatus: 'ready_to_dispatch',
    source: 'manual',
    integrationId: null,
    externalEventId: null,
    packedBy: 'priya@example.com',
    packedAt: '2026-09-16T12:00:00.000Z',
    weightGrams: null,
    dimensionsMm: null,
    totalUnits: 7,
    lines: [],
    ...overrides,
  };
}

const PACKED_LINE = {
  orderLineId: 'ol-1',
  skuId: 'sku-1',
  skuCode: 'SPICE-01',
  skuName: 'Turmeric',
  orderedQty: 4,
  packedQty: 4,
  shortfallQty: 0,
  ledgerEventId: 'le-1',
};

const DISPATCHED_LINE = {
  orderLineId: 'ol-1',
  skuId: 'sku-1',
  skuCode: 'SPICE-01',
  skuName: 'Turmeric',
  orderedQty: 4,
  dispatchedQty: 4,
  shortfallQty: 0,
  ledgerEventId: 'le-3',
};

describe('outcomes', () => {
  test('a full pack reads as ready, at the shared unit', () => {
    const outcome = packOutcome(
      packOf({ lines: [PACKED_LINE, { ...PACKED_LINE, orderLineId: 'ol-2', skuId: 'sku-2', packedQty: 3 }], totalUnits: 7 }),
      uomOf,
    );
    expect(outcome.tone).toBe('accepted');
    expect(outcome.word).toBe('Order packed');
    expect(outcome.reason).toBe('2 lines · 7.000 kg packed. The order is ready to dispatch.');
  });

  test('a shortfall on the slip is named, an acceptance and never a failure', () => {
    const outcome = packOutcome(
      packOf({ lines: [{ ...PACKED_LINE, packedQty: 3, shortfallQty: 1 }], totalUnits: 3 }),
      uomOf,
    );
    expect(outcome.tone).toBe('accepted');
    expect(outcome.word).toBe('Packed with a shortfall');
    expect(outcome.reason).toBe(
      '1 line · 3.000 kg packed; shipped under-filled — SPICE-01 short 1.000 kg.',
    );
  });

  test('a shortfall in mixed units names each line in its own unit', () => {
    const outcome = packOutcome(
      packOf({
        lines: [
          { ...PACKED_LINE, skuId: 'sku-3', packedQty: 1, shortfallQty: 1 },
          { ...PACKED_LINE, orderLineId: 'ol-4', skuId: 'sku-4', packedQty: 2, shortfallQty: 1 },
        ],
        totalUnits: 3,
      }),
      uomOf,
    );
    expect(outcome.reason).toContain('SPICE-01 short 1 kg');
    expect(outcome.reason).toContain('SPICE-01 short 1 each');
  });

  test('more short lines than the named cap are collapsed with an ellipsis clause', () => {
    const lines = Array.from({ length: MAX_NAMED_SHORT_LINES + 2 }, (_, i) => ({
      ...PACKED_LINE,
      orderLineId: `ol-${i}`,
      skuCode: `SKU-${i}`,
      packedQty: 0,
      shortfallQty: 1,
    }));
    const outcome = packOutcome(packOf({ lines, totalUnits: 0 }), uomOf);
    expect(outcome.reason).toContain('…and 2 more');
  });

  test('the dispatch outcome names the retired holds and the terminality, at the shared unit', () => {
    const base = {
      orderId: 'order-1',
      tenantId: 't-1',
      warehouseId: 'w-1',
      orderStatus: 'dispatched' as const,
      source: 'manual' as const,
      integrationId: null,
      externalEventId: null,
      dispatchedBy: 'priya@example.com',
      dispatchedAt: '2026-09-16T12:00:00.000Z',
      carrierName: null,
      trackingNumber: null,
      totalUnits: 7,
      lines: [DISPATCHED_LINE, { ...DISPATCHED_LINE, orderLineId: 'ol-2', skuId: 'sku-2' }],
    };
    expect(dispatchOutcome({ ...base, retiredReservationIds: ['r-1', 'r-2'] }, uomOf).reason).toBe(
      '2 lines · 7.000 kg shipped; 2 reservation holds retired. The order is dispatched — there is no un-dispatch.',
    );
    expect(dispatchOutcome({ ...base, retiredReservationIds: ['r-1'] }, uomOf).reason).toContain('1 reservation hold retired');
    expect(dispatchOutcome({ ...base, retiredReservationIds: [] }, uomOf).reason).toContain(
      'no reservation holds were left to retire',
    );
  });

  test('a dispatch of lines in mixed units falls back to the raw-number total', () => {
    const dispatch = {
      orderId: 'order-1',
      tenantId: 't-1',
      warehouseId: 'w-1',
      orderStatus: 'dispatched' as const,
      source: 'manual' as const,
      integrationId: null,
      externalEventId: null,
      dispatchedBy: 'priya@example.com',
      dispatchedAt: '2026-09-16T12:00:00.000Z',
      carrierName: null,
      trackingNumber: null,
      totalUnits: 7,
      retiredReservationIds: [],
      lines: [DISPATCHED_LINE, { ...DISPATCHED_LINE, orderLineId: 'ol-4', skuId: 'sku-4' }],
    };
    expect(dispatchOutcome(dispatch, uomOf).reason).toContain('2 lines · 7 units shipped;');
  });
});

/* ------------------------------------------------------------------ */
/* Slip and record labels                                              */
/* ------------------------------------------------------------------ */

describe('labels', () => {
  test('a packed line states ordered, packed, and short only when short', () => {
    expect(packedLineLabel(PACKED_LINE, uomOf('sku-1'))).toBe(
      '4.000 kg ordered · 4.000 kg packed',
    );
    expect(packedLineLabel({ ...PACKED_LINE, packedQty: 3, shortfallQty: 1 }, uomOf('sku-1'))).toBe(
      '4.000 kg ordered · 3.000 kg packed · 1.000 kg short',
    );
    // An unresolvable SKU falls back to the unit-agnostic copy.
    expect(packedLineLabel(PACKED_LINE, null)).toBe('4 units ordered · 4 units packed');
  });

  test('a dispatched line states ordered, shipped, and short only when short', () => {
    expect(dispatchedLineLabel(DISPATCHED_LINE, uomOf('sku-1'))).toBe('4.000 kg ordered · 4.000 kg shipped');
    expect(
      dispatchedLineLabel({ ...DISPATCHED_LINE, dispatchedQty: 3, shortfallQty: 1 }, uomOf('sku-1')),
    ).toBe('4.000 kg ordered · 3.000 kg shipped · 1.000 kg short');
  });

  test('the parcel measurements state grams and sides, or honestly nothing', () => {
    expect(
      parcelMeasurementLabel({ weightGrams: 2500, dimensionsMm: { lengthMm: 300, widthMm: 200, heightMm: 100 } }),
    ).toBe('2,500 g · 300 × 200 × 100 mm');
    expect(parcelMeasurementLabel({ weightGrams: 2500, dimensionsMm: null })).toBe('2,500 g');
    expect(
      parcelMeasurementLabel({ weightGrams: null, dimensionsMm: { lengthMm: 300, widthMm: 200, heightMm: 100 } }),
    ).toBe('300 × 200 × 100 mm');
    expect(parcelMeasurementLabel({ weightGrams: null, dimensionsMm: null })).toBe('Unmeasured');
  });

  test('the dispatch record names the carrier arms, honestly absent when none', () => {
    expect(dispatchRecordLabel({ carrierName: 'Blue Dart', trackingNumber: 'BD0012345678' })).toBe(
      'Carrier Blue Dart · Tracking BD0012345678',
    );
    expect(dispatchRecordLabel({ carrierName: 'Blue Dart', trackingNumber: null })).toBe(
      'Carrier Blue Dart',
    );
    expect(dispatchRecordLabel({ carrierName: null, trackingNumber: 'BD0012345678' })).toBe(
      'Tracking BD0012345678',
    );
    expect(dispatchRecordLabel({ carrierName: null, trackingNumber: null })).toBe('No carrier recorded');
  });
});

/* ------------------------------------------------------------------ */
/* Refusals                                                            */
/* ------------------------------------------------------------------ */

describe('refusal mappers', () => {
  const PROBLEM = new ApiProblem(
    'pack-mismatch',
    422,
    'SPICE-01 scanned 4.000 kg but picked 3.000 kg.',
    'Pack mismatch',
  );

  test('the pack 409 and 422 arms are verbatim — the picked truth lives server-side', () => {
    expect(packReason(PROBLEM)).toBe('Pack mismatch — SPICE-01 scanned 4.000 kg but picked 3.000 kg.');
    expect(
      packReason(new ApiProblem('order-not-fully-picked', 409, 'Pick line still planned.', 'Order not fully picked')),
    ).toBe('Order not fully picked — Pick line still planned.');
    expect(packReason(new ApiProblem('order-already-packed', 409, undefined, 'Order already packed'))).toBe(
      'Order already packed',
    );
  });

  test('the dispatch 409 arm is verbatim; its 422 key reuse is fixed house copy', () => {
    expect(
      dispatchReason(new ApiProblem('order-not-packed', 409, 'The order reads accepted.', 'Order not packed')),
    ).toBe('Order not packed — The order reads accepted.');
    expect(dispatchReason(new ApiProblem('idempotency-key-reuse', 422, 'Key reuse'))).toBe(
      'This dispatch was already processed.',
    );
  });

  test('the pack 422 key reuse names the parcel, because the key spans a whole draft', () => {
    expect(packReason(new ApiProblem('idempotency-key-reuse', 422, 'Key reuse'))).toBe(
      'This pack was already processed with a different parcel.',
    );
  });

  test('the house copy arms stay distinct per command', () => {
    expect(packReason(new ApiProblem('not-found', 404))).toBe('This order no longer exists — refresh the list.');
    expect(packReason(new ApiProblem('role-denied', 403))).toBe('Your role cannot pack orders.');
    expect(dispatchReason(new ApiProblem('role-denied', 403))).toBe('Your role cannot dispatch orders.');
    expect(packReason(new ApiProblem('permission-denied', 403))).toBe(
      'That order belongs to another tenant — sign in again.',
    );
    expect(dispatchReason(new ApiProblem('permission-denied', 403))).toBe(
      'That order belongs to another tenant — sign in again.',
    );
    expect(packReason(new ApiProblem('unauthenticated', 401))).toBe('Your session expired — sign in again.');
    expect(packReason(new ApiProblem('validation-failed', 400, 'Weight must be at least 1.'))).toBe(
      'Weight must be at least 1.',
    );
    expect(packReason(new ApiProblem('something-else', 500))).toBe('Not packed (something-else).');
    expect(dispatchReason(new ApiProblem('something-else', 500))).toBe('Not dispatched (something-else).');
  });

  test('a non-problem failure is transport-shaped — the unreachable copy', () => {
    expect(packReason(new Error('Failed to fetch'))).toBe(UNREACHABLE_REASON);
    expect(dispatchReason(undefined)).toBe(UNREACHABLE_REASON);
  });
});
