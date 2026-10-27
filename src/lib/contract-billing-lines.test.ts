import { describe, expect, test } from 'bun:test';

import { AUDIT_TARGET_LABEL } from './audit';
import { clientInvoiceGapLabel, clientInvoiceWarningLabel, lineDescription, lineQuantityLabel, lineRateLabel } from './client-invoices';
import { departureBlockerLine } from './clients';
import { buildLineRecordsCsv, lineDrillable, pseudonymsOf, recordCountLabel, summaryLabel, type LineRecord } from './invoice-records';
import { METERED_ONLY_NOTICE } from './usage';

/**
 * Story 5-5a — the two invoice line kinds contract billing adds (`adhoc`,
 * `minimum_adjustment`) as every printed view renders them (the invoice, the
 * portal and the notes all print through `lineDescription`), the drill's
 * `adhoc-charge` record and its CSV, and the new gap / warning / blocker /
 * audit words.
 */

const TENANT = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const RECORDER = '0198f7a2-0000-7000-8000-00000000beef';
const DECIDER = '0198f7a2-0000-7000-8000-00000000cafe';

const ADHOC_LINE = {
  chargeCode: 'adhoc' as const,
  basis: 'per_unit' as const,
  uom: 'hour',
  segmentFrom: '2026-10-05',
  segmentTo: '2026-10-05',
  quantity: '2.500',
  unitAmountPaise: 35_000,
  description: 'Extra labour — Unloading a 40 ft container · Ref SO-1042 · Client auth PO 77',
};

const MINIMUM_LINE = {
  chargeCode: 'minimum_adjustment' as const,
  basis: 'per_invoice' as const,
  uom: null,
  segmentFrom: '2026-10-01',
  segmentTo: '2026-10-31',
  quantity: '1',
  unitAmountPaise: 1_874_960,
  description: 'Minimum monthly charge ₹50,000.00 less all charges ₹31,250.40',
};

const METERED_LINE = { chargeCode: 'pick' as const, basis: 'per_pick' as const, uom: null, segmentFrom: '2026-10-01', segmentTo: '2026-10-31', quantity: '412', unitAmountPaise: 300 };

describe('the new line kinds, printed', () => {
  test('an ad-hoc line prints its frozen description and the day of the work; the minimum its description alone', () => {
    expect(lineDescription(ADHOC_LINE)).toBe('Extra labour — Unloading a 40 ft container · Ref SO-1042 · Client auth PO 77 · 5 Oct 2026');
    expect(lineDescription(MINIMUM_LINE)).toBe('Minimum monthly charge ₹50,000.00 less all charges ₹31,250.40');
    // A metered line — no description key — prints exactly as before.
    expect(lineDescription(METERED_LINE)).toBe('Pick · 1 Oct 2026 – 31 Oct 2026');
    // A new-kind line that somehow lacks its description still names its charge.
    expect(lineDescription({ ...MINIMUM_LINE, description: undefined })).toBe('Minimum charge adjustment · 1 Oct 2026 – 31 Oct 2026');
  });

  test('quantity and rate: an ad-hoc line in its unit, the adjustment as one per invoice', () => {
    expect(lineQuantityLabel(ADHOC_LINE)).toBe('2.500 hours');
    expect(lineRateLabel(ADHOC_LINE)).toBe('₹350.00 per hour');
    expect(lineQuantityLabel(MINIMUM_LINE)).toBe('1');
    expect(lineRateLabel(MINIMUM_LINE)).toBe('₹18,749.60 per invoice');
    expect(lineQuantityLabel(METERED_LINE)).toBe('412 picks');
    expect(lineRateLabel(METERED_LINE)).toBe('₹3.00 per pick');
  });

  test('the gap and warning words; an unknown code still renders by its code', () => {
    expect(clientInvoiceGapLabel('adhoc-charge-pending')).toBe('Ad-hoc charge awaiting approval');
    expect(clientInvoiceGapLabel('minimum-charge-pending')).toBe('Minimum charge not computable yet');
    expect(clientInvoiceWarningLabel('minimum-not-applied-multi-gstin')).toBe('Minimum not applied — more than one GSTIN');
    expect(clientInvoiceWarningLabel('minimum-from-charges-only')).toBe('Minimum met from ad-hoc charges only');
    expect(clientInvoiceGapLabel('brand-new-gap')).toBe('brand-new-gap');
  });

  test('the usage note, the wind-down blocker and the audit target types', () => {
    expect(METERED_ONLY_NOTICE).toBe('Metered charges only — ad-hoc charges and the minimum appear on the invoice.');
    expect(departureBlockerLine({ kind: 'unbilled-charges', count: 2, codes: [] })).toBe('2 ad-hoc charges not yet billed');
    expect(AUDIT_TARGET_LABEL.client_charge).toBe('Ad-hoc charge');
    expect(AUDIT_TARGET_LABEL.client_charge_policy).toBe('Ad-hoc charge approval limit');
  });
});

describe('the drill (A16): one ad-hoc charge, no records for the minimum', () => {
  const record: LineRecord = {
    kind: 'adhoc-charge',
    id: 'ch-1',
    chargeId: 'ch-1',
    chargeDate: '2026-10-05',
    warehouseId: 'w1',
    warehouseCode: 'BLR1',
    category: 'extra_labour',
    description: 'Unloading, =HYPERLINK("x")',
    unit: 'hour',
    quantity: '2.5',
    unitRatePaise: 35_000,
    amountPaise: 87_500,
    reference: 'SO-1042',
    clientAuthorizationRef: null,
    status: 'approved',
    recordedBy: RECORDER,
    recordedByEmail: 'ops@example.com',
    decidedBy: DECIDER,
    decidedByEmail: 'finance@example.com',
  };

  test('a minimum adjustment offers no records toggle; every other kind does', () => {
    expect(lineDrillable(MINIMUM_LINE)).toBe(false);
    expect(lineDrillable(ADHOC_LINE)).toBe(true);
    expect(lineDrillable(METERED_LINE)).toBe(true);
  });

  test('the summary and count read in the charge’s unit', () => {
    expect(summaryLabel(ADHOC_LINE, { lineQuantity: '2.500', recordsQuantity: '2.500', reconciles: true })).toBe('Records add up to 2.500 hours — the invoiced quantity.');
    expect(recordCountLabel('adhoc-charge', 1, false)).toBe('1 ad-hoc charge shown');
  });

  test('the CSV: the charge’s figures, recorder and decider pseudonymised (never an email), formulas guarded', async () => {
    const pseudonyms = await pseudonymsOf(TENANT, [record]);
    expect([...pseudonyms.keys()].sort()).toEqual([RECORDER, DECIDER].sort());
    const summary = { lineQuantity: '2.500', recordsQuantity: '2.500', reconciles: true };
    const text = buildLineRecordsCsv({
      invoice: {
        id: 'inv-1',
        invoiceNo: '29/S2627/000004',
        status: 'issued',
        supplierGstin: '29AAACT1234A1Z5',
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        party: { recipient: { code: 'ACME', name: 'Acme', legalName: null } } as never,
      },
      line: ADHOC_LINE,
      exported: { kind: 'adhoc-charge', summary, endSummary: summary, records: [record], truncated: false },
      pseudonyms,
      generatedAt: '2026-11-02T04:30:00.000Z',
    });
    expect(text).toContain(
      '\ncharge_date,warehouse,category,description,unit,qty,unit_rate_inr,amount_inr,reference,client_authorization,status,recorded_by,decided_by,charge_id\n',
    );
    const row = text.split('\n').find((line) => line.startsWith('"2026-10-05"'))!;
    expect(row).toContain(`"${pseudonyms.get(RECORDER)}"`);
    expect(row).toContain(`"${pseudonyms.get(DECIDER)}"`);
    expect(row).toContain(',2.5,350.00,875.00,"SO-1042","","approved",');
    expect(row).toContain('"Extra labour"');
    expect(text).not.toContain('example.com');
    expect(text).toContain('# Line: Extra labour — Unloading a 40 ft container · Ref SO-1042 · Client auth PO 77 · 5 Oct 2026');
  });
});
