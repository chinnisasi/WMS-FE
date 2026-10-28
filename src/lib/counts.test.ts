import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import type { BinResponse, ZoneResponse } from './api/generated';
import {
  plannerNames,
  zoneTooLarge,
  ZONE_TOO_LARGE_NOTE,
  COUNT_SKIP_REASON_LABEL,
  COUNT_TASK_ORIGIN_LABEL,
  COUNT_TASK_STATUS_LABEL,
  MAX_COUNT_BINS,
  VARIANCE_QUEUE_HREF,
  countDetailReason,
  countPolicyReason,
  countTasksEmptyMessage,
  countableBins,
  countableZones,
  createCountsOutcome,
  createCountsReason,
  createdByLabel,
  intervalLabel,
  parseIntervalDays,
  policyRemovedSentence,
  policySavedSentence,
  tooManyBinsNote,
  varianceCountLabel,
} from './counts';
import { UNREACHABLE_REASON } from './outbound-orders';

function problem(code: string, status = 400, detail?: string): ApiProblem {
  return new ApiProblem(code, status, detail ?? `server says ${code}`);
}

function bin(id: string, code: string, zoneId: string, patch: Partial<BinResponse> = {}): BinResponse {
  return {
    id,
    tenantId: 't',
    warehouseId: 'w',
    zoneId,
    code,
    capacity: 100,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    maxWeightGrams: null,
    storageClass: 'ambient',
    dedicatedClientId: null,
    type: 'shelf',
    blocked: false,
    retiredAt: null,
    retiredBy: null,
    systemOwned: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...patch,
  } as BinResponse;
}

function zone(id: string, code: string): ZoneResponse {
  return { id, tenantId: 't', warehouseId: 'w', code, name: `Zone ${code}`, createdAt: '2026-10-01T00:00:00.000Z' };
}

describe('counts — labels', () => {
  test('status, origin and skip-reason words', () => {
    expect(COUNT_TASK_STATUS_LABEL).toEqual({ pending: 'Pending', completed: 'Counted', cancelled: 'Cancelled' });
    expect(COUNT_TASK_ORIGIN_LABEL).toEqual({ on_demand: 'On demand', scheduled: 'Scheduled', recount: 'Recount' });
    expect(COUNT_SKIP_REASON_LABEL).toEqual({
      'count-task-open': 'already has an open count',
      'system-bin': 'a system bin — not countable',
      'bin-retired': 'retired',
      'stock-take': 'in a stock take',
    });
    expect(VARIANCE_QUEUE_HREF).toBe('/conflicts?queue=variances');
  });

  test('the empty list names its filters', () => {
    expect(countTasksEmptyMessage(null, null)).toBe('No counts in this warehouse yet.');
    expect(countTasksEmptyMessage('pending', null)).toBe('No pending counts in this warehouse.');
    expect(countTasksEmptyMessage('completed', 'recount')).toBe('No counted recount counts in this warehouse.');
  });

  test('the variance cell: — while pending, None, a count with its open share', () => {
    expect(varianceCountLabel({ status: 'pending', varianceCount: 0, openVarianceCount: 0 })).toBe('—');
    expect(varianceCountLabel({ status: 'completed', varianceCount: 0, openVarianceCount: 0 })).toBe('None');
    expect(varianceCountLabel({ status: 'completed', varianceCount: 2, openVarianceCount: 1 })).toBe('2 (1 open)');
    expect(varianceCountLabel({ status: 'completed', varianceCount: 2, openVarianceCount: 0 })).toBe('2');
  });

  test('who planned it: the system, you, or the id tail', () => {
    expect(createdByLabel(null, 'u1', null)).toBe('System');
    expect(createdByLabel('u1', 'u1', null)).toBe('You');
    expect(createdByLabel('0198f7a2-1b3c-7d4e-8f90-112233445566', 'u1', null)).toBe('User …33445566');
  });

  test('the schedule words and the interval parse', () => {
    expect(intervalLabel(1)).toBe('Every day');
    expect(intervalLabel(30)).toBe('Every 30 days');
    expect(parseIntervalDays(' 7 ')).toBe(7);
    for (const bad of ['', '0', '3651', '1.5', '-2', 'abc']) expect(parseIntervalDays(bad)).toBeNull();
    expect(parseIntervalDays('3650')).toBe(3650);
    expect(policySavedSentence('b', 7)).toBe('Class B is counted every 7 days.');
    expect(policyRemovedSentence('b')).toBe('Class B is no longer scheduled — its open counts stay.');
  });
});

describe('counts — bins and zones', () => {
  const bins = [
    bin('b2', 'A-02', 'za'),
    bin('b1', 'A-01', 'za'),
    bin('b3', 'A-03', 'za', { retiredAt: '2026-10-02T00:00:00.000Z' }),
    bin('s1', 'IN-TRANSIT', 'zs', { systemOwned: true }),
    bin('r1', 'R-01', 'zr', { retiredAt: '2026-10-02T00:00:00.000Z' }),
  ];

  test('countable bins drop system and retired bins, sorted by code', () => {
    expect(countableBins(bins).map((b) => b.code)).toEqual(['A-01', 'A-02']);
  });

  test('a zone is offered only with a countable bin — a system zone never is', () => {
    const offered = countableZones([zone('zs', 'IN-TRANSIT'), zone('zr', 'R'), zone('za', 'A'), zone('ze', 'EMPTY')], bins);
    expect(offered.map((z) => [z.zone.code, z.binCount])).toEqual([['A', 2]]);
  });

  test('the client-side cap', () => {
    expect(tooManyBinsNote(MAX_COUNT_BINS)).toBeNull();
    expect(tooManyBinsNote(MAX_COUNT_BINS + 1)).toBe('At most 500 bins per request — 501 selected. Split the selection.');
  });
});

describe('counts — outcomes and refusals', () => {
  test('the bulk outcome reads the response: created, not pushed, skipped with reasons', () => {
    expect(
      createCountsOutcome({
        created: [
          { taskId: 't1', binId: 'b1', binCode: 'A-01', lineCount: 1 },
          { taskId: 't2', binId: 'b2', binCode: 'A-02', lineCount: 0 },
        ],
        skipped: [{ binId: 'b3', binCode: 'A-03', reason: 'count-task-open' }],
      }),
    ).toEqual({
      tone: 'accepted',
      word: '2 counts created',
      reason:
        "They are on the handhelds' Count list at the next refresh — no notification is sent for a bulk create. Skipped 1: A-03 (already has an open count).",
    });
    expect(createCountsOutcome({ created: [{ taskId: 't1', binId: 'b1', binCode: 'A-01', lineCount: 1 }], skipped: [] }).word).toBe('1 count created');
  });

  test('an all-skipped answer is not a success, and long skip lists are capped at five names', () => {
    const skipped = Array.from({ length: 7 }, (_, i) => ({ binId: `b${i}`, binCode: `A-0${i}`, reason: 'count-task-open' as const }));
    const outcome = createCountsOutcome({ created: [], skipped });
    expect(outcome.tone).toBe('rejected');
    expect(outcome.word).toBe('No counts created');
    expect(outcome.reason).toBe(
      'Every bin was skipped. Skipped 7: A-00 (already has an open count), A-01 (already has an open count), A-02 (already has an open count), A-03 (already has an open count), A-04 (already has an open count), …and 2 more.',
    );
  });

  test('the create refusal branches on the code', () => {
    expect(createCountsReason(problem('too-many-bins', 422))).toBe('At most 500 bins per request — split the selection.');
    expect(createCountsReason(problem('role-denied', 403))).toBe('Your role cannot plan counts.');
    expect(createCountsReason(problem('not-found', 404))).toBe('A bin or the zone no longer exists — reload the bins and choose again.');
    expect(createCountsReason(problem('validation-failed', 400, 'binIds must not repeat a bin'))).toBe('binIds must not repeat a bin');
    expect(createCountsReason(problem('idempotency-key-reuse', 422))).toBe('This request was already sent with different values — reload and try again.');
    expect(createCountsReason(new TypeError('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });

  test('the schedule refusals, per action', () => {
    expect(countPolicyReason(problem('role-denied', 403), 'save')).toBe('Your role cannot change the count schedule.');
    expect(countPolicyReason(problem('not-found', 404), 'remove')).toBe('That class is no longer scheduled — reload the schedule.');
    expect(countPolicyReason(problem('not-found', 404), 'save')).toBe('This warehouse no longer exists — reload the page.');
    expect(countPolicyReason(new TypeError('x'), 'remove')).toBe(UNREACHABLE_REASON);
  });

  test('the detail read failure', () => {
    expect(countDetailReason(problem('not-found', 404))).toBe('This count no longer exists — refresh the list.');
    expect(countDetailReason(problem('unauthenticated', 401))).toBe('Your session expired — sign in again.');
  });
});

describe('3-5a review fixes', () => {
  test('a zone is too large above 500 countable bins (the server answers 422 past it)', () => {
    expect(zoneTooLarge(500)).toBe(false);
    expect(zoneTooLarge(501)).toBe(true);
    expect(ZONE_TOO_LARGE_NOTE).toBe('Zones with more than 500 countable bins cannot be counted whole — choose their bins instead.');
  });

  test('plannerNames maps the user list to emails; no list yet is null', () => {
    expect(plannerNames(null)).toBeNull();
    expect(plannerNames({ 'u-9': { email: 'ravi@example.com' } })).toEqual({ 'u-9': 'ravi@example.com' });
  });
});
