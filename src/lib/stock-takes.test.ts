import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import { moveReason } from '@/lib/moves';
import { varianceCountLabel } from '@/lib/counts';
import {
  ABANDON_CONFIRM,
  FREEZE_WARNING,
  STOCK_TAKE_STATUS_LABEL,
  cancelCountReason,
  closeConfirmSentence,
  closeNeedsOwner,
  closeOutcome,
  freezeCountLabel,
  progressLabel,
  progressPercent,
  stockTakeReason,
  stockTakeReportFilename,
  stockTakeScopeLabel,
  unpostedReasonLabel,
  varianceOutcomeLabel,
} from './stock-takes';

/** Story 3-5b — every sentence the Stock takes tab shows, pinned. */

const summary = { binCount: 40 } as never;

describe('stock takes — words', () => {
  test('status labels, scope, progress', () => {
    expect(STOCK_TAKE_STATUS_LABEL).toEqual({ counting: 'Counting', posting: 'Posting', closed: 'Closed', abandoned: 'Abandoned' });
    expect(stockTakeScopeLabel(null, [])).toBe('Whole warehouse');
    expect(stockTakeScopeLabel(['z2', 'z1'], [{ id: 'z1', code: 'A' }, { id: 'z2', code: 'B' }])).toBe('Zones A, B');
    expect(stockTakeScopeLabel(['z1'], [{ id: 'z1', code: 'A' }])).toBe('Zone A');
    expect(progressLabel(12, 40)).toBe('12 of 40 bins counted');
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(0, 0)).toBe(0);
  });

  test('the start: the freeze warning and the cap', () => {
    expect(FREEZE_WARNING).toBe('Every movement into or out of these bins is refused until the take is closed or abandoned. Sync every handheld first.');
    expect(freezeCountLabel(1)).toBe('1 bin will be frozen.');
    expect(freezeCountLabel(3001)).toBe('3001 bins — at most 3000 can be frozen in one warehouse; take fewer zones.');
  });

  test('the close: the owner rule, the confirm and the outcome', () => {
    expect(closeNeedsOwner({ overThreshold: 2 }, false)).toBe(true);
    expect(closeNeedsOwner({ overThreshold: 2 }, true)).toBe(false);
    expect(closeNeedsOwner({ overThreshold: 0 }, false)).toBe(false);
    expect(closeConfirmSentence({ totals: { openVariances: 3, overThreshold: 1 } as never, stockTake: summary })).toBe(
      'Post 3 variances (1 over the threshold) to the ledger and lift the freeze on 40 bins? A variance the adjustment rules refuse stays open on the variance queue.',
    );
    expect(ABANDON_CONFIRM).toContain('Nothing is posted');
    expect(closeOutcome({ postedCount: 2, unposted: [], stockTake: summary })).toEqual({ tone: 'accepted', word: 'Stock take closed', reason: '2 variances posted; the freeze is lifted.' });
    expect(
      closeOutcome({
        postedCount: 1,
        stockTake: summary,
        unposted: [{ varianceId: 'v', binId: 'b', binCode: 'A-04', skuId: 's', skuCode: 'LOT', code: 'validation-failed', detail: 'x', needsLotCount: true }],
      }).reason,
    ).toBe('1 variance posted; the freeze is lifted. 1 not posted — they stay on the variance queue: A-04 LOT (needs batch- or serial-level count (not yet supported)).');
    expect(unpostedReasonLabel({ code: 'basis-moved', detail: 'd', needsLotCount: false })).toBe('the bin moved after its count — recount it, then resolve it on the variance queue');
    expect(varianceOutcomeLabel({ status: 'open', unpostedCode: 'bin-retired', needsLotCount: false })).toBe('Not posted (bin-retired)');
    expect(varianceOutcomeLabel({ status: 'adjusted', unpostedCode: null, needsLotCount: false })).toBe('Posted');
  });

  test('the report file name (IST start date, the client, provisional until closed)', () => {
    expect(stockTakeReportFilename({ take: { startedAt: '2026-10-27T20:00:00.000Z', status: 'counting' }, format: 'csv', clientCode: 'GLOW', warehouseCode: 'BLR' })).toBe(
      'stock-take-BLR-2026-10-28-GLOW-provisional.csv',
    );
    expect(stockTakeReportFilename({ take: { startedAt: '2026-10-27T20:00:00.000Z', status: 'closed' }, format: 'xlsx', clientCode: null, warehouseCode: 'BLR' })).toBe('stock-take-BLR-2026-10-28.xlsx');
    expect(stockTakeReportFilename({ take: { startedAt: '2026-10-27T20:00:00.000Z', status: 'abandoned' }, format: 'csv', clientCode: null, warehouseCode: 'BLR' })).toBe('stock-take-BLR-2026-10-28-abandoned.csv');
    expect(varianceCountLabel({ status: 'cancelled', varianceCount: 0, openVarianceCount: 0 })).toBe('—');
  });

  test('refusals: four codes verbatim; the rest mapped', () => {
    const p = (code: string, detail: string) => new ApiProblem(code, 409, detail, 'Title');
    for (const code of ['stock-take-recount-required', 'stock-take-incomplete', 'bin-frozen', 'variance-owner-required']) {
      expect(stockTakeReason(p(code, 'the server words'), 'close')).toBe('Title — the server words');
    }
    expect(stockTakeReason(p('stock-take-changed', 'x'), 'close')).toBe('The variances changed since you reviewed them — refresh, review them again, then post.');
    expect(stockTakeReason(p('stock-take-not-counting', 'x'), 'abandon')).toBe('This stock take is no longer counting — refresh it.');
    expect(cancelCountReason(p('stock-take-task', 'x'))).toBe('This count belongs to a stock take — abandon the take instead.');
    // The move form shows the freeze verbatim too.
    expect(moveReason(new ApiProblem('bin-frozen', 409, 'Bin "A-01" is frozen for stock take T.', 'The bin is frozen for a stock take'))).toBe(
      'The bin is frozen for a stock take — Bin "A-01" is frozen for stock take T.',
    );
  });
});
