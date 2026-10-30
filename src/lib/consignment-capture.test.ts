import { describe, expect, test } from 'bun:test';

import {
  BRAND_DOCUMENT_LABEL,
  BRAND_DOCUMENT_TYPES,
  CARRIER_IDENTITY_RULE,
  EWAY_THRESHOLD_HINT,
  addIsoDays,
  brandDocumentDateWindow,
  consignorStateWarning,
  emptyConsignmentDraft,
  parseConsignmentDraft,
  stateCodeLabel,
  type ConsignmentDraft,
} from './consignment-capture';

/** 28 Oct 2026, 10:00 IST. */
const NOW = Date.parse('2026-10-28T04:30:00.000Z');
/** Created 20 Oct 2026 IST → the earliest document date is 20 Sep 2026. */
const CREATED = '2026-10-20T05:00:00.000Z';
const ctx = { createdAt: CREATED, nowMs: NOW };

function draft(patch: Partial<ConsignmentDraft> = {}): ConsignmentDraft {
  return {
    ...emptyConsignmentDraft('29ABCDE1234F1Z5', NOW),
    documentNumber: 'CH-77',
    transporterId: '0198f7a2-1b3c-7d4e-8f90-0000000000a7',
    packageCount: '2',
    ...patch,
  };
}

describe('the consignment capture (story 2-8b, shared with 4-7c)', () => {
  test('the vocabulary mirrors the server: challan and invoice (A8 — a debit note is not a movement document)', () => {
    expect(BRAND_DOCUMENT_TYPES).toEqual(['challan', 'invoice']);
    expect(BRAND_DOCUMENT_LABEL.challan).toBe('Delivery challan');
    expect(EWAY_THRESHOLD_HINT).toBe(
      "Above the e-way threshold (₹50,000, or the state's intra-state limit) an e-way bill number is required — the WMS judges the declared value",
    );
  });

  test('a fresh draft is a challan dated today (IST) with the frozen brand GSTIN', () => {
    const fresh = emptyConsignmentDraft('29ABCDE1234F1Z5', Date.parse('2026-10-27T19:00:00.000Z'));
    expect(fresh.documentType).toBe('challan');
    // 19:00 UTC is 00:30 IST the next day.
    expect(fresh.documentDate).toBe('2026-10-28');
    expect(fresh.consignorGstin).toBe('29ABCDE1234F1Z5');
    expect(emptyConsignmentDraft(null, NOW).consignorGstin).toBe('');
  });

  test('the body: trimmed, blanks absent, the GSTIN upper-cased, the vehicle normalised', () => {
    const parsed = parseConsignmentDraft(
      draft({
        documentNumber: '  CH-77 ',
        consignorGstin: ' 29abcde1234f1z5 ',
        debitNoteNumber: '  ',
        vehicleNumber: 'ka-01 ab.1234',
        trackingRef: ' AWB1 ',
      }),
      ctx,
    );
    expect(parsed).toEqual({
      ok: true,
      body: {
        brandDocument: { type: 'challan', number: 'CH-77', date: '2026-10-28' },
        consignorGstin: '29ABCDE1234F1Z5',
        transporterId: '0198f7a2-1b3c-7d4e-8f90-0000000000a7',
        vehicleNumber: 'KA01AB1234',
        trackingRef: 'AWB1',
        packageCount: 2,
      },
    });
  });

  test('the brand document is required, at most 40 characters', () => {
    expect(parseConsignmentDraft(draft({ documentNumber: ' ' }), ctx)).toMatchObject({ ok: false, field: 'documentNumber' });
    expect(parseConsignmentDraft(draft({ documentNumber: 'x'.repeat(41) }), ctx)).toMatchObject({ ok: false, field: 'documentNumber' });
    expect(parseConsignmentDraft(draft({ documentNumber: 'x'.repeat(40) }), ctx).ok).toBe(true);
  });

  test('the IST date window: no later than today, no earlier than creation − 30 days', () => {
    expect(brandDocumentDateWindow(CREATED, NOW)).toEqual({ earliest: '2026-09-20', latest: '2026-10-28' });
    expect(parseConsignmentDraft(draft({ documentDate: '2026-10-29' }), ctx)).toMatchObject({ ok: false, field: 'documentDate' });
    expect(parseConsignmentDraft(draft({ documentDate: '2026-09-19' }), ctx)).toMatchObject({ ok: false, field: 'documentDate' });
    expect(parseConsignmentDraft(draft({ documentDate: '2026-09-20' }), ctx).ok).toBe(true);
    expect(parseConsignmentDraft(draft({ documentDate: '2026-02-30' }), ctx)).toMatchObject({ ok: false, field: 'documentDate' });
    expect(addIsoDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  test('a malformed or wrong-state consignor GSTIN is refused; blank is absent', () => {
    expect(parseConsignmentDraft(draft({ consignorGstin: '29ABC' }), ctx)).toMatchObject({ ok: false, field: 'consignorGstin' });
    expect(parseConsignmentDraft(draft({ consignorGstin: '99ABCDE1234F1Z5' }), ctx)).toMatchObject({ ok: false, field: 'consignorGstin' });
    const blank = parseConsignmentDraft(draft({ consignorGstin: '' }), ctx);
    expect(blank.ok && 'consignorGstin' in blank.body).toBe(false);
  });

  test('the e-way bill: 12 digits, its date required with it, validity on or after, neither without the number', () => {
    expect(parseConsignmentDraft(draft({ ewayBillNumber: '12345' }), ctx)).toMatchObject({ ok: false, field: 'ewayBillNumber' });
    expect(parseConsignmentDraft(draft({ ewayBillNumber: '123456789012' }), ctx)).toMatchObject({ ok: false, field: 'ewayBillDate' });
    expect(parseConsignmentDraft(draft({ ewayBillDate: '2026-10-27' }), ctx)).toMatchObject({ ok: false, field: 'ewayBillNumber' });
    expect(parseConsignmentDraft(draft({ ewayValidUntil: '2026-10-29' }), ctx)).toMatchObject({ ok: false, field: 'ewayBillNumber' });
    expect(
      parseConsignmentDraft(draft({ ewayBillNumber: '123456789012', ewayBillDate: '2026-10-27', ewayValidUntil: '2026-10-26' }), ctx),
    ).toMatchObject({ ok: false, field: 'ewayValidUntil' });
    const ok = parseConsignmentDraft(draft({ ewayBillNumber: '123456789012', ewayBillDate: '2026-10-27', ewayValidUntil: '2026-10-27' }), ctx);
    expect(ok.ok && ok.body).toMatchObject({ ewayBillNumber: '123456789012', ewayBillDate: '2026-10-27', ewayValidUntil: '2026-10-27' });
  });

  test('at least one carrier identity; the mode decides which of transporter / name rides', () => {
    const none = parseConsignmentDraft(draft({ transporterId: '' }), ctx);
    expect(none).toEqual({ ok: false, field: 'carrier', problem: CARRIER_IDENTITY_RULE });
    const vehicleOnly = parseConsignmentDraft(draft({ transporterId: '', vehicleNumber: 'KA01AB1234' }), ctx);
    expect(vehicleOnly.ok).toBe(true);
    const typed = parseConsignmentDraft(draft({ carrierMode: 'typed', carrierName: ' Blue Dart ' }), ctx);
    expect(typed.ok && typed.body).toMatchObject({ carrierName: 'Blue Dart' });
    expect(typed.ok && 'transporterId' in typed.body).toBe(false);
    expect(parseConsignmentDraft(draft({ vehicleNumber: 'AB1' }), ctx)).toMatchObject({ ok: false, field: 'vehicleNumber' });
    expect(parseConsignmentDraft(draft({ carrierMode: 'typed', carrierName: 'x'.repeat(101) }), ctx)).toMatchObject({ ok: false, field: 'carrier' });
  });

  test('the package count is a whole number 1–9999; the AWB at most 50', () => {
    for (const bad of ['', '0', '10000', '1.5', '1e2', '-1']) {
      expect(parseConsignmentDraft(draft({ packageCount: bad }), ctx)).toMatchObject({ ok: false, field: 'packageCount' });
    }
    expect(parseConsignmentDraft(draft({ packageCount: '9999' }), ctx).ok).toBe(true);
    expect(parseConsignmentDraft(draft({ trackingRef: 'x'.repeat(51) }), ctx)).toMatchObject({ ok: false, field: 'trackingRef' });
  });

  test('A7 — the consignor state warning: a prefix other than the warehouse GSTIN prefix warns; agreement or an unknown is silent', () => {
    expect(consignorStateWarning('27ABCDE1234F1Z5', '29AAAAA0000A1Z5')).toContain('registered in Maharashtra, but the goods leave from Karnataka');
    expect(consignorStateWarning('29ABCDE1234F1Z5', '29AAAAA0000A1Z5')).toBeNull();
    expect(consignorStateWarning('27ABCDE1234F1Z5', null)).toBeNull();
    expect(consignorStateWarning('', '29AAAAA0000A1Z5')).toBeNull();
  });

  test('a state code reads with its name', () => {
    expect(stateCodeLabel('29')).toBe('29 Karnataka');
    expect(stateCodeLabel(null)).toBe('—');
    expect(stateCodeLabel('XX')).toBe('XX');
  });
});
