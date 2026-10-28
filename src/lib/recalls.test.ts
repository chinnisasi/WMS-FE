import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { RecallCandidateDto, RecallFiguresDto, RecallLotDto } from '@/lib/api/generated';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

import {
  EMPTY_CLOSE_DRAFT,
  RECALL_FIGURE_KEYS,
  adjustedOutByReasonLabel,
  candidateAvailability,
  candidatesSummary,
  closeNeedsOverride,
  closeRecallOutcome,
  openRecallOutcome,
  parseAddBatchesDraft,
  parseCloseRecallDraft,
  parseOpenRecallDraft,
  parseRecallParam,
  preTickedCandidates,
  pruneCloseDraft,
  recallFigureRows,
  recallHref,
  recallLotStatusLabel,
  recallQuantity,
  recallReadReason,
  recallReason,
  recallReasonStale,
  recallReportFilename,
  recallReportReason,
  recallRoleLabel,
  recallStatusTone,
  releaseEligible,
  releaseIneligibleReason,
  releaseNeedsOverride,
  releaseStockLabel,
  reportNeedsCsv,
  timeToReportLabel,
} from './recalls';

const ZERO: RecallFiguresDto = {
  received: 0,
  receivedDamaged: 0,
  onHand: 0,
  inTransit: 0,
  heldInOpenOrders: 0,
  dispatched: 0,
  returned: 0,
  returnScrapped: 0,
  adjustedOut: 0,
  unaccounted: 0,
};

function candidate(over: Partial<RecallCandidateDto> & { batchId: string }): RecallCandidateDto {
  return {
    batchCode: 'AB123',
    skuId: 'sku',
    skuCode: 'SERUM',
    skuName: 'Serum',
    uom: 'each',
    status: 'active',
    blockedReason: null,
    expiryDate: null,
    match: 'exact',
    onHand: 10,
    onRecall: null,
    sameCodeOnOpenRecall: null,
    ...over,
  };
}

function lot(over: Partial<RecallLotDto> & { batchId: string; batchCode: string }): RecallLotDto {
  return {
    skuId: 'sku',
    skuCode: 'SERUM',
    skuName: 'Serum',
    uom: 'each',
    expiryDate: null,
    status: 'blocked',
    blockedReason: 'recall',
    expired: false,
    blockedByRecall: true,
    released: false,
    figures: ZERO,
    adjustedOutByReason: {},
    closeFigures: null,
    closeAdjustedOutByReason: null,
    overrideReason: null,
    dispositionNote: null,
    ...over,
  };
}

describe('the recall vocabulary', () => {
  test('every generated figure has a word, in the report order; unaccounted ≠ 0 is the one attention row', () => {
    expect(RECALL_FIGURE_KEYS).toEqual(['received', 'receivedDamaged', 'onHand', 'inTransit', 'heldInOpenOrders', 'dispatched', 'returned', 'returnScrapped', 'adjustedOut', 'unaccounted']);
    const rows = recallFigureRows({ ...ZERO, onHand: 4, unaccounted: -1 }, null);
    expect(rows.find((r) => r.key === 'onHand')).toMatchObject({ label: 'On hand', live: 4, atClose: null, attention: false });
    expect(rows.filter((r) => r.attention).map((r) => r.key)).toEqual(['unaccounted']);
    // Frozen at close beside the live figure.
    const closed = recallFigureRows(ZERO, { ...ZERO, dispatched: 2 });
    expect(closed.find((r) => r.key === 'dispatched')).toMatchObject({ live: 0, atClose: 2 });
  });

  test('status tone: an open LIVE recall is the solid amber blocking state, a mock is informational, closed neutral', () => {
    expect(recallStatusTone('open', 'live')).toEqual({ tone: 'warning', solid: true });
    expect(recallStatusTone('open', 'mock')).toEqual({ tone: 'info', solid: false });
    expect(recallStatusTone('closed', 'live')).toEqual({ tone: 'neutral', solid: false });
  });

  test('location roles in words, never a bin; an unknown role reads as sent', () => {
    expect(recallRoleLabel('storage')).toBe('Storage');
    expect(recallRoleLabel('IN-TRANSIT')).toBe('In transit');
    expect(recallRoleLabel('QC-HOLD')).toBe('QC hold');
    expect(recallRoleLabel('MEZZANINE')).toBe('MEZZANINE');
    expect(recallRoleLabel('constructor')).toBe('constructor');
  });

  test('quantities keep their digits (no rounding, no invented precision) with en-IN grouping', () => {
    expect(recallQuantity(150000, 'each')).toBe('1,50,000 each');
    expect(recallQuantity(2.5, 'kg')).toBe('2.5 kg');
  });

  test('written off by reason, largest first; nothing → null', () => {
    expect(adjustedOutByReasonLabel({ damaged: 2, expired: 5 }, 'each')).toBe('expired 5 each · damaged 2 each');
    expect(adjustedOutByReasonLabel({}, 'each')).toBeNull();
    expect(adjustedOutByReasonLabel(null, 'each')).toBeNull();
  });

  test("a lot's state now", () => {
    expect(recallLotStatusLabel(lot({ batchId: 'a', batchCode: 'A' }), 'live')).toBe('Blocked by this recall');
    expect(recallLotStatusLabel(lot({ batchId: 'a', batchCode: 'A', blockedByRecall: false, blockedReason: 'qc-failed' }), 'live')).toBe(
      'Blocked — failed QC (before the recall; kept)',
    );
    expect(recallLotStatusLabel(lot({ batchId: 'a', batchCode: 'A', status: 'active', released: true }), 'live')).toBe('Released at close');
    expect(recallLotStatusLabel(lot({ batchId: 'a', batchCode: 'A', status: 'active', blockedByRecall: false, blockedReason: null }), 'mock')).toBe(
      'Active — a mock recall blocks nothing',
    );
    expect(recallLotStatusLabel(lot({ batchId: 'a', batchCode: 'A', expired: true }), 'live')).toBe('Blocked by this recall · Expired');
  });

  test('time to the first report', () => {
    expect(timeToReportLabel(null)).toBeNull();
    expect(timeToReportLabel(30)).toBe('under a minute after opening');
    expect(timeToReportLabel(25 * 60)).toBe('25 min after opening');
    expect(timeToReportLabel(2 * 3600 + 14 * 60 + 5)).toBe('2 h 14 min after opening');
    expect(timeToReportLabel(26 * 3600)).toBe('1 d 2 h after opening');
  });

  test('the recall link and its parse: a well-shaped code only', () => {
    expect(recallHref()).toBe('/inventory?tab=recalls');
    expect(recallHref('RCL-000001')).toBe('/inventory?tab=recalls&recall=RCL-000001');
    expect(recallHref('nope')).toBe('/inventory?tab=recalls');
    expect(parseRecallParam({ recall: 'rcl-000042' })).toBe('RCL-000042');
    expect(parseRecallParam({ recall: ['RCL-000001', 'RCL-000002'] })).toBeNull();
    expect(parseRecallParam({ recall: 'RCL-12' })).toBeNull();
    expect(parseRecallParam({})).toBeNull();
  });
});

describe('the candidates checklist', () => {
  const exact = candidate({ batchId: 'b-exact' });
  const similar = candidate({ batchId: 'b-similar', batchCode: 'ab-12/3', match: 'normalised' });
  const onLive = candidate({ batchId: 'b-live', onRecall: { recallId: 'r-9', code: 'RCL-000009', mode: 'live' } });
  const onMock = candidate({ batchId: 'b-mock', onRecall: { recallId: 'r-8', code: 'RCL-000008', mode: 'mock' } });
  const sameCode = candidate({ batchId: 'b-same', sameCodeOnOpenRecall: 'RCL-000009' });

  test('pre-ticks EXACT matches only — never a similar code, a lot on a live recall, or one whose code is already on an open recall', () => {
    expect(preTickedCandidates([exact, similar, onLive, onMock, sameCode], 'live')).toEqual(['b-exact', 'b-mock']);
  });

  test('a live recall cannot tick a lot on an open LIVE recall; a mock can (two drills, or a drill beside a live recall)', () => {
    expect(candidateAvailability(onLive, 'live')).toEqual({ kind: 'on-recall', code: 'RCL-000009' });
    expect(candidateAvailability(onLive, 'mock')).toEqual({ kind: 'selectable', note: 'Also on RCL-000009' });
    expect(candidateAvailability(onMock, 'live')).toEqual({ kind: 'selectable', note: 'Also on mock RCL-000008 (a drill)' });
    expect(preTickedCandidates([onLive], 'mock')).toEqual(['b-live']);
  });

  test('adding to a recall: its own lots read "on this recall"; the same-code rule does not apply', () => {
    const own = candidate({ batchId: 'b-own', onRecall: { recallId: 'r-9', code: 'RCL-000009', mode: 'live' } });
    expect(candidateAvailability(own, 'live', 'r-9')).toEqual({ kind: 'on-this-recall' });
    expect(preTickedCandidates([own, sameCode, exact], 'live', 'r-9')).toEqual(['b-same', 'b-exact']);
  });

  test('the summary line', () => {
    expect(candidatesSummary('AB123', [])).toBe('No lot of this client matches AB123 — check the code on the label.');
    expect(candidatesSummary('AB123', [exact])).toBe('1 lot matches AB123.');
    expect(candidatesSummary('AB123', [exact, similar, onLive])).toBe('3 lots match AB123 — 2 exact, 1 similar.');
  });
});

describe('the open and add drafts', () => {
  const draft = { clientId: 'c-1', batchIds: ['b2', 'b1', 'b1'], reasonNote: '  Mislabelled allergen  ', externalRef: ' ', mode: 'live' as const };

  test('the body: distinct ids sorted, the note trimmed, a blank reference dropped, the mode sent', () => {
    expect(parseOpenRecallDraft(draft)).toEqual({ body: { batchIds: ['b1', 'b2'], reasonNote: 'Mislabelled allergen', mode: 'live' }, problem: null });
    expect(parseOpenRecallDraft({ ...draft, externalRef: ' BR-77 ', mode: 'mock' }).body).toEqual({
      batchIds: ['b1', 'b2'],
      reasonNote: 'Mislabelled allergen',
      externalRef: 'BR-77',
      mode: 'mock',
    });
  });

  test('refused in the browser: no client, no lot, no note, over 50 lots, over-long text (code points)', () => {
    expect(parseOpenRecallDraft({ ...draft, clientId: '' }).problem).toBe('Pick the client whose lot is recalled.');
    expect(parseOpenRecallDraft({ ...draft, batchIds: [] }).problem).toBe('Tick at least one lot to recall.');
    expect(parseOpenRecallDraft({ ...draft, reasonNote: '   ' }).problem).toBe('Say why the lot is recalled — the client reads this note.');
    expect(parseOpenRecallDraft({ ...draft, batchIds: Array.from({ length: 51 }, (_, i) => `b${i}`) }).problem).toContain('at most 50 lots');
    // 500 emoji are 500 code points (1,000 UTF-16 units) — allowed.
    expect(parseOpenRecallDraft({ ...draft, reasonNote: '😀'.repeat(500) }).problem).toBeNull();
    expect(parseOpenRecallDraft({ ...draft, reasonNote: 'x'.repeat(501) }).problem).toBe('The reason note is at most 500 characters.');
    expect(parseOpenRecallDraft({ ...draft, externalRef: 'x'.repeat(101) }).problem).toBe('The brand reference is at most 100 characters.');
  });

  test('add: at least one lot, and at most 50 in all', () => {
    expect(parseAddBatchesDraft(['b2', 'b1'], 10)).toEqual({ body: { batchIds: ['b1', 'b2'] }, problem: null });
    expect(parseAddBatchesDraft([], 10).problem).toBe('Tick at least one lot to add.');
    expect(parseAddBatchesDraft(['b1', 'b2'], 49).problem).toBe('A recall holds at most 50 lots — it has 49; open another recall for the rest.');
  });
});

describe('the close', () => {
  const eligible = lot({ batchId: 'b-a', batchCode: 'LOT-A' });
  const withStock = lot({ batchId: 'b-b', batchCode: 'LOT-B', figures: { ...ZERO, onHand: 4 } });
  const heldOnly = lot({ batchId: 'b-c', batchCode: 'LOT-C', figures: { ...ZERO, heldInOpenOrders: 2 } });
  const preBlocked = lot({ batchId: 'b-d', batchCode: 'LOT-D', blockedByRecall: false, blockedReason: 'qc-failed' });
  const reblocked = lot({ batchId: 'b-e', batchCode: 'LOT-E', blockedReason: 'contamination' });
  const unblocked = lot({ batchId: 'b-f', batchCode: 'LOT-F', status: 'active', blockedReason: null });
  const lots = [eligible, withStock, heldOnly, preBlocked, reblocked, unblocked];

  test('eligible = this recall blocked it AND it is still blocked for the recall; the others say why', () => {
    expect(lots.filter(releaseEligible).map((l) => l.batchCode)).toEqual(['LOT-A', 'LOT-B', 'LOT-C']);
    expect(releaseIneligibleReason(eligible, 'live')).toBeNull();
    expect(releaseIneligibleReason(preBlocked, 'live')).toBe('Already blocked (failed QC) before the recall — it stays blocked; unblock it from Batches.');
    expect(releaseIneligibleReason(reblocked, 'live')).toBe('Now blocked for contamination — it stays blocked.');
    expect(releaseIneligibleReason(unblocked, 'live')).toBe('Already unblocked.');
    expect(releaseIneligibleReason(lot({ batchId: 'm', batchCode: 'M', status: 'active', blockedByRecall: false, blockedReason: null }), 'mock')).toBe(
      'A mock recall blocked nothing — there is nothing to release.',
    );
  });

  test('a release needs an override when the lot has stock on hand, in transit or picked into open orders', () => {
    expect(releaseNeedsOverride(eligible)).toBe(false);
    expect(releaseNeedsOverride(withStock)).toBe(true);
    expect(releaseNeedsOverride(heldOnly)).toBe(true);
    expect(releaseNeedsOverride(lot({ batchId: 't', batchCode: 'T', figures: { ...ZERO, inTransit: 1 } }))).toBe(true);
    expect(releaseStockLabel(withStock)).toBe('4 each on hand');
    expect(releaseStockLabel(eligible)).toBeNull();
    expect(closeNeedsOverride({ releaseBatchIds: ['b-a'] }, lots)).toBe(false);
    expect(closeNeedsOverride({ releaseBatchIds: ['b-a', 'b-c'] }, lots)).toBe(true);
  });

  test('a re-read prunes the draft: a tick on a lot no longer eligible, and a note for a lot no longer on the recall, are dropped', () => {
    const draft = { ...EMPTY_CLOSE_DRAFT, note: 'x', releaseBatchIds: ['b-a', 'b-b'], dispositionNotes: { 'b-a': 'kept', 'b-gone': 'dropped' } };
    // LOT-B was re-blocked for another reason after the draft ticked it.
    const reread = [eligible, { ...withStock, blockedReason: 'contamination' }];
    const pruned = pruneCloseDraft(draft, reread);
    expect(pruned.releaseBatchIds).toEqual(['b-a']);
    expect(pruned.dispositionNotes).toEqual({ 'b-a': 'kept' });
    expect(parseCloseRecallDraft(pruned, reread).problem).toBeNull();
    // Nothing to drop → the same draft.
    const clean = { ...EMPTY_CLOSE_DRAFT, releaseBatchIds: ['b-a'] };
    expect(pruneCloseDraft(clean, lots)).toBe(clean);
  });

  test('the body: a note; sorted release ids; the override only with a release; blank optionals dropped; disposition notes sorted', () => {
    const parsed = parseCloseRecallDraft(
      {
        ...EMPTY_CLOSE_DRAFT,
        note: ' Brand confirmed destruction ',
        releaseBatchIds: ['b-b', 'b-a'],
        overrideReason: ' Brand cleared LOT-B ',
        dispositionNotes: { 'b-b': ' Destroyed, cert D-12 ', 'b-a': '  ' },
        evidenceRef: ' D-12 ',
      },
      lots,
    );
    expect(parsed).toEqual({
      body: {
        note: 'Brand confirmed destruction',
        releaseBatchIds: ['b-a', 'b-b'],
        overrideReason: 'Brand cleared LOT-B',
        dispositionNotes: [{ batchId: 'b-b', note: 'Destroyed, cert D-12' }],
        evidenceRef: 'D-12',
      },
      problem: null,
    });
    // No release: just the note — the override is never sent alone.
    expect(parseCloseRecallDraft({ ...EMPTY_CLOSE_DRAFT, note: 'Done', overrideReason: 'x' }, lots).body).toEqual({ note: 'Done' });
  });

  test('refused in the browser, mirroring the server: no note, an ineligible release, stock without an override, unaccounted without the acknowledgement', () => {
    expect(parseCloseRecallDraft(EMPTY_CLOSE_DRAFT, lots).problem).toBe('Say why the recall is closed — a note is required.');
    expect(parseCloseRecallDraft({ ...EMPTY_CLOSE_DRAFT, note: 'x', releaseBatchIds: ['b-d'] }, lots).problem).toBe('LOT-D cannot be released by this recall — untick it.');
    expect(parseCloseRecallDraft({ ...EMPTY_CLOSE_DRAFT, note: 'x', releaseBatchIds: ['b-b', 'b-c'] }, lots).problem).toBe(
      'LOT-B, LOT-C still has stock — say why it may be released anyway, or leave it blocked.',
    );
    const diverged = [lot({ batchId: 'b-u', batchCode: 'LOT-U', figures: { ...ZERO, unaccounted: 3 } })];
    expect(parseCloseRecallDraft({ ...EMPTY_CLOSE_DRAFT, note: 'x' }, diverged).problem).toBe(
      'LOT-U has stock that does not match the ledger history — tick the acknowledgement to close anyway.',
    );
    expect(parseCloseRecallDraft({ ...EMPTY_CLOSE_DRAFT, note: 'x', acknowledgeUnaccounted: true }, diverged).body).toEqual({ note: 'x', acknowledgeUnaccounted: true });
    expect(parseCloseRecallDraft({ ...EMPTY_CLOSE_DRAFT, note: 'x', evidenceRef: 'e'.repeat(201) }, lots).problem).toBe('The evidence reference is at most 200 characters.');
  });
});

describe('outcomes, from the response', () => {
  test('open: blocked lots, and those already blocked keep their reason; a mock blocked nothing', () => {
    expect(openRecallOutcome({ code: 'RCL-000001', mode: 'live', lots: [{ blockedByRecall: true }, { blockedByRecall: true }, { blockedByRecall: false }] })).toEqual({
      word: 'Recall RCL-000001 opened',
      reason: '2 lots blocked in every warehouse; 1 already blocked keeps its reason.',
    });
    expect(openRecallOutcome({ code: 'RCL-000002', mode: 'mock', lots: [{ blockedByRecall: false }] })).toEqual({
      word: 'Mock recall RCL-000002 opened',
      reason: '1 lot traced — a drill: nothing was blocked.',
    });
  });

  test('close: what was released', () => {
    expect(closeRecallOutcome({ code: 'RCL-000001', releasedBatchIds: null }).reason).toContain('Every lot stays blocked');
    expect(closeRecallOutcome({ code: 'RCL-000001', releasedBatchIds: ['a', 'b'] }).reason).toContain('2 lots were unblocked');
  });
});

describe('refusals, by code', () => {
  const problem = (code: string, status = 409, extensions: Record<string, unknown> = {}) => new ApiProblem(code, status, 'server prose', 'Title', extensions);

  test('every recall code has its own words, naming the codes the problem carries — never the prose', () => {
    expect(recallReason(problem('batch-already-recalled', 409, { recallCodes: ['RCL-000003'] }), 'open')).toBe(
      'A lot is already on open recall RCL-000003 — untick it, or add it to RCL-000003 instead.',
    );
    expect(recallReason(problem('mixed-client'), 'open')).toContain('one per client');
    expect(recallReason(problem('recall-release-has-stock', 409, { batchCodes: ['LOT-B'] }), 'close')).toBe(
      'LOT-B still has stock on hand, in transit or in open orders — say why it may be released anyway, or leave it blocked.',
    );
    expect(recallReason(problem('recall-release-not-eligible', 409, { batchCodes: ['LOT-D'] }), 'close')).toContain('LOT-D cannot be released here');
    expect(recallReason(problem('recall-unaccounted', 409, { batchCodes: ['LOT-U'] }), 'close')).toContain('tick the acknowledgement');
    expect(recallReason(problem('recall-open-contended', 503), 'open')).toBe(
      'A lot is being picked, dispatched, blocked or recalled right now — nothing was changed. Try again in a moment.',
    );
    expect(recallReason(problem('recall-too-many-lots'), 'add')).toContain('at most 50 lots');
    expect(recallReason(problem('recall-not-open'), 'close')).toBe('This recall is already closed — refresh it.');
    expect(recallReason(problem('idempotency-key-reuse', 422), 'open')).toContain('already sent with different details');
    expect(recallReason(problem('role-denied', 403), 'open')).toContain('owner or ops manager');
    expect(recallReason(new Error('offline'), 'open')).toBe(UNREACHABLE_REASON);
    expect(recallReason(new ApiProblem('brand-new', 409), 'close')).toBe('Not closed (brand-new).');
  });

  test('a stale refusal re-reads the detail', () => {
    expect(recallReasonStale(problem('recall-not-open'))).toBe(true);
    expect(recallReasonStale(problem('recall-release-has-stock'))).toBe(true);
    expect(recallReasonStale(problem('mixed-client'))).toBe(false);
  });

  test('reads: a slow read says try again; the house codes fall through', () => {
    expect(recallReadReason(problem('report-unavailable', 503), 'This recall')).toBe('This recall took too long to read — try again.');
    expect(recallReadReason(problem('invalid-cursor', 400), 'The recalls')).toBe('That page reference is stale — go back to the first page.');
  });

  test('the report: the XLSX cap points at the CSV; a busy server says try again', () => {
    expect(recallReportReason(problem('report-too-large', 422), 'xlsx')).toContain('Download the CSV instead');
    expect(reportNeedsCsv(problem('report-too-large', 422))).toBe(true);
    expect(recallReportReason(problem('report-unavailable', 503), 'csv')).toBe(
      'A recall report is already being prepared, or the server is busy — try again in a few seconds.',
    );
    expect(recallReportReason(new Error('offline'), 'csv')).toBe(UNREACHABLE_REASON);
  });

  test('the file name: the code, MOCK for a drill, the IST date', () => {
    // 20:00 UTC on the 27th is the 28th in IST.
    const now = Date.parse('2026-10-27T20:00:00.000Z');
    expect(recallReportFilename({ code: 'RCL-000001', mode: 'live', format: 'csv', now })).toBe('recall-RCL-000001-2026-10-28.csv');
    expect(recallReportFilename({ code: 'RCL-000002', mode: 'mock', format: 'xlsx', now })).toBe('recall-RCL-000002-mock-2026-10-28.xlsx');
  });
});
