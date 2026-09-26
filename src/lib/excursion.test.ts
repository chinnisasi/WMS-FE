import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { QcHoldDto } from '@/lib/api/generated';
import { excursionListReason, excursionResolveReason, holdLabel } from './excursion';
import { UNREACHABLE_REASON } from './outbound-orders';

/**
 * The excursion review queue's pure decisions (story 12-7), pinned here: the
 * queue read's `invalid-cursor` arm, the resolve command's
 * `excursion-resolved` / `role-denied` arms, and the joined hold's state
 * label (a hold id the qc-holds read no longer returns is DISPOSED, never
 * silently dropped).
 */

function problem(code: string, status: number, detail?: string): ApiProblem {
  return new ApiProblem(code, status, detail);
}

function hold(over: Partial<QcHoldDto> = {}): QcHoldDto {
  return {
    id: 'hold-1',
    tenantId: 't-1',
    warehouseId: 'w-1',
    skuId: 'sku-1',
    binId: 'bin-1',
    reason: 'temperature-excursion',
    status: 'open',
    heldBy: 'user-1',
    heldAt: '2026-09-20T00:00:00.000Z',
    releasedBy: null,
    releasedAt: null,
    createdAt: '2026-09-20T00:00:00.000Z',
    ...over,
  };
}

describe('excursionListReason (the queue read arms, branched on the code)', () => {
  test('a stale keyset cursor names the restart-from-first-page recovery', () => {
    expect(excursionListReason(problem('invalid-cursor', 400))).toContain('first page');
  });

  test('the house set and the fallbacks', () => {
    expect(excursionListReason(problem('not-found', 404))).toContain('no longer exists');
    expect(excursionListReason(problem('permission-denied', 403))).toContain('another tenant');
    expect(excursionListReason(problem('unauthenticated', 401))).toContain('session expired');
    expect(excursionListReason(problem('validation-failed', 400, 'status must be open or resolved'))).toBe(
      'status must be open or resolved',
    );
    expect(excursionListReason(problem('weird', 500, 'boom'))).toBe('boom');
    expect(excursionListReason(problem('weird', 500))).toBe('Could not load the excursion queue.');
    expect(excursionListReason(new Error('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });
});

describe('excursionResolveReason (the resolve command arms, branched on the code)', () => {
  test('a 409 excursion-resolved names the queue re-read as the recovery', () => {
    expect(excursionResolveReason(problem('excursion-resolved', 409))).toContain('already resolved');
  });

  test('a 403 role-denied names the capability, not the raw status', () => {
    expect(excursionResolveReason(problem('role-denied', 403))).toContain('cannot resolve');
  });

  test('the house set and the fallbacks', () => {
    expect(excursionResolveReason(problem('not-found', 404))).toContain('no longer exists');
    expect(excursionResolveReason(problem('idempotency-key-reuse', 422))).toContain('already processed');
    expect(excursionResolveReason(problem('unauthenticated', 401))).toContain('session expired');
    expect(excursionResolveReason(problem('validation-failed', 400, 'bad id'))).toBe('bad id');
    expect(excursionResolveReason(problem('weird', 500, 'boom'))).toBe('boom');
    expect(excursionResolveReason(problem('weird', 500))).toBe('Resolve failed (weird).');
    expect(excursionResolveReason(new Error('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });
});

describe('holdLabel (the affected-units join)', () => {
  test('an open hold reads held; a released hold reads released', () => {
    expect(holdLabel(hold())).toBe('held');
    expect(holdLabel(hold({ status: 'released' }))).toBe('released');
  });

  test('a hold the qc-holds read no longer returns reads disposed', () => {
    expect(holdLabel(undefined)).toBe('disposed');
  });
});