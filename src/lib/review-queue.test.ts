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
  rejectedOpGuidance,
  GRN_REFUSAL_LABEL,
  GRN_CLIENT_GUIDANCE,
  GRN_DEPARTED_GUIDANCE,
  GRN_EXPIRY_ON_UNTRACKED_GUIDANCE,
  GRN_EXPIRY_BEFORE_MFG_GUIDANCE,
  GRN_BATCH_EXPIRY_MISMATCH_GUIDANCE,
  GRN_EXPIRY_REQUIRED_GUIDANCE,
  GRN_SHELF_LIFE_GUIDANCE,
  GRN_LICENCE_GUIDANCE,
  GRN_LICENCE_OWNER_ONLY,
  WAIVABLE_OP_TYPES,
  WAIVER_COPY,
  canApplyRow,
  missingLicenceWords,
  MAX_RESOLVE_NOTE_LENGTH,
  acceptAnywayNote,
  applyNeedsNote,
  rejectedOpResolvedOutcome,
  waivedRerunSummary,
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

describe('story 1-1 — a blind receipt\'s lines of another client (grn.lines-refused)', () => {
  const row = {
    opType: 'grn.lines-refused' as const,
    problemCode: 'sku-client-mismatch',
    payload: {
      warehouseId: '01989f7a-0000-7000-8000-0000000000aa',
      grnId: '01989f7a-0000-7000-8000-0000000000bb',
      grnCode: 'GRN-0042',
      clientId: 'c-acme',
      clientLabel: 'ACME',
      blindReasonCode: 'unannounced-delivery',
      occurredAt: '2026-10-18T05:00:00.000Z',
      lines: [
        { skuId: 'sku-b', batchCode: 'B1', mfgDate: null, qty: 3 },
        { skuId: 'sku-s', batchCode: null, mfgDate: null, qty: 1.5 },
      ],
      refusals: [
        { lineIndex: 1, skuId: 'sku-b', skuCode: 'TSHIRT-M', skuClientId: 'c-beta', skuClientLabel: 'BETA', reason: 'sku-client-mismatch' },
        { lineIndex: 4, skuId: 'sku-s', skuCode: 'OWN-1', skuClientId: 'c-self', skuClientLabel: 'Priya Spices (your company)', reason: 'sku-client-mismatch' },
      ],
    },
  };

  test('the summary names the receipt, its client, and each line\'s own client', () => {
    expect(rejectedOpSummary(row)).toEqual({
      heading: 'GRN-0042 — 2 lines not booked on a receipt for ACME',
      lines: [
        "TSHIRT-M × 3 · batch B1 — another client's SKU (BETA)",
        "OWN-1 × 1.5 — another client's SKU (Priya Spices (your company))",
      ],
    });
  });

  test('a row missing its frozen codes falls back to the catalog label, then the id tail', () => {
    const bare = {
      ...row,
      payload: {
        grnId: '01989f7a-0000-7000-8000-0000000000bb',
        lines: [{ skuId: 'sku-b', qty: 1 }, { skuId: '01989f7a-0000-7000-8000-00000000c0de', qty: 2 }],
        refusals: [{ reason: 'sku-client-mismatch' }, {}],
      },
    };
    expect(rejectedOpSummary(bare, (id) => (id === 'sku-b' ? 'TSHIRT-M · BETA' : null))).toEqual({
      heading: 'receipt …000000bb — 2 lines not booked',
      lines: ["TSHIRT-M · BETA × 1 — another client's SKU", "SKU …0000c0de × 2 — another client's SKU"],
    });
  });

  test('the remedy is to receive again for the right client; other rows keep theirs', () => {
    expect(rejectedOpGuidance(row)).toEqual([GRN_CLIENT_GUIDANCE]);
    expect(GRN_CLIENT_GUIDANCE).toBe('Receive these lines again on a receipt for their own client, then discard this row.');
    expect(rejectedOpGuidance({ opType: 'return.receive', problemCode: 'rma-not-receivable', payload: {} })).toEqual([
      'The return authorization is cancelled or already received — create a new one for these units, then receive them again.',
    ]);
    expect(rejectedOpGuidance({ opType: 'grn.submit', problemCode: 'x', payload: {} })).toEqual([]);
  });

  test('every GRN line refusal reason has words', () => {
    expect(GRN_REFUSAL_LABEL['sku-client-mismatch']).toBe("another client's SKU");
    expect(Object.keys(GRN_REFUSAL_LABEL).sort()).toEqual(
      // Story 1-2a adds `client-departed`; story 1-2b the five expiry codes; story 1-6d `licence-not-covered`.
      [
        'asn-line-not-found',
        'batch-expiry-mismatch',
        'client-departed',
        'expiry-before-mfg',
        'expiry-on-untracked',
        'expiry-required',
        'licence-not-covered',
        'po-line-not-found',
        'po-line-not-open',
        'shelf-life-short',
        'sku-client-mismatch',
      ],
    );
    expect(GRN_REFUSAL_LABEL['client-departed']).toBe('its client has departed');
  });

  test('its decisions are the server\'s — Discard only', () => {
    expect(rejectedOpDecisions({ decisions: ['discard'], payload: row.payload })).toEqual(['discard']);
  });
});

describe('story 1-2b — the expiry refusals and the shelf-life row', () => {
  const GRN = '01989f7a-0000-7000-8000-0000000000bb';
  const linesRefused = (problemCode: string, refusals: Record<string, unknown>[], lines?: Record<string, unknown>[]) => ({
    opType: 'grn.lines-refused' as const,
    problemCode,
    payload: {
      grnId: GRN,
      grnCode: 'GRN-0042',
      clientLabel: 'ACME',
      lines: lines ?? refusals.map((_, i) => ({ skuId: `sku-${i}`, batchCode: 'B1', mfgDate: null, qty: 2 })),
      refusals,
    },
  });

  test('each new code has its words', () => {
    expect(GRN_REFUSAL_LABEL['expiry-on-untracked']).toBe('expiry date on an untracked SKU');
    expect(GRN_REFUSAL_LABEL['expiry-before-mfg']).toBe('expiry date before its mfg date');
    expect(GRN_REFUSAL_LABEL['batch-expiry-mismatch']).toBe("expiry date differs from its batch's");
    expect(GRN_REFUSAL_LABEL['expiry-required']).toBe('expiry date required');
    expect(GRN_REFUSAL_LABEL['shelf-life-short']).toBe('shelf life too short');
  });

  test('each lines-refused code reads its own remedy', () => {
    const cases: [string, string][] = [
      ['client-departed', GRN_DEPARTED_GUIDANCE],
      ['sku-client-mismatch', GRN_CLIENT_GUIDANCE],
      ['batch-expiry-mismatch', GRN_BATCH_EXPIRY_MISMATCH_GUIDANCE],
      ['expiry-before-mfg', GRN_EXPIRY_BEFORE_MFG_GUIDANCE],
      ['expiry-on-untracked', GRN_EXPIRY_ON_UNTRACKED_GUIDANCE],
      ['expiry-required', GRN_EXPIRY_REQUIRED_GUIDANCE],
    ];
    for (const [code, guidance] of cases) {
      expect(rejectedOpGuidance(linesRefused(code, [{ reason: code, skuCode: 'X' }]))).toEqual([guidance]);
    }
    expect(GRN_EXPIRY_ON_UNTRACKED_GUIDANCE).toBe(
      'These SKUs are not batch-tracked, so they carry no expiry date — receive these lines again without one, then discard this row.',
    );
    expect(GRN_EXPIRY_BEFORE_MFG_GUIDANCE).toBe(
      'The expiry date is before the mfg date — check the label, receive these lines again with the right dates, then discard this row.',
    );
    expect(GRN_BATCH_EXPIRY_MISMATCH_GUIDANCE).toBe(
      "The expiry date differs from the one this batch already has (or another line's for the same batch) — check the label; receive these lines again with the batch's expiry, or under their own batch code, then discard this row.",
    );
    expect(GRN_EXPIRY_REQUIRED_GUIDANCE).toBe(
      "This client requires an expiry date on batch-tracked goods — receive these lines again with the label's expiry date, then discard this row.",
    );
  });

  test('a row mixing codes reads one remedy per code, in the server precedence (departed first)', () => {
    const mixed = linesRefused('client-departed', [{ reason: 'expiry-required' }, { reason: 'client-departed' }, { reason: 'expiry-required' }]);
    expect(rejectedOpGuidance(mixed)).toEqual([GRN_DEPARTED_GUIDANCE, GRN_EXPIRY_REQUIRED_GUIDANCE]);
    // An unknown code only: the receive-again remedy, never nothing.
    expect(rejectedOpGuidance(linesRefused('something-new', [{ reason: 'something-new' }]))).toEqual([GRN_CLIENT_GUIDANCE]);
  });

  test('the summary names the batch, the judged expiry and, for short-dated lines, the days left and the minimum', () => {
    const row = linesRefused(
      'batch-expiry-mismatch',
      [
        { reason: 'batch-expiry-mismatch', skuCode: 'MILK-1', skuClientLabel: 'ACME', batchCode: 'L7', expiryDate: '2026-12-01' },
        { reason: 'expiry-required', skuCode: 'MILK-2', skuClientLabel: 'ACME', batchCode: 'L8', expiryDate: null },
      ],
      [
        { skuId: 'a', batchCode: 'L7', mfgDate: null, expiryDate: '2026-12-01', qty: 3 },
        { skuId: 'b', batchCode: 'L8', mfgDate: null, qty: 1 },
      ],
    );
    expect(rejectedOpSummary(row)).toEqual({
      heading: 'GRN-0042 — 2 lines not booked on a receipt for ACME',
      lines: [
        "MILK-1 × 3 · batch L7 · expires 2026-12-01 — expiry date differs from its batch's (ACME)",
        'MILK-2 × 1 · batch L8 — expiry date required (ACME)',
      ],
    });
  });

  const shelfRow = {
    opType: 'grn.shelf-life-refused' as const,
    problemCode: 'shelf-life-short',
    payload: {
      warehouseId: 'w-1',
      poId: 'po-1',
      blindReasonCode: null,
      occurredAt: '2026-10-19T05:00:00.000Z',
      grnId: GRN,
      grnCode: 'GRN-0042',
      clientLabel: 'ACME',
      lines: [
        { poLineId: 'pl-1', skuId: 'a', batchCode: 'L7', mfgDate: null, expiryDate: '2026-12-18', qty: 10 },
        { poLineId: 'pl-2', skuId: 'b', batchCode: 'L9', mfgDate: null, expiryDate: '2026-10-16', qty: 1 },
      ],
      refusals: [
        { lineIndex: 0, skuId: 'a', skuCode: 'MILK-1', skuClientId: 'c', skuClientLabel: 'ACME', reason: 'shelf-life-short', batchCode: 'L7', expiryDate: '2026-12-18', minShelfLifeDays: 90, remainingDays: 60 },
        { lineIndex: 1, skuId: 'b', skuCode: 'MILK-2', skuClientId: 'c', skuClientLabel: 'ACME', reason: 'shelf-life-short', batchCode: 'L9', expiryDate: '2026-10-16', minShelfLifeDays: 0, remainingDays: -3 },
      ],
    },
  };

  test('the shelf-life row: its own heading, the expiry, the days left and the minimum per line; its remedy', () => {
    expect(rejectedOpSummary(shelfRow)).toEqual({
      heading: 'GRN-0042 — 2 lines not booked: short-dated for ACME',
      lines: [
        'MILK-1 × 10 · batch L7 · expires 2026-12-18 — shelf life too short (60 days left, minimum 90 days) (ACME)',
        'MILK-2 × 1 · batch L9 · expires 2026-10-16 — shelf life too short (expired 3 days ago, expired goods refused) (ACME)',
      ],
    });
    expect(rejectedOpGuidance(shelfRow)).toEqual([GRN_SHELF_LIFE_GUIDANCE]);
    expect(GRN_SHELF_LIFE_GUIDANCE).toBe(
      "Short-dated for this client's minimum: accept them anyway with a note saying why (they book as on any receipt — QC and tolerance still apply), or discard this row and return the goods.",
    );
    expect(rejectedOpDecisions({ decisions: ['apply', 'discard'], payload: shelfRow.payload })).toEqual(['apply', 'discard']);
  });

  test('Accept anyway needs a trimmed note of at most 500 characters; only the shelf-life row asks for one', () => {
    expect(applyNeedsNote(shelfRow)).toBe(true);
    expect(applyNeedsNote({ opType: 'grn.lines-refused' })).toBe(false);
    expect(applyNeedsNote({ opType: 'pick.record' })).toBe(false);
    expect(acceptAnywayNote(shelfRow, '  Vendor confirmed a credit note  ')).toEqual({ note: 'Vendor confirmed a credit note', problem: null });
    expect(acceptAnywayNote(shelfRow, '   ')).toEqual({ note: null, problem: 'Say why these short-dated goods are accepted — the note is required.' });
    expect(MAX_RESOLVE_NOTE_LENGTH).toBe(500);
    expect(acceptAnywayNote(shelfRow, 'x'.repeat(500)).note).toHaveLength(500);
    expect(acceptAnywayNote(shelfRow, 'x'.repeat(501))).toEqual({ note: null, problem: 'The note is at most 500 characters.' });
  });

  test('the resolve outcome names Accept anyway on a shelf-life row and keeps the other words', () => {
    expect(rejectedOpResolvedOutcome(shelfRow, 'applied')).toEqual({
      word: 'Accepted anyway',
      reason: 'The short-dated lines booked — the shelf-life rule waived for this receipt only; QC and tolerance applied as on any receipt; the note is audited.',
    });
    // The re-run's own answer names what happened (story 1-2b review).
    const booked = { kind: 'applied', snapshot: { goodsReceipt: { code: 'GRN-0042', lines: [{}, {}], rejectedLines: [{ code: 'client-departed' }] } } };
    expect(rejectedOpResolvedOutcome(shelfRow, 'applied', booked).reason).toBe(
      `2 line(s) booked on GRN-0042; 1 refused again: ${GRN_REFUSAL_LABEL['client-departed']} — the shelf-life rule waived for this receipt only; QC and tolerance applied as on any receipt; the note is audited.`,
    );
    expect(rejectedOpResolvedOutcome({ opType: 'pick.record' }, 'applied').word).toBe('Op applied');
    expect(rejectedOpResolvedOutcome({ opType: 'pick.record' }, 'recounted').word).toBe('Recount opened');
    expect(rejectedOpResolvedOutcome(shelfRow, 'discarded').word).toBe('Discarded');
  });

  test('waivedRerunSummary reads the re-run receipt: booked, refused again, or nothing recorded', () => {
    expect(waivedRerunSummary(null)).toBeNull();
    expect(waivedRerunSummary({ kind: 'applied' })).toBeNull();
    expect(waivedRerunSummary({ snapshot: { goodsReceipt: { code: 'GRN-0007', lines: [{}] } } })).toBe('1 line(s) booked on GRN-0007');
    expect(
      waivedRerunSummary({
        snapshot: { goodsReceipt: null, refusedReceipt: { rejectedLines: [{ code: 'batch-expiry-mismatch' }, { code: 'batch-expiry-mismatch' }] } },
      }),
    ).toBe(`No line booked; 2 refused again: ${GRN_REFUSAL_LABEL['batch-expiry-mismatch']}`);
    expect(waivedRerunSummary({ snapshot: { goodsReceipt: null, refusedReceipt: { rejectedLines: [] } } })).toBe('No receipt was recorded');
  });
});

describe('story 1-6d — a grn.licence-refused row (owner-only Accept anyway)', () => {
  const licenceRow = {
    opType: 'grn.licence-refused' as const,
    problemCode: 'licence-not-covered',
    payload: {
      warehouseId: 'w-1',
      poId: null,
      blindReasonCode: 'other',
      occurredAt: '2026-11-01T04:30:00.000Z',
      grnId: 'grn-1',
      grnCode: 'GRN-0051',
      clientLabel: 'ACME',
      lines: [
        { poLineId: null, skuId: 'sku-1', batchCode: null, mfgDate: null, qty: 5 },
        { poLineId: null, skuId: 'sku-2', batchCode: null, mfgDate: null, qty: 1 },
      ],
      refusals: [
        { lineIndex: 1, skuId: 'sku-1', skuCode: 'RICE-5KG', skuClientId: 'c', skuClientLabel: 'ACME', reason: 'licence-not-covered', missing: [{ need: 'fssai', holder: 'site' }] },
        {
          lineIndex: 2,
          skuId: 'sku-2',
          skuCode: 'CODEINE',
          skuClientId: 'c',
          skuClientLabel: 'ACME',
          reason: 'licence-not-covered',
          missing: [
            { need: 'ndps', holder: 'client' },
            { need: 'ndps', holder: 'site' },
          ],
        },
      ],
    },
  };

  test('the copy table is keyed by exactly the two waivable types; the shelf-life entry is 1-2b\'s words', () => {
    expect([...WAIVABLE_OP_TYPES]).toEqual(['grn.shelf-life-refused', 'grn.licence-refused']);
    expect(Object.keys(WAIVER_COPY).sort()).toEqual(['grn.licence-refused', 'grn.shelf-life-refused']);
    expect(WAIVER_COPY['grn.shelf-life-refused'].noteLabel).toBe('Why accept these short-dated goods? (required)');
    expect(WAIVER_COPY['grn.licence-refused'].noteLabel).toBe('Why accept goods without a valid licence?');
  });

  test('the summary names each line with its missing needs and holders, under the licence heading', () => {
    expect(rejectedOpSummary(licenceRow)).toEqual({
      heading: 'Lines in licence review — GRN-0051, 2 lines not booked for ACME',
      lines: [
        'RICE-5KG × 5 — no valid licence (FSSAI licence — site) (ACME)',
        'CODEINE × 1 — no valid licence (NDPS licence — client; NDPS licence — site) (ACME)',
      ],
    });
    expect(GRN_REFUSAL_LABEL['licence-not-covered']).toBe('no valid licence');
    expect(rejectedOpGuidance(licenceRow)).toEqual([GRN_LICENCE_GUIDANCE]);
  });

  test('missingLicenceWords reads `missing` defensively', () => {
    expect(missingLicenceWords({})).toBeNull();
    expect(missingLicenceWords({ missing: 'fssai' })).toBeNull();
    expect(missingLicenceWords({ missing: [{ need: 'fssai' }, null, { need: 'drug-20b', holder: 'client' }] })).toBe('Form 20B — client');
  });

  test('Accept anyway needs a note worded for the licence; the outcome reads "Accepted anyway … — licence waived"', () => {
    expect(applyNeedsNote(licenceRow)).toBe(true);
    expect(acceptAnywayNote(licenceRow, '  ')).toEqual({ note: null, problem: 'Say why these goods are accepted without a valid licence — the note is required.' });
    expect(acceptAnywayNote(licenceRow, ' renewal filed ')).toEqual({ note: 'renewal filed', problem: null });
    const outcome = rejectedOpResolvedOutcome(licenceRow, 'applied', { kind: 'applied', snapshot: { goodsReceipt: { code: 'GRN-0052', lines: [{}] } } });
    expect(outcome).toEqual({ word: 'Accepted anyway', reason: '1 line(s) booked on GRN-0052 — licence waived for these lines only; the note is audited.' });
    expect(rejectedOpResolvedOutcome(licenceRow, 'applied').reason).toBe('The lines booked — licence waived for these lines only; the note is audited.');
  });

  test('only an owner (licences.manage) may Apply it; a non-owner reads the owner-only words; its 403 shows the server detail', () => {
    expect(canApplyRow(licenceRow, true, true)).toBe(true);
    expect(canApplyRow(licenceRow, true, false)).toBe(false);
    expect(canApplyRow(licenceRow, false, true)).toBe(false);
    expect(canApplyRow({ opType: 'grn.shelf-life-refused' }, true, false)).toBe(true);
    expect(GRN_LICENCE_OWNER_ONLY).toBe('An owner can accept these');
    const denied = problem('role-denied', 403, 'Your role (ops_manager) lacks licences.manage.');
    expect(rejectedOpsResolveReason(denied, licenceRow)).toBe('Your role (ops_manager) lacks licences.manage.');
    expect(rejectedOpsResolveReason(denied, { opType: 'pick.record' })).toContain('cannot resolve');
  });
});
