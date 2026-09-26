import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import { isUlid, traceReason } from './cold-chain';
import { UNREACHABLE_REASON } from './outbound-orders';

/**
 * The `/compliance` trace viewer's pure decisions (story 12-7), pinned here:
 * the orderId shape check (the client-side refusal that never spends a
 * request) and the trace read's arms — `order-not-dispatched` renders the
 * mapped refusal, `not-found` covers an order in another warehouse exactly
 * as a missing one.
 */

function problem(code: string, status: number, detail?: string): ApiProblem {
  return new ApiProblem(code, status, detail);
}

describe('isUlid (the client-side shape check)', () => {
  test('a 26-char Crockford base32 ULID passes', () => {
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true);
    // An all-hex-looking 26-char shape from the generator's alphabet.
    expect(isUlid('0198F7A21B3C7D4E8F90112233')).toBe(true);
  });

  test('a stray space, a lowercase confusable, a short or overlong paste is refused', () => {
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAV ')).toBe(false);
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5faV')).toBe(false); // lowercase
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5F')).toBe(false); // 25 chars
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAVV')).toBe(false); // 27 chars
    // The Crockford alphabet excludes I, L, O and U.
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAI')).toBe(false);
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAL')).toBe(false);
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAO')).toBe(false);
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAU')).toBe(false);
    expect(isUlid('')).toBe(false);
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
    expect(traceReason(problem('validation-failed', 400))).toContain('26-character ULID');
    expect(traceReason(problem('weird', 500, 'boom'))).toBe('boom');
    expect(traceReason(problem('weird', 500))).toBe('Could not load the cold-chain trace.');
    expect(traceReason(new Error('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });
});