import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import type { ClientInvoiceDto } from './api/generated';
import {
  STALE_WORD,
  VOID_WARNING,
  actionNeedsReread,
  clientInvoiceActionReason,
  clientInvoiceActions,
  clientInvoiceGapLabel,
  clientInvoiceHeading,
  gapCountLabel,
  invoiceMonthOptions,
  invoicedNotice,
  invoicedNumbers,
  issueOutcome,
  issueBlockedHint,
  printCopies,
  lineDescription,
  lineQuantityLabel,
  lineRateLabel,
  lineTaxableLabel,
  monthLabel,
  parseStatusNote,
  prepareOutcome,
  prepareReason,
  recipientAddressLines,
  refusalGaps,
  stateLabel,
  supplierAddressLines,
} from './client-invoices';
import { UNREACHABLE_REASON } from './outbound-orders';

const PARTY: ClientInvoiceDto['party'] = {
  supplier: {
    name: 'Three PL Co',
    gstin: '29AAACT1234A1Z5',
    stateCode: '29',
    stateName: 'Karnataka',
    address: { line1: '12 Peenya', line2: null, city: 'Bengaluru', state: 'Karnataka', pincode: '560066' },
    warehouseCode: 'BLR1',
  },
  recipient: {
    name: 'Acme',
    code: 'ACME',
    legalName: 'Acme Foods Private Limited',
    gstin: null,
    stateCode: '27',
    stateName: 'Maharashtra',
    address: { line1: '5 FC Road', line2: 'Floor 2', city: 'Pune', stateCode: '27', pincode: '411001' },
  },
};

function invoice(over: Partial<ClientInvoiceDto> = {}): ClientInvoiceDto {
  return {
    id: 'i-1',
    clientId: 'c-1',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    status: 'draft',
    invoiceNo: null,
    fyLabel: null,
    supplierGstin: '29AAACT1234A1Z5',
    placeOfSupply: '27',
    supplyType: 'inter',
    totals: { subtotal: 4705, cgst: 0, sgst: 0, igst: 847, tax: 847, roundOff: 48, payable: 5600 },
    issuedAt: null,
    statusNote: null,
    replacesInvoiceId: null,
    createdAt: '2026-10-07T04:30:00.000Z',
    gaps: [],
    warnings: [],
    party: PARTY,
    lines: [],
    ...over,
  };
}

describe('client invoices — vocabulary and actions', () => {
  test('each status offers exactly its actions (the state rule)', () => {
    expect(clientInvoiceActions('draft')).toEqual({ refresh: true, issue: true, discard: true, dispute: false, settle: false, void: false });
    expect(clientInvoiceActions('issued')).toEqual({ refresh: false, issue: false, discard: false, dispute: true, settle: true, void: true });
    expect(clientInvoiceActions('disputed')).toEqual({ refresh: false, issue: false, discard: false, dispute: false, settle: true, void: true });
    for (const terminal of ['settled', 'void'] as const) {
      expect(Object.values(clientInvoiceActions(terminal)).some(Boolean)).toBe(false);
    }
  });

  test('a note is required to dispute or void, optional to settle; at most 500 characters', () => {
    expect(parseStatusNote('dispute', '  ')).toEqual({ note: null, problem: 'Say why — a note is required to dispute an invoice.' });
    expect(parseStatusNote('void', '')).toMatchObject({ note: null, problem: expect.stringContaining('required') });
    expect(parseStatusNote('settle', '')).toEqual({ note: null, problem: null });
    expect(parseStatusNote('void', ' wrong name ')).toEqual({ note: 'wrong name', problem: null });
    expect(parseStatusNote('settle', 'x'.repeat(501))).toMatchObject({ problem: expect.stringContaining('500') });
  });

  test('gap labels (an unknown code renders by its code); the gap count cell', () => {
    expect(clientInvoiceGapLabel('storage-not-complete')).toBe('Storage not fully measured');
    expect(clientInvoiceGapLabel('something-new')).toBe('something-new');
    expect(gapCountLabel(0)).toBe('—');
    expect(gapCountLabel(1)).toBe('1 gap');
    expect(gapCountLabel(3)).toBe('3 gaps');
  });

  test('the void warning names GSTR-1 and the credit note; the stale word is the spec’s', () => {
    expect(VOID_WARNING).toContain('already reported in GSTR-1, a credit note is the correct fix — not supported yet');
    expect(STALE_WORD).toBe('Figures changed — review and issue again');
  });
});

describe('client invoices — the printed document', () => {
  test('only an issued, disputed or settled invoice is a Tax Invoice', () => {
    expect(clientInvoiceHeading('draft').title).toBe('DRAFT — not a tax invoice');
    expect(clientInvoiceHeading('issued')).toEqual({ title: 'Tax Invoice', notice: null });
    expect(clientInvoiceHeading('disputed').title).toBe('Tax Invoice');
    expect(clientInvoiceHeading('settled').title).toBe('Tax Invoice');
    expect(clientInvoiceHeading('void').title).toBe('VOID — not a valid tax invoice');
  });

  test('a line: description with the segment dates, quantity in base-unit-days or counts, the rate per unit', () => {
    const storage = { chargeCode: 'storage', uom: 'kg', segmentFrom: '2026-09-01', segmentTo: '2026-09-14', quantity: '1234.567', unitAmountPaise: 330, amountPaise: 407 } as const;
    expect(lineDescription(storage)).toBe('Storage (kg) · 1 Sep 2026 – 14 Sep 2026');
    expect(lineQuantityLabel(storage)).toBe('1,234.567 kg-days');
    expect(lineRateLabel(storage)).toBe('₹3.30 per 1,000 units/day');
    expect(lineTaxableLabel(storage)).toBe('₹4.07');
    const picks = { chargeCode: 'pick', uom: null, segmentFrom: '2026-09-15', segmentTo: '2026-09-30', quantity: '1', unitAmountPaise: null, amountPaise: null } as const;
    expect(lineDescription(picks)).toBe('Pick · 15 Sep 2026 – 30 Sep 2026');
    expect(lineQuantityLabel(picks)).toBe('1 pick');
    expect(lineQuantityLabel({ ...picks, chargeCode: 'inbound_handling', quantity: '1200' })).toBe('1,200 receipt lines');
    expect(lineRateLabel(picks)).toBe('Unpriced');
    expect(lineTaxableLabel(picks)).toBe('—');
  });

  test('the parties print from the frozen snapshot', () => {
    expect(supplierAddressLines(PARTY)).toEqual(['12 Peenya', 'Bengaluru, Karnataka — 560066']);
    expect(recipientAddressLines(PARTY)).toEqual(['5 FC Road', 'Floor 2', 'Pune, Maharashtra — 411001']);
    expect(supplierAddressLines({ supplier: { ...PARTY.supplier, address: null } })).toEqual([]);
    expect(stateLabel('Karnataka', '29')).toBe('Karnataka (29)');
    expect(stateLabel(null, null)).toBe('—');
  });

  test('Rule 48(2): an issued (disputed, settled) invoice prints in duplicate; a draft or a void once, unlabelled', () => {
    for (const status of ['issued', 'disputed', 'settled'] as const) {
      expect(printCopies(status)).toEqual(['ORIGINAL FOR RECIPIENT', 'DUPLICATE FOR SUPPLIER']);
    }
    expect(printCopies('draft')).toEqual([null]);
    expect(printCopies('void')).toEqual([null]);
  });

  test('the Issue hint names the gaps and the way forward', () => {
    expect(issueBlockedHint(0)).toBeNull();
    expect(issueBlockedHint(1)).toBe('Fix the gap below, then Refresh — a draft with gaps cannot issue.');
    expect(issueBlockedHint(3)).toBe('Fix the 3 gaps below, then Refresh — a draft with gaps cannot issue.');
  });

  test('monthLabel', () => {
    expect(monthLabel('2026-09-01')).toBe('September 2026');
    expect(monthLabel('2027-01')).toBe('January 2027');
  });
});

describe('client invoices — periods and the usage preview', () => {
  test('the month options run from the client’s creation month to the last ENDED month (IST), newest first', () => {
    // 7 Oct 2026 10:00 IST; created 20 Jul 2026.
    const now = Date.parse('2026-10-07T04:30:00Z');
    expect(invoiceMonthOptions('2026-07-20T00:00:00.000Z', now).map((o) => o.value)).toEqual(['2026-09', '2026-08', '2026-07']);
    // 1 Oct 00:10 IST is still 30 Sep 18:40 UTC — September has ended in IST.
    expect(invoiceMonthOptions('2026-09-05T00:00:00.000Z', Date.parse('2026-09-30T18:40:00Z')).map((o) => o.value)).toEqual(['2026-09']);
    // A client created this month has no ended month yet.
    expect(invoiceMonthOptions('2026-10-02T00:00:00.000Z', now)).toEqual([]);
  });

  test('"Invoiced as" names the issued/disputed/settled invoices of the month — never a draft or a void', () => {
    const entries = [
      { clientId: 'c-1', periodStart: '2026-09-01', status: 'issued' as const, invoiceNo: '29/S2627/000001' },
      { clientId: 'c-1', periodStart: '2026-09-01', status: 'settled' as const, invoiceNo: '27/S2627/000001' },
      { clientId: 'c-1', periodStart: '2026-09-01', status: 'void' as const, invoiceNo: '29/S2627/000000' },
      { clientId: 'c-1', periodStart: '2026-09-01', status: 'draft' as const, invoiceNo: null },
      { clientId: 'c-2', periodStart: '2026-09-01', status: 'issued' as const, invoiceNo: '29/S2627/000009' },
      { clientId: 'c-1', periodStart: '2026-08-01', status: 'issued' as const, invoiceNo: '29/S2627/000003' },
    ];
    const numbers = invoicedNumbers(entries, 'c-1', '2026-09-01');
    expect(numbers).toEqual(['29/S2627/000001', '27/S2627/000001']);
    expect(invoicedNotice(numbers)).toBe('Invoiced as 29/S2627/000001, 27/S2627/000001 — the live figures below may differ from the invoice');
    expect(invoicedNotice([])).toBeNull();
  });
});

describe('client invoices — outcomes and refusals', () => {
  test('issue: issued names the number and payable; stale is a warning that nothing was issued', () => {
    expect(issueOutcome({ outcome: 'issued', invoice: invoice({ status: 'issued', invoiceNo: '29/S2627/000001' }) })).toEqual({
      tone: 'accepted',
      word: 'Issued 29/S2627/000001',
      reason: 'Payable ₹56.00. The invoice is frozen from now on.',
    });
    const stale = issueOutcome({ outcome: 'stale', invoice: invoice() });
    expect(stale.tone).toBe('warning');
    expect(stale.word).toBe(STALE_WORD);
    expect(stale.reason).toContain('no number was used');
  });

  test('prepare: created with gaps / all existing', () => {
    expect(prepareOutcome({ created: [invoice({ gaps: [{ code: 'line-unpriced', detail: 'x' }] })], existing: [invoice({ status: 'issued' })] })).toEqual({
      tone: 'accepted',
      word: '1 draft prepared',
      reason: 'For 29AAACT1234A1Z5. 1 already invoiced. 1 gap to clear before issue.',
    });
    expect(prepareOutcome({ created: [], existing: [invoice({ status: 'issued' })] }).word).toBe('Nothing new to prepare');
  });

  test('the prepare refusals branch on code; the transport arm is the house copy', () => {
    expect(prepareReason(new ApiProblem('period-not-ended', 409, 'October runs to 2026-10-31'))).toBe('October runs to 2026-10-31');
    expect(prepareReason(new ApiProblem('client-not-billable', 409))).toBe('Your own company is never invoiced — pick a client brand.');
    expect(prepareReason(new ApiProblem('role-denied', 403))).toContain('owner or an accountant');
    expect(prepareReason(new TypeError('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });

  test('invoice-has-gaps names the gaps from the STRUCTURED extension, never the prose', () => {
    const problem = new ApiProblem('invoice-has-gaps', 409, 'prose we never parse', 'Gaps', {
      gaps: [
        { code: 'storage-not-complete', detail: 'd1' },
        { code: 'einvoice-required', detail: 'd2' },
        { bogus: true },
      ],
    });
    expect(refusalGaps(problem)).toEqual([
      { code: 'storage-not-complete', detail: 'd1' },
      { code: 'einvoice-required', detail: 'd2' },
    ]);
    expect(clientInvoiceActionReason(problem)).toBe('Clear these first, then refresh: Storage not fully measured, E-invoice (IRN) required.');
    expect(clientInvoiceActionReason(new ApiProblem('invoice-transition-invalid', 409, 'settled → disputed'))).toBe('settled → disputed');
    expect(actionNeedsReread(new ApiProblem('invoice-not-draft', 409))).toBe(true);
    expect(actionNeedsReread(problem)).toBe(false);
  });
});
