import { describe, expect, test } from 'bun:test';

import {
  grnDocumentFilename,
  grnDocumentKindLabel,
  grnSealLabel,
  grnTotalsLabels,
  grnExcessLabel,
  grnExpiryLabel,
  grnPartyLines,
  grnPortalExcessLabel,
  grnPortalQcLabel,
  grnQcLabel,
  grnQuantity,
  grnSerialsLabel,
  isMalformedGrnParam,
  parseGrnParam,
} from './grn-document';

/** Story 2-9a — the GRN document in words (the drawer and the portal; the PDF prints the same). */

const none = { pendingQty: 0, approvedQty: 0, rejectedQty: 0 };
const qc = (over: Partial<Parameters<typeof grnQcLabel>[0]>) => ({ status: null, heldQty: 0, releasedQty: 0, passedQty: 0, failedQty: 0, ...over }) as Parameters<typeof grnQcLabel>[0];

describe('grn-document', () => {
  test('quantities at the UoM precision with integer maths', () => {
    expect(grnQuantity(12.5, 3)).toBe('12.500');
    expect(grnQuantity(40, 0)).toBe('40');
    expect(grnQuantity(0.1 + 0.2, 3)).toBe('0.300');
  });

  test('a party block: code — name, the legal name only when it differs, GSTIN, the address', () => {
    expect(grnPartyLines({ code: 'ACME', name: 'ACME', legalName: 'ACME', gstin: null, address: null })).toEqual(['ACME — ACME']);
    expect(
      grnPartyLines({ code: 'V-1', name: 'Fabrics', legalName: 'Fabrics Pvt Ltd', gstin: '24AAACF1234A1Z5', address: { line1: 'Ring Rd', line2: null, city: 'Surat', state: 'State code 24', pincode: '395002' } }),
    ).toEqual(['V-1 — Fabrics', 'Fabrics Pvt Ltd', 'GSTIN 24AAACF1234A1Z5', 'Ring Rd, Surat, State code 24, 395002']);
  });

  test('over-receipt: blank, or each non-zero part; the tolerance too; the portal words', () => {
    expect(grnExcessLabel(none, 0)).toBe('');
    expect(grnExcessLabel({ pendingQty: 20, approvedQty: 5, rejectedQty: 0 }, 0, 3)).toBe('20 awaiting approval; 5 approved; 3 within tolerance');
    expect(grnPortalExcessLabel({ pendingQty: 20, approvedQty: 0, rejectedQty: 1 }, 0)).toBe('Awaiting approval (20); Not accepted (1)');
  });

  test('QC: the staff cell in a fixed order; the portal words', () => {
    expect(grnQcLabel(qc({}), 0)).toBe('');
    expect(grnQcLabel(qc({ status: 'inspected', heldQty: 20, releasedQty: 10, passedQty: 8, failedQty: 2 }), 0)).toBe('Released 10 · Passed 8 · Failed 2');
    expect(grnQcLabel(qc({ status: 'on-hold', heldQty: 30, releasedQty: 10 }), 0)).toBe('On hold 20 · Released 10');
    expect(grnPortalQcLabel(qc({ status: 'on-hold', heldQty: 5 }), 0)).toBe('On quality hold');
    expect(grnPortalQcLabel(qc({ status: 'inspected', heldQty: 20, passedQty: 18, failedQty: 2 }), 0)).toBe('Passed 18 · Failed 2');
    expect(grnPortalQcLabel(qc({ status: 'released', heldQty: 4, releasedQty: 4 }), 0)).toBe('Released');
  });

  test('serials, expiry, the file name and the ?grn= parameter', () => {
    expect(grnSerialsLabel({ serialCount: 0, unreadableSerialCount: 0 })).toBeNull();
    expect(grnSerialsLabel({ serialCount: 50, unreadableSerialCount: 2, rejectedSerialCount: 0 })).toBe('Serials captured: 50 (2 unreadable)');
    expect(grnExpiryLabel({ expiryDate: '2027-01-31', expirySource: 'derived' })).toBe('2027-01-31 (derived)');
    expect(grnExpiryLabel({ expiryDate: null, expirySource: null })).toBe('');
    expect(grnDocumentFilename('GRN-0042', 'pdf')).toBe('GRN-0042.pdf');
    expect(grnDocumentFilename('GRN-0042', 'csv')).toBe('GRN-0042-lines.csv');
    expect(grnDocumentFilename('GRN 42/é', 'pdf')).toBe('GRN_42__.pdf');
    const id = '0198F7A2-1B3C-7D4E-8F90-0000000000C9';
    expect(parseGrnParam(id)).toBe(id.toLowerCase());
    expect(parseGrnParam(['a', 'b'])).toBeNull();
    expect(isMalformedGrnParam('nope')).toBe(true);
    expect(isMalformedGrnParam(null)).toBe(false);
  });

  test('document kinds and seal statuses in words; totals at each UoM precision (no float noise)', () => {
    expect(grnDocumentKindLabel('bill_of_entry')).toBe('Bill of entry');
    expect(grnDocumentKindLabel('other')).toBe('other');
    expect(grnSealLabel('none')).toBe('none (unsealed)');
    expect(
      grnTotalsLabels(
        [{ uom: 'kg', goodQty: 0.1 + 0.2, damagedQty: 0, shortQty: 12.5 }, { uom: 'each', goodQty: 4, damagedQty: 1, shortQty: 0 }],
        [{ uom: 'kg', uomPrecision: 3 }, { uom: 'each', uomPrecision: 0 }],
      ),
    ).toEqual(['kg: good 0.300 · damaged 0.000 · short 12.500', 'each: good 4 · damaged 1 · short 0']);
  });
});
