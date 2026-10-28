import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { BinResponse, CancelWithRestockResponse, OrderDto } from '@/lib/api/generated';
import {
  cancelWithRestockReason,
  defaultRestockDestination,
  parseRestockDestination,
  RESTOCK_BOOKING_WINDOW,
  restockBinOptionLabel,
  restockBinOptions,
  restockLineLabel,
  restockManifestedRefusal,
  restockOutcome,
  restockQuantityLabel,
  restockRecallWarnings,
  restockVoidNotice,
  UNREACHABLE_REASON,
} from '@/lib/outbound-orders';
import { shipmentVoidedLabel } from '@/lib/outbound-pack-dispatch';

/**
 * Story 4-2b — the cancel-with-restock copy and derivations the shared
 * Cancel dialog renders: the refusal mapper, the put-back line, the default
 * destination (A8), the recall warning, the void / manifested copy, the bin
 * options and the outcome.
 */

describe('cancelWithRestockReason', () => {
  test('every 409 is the server’s words, whatever its code', () => {
    for (const code of ['order-dispatched', 'shipment-manifested', 'bin-full', 'bin-segregation-conflict', 'restock-serial-moved', 'conflict']) {
      expect(cancelWithRestockReason(new ApiProblem(code, 409, `detail of ${code}`))).toBe(`detail of ${code}`);
    }
    expect(cancelWithRestockReason(new ApiProblem('bin-blocked', 409, 'Bin A-01 is blocked', 'Bin blocked'))).toBe(
      'Bin blocked — Bin A-01 is blocked',
    );
  });

  test('a 400, 404 or 422 shows its detail as sent', () => {
    expect(cancelWithRestockReason(new ApiProblem('validation-failed', 400, 'RECEIVING is a system bin'))).toBe('RECEIVING is a system bin');
    expect(cancelWithRestockReason(new ApiProblem('not-found', 404, 'Bin not found in this warehouse'))).toBe('Bin not found in this warehouse');
    expect(cancelWithRestockReason(new ApiProblem('idempotency-key-reuse', 422, 'Key reused with another body'))).toBe(
      'Key reused with another body',
    );
  });

  test('without a detail, the cancel arms apply', () => {
    expect(cancelWithRestockReason(new ApiProblem('not-found', 404))).toBe('This order no longer exists — refresh the list.');
    expect(cancelWithRestockReason(new ApiProblem('role-denied', 403))).toBe('Your role cannot cancel orders.');
    expect(cancelWithRestockReason(new ApiProblem('idempotency-key-reuse', 422))).toBe('This cancellation was already processed.');
    expect(cancelWithRestockReason(new ApiProblem('unavailable', 503))).toContain('retry in a moment');
    expect(cancelWithRestockReason(new TypeError('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });
});

describe('restockLineLabel', () => {
  const base = { skuCode: 'TEE-M', qty: 3, uom: 'each', toBinCode: 'A-01-01', batchCode: null };
  test('SKU × qty → bin, at the unit’s precision', () => {
    expect(restockLineLabel(base, { uom: 'each', uomPrecision: 0 })).toBe('TEE-M × 3 each → A-01-01');
    expect(restockLineLabel({ ...base, qty: 2.5, uom: 'kg' }, { uom: 'kg', uomPrecision: 3 })).toBe('TEE-M × 2.500 kg → A-01-01');
  });
  test('the batch in brackets', () => {
    expect(restockLineLabel({ ...base, batchCode: 'LOT-7' }, { uom: 'each', uomPrecision: 0 })).toBe('TEE-M × 3 each → A-01-01 (LOT-7)');
  });
  test('an unresolved SKU keeps the line’s own unit and never rounds', () => {
    expect(restockLineLabel({ ...base, qty: 1.25, uom: 'kg' })).toBe('TEE-M × 1.25 kg → A-01-01');
    expect(restockQuantityLabel({ qty: 1200, uom: 'each' }, null)).toBe('1,200 each');
  });
});

describe('defaultRestockDestination (A8)', () => {
  test('an accepted order goes back to its origin bins', () => {
    expect(defaultRestockDestination('accepted', [{ recallCode: null }])).toBe('origin');
    expect(defaultRestockDestination('accepted', [])).toBe('origin');
  });
  test('a packed order defaults to one bin', () => {
    expect(defaultRestockDestination('ready_to_dispatch', [{ recallCode: null }])).toBe('bin');
  });
  test('a plan carrying a recalled lot defaults to one bin', () => {
    expect(defaultRestockDestination('accepted', [{ recallCode: null }, { recallCode: 'RCL-3' }])).toBe('bin');
  });
});

describe('the dialog copy', () => {
  test('the booking window', () => {
    expect(RESTOCK_BOOKING_WINDOW).toBe('Stock is booked into these bins now — put the units back before the bins are counted.');
  });
  test('one recall warning per recalled lot', () => {
    const warnings = restockRecallWarnings([
      { batchCode: 'LOT-7', recallCode: 'RCL-3' },
      { batchCode: 'LOT-7', recallCode: 'RCL-3' },
      { batchCode: 'LOT-8', recallCode: null },
    ]);
    expect(warnings).toEqual([
      'Lot LOT-7 is under recall RCL-3 — its units stay blocked wherever they are put back; choose a bin set aside for held stock, because a pick from a bin holding a recalled lot is refused.',
    ]);
  });
  test('the void notice and the manifested refusal name the label', () => {
    const shipment = { carrierName: 'Delhivery', trackingNumber: 'DL123' };
    expect(restockVoidNotice(shipment)).toBe('The label Delhivery DL123 will be voided.');
    expect(restockManifestedRefusal(shipment)).toContain('Delhivery DL123');
    expect(restockManifestedRefusal(shipment)).toContain('return');
  });
  test('a voided label names when and who when it can', () => {
    expect(shipmentVoidedLabel({ voidedAt: '2026-10-13T08:33:00.000Z', voidedBy: 'ops@x.in' })).toBe(
      'Voided 13 Oct 2026, 14:03 by ops@x.in — the order was cancelled before it was manifested; this label cannot be used.',
    );
    expect(shipmentVoidedLabel({})).toBe('Voided — the order was cancelled before it was manifested; this label cannot be used.');
  });
});

describe('restock bins', () => {
  const bin = (code: string, patch: Partial<BinResponse> = {}): BinResponse =>
    ({ id: `id-${code}`, code, systemOwned: false, retiredAt: null, blocked: false, ...patch }) as BinResponse;
  test('storage bins only, by code; blocked ones are marked', () => {
    const options = restockBinOptions([
      bin('B-02'),
      bin('RECEIVING', { systemOwned: true }),
      bin('A-01'),
      bin('Z-09', { retiredAt: '2026-01-01T00:00:00Z' }),
      bin('C-03', { blocked: true }),
    ]);
    expect(options.map((b) => b.code)).toEqual(['A-01', 'B-02', 'C-03']);
    expect(restockBinOptionLabel(options[2]!)).toBe('C-03 — blocked');
  });
  test('one bin needs its bin; origin sends an empty body', () => {
    expect(parseRestockDestination('origin', '')).toEqual({ body: {}, problem: null });
    expect(parseRestockDestination('bin', ' ')).toEqual({ body: null, problem: 'Pick the bin every unit goes back to.' });
    expect(parseRestockDestination('bin', 'bin-1')).toEqual({ body: { restockBinId: 'bin-1' }, problem: null });
  });
});

describe('restockOutcome', () => {
  const order = { id: 'o1' } as OrderDto;
  test('names lines, holds and the voided label from the response', () => {
    const response = {
      order,
      restock: {
        restockId: 'r1',
        restockedAt: '2026-10-13T08:33:00.000Z',
        destination: 'bin',
        restockBinId: 'b1',
        lines: [{}, {}],
        totalUnits: 4,
        cancelledPickLineCount: 0,
        releasedReservationIds: ['h1'],
        retiredReservationIds: ['h2'],
        handlingUnitIds: [],
        voidedShipment: { id: 's1', carrierName: 'Delhivery', trackingNumber: 'DL123' },
      },
    } as unknown as CancelWithRestockResponse;
    expect(restockOutcome(response, 'SO-1')).toEqual({
      tone: 'accepted',
      word: 'Order SO-1 cancelled',
      reason: '2 lines booked back into stock; 2 holds released; label Delhivery DL123 voided.',
    });
  });
  test('the already-cancelled no-op', () => {
    expect(restockOutcome({ order, restock: null }, 'SO-1').reason).toBe('It was already cancelled — nothing changed.');
  });
});
