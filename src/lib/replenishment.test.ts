import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import type { BatchAlertResponse } from './api/generated';
import {
  BATCH_ALERT_KIND_LABEL,
  BATCH_ALERT_KINDS,
  BATCH_ALERT_STATUSES,
  batchAlertDismissedSentence,
  BREACH_TAB_LABEL,
  SUGGESTED_PO_TAB_LABEL,
  dismissAcceptedSentence,
  dismissBreachReason,
  dismissBatchAlertReason,
  milliToBase,
  parseMilliInput,
  policyDeletedSentence,
  policyDeleteReason,
  policySavedSentence,
  policyUpsertReason,
  replenishmentListReason,
  REPLENISHMENT_BREACH_STATUSES,
  submitAcceptedSentence,
  submitSuggestedPoReason,
  SUGGESTED_PO_STATUSES,
} from './replenishment';
import { UNREACHABLE_REASON } from './outbound-orders';

/**
 * The replenishment module's pure decisions (story 6-1; the batch-alert
 * vocabulary and mappers are story 6-2). The load-bearing pins: the
 * verbatim 409 refusals (the server's own words are the only honest
 * rendering of a cause invisible in the DTOs this client holds), the
 * UNREACHABLE transport arm on every mapper, the milli input grammar
 * (exact, never rounding, 0 admitted onto the wire), and the FLAT
 * submit-response reading — `purchaseOrder` IS the minted PO.
 */

describe('parseMilliInput (base-unit decimal → exact integer milli)', () => {
  test('whole and decimal literals convert exactly, never rounding', () => {
    expect(parseMilliInput('1')).toBe(1000);
    expect(parseMilliInput('25')).toBe(25000);
    expect(parseMilliInput('0.001')).toBe(1);
    expect(parseMilliInput('2.5')).toBe(2500);
    expect(parseMilliInput('0.125')).toBe(125);
    expect(parseMilliInput(' 12.345 ')).toBe(12345);
    expect(parseMilliInput('3.2')).toBe(3200);
  });

  test('grammar-admitted zero is a real value — the server\'s positivity refusal is the authority', () => {
    expect(parseMilliInput('0')).toBe(0);
    expect(parseMilliInput('0.000')).toBe(0);
  });

  test('everything finer than milli, signed or exotic, is refused', () => {
    expect(parseMilliInput('1.2345')).toBeNull(); // 4 decimals — cannot be milli
    expect(parseMilliInput('-1')).toBeNull();
    expect(parseMilliInput('1e3')).toBeNull();
    expect(parseMilliInput('0x10')).toBeNull();
    expect(parseMilliInput('Infinity')).toBeNull();
    expect(parseMilliInput('.5')).toBeNull(); // no leading digit
    expect(parseMilliInput('1.')).toBeNull(); // trailing dot
    expect(parseMilliInput('')).toBeNull();
    expect(parseMilliInput('abc')).toBeNull();
  });

  test('milliToBase divides by 10³', () => {
    expect(milliToBase(2500)).toBe(2.5);
    expect(milliToBase(1000)).toBe(1);
    expect(milliToBase(0)).toBe(0);
  });
});

describe('replenishmentListReason', () => {
  test('the stale-cursor arm restarts the queue from the first page', () => {
    expect(
      replenishmentListReason(problem('invalid-cursor', 400, 'Cursor expired'), 'breaches'),
    ).toContain('stale');
  });

  test('the fallthrough names the subject and prefers the detail', () => {
    expect(
      replenishmentListReason(problem('unknown-code', 500, 'disk on fire'), 'suggested POs'),
    ).toBe('disk on fire');
    expect(replenishmentListReason(problem('unknown-code', 500), 'suggested POs')).toBe(
      'Could not load the suggested POs.',
    );
  });

  test('a non-ApiProblem anything is the transport arm, verbatim', () => {
    expect(replenishmentListReason(new Error('socket hang up'), 'breaches')).toBe(
      UNREACHABLE_REASON,
    );
    expect(replenishmentListReason(undefined, 'reorder policies')).toBe(UNREACHABLE_REASON);
  });
});

describe('policyUpsertReason / policyDeleteReason', () => {
  test('the upsert names the role gate and the missing row', () => {
    expect(policyUpsertReason(problem('role-denied', 403))).toBe(
      'Your role cannot edit reorder points.',
    );
    expect(policyUpsertReason(problem('not-found', 404))).toBe(
      'That warehouse or SKU no longer exists — refresh the page.',
    );
  });

  test('the delete answers an already-removed override', () => {
    expect(policyDeleteReason(problem('not-found', 404))).toBe(
      'This override is already gone — refresh the table.',
    );
  });

  test('both fall back to the transport arm', () => {
    expect(policyUpsertReason(new Error('boom'))).toBe(UNREACHABLE_REASON);
    expect(policyDeleteReason('oops')).toBe(UNREACHABLE_REASON);
  });
});

describe('dismissBreachReason', () => {
  test('any 409 renders the server\'s own words verbatim', () => {
    expect(
      dismissBreachReason(
        problem('breach-not-open', 409, 'The breach is no longer open.', 'Breach not open'),
      ),
    ).toBe('Breach not open — The breach is no longer open.');
  });

  test('the 409 shape holds without a detail or a title', () => {
    expect(dismissBreachReason(problem('breach-not-open', 409))).toBe('Not dismissed (breach-not-open).');
  });

  test('the transport arm is last', () => {
    expect(dismissBreachReason(new Error('offline'))).toBe(UNREACHABLE_REASON);
  });
});

describe('submitSuggestedPoReason', () => {
  test('the vendor-required 400 carries its remedy in the sentence', () => {
    expect(
      submitSuggestedPoReason(problem('suggested-po-vendor-required', 400)),
    ).toBe(
      'Choose a vendor first — this draft carries none, and the PO cannot be minted without one.',
    );
  });

  test('any 409 renders the server\'s words verbatim — the guard refusals are invisible client-side', () => {
    expect(
      submitSuggestedPoReason(
        problem(
          'suggested-po-submitted',
          409,
          'This suggested PO has already been submitted.',
          'Suggested PO already submitted',
        ),
      ),
    ).toBe('Suggested PO already submitted — This suggested PO has already been submitted.');
  });

  test('the transport arm is last', () => {
    expect(submitSuggestedPoReason(new Error('offline'))).toBe(UNREACHABLE_REASON);
  });
});

describe('accepted sentences', () => {
  test('the submit sentence reads the FLAT carrier — purchaseOrder IS the PO', () => {
    const sentence = submitAcceptedSentence({
      suggestedPoId: 'sp_1',
      purchaseOrder: {
        id: 'po_1',
        code: 'PO-2026-0142',
        lines: [{ id: 'l1' }, { id: 'l2' }],
      },
    } as unknown as Parameters<typeof submitAcceptedSentence>[0]);
    expect(sentence).toContain('PO-2026-0142');
    expect(sentence).toContain('2 lines');
    // A nested-carrier misread used to make every success copy silently
    // empty — the sentence must name the code, never an empty string.
    expect(sentence).not.toContain('Purchase order  minted');
  });

  test('one line reads the singular', () => {
    const sentence = submitAcceptedSentence({
      suggestedPoId: 'sp_1',
      purchaseOrder: { id: 'po_1', code: 'PO-1', lines: [{ id: 'l1' }] },
    } as unknown as Parameters<typeof submitAcceptedSentence>[0]);
    expect(sentence).toContain('1 line —');
  });

  test('the dismissal names where the draft still lives', () => {
    expect(dismissAcceptedSentence()).toContain('suggested PO stays a draft');
    expect(policySavedSentence()).toContain('override');
    expect(policyDeletedSentence()).toContain('tenant-wide defaults resume');
  });
});

describe('vocabularies', () => {
  test('the tab labels cover every status — a new backend status must land here too', () => {
    expect(REPLENISHMENT_BREACH_STATUSES).toEqual(['open', 'recovered', 'actioned', 'dismissed']);
    expect(Object.keys(BREACH_TAB_LABEL).sort()).toEqual(
      [...REPLENISHMENT_BREACH_STATUSES].sort(),
    );
    expect(SUGGESTED_PO_STATUSES).toEqual(['draft', 'submitted', 'dismissed']);
    expect(Object.keys(SUGGESTED_PO_TAB_LABEL).sort()).toEqual([...SUGGESTED_PO_STATUSES].sort());
  });

  test('the batch-alert vocabularies (story 6-2) mirror the backend CHECKs', () => {
    expect(BATCH_ALERT_KINDS).toEqual(['expiry_upcoming', 'aged']);
    expect(BATCH_ALERT_STATUSES).toEqual(['open', 'resolved', 'dismissed']);
    expect(Object.keys(BATCH_ALERT_KIND_LABEL).sort()).toEqual([...BATCH_ALERT_KINDS].sort());
    // The kind filter is the two kinds PLUS the unfiltered all.
    expect(BATCH_ALERT_KIND_LABEL.expiry_upcoming).toBe('Expiring soon');
    expect(BATCH_ALERT_KIND_LABEL.aged).toBe('Aged');
  });

  test('the list reason names the new subject', () => {
    expect(replenishmentListReason(problem('unknown-code', 500), 'batch alerts')).toBe(
      'Could not load the batch alerts.',
    );
    expect(replenishmentListReason(new Error('x'), 'batch alerts')).toBe(UNREACHABLE_REASON);
  });
});

describe('dismissBatchAlertReason (story 6-2)', () => {
  test('the 409 batch-alert-not-open arm renders the server\'s own words verbatim', () => {
    expect(
      dismissBatchAlertReason(
        problem('batch-alert-not-open', 409, 'This batch alert was auto-resolved moments ago.', 'Batch alert not open'),
      ),
    ).toBe('Batch alert not open — This batch alert was auto-resolved moments ago.');
  });

  test('the 409 shape holds without a title or a detail', () => {
    expect(dismissBatchAlertReason(problem('batch-alert-not-open', 409, 'some detail'))).toBe(
      'some detail',
    );
    expect(dismissBatchAlertReason(problem('batch-alert-not-open', 409))).toBe(
      'Not dismissed (batch-alert-not-open).',
    );
  });

  test('the role gate, the missing row and the transport arm land as usual', () => {
    expect(dismissBatchAlertReason(problem('role-denied', 403))).toBe(
      'Your role cannot dismiss batch alerts.',
    );
    expect(dismissBatchAlertReason(problem('not-found', 404))).toBe(
      'This alert no longer exists — refresh the queue.',
    );
    // Key reuse is a 422 here (a 409-carried one would land on the verbatim
    // arm above — the code switch is only reachable for non-409s).
    expect(dismissBatchAlertReason(problem('idempotency-key-reuse', 422))).toBe(
      'This dismissal was already processed.',
    );
    expect(dismissBatchAlertReason(new Error('socket hang up'))).toBe(UNREACHABLE_REASON);
  });
});

describe('batchAlertDismissedSentence (story 6-2)', () => {
  test('the sentence names the kind AND the re-raise clause — dismissal is bookkeeping, not suppression', () => {
    const snapshot = (kind: 'expiry_upcoming' | 'aged'): BatchAlertResponse => ({
      batchAlert: {
        id: 'alert-1',
        warehouseId: 'w',
        skuId: 's',
        batchId: 'b',
        kind,
        status: 'dismissed',
        ageDays: kind === 'aged' ? 30 : null,
        onHandMilli: 5000,
        detectedAt: '2026-09-28T08:00:00.000Z',
        resolvedAt: '2026-09-28T09:00:00.000Z',
        resolvedBy: 'u-1',
      },
    });
    expect(batchAlertDismissedSentence(snapshot('expiry_upcoming'))).toContain(
      'The expiry alert is dismissed',
    );
    expect(batchAlertDismissedSentence(snapshot('aged'))).toContain(
      'The aged alert is dismissed',
    );
    expect(batchAlertDismissedSentence(snapshot('aged'))).toContain(
      'the expiry scan raises a fresh alert',
    );
  });
});
/** A minimal problem-details carrier (positional, per ApiProblem's constructor). */
function problem(code: string, status: number, detail?: string, title?: string): ApiProblem {
  return new ApiProblem(code, status, detail, title);
}
