import { describe, expect, test } from 'bun:test';

import type { OrderShelfLifeDto, PartnerDto } from './api/generated';
import { allocationReason, consigneeRuleText } from './allocation-policy';
import {
  ORDER_SHELF_LIFE_NOTE,
  orderShelfLifeApplies,
  orderShelfLifeLineText,
  orderShelfLifeLineWarning,
  orderShelfLifeResolutionText,
  orderShelfLifeRuleText,
  SHELF_LIFE_RECOVERY,
  type OrderShelfLifeLine,
} from './order-shelf-life';
import {
  gstinChangeShelfLifeWarning,
  linkShelfLifeCopy,
  linkShelfLifeGstinWarning,
  linkShelfLifeSummary,
  parseLinkShelfLife,
} from './partners';

/** Story 4-3b — every sentence and parse of the customer shelf-life surfaces. */

describe('parseLinkShelfLife', () => {
  test('blank is null (sent explicitly); whole numbers in range', () => {
    expect(parseLinkShelfLife('', '')).toEqual({ body: { minShelfLifeDays: null, minShelfLifePercent: null }, problem: null });
    expect(parseLinkShelfLife(' 120 ', '')).toEqual({ body: { minShelfLifeDays: 120, minShelfLifePercent: null }, problem: null });
    expect(parseLinkShelfLife('1', '100')).toEqual({ body: { minShelfLifeDays: 1, minShelfLifePercent: 100 }, problem: null });
    expect(parseLinkShelfLife('3650', '1').body).toEqual({ minShelfLifeDays: 3650, minShelfLifePercent: 1 });
  });

  test('out of range, fractional or not a number: a problem naming the field, no body', () => {
    expect(parseLinkShelfLife('0', '').problem).toBe('Days must be from 1 to 3650, or blank for none.');
    expect(parseLinkShelfLife('3651', '').problem).toBe('Days must be from 1 to 3650, or blank for none.');
    expect(parseLinkShelfLife('1.5', '').problem).toBe('Days must be a whole number from 1 to 3650, or blank for none.');
    expect(parseLinkShelfLife('', '101').problem).toBe('Percent must be from 1 to 100, or blank for none.');
    expect(parseLinkShelfLife('', '-3').body).toBeNull();
  });
});

describe('link rule text', () => {
  test('the summary names each set minimum; none (or an older server) is null', () => {
    expect(linkShelfLifeSummary({ minShelfLifeDays: 120, minShelfLifePercent: null })).toBe('Shelf life ≥ 120 days');
    expect(linkShelfLifeSummary({ minShelfLifeDays: 100, minShelfLifePercent: 70 })).toBe('Shelf life ≥ 100 days and ≥ 70 % of total life');
    expect(linkShelfLifeSummary({ minShelfLifeDays: null, minShelfLifePercent: null })).toBeNull();
    expect(linkShelfLifeSummary({})).toBeNull();
  });

  test('the editor copy states both halves, the A1 posture and the A15 judgement day', () => {
    const copy = linkShelfLifeCopy('ACME');
    expect(copy).toContain('Orders to this consignee for ACME are planned only from batches with at least this much life left; both must hold when both are set.');
    expect(copy).toContain('Applies to waves generated after saving.');
    expect(copy).toContain('undated or unattributed stock does not, and a SKU with no total shelf life cannot meet a percent rule');
    expect(copy).toContain('Judged on the day the order is picked (one day’s grace). If the buyer counts on delivery, add the transit days.');
  });

  test('no GSTIN warns, never blocks; a GSTIN change on a partner with a rule warns', () => {
    expect(linkShelfLifeGstinWarning({ gstin: null })).toBe('No order can be matched to this consignee — it has no GSTIN.');
    expect(linkShelfLifeGstinWarning({ gstin: '27AAACD1111A1Z5' })).toBeNull();
    const withRule = {
      gstin: '27AAACD1111A1Z5',
      links: [{ id: 'l', clientId: 'c', role: 'consignee', active: true, isDefault: false, clientCode: null, minShelfLifeDays: 120, minShelfLifePercent: null }],
    } as Pick<PartnerDto, 'gstin' | 'links'>;
    expect(gstinChangeShelfLifeWarning(withRule, '27aaacd1111a1z5')).toBeNull();
    expect(gstinChangeShelfLifeWarning(withRule, '27AAACD1111A1Z6')).toContain('orders carrying the old GSTIN lose this partner’s shelf-life rules');
    expect(gstinChangeShelfLifeWarning(withRule, '  ')).toBe('No order will match this partner’s shelf-life rules without a GSTIN.');
    expect(gstinChangeShelfLifeWarning({ ...withRule, gstin: null }, '27AAACD1111A1Z5')).toBe(
      'Orders carrying this GSTIN will start matching this partner’s shelf-life rules.',
    );
    expect(gstinChangeShelfLifeWarning({ ...withRule, links: [{ ...withRule.links[0]!, minShelfLifeDays: null }] }, '')).toBeNull();
    expect(gstinChangeShelfLifeWarning(null, '27AAACD1111A1Z6')).toBeNull();
  });
});

describe('the wave row (A2, A6, A13)', () => {
  test('the consignee suffix: days; percent with its base; unjudgeable; nothing without a rule', () => {
    expect(consigneeRuleText({ consigneeName: 'DMart', consigneeMinShelfLifeDays: 120, consigneeMinShelfLifePercent: null })).toBe('DMart needs ≥ 120 days');
    expect(
      consigneeRuleText({ consigneeName: 'DMart', consigneeMinShelfLifeDays: 126, consigneeMinShelfLifePercent: 70, consigneeShelfLifeBaseDays: 180 }),
    ).toBe('DMart needs ≥ 126 days (70 % of 180 d)');
    expect(consigneeRuleText({ consigneeName: 'DMart', consigneeMinShelfLifeDays: 126, consigneeMinShelfLifePercent: 70 })).toBe('DMart needs ≥ 126 days (70 %)');
    expect(consigneeRuleText({ consigneeName: 'DMart', consigneeMinShelfLifeDays: null, consigneeMinShelfLifePercent: 70 })).toBe('DMart needs ≥ 70 % of total life');
    // No name (an older stored wave without the snapshot key): "the consignee".
    expect(consigneeRuleText({ consigneeName: null, consigneeMinShelfLifeDays: 120 })).toBe('the consignee needs ≥ 120 days');
    expect(consigneeRuleText({})).toBeNull();
  });

  test('after 4-3a\'s batch/rule text, then the shortfall cause', () => {
    expect(
      allocationReason({ batchCode: 'L2', batchExpiryDate: '2027-03-31', allocationRule: 'fefo', consigneeName: 'DMart', consigneeMinShelfLifeDays: 120 }),
    ).toBe('batch L2 · exp 31 Mar 2027 · earliest expiry first · DMart needs ≥ 120 days');
    expect(
      allocationReason({ allocationRule: 'fefo', consigneeName: 'DMart', consigneeMinShelfLifeDays: 120, shortfallCause: 'consignee-shelf-life' }),
    ).toBe("earliest expiry first · DMart needs ≥ 120 days · short: below DMart's shelf-life rule");
    // Unjudgeable: the rule once, the reason once.
    expect(allocationReason({ allocationRule: 'fefo', consigneeName: 'P', consigneeMinShelfLifePercent: 70, shortfallCause: 'consignee-unjudgeable' })).toBe(
      'earliest expiry first · P needs ≥ 70 % of total life · short: SKU has no total shelf life',
    );
    expect(allocationReason({ consigneeMinShelfLifeDays: 120, shortfallCause: 'consignee-shelf-life' })).toBe(
      "the consignee needs ≥ 120 days · short: below the consignee's shelf-life rule",
    );
    // A pre-4-3b stored wave: no keys, exactly 4-3a's text.
    expect(allocationReason({ batchCode: 'L2', batchExpiryDate: '2027-03-31', allocationRule: 'fefo' })).toBe('batch L2 · exp 31 Mar 2027 · earliest expiry first');
  });
});

describe('the order section', () => {
  const line = (over: Partial<OrderShelfLifeLine> = {}): OrderShelfLifeLine => ({
    orderLineId: 'ol',
    skuId: 's',
    skuCode: 'SKU-A',
    reservedQty: 6,
    effectiveMinDays: 120,
    shelfLifeBaseDays: null,
    judgeable: true,
    qualifyingOnHand: 10,
    qualifyingUnclaimed: 10,
    belowConsigneeMinimumOnHand: 5,
    plannedQty: null,
    shortfallQty: null,
    shortfallCause: null,
    ...over,
  });
  const read = (over: Partial<OrderShelfLifeDto> = {}): OrderShelfLifeDto => ({
    orderId: 'o',
    judgedOn: '2026-10-28',
    clientMinShelfLifeDays: null,
    consigneeResolution: 'applied',
    consigneeGstin: '27AAACD1111A1Z5',
    resolvedPartner: { partnerId: 'p', code: 'DMART', name: 'DMart' },
    consignee: { partnerId: 'p', code: 'DMART', name: 'DMart', minShelfLifeDays: 120, minShelfLifePercent: 70 },
    lines: [line()],
    ...over,
  });

  test('applies when a rule applies, or the order names a GSTIN that matched no rule; never for no-gstin alone', () => {
    expect(orderShelfLifeApplies(read())).toBe(true);
    expect(orderShelfLifeApplies(read({ consignee: null, consigneeResolution: 'no-gstin', consigneeGstin: null }))).toBe(false);
    expect(orderShelfLifeApplies(read({ consignee: null, consigneeResolution: 'no-gstin', clientMinShelfLifeDays: 90 }))).toBe(true);
    expect(orderShelfLifeApplies(read({ consignee: null, consigneeResolution: 'no-rule' }))).toBe(true);
  });

  test('the resolution line names why no consignee rule applied', () => {
    expect(orderShelfLifeResolutionText(read({ consignee: null, consigneeResolution: 'no-partner', resolvedPartner: null }))).toBe(
      'No partner has GSTIN 27AAACD1111A1Z5 — no consignee shelf-life rule applies.',
    );
    expect(orderShelfLifeResolutionText(read({ consignee: null, consigneeResolution: 'no-consignee-link' }))).toBe(
      'DMart has no consignee link for this client — no consignee shelf-life rule applies.',
    );
    expect(orderShelfLifeResolutionText(read({ consignee: null, consigneeResolution: 'no-rule' }))).toBe("DMart's consignee link has no shelf-life rule.");
    expect(orderShelfLifeResolutionText(read())).toBeNull();
    expect(orderShelfLifeRuleText(read({ consignee: null, consigneeResolution: 'no-rule' }))).toBeNull();
  });

  test('the rule sentence and the line figures', () => {
    expect(orderShelfLifeRuleText(read({ clientMinShelfLifeDays: 90 }))).toBe(
      "DMart (DMART) needs ≥ 120 days and ≥ 70 % of total shelf life left; the client's minimum is 90 days. If waved today (28 Oct 2026).",
    );
    expect(orderShelfLifeRuleText(read({ consignee: null, clientMinShelfLifeDays: 90 }))).toBe("The client's minimum is 90 days. If waved today (28 Oct 2026).");
    expect(orderShelfLifeLineText(line({ shelfLifeBaseDays: 180 }))).toBe(
      "SKU-A: 10 qualifying on hand (10 not claimed by other waves) · 6 reserved · 5 below the consignee's rule · needs ≥ 120 days · total shelf life 180 d",
    );
  });

  test('warnings: covered → none; short if waved now; planned short; unjudgeable names the SKU and the fix', () => {
    expect(orderShelfLifeLineWarning(line())).toBeNull();
    expect(orderShelfLifeLineWarning(line({ qualifyingUnclaimed: 2 }))).toBe(
      `Only 2 of the 6 reserved unit(s) have qualifying stock not already claimed — a wave now would plan the rest short. ${SHELF_LIFE_RECOVERY}`,
    );
    expect(orderShelfLifeLineWarning(line({ plannedQty: 4, shortfallQty: 2, shortfallCause: 'consignee-shelf-life' }))).toContain('2 reserved unit(s) planned short');
    expect(orderShelfLifeLineWarning(line({ plannedQty: 6, shortfallQty: 0, qualifyingUnclaimed: 0 }))).toBeNull();
    const uj = orderShelfLifeLineWarning(line({ judgeable: false, effectiveMinDays: null }))!;
    expect(uj).toBe(
      "SKU-A has no total shelf life, so the consignee's percent rule cannot be met. Set SKU-A's total shelf life in the catalog (then cancel and regenerate the wave if it is already waved), or cancel the order line.",
    );
    expect(uj).not.toContain('fresher stock');
    // A planned-short line is worded by its frozen cause, not today's judgeable.
    expect(orderShelfLifeLineWarning(line({ judgeable: true, plannedQty: 0, shortfallQty: 2, shortfallCause: 'consignee-unjudgeable' }))).toBe(
      "2 reserved unit(s) planned short while SKU-A had no total shelf life. Set SKU-A's total shelf life in the catalog (then cancel and regenerate the wave if it is already waved), or cancel the order line.",
    );
    // No minimum applies: a plain stock shortfall is not a shelf-life warning.
    expect(orderShelfLifeLineWarning(line({ effectiveMinDays: null, qualifyingUnclaimed: 0 }))).toBeNull();
    expect(SHELF_LIFE_RECOVERY).toBe('Receive fresher stock and regenerate the wave (cancel this wave first), or cancel the order line. The reserved units stay held until then.');
    expect(ORDER_SHELF_LIFE_NOTE).toContain('ignores other orders’ claims');
  });
});
