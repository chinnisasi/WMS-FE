import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { HsnSummaryRowDto } from '@/lib/api/generated';
import { formatRupees } from '@/lib/invoices';
import {
  HSN_CSV_HEADER,
  UQC_DESCRIPTIONS,
  hsnCsvFilename,
  hsnSummaryCsv,
  hsnSummaryReason,
  isCsvRow,
  issueShortfallNote,
  rateOnlyIssueRows,
  istMonthOf,
  mixedUnitsNote,
  paiseToPlainRupees,
  periodOptionLabel,
  periodOptions,
  qtyMilliExact,
  qtyMilliToTwoDecimals,
  quarterOf,
  rateCell,
  uqcCell,
} from './hsn-summary';

function row(overrides: Partial<HsnSummaryRowDto> = {}): HsnSummaryRowDto {
  return {
    hsn: '0910',
    hsnIssue: false,
    rateIssue: false,
    uqc: 'KGS',
    sourceUoms: ['kg'],
    mixedUnits: false,
    gstBps: 500,
    qtyMilli: 2_505,
    lineCount: 2,
    taxablePaise: 123_456,
    igstPaise: 0,
    cgstPaise: 3_086,
    sgstPaise: 3_087,
    totalValuePaise: 129_629,
    ...overrides,
  };
}

describe('the pinned GSTN offline-tool template', () => {
  test('the header row, byte for byte (the one place to update if GSTN changes the template)', () => {
    expect(HSN_CSV_HEADER).toBe(
      'HSN,Description,UQC,Total Quantity,Total Value,Rate,Taxable Value,Integrated Tax Amount,Central Tax Amount,State/UT Tax Amount,Cess Amount',
    );
  });

  test('one full sample row, byte for byte — quoted, Description blank, Cess 0.00, LF, no BOM', () => {
    const csv = hsnSummaryCsv([row()], 'b2b');
    expect(csv).toBe(
      `${HSN_CSV_HEADER}\n"0910","","KGS-KILOGRAMS","2.51","1296.29","5","1234.56","0.00","30.86","30.87","0.00"\n`,
    );
    expect(csv.charCodeAt(0)).toBe('H'.charCodeAt(0)); // no U+FEFF
    expect(csv).not.toContain('\r');
  });

  test('issue rows are excluded; B2B and B2C share the layout; an empty section is the header alone', () => {
    const rows = [row(), row({ hsn: null, hsnIssue: true, uqc: 'NOS' }), row({ hsn: 'HSN 0910', hsnIssue: true })];
    const b2c = hsnSummaryCsv(rows, 'b2c');
    expect(b2c.trim().split('\n')).toHaveLength(2);
    expect(b2c).not.toContain('HSN 0910');
    expect(hsnSummaryCsv(rows, 'b2b')).toBe(b2c);
    expect(hsnSummaryCsv([], 'b2b')).toBe(`${HSN_CSV_HEADER}\n`);
  });

  test('8-1d: rate-issue rows are excluded too — a valid HSN at 12.5 % never reaches the CSV; 0.1 / 1.5 / 7.5 % do', () => {
    const rows = [
      row({ gstBps: 1250, rateIssue: true }),
      row({ gstBps: 10 }),
      row({ gstBps: 150 }),
      row({ gstBps: 750 }),
      row({ hsn: 'HSN 0910', hsnIssue: true, rateIssue: true, gstBps: 1250 }),
    ];
    const lines = hsnSummaryCsv(rows, 'b2b').trim().split('\n').slice(1);
    expect(lines.map((line) => line.split(',')[5])).toEqual(['"0.1"', '"1.5"', '"7.5"']);
    expect(rows.map(isCsvRow)).toEqual([false, true, true, true, false]);
  });

  test('the filename names the section, the GSTIN and the period', () => {
    expect(hsnCsvFilename('b2b', '29AAAPZ1234C1ZV', 'FY-2627-Q2')).toBe('hsn-b2b-29AAAPZ1234C1ZV-FY-2627-Q2.csv');
    expect(hsnCsvFilename('b2c', '29AAAPZ1234C1ZV', '2026-09')).toBe('hsn-b2c-29AAAPZ1234C1ZV-2026-09.csv');
  });
});

describe('cells', () => {
  test('paiseToPlainRupees: ASCII, no grouping, no symbol, exact', () => {
    expect([0, 5, 100, 123_456, 100_000_000_01].map(paiseToPlainRupees)).toEqual(['0.00', '0.05', '1.00', '1234.56', '100000000.01']);
    expect(paiseToPlainRupees(-49)).toBe('-0.49');
  });

  test('qtyMilliToTwoDecimals: one half-up rounding per row, in integers', () => {
    expect([0, 333, 334, 335, 1_500, 2_505, 999_995, 4].map(qtyMilliToTwoDecimals)).toEqual([
      '0.00', '0.33', '0.33', '0.34', '1.50', '2.51', '1000.00', '0.00',
    ]);
    expect(qtyMilliToTwoDecimals(-335)).toBe('-0.34');
  });

  test('qtyMilliExact: the screen shows the unrounded sum', () => {
    expect([2_500, 333, 1].map(qtyMilliExact)).toEqual(['2.500', '0.333', '0.001']);
  });

  test('rateCell: a plain number from basis points', () => {
    expect([1800, 500, 25, 1250, 0, 300, 10_000].map(rateCell)).toEqual(['18', '5', '0.25', '12.5', '0', '3', '100']);
  });

  test('uqcCell: CODE-DESCRIPTION in the GSTN master spellings; 25 codes', () => {
    expect(uqcCell('KGS')).toBe('KGS-KILOGRAMS');
    expect(uqcCell('NOS')).toBe('NOS-NUMBERS');
    expect(uqcCell('MLT')).toBe('MLT-MILILITRE');
    expect(uqcCell('GMS')).toBe('GMS-GRAMMES');
    expect(uqcCell('OTH')).toBe('OTH-OTHERS');
    expect(uqcCell('TON')).toBe('TON-TONNES');
    expect(uqcCell('XYZ')).toBe('OTH-OTHERS');
    expect(uqcCell('constructor')).toBe('OTH-OTHERS');
    // Every code the backend's 35-unit table can produce.
    expect(Object.keys(UQC_DESCRIPTIONS).sort()).toEqual(
      ['NOS', 'BOX', 'CTN', 'PAC', 'BAG', 'DRM', 'ROL', 'BDL', 'PRS', 'DOZ', 'BTL', 'CAN', 'TUB', 'SET', 'GMS', 'KGS', 'TON', 'MLT', 'LTR', 'KLR', 'CMS', 'MTR', 'SQM', 'SQF', 'OTH'].sort(),
    );
  });
});

describe('periods', () => {
  test('the IST month of an instant — the boundary millisecond', () => {
    expect(istMonthOf('2026-09-30T18:29:59.999Z')).toEqual({ year: 2026, month0: 8 });
    expect(istMonthOf('2026-09-30T18:30:00.000Z')).toEqual({ year: 2026, month0: 9 });
  });

  test('quarterOf: FY quarters, Q4 across the calendar year', () => {
    expect(quarterOf(2026, 3)).toBe('FY-2627-Q1');
    expect(quarterOf(2026, 8)).toBe('FY-2627-Q2');
    expect(quarterOf(2026, 9)).toBe('FY-2627-Q3');
    expect(quarterOf(2027, 0)).toBe('FY-2627-Q4');
    expect(quarterOf(2027, 2)).toBe('FY-2627-Q4');
    expect(quarterOf(2099, 11)).toBe('FY-9900-Q3');
  });

  test('options span the GSTIN’s first issue to the later of its last issue and today, newest first; today’s are in progress', () => {
    const now = Date.parse('2026-10-03T06:00:00Z');
    const { months, quarters } = periodOptions({ firstIssuedAt: '2026-06-30T18:30:00.000Z', lastIssuedAt: '2026-09-30T18:29:59.999Z' }, now);
    expect(months.map((m) => m.value)).toEqual(['2026-10', '2026-09', '2026-08', '2026-07']);
    expect(months.map((m) => m.inProgress)).toEqual([true, false, false, false]);
    expect(quarters.map((q) => q.value)).toEqual(['FY-2627-Q3', 'FY-2627-Q2']);
    expect(periodOptionLabel(months[0]!)).toBe('October 2026 — in progress');
    expect(periodOptionLabel(months[1]!)).toBe('September 2026');
    expect(periodOptionLabel(quarters[0]!)).toBe('FY 2026-27 Q3 (Oct–Dec) — in progress');
    expect(periodOptionLabel(quarters[1]!)).toBe('FY 2026-27 Q2 (Jul–Sep)');
  });

  test('a last issue AFTER today (a skewed clock) still offers its month', () => {
    const now = Date.parse('2026-10-03T06:00:00Z');
    const { months } = periodOptions({ firstIssuedAt: '2026-10-01T00:00:00Z', lastIssuedAt: '2026-11-02T00:00:00Z' }, now);
    expect(months.map((m) => m.value)).toEqual(['2026-11', '2026-10']);
  });
});

describe('copy', () => {
  test('mixed units are named; a single-unit row says nothing', () => {
    expect(mixedUnitsNote({ mixedUnits: true, sourceUoms: ['jar', 'keg'] })).toContain('(jar, keg)');
    expect(mixedUnitsNote({ mixedUnits: false, sourceUoms: ['kg'] })).toBeNull();
  });

  test('the issue shortfall states the value Table 12 will be short by', () => {
    expect(issueShortfallNote([], [row()], formatRupees)).toBeNull();
    const note = issueShortfallNote([{ valuePaise: 11_800 }, { valuePaise: 5_901 }], [row()], formatRupees)!;
    expect(note).toContain('2 invoice lines have a blank or malformed HSN');
    expect(note).toContain('₹177.01 short');
  });

  test('8-1d: the shortfall adds the rate-only issue rows once — a row flagged for both is counted through its issue lines', () => {
    const rows = [
      row({ gstBps: 1250, rateIssue: true, totalValuePaise: 11_250 }),
      // Both flags: its value is already in the issue lines below — never added twice.
      row({ hsn: 'HSN 0910', hsnIssue: true, rateIssue: true, gstBps: 1250, totalValuePaise: 1_125 }),
      row({ totalValuePaise: 99_999 }),
    ];
    expect(rateOnlyIssueRows(rows)).toEqual([rows[0]!]);
    const note = issueShortfallNote([{ valuePaise: 1_125 }], rows, formatRupees)!;
    expect(note).toContain('1 invoice line has a blank or malformed HSN');
    expect(note).toContain('1 row has a GST rate not on the GST rate master (12.5%)');
    expect(note).toContain('₹123.75 short'); // 11,250 + 1,125 paise
    const rateOnly = issueShortfallNote([], [rows[0]!], formatRupees)!;
    expect(rateOnly).toMatch(/^1 row has a GST rate not on the GST rate master \(12\.5%\)\./);
    expect(rateOnly).toContain('₹112.50 short');
  });

  test('the reason mapper branches on code; the transport arm is the house copy', () => {
    expect(hsnSummaryReason(new ApiProblem('validation-failed', 400, 'period must be …', 'Bad'))).toBe('period must be …');
    expect(hsnSummaryReason(new ApiProblem('permission-denied', 403))).toContain('another tenant');
    expect(hsnSummaryReason(new TypeError('Failed to fetch'))).toContain('unreachable');
  });
});
