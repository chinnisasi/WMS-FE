import { describe, expect, test } from 'bun:test';

import type { BinResponse, BlockBinDto } from '@/lib/api/generated';
import { ApiProblem } from '@/lib/api/client';
import {
  BIN_BLOCK_REASONS,
  BIN_BLOCK_REASON_LABEL,
  binBlockByline,
  binBlockImpactClientLine,
  binBlockImpactReason,
  binBlockImpactSentence,
  binBlockOutcome,
  binBlockReason,
  binBlockReasonWord,
  binBlockStale,
  binBlockedLabel,
  binMatchesStatus,
  parseBinBlockDraft,
  parseBinUnblockDraft,
  stockRowBinBlocked,
} from './bin-block';

const BIN: BinResponse = {
  id: 'b1',
  code: 'A-01',
  zoneId: 'z',
  zoneCode: 'A',
  capacity: 10,
  type: 'shelf',
  blocked: true,
  blockedReason: 'damaged',
  blockedNote: 'Rack upright bent',
  blockedAt: '2026-10-26T08:35:00.000Z',
  blockedBy: 'u-9',
  blockedByName: 'ravi',
  systemOwned: false,
  retiredAt: null,
} as unknown as BinResponse;

describe('the bin block vocabulary (story 3-3b)', () => {
  test("the server's seven reasons, in its order — both ways against the generated union", () => {
    expect(BIN_BLOCK_REASONS).toEqual(['damaged', 'maintenance', 'contamination', 'temperature-excursion', 'safety-hazard', 'investigation', 'other']);
    const generated: readonly BlockBinDto['reason'][] = BIN_BLOCK_REASONS;
    expect(generated).toHaveLength(7);
    expect(BIN_BLOCK_REASON_LABEL.other).toBe('Other (say what in the note)');
  });

  test('a reason in a sentence; null and an unknown reason read safely', () => {
    expect(binBlockReasonWord('temperature-excursion')).toBe('temperature excursion');
    expect(binBlockReasonWord(null)).toBe('no reason');
    expect(binBlockReasonWord('invented-later')).toBe('invented-later');
    expect(binBlockReasonWord('toString')).toBe('toString');
  });
});

describe('the status line', () => {
  test('"Blocked — damaged", and the byline: the note, who, when (IST)', () => {
    expect(binBlockedLabel(BIN)).toBe('Blocked — damaged');
    expect(binBlockByline(BIN)).toBe('Rack upright bent · by ravi · 26 Oct 2026, 14:05 IST');
  });

  test('a backfilled block names no blocker; an active bin has no byline; an older response reads as no facts', () => {
    expect(binBlockByline({ ...BIN, blockedReason: 'other', blockedByName: null })).toBe('Rack upright bent · 26 Oct 2026, 14:05 IST');
    expect(binBlockByline({ ...BIN, blocked: false })).toBeNull();
    expect(binBlockByline({ blocked: true })).toBeNull();
    expect(binBlockedLabel({ blocked: true })).toBe('Blocked — no reason');
  });
});

describe('the Status filter', () => {
  test('Active and Blocked are live bins only; Active keeps system bins; All is everything', () => {
    const live = { blocked: false, retiredAt: null };
    const blocked = { blocked: true, retiredAt: null };
    const retired = { blocked: false, retiredAt: '2026-10-01T00:00:00.000Z' };
    expect([live, blocked, retired].map((b) => binMatchesStatus(b, 'all'))).toEqual([true, true, true]);
    expect([live, blocked, retired].map((b) => binMatchesStatus(b, 'active'))).toEqual([true, false, false]);
    expect([live, blocked, retired].map((b) => binMatchesStatus(b, 'blocked'))).toEqual([false, true, false]);
  });
});

describe('the drafts', () => {
  test('a block needs a reason; Other needs a note; a blank note is dropped; the note is trimmed and capped at 500 code points', () => {
    expect(parseBinBlockDraft({ reason: '', note: 'x' })).toEqual({ kind: 'refused', problem: 'Pick a reason for the block.' });
    expect(parseBinBlockDraft({ reason: 'other', note: '   ' })).toEqual({ kind: 'refused', problem: 'Say why in the note — the reason is Other.' });
    expect(parseBinBlockDraft({ reason: 'damaged', note: '  ' })).toEqual({ kind: 'ok', body: { reason: 'damaged' } });
    expect(parseBinBlockDraft({ reason: 'other', note: '  pest  ' })).toEqual({ kind: 'ok', body: { reason: 'other', note: 'pest' } });
    expect(parseBinBlockDraft({ reason: 'damaged', note: '😀'.repeat(500) }).kind).toBe('ok');
    expect(parseBinBlockDraft({ reason: 'damaged', note: 'x'.repeat(501) })).toEqual({ kind: 'refused', problem: 'The note is at most 500 characters.' });
  });

  test('an unblock always says why', () => {
    expect(parseBinUnblockDraft('  ')).toEqual({ kind: 'refused', problem: 'Say why the block is lifted — a note is required.' });
    expect(parseBinUnblockDraft(' repaired ')).toEqual({ kind: 'ok', body: { note: 'repaired' } });
    expect(parseBinUnblockDraft('x'.repeat(501)).kind).toBe('refused');
  });
});

describe('the impact preview', () => {
  const impact = { binId: 'b1', onHandUnits: 12, skuCount: 3, plannedPickLines: 2, plannedPickUnits: 5, openCountLines: 1, byClient: [] };

  test('one sentence over the three effects, singular and plural', () => {
    expect(binBlockImpactSentence(impact)).toBe(
      '12 units of 3 SKUs on hand will stop being promised; 2 planned pick stops (5 units) will need a Skip and a re-plan; 1 open count line stays open.',
    );
    expect(binBlockImpactSentence({ ...impact, onHandUnits: 1, skuCount: 1, plannedPickLines: 1, plannedPickUnits: 1, openCountLines: 2 })).toBe(
      '1 unit of 1 SKU on hand will stop being promised; 1 planned pick stop (1 unit) will need a Skip and a re-plan; 2 open count lines stay open.',
    );
    expect(binBlockImpactSentence({ ...impact, onHandUnits: 0, skuCount: 0, plannedPickLines: 0, plannedPickUnits: 0, openCountLines: 0 })).toBe(
      'Nothing is on hand in this bin; no planned pick stops; no open count lines.',
    );
  });

  test('a fractional unit figure renders as sent — never rounded', () => {
    expect(binBlockImpactSentence({ ...impact, onHandUnits: 2.5 })).toContain('2.5 units of 3 SKUs');
  });

  test("a client's share names whose stock and storefronts the block hits", () => {
    expect(binBlockImpactClientLine({ clientId: 'c', clientName: 'GlowCo', units: 8, skuCount: 2, plannedPickLines: 1 })).toBe('GlowCo — 8 units of 2 SKUs · 1 planned pick stop');
    expect(binBlockImpactClientLine({ clientId: 'c', clientName: 'GlowCo', units: 1, skuCount: 1, plannedPickLines: 0 })).toBe('GlowCo — 1 unit of 1 SKU');
  });
});

describe('the refusals', () => {
  test('each code in words; the stale pair is detected', () => {
    expect(binBlockReason(new ApiProblem('bin-already-blocked', 409, 'd'))).toBe('This bin is already blocked — refresh the bins.');
    expect(binBlockReason(new ApiProblem('bin-not-blocked', 409, 'd'))).toBe('This bin is not blocked any more — refresh the bins.');
    expect(binBlockReason(new ApiProblem('bin-retired', 409, 'd'))).toContain('retired');
    expect(binBlockReason(new ApiProblem('role-denied', 403, 'd'))).toBe('Your role cannot block or unblock bins.');
    expect(binBlockReason(new ApiProblem('idempotency-key-reuse', 422, 'd'))).toContain('already sent with different details');
    expect(binBlockReason(new ApiProblem('validation-failed', 400, 'RECEIVING is a system bin'))).toBe('RECEIVING is a system bin');
    expect(binBlockReason(new ApiProblem('mystery', 400))).toBe('Not changed (mystery).');
    expect(binBlockReason(new Error('offline'))).toContain('could not be reached');
    expect(binBlockStale(new ApiProblem('bin-already-blocked', 409))).toBe(true);
    expect(binBlockStale(new ApiProblem('bin-not-blocked', 409))).toBe(true);
    expect(binBlockStale(new ApiProblem('bin-retired', 409))).toBe(true);
    expect(binBlockStale(new ApiProblem('not-found', 404))).toBe(true);
    expect(binBlockStale(new ApiProblem('conflict', 409))).toBe(false);
    expect(binBlockImpactReason(new ApiProblem('role-denied', 403))).toBe('Your role cannot read what a block would affect.');
    expect(binBlockImpactReason(new Error('x'))).toContain('unreachable');
  });
});

describe('the outcome and the stock chip', () => {
  test('the banner speaks from the response', () => {
    expect(binBlockOutcome('block', BIN).word).toBe('A-01 blocked');
    expect(binBlockOutcome('block', BIN).reason).toContain('A-01 is blocked (damaged)');
    expect(binBlockOutcome('block', BIN).reason).toContain('Putaway, moves, transfers and merges into it are refused');
    expect(binBlockOutcome('unblock', { ...BIN, blocked: false }).word).toBe('A-01 unblocked');
  });

  test('a stock row reads binBlocked; absent (an older response) is not blocked', () => {
    expect(stockRowBinBlocked({ binBlocked: true })).toBe(true);
    expect(stockRowBinBlocked({ binBlocked: false })).toBe(false);
    expect(stockRowBinBlocked({})).toBe(false);
  });
});
