import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import {
  approvedReason,
  decisionReason,
  excessHeadline,
  isLateOverReceipt,
  isUnmatchedOverReceipt,
  openQtyLabel,
  overReceiptDocumentLabel,
  qcReason,
  qcGrnFilterLabel,
  qcHoldKindLabel,
  releaseReceiptOutcome,
  releaseReceiptReason,
} from './over-receipt';

/**
 * The story 3.3 surface copy decisions: an approved over-receipt
 * legitimately drives a PO line's derived `openQty` negative, and every
 * decision failure branches on the machine-readable problem `code` — both
 * pinned here (the components render exactly these strings).
 */

describe('openQtyLabel (the negative-open callout)', () => {
  test('a negative open quantity carries the over-received callout', () => {
    expect(openQtyLabel(-5)).toBe('-5 units (over-received)');
  });

  test('a zero or positive open quantity renders as-is', () => {
    expect(openQtyLabel(0)).toBe('0 units');
    expect(openQtyLabel(60)).toBe('60 units');
  });

  test('a line whose SKU resolves names its unit at the unit\'s declared precision', () => {
    // Story 10.5: the PO-lines column mixes units, so each row states its
    // own — declared precision, unit named, and the negative callout intact.
    const kg = { uom: 'kg', uomPrecision: 3 };
    expect(openQtyLabel(1.5, kg)).toBe('1.500 kg');
    expect(openQtyLabel(-0.5, kg)).toBe('-0.500 kg (over-received)');
    // An unresolvable SKU keeps the unit-agnostic fallback, never a guessed precision.
    expect(openQtyLabel(1.5, null)).toBe('1.5 units');
    expect(openQtyLabel(-1.5, null)).toBe('-1.5 units (over-received)');
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

describe('story 21-6 — the queue is document-neutral', () => {
  test('an over-receipt names its PO or its ASN', () => {
    expect(overReceiptDocumentLabel({ poId: 'po-1' }, 'PO-0004')).toBe('PO PO-0004');
    expect(overReceiptDocumentLabel({ poId: 'po-1' }, null)).toBe('PO —');
    expect(overReceiptDocumentLabel({ poId: null, asnId: 'a-1', asnCode: 'ASN-001' }, null)).toBe('ASN ASN-001');
  });

  test('the approve outcome names the line kind that took the excess', () => {
    expect(approvedReason({ poLineId: 'pl-1' })).toBe('The excess applied to the PO line and the ledger.');
    expect(approvedReason({ poLineId: null, asnId: 'a-1', asnLineId: 'al-1' })).toBe(
      'The excess applied to the ASN line and the ledger.',
    );
  });
});

describe('story 21-9 — late receipts and unmatched lines', () => {
  test('a closed or cancelled document is named with its status on a PENDING row only; an open one never', () => {
    expect(overReceiptDocumentLabel({ poId: null, asnId: 'a-1', asnCode: 'ASN-9', status: 'pending' }, null, 'cancelled')).toBe('ASN ASN-9 · cancelled');
    expect(overReceiptDocumentLabel({ poId: 'po-1', status: 'pending' }, 'PO-0004', 'closed')).toBe('PO PO-0004 · closed');
    expect(overReceiptDocumentLabel({ poId: 'po-1', status: 'pending' }, 'PO-0004', 'open')).toBe('PO PO-0004');
    expect(overReceiptDocumentLabel({ poId: null, asnId: 'a-1', asnCode: 'ASN-9', status: 'pending' }, null, 'received')).toBe('ASN ASN-9');
    expect(overReceiptDocumentLabel({ poId: 'po-1', status: 'pending' }, 'PO-0004', null)).toBe('PO PO-0004');
    // A DECIDED row whose document closed later is not a late receipt.
    expect(overReceiptDocumentLabel({ poId: 'po-1', status: 'approved' }, 'PO-0004', 'closed')).toBe('PO PO-0004');
    expect(overReceiptDocumentLabel({ poId: null, asnId: 'a-1', asnCode: 'ASN-9', status: 'rejected' }, null, 'closed')).toBe('ASN ASN-9');
  });

  test('late = a PENDING row on a closed or cancelled document', () => {
    expect(isLateOverReceipt({ status: 'pending' }, 'cancelled')).toBe(true);
    expect(isLateOverReceipt({ status: 'pending' }, 'closed')).toBe(true);
    expect(isLateOverReceipt({ status: 'pending' }, 'received')).toBe(false);
    expect(isLateOverReceipt({ status: 'pending' }, null)).toBe(false);
    expect(isLateOverReceipt({ status: 'approved' }, 'closed')).toBe(false);
    expect(isLateOverReceipt({ status: 'rejected' }, 'cancelled')).toBe(false);
  });

  test('the headline: "+N unmatched" for a null-line row (never "over open"), "+N late receipt" for a late row, else "+N over open"', () => {
    expect(excessHeadline('3 each', { unmatched: true, late: false })).toBe('+3 each unmatched');
    expect(excessHeadline('3 each', { unmatched: true, late: true })).toBe('+3 each unmatched');
    expect(excessHeadline('3 each', { unmatched: false, late: true })).toBe('+3 each late receipt');
    expect(excessHeadline('3 each', { unmatched: false, late: false })).toBe('+3 each over open');
  });

  test('unmatched = an ASN row without asnLineId, or a PO row whose poLineId is null', () => {
    expect(isUnmatchedOverReceipt({ poLineId: null, asnId: 'a-1' })).toBe(true);
    expect(isUnmatchedOverReceipt({ poLineId: null, asnId: 'a-1', asnLineId: 'al-1' })).toBe(false);
    expect(isUnmatchedOverReceipt({ poLineId: null })).toBe(true);
    expect(isUnmatchedOverReceipt({ poLineId: 'pl-1' })).toBe(false);
  });

  test('approving a null-line row credits no line', () => {
    expect(approvedReason({ poLineId: null })).toBe('Applied to stock; no line credited.');
    expect(approvedReason({ poLineId: null, asnId: 'a-1' })).toBe('Applied to stock; no line credited.');
  });
});

describe('story 1-2b — receipt holds', () => {
  test('a hold names its kind; an older row without one reads manual', () => {
    expect(qcHoldKindLabel('receipt')).toBe('Auto · QC on receipt');
    expect(qcHoldKindLabel('manual')).toBe('Manual');
    expect(qcHoldKindLabel(undefined)).toBe('Manual');
  });

  test('the GRN filter names the receipt by code, else by the id tail', () => {
    expect(qcGrnFilterLabel('GRN-0042', '0198f7a2-1b3c-7d4e-8f90-0000000000b7')).toBe('Showing the QC holds of GRN-0042');
    expect(qcGrnFilterLabel(null, '0198f7a2-1b3c-7d4e-8f90-0000000000b7')).toBe('Showing the QC holds of receipt …000000b7');
  });

  test('Release receipt: the outcome counts the RESPONSE’s holds; the refusals branch on code', () => {
    expect(releaseReceiptOutcome({ grnCode: 'GRN-0042', qcHolds: [{}, {}, {}] })).toEqual({
      word: 'GRN-0042 released from QC',
      reason: '3 receipt holds released — the units are back in Receiving and awaiting putaway.',
    });
    expect(releaseReceiptOutcome({ grnCode: 'GRN-7', qcHolds: [{}] }).reason).toBe(
      '1 receipt hold released — the units are back in Receiving and awaiting putaway.',
    );
    expect(releaseReceiptReason(new ApiProblem('qc-hold-released', 409))).toBe('This receipt has no open QC hold left — refresh the list.');
    expect(releaseReceiptReason(new ApiProblem('not-found', 404))).toBe('This goods receipt no longer exists — refresh the list.');
    expect(releaseReceiptReason(new ApiProblem('role-denied', 403))).toBe('Your role cannot place or release QC holds.');
    expect(releaseReceiptReason(new ApiProblem('qc-hold-origin-bin-gone', 409))).toBe(
      'The origin bin no longer exists, so the stock cannot return to it — the hold stays open.',
    );
    expect(releaseReceiptReason(new TypeError('x'))).toBe('The API is unreachable — is wms-be running?');
  });
});
