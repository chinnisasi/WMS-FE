import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { ConsignmentViewDto } from '@/lib/api/generated';
import {
  COMPLIANCE_EXCEPTION_WORD,
  CONSIGNMENT_REFUSAL_WORD,
  consignmentBlockerWord,
  consignmentReason,
  consignmentRefusalReloads,
  draftFromView,
  ewayDispatchRefusal,
  parseDeclaredValue,
  emptyConsignmentRecordDraft,
  ewayLine,
  ewayValidityWarning,
  ewayVerdictLine,
  formatEwayBillNumber,
  formatRupees,
  gateBlocks,
  gateChip,
  gateLine,
  gateRefusalSentence,
  orderAgeWords,
  parseConsignmentDraft,
  portalGateLine,
  portalNeededBanner,
  requiredBecauseWords,
  sheetDocumentCell,
  sheetEwayCell,
  sheetExceptionNote,
  thresholdRuleWords,
  type ConsignmentRecordDraft,
} from './consignment';
import { dispatchReason } from './outbound-pack-dispatch';
import { candidateBlocker, consignmentBlocker, EMPTY_ROW, HANDOVER_REFUSAL_WORD } from './shipping';
import { UNREACHABLE_REASON } from './outbound-orders';

/** 30 Oct 2026, 10:00 IST. */
const NOW = Date.parse('2026-10-30T04:30:00.000Z');
/** Created 28 Oct 2026 IST → the earliest document date is 28 Sep 2026. */
const CREATED = '2026-10-28T05:00:00.000Z';
const ctx = { createdAt: CREATED, nowMs: NOW, reasonRequired: false };

function draft(patch: Partial<ConsignmentRecordDraft> = {}): ConsignmentRecordDraft {
  return {
    ...emptyConsignmentRecordDraft(NOW),
    documentNumber: 'INV/26-27/0042',
    declaredValue: '118000',
    ewayBillNumber: '1234 5678 9012',
    ewayBillDate: '2026-10-30',
    ewayValidUntil: '2026-11-01',
    ...patch,
  };
}

const problem = (code: string, status = 409, extensions: Record<string, unknown> = {}, detail?: string) =>
  new ApiProblem(code, status, detail, 'Refused', extensions);

const view = (patch: Partial<ConsignmentViewDto> = {}): ConsignmentViewDto => ({
  id: 'r-1',
  orderId: 'o-1',
  seq: 1,
  status: 'live',
  brandDocument: { type: 'invoice', number: 'INV/26-27/0042', date: '2026-10-30' },
  consignorGstin: '29ABCDE1234F1Z5',
  consignor: { name: 'Brand A', legalName: 'Brand A Pvt Ltd' },
  declaredValuePaise: 11_800_000,
  destinationStateCode: '27',
  supplyType: 'inter',
  thresholdPaise: 5_000_000,
  thresholdRule: 'national',
  ewayRequired: true,
  eway: { status: 'recorded', number: '123456789012', date: '2026-10-30', validUntil: '2026-11-01', exemptionReason: null, exemptionNote: null },
  recordedAfterDispatch: false,
  dispatchedAt: null,
  source: 'portal',
  recordedBy: 'u-1',
  recordedAt: '2026-10-30T05:00:00.000Z',
  endedAt: null,
  endedBy: null,
  endReason: null,
  ...patch,
});

describe('story 4-6a — money and numbers', () => {
  test('rupees in Indian grouping, whole rupees without paise (the backend’s formatter)', () => {
    expect(formatRupees(11_800_000)).toBe('₹1,18,000');
    expect(formatRupees(5_000_050)).toBe('₹50,000.50');
    expect(formatRupees(0)).toBe('₹0');
    expect(formatRupees(100_000_000_000)).toBe('₹1,00,00,00,000');
  });

  test('an e-way bill number prints in fours; anything else as given', () => {
    expect(formatEwayBillNumber('123456789012')).toBe('1234 5678 9012');
    expect(formatEwayBillNumber('12345')).toBe('12345');
  });
});

describe('story 4-6a — the gate in words', () => {
  test('the chip: the word first, blocking states amber or red, expiring amber', () => {
    expect(gateChip('missing')).toEqual({ word: 'Invoice needed', tone: 'warning' });
    expect(gateChip('eway-required')).toEqual({ word: 'E-way bill needed', tone: 'danger' });
    expect(gateChip('eway-expired')).toEqual({ word: 'E-way bill expired', tone: 'danger' });
    expect(gateChip('ready', true)).toEqual({ word: 'Expires today', tone: 'warning' });
    expect(gateChip('ready')?.tone).toBe('success');
    expect(gateChip('dispatched')).toBeNull();
    expect(gateChip(undefined)).toBeNull();
    expect(['missing', 'eway-required', 'eway-expired'].every((s) => gateBlocks(s as never))).toBe(true);
    expect(gateBlocks('ready')).toBe(false);
  });

  test('why it is required; the value reason says strictly above (D17)', () => {
    expect(requiredBecauseWords('policy-b2b', null)).toBe('B2B rule');
    expect(requiredBecauseWords('policy-all', 6_200_000)).toBe('Every order');
    expect(requiredBecauseWords('value', 6_200_000)).toBe('Value ₹62,000 by the order’s own figures — above ₹50,000');
    expect(requiredBecauseWords(null, null)).toBe('—');
  });

  test('the panel’s gate line (A24)', () => {
    const gate = { requiredBecause: null, valueFloorPaise: null, expiresToday: false, nationalThresholdPaise: 5_000_000 } as const;
    expect(gateLine({ ...gate, state: 'missing', requiredBecause: 'policy-b2b' }, { clientCode: 'BRAND-A' })).toBe('Required — B2B order for BRAND-A. Not recorded.');
    expect(gateLine({ ...gate, state: 'missing', requiredBecause: 'value', valueFloorPaise: 6_000_000 })).toContain('(₹60,000) is above the e-way threshold of ₹50,000');
    expect(gateLine({ ...gate, state: 'not-required' })).toContain('cannot be judged');
    expect(gateLine({ ...gate, state: 'ready', expiresToday: true })).toContain('expires today');
    expect(gateLine({ ...gate, state: 'not-applicable' }, { orderStatus: 'cancelled' })).toBe('Not needed — the order is cancelled.');
    expect(gateLine({ ...gate, state: 'not-applicable' })).toContain('own goods');
    expect(portalGateLine({ ...gate, state: 'missing', requiredBecause: 'policy-b2b' })).toBe('We need your tax invoice (or challan) before this order can leave.');
    expect(portalGateLine({ ...gate, state: 'eway-required' })).toContain('We need your e-way bill');
  });

  test('the builder’s mark and the handover refusal words are one vocabulary, appended last (D4)', () => {
    expect(consignmentBlockerWord('missing')).toBe('Invoice not recorded — record it first');
    expect(consignmentBlockerWord('ready')).toBeNull();
    for (const [code, word] of Object.entries(CONSIGNMENT_REFUSAL_WORD)) {
      expect(HANDOVER_REFUSAL_WORD[code as keyof typeof HANDOVER_REFUSAL_WORD]).toBe(word);
    }
    const candidate = (consignment?: { state: 'missing' | 'ready'; blocking: boolean }) => ({
      shipment: { kind: 'client-label' as const, awb: '77001', courierName: 'D', packageCount: 1, labelVerified: true },
      ...(consignment === undefined ? {} : { consignment: { ...consignment, ewayBillNumber: null, ewayValidUntil: null } }),
    });
    expect(consignmentBlocker(candidate({ state: 'missing', blocking: true }))).toBe('Invoice not recorded — record it first');
    // A documents block outranks the AWB words; a ready or absent gate says nothing new.
    expect(candidateBlocker(candidate({ state: 'missing', blocking: true }), EMPTY_ROW)).toBe('Invoice not recorded — record it first');
    expect(candidateBlocker(candidate({ state: 'ready', blocking: false }), EMPTY_ROW)).toBeNull();
    expect(candidateBlocker(candidate(), EMPTY_ROW)).toBeNull();
  });
});

describe('story 4-6a — a version in words', () => {
  test('the e-way verdict: strictly above, the rule and the movement named', () => {
    expect(ewayVerdictLine(view())).toBe('Required — ₹1,18,000 is above ₹50,000 (national, inter-state).');
    expect(ewayVerdictLine(view({ declaredValuePaise: 5_000_000, ewayRequired: false }))).toBe('Not required — ₹50,000 is not above ₹50,000 (national, inter-state).');
    expect(ewayVerdictLine(view({ declaredValuePaise: 8_000_000, thresholdPaise: 10_000_000, thresholdRule: 'state:29', supplyType: 'intra', ewayRequired: false }))).toBe(
      'Not required — ₹80,000 is not above ₹1,00,000 (Karnataka intra-state limit, intra-state).',
    );
    expect(ewayVerdictLine(view({ thresholdPaise: null, ewayRequired: false }))).toContain('no e-way threshold applies');
    expect(thresholdRuleWords('national', null)).toBe('national, destination unknown');
  });

  test('the e-way line for each status', () => {
    expect(ewayLine(view().eway)).toBe('E-way bill 1234 5678 9012 dated 30 Oct 2026, valid until 1 Nov 2026');
    expect(ewayLine({ ...view().eway, status: 'exempt', number: null, date: null, validUntil: null, exemptionReason: 'other', exemptionNote: 'Own vehicle' })).toBe('Exempt — exempt (Own vehicle)');
    expect(ewayLine({ ...view().eway, status: 'pending', number: null })).toContain('not recorded yet');
  });

  test('the validity warning: expired, expires today, or nothing', () => {
    expect(ewayValidityWarning('2026-10-29', NOW)).toContain('expired on 29 Oct 2026');
    expect(ewayValidityWarning('2026-10-30', NOW)).toContain('expires today');
    expect(ewayValidityWarning('2026-11-01', NOW)).toBeNull();
    expect(ewayValidityWarning(null, NOW)).toBeNull();
  });

  test('an amendment’s draft is the live version, the reason blank', () => {
    const d = draftFromView(view({ declaredValuePaise: 5_000_050 }));
    expect(d).toMatchObject({ documentNumber: 'INV/26-27/0042', declaredValue: '50000.50', ewayMode: 'bill', ewayBillNumber: '123456789012', reason: '' });
    expect(draftFromView(view({ eway: { ...view().eway, status: 'exempt', number: null, date: null, validUntil: null, exemptionReason: 'customs', exemptionNote: null } })).ewayMode).toBe('exempt');
    expect(draftFromView(view({ eway: { ...view().eway, status: 'pending', number: null, date: null, validUntil: null } })).ewayMode).toBe('none');
  });
});

describe('story 4-6a — the form’s parse (the server’s shape rules, A8, A33, A34)', () => {
  test('a full record: the e-way number’s spaces stripped, a blank consignor left to the server', () => {
    expect(parseConsignmentDraft(draft(), ctx)).toEqual({
      ok: true,
      body: {
        brandDocument: { type: 'invoice', number: 'INV/26-27/0042', date: '2026-10-30' },
        declaredValuePaise: 11_800_000,
        ewayBill: { number: '123456789012', date: '2026-10-30', validUntil: '2026-11-01' },
      },
    });
  });

  test('no e-way bill yet: nothing about it is sent', () => {
    const parsed = parseConsignmentDraft(draft({ ewayBillNumber: '', ewayBillDate: '', ewayValidUntil: '' }), ctx);
    expect(parsed.ok && 'ewayBill' in parsed.body).toBe(false);
    expect(parseConsignmentDraft(draft({ ewayMode: 'none' }), ctx)).toMatchObject({ ok: true });
  });

  test('each refusal names its field, in the server’s order', () => {
    expect(parseConsignmentDraft(draft({ documentNumber: ' ' }), ctx)).toMatchObject({ ok: false, field: 'documentNumber' });
    expect(parseConsignmentDraft(draft({ documentNumber: 'X'.repeat(41) }), ctx)).toMatchObject({ ok: false, field: 'documentNumber' });
    expect(parseConsignmentDraft(draft({ documentDate: '2026-10-31' }), ctx)).toMatchObject({ ok: false, field: 'documentDate' });
    expect(parseConsignmentDraft(draft({ documentDate: '2026-09-27' }), ctx)).toMatchObject({ ok: false, field: 'documentDate' });
    expect(parseConsignmentDraft(draft({ documentDate: '2026-09-28', ewayBillDate: '2026-10-30' }), ctx)).toMatchObject({ ok: true });
    expect(parseConsignmentDraft(draft({ declaredValue: '' }), ctx)).toMatchObject({ ok: false, field: 'declaredValue' });
    expect(parseConsignmentDraft(draft({ declaredValue: '1.234' }), ctx)).toMatchObject({ ok: false, field: 'declaredValue' });
    expect(parseConsignmentDraft(draft({ declaredValue: '10000000001' }), ctx)).toMatchObject({ ok: false, field: 'declaredValue' });
    expect(parseConsignmentDraft(draft({ consignorGstin: 'XX' }), ctx)).toMatchObject({ ok: false, field: 'consignorGstin' });
    expect(parseConsignmentDraft(draft({ ewayBillNumber: '12345678901' }), ctx)).toMatchObject({ ok: false, field: 'ewayBillNumber' });
    expect(parseConsignmentDraft(draft({ ewayBillDate: '' }), ctx)).toMatchObject({ ok: false, field: 'ewayBillDate' });
    // A34 — an order's bill carries its validity.
    expect(parseConsignmentDraft(draft({ ewayValidUntil: '' }), ctx)).toMatchObject({ ok: false, field: 'ewayValidUntil' });
    expect(parseConsignmentDraft(draft({ ewayValidUntil: '2026-10-29', ewayBillDate: '2026-10-30' }), ctx)).toMatchObject({ ok: false, field: 'ewayValidUntil' });
    // A33 — never dated before the document.
    expect(parseConsignmentDraft(draft({ ewayBillDate: '2026-10-29' }), ctx)).toMatchObject({ ok: false, field: 'ewayBillDate' });
    expect(parseConsignmentDraft(draft({ ewayBillNumber: '', ewayValidUntil: '2026-11-01' }), ctx)).toMatchObject({ ok: false, field: 'ewayBillNumber' });
  });

  test('an exemption: its reason, and a note for "other"; never beside a bill (the mode picks one)', () => {
    const exempt = draft({ ewayMode: 'exempt', exemptionReason: 'other', exemptionNote: '' });
    expect(parseConsignmentDraft(exempt, ctx)).toMatchObject({ ok: false, field: 'exemptionNote' });
    expect(parseConsignmentDraft({ ...exempt, exemptionReason: '' }, ctx)).toMatchObject({ ok: false, field: 'exemptionReason' });
    const parsed = parseConsignmentDraft({ ...exempt, exemptionReason: 'customs' }, ctx);
    expect(parsed).toEqual({
      ok: true,
      body: { brandDocument: { type: 'invoice', number: 'INV/26-27/0042', date: '2026-10-30' }, declaredValuePaise: 11_800_000, ewayExemption: { reason: 'customs' } },
    });
  });

  test('after dispatch the reason is required; it is sent trimmed', () => {
    expect(parseConsignmentDraft(draft(), { ...ctx, reasonRequired: true })).toMatchObject({ ok: false, field: 'reason' });
    const parsed = parseConsignmentDraft(draft({ reason: ' Validity extended ' }), { ...ctx, reasonRequired: true });
    expect(parsed.ok && parsed.body.reason).toBe('Validity extended');
  });
});

describe('story 4-6a — refusals by code', () => {
  test('the record and withdraw refusals', () => {
    expect(consignmentReason(new Error('boom'))).toBe(UNREACHABLE_REASON);
    expect(consignmentReason(problem('eway-bill-in-use', 409, { orderId: 'o-9', orderLabel: 'SO-9' }))).toContain('order SO-9');
    expect(consignmentReason(problem('own-goods-invoiced'))).toContain('Compliance → Invoices');
    expect(consignmentReason(problem('eway-threshold-missing'))).toBe('No e-way threshold is configured for that date — contact support.');
    expect(consignmentReason(problem('role-denied', 403, {}, 'Only an office role can record an e-way exemption'))).toBe('Only an office role can record an e-way exemption');
    expect(consignmentReason(problem('order-dispatched'))).toContain('amend the record instead');
    expect(consignmentReason(problem('consignment-version-limit'))).toContain('99 times');
    expect(consignmentReason(problem('declared-value-below-order-value', 422, {}, 'The declared value ₹8,000 is below the COD amount ₹80,000'))).toContain('₹8,000');
    expect(consignmentRefusalReloads(problem('consignment-not-found'))).toBe(true);
    expect(consignmentRefusalReloads(problem('eway-bill-in-use'))).toBe(false);
  });

  test('a per-order dispatch refused by the gate (A13) — worded from its extensions, ahead of the verbatim 409', () => {
    const b2b = problem('consignment-documents-missing', 409, { requiredBecause: 'policy-b2b', valueFloorPaise: null, thresholdPaise: 5_000_000 }, 'server words');
    expect(gateRefusalSentence(b2b)).toContain('it is a B2B order');
    expect(dispatchReason(b2b)).toBe(gateRefusalSentence(b2b)!);
    const value = problem('consignment-documents-missing', 409, { requiredBecause: 'value', valueFloorPaise: 6_000_000, thresholdPaise: 5_000_000 });
    expect(dispatchReason(value)).toContain('its own value (₹60,000) is above the e-way threshold of ₹50,000');
    expect(dispatchReason(problem('eway-bill-expired'))).toContain('has expired');
    expect(dispatchReason(problem('eway-bill-required'))).toContain('no e-way bill is recorded');
    expect(gateRefusalSentence(problem('conflict'))).toBeNull();
  });

  test('a return dispatch’s e-way refusals carry the server’s figures (A22)', () => {
    expect(ewayDispatchRefusal(problem('eway-bill-required', 409, { declaredValuePaise: 7_500_000, thresholdPaise: 5_000_000, thresholdRule: 'national' }))).toBe(
      'The declared value ₹75,000 is above the e-way threshold ₹50,000 (national) — enter the brand’s e-way bill number and its date.',
    );
    expect(ewayDispatchRefusal(problem('eway-bill-expired'))).toContain('validity ended');
    expect(ewayDispatchRefusal(problem('rtv-not-picked'))).toBeNull();
    expect(parseDeclaredValue('')).toMatchObject({ paise: null });
    expect(parseDeclaredValue('75000')).toEqual({ paise: 7_500_000, problem: null });
  });
});

describe('story 4-6a — the handover sheet (A19, A39) and small words', () => {
  test('the stamped numbers print; "Not recorded" only for a flagged parcel with none', () => {
    const stamped = { taxDocument: { type: 'challan', number: 'DC-7', date: '2026-10-30' }, ewayBillNumber: '123456789012', ewayValidUntil: '2026-11-01', complianceException: 'eway-bill-expired' };
    expect(sheetDocumentCell(stamped)).toBe('DC DC-7');
    expect(sheetEwayCell(stamped)).toBe('1234 5678 9012 (to 1 Nov 2026)');
    expect(sheetDocumentCell({ taxDocument: null, complianceException: 'consignment-documents-missing' })).toBe('Not recorded');
    expect(sheetEwayCell({ taxDocument: null, complianceException: 'consignment-documents-missing' })).toBe('Not recorded');
    expect(sheetDocumentCell({})).toBe('—');
    expect(sheetEwayCell({ taxDocument: { type: 'invoice', number: 'I', date: '2026-10-30' }, ewayBillNumber: null })).toBe('—');
    expect(sheetExceptionNote({}, (iso) => iso)).toBeNull();
    expect(sheetExceptionNote({ complianceException: 'consignment-documents-missing' }, (iso) => iso)).toBe(COMPLIANCE_EXCEPTION_WORD['consignment-documents-missing']);
    expect(
      sheetExceptionNote(
        { complianceException: 'consignment-documents-missing', lateRecord: { seq: 2, brandDocument: { type: 'invoice', number: 'I', date: '2026-10-31' }, ewayBillNumber: null, recordedAt: 'T' } },
        (iso) => iso,
      ),
    ).toBe('Left without the brand’s invoice — cleared by a late record (v2, T)');
  });

  test('the portal banner and the age column', () => {
    expect(portalNeededBanner(0)).toBeNull();
    expect(portalNeededBanner(1)).toBe('1 order is waiting for your invoice or e-way bill');
    expect(portalNeededBanner(3)).toBe('3 orders are waiting for your invoice or e-way bill');
    expect(orderAgeWords('2026-10-30T00:30:00.000Z', NOW)).toBe('today');
    expect(orderAgeWords('2026-10-29T04:30:00.000Z', NOW)).toBe('1 day');
    expect(orderAgeWords('2026-10-26T04:30:00.000Z', NOW)).toBe('4 days');
  });
});
