import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { CountVarianceEntryResponseDto } from '@/lib/api/generated';
import { UNREACHABLE_REASON } from './outbound-orders';
import {
  MAX_CONSIDERED_EVENT_SEQS,
  RETURN_RECEIVE_REVIEW_GUIDANCE,
  RETURN_RECAPTURE_GUIDANCE,
  RETURN_MASTER_DATA_GUIDANCE,
  returnReceiveGuidance,
  RETURN_REFUSAL_LABEL,
  adjustmentDecisionReason,
  adjustmentListReason,
  isOwnerOnlyVariance,
  ledgerListReason,
  rejectedOpDecisions,
  rejectedOpPayloadBinId,
  rejectedOpSummary,
  rejectedOpsListReason,
  rejectedOpsResolveReason,
  resolveDraftProblem,
  varianceListReason,
  varianceResolveReason,
} from './review-queue';

/**
 * The Conflicts & Reviews queue's pure decisions (story 5-5), pinned here:
 * the approve_adjust statement's shape, the owner-only over-threshold flag,
 * and every machine-problem reason arm the two new queues render.
 * Clients branch on the problem `code`, never on prose.
 */

function problem(code: string, status: number, detail?: string, title?: string): ApiProblem {
  return new ApiProblem(code, status, detail, title);
}

function variance(over: Partial<CountVarianceEntryResponseDto> = {}): CountVarianceEntryResponseDto {
  return {
    id: 'var-1',
    tenantId: 't-1',
    warehouseId: 'w-1',
    taskId: 'task-1',
    binId: 'bin-1',
    skuId: 'sku-1',
    epochConflict: false,
    expectedQuantity: 10,
    countedQuantity: 7,
    delta: -3,
    thresholdQuantity: 5,
    status: 'open',
    consideredEventSeqs: null,
    recountTaskId: null,
    resolvedBy: null,
    resolvedAt: null,
    ledgerLinked: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

describe('resolveDraftProblem (the approve_adjust statement, refused client-side)', () => {
  test('a recount never needs consulted events', () => {
    expect(resolveDraftProblem('recount', [])).toBeNull();
    expect(resolveDraftProblem('recount', [1, 2])).toBeNull();
  });

  test('an empty selection is refused naming the unexplained-adjustment rule', () => {
    expect(resolveDraftProblem('approve_adjust', [])).toContain(
      'Select the ledger events you checked',
    );
  });

  test('a non-empty statement within the cap is buildable', () => {
    expect(resolveDraftProblem('approve_adjust', [1])).toBeNull();
    expect(resolveDraftProblem('approve_adjust', [7, 3])).toBeNull();
    expect(resolveDraftProblem('approve_adjust', [MAX_CONSIDERED_EVENT_SEQS])).toBeNull();
  });

  test('a statement past the 200 ceiling is refused naming the cap', () => {
    const tooMany = Array.from({ length: MAX_CONSIDERED_EVENT_SEQS + 1 }, (_, i) => i + 1);
    expect(resolveDraftProblem('approve_adjust', tooMany)).toContain('at most 200');
  });
});

describe('isOwnerOnlyVariance (the submit-frozen threshold, strictly over)', () => {
  test('strictly over the threshold is an owner decision', () => {
    expect(isOwnerOnlyVariance(variance({ thresholdQuantity: 2, delta: 3 }))).toBe(true);
    expect(isOwnerOnlyVariance(variance({ thresholdQuantity: 2, delta: -3 }))).toBe(true);
  });

  test('at threshold resolves by manager; under is not flagged', () => {
    expect(isOwnerOnlyVariance(variance({ thresholdQuantity: 3, delta: -3 }))).toBe(false);
    expect(isOwnerOnlyVariance(variance({ thresholdQuantity: 3, delta: 1 }))).toBe(false);
  });

  test('a null threshold (policy disabled at submit) is never owner-only', () => {
    expect(isOwnerOnlyVariance(variance({ thresholdQuantity: null, delta: 999 }))).toBe(false);
  });
});

describe('varianceListReason (the queue read arms)', () => {
  test('mapped arms and the default', () => {
    expect(varianceListReason(problem('invalid-cursor', 400))).toContain('restarted from the first');
    // No not-found arm: the variances list route has no 404 server-side, so
    // an unexpected 404 rides the default arm like any other code.
    expect(varianceListReason(problem('permission-denied', 403))).toContain('another tenant');
    expect(varianceListReason(problem('unauthenticated', 401))).toContain('session expired');
    expect(varianceListReason(problem('validation-failed', 400, 'no such filter'))).toBe(
      'no such filter',
    );
    expect(varianceListReason(problem('weird', 500, 'boom'))).toBe('boom');
    expect(varianceListReason(problem('weird', 500))).toContain('variance queue');
  });

  test('a transport error renders the house unreachable copy', () => {
    expect(varianceListReason(new Error('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });
});

describe('varianceResolveReason (the resolve command arms)', () => {
  test('both already-resolved-family 409s name their recovery path', () => {
    expect(varianceResolveReason(problem('variance-resolved', 409))).toContain('queue has refreshed');
    // The basis-moved 409 names its remedy: the sibling recount arm.
    expect(varianceResolveReason(problem('variance-basis-moved', 409))).toContain(
      'Open a recount',
    );
  });

  test('role and threshold arms', () => {
    expect(varianceResolveReason(problem('variance-owner-required', 403))).toContain(
      'only an owner',
    );
    expect(varianceResolveReason(problem('count-task-open', 409))).toContain('bin free');
    expect(varianceResolveReason(problem('role-denied', 403))).toContain('cannot resolve');
  });

  test('house set and fallbacks', () => {
    expect(varianceResolveReason(problem('not-found', 404))).toContain('no longer exists');
    expect(varianceResolveReason(problem('idempotency-key-reuse', 422))).toContain(
      'already processed',
    );
    expect(varianceResolveReason(problem('unauthenticated', 401))).toContain('session expired');
    expect(varianceResolveReason(problem('validation-failed', 400, 'seq unknown'))).toBe(
      'seq unknown',
    );
    expect(varianceResolveReason(problem('weird', 500, 'boom'))).toBe('boom');
    expect(varianceResolveReason(problem('weird', 500))).toContain('Resolve failed');
  });

  test('a transport error renders the house unreachable copy', () => {
    expect(varianceResolveReason(new Error('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });
});

describe('adjustmentListReason (the pendings read arms)', () => {
  test('mapped arms, the default, and the transport arm', () => {
    expect(adjustmentListReason(problem('invalid-cursor', 400))).toContain('restarted');
    expect(adjustmentListReason(problem('not-found', 404))).toContain('no longer exists');
    expect(adjustmentListReason(problem('validation-failed', 400, 'bad filter'))).toBe('bad filter');
    expect(adjustmentListReason(problem('weird', 500))).toContain('adjustment-pending queue');
    expect(adjustmentListReason(new Error('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });
});

describe('adjustmentDecisionReason (the decide command arms)', () => {
  test('a guard-class 409 from the re-executed renders the server words verbatim', () => {
    expect(
      adjustmentDecisionReason(problem('insufficient-on-hand', 409, 'drawn by GRN 3', 'No stock')),
    ).toBe('No stock — drawn by GRN 3');
    // Title alone, and detail alone.
    expect(adjustmentDecisionReason(problem('bin-retired', 409, undefined, 'Bin retired'))).toBe(
      'Bin retired',
    );
    expect(adjustmentDecisionReason(problem('world-moved', 409, 'stock moved mid-flight'))).toBe(
      'stock moved mid-flight',
    );
    expect(adjustmentDecisionReason(problem('world-moved', 409))).toContain('refused');
  });

  test('the decided-in-your-absence 409 names the reload recovery', () => {
    expect(adjustmentDecisionReason(problem('adjustment-pending-decided', 409))).toContain(
      'queue has refreshed',
    );
    expect(adjustmentDecisionReason(problem('conflict', 409))).toContain('queue has refreshed');
  });

  test('the re-execution refusals explain the pending row', () => {
    expect(adjustmentDecisionReason(problem('insufficient-on-hand', 400))).toContain(
      'reject it and re-raise',
    );
    expect(adjustmentDecisionReason(problem('kit-cannot-hold-stock', 400))).toContain(
      'kits hold no stock',
    );
  });

  test('house set and fallbacks', () => {
    expect(adjustmentDecisionReason(problem('idempotency-key-reuse', 422))).toContain('fresh request');
    expect(adjustmentDecisionReason(problem('not-found', 404))).toContain('no longer exists');
    expect(adjustmentDecisionReason(problem('role-denied', 403))).toContain('cannot decide');
    expect(adjustmentDecisionReason(problem('unauthenticated', 401))).toContain('session expired');
    expect(adjustmentDecisionReason(problem('validation-failed', 400, 'bad qty'))).toBe('bad qty');
    expect(adjustmentDecisionReason(problem('weird', 500, 'boom'))).toBe('boom');
    expect(adjustmentDecisionReason(problem('weird', 500))).toContain('Decision failed');
  });

  test('a transport error renders the house unreachable copy', () => {
    expect(adjustmentDecisionReason(new Error('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });
});

describe('ledgerListReason (the bin timeline read arms)', () => {
  test('mapped arms, the default, and the transport arm', () => {
    expect(ledgerListReason(problem('invalid-cursor', 400))).toContain('restarted');
    expect(ledgerListReason(problem('not-found', 404))).toContain('no longer exists');
    expect(ledgerListReason(problem('validation-failed', 400, 'bad binId'))).toBe('bad binId');
    expect(ledgerListReason(problem('weird', 500))).toContain('ledger timeline');
    expect(ledgerListReason(new Error('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });
});

describe('rejectedOpPayloadBinId (the recount arm’s bin probe, review Entry D)', () => {
  // THE pin: the probe must read exactly what the server's recount arm
  // reads (`payload.binId ?? payload.toBinId`) — a placement payload that
  // names its bin only as toBinId still counts as a bin-carrying row.
  test('a pick/count-style payload carries binId; a placement carries toBinId', () => {
    expect(rejectedOpPayloadBinId({ binId: 'bin-1' })).toBe('bin-1');
    expect(rejectedOpPayloadBinId({ toBinId: 'bin-2' })).toBe('bin-2');
    expect(rejectedOpPayloadBinId({ binId: 'bin-1', toBinId: 'bin-2' })).toBe('bin-1');
  });

  test('an absent, empty, or non-string bin is absent — the recount gate stays shut', () => {
    expect(rejectedOpPayloadBinId({ picklistLineId: 'L-1' })).toBeNull();
    expect(rejectedOpPayloadBinId({})).toBeNull();
    expect(rejectedOpPayloadBinId({ binId: '' })).toBeNull();
    expect(rejectedOpPayloadBinId({ binId: 42 })).toBeNull();
    expect(rejectedOpPayloadBinId({ toBinId: null })).toBeNull();
  });
});

describe('rejectedOpsListReason (the rejected-ops read arms, story 5-6)', () => {
  test('mapped arms, the default, and the transport arm', () => {
    expect(rejectedOpsListReason(problem('invalid-cursor', 400))).toContain('restarted');
    expect(rejectedOpsListReason(problem('permission-denied', 403))).toContain('another tenant');
    expect(rejectedOpsListReason(problem('unauthenticated', 401))).toContain('session expired');
    expect(rejectedOpsListReason(problem('validation-failed', 400, 'bad status'))).toBe('bad status');
    expect(rejectedOpsListReason(problem('weird', 500))).toContain('rejected-ops queue');
    expect(rejectedOpsListReason(new Error('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });
});

describe('rejectedOpsResolveReason (the rejected-op resolve command arms, story 5-6)', () => {
  test('the already-resolved 409 names the reload recovery', () => {
    expect(rejectedOpsResolveReason(problem('rejected-op-resolved', 409))).toContain(
      'queue has refreshed',
    );
  });

  test('the count-task-open 409 names the bin-free remedy', () => {
    expect(rejectedOpsResolveReason(problem('count-task-open', 409))).toContain('bin free');
  });

  test('the re-execution refusals render the server words verbatim — the row stays open', () => {
    // A 403 device-revoked: the op's device was revoked since the op ran.
    expect(
      rejectedOpsResolveReason(problem('device-revoked', 403, 'scanner-1 was revoked', 'Device revoked')),
    ).toBe('Device revoked — scanner-1 was revoked');
    // A 409 the re-executed command itself raised, title only, detail only.
    expect(rejectedOpsResolveReason(problem('stock-moved', 409, undefined, 'Stock moved'))).toBe(
      'Stock moved',
    );
    expect(rejectedOpsResolveReason(problem('stock-moved', 409, 'the bin moved mid-flight'))).toBe(
      'the bin moved mid-flight',
    );
    expect(rejectedOpsResolveReason(problem('stock-moved', 409))).toContain('refused');
    // An unspecified-code 403 rides the verbatim arm too — it is the
    // re-execution's own guard speaking.
    expect(rejectedOpsResolveReason(problem('epoch-moved', 403, 'the epoch moved'))).toBe(
      'the epoch moved',
    );
  });

  test('house set and fallbacks', () => {
    // The not-found 404 is ambidextrous: a bare one (the op row itself,
    // detail-less) says the op is gone; one carrying the server's detail —
    // an inner command's re-executed refusal, e.g. a re-applied putaway
    // naming the bin — is the server's words instead (review iteration 1,
    // RB11).
    expect(rejectedOpsResolveReason(problem('not-found', 404))).toContain('no longer exists');
    expect(rejectedOpsResolveReason(problem('not-found', 404, 'No bin with id ...'))).toBe(
      'No bin with id ...',
    );
    expect(rejectedOpsResolveReason(problem('role-denied', 403))).toContain('cannot resolve');
    expect(rejectedOpsResolveReason(problem('idempotency-key-reuse', 422))).toContain(
      'already processed',
    );
    expect(rejectedOpsResolveReason(problem('unauthenticated', 401))).toContain('session expired');
    expect(rejectedOpsResolveReason(problem('validation-failed', 400, 'bin required'))).toBe(
      'bin required',
    );
    expect(rejectedOpsResolveReason(problem('weird', 500, 'boom'))).toBe('boom');
    expect(rejectedOpsResolveReason(problem('weird', 500))).toContain('Resolve failed');
  });

  test('a transport error renders the house unreachable copy', () => {
    expect(rejectedOpsResolveReason(new Error('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });
});

describe('story 13-2 — per-type decisions and the return.receive summary', () => {
  test('rejectedOpDecisions follows the server rule, falls back to all three, and gates recount on a payload bin', () => {
    expect(rejectedOpDecisions({ decisions: ['discard'], payload: { binId: 'b' } })).toEqual(['discard']);
    expect(rejectedOpDecisions({ payload: { binId: 'b' } })).toEqual(['apply', 'recount', 'discard']);
    expect(rejectedOpDecisions({ payload: {} })).toEqual(['apply', 'discard']);
    expect(rejectedOpDecisions({ decisions: ['apply', 'recount', 'discard'], payload: { toBinId: 'b' } })).toEqual(['apply', 'recount', 'discard']);
  });

  test('the guidance and the refusal words are pinned', () => {
    expect(RETURN_RECEIVE_REVIEW_GUIDANCE).toBe('Create a return authorization for these units, then receive them again.');
    expect(RETURN_REFUSAL_LABEL).toEqual({
      'not-on-authorization': 'not on the return',
      'exceeds-authorized': 'more than authorized',
      'serial-not-authorized': 'serial not authorized',
      'serial-in-stock': 'serial already in stock',
      'batch-not-dispatched': 'batch not dispatched',
      'missing-capture': 'capture missing',
      'unexpected-capture': 'capture not expected',
      'weight-out-of-range': 'weight out of range',
      'qty-precision': 'quantity too precise',
    });
  });

  test('guidance is per reason / problem code, de-duplicated, and only on return.receive rows', () => {
    const row = (problemCode: string, reasons?: string[]) => ({
      opType: 'return.receive' as const,
      problemCode,
      payload: reasons === undefined ? {} : { refusals: reasons.map((reason, entryIndex) => ({ entryIndex, reason })) },
    });
    expect(returnReceiveGuidance(row('return-entries-refused', ['not-on-authorization', 'exceeds-authorized']))).toEqual([
      'Create a return authorization for these units, then receive them again.',
    ]);
    expect(returnReceiveGuidance(row('return-entries-refused', ['missing-capture', 'serial-not-authorized', 'qty-precision']))).toEqual([
      RETURN_RECAPTURE_GUIDANCE,
      RETURN_RECEIVE_REVIEW_GUIDANCE,
    ]);
    expect(RETURN_RECAPTURE_GUIDANCE).toBe('Re-scan these units with the correct capture (serial, batch, weight or quantity), then receive them again.');
    expect(returnReceiveGuidance(row('returns-bin-conflict'))).toEqual(['Fix the location or warehouse master data, then receive these units again.']);
    expect(returnReceiveGuidance(row('document-warehouse-mismatch'))).toEqual([RETURN_MASTER_DATA_GUIDANCE]);
    expect(returnReceiveGuidance(row('rma-not-receivable'))).toEqual([
      'The return authorization is cancelled or already received — create a new one for these units, then receive them again.',
    ]);
    expect(returnReceiveGuidance(row('return-entries-refused'))).toEqual([RETURN_RECEIVE_REVIEW_GUIDANCE]);
    expect(returnReceiveGuidance({ opType: 'grn.submit', problemCode: 'rma-not-receivable', payload: {} })).toEqual([]);
  });

  test('a server-raised row pairs each entry with its refusal; a device whole-op row reads its problem code; other op types have none', () => {
    const codes: Record<string, string> = { 'sku-a': 'SKU-A' };
    const server = rejectedOpSummary(
      {
        opType: 'return.receive',
        problemCode: 'return-entries-refused',
        payload: {
          rmaId: '01989f7a-0000-0000-0000-000000000001',
          rmaCode: 'RMA-0007',
          entries: [
            { rmaLineId: 'line-1', skuId: 'sku-a', qty: 1, condition: 'opened', serialNumber: 'SN-1', batchCode: 'B1', weightGrams: null, note: 'seal cut' },
            { rmaLineId: null, skuId: '01989f7a-0000-7000-8000-00000000c0de', qty: 1, condition: 'missing-parts', weightGrams: 2340 },
          ],
          refusals: [
            { entryIndex: 0, reason: 'serial-not-authorized' },
            { entryIndex: 3, reason: 'not-on-authorization' },
          ],
        },
      },
      (id) => codes[id] ?? null,
    );
    expect(server).toEqual({
      heading: 'RMA-0007 — 2 entries not booked',
      lines: [
        'SKU-A × 1 · Opened · batch B1 · serial SN-1 · “seal cut” — serial not authorized',
        'SKU …0000c0de × 1 · Missing parts · 2.340 kg · not on any line — not on the return',
      ],
    });
    const device = rejectedOpSummary({
      opType: 'return.receive',
      problemCode: 'rma-not-receivable',
      payload: { rmaId: '01989f7a-0000-0000-0000-000000000001', entries: [{ rmaLineId: 'line-1', skuId: 'sku-a', qty: 1, condition: 'damaged' }] },
    });
    expect(device).toEqual({ heading: 'return …00000001 — 1 entry not booked', lines: ['SKU …sku-a × 1 · Damaged — rma-not-receivable'] });
    expect(rejectedOpSummary({ opType: 'grn.submit', problemCode: 'x', payload: {} })).toBeNull();
  });

  test('decision-not-available reads generically (the per-row guidance lives on return.receive cards)', () => {
    const error = problem('decision-not-available', 409);
    expect(rejectedOpsResolveReason(error)).toBe('That decision is not available for this op — refresh the queue.');
  });
});
