import { describe, expect, test } from 'bun:test';

import { adjustReason, damagedClaimedByRtcReason, damagedClaimedByRtvReason } from './adjust';
import { ApiProblem } from './api/client';
import { AUDIT_TARGET_LABEL } from './audit';
import { departureBlockerLine } from './clients';
import { LEDGER_EVENT_TYPES, LEDGER_TYPE_LABEL, ledgerTypeLabel } from './drill';
import { ledgerReferenceLabel } from './ledger';
import {
  PORTAL_CLIENT_RETURN_STATUS_LABEL,
  portalClientReturnCarrier,
  portalClientReturnQuantity,
  portalClientReturnTone,
  portalDispositionSummary,
  portalReturnDecisionState,
} from './portal';
import { lineAwaitsDisposition, lineDispositionSplit, lineDispositionState, lineDispositionText, RETURNING_TO_CLIENT_BADGE } from './returns';
import { RTC_PICK_CLOSED_GUIDANCE, RTC_PICK_GUIDANCE, STOCK_ADJUST_PROBLEM_WORDS, rejectedOpGuidance, rejectedOpSummary, rtcPickGuidance, rtcPickSummary } from './review-queue';
import { writeOffReason } from './write-off';

/**
 * Story 4-7c — the label maps and refusal mappers that mirror the backend's
 * new vocabulary: the ledger type, the audit target, the wind-down blocker,
 * the review-queue `rtc.pick` row, the write-off's second stage
 * `damaged-claimed-by-rtc` (2-8b's first stage byte-identical), the RMA badge
 * (A5) and the portal's RTC words (A14) and split figures.
 */

describe('the 4-7c mirrors', () => {
  test('rtc.dispatched is a timeline type, labelled "Returned to client"', () => {
    expect(LEDGER_EVENT_TYPES).toContain('rtc.dispatched');
    expect(LEDGER_TYPE_LABEL['rtc.dispatched']).toBe('Returned to client');
    expect(ledgerTypeLabel('rtc.dispatched')).toBe('Returned to client');
    expect(LEDGER_TYPE_LABEL['rtv.dispatched']).toBe('Returned to vendor');
  });

  test('the client-return reference names the return and, for a RETURNS line, its RMA', () => {
    expect(
      ledgerReferenceLabel({
        kind: 'client-return',
        clientReturnId: '0198f7a2-1b3c-7d4e-8f90-0000000003f1',
        clientReturnLineId: '0198f7a2-1b3c-7d4e-8f90-0000000003b1',
        returnReceiptLineId: '0198f7a2-1b3c-7d4e-8f90-0000000002a1',
        rmaId: '0198f7a2-1b3c-7d4e-8f90-0000000004a1',
      }),
    ).toBe('client-return · return to client 0198f7a2 · RMA 0198f7a2');
    expect(ledgerReferenceLabel({ kind: 'client-return', clientReturnId: '0198f7a2-1b3c-7d4e-8f90-0000000003f1' })).toBe('client-return · return to client 0198f7a2');
  });

  test('the audit target and the wind-down blocker are named', () => {
    expect(AUDIT_TARGET_LABEL.client_return).toBe('Return to client');
    expect(departureBlockerLine({ kind: 'open-client-returns', count: 2, codes: ['RTC-0001', 'RTC-0002'] })).toContain('2 open returns to client');
    expect(departureBlockerLine({ kind: 'open-client-returns', count: 1, codes: ['RTC-0001'] })).toContain('1 open return to client');
  });

  test('D3 — the write-off second stage names the RTCs (and any RTVs); the first stage is unchanged', () => {
    const error = new ApiProblem('damaged-claimed-by-rtc', 409, 'detail', 'title', {
      clientReturnCodes: ['RTC-0001'],
      vendorReturnCodes: ['RTV-0002'],
      claimedQty: 5,
      onHandQty: 6,
    });
    const sentence = 'These damaged units are claimed by RTC-0001, RTV-0002 (5 of the 6 on hand) — cancel the return to client (or vendor) first, or write off fewer units.';
    expect(damagedClaimedByRtcReason(error)).toBe(sentence);
    expect(adjustReason(error)).toBe(sentence);
    expect(writeOffReason(error)).toBe(sentence);
    expect(STOCK_ADJUST_PROBLEM_WORDS['damaged-claimed-by-rtc']).toBe('the damaged units are claimed by a return to client');
    expect(damagedClaimedByRtvReason(new ApiProblem('damaged-claimed-by-rtv', 409, 'd', 't', { vendorReturnCodes: ['RTV-0001'], claimedQty: 4, onHandQty: 6 }))).toBe(
      'These damaged units are claimed by RTV-0001 (4 of the 6 on hand) — cancel the return to vendor first, or write off fewer units.',
    );
  });

  test('an rtc.pick row: Discard-only guidance (the pick moved nothing) and its summary', () => {
    const entry = {
      opType: 'rtc.pick' as const,
      problemCode: 'rtc-not-draft',
      payload: {
        clientReturnId: '0198f7a2-1b3c-7d4e-8f90-0000000003f1',
        warehouseId: 'w',
        occurredAt: '2026-10-21T06:00:00.000Z',
        lines: [
          { lineId: 'a', pickedQty: 3 },
          { lineId: 'b', pickedQty: 1.5 },
        ],
      },
    };
    expect(rtcPickGuidance('rtc-not-draft')).toBe(RTC_PICK_CLOSED_GUIDANCE);
    expect(rtcPickGuidance('rtc-pick-mismatch')).toBe(RTC_PICK_GUIDANCE);
    expect(RTC_PICK_GUIDANCE).toContain('The pick moved nothing');
    expect(RTC_PICK_GUIDANCE).toContain('Returns or Damaged area');
    expect(rejectedOpGuidance(entry)).toEqual([RTC_PICK_CLOSED_GUIDANCE]);
    const summary = rtcPickSummary(entry);
    expect(summary).toEqual({
      heading: 'return to client …000003f1 — pick not recorded',
      lines: ['2 lines · 4.5 units picked · at 21 Oct 2026, 11:30 IST — the return to client was no longer a draft'],
    });
    expect(rejectedOpSummary(entry)).toEqual(summary);
    expect(rtcPickSummary({ problemCode: 'weird', payload: { lines: 'nope' } })).toEqual({
      heading: 'unknown return to client — pick not recorded',
      lines: ['0 lines — weird'],
    });
  });
});

describe('A5 — a line on a draft or picked RTC still awaits; "Returning to client"', () => {
  const line = (over: Record<string, unknown> = {}) => ({
    rmaLineId: 'rl-1',
    qty: 4,
    openQty: 0,
    restockedQty: 0,
    scrappedQty: 0,
    onHoldQty: 0,
    failedInspectionQty: 0,
    ...over,
  });

  test('returningToClientQty > 0 with nothing else open → returning-to-client (awaiting); shipped → dispositioned', () => {
    expect(RETURNING_TO_CLIENT_BADGE).toBe('⇢ Returning to client');
    expect(lineDispositionState('rl-1', [{ lines: [line({ returningToClientQty: 4 })] }])).toBe('returning-to-client');
    expect(lineAwaitsDisposition('rl-1', [{ lines: [line({ returningToClientQty: 4 })] }])).toBe(true);
    expect(lineDispositionState('rl-1', [{ lines: [line({ returnedToClientQty: 4 })] }])).toBe('dispositioned');
    // Units still open win: the amber awaiting badge.
    expect(lineDispositionState('rl-1', [{ lines: [line({ openQty: 1, returningToClientQty: 3 })] }])).toBe('awaiting');
  });

  test('A6 — a pre-4-7c snapshot without the fields reads 0', () => {
    expect(lineDispositionState('rl-1', [{ lines: [line({ restockedQty: 4 })] }])).toBe('dispositioned');
    const split = lineDispositionSplit('rl-1', [{ lines: [line({ restockedQty: 4 })] }])!;
    expect(split.returningToClient).toBe(0);
    expect(split.returnedToClient).toBe(0);
  });

  test('the split text names both', () => {
    const split = lineDispositionSplit('rl-1', [{ lines: [line({ openQty: 0, returningToClientQty: 1, returnedToClientQty: 3 })] }])!;
    expect(lineDispositionText(split, { uom: 'each', uomPrecision: 0 })).toBe('1 returning to client · 3 returned to client');
  });
});

describe('the portal — A14 statuses, the split figures', () => {
  test('draft and picked read "Being prepared", dispatched "Shipped"', () => {
    expect(PORTAL_CLIENT_RETURN_STATUS_LABEL).toEqual({ draft: 'Being prepared', picked: 'Being prepared', dispatched: 'Shipped', cancelled: 'Cancelled' });
    expect(portalClientReturnTone('picked')).toBe('warning');
    expect(portalClientReturnTone('dispatched')).toBe('success');
    expect(portalClientReturnTone('cancelled')).toBe('neutral');
  });

  test('the carrier and the quantity cells', () => {
    expect(portalClientReturnCarrier({ transporterName: 'VRL Logistics', carrierName: 'x' })).toBe('VRL Logistics');
    expect(portalClientReturnCarrier({ transporterName: null, carrierName: null })).toBe('—');
    expect(portalClientReturnQuantity({ totalQuantity: 7, shippedQuantity: null })).toBe('7');
    expect(portalClientReturnQuantity({ totalQuantity: 7, shippedQuantity: 6 })).toBe('6 of 7 shipped');
    expect(portalClientReturnQuantity({ totalQuantity: 7, shippedQuantity: 7 })).toBe('7');
  });

  test('an RMA’s units on their way back keep it awaiting; shipped ones are said', () => {
    const totals = { receivedTotal: 4, restockedTotal: 0, onHoldTotal: 0, failedInspectionTotal: 0, scrappedTotal: 0, openTotal: 0 };
    expect(portalReturnDecisionState({ ...totals, returningToClientTotal: 4 })).toEqual({ tone: 'warning', word: '⇢ Being returned to you' });
    expect(portalReturnDecisionState({ ...totals, returningToClientTotal: 0 })).toEqual({ tone: 'success', word: '✓ All decided' });
    expect(portalDispositionSummary({ ...totals, returningToClientTotal: 1, returnedToClientTotal: 3 })).toBe('1 being returned to you · 3 shipped back to you');
  });
});
