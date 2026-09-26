import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import { isUuid, traceReason } from './cold-chain';
import { UNREACHABLE_REASON } from './outbound-orders';

/**
 * The `/compliance` trace viewer's pure decisions (story 12-7), pinned here:
 * the orderId shape check (the client-side refusal that never spends a
 * request) and the trace read's arms — `order-not-dispatched` renders the
 * mapped refusal, `not-found` covers an order in another warehouse exactly
 * as a missing one.
 *
 * The shape is the BE's id vocabulary, not a local invention: every entity
 * id is a dashed lowercase UUIDv7 (`wms-be/src/shared/primitives/ids.ts` —
 * "Every entity id in the system is a UUIDv7… Idempotency keys are ULIDs"),
 * and the trace route 400s anything failing its dashed `UUID_RE`. (An
 * earlier draft gated on the 26-char Crockford ULID — the Idempotency-Key
 * vocabulary — which refused every real order id; the review caught it.)
 */

function problem(code: string, status: number, detail?: string): ApiProblem {
  return new ApiProblem(code, status, detail);
}

describe('isUuid (the client-side shape check)', () => {
  test('a dashed 36-char UUIDv7 passes — lowercase and uppercase both', () => {
    expect(isUuid('0198f7a2-1b3c-7d4e-8f90-0011223344ff')).toBe(true);
    expect(isUuid('0198F7A2-1B3C-7D4E-8F90-0011223344FF')).toBe(true);
  });

  test('a stray space, a missing dash group, a short or overlong paste is refused', () => {
    expect(isUuid('0198f7a2-1b3c-7d4e-8f90-0011223344ff ')).toBe(false); // trailing space
    expect(isUuid(' 0198f7a2-1b3c-7d4e-8f90-0011223344ff')).toBe(false); // leading space
    expect(isUuid('0198f7a2-1b3c-7d4e8f90-0011223344ff')).toBe(false); // 3 groups
    expect(isUuid('0198f7a21b3c7d4e8f9000112233')).toBe(false); // undashed
    expect(isUuid('0198f7a2-1b3c-7d4e-8f90-0011223344f')).toBe(false); // 11 in last group
    expect(isUuid('0198f7a2-1b3c-7d4e-8f90-0011223344ff0')).toBe(false); // 13 in last group
    expect(isUuid('')).toBe(false);
    // ULIDs are the Idempotency-Key vocabulary — never an entity id.
    expect(isUuid('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(false);
  });
});

describe('traceReason (the trace read arms, branched on the code)', () => {
  test('order-not-dispatched renders the mapped refusal, not a raw 409', () => {
    const detail = 'The order has no dispatch events in the ledger.';
    expect(traceReason(problem('order-not-dispatched', 409, detail))).toBe(detail);
    expect(traceReason(problem('order-not-dispatched', 409))).toContain('not been dispatched');
  });

  test('not-found covers an order in another warehouse exactly as a missing one', () => {
    expect(traceReason(problem('not-found', 404))).toContain('check the order id');
  });

  test('the house set and the fallbacks', () => {
    expect(traceReason(problem('permission-denied', 403))).toContain('another tenant');
    expect(traceReason(problem('unauthenticated', 401))).toContain('session expired');
    expect(traceReason(problem('validation-failed', 400))).toContain('36-character UUID');
    expect(traceReason(problem('weird', 500, 'boom'))).toBe('boom');
    expect(traceReason(problem('weird', 500))).toBe('Could not load the cold-chain trace.');
    expect(traceReason(new Error('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });
});