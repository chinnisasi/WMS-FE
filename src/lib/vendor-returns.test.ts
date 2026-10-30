import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import { emptyConsignmentDraft } from './consignment-capture';
import { CLIENT_DEPARTED_REASON } from './client-departed';
import { UNREACHABLE_REASON } from './outbound-orders';
import {
  VENDOR,
  VENDOR_B,
  VENDOR_PARTNER,
  GRN_LINE_L,
  GRN_LINE_M,
  WH,
  armA,
  armK,
  dispatchedReturn,
  pickedReturn,
  source,
  vendorReturn,
} from './test/vendor-return-fixtures';
import {
  CONSIGNEE_ADDRESS_LABEL,
  RTV_CANCEL_PICKED_INSTRUCTION,
  RTV_CANCELLED_WATERMARK,
  RTV_DRAFT_WATERMARK,
  RTV_HIDDEN_LINE_PROBLEM,
  RTV_NOT_A_TAX_INVOICE,
  RTV_PICK_GUIDANCE,
  RTV_REASON_CODES,
  RTV_REASON_LABEL,
  SOURCE_KIND_LABEL,
  VENDOR_RETURN_STATUSES,
  VENDOR_RETURN_STATUS_LABEL,
  addressKindBlock,
  armKey,
  buildCreateBody,
  cancelConfirmSentence,
  cancelledOutcome,
  canCancelVendorReturn,
  canDispatchVendorReturn,
  createdOutcome,
  defaultAddressKind,
  defaultReasonFor,
  defaultSourceFor,
  dispatchedOutcome,
  draftLineFor,
  keyForBody,
  parseCancelReason,
  parseRtvDispatch,
  resolveLine,
  returnableEmptySentence,
  rtvReason,
  rtvRefusalReloads,
  rtvRefusalStalesReturnable,
  summaryQuantityLabel,
  vendorReturnNoteModel,
  vendorReturnStatusTone,
  type RtvDraft,
  type RtvDraftLine,
} from './vendor-returns';

const problem = (code: string, status = 409, extensions: Record<string, unknown> = {}, detail?: string) =>
  new ApiProblem(code, status, detail, undefined, extensions);

describe('the words', () => {
  test('every status, reason, address kind and source kind is labelled (Record-typed over the generated unions)', () => {
    expect(VENDOR_RETURN_STATUSES).toEqual(['draft', 'picked', 'dispatched', 'cancelled']);
    expect(VENDOR_RETURN_STATUS_LABEL.picked).toBe('Picked — ready to dispatch');
    expect(RTV_REASON_CODES).toEqual(['damaged', 'quality-failure', 'expired', 'wrong-item', 'recall', 'other']);
    expect(RTV_REASON_LABEL.other).toContain('note');
    expect(CONSIGNEE_ADDRESS_LABEL).toEqual({ dispatch: 'Dispatch address', registered: 'Registered address' });
    expect(SOURCE_KIND_LABEL['qc-fail']).toBe('Failed QC');
  });

  test('the tones: a draft waits on the floor (info), a picked one on the dispatch (warning); an unknown status is neutral', () => {
    expect(vendorReturnStatusTone('draft')).toBe('info');
    expect(vendorReturnStatusTone('picked')).toBe('warning');
    expect(vendorReturnStatusTone('dispatched')).toBe('success');
    expect(vendorReturnStatusTone('cancelled')).toBe('neutral');
    expect(vendorReturnStatusTone('received-by-vendor')).toBe('neutral');
  });

  test('the reason defaults from the source kind', () => {
    expect(defaultReasonFor('receipt-damage')).toBe('damaged');
    expect(defaultReasonFor('qc-fail')).toBe('quality-failure');
    expect(defaultReasonFor(null)).toBe('damaged');
  });

  test('A16 — the empty returnable list says how units reach DAMAGED', () => {
    const sentence = returnableEmptySentence('GlowCo', 'Bengaluru DC');
    expect(sentence).toContain('receipt damage');
    expect(sentence).toContain('manual QC hold');
    expect(sentence).toContain('inspection that fails');
  });

  test('the affordances follow the state: cancel a draft or picked one, dispatch a picked one only', () => {
    expect(['draft', 'picked', 'dispatched', 'cancelled'].filter(canCancelVendorReturn)).toEqual(['draft', 'picked']);
    expect(['draft', 'picked', 'dispatched', 'cancelled'].filter(canDispatchVendorReturn)).toEqual(['picked']);
  });

  test('A16 — cancelling a picked return says to put the staged units back', () => {
    expect(cancelConfirmSentence({ code: 'RTV-0001', status: 'picked' })).toContain(RTV_CANCEL_PICKED_INSTRUCTION);
    expect(RTV_CANCEL_PICKED_INSTRUCTION).toBe('Return the staged units to the DAMAGED location.');
    expect(cancelConfirmSentence({ code: 'RTV-0001', status: 'draft' })).not.toContain('staged');
    expect(cancelledOutcome(pickedReturn()).reason).toContain(RTV_CANCEL_PICKED_INSTRUCTION);
    expect(cancelledOutcome(vendorReturn()).reason).not.toContain('staged');
  });

  test('the cancel reason is required, at most 500', () => {
    expect(parseCancelReason('  ')).toEqual({ reason: null, problem: 'Say why the return is cancelled.' });
    expect(parseCancelReason('x'.repeat(501)).reason).toBeNull();
    expect(parseCancelReason(' vendor refused ').reason).toBe('vendor refused');
  });

  test('the outcomes are built from the response', () => {
    expect(createdOutcome(vendorReturn())).toEqual({ tone: 'accepted', word: 'RTV-0001 created', reason: `2 lines for Acme Foods. ${RTV_PICK_GUIDANCE}` });
    expect(RTV_PICK_GUIDANCE).toContain('Returns out tab');
    const sent = dispatchedOutcome(dispatchedReturn());
    expect(sent.word).toBe('RTV-0001 dispatched');
    expect(sent.reason).toContain('1 package to Acme Foods under delivery challan CH-77');
  });

  test('the list quantity: picked of asked once picked', () => {
    expect(summaryQuantityLabel({ totalQuantity: 6.25, totalPickedQuantity: null })).toBe('6.25');
    expect(summaryQuantityLabel({ totalQuantity: 1250, totalPickedQuantity: 1000 })).toBe('1,000 of 1,250');
  });
});

describe('rtvReason — by code, never prose', () => {
  test('the transport arm is the house unreachable copy', () => {
    expect(rtvReason(new TypeError('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });

  test('rtv-exceeds-damaged names the figures from the extensions', () => {
    const reason = rtvReason(problem('rtv-exceeds-damaged', 409, { onHandQty: 10, claimedQty: 6, availableQty: 4, requestedQty: 5 }));
    expect(reason).toBe('DAMAGED holds 10, 6 already claimed by open returns — at most 4 can go on a new return (asked 5). Refresh and lower the quantity.');
    expect(rtvReason(problem('rtv-exceeds-damaged'))).toContain('refresh');
  });

  test('rtv-exceeds-source and rtv-damaged-short use their extensions', () => {
    expect(rtvReason(problem('rtv-exceeds-source', 409, { claimableQty: 4, requestedQty: 5 }))).toBe(
      'The source GRN line can still claim 4 (asked 5) — lower the quantity or clear the source.',
    );
    const short = rtvReason(problem('rtv-damaged-short', 409, { skuCode: 'SKU-A', batchCode: 'B1', onHandQty: 2, pickedQty: 4 }), 'dispatch');
    expect(short).toContain('DAMAGED holds 2 of SKU-A batch B1 but the return ships 4');
    expect(short).toContain('Cancel the return and create it again');
    expect(short).toContain('taken out of DAMAGED after the return was created');
  });

  test('a state refusal names the status it found', () => {
    expect(rtvReason(problem('rtv-not-picked', 409, { rtvStatus: 'draft' }), 'dispatch')).toContain('(it is draft — awaiting pick now)');
    expect(rtvReason(problem('rtv-closed', 409, { rtvStatus: 'dispatched' }), 'cancel')).toContain('dispatched');
    expect(rtvReason(problem('rtv-not-draft', 409, { rtvStatus: 'cancelled' }))).toContain('cancelled');
  });

  test('every code the routes document has its own sentence (no code falls to the server detail)', () => {
    const codes = [
      'rtv-sku-unsupported',
      'mixed-client',
      'partner-not-vendor',
      'vendor-inactive',
      'vendor-not-linked',
      'rtv-vendor-mismatch',
      'rtv-source-mismatch',
      'rtv-pick-mismatch',
      'rtv-pick-empty',
      'partner-not-transporter',
      'transporter-inactive',
      'disposition-scope-quarantined',
      'damaged-bin-conflict',
      'role-denied',
      'permission-denied',
      'unauthenticated',
      'idempotency-key-reuse',
      'conflict',
      'invalid-cursor',
    ];
    for (const code of codes) {
      const sentence = rtvReason(problem(code, 409, {}, 'SERVER-DETAIL'));
      expect(sentence).not.toContain('SERVER-DETAIL');
      expect(sentence.length).toBeGreaterThan(10);
    }
    expect(rtvReason(problem('client-departed'))).toBe(CLIENT_DEPARTED_REASON);
    expect(rtvReason(problem('role-denied', 403), 'dispatch')).toBe('Your role cannot dispatch returns to vendor.');
    expect(rtvReason(problem('role-denied', 403), 'cancel')).toBe('Your role cannot cancel returns to vendor.');
  });

  test('validation-failed and an unknown code render the server detail, then a sentence naming the code', () => {
    expect(rtvReason(problem('validation-failed', 400, {}, 'brandDocument is required.'))).toBe('brandDocument is required.');
    expect(rtvReason(problem('brand-new-code', 409, {}, 'Something new.'))).toBe('Something new.');
    expect(rtvReason(problem('brand-new-code', 409))).toBe('Not recorded (brand-new-code).');
  });

  test('which refusals re-read what', () => {
    expect(rtvRefusalReloads(problem('rtv-closed'))).toBe(true);
    expect(rtvRefusalReloads(problem('rtv-not-picked'))).toBe(true);
    expect(rtvRefusalReloads(problem('validation-failed', 400))).toBe(false);
    expect(rtvRefusalStalesReturnable(problem('rtv-exceeds-damaged'))).toBe(true);
    expect(rtvRefusalStalesReturnable(problem('mixed-client'))).toBe(false);
  });
});

describe('the create draft', () => {
  const arms = [armA(), armK()];
  const ctx = { warehouseId: WH, vendor: VENDOR_PARTNER };
  const lineA = (patch: Partial<RtvDraftLine> = {}): RtvDraftLine => ({ ...draftLineFor(armA(), 0), ...patch });
  const lineK = (patch: Partial<RtvDraftLine> = {}): RtvDraftLine => ({ ...draftLineFor(armK(), 0), ...patch });
  const draft = (patch: Partial<RtvDraft> = {}): RtvDraft => ({ vendorId: VENDOR, consigneeAddress: 'registered', note: '', lines: [], ...patch });

  test('A5 — a line defaults to a source of exactly the chosen vendor, and its reason from that source', () => {
    expect(defaultSourceFor(armA(), VENDOR)?.grnLineId).toBe(GRN_LINE_L);
    expect(defaultSourceFor(armA(), VENDOR_B)).toBeNull();
    expect(defaultSourceFor(armA(), '')).toBeNull();
    // A blind receipt's source (vendorId null) is never a default — only an explicit pick.
    expect(defaultSourceFor(armK(), VENDOR)).toBeNull();
    expect(resolveLine(lineA(), armA(), VENDOR)).toMatchObject({ source: { grnLineId: GRN_LINE_L }, reason: 'damaged' });
    expect(resolveLine(lineK({ source: GRN_LINE_M }), armK(), VENDOR)).toMatchObject({ source: { grnLineId: GRN_LINE_M }, reason: 'quality-failure' });
    expect(resolveLine(lineA({ source: '' }), armA(), VENDOR).source).toBeNull();
    expect(resolveLine(lineA({ reason: 'recall' }), armA(), VENDOR).reason).toBe('recall');
  });

  test('the body: only lines with a quantity, the default source, batch and source omitted when absent, the note trimmed', () => {
    const built = buildCreateBody(
      draft({ note: '  crushed  ', lines: [lineA({ quantity: '4' }), lineK({ quantity: '1.25', source: '' }), lineK({ id: 'x', quantity: '' })] }),
      arms,
      ctx,
    );
    expect(built).toEqual({
      ok: true,
      lineCount: 2,
      body: {
        warehouseId: WH,
        vendorId: VENDOR,
        consigneeAddress: 'registered',
        note: 'crushed',
        lines: [
          { skuId: armA().skuId, batchId: armA().batchId!, grnLineId: GRN_LINE_L, quantity: 4, reasonCode: 'damaged' },
          // No source picked: the reason still follows the arm's own (QC-fail) source kind.
          { skuId: armK().skuId, quantity: 1.25, reasonCode: 'quality-failure' },
        ],
      },
    });
  });

  test('the vendor and address are required; a kind the vendor lacks is refused (A7 — no silent fallback)', () => {
    expect(buildCreateBody(draft({ vendorId: '' }), arms, { warehouseId: WH, vendor: null })).toMatchObject({ ok: false });
    expect(buildCreateBody(draft({ consigneeAddress: '' }), arms, ctx)).toMatchObject({ ok: false, problem: "Pick which of the vendor's addresses the goods go to." });
    const lacking = buildCreateBody(draft({ consigneeAddress: 'dispatch', lines: [lineA({ quantity: '1' })] }), arms, ctx);
    expect(lacking.ok === false && lacking.problem).toContain('no dispatch address');
    expect(addressKindBlock(VENDOR_PARTNER, 'dispatch')).toBe('This vendor has no dispatch address');
    expect(addressKindBlock(VENDOR_PARTNER, 'registered')).toBeNull();
    expect(defaultAddressKind(VENDOR_PARTNER)).toBe('registered');
    expect(defaultAddressKind({ dispatchAddress: VENDOR_PARTNER.registeredAddress, registeredAddress: null })).toBe('dispatch');
    expect(defaultAddressKind({ dispatchAddress: null, registeredAddress: null })).toBe('');
  });

  test('a typed line whose arm is hidden by the SKU filter (or gone) is refused, never dropped; a blank one is ignored', () => {
    const hidden = buildCreateBody(draft({ lines: [lineA({ quantity: '1' }), lineK({ quantity: '1', source: '' })] }), [armA()], ctx);
    expect(hidden).toEqual({ ok: false, problem: RTV_HIDDEN_LINE_PROBLEM, lineId: lineK().id });
    expect(buildCreateBody(draft({ lines: [lineA({ quantity: '1' }), lineK({ quantity: '' })] }), [armA()], ctx).ok).toBe(true);
  });

  test('nothing to return is a problem', () => {
    expect(buildCreateBody(draft({ lines: [lineA({ quantity: '0' })] }), arms, ctx)).toMatchObject({ ok: false, problem: expect.stringContaining('at least one line') });
  });

  test('A4 — the pool cap sums per arm across lines (two sources on one arm)', () => {
    const twoSources = armA({ sources: [source(), source({ grnLineId: 'other-line', grnCode: 'GRN-0008', claimableQty: 6 })] });
    const built = buildCreateBody(
      draft({ lines: [lineA({ quantity: '4' }), { ...draftLineFor(twoSources, 1), quantity: '3', source: 'other-line' }] }),
      [twoSources],
      ctx,
    );
    expect(built.ok).toBe(false);
    expect(built.ok === false && built.problem).toContain('at most 6 each can go back');
    expect(built.ok === false && built.problem).toContain('claimed by RTV-0002');
    expect(built.ok === false && built.lineId).toBe(`${armKey(twoSources)}#1`);
  });

  test("the source cap: a source's claimableQty, summed across the lines naming it", () => {
    const tight = armA({ available: 10, sources: [source({ claimableQty: 2 })] });
    const built = buildCreateBody(draft({ lines: [lineA({ quantity: '3' })] }), [tight], ctx);
    expect(built.ok === false && built.problem).toContain('GRN-0007 can still claim 2 each');
  });

  test("another vendor's PO source is refused; two lines on one source are refused", () => {
    const other = buildCreateBody(draft({ vendorId: VENDOR, lines: [lineA({ quantity: '1', source: GRN_LINE_L })] }), [armA({ sources: [source({ vendorId: VENDOR_B, vendorName: 'Bolt Nuts' })] })], ctx);
    expect(other.ok === false && other.problem).toContain('of Bolt Nuts — its units go back to that vendor');
    const twice = buildCreateBody(
      draft({ lines: [lineA({ quantity: '1', source: '' }), { ...draftLineFor(armA(), 1), quantity: '1', source: '' }] }),
      arms,
      ctx,
    );
    expect(twice.ok === false && twice.problem).toContain('two lines name the same source');
  });

  test("the unit's precision: each counts whole units, kg takes 3 places; a non-number is refused, never rounded", () => {
    expect(buildCreateBody(draft({ lines: [lineA({ quantity: '1.5' })] }), arms, ctx)).toMatchObject({ ok: false, problem: expect.stringContaining('whole units') });
    expect(buildCreateBody(draft({ lines: [lineK({ quantity: '1.2345', source: '' })] }), arms, ctx)).toMatchObject({ ok: false, problem: expect.stringContaining('3 decimal places') });
    expect(buildCreateBody(draft({ lines: [lineA({ quantity: '1e2' })] }), arms, ctx)).toMatchObject({ ok: false, problem: expect.stringContaining('a number') });
  });

  test('other needs the note', () => {
    expect(buildCreateBody(draft({ lines: [lineA({ quantity: '1', reason: 'other' })] }), arms, ctx)).toMatchObject({ ok: false, problem: expect.stringContaining('Other needs the note') });
    expect(buildCreateBody(draft({ note: 'wrong colour', lines: [lineA({ quantity: '1', reason: 'other' })] }), arms, ctx).ok).toBe(true);
  });

  test('2-8a C1 — one key per draft: reused for the same body, minted afresh when the body changes', () => {
    let n = 0;
    const mint = () => `K${++n}`;
    const first = keyForBody(null, '{"a":1}', mint);
    expect(keyForBody(first, '{"a":1}', mint)).toBe(first);
    expect(keyForBody(first, '{"a":2}', mint).key).toBe('K2');
  });
});

describe('the dispatch is bound to the return', () => {
  test('the 30-day window counts back from the return’s creation', () => {
    const rtv = pickedReturn();
    const now = Date.parse('2026-10-28T04:30:00.000Z');
    const base = { ...emptyConsignmentDraft(rtv.client.gstin, now), documentNumber: 'CH-1', vehicleNumber: 'KA01AB1234', packageCount: '1' };
    expect(parseRtvDispatch({ ...base, documentDate: '2026-09-20' }, rtv, now, '75000').ok).toBe(true);
    expect(parseRtvDispatch({ ...base, documentDate: '2026-09-19' }, rtv, now, '75000')).toMatchObject({ ok: false, field: 'documentDate' });
  });
});

describe('the printable note model', () => {
  test('before dispatch: a pick list of the asked quantities, one copy, the draft watermark, no capture, the live brand GSTIN', () => {
    const model = vendorReturnNoteModel(vendorReturn(), (skuId) => (skuId === armK().skuId ? 3 : 0));
    expect(model.dispatched).toBe(false);
    expect(model.watermark).toBe(RTV_DRAFT_WATERMARK);
    expect(model.copies).toEqual(['Pick list']);
    expect(model.capture).toEqual([]);
    expect(model.lines.map((line) => `${line.skuCode} ${line.quantity} ${line.uom}`)).toEqual(['SKU-A 5 each', 'SKU-K 1.250 kg']);
    expect(model.consignor.facts).toEqual([{ label: 'GSTIN', value: '29GLOWC1234G1Z5 (Karnataka)' }]);
  });

  test('dispatched: three copies, the shipped (picked) lines only, the frozen parties and the capture', () => {
    const model = vendorReturnNoteModel(dispatchedReturn());
    expect(model.copies).toEqual(['Vendor copy', 'Transporter copy', 'Warehouse copy']);
    expect(model.watermark).toBeNull();
    expect(model.lines.map((line) => line.skuCode)).toEqual(['SKU-A']);
    expect(model.dateLabel).toBe('22 Oct 2026');
    expect(model.consignor.name).toBe('GlowCo Consumer Pvt Ltd');
    expect(model.dispatchedFrom.heading).toBe('Dispatched from — operated by Priya Logistics');
    // A7 — no consignor GSTIN on the warehouse block.
    expect(model.dispatchedFrom.facts).toEqual([]);
    expect(model.consignee.heading).toBe('Consignee (the vendor) — registered address');
    expect(model.consignee.facts).toEqual([
      { label: 'GSTIN', value: '27AAACA1234A1Z5 (Maharashtra)' },
      { label: 'State code', value: '27 Maharashtra' },
    ]);
    expect(model.capture).toEqual([
      { label: "Consignor's document", value: 'Delivery challan CH-77 · 22 Oct 2026' },
      { label: 'Debit note', value: 'DN-9' },
      { label: 'E-way bill', value: '123456789012 · 22 Oct 2026 · valid until 24 Oct 2026' },
      { label: 'Transporter', value: 'VRL Logistics (TR-VRL)' },
      { label: 'Vehicle', value: 'KA01AB1234' },
      { label: 'AWB / LR', value: 'AWB1234' },
      { label: 'Packages', value: '1' },
      { label: 'Dispatched', value: 'Priya · 22 Oct 2026, 13:30 IST' },
    ]);
    expect(model.footer).toBe(RTV_NOT_A_TAX_INVOICE);
    expect(model.signatures).toHaveLength(2);
  });

  test('a cancelled return prints under the CANCELLED watermark — never as a live pick list', () => {
    const cancelled = { ...vendorReturn(), status: 'cancelled' as const, cancellation: { by: 'u-1', byName: 'Priya', at: '2026-10-22T08:00:00.000Z', reason: 'dup' } };
    const model = vendorReturnNoteModel(cancelled);
    expect(model.watermark).toBe(RTV_CANCELLED_WATERMARK);
    expect(model.copies).toEqual(['Cancelled']);
    expect(model.capture).toEqual([]);
    const pickedThenCancelled = vendorReturnNoteModel({ ...pickedReturn(), status: 'cancelled' });
    expect(pickedThenCancelled.watermark).toBe(RTV_CANCELLED_WATERMARK);
  });

  test('the consignor GSTIN printed is the one the dispatch recorded (A7), not the live one', () => {
    const rtv = dispatchedReturn();
    const model = vendorReturnNoteModel({ ...rtv, dispatch: { ...rtv.dispatch!, consignorGstin: '27GLOWC1234G1Z5' } });
    expect(model.consignor.facts[0]!.value).toBe('27GLOWC1234G1Z5 (Maharashtra)');
  });
});

describe('story 4-6a (A22) — the declared value judged at dispatch', () => {
  test('eway-bill-required is worded with the server’s figures', () => {
    expect(rtvReason(problem('eway-bill-required', 409, { declaredValuePaise: 7_500_000, thresholdPaise: 5_000_000, thresholdRule: 'national' }), 'dispatch')).toBe(
      'The declared value ₹75,000 is above the e-way threshold ₹50,000 (national) — enter the brand’s e-way bill number and its date.',
    );
  });
});
