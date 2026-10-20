import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import { CLIENT_DEPARTED_REASON } from '@/lib/client-departed';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import {
  EMPTY_PO_LINE,
  MAX_PO_LINES,
  isVendorRefusal,
  parsePoCreate,
  poCreatedOutcome,
  poExpectedDate,
  poReason,
  sortedByCode,
  type PoCreateDraft,
} from '@/lib/purchase-orders';

/**
 * Story 2-1 — the PO create form's pure half: every parser refusal (one
 * form-level problem naming the line), the rupees → paise conversion, the
 * expected date's wire form, and each refusal mapper arm.
 */

const OPTIONS = [
  { id: 's-1', code: 'GLOW-1' },
  { id: 's-2', code: 'GLOW-2' },
];

function draft(over: Partial<PoCreateDraft> = {}): PoCreateDraft {
  return {
    clientId: 'c-glow',
    vendorId: 'v-krishna',
    code: ' PO-1001 ',
    expectedDate: '',
    lines: [
      { skuId: 's-1', qty: '10', unitCost: '12.5' },
      { skuId: 's-2', qty: '2.5', unitCost: '0.01' },
    ],
    ...over,
  };
}

const problemOf = (over: Partial<PoCreateDraft>) => parsePoCreate(draft(over), 'wh-1', OPTIONS).problem;

describe('parsePoCreate', () => {
  test('a good draft builds the CreatePurchaseOrderDto: trimmed code, rupees → paise, no clientId, no expectedDate when blank', () => {
    const parsed = parsePoCreate(draft(), 'wh-1', OPTIONS);
    expect(parsed.problem).toBeNull();
    expect(parsed.body).toEqual({
      warehouseId: 'wh-1',
      vendorId: 'v-krishna',
      code: 'PO-1001',
      lines: [
        { skuId: 's-1', orderedQty: 10, unitCostPaise: 1250 },
        { skuId: 's-2', orderedQty: 2.5, unitCostPaise: 1 },
      ],
    });
    expect('clientId' in parsed.body!).toBe(false);
  });

  test('the one expected date rides every line as the IST-midnight instant', () => {
    const parsed = parsePoCreate(draft({ expectedDate: '2026-10-25' }), 'wh-1', OPTIONS);
    expect(parsed.body!.lines.map((line) => line.expectedDate)).toEqual(['2026-10-24T18:30:00.000Z', '2026-10-24T18:30:00.000Z']);
  });

  test('fully empty rows are dropped; a line is numbered by its row on screen', () => {
    const parsed = parsePoCreate(
      draft({ lines: [EMPTY_PO_LINE, { skuId: 's-1', qty: '1', unitCost: '5' }, EMPTY_PO_LINE] }),
      'wh-1',
      OPTIONS,
    );
    expect(parsed.body!.lines).toEqual([{ skuId: 's-1', orderedQty: 1, unitCostPaise: 500 }]);
    expect(problemOf({ lines: [EMPTY_PO_LINE, { skuId: 's-1', qty: '0', unitCost: '5' }] })).toBe(
      'Line 2: enter a quantity greater than zero.',
    );
  });

  test('the header refusals: no client, no vendor, an empty or over-long code, an unreal date', () => {
    expect(problemOf({ clientId: '' })).toBe('Pick the client first.');
    expect(problemOf({ vendorId: '' })).toBe('Choose the vendor this purchase order is for.');
    expect(problemOf({ code: '   ' })).toBe('Enter the PO code.');
    expect(problemOf({ code: 'P'.repeat(65) })).toBe('The PO code is at most 64 characters.');
    expect(problemOf({ code: 'P'.repeat(64) })).toBeNull();
    expect(problemOf({ expectedDate: '2026-02-30' })).toBe('The expected date is not a real date.');
  });

  test('the line-count refusals: none, and more than 200', () => {
    expect(problemOf({ lines: [EMPTY_PO_LINE] })).toBe('Add at least one line — a SKU, a quantity and a unit cost.');
    const many = Array.from({ length: MAX_PO_LINES + 1 }, () => ({ skuId: 's-1', qty: '1', unitCost: '1' }));
    expect(problemOf({ lines: many })).toBe('A purchase order carries at most 200 lines.');
  });

  test('a line without a SKU, a SKU no longer offered, and a repeated SKU are refused naming the line', () => {
    expect(problemOf({ lines: [{ skuId: '', qty: '1', unitCost: '1' }] })).toBe('Line 1 needs a SKU.');
    expect(problemOf({ lines: [{ skuId: 's-kit', qty: '1', unitCost: '1' }] })).toBe(
      'Line 1: that SKU is no longer offered for this client — pick another.',
    );
    expect(
      problemOf({
        lines: [
          { skuId: 's-1', qty: '1', unitCost: '1' },
          { skuId: 's-2', qty: '1', unitCost: '1' },
          { skuId: 's-1', qty: '3', unitCost: '1' },
        ],
      }),
    ).toBe('Line 3 repeats GLOW-1 from line 1 — put the whole quantity on one line.');
  });

  test('a quantity that does not parse, or is ≤ 0, is refused; precision is left to the server', () => {
    for (const qty of ['', 'abc', '1e3', '0x10', '-1', '0', '0.000']) {
      expect(problemOf({ lines: [{ skuId: 's-1', qty, unitCost: '1' }] })).toBe('Line 1: enter a quantity greater than zero.');
    }
    // `1.5` on an `each` SKU is sent as is — the server answers validation-failed naming the unit.
    expect(parsePoCreate(draft({ lines: [{ skuId: 's-1', qty: '1.5', unitCost: '1' }] }), 'wh-1', OPTIONS).body!.lines[0]!.orderedQty).toBe(1.5);
  });

  test('rupees → paise: "12.5" → 1250, "0.01" → 1; "0", blank and "12.345" are refused', () => {
    const paiseOf = (unitCost: string) =>
      parsePoCreate(draft({ lines: [{ skuId: 's-1', qty: '1', unitCost }] }), 'wh-1', OPTIONS).body?.lines[0]?.unitCostPaise;
    expect(paiseOf('12.5')).toBe(1250);
    expect(paiseOf('0.01')).toBe(1);
    expect(paiseOf(' 125 ')).toBe(12500);
    expect(problemOf({ lines: [{ skuId: 's-1', qty: '1', unitCost: '0' }] })).toBe('Line 1: Enter a unit cost of at least ₹0.01.');
    expect(problemOf({ lines: [{ skuId: 's-1', qty: '1', unitCost: '0.00' }] })).toBe('Line 1: Enter a unit cost of at least ₹0.01.');
    expect(problemOf({ lines: [{ skuId: 's-1', qty: '1', unitCost: '' }] })).toBe('Line 1: Enter a unit cost of at least ₹0.01.');
    // int4 `unit_cost_paise`: ₹21,474,836.47 is the ceiling.
    expect(paiseOf('21474836.47')).toBe(2_147_483_647);
    expect(problemOf({ lines: [{ skuId: 's-1', qty: '1', unitCost: '21474836.48' }] })).toBe('Line 1: that unit cost is too large.');
    expect(problemOf({ lines: [{ skuId: 's-1', qty: '1', unitCost: '12.345' }] })).toBe(
      'Line 1: Enter a rupee amount like 125 or 125.50 (at most two decimal places).',
    );
  });
});

describe('poExpectedDate', () => {
  test('2026-10-25 → 2026-10-24T18:30:00.000Z (Z-suffixed — the API refuses +05:30); blank → none; a past date is allowed', () => {
    expect(poExpectedDate('2026-10-25')).toEqual({ expectedDate: '2026-10-24T18:30:00.000Z', problem: null });
    expect(poExpectedDate('')).toEqual({ expectedDate: null, problem: null });
    expect(poExpectedDate('2020-01-01')).toEqual({ expectedDate: '2019-12-31T18:30:00.000Z', problem: null });
    expect(poExpectedDate('25-10-2026').problem).toBe('The expected date is not a real date.');
  });
});

describe('poReason', () => {
  const problem = (code: string, detail?: string, extensions?: Record<string, unknown>) =>
    new ApiProblem(code, 409, detail, undefined, extensions);

  test('conflict shows the server detail as sent — it names the code for a duplicate and says "retry" for a race', () => {
    expect(poReason(problem('conflict', 'Purchase order code "PO-1001" already exists in this tenant.'))).toBe(
      'Purchase order code "PO-1001" already exists in this tenant.',
    );
    expect(poReason(problem('conflict', 'A concurrent request with this key — retry.'))).toBe('A concurrent request with this key — retry.');
  });

  test('a kit names the draft\'s kit codes (from a fresh kit read), and reads without codes when none are known', () => {
    expect(poReason(problem('kit-cannot-hold-stock', 'Purchase order line names kit SKU(s) "HAMPER" — move stock…'), ['HAMPER'])).toBe(
      'HAMPER is a kit — order its component SKUs instead.',
    );
    expect(poReason(problem('kit-cannot-hold-stock'), ['HAMPER', 'GIFT-BOX'])).toBe(
      'HAMPER, GIFT-BOX are kits — order their component SKUs instead.',
    );
    expect(poReason(problem('kit-cannot-hold-stock', 'raw server words'))).toBe(
      'A SKU on this purchase order is a kit — order its component SKUs instead.',
    );
  });

  test('sku-inactive through skuInactiveSentence; client-departed through CLIENT_DEPARTED_REASON', () => {
    expect(poReason(problem('sku-inactive', 'x', { skuCodes: ['GLOW-9'] }))).toBe(
      'SKU GLOW-9 is inactive — an inactive SKU cannot go on a new purchase order. Reactivate it in Settings → SKUs first.',
    );
    expect(poReason(problem('client-departed', 'x'))).toBe(CLIENT_DEPARTED_REASON);
  });

  test('mixed-client, the vendor arms, not-found and validation-failed show the server detail', () => {
    for (const code of ['mixed-client', 'vendor-not-linked', 'vendor-inactive', 'partner-not-vendor', 'not-found', 'validation-failed']) {
      expect(poReason(problem(code, `detail of ${code}`))).toBe(`detail of ${code}`);
    }
    expect(poReason(problem('validation-failed'))).toBe('Check the purchase order and try again.');
  });

  test('the house session arms, an unknown code, and the transport arm', () => {
    expect(poReason(problem('role-denied', 'x'))).toBe('Your role cannot raise purchase orders.');
    expect(poReason(problem('permission-denied', 'x'))).toBe('Your session belongs to another tenant — sign in again.');
    expect(poReason(problem('idempotency-key-reuse', 'x'))).toBe(
      'This submission was already processed with different details — refresh and try again.',
    );
    expect(poReason(problem('unauthenticated', 'x'))).toBe('Your session expired — sign in again.');
    expect(poReason(problem('something-new'))).toBe('The purchase order was not raised (something-new).');
    expect(poReason(new TypeError('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });

  test('isVendorRefusal: exactly vendor-not-linked, vendor-inactive and partner-not-vendor', () => {
    expect(isVendorRefusal(problem('vendor-not-linked'))).toBe(true);
    expect(isVendorRefusal(problem('vendor-inactive'))).toBe(true);
    expect(isVendorRefusal(problem('partner-not-vendor'))).toBe(true);
    expect(isVendorRefusal(problem('vendor-something-else'))).toBe(false);
    expect(isVendorRefusal(problem('conflict'))).toBe(false);
    expect(isVendorRefusal(new Error('x'))).toBe(false);
  });
});

describe('poCreatedOutcome and sortedByCode', () => {
  test('the banner is built from the response', () => {
    expect(poCreatedOutcome({ code: 'PO-1001', lines: [{}, {}] as never, vendorSnapshot: { name: 'Krishna Traders' } as never })).toEqual({
      tone: 'accepted',
      word: 'PO PO-1001 raised',
      reason: '2 lines ordered from Krishna Traders.',
    });
    expect(poCreatedOutcome({ code: 'PO-1', lines: [{}] as never, vendorSnapshot: null }).reason).toBe('1 line ordered.');
  });

  test('vendors sort by code', () => {
    expect(sortedByCode([{ code: 'V-B' }, { code: 'V-A' }, { code: 'V-C' }]).map((v) => v.code)).toEqual(['V-A', 'V-B', 'V-C']);
  });
});
