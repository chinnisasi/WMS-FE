import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import type { ClientChargeDto } from './api/generated';
import {
  CHARGE_CATEGORIES,
  CHARGE_CATEGORY_LABEL,
  CHARGE_STATUSES,
  CHARGE_UNITS,
  OTHER_SACS,
  SAC_BY_CATEGORY,
  approvalForecast,
  billMonthLabel,
  billedLater,
  chargeActions,
  chargeAmountPaise,
  chargeAmountPreview,
  chargeBillingLabel,
  chargeNeedsReread,
  chargePolicyReason,
  chargeQuantityText,
  chargeReadReason,
  chargeRefusalReason,
  chargeWarningLabel,
  chargesEmptyMessage,
  chargesHref,
  decisionOutcome,
  earliestChargeDate,
  emptyChargeForm,
  parseChargeFilters,
  parseChargeForm,
  parseChargeNote,
  parseQuantityMilli,
  parseSelfApproveLimit,
  pendingChargesHref,
  perUnitLabel,
  recordOutcome,
  sacOf,
  selfApproveLimitLabel,
  unitOptionLabel,
  unitPlural,
  type ChargeForm,
} from './client-charges';
import { UNREACHABLE_REASON } from './outbound-orders';

const TODAY = '2026-10-27';
const CLIENT = '0198f7a2-0000-7000-8000-00000000c001';
const WAREHOUSE = '0198f7a2-0000-7000-8000-00000000a001';
const ME = 'u-me';
const OTHER = 'u-other';

function form(over: Partial<ChargeForm> = {}): ChargeForm {
  return {
    ...emptyChargeForm('2026-10-05', CLIENT, WAREHOUSE),
    category: 'extra_labour',
    description: 'Unloading a floor-loaded container',
    unit: 'hour',
    quantity: '2.5',
    rate: '350',
    ...over,
  };
}

function charge(over: Partial<ClientChargeDto> = {}): ClientChargeDto {
  return {
    id: 'ch-1',
    clientId: CLIENT,
    warehouseId: WAREHOUSE,
    supplierGstin: '29AAACT1234A1Z5',
    chargeDate: '2026-10-05',
    billMonth: '2026-10-01',
    category: 'extra_labour',
    description: 'Unloading',
    sacCode: '996719',
    unit: 'hour',
    quantity: '2.5',
    unitRatePaise: 35_000,
    amountPaise: 87_500,
    reference: null,
    clientAuthorizationRef: null,
    evidenceNote: null,
    status: 'pending',
    recordedBy: OTHER,
    recordedAt: '2026-10-05T05:00:00.000Z',
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    cancelledBy: null,
    cancelledAt: null,
    cancelNote: null,
    createdAt: '2026-10-05T05:00:00.000Z',
    billing: null,
    ...over,
  };
}

describe('the mirrored vocabulary (wms-be billing/client-charges.ts)', () => {
  test('the categories, their printed labels and SACs; other chooses from four services SACs', () => {
    expect(CHARGE_CATEGORIES).toEqual(['extra_labour', 'special_handling', 'returns_processing', 'relabelling', 'repacking', 're_slotting', 'extra_storage', 'other']);
    expect(CHARGE_CATEGORY_LABEL.re_slotting).toBe('Re-slotting');
    expect(CHARGE_CATEGORY_LABEL.other).toBe('Other service');
    expect(SAC_BY_CATEGORY).toEqual({
      extra_labour: '996719',
      special_handling: '996719',
      returns_processing: '996719',
      relabelling: '998540',
      repacking: '998540',
      re_slotting: '996729',
      extra_storage: '996729',
    });
    expect(OTHER_SACS).toEqual(['996729', '996719', '998540', '998599']);
    expect(sacOf('repacking', '')).toBe('998540');
    expect(sacOf('other', '')).toBeNull();
    expect(sacOf('other', '998599')).toBe('998599');
    expect(CHARGE_UNITS).toEqual(['each', 'hour', 'day', 'carton', 'pallet', 'order', 'shipment', 'container', 'kg', 'lot']);
    expect(CHARGE_STATUSES).toEqual(['pending', 'approved', 'rejected', 'cancelled']);
  });

  test('units read as words: one, many, the rate basis and the select label', () => {
    expect(chargeQuantityText('2.5', 'hour')).toBe('2.5 hours');
    expect(chargeQuantityText('1', 'pallet')).toBe('1 pallet');
    expect(chargeQuantityText('1.000', 'hour')).toBe('1.000 hour');
    expect(chargeQuantityText('1500', 'each')).toBe('1,500 units');
    expect(chargeQuantityText('3', 'drum')).toBe('3 drum');
    expect(perUnitLabel('kg')).toBe('per kg');
    expect(perUnitLabel('each')).toBe('per unit');
    expect(unitOptionLabel('each')).toBe('Each (unit)');
    expect(unitOptionLabel('container')).toBe('Container');
    expect(unitPlural('carton')).toBe('cartons');
    expect(chargeWarningLabel('charge-late')).toBe('Recorded late');
    expect(chargeWarningLabel('something-new')).toBe('something-new');
  });
});

describe('the amount: round_half_up(quantity_milli × rate / 1000), in BigInt', () => {
  test('the quantity parser is the backend’s (≤ 3 places, no exponent, no sign)', () => {
    expect(parseQuantityMilli('2.5')).toBe(2500n);
    expect(parseQuantityMilli('2.50')).toBe(2500n);
    expect(parseQuantityMilli(' 10000 ')).toBe(10_000_000n);
    expect(parseQuantityMilli('0.001')).toBe(1n);
    expect(parseQuantityMilli('1.2345')).toBeNull();
    expect(parseQuantityMilli('1e3')).toBeNull();
    expect(parseQuantityMilli('-1')).toBeNull();
    expect(parseQuantityMilli('.5')).toBeNull();
  });

  test('the spec’s figures: 2.5 h × ₹350 = ₹875; half a paisa rounds up; below half rounds to zero', () => {
    expect(chargeAmountPaise(2500n, 35_000)).toBe(87_500);
    expect(chargeAmountPaise(1500n, 1)).toBe(2); // 1.5 paise → 2
    expect(chargeAmountPaise(1n, 1)).toBe(0); // 0.001 × ₹0.01 → ₹0.00
    // The largest product never loses a digit (no float): 10,000 × ₹1 lakh = ₹100 crore.
    expect(chargeAmountPaise(10_000_000n, 10_000_000)).toBe(100_000_000_000);
  });

  test('the live preview: the amount, a problem past the bounds, nothing while incomplete', () => {
    expect(chargeAmountPreview('2.5', '350')).toEqual({ paise: 87_500, problem: null });
    expect(chargeAmountPreview('', '350')).toBeNull();
    expect(chargeAmountPreview('2.5', 'abc')).toBeNull();
    expect(chargeAmountPreview('0.001', '0.01')).toEqual({ paise: null, problem: 'Quantity × rate rounds to ₹0.00 — nothing to bill.' });
    expect(chargeAmountPreview('10000', '100000')).toEqual({ paise: null, problem: 'Quantity × rate is over the ₹1,00,00,000.00 cap for one charge.' });
    expect(chargeAmountPreview('1000', '10000')).toEqual({ paise: 1_000_000_000, problem: null });
  });
});

describe('the record form → the body (the backend’s shape rules)', () => {
  test('a valid charge: trimmed text, no SAC for a fixed-SAC category, blank optionals omitted, the quantity as typed', () => {
    expect(parseChargeForm(form({ description: '  Unloading  ', reference: '  ', quantity: ' 2.50 ' }), TODAY)).toEqual({
      body: {
        clientId: CLIENT,
        warehouseId: WAREHOUSE,
        chargeDate: '2026-10-05',
        category: 'extra_labour',
        description: 'Unloading',
        unit: 'hour',
        quantity: '2.50',
        unitRatePaise: 35_000,
      },
      problems: [],
    });
  });

  test('other ⇒ a services SAC is required and sent; references are sent trimmed', () => {
    expect(parseChargeForm(form({ category: 'other' }), TODAY).problems.map((p) => p.field)).toEqual(['sacCode']);
    const parsed = parseChargeForm(form({ category: 'other', sacCode: '998599', reference: ' SO-1042 ', clientAuthorizationRef: 'PO 77', evidenceNote: 'Photos in the shared drive' }), TODAY);
    expect(parsed.body).toMatchObject({ category: 'other', sacCode: '998599', reference: 'SO-1042', clientAuthorizationRef: 'PO 77', evidenceNote: 'Photos in the shared drive' });
    // A SAC left over from a switch to `other` and back is never sent on a fixed-SAC category.
    expect(parseChargeForm(form({ sacCode: '998599' }), TODAY).body).not.toHaveProperty('sacCode');
  });

  test('every problem at once, each on its field', () => {
    const parsed = parseChargeForm(
      { ...emptyChargeForm('2026-10-28'), quantity: '0', rate: '0', description: 'x'.repeat(201), reference: 'r'.repeat(101), evidenceNote: 'e'.repeat(501) },
      TODAY,
    );
    expect(parsed.body).toBeNull();
    expect(parsed.problems.map((p) => p.field)).toEqual(['clientId', 'warehouseId', 'chargeDate', 'category', 'description', 'unit', 'quantity', 'rate', 'reference', 'evidenceNote']);
    expect(parsed.problems.find((p) => p.field === 'chargeDate')?.problem).toBe('A charge is recorded for work already done — today or earlier.');
    expect(parsed.problems.find((p) => p.field === 'description')?.problem).toBe('At most 200 characters (now 201).');
  });

  test('the bounds: quantity ≤ 10,000 and > 0; rate ₹0.01 .. ₹1 lakh; an amount rounding to ₹0.00 is refused on its own field', () => {
    expect(parseChargeForm(form({ quantity: '10000.001' }), TODAY).problems[0]?.field).toBe('quantity');
    expect(parseChargeForm(form({ quantity: '1.2345' }), TODAY).problems[0]?.problem).toMatch(/three decimal places/);
    expect(parseChargeForm(form({ rate: '100000.01' }), TODAY).problems[0]).toEqual({ field: 'rate', problem: 'At most ₹1,00,000.00 per unit.' });
    expect(parseChargeForm(form({ quantity: '0.001', rate: '0.01' }), TODAY).problems).toEqual([{ field: 'amount', problem: 'Quantity × rate rounds to ₹0.00 — nothing to bill.' }]);
    // A code point is one character: 200 emoji are a valid description.
    expect(parseChargeForm(form({ description: '📦'.repeat(200) }), TODAY).problems).toEqual([]);
  });

  test('A10 — the date window: today or earlier, back to 1 April of the previous financial year', () => {
    expect(earliestChargeDate('2026-10-27')).toBe('2025-04-01');
    expect(earliestChargeDate('2027-03-31')).toBe('2025-04-01');
    expect(earliestChargeDate('2027-04-01')).toBe('2026-04-01');
    expect(parseChargeForm(form({ chargeDate: TODAY }), TODAY).problems).toEqual([]);
    expect(parseChargeForm(form({ chargeDate: '2025-04-01' }), TODAY).problems).toEqual([]);
    expect(parseChargeForm(form({ chargeDate: '2025-03-31' }), TODAY).problems[0]?.problem).toBe(
      'Too far back — the earliest date is 1 Apr 2025 (1 April of the previous financial year).',
    );
    expect(parseChargeForm(form({ chargeDate: '2026-02-31' }), TODAY).problems[0]?.field).toBe('chargeDate');
  });

  test('a decision note is required, 1..500 characters', () => {
    expect(parseChargeNote('  ', 'reject')).toEqual({ note: null, problem: 'Say why — a note is required to reject a charge.' });
    expect(parseChargeNote(' wrong client ', 'cancel')).toEqual({ note: 'wrong client', problem: null });
    expect(parseChargeNote('x'.repeat(501), 'cancel').problem).toBe('At most 500 characters.');
  });
});

describe('the actions a viewer has (A14, A22, A28)', () => {
  const owner = { userId: ME, canInvoice: true };
  const ops = { userId: ME, canInvoice: false };

  test('a pending charge: a billing.invoice holder approves and rejects another’s; never approves their own (second approver)', () => {
    expect(chargeActions(charge(), owner)).toEqual({ approve: true, approveBlocked: null, reject: true, cancel: true, hint: null });
    const own = chargeActions(charge({ recordedBy: ME }), owner);
    expect(own.approve).toBe(true);
    expect(own.approveBlocked).toBe('You recorded this charge — another member with billing rights must approve it.');
    expect(own.reject).toBe(true);
  });

  test('a pending charge without billing.invoice: the recorder cancels their own; nobody else acts; both are told why', () => {
    expect(chargeActions(charge({ recordedBy: ME }), ops)).toEqual({
      approve: false,
      approveBlocked: null,
      reject: false,
      cancel: true,
      hint: 'Awaiting approval by an owner or an accountant. You can cancel it while it waits.',
    });
    expect(chargeActions(charge(), ops)).toMatchObject({ approve: false, reject: false, cancel: false, hint: 'Awaiting approval by an owner or an accountant.' });
  });

  test('an approved charge: billing.invoice cancels it until an issued invoice bills it; rejected and cancelled are final', () => {
    expect(chargeActions(charge({ status: 'approved' }), owner)).toMatchObject({ approve: false, reject: false, cancel: true, hint: null });
    expect(chargeActions(charge({ status: 'approved', billing: { invoiceId: 'i', invoiceNo: null, status: 'draft' } }), owner).cancel).toBe(true);
    const billed = chargeActions(charge({ status: 'approved', billing: { invoiceId: 'i', invoiceNo: '29/S2627/000004', status: 'issued' } }), owner);
    expect(billed.cancel).toBe(false);
    expect(billed.hint).toBe('Billed on issued invoice 29/S2627/000004 — it can no longer change; correct it with a credit note.');
    expect(chargeActions(charge({ status: 'approved', recordedBy: ME }), ops)).toMatchObject({ cancel: false, hint: 'Approved — only an owner or an accountant can cancel it.' });
    for (const status of ['rejected', 'cancelled'] as const) {
      expect(chargeActions(charge({ status }), owner)).toEqual({ approve: false, approveBlocked: null, reject: false, cancel: false, hint: null });
    }
  });

  test('the self-approval forecast', () => {
    expect(approvalForecast(false, 1_000_000, 87_500)).toBe('It will wait for approval by an owner or an accountant.');
    expect(approvalForecast(true, 1_000_000, 87_500)).toBe('Within your self-approval limit of ₹10,000.00 — it is approved as you record it.');
    expect(approvalForecast(true, 1_000_000, 2_500_000)).toBe('Above your self-approval limit of ₹10,000.00 — another member with billing rights must approve it.');
    expect(approvalForecast(true, null, null)).toMatch(/self-approval limit/);
  });
});

describe('billing and outcomes', () => {
  test('the billing cell: the invoice that bills it, else where it will', () => {
    expect(chargeBillingLabel(charge({ status: 'approved' }))).toBe('Bills on the Oct 2026 invoice');
    expect(chargeBillingLabel(charge())).toBe('Oct 2026 invoice, once approved');
    expect(chargeBillingLabel(charge({ status: 'rejected' }))).toBe('Never billed');
    expect(chargeBillingLabel(charge({ status: 'approved', billing: { invoiceId: 'i', invoiceNo: null, status: 'draft' } }))).toBe('Draft invoice · Oct 2026');
    expect(chargeBillingLabel(charge({ status: 'approved', billing: { invoiceId: 'i', invoiceNo: '29/S2627/000004', status: 'settled' } }))).toBe('29/S2627/000004 · settled');
  });

  test('A4 — a late charge bills on a later month and says so', () => {
    expect(billedLater(charge())).toBe(false);
    expect(billedLater(charge({ chargeDate: '2026-09-28', billMonth: '2026-10-01' }))).toBe(true);
    expect(billMonthLabel('2026-10-01')).toBe('Oct 2026');
    expect(billMonthLabel('2026-09')).toBe('Sep 2026');
  });

  test('the outcome after a 201, from the response', () => {
    expect(recordOutcome({ charge: charge({ status: 'approved', decidedBy: ME }), warnings: [] })).toEqual({
      word: 'Charge recorded and approved',
      reason: '₹875.00 bills on the Oct 2026 invoice under 29AAACT1234A1Z5.',
    });
    expect(recordOutcome({ charge: charge(), warnings: [] }).word).toBe('Charge recorded — awaiting approval');
    expect(decisionOutcome('approve', charge()).reason).toBe('₹875.00 bills on the Oct 2026 invoice — refresh that month’s draft to add the line.');
    expect(decisionOutcome('reject', charge()).word).toBe('Charge rejected');
  });
});

describe('the list filters in the URL (A28)', () => {
  test('the invoice gap’s link: that client’s pending charges in the invoice’s month', () => {
    expect(pendingChargesHref(CLIENT, '2026-10-01')).toBe(`/compliance?tab=client-charges&clientId=${CLIENT}&month=2026-10&status=pending`);
    expect(chargesHref({ clientId: null, warehouseId: null, status: null, month: null })).toBe('/compliance?tab=client-charges');
  });

  test('parse ↔ href round-trip; anything malformed or repeated is dropped', () => {
    const filters = { clientId: CLIENT, warehouseId: WAREHOUSE, status: 'approved' as const, month: '2026-09' };
    const params = Object.fromEntries(new URL(`http://x${chargesHref(filters)}`).searchParams);
    expect(parseChargeFilters(params)).toEqual(filters);
    expect(parseChargeFilters({ clientId: 'not an id!', status: 'paid', month: '2026-13', warehouseId: ['a', 'b'] })).toEqual({
      clientId: null,
      warehouseId: null,
      status: null,
      month: null,
    });
    // Code review E5 — a hex-looking id that is not a UUID is dropped too (never sent → never a 400).
    expect(parseChargeFilters({ clientId: 'abc', warehouseId: 'deadbeef' })).toMatchObject({ clientId: null, warehouseId: null });
  });

  test('the empty sentence names the filters, or invites the first charge', () => {
    expect(chargesEmptyMessage({ clientId: null, warehouseId: null, status: null, month: null }, {})).toBe('No ad-hoc charges yet — record the first one above.');
    expect(chargesEmptyMessage({ clientId: CLIENT, warehouseId: null, status: 'pending', month: '2026-10' }, { client: 'ACME' })).toBe(
      'No ad-hoc charges match status awaiting approval, client ACME, billed in Oct 2026.',
    );
  });
});

describe('the self-approval policy (A22)', () => {
  test('₹0 .. ₹1 crore; ₹0 means a second person for every charge', () => {
    expect(parseSelfApproveLimit('10000')).toEqual({ paise: 1_000_000, problem: null });
    expect(parseSelfApproveLimit('0')).toEqual({ paise: 0, problem: null });
    expect(parseSelfApproveLimit('10000000.01').problem).toBe('At most ₹1,00,00,000.00.');
    expect(parseSelfApproveLimit('').problem).toMatch(/Enter a limit/);
    expect(selfApproveLimitLabel({ selfApproveLimitPaise: 0, isDefault: false })).toBe('Every charge needs a second person to approve it.');
    expect(selfApproveLimitLabel({ selfApproveLimitPaise: 1_000_000, isDefault: true })).toContain('up to ₹10,000.00 is approved as they record it (the default)');
  });
});

describe('refusals', () => {
  const problem = (code: string, status: number, detail?: string) => new ApiProblem(code, status, detail, 'Title');

  test('every charge code maps; server-detailed ones keep the server’s words; transport is the house copy', () => {
    expect(chargeRefusalReason(problem('charge-needs-second-approver', 409), 'approve')).toBe('You recorded this charge — another member with billing rights must approve it.');
    expect(chargeRefusalReason(problem('charge-not-pending', 409), 'reject')).toMatch(/no longer awaiting approval/);
    expect(chargeRefusalReason(problem('charge-not-cancellable', 409), 'cancel')).toMatch(/Only a pending or approved charge/);
    const invoiced = "This charge's billing month (Oct 2026) is already invoiced under 29AAACT1234A1Z5 — it can no longer change.";
    expect(chargeRefusalReason(problem('charge-period-invoiced', 409, invoiced), 'cancel')).toBe(invoiced);
    expect(chargeRefusalReason(problem('charge-not-found', 404), 'approve')).toBe('That charge no longer exists — refresh the list.');
    expect(chargeRefusalReason(problem('client-not-billable', 409), 'record')).toBe('Your own company is never billed — pick a client brand.');
    expect(chargeRefusalReason(problem('client-not-active', 409, 'Client SLEEPY is suspended'), 'record')).toBe('Client SLEEPY is suspended');
    expect(chargeRefusalReason(problem('permission-denied', 403, 'This charge is approved — only a member with billing.invoice can cancel it.'), 'cancel')).toBe(
      'This charge is approved — only a member with billing.invoice can cancel it.',
    );
    expect(chargeRefusalReason(problem('role-denied', 403), 'record')).toBe('Only an owner, an ops manager or an accountant can record ad-hoc charges.');
    expect(chargeRefusalReason(problem('role-denied', 403), 'approve')).toBe('Only an owner or an accountant can approve, reject or cancel an approved charge.');
    expect(chargeRefusalReason(problem('validation-failed', 400, 'quantity must be more than 0'), 'record')).toBe('quantity must be more than 0');
    expect(chargeRefusalReason(problem('something-new', 409), 'record')).toBe('Charge not recorded (something-new).');
    expect(chargeRefusalReason(new TypeError('Failed to fetch'), 'record')).toBe(UNREACHABLE_REASON);
    expect(chargeNeedsReread(problem('charge-not-pending', 409))).toBe(true);
    expect(chargeNeedsReread(problem('validation-failed', 400))).toBe(false);
    expect(chargePolicyReason(problem('role-denied', 403))).toBe('Only an owner or an accountant can change the self-approval limit.');
    expect(chargeReadReason(problem('role-denied', 403))).toBe('Ad-hoc charges are an operator surface — this session cannot read them.');
  });
});
