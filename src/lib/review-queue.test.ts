import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { CountVarianceEntryResponseDto } from '@/lib/api/generated';
import { UNREACHABLE_REASON } from './outbound-orders';
import {
  MAX_CONSIDERED_EVENT_SEQS,
  adjustmentDecisionReason,
  adjustmentListReason,
  isOwnerOnlyVariance,
  ledgerListReason,
  rejectedOpPayloadBinId,
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
    expect(rejectedOpsResolveReason(problem('not-found', 404))).toContain('no longer exists');
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
