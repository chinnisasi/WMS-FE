import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import type { InvoiceDto } from './api/generated';
import {
  GST_STATE_NAMES,
  addressLines,
  amountInWords,
  canRegenerate,
  documentHeading,
  formatRoundOff,
  formatRupees,
  gapLabel,
  gapPrefix,
  gapSummary,
  generateOutcome,
  generateReason,
  gstRateLabel,
  invoiceDateLabel,
  invoiceDetailReason,
  invoiceListReason,
  invoiceNumberLabel,
  isBlockingGap,
  lineQuantityLabel,
  parseRateDraft,
  parseRupees,
  placeOfSupplyLabel,
  readInvoiceDocument,
  refusalNeedsReread,
  regenerateNote,
  supplyLabel,
  taxRateLabels,
  taxTotals,
  unpricedLineIds,
} from './invoices';
import { UNREACHABLE_REASON } from './outbound-orders';

/**
 * Story 8-1 — the invoice surface's pure decisions. Money is integer paise
 * end to end; these tests pin that no float ever enters (0.07 → 7 paise,
 * never 7.000000000000001) and that nothing rounds.
 */

/** A copy of `object` with `key` ABSENT (jsonb drops undefined keys — the shape a reader must survive). */
function without<T extends object>(object: T, key: keyof T): Partial<T> {
  const copy: Partial<T> = { ...object };
  delete copy[key];
  return copy;
}

function problem(code: string, status = 409, detail?: string): ApiProblem {
  return new ApiProblem(code, status, detail, 'Refused');
}

const DOCUMENT = {
  header: {
    invoiceNo: null,
    fyLabel: null,
    orderRef: '0198f7a2-1b3c-7d4e-8f90-0000000000aa',
    issuedAt: null,
    supplyType: 'intra',
    placeOfSupply: '27',
    originGstin: '27AAAPZ1234C1ZV',
    consigneeGstin: null,
    originAddress: { line1: '22, Chakan MIDC', city: 'Pune', state: 'Maharashtra', pincode: '410501' },
    consigneeAddress: null,
  },
  seller: { name: 'Priya Spices', gstin: '27AAAPZ1234C1ZV' },
  buyer: { name: 'Asha', gstin: null },
  lines: [
    {
      orderLineId: 'line-priced',
      skuCode: 'SPICE-01',
      skuName: 'Turmeric',
      hsn: '0910',
      qtyMilli: 2500,
      uom: 'kg',
      ratePaise: 10000,
      rateSource: 'order_line',
      taxablePaise: 25000,
      gstBps: 500,
      cgstPaise: 625,
      sgstPaise: 625,
      igstPaise: 0,
      hsnGap: false,
    },
  ],
  totals: { subtotal: 25000, gst: 1250, total: 26250, roundOff: 50, payable: 26300 },
  gaps: [
    { kind: 'unpriced-line', detail: 'line X has no rate', orderLineId: 'line-a' },
    { kind: 'hsn-gap', detail: 'line Y blank HSN', orderLineId: 'line-b' },
    { kind: 'unpriced-line', detail: 'line Z has no rate', orderLineId: 'line-c' },
    { kind: 'unpriced-line', detail: 'line A again', orderLineId: 'line-a' },
  ],
  revision: 1,
};

describe('money and rates — integer paise, never a float', () => {
  test('formatRupees renders paise exactly with Indian grouping and two decimals', () => {
    expect(formatRupees(0)).toBe('₹0.00');
    expect(formatRupees(7)).toBe('₹0.07');
    expect(formatRupees(12550)).toBe('₹125.50');
    expect(formatRupees(12345678)).toBe('₹1,23,456.78');
    expect(formatRupees(-150)).toBe('−₹1.50');
  });

  test('gstRateLabel reads basis points without a float division', () => {
    expect(gstRateLabel(0)).toBe('0%');
    expect(gstRateLabel(500)).toBe('5%');
    expect(gstRateLabel(1800)).toBe('18%');
    expect(gstRateLabel(1250)).toBe('12.5%');
    expect(gstRateLabel(25)).toBe('0.25%');
    expect(gstRateLabel(300)).toBe('3%');
  });

  test('parseRupees: whole rupees and up to two decimals, as exact paise', () => {
    expect(parseRupees('125')).toEqual({ paise: 12500 });
    expect(parseRupees(' 125.5 ')).toEqual({ paise: 12550 });
    expect(parseRupees('0.07')).toEqual({ paise: 7 }); // never 7.000000000000001
    expect(parseRupees('0')).toEqual({ paise: 0 });
  });

  test('parseRupees refuses — never rounds — a third decimal, signs, exponents and hex', () => {
    for (const bad of ['125.505', '-5', '1e3', '0x10', '', '12,50', '.5', '5.']) {
      expect('problem' in parseRupees(bad)).toBe(true);
    }
    expect('problem' in parseRupees('99999999999999999')).toBe(true); // past the safe integer
  });
});

describe('vocabulary', () => {
  test('exactly the three parking kinds block; warnings do not', () => {
    expect(isBlockingGap('unpriced-line')).toBe(true);
    expect(isBlockingGap('place-of-supply')).toBe(true);
    expect(isBlockingGap('supplier-gstin')).toBe(true);
    expect(isBlockingGap('hsn-gap')).toBe(false);
    expect(isBlockingGap('pos-discrepancy')).toBe(false);
  });

  test('a gap kind this client does not know still renders, by its code', () => {
    expect(gapLabel('supplier-gstin')).toBe('No supplier GSTIN');
    expect(gapLabel('brand-new-kind')).toBe('brand-new-kind');
  });

  test('supplyLabel names the supply type and the place of supply, or says unresolved', () => {
    expect(supplyLabel('intra', '27')).toBe('Intra-state (27)');
    expect(supplyLabel('inter', '29')).toBe('Inter-state (29)');
    expect(supplyLabel(null, null)).toBe('Unresolved');
  });

  test('a line quantity is in the SNAPSHOT unit; the catalog lends precision only while its unit still matches', () => {
    expect(lineQuantityLabel(2500, 'kg', { uom: 'kg', uomPrecision: 3 })).toBe('2.500 kg');
    expect(lineQuantityLabel(3000, 'each', { uom: 'each', uomPrecision: 0 })).toBe('3 each');
    // Catalog not loaded / SKU gone: the raw figure, still in the frozen unit.
    expect(lineQuantityLabel(2500, 'kg', null)).toBe('2.5 kg');
    // The catalog's unit changed since issue: never print the new unit.
    expect(lineQuantityLabel(2500, 'kg', { uom: 'g', uomPrecision: 0 })).toBe('2.5 kg');
  });

  test('gapPrefix and gapSummary: blocking kinds first, warnings after, a dash when none', () => {
    expect(gapPrefix('supplier-gstin')).toBe('Blocking');
    expect(gapPrefix('hsn-gap')).toBe('Warning');
    expect(gapSummary([])).toBe('—');
    expect(gapSummary(['hsn-gap', 'unpriced-line'])).toBe('Unpriced line · HSN missing');
  });

  test('only an issued invoice is headed a tax invoice; a voided one is not described as unnumbered', () => {
    expect(documentHeading('issued')).toEqual({ title: 'Tax invoice', notice: null });
    expect(documentHeading('awaiting-data').title).toBe('Draft — not a tax invoice');
    expect(documentHeading('awaiting-data').notice).toContain('has no number');
    expect(documentHeading('voided').title).toBe('Voided — not a valid tax invoice');
    expect(documentHeading('voided').notice).not.toContain('no number');
  });

  test('only an awaiting-data invoice can be regenerated — an issued or voided one is frozen (8-1b)', () => {
    expect(canRegenerate('awaiting-data')).toBe(true);
    expect(canRegenerate('issued')).toBe(false);
    expect(canRegenerate('voided')).toBe(false);
    // The note no longer promises an issued invoice a new revision.
    expect(regenerateNote()).not.toContain('new revision');
    expect(regenerateNote()).toContain('frozen');
  });

  test('the list labels a number with its supplier GSTIN — two same-state GSTINs share numbers (8-1b)', () => {
    expect(invoiceNumberLabel('27/2627/000001', '27NUMAA1111A1Z1')).toEqual({ number: '27/2627/000001', gstin: '27NUMAA1111A1Z1' });
    expect(invoiceNumberLabel('27/2627/000001', '27NUMBB2222B2Z2')).not.toEqual(invoiceNumberLabel('27/2627/000001', '27NUMAA1111A1Z1'));
    expect(invoiceNumberLabel(null, '27NUMAA1111A1Z1')).toEqual({ number: 'Unnumbered', gstin: null });
  });

  test('the round-off prints signed, from the stored figure', () => {
    expect(formatRoundOff(38)).toBe('+₹0.38');
    expect(formatRoundOff(-49)).toBe('−₹0.49');
    expect(formatRoundOff(50)).toBe('+₹0.50');
    expect(formatRoundOff(0)).toBe('₹0.00');
  });

  test('addressLines skips absent parts instead of printing undefined', () => {
    expect(addressLines(null)).toEqual([]);
    expect(addressLines(undefined)).toEqual([]);
    expect(addressLines({ line1: '22, Chakan MIDC', city: 'Pune', state: 'Maharashtra', pincode: '410501' })).toEqual([
      '22, Chakan MIDC',
      'Pune, Maharashtra — 410501',
    ]);
  });
});

describe('the document snapshot', () => {
  test('a well-formed document reads; the unpriced lines come from the STRUCTURED orderLineId, deduplicated', () => {
    const document = readInvoiceDocument(DOCUMENT);
    expect(document).not.toBeNull();
    expect(unpricedLineIds(document!)).toEqual(['line-a', 'line-c']);
  });

  test('an unpriced gap without a structured orderLineId offers nothing — the prose is never parsed', () => {
    const document = readInvoiceDocument({
      ...DOCUMENT,
      gaps: [{ kind: 'unpriced-line', detail: 'line SPICE-01 (0198f7a2-1b3c-7d4e-8f90-0000000000bb) has no rate' }],
    });
    expect(unpricedLineIds(document!)).toEqual([]);
  });

  test('a shape it does not recognise is unreadable, never half-rendered', () => {
    expect(readInvoiceDocument(null)).toBeNull();
    // Rendered fields that are ABSENT (jsonb drops undefined keys) — the
    // crash / "Invalid Date" cases.
    expect(readInvoiceDocument({ ...DOCUMENT, header: without(DOCUMENT.header, 'consigneeAddress') })).toBeNull();
    expect(readInvoiceDocument({ ...DOCUMENT, header: without(DOCUMENT.header, 'issuedAt') })).toBeNull();
    expect(readInvoiceDocument({ ...DOCUMENT, header: { ...DOCUMENT.header, supplyType: 'sideways' } })).toBeNull();
    expect(readInvoiceDocument({ ...DOCUMENT, lines: [without(DOCUMENT.lines[0]!, 'uom')] })).toBeNull();
    expect(readInvoiceDocument({ ...DOCUMENT, totals: { subtotal: 1, gst: 0 } })).toBeNull();
    // The 8-1 shape (`payAble`, no round-off) is not this document any more.
    expect(readInvoiceDocument({ ...DOCUMENT, totals: { subtotal: 25000, gst: 1250, payAble: 26250 } })).toBeNull();
    expect(readInvoiceDocument({ ...DOCUMENT, totals: without(DOCUMENT.totals, 'roundOff') })).toBeNull();
    expect(readInvoiceDocument({ ...DOCUMENT, totals: without(DOCUMENT.totals, 'payable') })).toBeNull();
    expect(readInvoiceDocument({ ...DOCUMENT, totals: without(DOCUMENT.totals, 'total') })).toBeNull();
    expect(readInvoiceDocument({ ...DOCUMENT, lines: [{ orderLineId: 'x' }] })).toBeNull();
    expect(readInvoiceDocument({ ...DOCUMENT, gaps: [{ kind: 'unpriced-line' }] })).toBeNull();
  });
});

describe('the pricing draft', () => {
  const entries = (a: string, c: string) => [
    { orderLineId: 'line-a', label: 'SPICE-01 — Turmeric', text: a },
    { orderLineId: 'line-c', label: 'SPICE-02 — Chilli', text: c },
  ];

  test('blank entries are dropped; the priced ones become exact paise', () => {
    expect(parseRateDraft(entries('125.50', ''))).toEqual({ rates: [{ orderLineId: 'line-a', ratePaise: 12550 }], problem: null });
  });

  test('a bad entry sends nothing and names its line', () => {
    const parsed = parseRateDraft(entries('125.50', '1e3'));
    expect(parsed.rates).toEqual([]);
    expect(parsed.problem).toContain('SPICE-02 — Chilli');
  });

  test('an all-blank draft sends nothing', () => {
    expect(parseRateDraft(entries('', ' ')).problem).toBe('Enter a rate for at least one unpriced line.');
  });
});

describe('outcomes and refusals', () => {
  const invoice = (over: Partial<InvoiceDto>): InvoiceDto =>
    ({
      id: 'inv-1',
      status: 'issued',
      invoiceNo: '27/2627/000004',
      totalPaise: 26250,
      payablePaise: 26300,
      roundOffPaise: 50,
      revision: 2,
      document: DOCUMENT,
      ...over,
    }) as InvoiceDto;

  test('an issued response names its number, the rupee-rounded PAYABLE and revision', () => {
    expect(generateOutcome(invoice({}))).toEqual({
      tone: 'accepted',
      word: 'Invoice issued',
      reason: '27/2627/000004 — payable ₹263.00 (revision 2).',
    });
  });

  test('a response still awaiting data names exactly the BLOCKING gaps, once each', () => {
    const outcome = generateOutcome(invoice({ status: 'awaiting-data', invoiceNo: null }));
    expect(outcome.word).toBe('Saved — still awaiting data');
    expect(outcome.reason).toBe('Still blocked by: Unpriced line.');
  });

  test('generateReason branches on the code, with the 8-1 arms', () => {
    expect(generateReason(problem('line-already-priced'))).toContain('already carries the rate frozen');
    expect(generateReason(problem('order-not-dispatched'))).toContain('not dispatched');
    // Story 21-2b — a client brand's order is never invoiced here.
    expect(generateReason(problem('client-order-not-invoiced'))).toContain('client brand');
    expect(generateReason(problem('line-not-of-order'))).toContain('does not belong');
    expect(generateReason(problem('invoice-frozen'))).toContain('frozen');
    expect(generateReason(problem('invoice-frozen'))).toContain('has been re-read');
    expect(generateReason(problem('not-found', 404))).toContain('No order');
    expect(generateReason(problem('role-denied', 403))).toBe('Your role cannot generate invoices.');
    expect(generateReason(problem('something-new', 409, 'Server says so.'))).toBe('Server says so.');
    expect(generateReason(problem('something-new', 409))).toBe('Not generated (something-new).');
    expect(generateReason(new Error('fetch failed'))).toBe(UNREACHABLE_REASON);
  });

  test('the read mappers name the stale cursor and the missing invoice', () => {
    expect(invoiceListReason(problem('invalid-cursor', 400))).toContain('restarts the list from the first page');
    expect(invoiceDetailReason(problem('not-found', 404))).toContain('no longer exists');
    expect(invoiceListReason(new Error('down'))).toBe(UNREACHABLE_REASON);
  });
});

describe('GST Rule 46 particulars', () => {
  test('each tax prints its own rate: intra halves exactly, inter carries the whole, unresolved charges none', () => {
    expect(taxRateLabels(1800, 'intra')).toEqual({ cgst: '9%', sgst: '9%', igst: '—' });
    expect(taxRateLabels(500, 'intra')).toEqual({ cgst: '2.5%', sgst: '2.5%', igst: '—' });
    expect(taxRateLabels(25, 'intra')).toEqual({ cgst: '0.125%', sgst: '0.125%', igst: '—' });
    expect(taxRateLabels(1800, 'inter')).toEqual({ cgst: '—', sgst: '—', igst: '18%' });
    expect(taxRateLabels(1800, null)).toEqual({ cgst: '—', sgst: '—', igst: '—' });
  });

  test('the per-tax totals are the sums of the lines', () => {
    const line = DOCUMENT.lines[0]!;
    expect(taxTotals([line, { ...line, cgstPaise: 1, sgstPaise: 2, igstPaise: 3 }])).toEqual({ cgst: 626, sgst: 627, igst: 3 });
  });

  test('the total in words uses the Indian system, paise included, exactly', () => {
    expect(amountInWords(0)).toBe('Indian Rupees Zero Only');
    expect(amountInWords(100)).toBe('Indian Rupees One Only');
    expect(amountInWords(26250)).toBe('Indian Rupees Two Hundred Sixty-Two and Fifty Paise Only');
    expect(amountInWords(123456789)).toBe(
      'Indian Rupees Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven and Eighty-Nine Paise Only',
    );
    expect(amountInWords(1_250_000_000_07)).toBe('Indian Rupees One Hundred Twenty-Five Crore and Seven Paise Only');
    expect(amountInWords(1_000_000_000_000_00)).toBe('Indian Rupees One Lakh Crore Only'); // 10¹⁴ paise = ₹10¹²
  });

  test('8-1d: the new warning kinds have labels, and none of them blocks', () => {
    expect(gapLabel('hsn-invalid')).toBe('HSN malformed');
    expect(gapLabel('state-text-unknown')).toBe('State not recognised');
    expect(gapLabel('gstin-prefix-unknown')).toBe('GSTIN state code unknown');
    expect(gapLabel('party-name-unprintable')).toBe('Name not printable for e-way');
    for (const kind of ['hsn-invalid', 'state-text-unknown', 'gstin-prefix-unknown', 'party-name-unprintable']) {
      expect(isBlockingGap(kind)).toBe(false);
      expect(gapPrefix(kind)).toBe('Warning');
    }
  });

  test('the place of supply prints by name from the CBIC list (38 entries, mirroring the wms-be seed)', () => {
    expect(Object.keys(GST_STATE_NAMES)).toHaveLength(38);
    expect(GST_STATE_NAMES['25']).toBeUndefined(); // the pre-merger code
    expect(placeOfSupplyLabel('27')).toBe('27 — Maharashtra');
    expect(placeOfSupplyLabel('38')).toBe('38 — Ladakh');
    expect(placeOfSupplyLabel('26')).toBe('26 — Dadra and Nagar Haveli and Daman and Diu');
    expect(placeOfSupplyLabel('98')).toBe('98'); // unknown still prints, by code
    expect(placeOfSupplyLabel(null)).toBe('Unresolved');
  });

  test('the invoice date is the IST calendar date, whatever the viewer zone', () => {
    // 31 Mar 20:00 UTC is 1 Apr 01:30 IST — the FY the number was taken in.
    expect(invoiceDateLabel('2027-03-31T20:00:00.000Z')).toContain('Apr');
    expect(invoiceDateLabel('2027-03-31T20:00:00.000Z')).toContain('01');
  });
});

describe('the refusal re-read', () => {
  test('exactly the stale-line-set refusals and invoice-frozen re-read', () => {
    expect(refusalNeedsReread(problem('line-already-priced'))).toBe(true);
    expect(refusalNeedsReread(problem('line-not-of-order'))).toBe(true);
    expect(refusalNeedsReread(problem('invoice-frozen'))).toBe(true);
    expect(refusalNeedsReread(problem('order-not-dispatched'))).toBe(false);
    expect(refusalNeedsReread(new Error('down'))).toBe(false);
  });

  test('the mappers carry the house set', () => {
    expect(invoiceListReason(problem('role-denied', 403))).toBe('Your role cannot read invoices.');
    expect(invoiceListReason(problem('invalid-cursor', 400))).toContain('Retry restarts');
    expect(invoiceDetailReason(problem('validation-failed', 400))).toContain('malformed');
  });
});

