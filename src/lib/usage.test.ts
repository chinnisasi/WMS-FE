import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import { UNREACHABLE_REASON } from './outbound-orders';
import {
  ESTIMATE_NOTICE,
  MAX_USAGE_DAYS,
  STORAGE_NOT_MEASURED,
  billedTotalLabel,
  defaultUsageMonth,
  groupDecimal,
  parseCustomRange,
  periodInProgress,
  segmentBilledPaise,
  segmentHeading,
  segmentTotalLabel,
  storageNotice,
  usageAmountLabel,
  usageMonthLabel,
  usageMonthOptions,
  usageQuantityLabel,
  usageRateLabel,
  usageReason,
  usageUnitLabel,
} from './usage';

/** 10:00 IST on 7 Oct 2026 — the server's asOf. */
const AS_OF = '2026-10-07T04:30:00.000Z';

describe('the period picker', () => {
  test('months from the client’s creation (IST) to the current month, newest first, the current one in progress', () => {
    // Created 23:30 IST on 31 Jul — still July in IST, though 18:00Z.
    const options = usageMonthOptions('2026-07-31T18:00:00.000Z', AS_OF);
    expect(options.map((option) => option.value)).toEqual(['2026-10', '2026-09', '2026-08', '2026-07']);
    expect(options[0]).toEqual({ value: '2026-10', label: 'October 2026', from: '2026-10-01', to: '2026-10-31', inProgress: true });
    expect(options[1]).toMatchObject({ from: '2026-09-01', to: '2026-09-30', inProgress: false });
    expect(usageMonthLabel(options[0]!)).toBe('October 2026 — in progress');
    expect(usageMonthLabel(options[1]!)).toBe('September 2026');
  });

  test('a creation instant past midnight IST moves the first month; February is 28 or 29 days', () => {
    expect(usageMonthOptions('2026-07-31T18:30:00.000Z', AS_OF).at(-1)!.value).toBe('2026-08');
    const leap = usageMonthOptions('2028-02-10T00:00:00.000Z', '2028-03-02T00:00:00.000Z');
    expect(leap.at(-1)).toMatchObject({ value: '2028-02', to: '2028-02-29' });
    const plain = usageMonthOptions('2027-02-10T00:00:00.000Z', '2027-03-02T00:00:00.000Z');
    expect(plain.at(-1)).toMatchObject({ value: '2027-02', to: '2027-02-28' });
  });

  test('the default is last month; a client created this month defaults to the current month', () => {
    expect(defaultUsageMonth(usageMonthOptions('2026-01-15T00:00:00.000Z', AS_OF))?.value).toBe('2026-09');
    expect(defaultUsageMonth(usageMonthOptions('2026-10-06T00:00:00.000Z', AS_OF))?.value).toBe('2026-10');
    expect(defaultUsageMonth([])).toBeNull();
  });

  test('the custom range: both dates, from ≤ to, at most 366 days — anything else is a problem and nothing is sent', () => {
    expect(parseCustomRange('2026-09-01', '2026-09-30')).toEqual({ period: { from: '2026-09-01', to: '2026-09-30' }, problem: null });
    expect(parseCustomRange('', '2026-09-30').problem).toBe('Pick both a start and an end date.');
    expect(parseCustomRange('2026-09-30', '2026-09-01').problem).toBe('The start date is after the end date.');
    expect(MAX_USAGE_DAYS).toBe(366);
    expect(parseCustomRange('2025-09-01', '2026-09-01').problem).toBeNull(); // exactly 366
    expect(parseCustomRange('2025-09-01', '2026-09-02').problem).toBe('A period covers at most 366 days.');
  });
});

describe('a line', () => {
  test('storage reads as base-unit-days per base unit, the server’s exact decimal with separators — never re-rounded', () => {
    expect(usageQuantityLabel({ chargeCode: 'storage', uom: 'kg', quantity: '1234.567' })).toBe('1,234.567 kg-days');
    expect(usageQuantityLabel({ chargeCode: 'storage', uom: 'each', quantity: '1152921504606846.976' })).toBe('1,152,921,504,606,846.976 each-days');
    expect(usageQuantityLabel({ chargeCode: 'storage', uom: null, quantity: '0' })).toBe('0 unit-days');
    expect(groupDecimal('1000000')).toBe('1,000,000');
    expect(groupDecimal('999')).toBe('999');
  });

  test('the handling counts read as receipt lines, picks and orders (singular at one)', () => {
    expect(usageQuantityLabel({ chargeCode: 'inbound_handling', uom: null, quantity: '3' })).toBe('3 receipt lines');
    expect(usageQuantityLabel({ chargeCode: 'inbound_handling', uom: null, quantity: '1' })).toBe('1 receipt line');
    expect(usageQuantityLabel({ chargeCode: 'pick', uom: null, quantity: '1200' })).toBe('1,200 picks');
    expect(usageQuantityLabel({ chargeCode: 'outbound_handling', uom: null, quantity: '1' })).toBe('1 order');
    expect(usageUnitLabel({ uom: null })).toBe('—');
    expect(usageUnitLabel({ uom: 'kg' })).toBe('kg');
  });

  test('rate and amount: priced, or — / Not billed (₹0 is billed at zero)', () => {
    expect(usageRateLabel({ ratePaise: 330, basis: 'per_thousand_units_per_day' })).toBe('₹3.30 per 1,000 units per day');
    expect(usageRateLabel({ ratePaise: null, basis: 'per_order' })).toBe('—');
    expect(usageAmountLabel({ amountPaise: 40_700, chargeCode: 'pick', ratePaise: 300 })).toBe('₹407.00');
    expect(usageAmountLabel({ amountPaise: 0, chargeCode: 'pick', ratePaise: 0 })).toBe('₹0.00');
    expect(usageAmountLabel({ amountPaise: null, chargeCode: 'pick', ratePaise: null })).toBe('Not billed');
    // A priced storage line in a stretch not fully measured: withheld, not unbilled.
    const partly = { storageMeasuredThrough: '2026-10-06', toDate: '2026-10-31' };
    expect(usageAmountLabel({ amountPaise: null, chargeCode: 'storage', ratePaise: 330 }, partly)).toBe('Pending — not all days measured');
    expect(usageAmountLabel({ amountPaise: null, chargeCode: 'storage', ratePaise: null }, partly)).toBe('Not billed');
    expect(usageAmountLabel({ amountPaise: 198, chargeCode: 'storage', ratePaise: 330 }, { storageMeasuredThrough: '2026-09-30', toDate: '2026-09-30' })).toBe('₹1.98');
  });
});

describe('segments, totals and notices', () => {
  const SEGMENT = {
    rateCardId: 'card-a',
    fromDate: '2026-09-01',
    toDate: '2026-09-14',
    lines: [
      { chargeCode: 'storage' as const, basis: 'per_thousand_units_per_day' as const, uom: 'kg', quantity: '600', ratePaise: 330, amountPaise: 198 },
      { chargeCode: 'pick' as const, basis: 'per_pick' as const, uom: null, quantity: '2', ratePaise: 350, amountPaise: 700 },
      { chargeCode: 'outbound_handling' as const, basis: 'per_order' as const, uom: null, quantity: '1', ratePaise: null, amountPaise: null },
    ],
  };

  test('a segment names its dates and the card that priced it — or that nothing did', () => {
    expect(segmentHeading(SEGMENT, [{ id: 'card-a', effectiveFrom: '2026-09-01' }])).toBe('1 Sep 2026 – 14 Sep 2026 · card from 1 Sep 2026');
    expect(segmentHeading({ ...SEGMENT, rateCardId: null }, [])).toBe('1 Sep 2026 – 14 Sep 2026 · no rate card in force — not billed');
    expect(segmentBilledPaise(SEGMENT)).toBe(898);
    expect(segmentTotalLabel(SEGMENT)).toBe('Segment total ₹8.98');
  });

  test('the billed total names the unbilled lines', () => {
    expect(billedTotalLabel({ totals: { billedPaise: 399_700, unbilledLines: 1 } })).toBe('Billed total ₹3,997.00 · 1 line not billed');
    expect(billedTotalLabel({ totals: { billedPaise: 0, unbilledLines: 4 } })).toBe('Billed total ₹0.00 · 4 lines not billed');
    expect(billedTotalLabel({ totals: { billedPaise: 100, unbilledLines: 0 } })).toBe('Billed total ₹1.00');
  });

  test('the notices: the estimate; storage through a date, short of the period, or not measured', () => {
    expect(ESTIMATE_NOTICE).toBe('Estimate until invoiced · GST-exclusive');
    expect(storageNotice({ storageCompleteThrough: '2026-09-30', from: '2026-09-01', to: '2026-09-30' })).toBe('Storage through 30 Sep 2026');
    expect(storageNotice({ storageCompleteThrough: '2026-10-06', from: '2026-10-01', to: '2026-10-31' })).toBe(
      'Storage through 6 Oct 2026 — later days are not in the figures yet',
    );
    expect(storageNotice({ storageCompleteThrough: null, from: '2026-09-01', to: '2026-09-30' })).toBe(STORAGE_NOT_MEASURED);
    expect(storageNotice({ storageCompleteThrough: '2026-08-31', from: '2026-09-01', to: '2026-09-30' })).toBe('Storage not measured yet');
    expect(periodInProgress({ to: '2026-10-31', asOf: AS_OF })).toBe(true);
    expect(periodInProgress({ to: '2026-09-30', asOf: AS_OF })).toBe(false);
  });
});

describe('usageReason', () => {
  const problem = (status: number, code: string, detail?: string) => new ApiProblem(code, status, detail, 'Title');

  test('branches on code, never prose; the transport arm is the house copy', () => {
    expect(usageReason(problem(400, 'validation-failed', 'A period covers at most 366 days (got 400).'))).toBe('A period covers at most 366 days (got 400).');
    expect(usageReason(problem(404, 'not-found'))).toBe('This client no longer exists — refresh the page.');
    expect(usageReason(problem(403, 'permission-denied'))).toBe('Your session belongs to another tenant — sign in again.');
    expect(usageReason(problem(401, 'unauthenticated'))).toBe('Your session expired — sign in again.');
    expect(usageReason(problem(500, 'internal'))).toBe('Usage unavailable (internal).');
    expect(usageReason(new Error('fetch failed'))).toBe(UNREACHABLE_REASON);
  });
});
