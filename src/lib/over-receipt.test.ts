import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import { decisionReason, openQtyLabel, qcReason } from './over-receipt';

/**
 * The story 3.3 surface copy decisions: an approved over-receipt
 * legitimately drives a PO line's derived `openQty` negative, and every
 * decision failure branches on the machine-readable problem `code` — both
 * pinned here (the components render exactly these strings).
 */

describe('openQtyLabel (the negative-open callout)', () => {
  test('a negative open quantity carries the over-received callout', () => {
    expect(openQtyLabel(-5)).toBe('-5 (over-received)');
  });

  test('a zero or positive open quantity renders as-is', () => {
    expect(openQtyLabel(0)).toBe('0');
    expect(openQtyLabel(60)).toBe('60');
  });
});

describe('decisionReason (the decision problem-code strings)', () => {
  test('each decision problem code maps to its plain-words reason', () => {
    expect(decisionReason(new ApiProblem('over-receipt-decided', 409))).toBe(
      'This over-receipt was already decided — refresh the queue.',
    );
    expect(decisionReason(new ApiProblem('not-found', 404))).toBe(
      'This over-receipt no longer exists — refresh the queue.',
    );
    expect(decisionReason(new ApiProblem('role-denied', 403))).toBe(
      'Your role cannot decide over-receipts.',
    );
    expect(decisionReason(new ApiProblem('idempotency-key-reuse', 422))).toBe(
      'This decision was already processed.',
    );
    expect(decisionReason(new ApiProblem('unauthenticated', 401))).toBe(
      'Your session expired — sign in again.',
    );
  });

  test('a validation failure surfaces the problem detail verbatim', () => {
    expect(decisionReason(new ApiProblem('validation-failed', 400, 'The detail from the API'))).toBe(
      'The detail from the API',
    );
  });

  test('an unmapped problem code falls back to the detail or the code', () => {
    expect(decisionReason(new ApiProblem('unknown-problem', 500, 'Something broke'))).toBe(
      'Something broke',
    );
    expect(decisionReason(new ApiProblem('unknown-problem', 500))).toBe(
      'Decision failed (unknown-problem).',
    );
  });

  test('a non-ApiProblem failure is the unreachable copy', () => {
    expect(decisionReason(new Error('fetch failed'))).toBe(
      'The API is unreachable — is wms-be running?',
    );
  });
});

describe('qcReason (the story 3.4 hold/release problem-code strings)', () => {
  test('each QC hold problem code maps to its plain-words reason', () => {
    expect(qcReason(new ApiProblem('qc-hold-open', 409))).toBe(
      'An open QC hold already covers this scope — release it first.',
    );
    expect(qcReason(new ApiProblem('qc-hold-released', 409))).toBe(
      'This hold was already released — refresh the list.',
    );
    expect(qcReason(new ApiProblem('qc-hold-origin-bin-gone', 409))).toBe(
      'The origin bin no longer exists, so the stock cannot return to it — the hold stays open.',
    );
    expect(qcReason(new ApiProblem('not-found', 404))).toBe(
      'This hold no longer exists — refresh the list.',
    );
    expect(qcReason(new ApiProblem('role-denied', 403))).toBe(
      'Your role cannot place or release QC holds.',
    );
    expect(qcReason(new ApiProblem('idempotency-key-reuse', 422))).toBe(
      'This action was already processed.',
    );
    expect(qcReason(new ApiProblem('unauthenticated', 401))).toBe(
      'Your session expired — sign in again.',
    );
  });

  test('a validation failure surfaces the problem detail verbatim', () => {
    expect(qcReason(new ApiProblem('validation-failed', 400, 'The scope has 0 on-hand units'))).toBe(
      'The scope has 0 on-hand units',
    );
  });

  test('an unmapped problem code falls back to the detail or the code', () => {
    expect(qcReason(new ApiProblem('unknown-problem', 500, 'Something broke'))).toBe(
      'Something broke',
    );
    expect(qcReason(new ApiProblem('unknown-problem', 500))).toBe(
      'The action failed (unknown-problem).',
    );
  });

  test('a non-ApiProblem failure is the unreachable copy', () => {
    expect(qcReason(new Error('fetch failed'))).toBe(
      'The API is unreachable — is wms-be running?',
    );
  });
});
