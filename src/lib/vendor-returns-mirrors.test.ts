import { describe, expect, test } from 'bun:test';

import { adjustReason, damagedClaimedByRtvReason } from './adjust';
import { ApiProblem } from './api/client';
import { AUDIT_TARGET_LABEL } from './audit';
import { departureBlockerLine } from './clients';
import { LEDGER_EVENT_TYPES, LEDGER_TYPE_LABEL, ledgerTypeLabel } from './drill';
import { ledgerReferenceLabel } from './ledger';
import {
  RTV_PICK_CLOSED_GUIDANCE,
  RTV_PICK_GUIDANCE,
  rejectedOpGuidance,
  rejectedOpSummary,
  rtvPickGuidance,
  rtvPickSummary,
} from './review-queue';
import { writeOffReason } from './write-off';

/**
 * Story 2-8b — the label maps and refusal mappers that mirror the backend's
 * new vocabulary: the ledger type, the audit target, the wind-down blocker,
 * the review-queue `rtv.pick` row, and the write-off's
 * `damaged-claimed-by-rtv`.
 */

describe('the 2-8b mirrors', () => {
  test('rtv.dispatched is a timeline type, labelled "Returned to vendor"', () => {
    expect(LEDGER_EVENT_TYPES).toContain('rtv.dispatched');
    expect(LEDGER_TYPE_LABEL['rtv.dispatched']).toBe('Returned to vendor');
    expect(ledgerTypeLabel('rtv.dispatched')).toBe('Returned to vendor');
  });

  test("the vendor-return reference names the return and the GRN line, a GRN receipt's line is unchanged", () => {
    expect(
      ledgerReferenceLabel({
        kind: 'vendor-return',
        vendorReturnId: '0198f7a2-1b3c-7d4e-8f90-0000000000f1',
        vendorReturnLineId: '0198f7a2-1b3c-7d4e-8f90-0000000001a1',
        grnLineId: '0198f7a2-1b3c-7d4e-8f90-0000000000e1',
      }),
    ).toBe('vendor-return · return to vendor 0198f7a2 · GRN line 0198f7a2');
    expect(ledgerReferenceLabel({ kind: 'grn-receipt', grnId: '0198aaaa-grn', grnLineId: 'x' })).not.toContain('GRN line');
  });

  test('the audit target and the wind-down blocker are named', () => {
    expect(AUDIT_TARGET_LABEL.vendor_return).toBe('Return to vendor');
    expect(departureBlockerLine({ kind: 'open-vendor-returns', count: 2, codes: ['RTV-0001', 'RTV-0002'] })).toContain('2 open returns to vendor');
    expect(departureBlockerLine({ kind: 'open-vendor-returns', count: 1, codes: ['RTV-0001'] })).toContain('1 open return to vendor');
  });

  test('A2 — a write-off of claimed damaged units names the returns (both the Adjust and the Write off mappers)', () => {
    const error = new ApiProblem('damaged-claimed-by-rtv', 409, 'detail', 'Damaged units are claimed by a return to vendor', {
      vendorReturnCodes: ['RTV-0001'],
      claimedQty: 4,
      onHandQty: 6,
    });
    const sentence = 'These damaged units are claimed by RTV-0001 (4 of the 6 on hand) — cancel the return to vendor first, or write off fewer units.';
    expect(damagedClaimedByRtvReason(error)).toBe(sentence);
    expect(adjustReason(error)).toBe(sentence);
    expect(writeOffReason(error)).toBe(sentence);
    expect(damagedClaimedByRtvReason(new ApiProblem('damaged-claimed-by-rtv', 409))).toBe(
      'These damaged units are claimed by an open return to vendor — cancel the return to vendor first, or write off fewer units.',
    );
  });

  test('an rtv.pick row: Discard-only guidance (the pick moved nothing) and its summary', () => {
    const entry = {
      opType: 'rtv.pick' as const,
      problemCode: 'rtv-not-draft',
      payload: {
        vendorReturnId: '0198f7a2-1b3c-7d4e-8f90-0000000000f1',
        warehouseId: 'w',
        occurredAt: '2026-10-21T06:00:00.000Z',
        lines: [
          { lineId: 'a', pickedQty: 5 },
          { lineId: 'b', pickedQty: 1.25 },
        ],
      },
    };
    expect(rtvPickGuidance('rtv-not-draft')).toBe(RTV_PICK_CLOSED_GUIDANCE);
    expect(rtvPickGuidance('rtv-pick-mismatch')).toBe(RTV_PICK_GUIDANCE);
    expect(RTV_PICK_GUIDANCE).toContain('The pick moved nothing');
    expect(RTV_PICK_GUIDANCE).toContain('DAMAGED');
    expect(rejectedOpGuidance(entry)).toEqual([RTV_PICK_CLOSED_GUIDANCE]);
    const summary = rtvPickSummary(entry);
    expect(summary).toEqual({
      heading: 'return to vendor …000000f1 — pick not recorded',
      lines: ['2 lines · 6.25 units picked · at 21 Oct 2026, 11:30 IST — the return was no longer a draft'],
    });
    expect(rejectedOpSummary(entry)).toEqual(summary);
    // A stored row is data: a malformed payload still reads.
    expect(rtvPickSummary({ problemCode: 'weird', payload: { lines: 'nope' } })).toEqual({
      heading: 'unknown return to vendor — pick not recorded',
      lines: ['0 lines — weird'],
    });
  });
});
