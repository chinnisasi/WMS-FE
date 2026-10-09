import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import {
  ASN_STATUS_LABEL,
  amendDraftOf,
  asnProgressLabel,
  asnReason,
  canAmendAsn,
  canCancelAsn,
  canCloseAsn,
  expectedAtInputValue,
  grnDocument,
  parseAsnAmend,
  parseAsnCreate,
  parseAsnLines,
  parseAsnNote,
  parseExpectedAt,
} from './asns';
import { UNREACHABLE_REASON } from './outbound-orders';

/**
 * Story 21-6 — the ASN card's pure half: which transitions a row offers, the
 * parsers that decide what is sent, the refusal mapper, and the GRN card's
 * three-armed "Document" column.
 */

describe('the transitions a row offers follow its status', () => {
  test('amend while announced or partially received; close only partially received; cancel only announced', () => {
    const statuses = Object.keys(ASN_STATUS_LABEL) as (keyof typeof ASN_STATUS_LABEL)[];
    expect(statuses.filter(canAmendAsn)).toEqual(['announced', 'partially_received']);
    expect(statuses.filter(canCloseAsn)).toEqual(['partially_received']);
    expect(statuses.filter(canCancelAsn)).toEqual(['announced']);
  });

  test('the progress figure', () => {
    // Lines, never the unit totals — those sum across UoMs.
    expect(asnProgressLabel({ linesComplete: 1, lineCount: 3 })).toBe('1 of 3 lines received');
  });
});

describe('parseAsnLines', () => {
  test('drops empty rows, keeps the line id on amend rows, accepts a fractional quantity', () => {
    const parsed = parseAsnLines([
      { skuId: 's1', qty: '10' },
      { skuId: '', qty: '' },
      { id: 'l-2', skuId: 's2', qty: '2.5' },
    ]);
    expect(parsed).toEqual({
      lines: [
        { skuId: 's1', announcedQty: 10 },
        { id: 'l-2', skuId: 's2', announcedQty: 2.5 },
      ],
      problem: null,
    });
  });

  test('refuses an empty set, a SKU-less row, and a non-positive or malformed quantity', () => {
    expect(parseAsnLines([{ skuId: '', qty: '' }]).problem).toBe('Add at least one line — a SKU and a quantity.');
    expect(parseAsnLines([{ skuId: '', qty: '3' }]).problem).toBe('Every line needs a SKU.');
    for (const qty of ['0', '-1', '1e3', 'abc']) {
      expect(parseAsnLines([{ skuId: 's1', qty }]).problem).toBe('Every quantity is a decimal greater than zero.');
    }
    const many = Array.from({ length: 201 }, (_, i) => ({ skuId: `s${i}`, qty: '1' }));
    expect(parseAsnLines(many).problem).toBe('An ASN carries at most 200 lines.');
  });
});

describe('parseAsnCreate', () => {
  const draft = { clientId: 'acme', asnCode: '  ASN-001 ', expectedAt: '', lines: [{ skuId: 's1', qty: '4' }] };

  test('builds the body: trimmed code, expectedAt absent when blank', () => {
    expect(parseAsnCreate(draft, 'wh-1')).toEqual({
      body: { clientId: 'acme', warehouseId: 'wh-1', asnCode: 'ASN-001', lines: [{ skuId: 's1', announcedQty: 4 }] },
      problem: null,
    });
  });

  test('an expected arrival becomes a UTC instant', () => {
    const { body } = parseAsnCreate({ ...draft, expectedAt: '2026-10-20T10:00' }, 'wh-1');
    expect(body!.expectedAt).toBe(new Date('2026-10-20T10:00').toISOString());
  });

  test('refuses a missing client, a blank or overlong code, and a malformed date — sending nothing', () => {
    expect(parseAsnCreate({ ...draft, clientId: '' }, 'wh-1')).toEqual({ body: null, problem: 'Choose the client this shipment is for.' });
    expect(parseAsnCreate({ ...draft, asnCode: '   ' }, 'wh-1').body).toBeNull();
    expect(parseAsnCreate({ ...draft, asnCode: 'x'.repeat(65) }, 'wh-1').body).toBeNull();
    expect(parseAsnCreate({ ...draft, expectedAt: 'next tuesday' }, 'wh-1').problem).toBe('The expected arrival is not a date and time.');
  });
});

describe('parseAsnAmend and amendDraftOf', () => {
  const STORED = '2026-10-20T04:30:45.000Z'; // carries seconds the input cannot show

  test('the draft starts from the ASN lines; a cleared expectedAt is sent as null', () => {
    const rows = amendDraftOf({ lines: [{ id: 'l-1', skuId: 's1', announcedQty: 10, receivedQty: 6, openQty: 4 }] });
    expect(rows).toEqual([{ id: 'l-1', skuId: 's1', qty: '10' }]);
    expect(parseAsnAmend({ expectedAt: '', lines: rows }, STORED)).toEqual({
      body: { expectedAt: null, lines: [{ id: 'l-1', skuId: 's1', announcedQty: 10 }] },
      problem: null,
    });
  });

  test('an untouched expectedAt is NOT sent (resending the minute-precision input would truncate the stored seconds); a changed one is', () => {
    const rows = [{ id: 'l-1', skuId: 's1', qty: '10' }];
    const untouched = parseAsnAmend({ expectedAt: expectedAtInputValue(STORED), lines: rows }, STORED);
    expect(untouched.body).toEqual({ lines: [{ id: 'l-1', skuId: 's1', announcedQty: 10 }] });
    expect(untouched.body).not.toHaveProperty('expectedAt');
    // Nothing stored and nothing typed: still absent.
    expect(parseAsnAmend({ expectedAt: '', lines: rows }, null).body).not.toHaveProperty('expectedAt');
    const changed = parseAsnAmend({ expectedAt: '2026-10-21T09:00', lines: rows }, STORED);
    expect(changed.body!.expectedAt).toBe(new Date('2026-10-21T09:00').toISOString());
  });

  test('parseExpectedAt: blank is absent', () => {
    expect(parseExpectedAt('  ')).toEqual({ expectedAt: null, problem: null });
  });
});

describe('parseAsnNote', () => {
  test('trims, requires 1–500 characters counted in code points', () => {
    expect(parseAsnNote('  short shipment ')).toEqual({ note: 'short shipment', problem: null });
    expect(parseAsnNote('   ').problem).toBe('Say why — a note is required.');
    expect(parseAsnNote('😀'.repeat(500)).note).toBe('😀'.repeat(500));
    expect(parseAsnNote('x'.repeat(501)).problem).toBe('A note is at most 500 characters.');
  });
});

describe('asnReason — branches on the problem code', () => {
  test('each ASN refusal reads in plain words', () => {
    expect(asnReason(new ApiProblem('asn-not-open', 409))).toBe(
      'This ASN is no longer open (received, closed or cancelled) — refresh the list.',
    );
    expect(asnReason(new ApiProblem('over-receipt-pending', 409))).toBe(
      'An over-receipt of this ASN awaits a decision — approve or reject it in Conflicts & Reviews first.',
    );
    expect(asnReason(new ApiProblem('role-denied', 403))).toBe('Your role cannot manage advance shipment notices.');
    expect(asnReason(new ApiProblem('duplicate-asn-code', 409, 'Client ACME already has "ASN-1".'))).toBe('Client ACME already has "ASN-1".');
    expect(asnReason(new ApiProblem('sku-client-mismatch', 409, 'Named SKUs of BETA.'))).toBe('Named SKUs of BETA.');
    expect(asnReason(new ApiProblem('asn-line-received', 409))).toContain('cannot be removed');
    expect(asnReason(new ApiProblem('asn-transition-invalid', 409, 'is announced — close applies only…', 'Cannot be closed'))).toBe(
      'Cannot be closed — is announced — close applies only…',
    );
  });

  test('the transport arm is the house unreachable copy; an unknown code falls back to its detail', () => {
    expect(asnReason(new TypeError('fetch failed'))).toBe(UNREACHABLE_REASON);
    expect(asnReason(new ApiProblem('teleported', 409, 'gone'))).toBe('gone');
    expect(asnReason(new ApiProblem('teleported', 409))).toBe('The ASN was not saved (teleported).');
  });
});

describe('grnDocument — a receipt books against a PO, an ASN, or neither', () => {
  test('the three arms', () => {
    expect(grnDocument({ poId: 'po-1', blindReasonCode: null }, 'PO-0004')).toEqual({ kind: 'po', label: 'PO PO-0004' });
    expect(grnDocument({ poId: 'po-1', blindReasonCode: null }, null)).toEqual({ kind: 'po', label: 'PO —' });
    expect(grnDocument({ poId: null, asnId: 'a-1', asnCode: 'ASN-001', blindReasonCode: null }, null)).toEqual({
      kind: 'asn',
      label: 'ASN ASN-001',
    });
    expect(grnDocument({ poId: null, blindReasonCode: 'unannounced-delivery' }, null)).toEqual({
      kind: 'blind',
      label: 'Blind · Unannounced delivery',
    });
  });

  test('an ASN receipt is never read as "Blind · undefined" (the 21-6 design finding #7)', () => {
    const label = grnDocument({ poId: null, asnId: 'a-1', asnCode: 'ASN-9', blindReasonCode: null }, null).label;
    expect(label).not.toContain('Blind');
    expect(label).not.toContain('undefined');
  });
});
