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
    expect(varianceListReason(problem('not-found', 404))).toContain('no longer exists');
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