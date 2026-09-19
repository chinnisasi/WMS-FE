import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { OrderDto, OrderLineDto, SkuResponse } from '@/lib/api/generated';
import {
  canCancelOrder,
  MAX_LINE_QUANTITY,
  MAX_NAMED_SHORT_LINES,
  ORDER_STATUSES,
  orderTotalsLabel,
  readReason,
  cancelOutcome,
  cancelReason,
  channelRefLabel,
  createOutcome,
  createReason,
  detailReason,
  filterPage,
  holdStateLabel,
  lineQuantityLabel,
  lineTotals,
  MAX_ORDER_LINES,
  orderSourceLabel,
  orderStatusLabel,
  pageFilterCount,
  parseDraftLines,
  UNREACHABLE_REASON,
  type OrderStatus,
} from './outbound-orders';

/**
 * The Outbound orders surface's pure decisions (story 4.2b). The screen
 * itself has no test infrastructure in this repo, so everything that can be
 * a function is one, and it is pinned here: over-ATP reads as acceptance,
 * a 409 cancel renders the server verbatim, cancel is offered for exactly
 * one status, and the page filter names its own scope.
 */

function line(over: Partial<OrderLineDto> = {}): OrderLineDto {
  return {
    id: 'line-1',
    orderId: 'order-1',
    skuId: 'sku-1',
    qty: 10,
    reservedQty: 10,
    shortfallQty: 0,
    status: 'open',
    reservationId: 'res-1',
    reservationState: 'held',
    createdAt: '2026-09-16T10:00:00.000Z',
    ...over,
  };
}

function order(over: Partial<OrderDto> = {}): OrderDto {
  return {
    id: 'order-1',
    tenantId: 'tenant-1',
    warehouseId: 'warehouse-1',
    status: 'accepted',
    source: 'manual',
    integrationId: null,
    externalEventId: null,
    createdAt: '2026-09-16T10:00:00.000Z',
    updatedAt: '2026-09-16T10:00:00.000Z',
    lines: [line()],
    ...over,
  };
}

/**
 * The SKU resolver the way the component supplies it: code, unit and the
 * unit's declared precision (story 10.5). `sku-1`/`sku-2` are both
 * `each`-counted so the single-unit fixtures share one unit; `sku-kg` is the
 * measured one the decimal tests use.
 */
const SKUS: Record<string, SkuResponse> = {
  'sku-1': { id: 'sku-1', code: 'SPICE-01', uom: 'each', uomPrecision: 0 } as SkuResponse,
  'sku-2': { id: 'sku-2', code: 'SPICE-02', uom: 'each', uomPrecision: 0 } as SkuResponse,
  'sku-kg': { id: 'sku-kg', code: 'FLOUR-01', uom: 'kg', uomPrecision: 3 } as SkuResponse,
};
const skuOf = (skuId: string) => SKUS[skuId];

describe('status and source labels', () => {
  test('the filter list is derived from the label Record — every arm, in order', () => {
    expect(ORDER_STATUSES).toEqual(['accepted', 'ready_to_dispatch', 'dispatched', 'cancelled']);
  });

  test('every lifecycle arm has plain words', () => {
    expect(orderStatusLabel('accepted')).toBe('Accepted');
    expect(orderStatusLabel('ready_to_dispatch')).toBe('Ready to dispatch');
    expect(orderStatusLabel('dispatched')).toBe('Dispatched');
    expect(orderStatusLabel('cancelled')).toBe('Cancelled');
    expect(orderSourceLabel('manual')).toBe('Manual');
    expect(orderSourceLabel('ingested')).toBe('Ingested');
  });

  test('channel refs render only on an ingested order', () => {
    expect(channelRefLabel({ integrationId: null, externalEventId: null })).toBe('—');
    expect(channelRefLabel({ integrationId: 'shopify', externalEventId: 'evt-9' })).toBe(
      'shopify · evt-9',
    );
    expect(channelRefLabel({ integrationId: 'shopify', externalEventId: null })).toBe('shopify');
  });
});

describe('canCancelOrder (no action the backend will refuse for a visible state)', () => {
  test('cancel is offered for accepted alone', () => {
    expect(canCancelOrder('accepted')).toBe(true);
    expect(canCancelOrder('ready_to_dispatch')).toBe(false);
    expect(canCancelOrder('dispatched')).toBe(false);
    expect(canCancelOrder('cancelled')).toBe(false);
  });
});

describe('line quantities', () => {
  test('totals sum the ordered, reserved and short units and count backorders', () => {
    expect(
      lineTotals([
        line({ qty: 10, reservedQty: 10, shortfallQty: 0, status: 'open' }),
        line({ id: 'line-2', qty: 8, reservedQty: 3, shortfallQty: 5, status: 'backordered' }),
      ]),
    ).toEqual({ lines: 2, qty: 18, reservedQty: 13, shortfallQty: 5, backorderedLines: 1 });
  });

  test('a fully reserved line states two numbers, a short line three', () => {
    expect(lineQuantityLabel({ qty: 10, reservedQty: 10, shortfallQty: 0 })).toBe(
      '10 units ordered · 10 units reserved',
    );
    expect(lineQuantityLabel({ qty: 10, reservedQty: 4, shortfallQty: 6 })).toBe(
      '10 units ordered · 4 units reserved · 6 units short',
    );
  });

  test('a line whose SKU resolves names its unit at the unit\'s declared precision', () => {
    // Declared precision, never storage precision — 2.5 kg is 2.500 kg, and
    // an each-counted unit grows no decimal suffix.
    expect(lineQuantityLabel({ qty: 2.5, reservedQty: 1.25, shortfallQty: 0 }, SKUS['sku-kg'])).toBe(
      '2.500 kg ordered · 1.250 kg reserved',
    );
    expect(
      lineQuantityLabel({ qty: 2.5, reservedQty: 1, shortfallQty: 1.5 }, SKUS['sku-kg']),
    ).toBe('2.500 kg ordered · 1.000 kg reserved · 1.500 kg short');
    expect(lineQuantityLabel({ qty: 10, reservedQty: 10, shortfallQty: 0 }, SKUS['sku-1'])).toBe(
      '10 each ordered · 10 each reserved',
    );
  });

  test('a line whose SKU cannot resolve keeps the unit-agnostic fallback, never a guessed precision', () => {
    expect(lineQuantityLabel({ qty: 2.5, reservedQty: 1.5, shortfallQty: 0 }, null)).toBe(
      '2.5 units ordered · 1.5 units reserved',
    );
  });

  test('an order whose lines share one unit renders its totals at that unit', () => {
    // The acceptance case: a kg SKU ordered at 2.5 renders 2.500 kg in the
    // order summary — declared precision, unit named.
    expect(
      orderTotalsLabel(
        { lines: 1, qty: 2.5, reservedQty: 2.5, shortfallQty: 0, backorderedLines: 0 },
        SKUS['sku-kg'],
      ),
    ).toBe('1 line · 2.500 kg ordered · 2.500 kg reserved');
    expect(
      orderTotalsLabel(
        { lines: 1, qty: 2.5, reservedQty: 1.5, shortfallQty: 1, backorderedLines: 1 },
        SKUS['sku-kg'],
      ),
    ).toBe('1 line · 2.500 kg ordered · 1.500 kg reserved · 1.000 kg short across 1 backordered line');
  });

  test('every hold state is house copy, never a raw journal enum value', () => {
    expect(holdStateLabel({ reservationId: null, reservationState: null })).toBe('No hold');
    expect(holdStateLabel({ reservationId: 'res-1', reservationState: null })).toBe('Held');
    expect(holdStateLabel({ reservationId: 'res-1', reservationState: 'held' })).toBe('Held');
    expect(holdStateLabel({ reservationId: 'res-1', reservationState: 'committed' })).toBe(
      'Committed to a pick',
    );
    expect(holdStateLabel({ reservationId: 'res-1', reservationState: 'released' })).toBe('Released');
    expect(holdStateLabel({ reservationId: 'res-1', reservationState: 'expired' })).toBe('Expired');
  });

  test('an unrecognised state falls back to itself rather than being hidden', () => {
    // `reservationState` is typed `string | null` — a state this build has
    // never heard of is shown, not swallowed.
    expect(holdStateLabel({ reservationId: 'res-1', reservationState: 'quarantined' })).toBe(
      'quarantined',
    );
  });

  test('the order totals sentence states the shortfall, or omits it entirely', () => {
    // This sentence is the story's whole shortfall claim; it is asserted here
    // rather than left in JSX where deleting the clause would stay green.
    expect(
      orderTotalsLabel({ lines: 2, qty: 18, reservedQty: 18, shortfallQty: 0, backorderedLines: 0 }),
    ).toBe('2 lines · 18 units ordered · 18 units reserved');
    expect(
      orderTotalsLabel({ lines: 2, qty: 18, reservedQty: 13, shortfallQty: 5, backorderedLines: 1 }),
    ).toBe('2 lines · 18 units ordered · 13 units reserved · 5 units short across 1 backordered line');
    expect(
      orderTotalsLabel({ lines: 4, qty: 40, reservedQty: 10, shortfallQty: 30, backorderedLines: 3 }),
    ).toBe('4 lines · 40 units ordered · 10 units reserved · 30 units short across 3 backordered lines');
    expect(
      orderTotalsLabel({ lines: 1, qty: 10, reservedQty: 10, shortfallQty: 0, backorderedLines: 0 }),
    ).toBe('1 line · 10 units ordered · 10 units reserved');
  });
});

describe('createOutcome (over-ATP is acceptance, not failure)', () => {
  test('a fully reservable order reads as a plain acceptance', () => {
    const outcome = createOutcome(
      order({ lines: [line({ qty: 10 }), line({ id: 'line-2', skuId: 'sku-2', qty: 5, reservedQty: 5 })] }),
      skuOf,
    );
    expect(outcome.tone).toBe('accepted');
    expect(outcome.word).toBe('Order accepted');
    expect(outcome.reason).toBe('2 lines, 15 each reserved in full.');
  });

  test('an over-ATP order is accepted with a named shortfall — never rejected', () => {
    const outcome = createOutcome(
      order({
        lines: [
          line({ qty: 10, reservedQty: 10, shortfallQty: 0, status: 'open' }),
          line({
            id: 'line-2',
            skuId: 'sku-2',
            qty: 8,
            reservedQty: 3,
            shortfallQty: 5,
            status: 'backordered',
          }),
        ],
      }),
      skuOf,
    );
    expect(outcome.tone).toBe('accepted');
    expect(outcome.word).toBe('Accepted with a shortfall');
    expect(outcome.reason).toBe(
      '13 each of 18 each reserved; 1 of 2 lines backordered — SPICE-02 short 5 each.',
    );
  });

  test('a measured SKU names its short quantity at its own unit, inside a mixed order too', () => {
    const outcome = createOutcome(
      order({
        lines: [
          line({ qty: 10, reservedQty: 10, shortfallQty: 0, status: 'open' }),
          line({
            id: 'line-2',
            skuId: 'sku-kg',
            qty: 2.5,
            reservedQty: 1.25,
            shortfallQty: 1.5,
            status: 'backordered',
          }),
        ],
      }),
      skuOf,
    );
    expect(outcome.tone).toBe('accepted');
    expect(outcome.word).toBe('Accepted with a shortfall');
    // The totals stay unit-agnostic (mixed units share nothing) while the
    // named short line renders at its own SKU's declared precision.
    expect(outcome.reason).toBe(
      '11.25 units of 12.5 units reserved; 1 of 2 lines backordered — FLOUR-01 short 1.500 kg.',
    );
  });

  test('an unresolvable SKU falls back to the raw id and the unit-agnostic fallback', () => {
    const outcome = createOutcome(
      order({
        lines: [line({ skuId: 'sku-gone', qty: 2.5, reservedQty: 0, shortfallQty: 2.5, status: 'backordered' })],
      }),
      skuOf,
    );
    expect(outcome.reason).toBe(
      '0 units of 2.5 units reserved; 1 of 1 lines backordered — sku-gone short 2.5 units.',
    );
  });

  test('a single line reads in the singular', () => {
    expect(createOutcome(order(), skuOf).reason).toBe('1 line, 10 each reserved in full.');
  });

  test('the named short lines are capped — 200 lines must not become a paragraph', () => {
    const lines = Array.from({ length: MAX_NAMED_SHORT_LINES + 3 }, (_, i) =>
      line({ id: `line-${i}`, skuId: `sku-${i}`, qty: 2, reservedQty: 0, shortfallQty: 2, status: 'backordered' }),
    );
    const reason = createOutcome(order({ lines }), (skuId) => ({
      code: skuId,
      uom: 'each',
      uomPrecision: 0,
    })).reason;
    expect(reason).toContain('…and 3 more');
    expect(reason.match(/short 2 each/g)).toHaveLength(MAX_NAMED_SHORT_LINES);
  });

  test('cancelling reports the released lines', () => {
    const outcome = cancelOutcome(order({ status: 'cancelled' }));
    expect(outcome.tone).toBe('accepted');
    expect(outcome.word).toBe('Order cancelled');
    expect(outcome.reason).toBe('1 line released; the order reads cancelled.');
  });
});

describe('createReason (branching on the problem code)', () => {
  test('each creation problem code maps to its plain-words reason', () => {
    expect(createReason(new ApiProblem('role-denied', 403))).toBe('Your role cannot create orders.');
    expect(createReason(new ApiProblem('idempotency-key-reuse', 422))).toBe(
      'This submission was already processed.',
    );
    expect(createReason(new ApiProblem('unauthenticated', 401))).toBe(
      'Your session expired — sign in again.',
    );
    expect(createReason(new ApiProblem('reservation-store-unavailable', 503))).toBe(
      'The reservation store is unreachable — nothing was created; retry in a moment.',
    );
    expect(createReason(new ApiProblem('validation-failed', 400, 'lines must not be empty'))).toBe(
      'lines must not be empty',
    );
    expect(createReason(new ApiProblem('weird-code', 400))).toBe('Order not created (weird-code).');
  });

  test('the arms the backend genuinely raises are covered, not assumed', () => {
    expect(createReason(new ApiProblem('not-found', 404))).toBe(
      'The warehouse or a line SKU no longer exists — refresh and try again.',
    );
    // not-found's detail names which one, so it wins when present.
    expect(createReason(new ApiProblem('not-found', 404, 'SKU "sku-9" does not exist.'))).toBe(
      'SKU "sku-9" does not exist.',
    );
    expect(createReason(new ApiProblem('permission-denied', 403))).toBe(
      'That warehouse belongs to another tenant — sign in again.',
    );
    // Both of these are real 422/409 arms on POST /outbound/orders.
    expect(createReason(new ApiProblem('order-source-conflict', 422))).toBe(
      'That channel reference already created a different order.',
    );
    expect(createReason(new ApiProblem('conflict', 409))).toBe(
      'The same submission is still in flight — retry to read the settled result.',
    );
  });

  test('a transport failure falls back to the house copy', () => {
    expect(createReason(new TypeError('fetch failed'))).toBe(UNREACHABLE_REASON);
  });
});

describe('cancelReason (a 409 is the server’s words, verbatim)', () => {
  // What wms-be actually emits: ProblemException sets `message` to the
  // DETAIL and the problem-details filter renders `title` from
  // `exception.message`, so title === detail on every cancel refusal.
  const committed =
    'Order "0198f7a2" has 2 committed reservation(s) — a consuming flow already claimed them; the order is not cancellable here.';
  const drawn =
    'Order "0198f7a2" has 1 drawn pick line(s) — the order is not cancellable here.';

  test('the refusal renders once, not doubled, when title and detail are the same sentence', () => {
    // Committed reservations and drawn pick lines are invisible in every DTO
    // the client holds — only the backend can say which one refused.
    expect(cancelReason(new ApiProblem('conflict', 409, committed, committed))).toBe(committed);
    expect(cancelReason(new ApiProblem('conflict', 409, drawn, drawn))).toBe(drawn);
  });

  test('a title and detail that genuinely differ are both rendered', () => {
    // Defensive, not observed: no wms-be endpoint emits this shape today,
    // but RFC 9457 allows it and dropping half a refusal would be worse.
    expect(
      cancelReason(new ApiProblem('conflict', 409, 'Reservation res-7 is committed.', 'Order cannot be cancelled')),
    ).toBe('Order cannot be cancelled — Reservation res-7 is committed.');
  });

  test('a 409 with neither title nor detail names the code rather than inventing prose', () => {
    expect(cancelReason(new ApiProblem('conflict', 409))).toBe('The request was refused (conflict).');
  });

  test('non-409 failures branch on the code as usual', () => {
    expect(cancelReason(new ApiProblem('not-found', 404))).toBe(
      'This order no longer exists — refresh the list.',
    );
    expect(cancelReason(new ApiProblem('role-denied', 403))).toBe('Your role cannot cancel orders.');
    expect(cancelReason(new ApiProblem('idempotency-key-reuse', 422))).toBe(
      'This cancellation was already processed.',
    );
    expect(cancelReason(new ApiProblem('reservation-store-unavailable', 503))).toBe(
      'The reservation store is unreachable — nothing changed; retry in a moment.',
    );
    expect(cancelReason(new TypeError('fetch failed'))).toBe(UNREACHABLE_REASON);
  });
});

describe('detailReason (the expanded row’s own failure)', () => {
  test('the row explains itself without touching the list', () => {
    expect(detailReason(new ApiProblem('not-found', 404))).toBe(
      'This order no longer exists — refresh the list.',
    );
    expect(detailReason(new ApiProblem('boom', 500))).toBe('Detail unavailable (boom).');
    expect(detailReason(new TypeError('fetch failed'))).toBe(UNREACHABLE_REASON);
  });

  test('permission-denied is handled, not leaked as raw server prose', () => {
    // Documented on getOrder; without this arm the default branch would put
    // the backend's own sentence inside a role="alert".
    expect(detailReason(new ApiProblem('permission-denied', 403, 'Session tenant mismatch.'))).toBe(
      'That order belongs to another tenant — sign in again.',
    );
  });
});

describe('readReason (the surface-level reads report their own failure)', () => {
  test('an unreachable API is the house copy, for every read', () => {
    expect(readReason(new TypeError('fetch failed'), 'orders')).toBe(UNREACHABLE_REASON);
    expect(readReason(new TypeError('fetch failed'), 'warehouses')).toBe(UNREACHABLE_REASON);
  });

  test('each read problem code maps to plain words naming what failed to load', () => {
    expect(readReason(new ApiProblem('unauthenticated', 401), 'orders')).toBe(
      'Your session expired — sign in again.',
    );
    expect(readReason(new ApiProblem('permission-denied', 403), 'orders')).toBe(
      'That data belongs to another tenant — sign in again.',
    );
    expect(readReason(new ApiProblem('not-found', 404), 'orders')).toBe(
      'orders could not be found — refresh the page.',
    );
    expect(readReason(new ApiProblem('invalid-cursor', 400), 'orders')).toBe(
      'That page reference is stale — go back to the first page.',
    );
    expect(readReason(new ApiProblem('boom', 500), 'the SKU list')).toBe(
      'Could not load the SKU list (boom).',
    );
  });
});

describe('the page-scoped status filter', () => {
  // Annotated with the lifecycle union rather than three literal types:
  // `filterPage` is now generic over the row's own status union (the waves
  // surface filters its three arms through the same function), so the rows a
  // test hands it must declare the union they belong to.
  const rows: readonly { id: string; status: OrderStatus }[] = [
    { id: 'a', status: 'accepted' },
    { id: 'b', status: 'cancelled' },
    { id: 'c', status: 'accepted' },
  ];

  test('no filter keeps the loaded page intact', () => {
    expect(filterPage(rows, null)).toEqual(rows);
  });

  test('a chosen status keeps only the matching rows of the loaded page', () => {
    expect(filterPage(rows, 'accepted').map((r) => r.id)).toEqual(['a', 'c']);
    expect(filterPage(rows, 'dispatched')).toEqual([]);
  });

  test('the count states the scope it actually searched', () => {
    expect(pageFilterCount(2, 3)).toBe('2 of 3 on this page');
  });
});

describe('parseDraftLines (nothing is sent that the backend would only 400)', () => {
  test('a valid draft parses to the request body', () => {
    expect(parseDraftLines([{ skuId: 'sku-1', quantity: '4' }])).toEqual({
      lines: [{ skuId: 'sku-1', quantity: 4 }],
      problem: null,
    });
  });

  test('wholly empty rows are dropped rather than rejected', () => {
    expect(
      parseDraftLines([
        { skuId: 'sku-1', quantity: '4' },
        { skuId: '', quantity: '' },
      ]),
    ).toEqual({ lines: [{ skuId: 'sku-1', quantity: 4 }], problem: null });
  });

  test('a draft with no filled line is refused before any request', () => {
    expect(parseDraftLines([{ skuId: '', quantity: '' }]).problem).toBe(
      'Add at least one line — a SKU and a quantity.',
    );
    expect(parseDraftLines([]).problem).toBe('Add at least one line — a SKU and a quantity.');
  });

  test('more than 200 lines is refused before any request', () => {
    const draft = Array.from({ length: MAX_ORDER_LINES + 1 }, () => ({ skuId: 'sku-1', quantity: '1' }));
    expect(parseDraftLines(draft).problem).toBe('An order carries at most 200 lines.');
  });

  test('a decimal quantity is accepted — the order form no longer refuses what the backend accepts', () => {
    // Story 10.5: quantities are fractional now. A decimal literal is in the
    // grammar, the backend's floor is `@Min(0.001)`, and the precision is
    // never clamped here.
    expect(parseDraftLines([{ skuId: 'sku-1', quantity: '2.5' }])).toEqual({
      lines: [{ skuId: 'sku-1', quantity: 2.5 }],
      problem: null,
    });
    // Sub-1 fractional lines are accepted server-side (`@Min(0.001)`), so the
    // parser passes them — refusing 0.5 would refuse a body the backend takes.
    expect(parseDraftLines([{ skuId: 'sku-1', quantity: '0.5' }])).toEqual({
      lines: [{ skuId: 'sku-1', quantity: 0.5 }],
      problem: null,
    });
  });

  test('a value finer than any unit declares passes through for the server to refuse', () => {
    // The client validates shape, never precision — 0.0004 is a decimal
    // literal the parser must not round or clamp.
    expect(parseDraftLines([{ skuId: 'sku-1', quantity: '0.0004' }])).toEqual({
      lines: [{ skuId: 'sku-1', quantity: 0.0004 }],
      problem: null,
    });
    expect(parseDraftLines([{ skuId: 'sku-1', quantity: '2.5004' }])).toEqual({
      lines: [{ skuId: 'sku-1', quantity: 2.5004 }],
      problem: null,
    });
  });

  test('zero and non-shape quantities are refused before any request', () => {
    // Zero is the backend's own refusal (`@Min(0.001)`), so the parser keeps
    // it off the wire; the magnitude floor is zero, not one.
    const expected = 'Every quantity is a decimal greater than zero.';
    expect(parseDraftLines([{ skuId: 'sku-1', quantity: '0' }]).problem).toBe(expected);
    expect(parseDraftLines([{ skuId: 'sku-1', quantity: '0.000' }]).problem).toBe(expected);
    expect(parseDraftLines([{ skuId: 'sku-1', quantity: '-3' }]).problem).toBe(expected);
    expect(parseDraftLines([{ skuId: 'sku-1', quantity: 'abc' }]).problem).toBe(expected);
    expect(parseDraftLines([{ skuId: 'sku-1', quantity: '2.' }]).problem).toBe(expected);
  });

  test('numeric notations Number() accepts but the field and backend do not are refused', () => {
    // `Number('1e3')` is 1000 and `Number('0x10')` is 16 — neither can come
    // out of a type="number" field, and both are silent quantity changes.
    const expected = 'Every quantity is a decimal greater than zero.';
    expect(parseDraftLines([{ skuId: 'sku-1', quantity: '1e3' }]).problem).toBe(expected);
    expect(parseDraftLines([{ skuId: 'sku-1', quantity: '0x10' }]).problem).toBe(expected);
    expect(parseDraftLines([{ skuId: 'sku-1', quantity: '+4' }]).problem).toBe(expected);
    expect(parseDraftLines([{ skuId: 'sku-1', quantity: 'Infinity' }]).problem).toBe(expected);
  });

  test('a quantity above the backend int32 maximum is refused, naming the bound', () => {
    expect(parseDraftLines([{ skuId: 'sku-1', quantity: String(MAX_LINE_QUANTITY) }]).problem).toBeNull();
    expect(parseDraftLines([{ skuId: 'sku-1', quantity: String(MAX_LINE_QUANTITY + 1) }]).problem).toBe(
      'A line quantity is at most 2147483647.',
    );
  });

  test('a quantity without a SKU is refused before any request', () => {
    expect(parseDraftLines([{ skuId: '', quantity: '4' }]).problem).toBe('Every line needs a SKU.');
  });
});
