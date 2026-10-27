import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import type { RateCardDto } from './api/generated';
import { UNREACHABLE_REASON } from './outbound-orders';
import {
  CHARGE_BASIS,
  CHARGE_CODES,
  EMPTY_RATE_DRAFT,
  MAX_MINIMUM_AMOUNT_PAISE,
  MAX_RATE_AMOUNT_PAISE,
  NO_MINIMUM,
  NOT_BILLED,
  NOT_BILLED_BANNER,
  activatedOutcome,
  activationMinDate,
  basisLabel,
  canCancelRateCard,
  chargeLabel,
  cancelConsequence,
  cancelledOutcome,
  chargeCell,
  draftFieldsOf,
  formatIstDate,
  istDateOf,
  minimumCell,
  minimumGstins,
  nextChangeSummary,
  paiseToRupeeText,
  parseRateDraft,
  pricedClients,
  rateCardReason,
  rateCardState,
  showNotBilledBanner,
} from './rate-cards';

function card(overrides: Partial<RateCardDto>): RateCardDto {
  return {
    id: 'card',
    tenantId: 't',
    clientId: 'c',
    status: 'active',
    effectiveFrom: '2026-10-10',
    effectiveTo: null,
    lines: [],
    createdBy: 'u',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    activatedBy: 'u',
    activatedAt: '2026-10-01T00:00:00.000Z',
    cancelledBy: null,
    cancelledAt: null,
    ...overrides,
  };
}

const storage = (amountPaise: number) => ({ chargeCode: 'storage' as const, basis: 'per_thousand_units_per_day' as const, amountPaise });
const pick = (amountPaise: number) => ({ chargeCode: 'pick' as const, basis: 'per_pick' as const, amountPaise });
const outbound = (amountPaise: number) => ({ chargeCode: 'outbound_handling' as const, basis: 'per_order' as const, amountPaise });

/** 2026-10-20 10:00 IST. */
const AS_OF = '2026-10-20T04:30:00.000Z';

describe('the mirrored vocabulary', () => {
  test('the four charges in the backend order, each on its one basis; storage reads per 1,000 units per day', () => {
    expect(CHARGE_CODES).toEqual(['storage', 'inbound_handling', 'pick', 'outbound_handling']);
    expect(CHARGE_BASIS).toEqual({
      storage: 'per_thousand_units_per_day',
      inbound_handling: 'per_receipt_line',
      pick: 'per_pick',
      outbound_handling: 'per_order',
    });
    expect(basisLabel('per_thousand_units_per_day')).toBe('per 1,000 units per day');
    expect(basisLabel('per_order')).toBe('per order');
  });

  test('a charge with no line reads "Not billed"; ₹0 reads ₹0.00 (billed at zero)', () => {
    const priced = card({ lines: [storage(330), pick(0)] });
    expect(chargeCell(priced, 'storage')).toBe('₹3.30');
    expect(chargeCell(priced, 'pick')).toBe('₹0.00');
    expect(chargeCell(priced, 'outbound_handling')).toBe(NOT_BILLED);
  });

  test('the tenant’s own client is never priced', () => {
    const self = { id: 's', systemOwned: true } as never;
    const acme = { id: 'a', systemOwned: false } as never;
    expect(pricedClients([self, acme])).toEqual([acme]);
  });
});

describe('dates', () => {
  test('the IST date of an instant flips at 18:30Z', () => {
    expect(istDateOf('2026-10-31T18:29:59.999Z')).toBe('2026-10-31');
    expect(istDateOf('2026-10-31T18:30:00.000Z')).toBe('2026-11-01');
  });

  test('formatIstDate reads the date as written (no zone shift)', () => {
    expect(formatIstDate('2026-11-01')).toBe('1 Nov 2026');
    expect(formatIstDate('2027-01-15')).toBe('15 Jan 2027');
  });

  test('the activation minimum, from the SERVER asOf: today (IST) for a first card, tomorrow (IST) once any card is dated', () => {
    // 23:50 IST on 20 Oct is 18:20Z — the IST date is still the 20th.
    const lateEvening = '2026-10-20T18:20:00.000Z';
    expect(activationMinDate(lateEvening, [])).toBe('2026-10-20');
    expect(activationMinDate(lateEvening, [card({ status: 'draft' }), card({ status: 'cancelled' })])).toBe('2026-10-20');
    expect(activationMinDate(lateEvening, [card({ status: 'active' })])).toBe('2026-10-21');
    expect(activationMinDate(lateEvening, [card({ status: 'superseded' })])).toBe('2026-10-21');
    // 00:10 IST on the 21st is 18:40Z on the 20th — the IST date is the 21st.
    expect(activationMinDate('2026-10-20T18:40:00.000Z', [])).toBe('2026-10-21');
  });
});

describe('the state a card shows', () => {
  test('Draft / Cancelled from status; In force from the endpoint; Scheduled / Ended from the dates against asOf', () => {
    const a = card({ id: 'a', status: 'superseded', effectiveFrom: '2026-10-10', effectiveTo: '2026-11-01' });
    const b = card({ id: 'b', status: 'active', effectiveFrom: '2026-11-01' });
    expect(rateCardState(card({ status: 'draft', effectiveFrom: null }), 'a', AS_OF)).toBe('Draft');
    expect(rateCardState(card({ status: 'cancelled', effectiveFrom: '2026-12-01' }), 'a', AS_OF)).toBe('Cancelled');
    expect(rateCardState(a, 'a', AS_OF)).toBe('In force');
    expect(rateCardState(b, 'a', AS_OF)).toBe('Scheduled');
    // Once the server says B is in force, A has ended.
    const later = '2026-11-02T00:00:00.000Z';
    expect(rateCardState(b, 'b', later)).toBe('In force');
    expect(rateCardState(a, 'b', later)).toBe('Ended');
    // A card dated asOf's own IST day has begun — it is not "scheduled".
    expect(rateCardState(card({ id: 'c', effectiveFrom: '2026-10-20' }), null, AS_OF)).toBe('Ended');
  });

  test('cancel is offered only on an active card whose date is ahead of asOf', () => {
    expect(canCancelRateCard(card({ status: 'active', effectiveFrom: '2026-11-01' }), AS_OF)).toBe(true);
    expect(canCancelRateCard(card({ status: 'active', effectiveFrom: '2026-10-20' }), AS_OF)).toBe(false);
    // A scheduled card already superseded by a later one is still scheduled — cancellable.
    expect(canCancelRateCard(card({ status: 'superseded', effectiveFrom: '2026-11-01', effectiveTo: '2026-12-01' }), AS_OF)).toBe(true);
    expect(canCancelRateCard(card({ status: 'superseded', effectiveFrom: '2026-10-10', effectiveTo: '2026-11-01' }), AS_OF)).toBe(false);
    expect(canCancelRateCard(card({ status: 'cancelled', effectiveFrom: '2026-11-01' }), AS_OF)).toBe(false);
    expect(canCancelRateCard(card({ status: 'draft', effectiveFrom: null }), AS_OF)).toBe(false);
  });

  test('the next scheduled change, charge by charge — "₹3.30 → ₹4.00 from 1 Nov 2026"', () => {
    const a = card({ id: 'a', lines: [storage(330), pick(300)] });
    const b = card({ id: 'b', effectiveFrom: '2026-11-01', lines: [storage(400), pick(300), outbound(1500)] });
    const c = card({ id: 'c', effectiveFrom: '2026-12-01', lines: [storage(500)] });
    const next = nextChangeSummary([c, b, a], a, AS_OF);
    expect(next).toEqual({
      date: '2026-11-01',
      changes: ['Storage ₹3.30 → ₹4.00 from 1 Nov 2026', 'Outbound handling Not billed → ₹15.00 from 1 Nov 2026'],
    });
    // Nothing scheduled.
    expect(nextChangeSummary([a], a, AS_OF)).toBeNull();
    // A cancelled card is not a change.
    expect(nextChangeSummary([a, { ...b, status: 'cancelled' }], a, AS_OF)).toBeNull();
    // Same prices.
    expect(nextChangeSummary([a, { ...a, id: 'd', effectiveFrom: '2026-11-01' }], a, AS_OF)?.changes).toEqual([
      'A new card with the same prices takes over from 1 Nov 2026',
    ]);
    // The next card may itself be superseded by a later one — it still comes first.
    expect(nextChangeSummary([c, { ...b, status: 'superseded', effectiveTo: '2026-12-01' }, a], a, AS_OF)?.date).toBe('2026-11-01');
    // Nothing in force yet: every priced charge starts from "Not billed".
    expect(nextChangeSummary([b], null, AS_OF)?.changes[0]).toBe('Storage Not billed → ₹4.00 from 1 Nov 2026');
  });

  test('the cancel consequence is worded by case: no predecessor, a scheduled predecessor, a predecessor in force', () => {
    const a = card({ id: 'a', status: 'superseded', effectiveFrom: '2026-10-10', effectiveTo: '2026-11-01' });
    const b = card({ id: 'b', status: 'superseded', effectiveFrom: '2026-11-01', effectiveTo: '2026-12-01' });
    const c = card({ id: 'c', status: 'active', effectiveFrom: '2026-12-01' });
    // B's predecessor A is in force.
    expect(cancelConsequence(b, [a, b, c], 'a', AS_OF)).toBe('The card it replaces stays in force.');
    // C's predecessor B is itself still scheduled.
    expect(cancelConsequence(c, [a, b, c], 'a', AS_OF)).toBe('The previous card applies from its own date.');
    // A client's first scheduled card has no predecessor.
    const first = card({ id: 'f', status: 'active', effectiveFrom: '2026-11-01' });
    expect(cancelConsequence(first, [first], null, AS_OF)).toBe(
      'Nothing is in force — this client will not be billed until another card takes effect.',
    );
  });

  test('the not-billed banner: an active, non-self client with nothing in force', () => {
    expect(NOT_BILLED_BANNER).toBe('This client will not be billed — no rate card is in force.');
    expect(showNotBilledBanner({ status: 'active', systemOwned: false }, null)).toBe(true);
    expect(showNotBilledBanner({ status: 'active', systemOwned: false }, card({}))).toBe(false);
    expect(showNotBilledBanner({ status: 'suspended', systemOwned: false }, null)).toBe(false);
    expect(showNotBilledBanner({ status: 'active', systemOwned: true }, null)).toBe(false);
  });
});

describe('the draft editor', () => {
  test('blank = no line; ₹0 = a zero line; the basis comes from the pair map; lines in charge order', () => {
    const parsed = parseRateDraft({ ...EMPTY_RATE_DRAFT, pick: '3', storage: ' 3.30 ', outbound_handling: '0' });
    expect(parsed).toEqual({ lines: [storage(330), pick(300), outbound(0)], problem: null });
    expect(parseRateDraft(EMPTY_RATE_DRAFT)).toEqual({ lines: [], problem: null });
  });

  test('a malformed amount or one over the ₹1 lakh cap names the charge and sends nothing', () => {
    expect(parseRateDraft({ ...EMPTY_RATE_DRAFT, pick: '3.333' }).problem).toMatch(/^Pick: /);
    expect(parseRateDraft({ ...EMPTY_RATE_DRAFT, pick: '1e3' }).problem).toMatch(/^Pick: /);
    expect(parseRateDraft({ ...EMPTY_RATE_DRAFT, storage: '-1' }).problem).toMatch(/^Storage: /);
    expect(parseRateDraft({ ...EMPTY_RATE_DRAFT, storage: '100000' }).lines).toEqual([storage(MAX_RATE_AMOUNT_PAISE)]);
    const over = parseRateDraft({ ...EMPTY_RATE_DRAFT, storage: '100000.01' });
    expect(over.lines).toBeNull();
    expect(over.problem).toBe('Storage: at most ₹1,00,000.00 per 1,000 units per day.');
  });

  test('a draft’s lines round-trip through the editor fields', () => {
    expect(paiseToRupeeText(330)).toBe('3.30');
    expect(paiseToRupeeText(5)).toBe('0.05');
    expect(paiseToRupeeText(10_000_000)).toBe('100000.00');
    const fields = draftFieldsOf(card({ lines: [storage(330), outbound(0)] }));
    // Story 5-5a — the fields gained the minimum (blank: no minimum) and its counts rule (default `all`).
    expect(fields).toEqual({ storage: '3.30', inbound_handling: '', pick: '', outbound_handling: '0.00', minimum_monthly: '', minimumCounts: 'all' });
    expect(parseRateDraft(fields).lines).toEqual([storage(330), outbound(0)]);
  });
});

describe('outcomes and refusals', () => {
  test('the outcomes name the date', () => {
    expect(activatedOutcome({ effectiveFrom: '2026-11-01' }).reason).toContain('1 Nov 2026');
    expect(cancelledOutcome({ effectiveFrom: '2026-11-01' }, 'The card it replaces stays in force.').reason).toBe(
      'It will not take effect on 1 Nov 2026. The card it replaces stays in force.',
    );
  });

  test('every rate-card code maps; server-detailed refusals render the server’s words; transport is the house copy', () => {
    const problem = (code: string, status: number, detail?: string) => new ApiProblem(code, status, detail, 'Title');
    expect(rateCardReason(problem('rate-card-effective-date', 400, 'tomorrow — 2026-10-21 or later'), 'activated')).toBe(
      'tomorrow — 2026-10-21 or later',
    );
    expect(rateCardReason(problem('rate-card-effective-overlap', 409, 'after 2026-11-01'), 'activated')).toBe('after 2026-11-01');
    expect(rateCardReason(problem('rate-card-no-lines', 409), 'activated')).toBe('Price at least one charge before activating the card.');
    expect(rateCardReason(problem('rate-card-not-draft', 409), 'saved')).toMatch(/no longer a draft/);
    expect(rateCardReason(problem('rate-card-not-cancellable', 409, 'in force since 2026-11-01'), 'cancelled')).toBe(
      'in force since 2026-11-01',
    );
    expect(rateCardReason(problem('client-not-active', 409, 'SLEEPY is suspended'), 'drafted')).toBe('SLEEPY is suspended');
    expect(rateCardReason(problem('role-denied', 403), 'drafted')).toBe('Only an owner or an accountant can manage rate cards.');
    expect(rateCardReason(problem('not-found', 404), 'discarded')).toMatch(/no longer exists/);
    expect(rateCardReason(problem('something-new', 409), 'activated')).toBe('Card not activated (something-new).');
    expect(rateCardReason(problem('idempotency-key-reuse', 422), 'saved')).toBe(
      'That request key was already used for a different change — reload and try again.',
    );
    expect(rateCardReason(problem('conflict', 409), 'activated')).toBe("The client's cards changed meanwhile — reload and try again.");
    expect(rateCardReason(new TypeError('Failed to fetch'), 'drafted')).toBe(UNREACHABLE_REASON);
  });
});

describe('story 5-5a — the minimum monthly charge on a card', () => {
  const minimum = (amountPaise: number, minimumCounts: 'all' | 'metered' = 'all') => ({
    chargeCode: 'minimum_monthly' as const,
    basis: 'per_month' as const,
    amountPaise,
    minimumCounts,
  });

  test('every code and basis has words; the metered list stays the four', () => {
    expect(CHARGE_CODES).not.toContain('minimum_monthly');
    expect(chargeLabel('minimum_monthly')).toBe('Minimum monthly charge');
    expect(chargeLabel('adhoc')).toBe('Ad-hoc charge');
    expect(chargeLabel('minimum_adjustment')).toBe('Minimum charge adjustment');
    expect(basisLabel('per_month')).toBe('per month');
    expect(basisLabel('per_unit')).toBe('per unit');
    expect(basisLabel('per_invoice')).toBe('per invoice');
  });

  test('A12 — the minimum has its own bound: ₹2 lakh is accepted (a metered rate is refused), ₹1 crore is the cap, ₹0 is refused', () => {
    expect(parseRateDraft({ ...EMPTY_RATE_DRAFT, minimum_monthly: '200000' }).lines).toEqual([minimum(20_000_000)]);
    expect(parseRateDraft({ ...EMPTY_RATE_DRAFT, storage: '200000' }).problem).toBe('Storage: at most ₹1,00,000.00 per 1,000 units per day.');
    expect(parseRateDraft({ ...EMPTY_RATE_DRAFT, minimum_monthly: '10000000' }).lines).toEqual([minimum(MAX_MINIMUM_AMOUNT_PAISE)]);
    expect(parseRateDraft({ ...EMPTY_RATE_DRAFT, minimum_monthly: '10000000.01' }).problem).toBe('Minimum monthly charge: at most ₹1,00,00,000.00 per month.');
    expect(parseRateDraft({ ...EMPTY_RATE_DRAFT, minimum_monthly: '0' }).problem).toMatch(/^Minimum monthly charge: at least ₹0.01/);
    expect(parseRateDraft({ ...EMPTY_RATE_DRAFT, minimum_monthly: 'abc' }).problem).toMatch(/^Minimum monthly charge: /);
  });

  test('the minimum line carries its counts rule, after the metered lines, and round-trips through the editor', () => {
    const parsed = parseRateDraft({ ...EMPTY_RATE_DRAFT, pick: '3', minimum_monthly: '50000', minimumCounts: 'metered' });
    expect(parsed.lines).toEqual([pick(300), minimum(5_000_000, 'metered')]);
    const fields = draftFieldsOf(card({ lines: parsed.lines! }));
    expect(fields).toEqual({ ...EMPTY_RATE_DRAFT, pick: '3.00', minimum_monthly: '50000.00', minimumCounts: 'metered' });
    // A card with no minimum line reads back the default rule; a blank minimum sends no line whatever the rule.
    expect(draftFieldsOf(card({ lines: [pick(300)] })).minimumCounts).toBe('all');
    expect(parseRateDraft({ ...EMPTY_RATE_DRAFT, minimumCounts: 'metered' }).lines).toEqual([]);
  });

  test('the minimum column and the next-change summary name the minimum', () => {
    expect(minimumCell(card({ lines: [pick(300)] }))).toBe(NO_MINIMUM);
    expect(minimumCell(card({ lines: [minimum(5_000_000)] }))).toBe('₹50,000.00');
    expect(minimumCell(card({ lines: [minimum(5_000_000, 'metered')] }))).toBe('₹50,000.00 · metered only');
    expect(chargeCell(card({ lines: [] }), 'minimum_monthly')).toBe(NO_MINIMUM);
    const inForce = card({ id: 'a', effectiveFrom: '2026-10-01', lines: [pick(300)] });
    const next = card({ id: 'b', effectiveFrom: '2026-11-01', lines: [pick(300), minimum(5_000_000)] });
    expect(nextChangeSummary([inForce, next], inForce, AS_OF)?.changes).toEqual(['Minimum monthly charge No minimum → ₹50,000.00 from 1 Nov 2026']);
  });

  test('A21 — the multi-GSTIN refusal names the GSTINs from its extension', () => {
    const refusal = new ApiProblem('minimum-needs-single-gstin', 409, 'detail', 'Title', { gstins: ['29ABCDE1234F1Z5', null] });
    expect(minimumGstins(refusal)).toEqual(['29ABCDE1234F1Z5', 'no GSTIN']);
    expect(rateCardReason(refusal, 'activated')).toBe(
      'A minimum monthly charge applies to each monthly invoice (one per GSTIN), and this client is billed under 2 GSTINs (29ABCDE1234F1Z5, no GSTIN) — it would be charged once per GSTIN. Remove the minimum from the draft, or bill the client from one GSTIN.',
    );
    expect(minimumGstins(new ApiProblem('conflict', 409, undefined, 'Title'))).toEqual([]);
  });
});
