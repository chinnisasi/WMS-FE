import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { PicklistDto, PicklistLineDto, WaveDto, WavePolicyDto } from '@/lib/api/generated';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import {
  AT_RISK_THRESHOLD_MINUTES,
  MAX_POLICY_NAME_LENGTH,
  MAX_POLICY_ORDERS,
  MAX_POLICY_PRIORITY,
  WAVE_STATUSES,
  canCancelWave,
  canReleaseWave,
  cancelWaveOutcome,
  cancelWaveReason,
  cancelWaveWarning,
  cutoffConfiguredLabel,
  cutoffLabel,
  cutoffStatus,
  generateOutcome,
  generateReason,
  isWaveAtRisk,
  minutesRemainingLabel,
  parsePolicyDraft,
  pickLineQuantityLabel,
  pickLineStatusLabel,
  pickReasonLabel,
  picklistLabel,
  policyOutcome,
  policyReason,
  releaseOutcome,
  releaseReason,
  policySummary,
  stopBinLabel,
  waveStatusLabel,
  waveDetailReason,
  waveTotals,
  waveTotalsLabel,
  type PolicyDraft,
} from '@/lib/outbound-waves';

/**
 * The Outbound waves surface's pure decisions (story 4.2c).
 *
 * The carrier-cutoff derivation is the reason this file is long. The backend
 * exposes no at-risk flag and no time-remaining field, so the browser derives
 * both — and a cutoff derivation is wrong in ways nobody notices until a
 * cutoff is missed. `cutoffStatus` therefore takes an injected `now`, which is
 * what lets these tests pin "18:00 Asia/Kolkata" from a machine in any
 * timezone, across a DST transition, and at the midnight rollover.
 */

const KOLKATA: Pick<WavePolicyDto, 'cutoffLocalTime' | 'cutoffTimezone'> = {
  cutoffLocalTime: '18:00',
  cutoffTimezone: 'Asia/Kolkata',
};

/** Asia/Kolkata is UTC+05:30 year round — no DST, which is the point of it. */
function kolkata(hhmmss: string): Date {
  return new Date(`2026-09-16T${hhmmss}+05:30`);
}

describe('cutoffStatus: the wall clock in the policy’s own zone', () => {
  test('a cutoff hours away is ahead, with the minutes counted', () => {
    // 12:00 IST against an 18:00 cutoff — six hours.
    const status = cutoffStatus(KOLKATA, kolkata('12:00:00'));
    expect(status.kind).toBe('ahead');
    expect(status.kind === 'ahead' && status.minutesRemaining).toBe(360);
  });

  test('inside the threshold it is at-risk, with the minutes remaining', () => {
    const status = cutoffStatus(KOLKATA, kolkata('17:18:00'));
    expect(status.kind).toBe('at-risk');
    expect(status.kind === 'at-risk' && status.minutesRemaining).toBe(42);
  });

  test('a cutoff already gone by for the local day reads passed, never negative', () => {
    // The midnight-rollover case: minutes remaining would be -359 here, and a
    // naive derivation would either show that or wrap to tomorrow's cutoff.
    // The backend refuses release once the cutoff has passed for the LOCAL
    // DAY, so "passed" is the only honest reading.
    expect(cutoffStatus(KOLKATA, kolkata('23:59:00')).kind).toBe('passed');
    expect(cutoffStatus(KOLKATA, kolkata('18:00:00')).kind).toBe('passed');
  });

  test('just after the local midnight the whole day is ahead again', () => {
    const status = cutoffStatus(KOLKATA, kolkata('00:01:00'));
    expect(status.kind).toBe('ahead');
    // 18:00 − 00:01 = 17 h 59 m.
    expect(status.kind === 'ahead' && status.minutesRemaining).toBe(1079);
  });

  test('the same instant reads differently in two zones — the zone is what is compared', () => {
    // 17:30 IST is 12:00 UTC. Against an 18:00 cutoff the Kolkata policy is
    // at-risk; a UTC policy with the same wall clock still has six hours.
    const noon = kolkata('17:30:00');
    expect(cutoffStatus(KOLKATA, noon).kind).toBe('at-risk');
    expect(cutoffStatus({ cutoffLocalTime: '18:00', cutoffTimezone: 'UTC' }, noon).kind).toBe(
      'ahead',
    );
  });
});

describe('cutoffStatus: the threshold boundary', () => {
  const policy = KOLKATA;

  test('exactly the threshold away lights amber', () => {
    const status = cutoffStatus(policy, kolkata('17:00:00'));
    expect(status.kind).toBe('at-risk');
    expect(status.kind === 'at-risk' && status.minutesRemaining).toBe(AT_RISK_THRESHOLD_MINUTES);
  });

  test('one second more than the threshold does not', () => {
    // The boundary is compared at second resolution precisely so this case is
    // decidable: floored minutes alone would read 60 here too.
    expect(cutoffStatus(policy, kolkata('16:59:59')).kind).toBe('ahead');
  });

  test('the constant is what moves the boundary, not a literal in a component', () => {
    // Retuning the window is a one-line change; this pins that the derivation
    // actually reads the constant.
    const justInside = kolkata('18:00:00').getTime() - AT_RISK_THRESHOLD_MINUTES * 60_000;
    expect(cutoffStatus(policy, new Date(justInside)).kind).toBe('at-risk');
    const justOutside = justInside - 1_000;
    expect(cutoffStatus(policy, new Date(justOutside)).kind).toBe('ahead');
  });

  test('the last minute before the cutoff still counts down', () => {
    const status = cutoffStatus(policy, kolkata('17:59:30'));
    expect(status.kind).toBe('at-risk');
    // Floored, never rounded up: 30 seconds left is not "one minute left".
    expect(status.kind === 'at-risk' && status.minutesRemaining).toBe(0);
  });
});

describe('cutoffStatus: DST', () => {
  // America/New_York is UTC−4 in September and UTC−5 in December. Comparing
  // wall clock to wall clock inside one local day is what makes the shift a
  // non-event; UTC arithmetic against a fixed offset would be an hour out for
  // half the year.
  const ny: Pick<WavePolicyDto, 'cutoffLocalTime' | 'cutoffTimezone'> = {
    cutoffLocalTime: '17:00',
    cutoffTimezone: 'America/New_York',
  };

  test('inside daylight time, 16:30 local is at-risk', () => {
    expect(cutoffStatus(ny, new Date('2026-09-16T20:30:00Z')).kind).toBe('at-risk');
  });

  test('outside daylight time, the SAME UTC instant is an hour earlier locally', () => {
    // 20:30Z is 15:30 EST — 90 minutes out, beyond the threshold.
    const status = cutoffStatus(ny, new Date('2026-12-16T20:30:00Z'));
    expect(status.kind).toBe('ahead');
    expect(status.kind === 'ahead' && status.minutesRemaining).toBe(90);
  });

  test('on the spring-forward day, 02:30 local never happens and 03:30 is still ahead', () => {
    // 2026-03-08 07:30Z is 03:30 EDT — the hour after the jump.
    const status = cutoffStatus(ny, new Date('2026-03-08T07:30:00Z'));
    expect(status.kind).toBe('ahead');
    // 17:00 − 03:30 = 13 h 30 m.
    expect(status.kind === 'ahead' && status.minutesRemaining).toBe(810);
  });

  test('on the fall-back day, the repeated hour reads its own wall clock both times', () => {
    // 2026-11-01: 05:30Z is 01:30 EDT, 06:30Z is 01:30 EST — the same wall
    // clock twice, and both are the same distance from a 17:00 cutoff.
    const first = cutoffStatus(ny, new Date('2026-11-01T05:30:00Z'));
    const second = cutoffStatus(ny, new Date('2026-11-01T06:30:00Z'));
    expect(first).toEqual(second);
    expect(first.kind === 'ahead' && first.minutesRemaining).toBe(930);
  });
});

describe('cutoffStatus: nothing to derive', () => {
  test('a policy with no cutoff has no amber and no countdown', () => {
    expect(cutoffStatus({ cutoffLocalTime: null, cutoffTimezone: 'Asia/Kolkata' }, new Date()).kind)
      .toBe('none');
  });

  test('an unreadable wall clock is UNREADABLE, not none — a cutoff still exists', () => {
    for (const bad of ['6pm', '18:60', '25:00', '', '18:0']) {
      expect(cutoffStatus({ cutoffLocalTime: bad, cutoffTimezone: 'Asia/Kolkata' }, new Date()).kind)
        .toBe('unreadable');
    }
  });

  test('a zone this runtime does not know is unreadable, not the browser’s own zone', () => {
    expect(
      cutoffStatus({ cutoffLocalTime: '18:00', cutoffTimezone: 'Mars/Olympus' }, new Date()).kind,
    ).toBe('unreadable');
  });

  test('the COPY keeps the two apart — this is the lie the split exists to stop', () => {
    // Collapsing them told a viewer "No cutoff" — release whenever — about a
    // policy the server refuses at 18:01.
    const unplaceable = { cutoffLocalTime: '18:00', cutoffTimezone: 'Mars/Olympus' };
    const label = cutoffLabel(unplaceable, cutoffStatus(unplaceable, new Date()));
    expect(label).not.toBe('No cutoff');
    expect(label).toContain('Cutoff 18:00 Mars/Olympus');
    expect(label).toContain('standing unknown in this browser');
    expect(label).toContain('the server decides');

    const unparseable = { cutoffLocalTime: '6pm', cutoffTimezone: 'Asia/Kolkata' };
    expect(cutoffLabel(unparseable, cutoffStatus(unparseable, new Date()))).toContain('6pm');
  });
});

describe('the cutoff copy', () => {
  test('the amber chip says the minutes, plural-aware', () => {
    expect(minutesRemainingLabel(42)).toBe('42 minutes left');
    expect(minutesRemainingLabel(1)).toBe('1 minute left');
    expect(minutesRemainingLabel(0)).toBe('under a minute left');
  });

  test('the row line names the wall clock AND the zone it is compared in', () => {
    // Without the zone, a viewer elsewhere reads "18:00" as their own evening.
    expect(cutoffLabel(KOLKATA, cutoffStatus(KOLKATA, kolkata('17:18:00')))).toBe(
      'Cutoff 18:00 Asia/Kolkata — 42 minutes left',
    );
  });

  test('a passed cutoff names whose clock said so; it does not count down to tomorrow', () => {
    expect(cutoffLabel(KOLKATA, cutoffStatus(KOLKATA, kolkata('19:00:00')))).toBe(
      "Cutoff 18:00 Asia/Kolkata — passed by this browser's clock; the server decides",
    );
  });

  test('the cutoff MINUTE itself is not claimed as settled — the server still accepts it', () => {
    // wms-be compares whole `HH:MM` strings (`nowLocal > cutoff`), so a
    // release at 18:00:30 is still allowed while this derivation, counting
    // seconds, already reads the cutoff as gone. The copy may not overstate.
    const label = cutoffLabel(KOLKATA, cutoffStatus(KOLKATA, kolkata('18:00:30')));
    expect(label).toContain("passed by this browser's clock");
    expect(label).toContain('the server decides');
    expect(label).not.toBe('Cutoff 18:00 Asia/Kolkata — passed');
  });

  test('a released or cancelled row shows the cutoff with no standing attached', () => {
    expect(cutoffConfiguredLabel(KOLKATA)).toBe('Cutoff 18:00 Asia/Kolkata');
    expect(cutoffConfiguredLabel({ cutoffLocalTime: null, cutoffTimezone: 'UTC' })).toBe('No cutoff');
  });

  test('no cutoff reads as no cutoff', () => {
    const none = { cutoffLocalTime: null, cutoffTimezone: 'Asia/Kolkata' };
    expect(cutoffLabel(none, cutoffStatus(none, new Date()))).toBe('No cutoff');
  });
});

describe('isWaveAtRisk: amber is for planned waves only', () => {
  const atRisk = cutoffStatus(KOLKATA, kolkata('17:30:00'));

  test('a planned wave inside the threshold lights amber', () => {
    expect(isWaveAtRisk('planned', atRisk)).toBe(true);
  });

  test('a released wave never does — it already made it', () => {
    expect(isWaveAtRisk('released', atRisk)).toBe(false);
  });

  test('a cancelled wave never does — it is not going anywhere', () => {
    expect(isWaveAtRisk('cancelled', atRisk)).toBe(false);
  });

  test('a planned wave outside the threshold, passed, or with no cutoff does not', () => {
    expect(isWaveAtRisk('planned', cutoffStatus(KOLKATA, kolkata('10:00:00')))).toBe(false);
    expect(isWaveAtRisk('planned', cutoffStatus(KOLKATA, kolkata('20:00:00')))).toBe(false);
    expect(
      isWaveAtRisk('planned', cutoffStatus({ cutoffLocalTime: null, cutoffTimezone: 'UTC' }, new Date())),
    ).toBe(false);
  });
});

describe('the affordance gates', () => {
  test('release is offered on a planned wave', () => {
    expect(canReleaseWave('planned')).toBe(true);
  });

  test('release is NOT offered on a cancelled wave — the one refusal the row can predict', () => {
    expect(canReleaseWave('cancelled')).toBe(false);
  });

  test('release is not offered on an already-released wave either', () => {
    expect(canReleaseWave('released')).toBe(false);
  });

  test('cancel is offered on every visible wave — it has no predictable refusal', () => {
    // Deliberately status-free: there is no arm of the lifecycle that makes
    // cancel predictably refusable, so the gate takes nothing to branch on.
    expect(canCancelWave()).toBe(true);
  });

  test('every lifecycle arm has a label', () => {
    expect(WAVE_STATUSES).toEqual(['planned', 'released', 'cancelled']);
    for (const status of WAVE_STATUSES) {
      expect(waveStatusLabel(status)).not.toBe('');
    }
  });
});

/* ------------------------------------------------------------------ */

function line(overrides: Partial<PicklistLineDto> = {}): PicklistLineDto {
  return {
    id: 'l-1',
    picklistId: 'p-1',
    orderId: 'o-1',
    orderLineId: 'ol-1',
    skuId: 'sku-1',
    binId: 'bin-1',
    binCode: 'A-01-01',
    batchId: null,
    reservationId: 'r-1',
    qty: 4,
    shortfallQty: 0,
    reasonCode: null,
    sliceSeq: 0,
    walkSeq: 0,
    status: 'planned',
    createdAt: '2026-09-16T06:00:00.000Z',
    ...overrides,
  };
}

function picklist(overrides: Partial<PicklistDto> = {}): PicklistDto {
  return {
    id: 'p-1',
    waveId: 'w-1',
    orderId: 'o-1',
    status: 'planned',
    stopCount: 2,
    createdAt: '2026-09-16T06:00:00.000Z',
    updatedAt: '2026-09-16T06:00:00.000Z',
    lines: [line(), line({ id: 'l-2', walkSeq: 1, binCode: 'A-01-02', qty: 3 })],
    ...overrides,
  };
}

describe('the picklist and stop copy', () => {
  test('totals add across every picklist on the wave', () => {
    const totals = waveTotals([
      picklist(),
      picklist({
        id: 'p-2',
        orderId: 'o-2',
        stopCount: 1,
        lines: [line({ id: 'l-3', orderId: 'o-2', qty: 5 })],
      }),
    ]);
    expect(totals).toEqual({
      orders: 2,
      picklists: 2,
      stops: 3,
      lines: 3,
      qty: 12,
      shortfallQty: 0,
      unfulfillableLines: 0,
    });
  });

  test('a batch picklist’s orders are counted off its LINES, not its null orderId', () => {
    // `picklistCount` is the order count only under a `single` policy; one
    // batch picklist serves many orders, and the row that says "3 orders"
    // must not silently become "1 order" when a policy switches to batch.
    const batch = picklist({
      orderId: null,
      stopCount: 3,
      lines: [
        line({ id: 'b-1', orderId: 'o-1' }),
        line({ id: 'b-2', orderId: 'o-2' }),
        line({ id: 'b-3', orderId: 'o-3' }),
      ],
    });
    expect(waveTotals([batch]).orders).toBe(3);
    expect(waveTotals([batch]).picklists).toBe(1);
  });

  test('the summary states the walk without an uncovered clause when nothing is uncovered', () => {
    expect(waveTotalsLabel(waveTotals([picklist()]))).toBe(
      '1 order · 1 picklist · 2 stops · 2 lines · 7 units to pick',
    );
  });

  test('uncovered units are named — this is what an Ops Manager reads before releasing', () => {
    const uncovered = picklist({
      stopCount: 1,
      lines: [
        line({ qty: 4 }),
        line({ id: 'l-2', status: 'unfulfillable', binId: null, binCode: null, qty: 0, shortfallQty: 3 }),
      ],
    });
    expect(waveTotalsLabel(waveTotals([uncovered]))).toBe(
      '1 order · 1 picklist · 1 stop · 2 lines · 4 units to pick · 3 units uncovered · 1 line with nothing to pick',
    );
  });

  test('each uncovered clause is emitted on its OWN count', () => {
    // A story-4.4 short line carries uncovered units without being
    // unfulfillable, which used to read "3 units uncovered across 0 lines
    // with nothing to pick".
    const shortOnly = picklist({
      stopCount: 1,
      lines: [line({ qty: 4, shortfallQty: 3, status: 'short', reasonCode: 'bin-empty' })],
    });
    const label = waveTotalsLabel(waveTotals([shortOnly]));
    expect(label).toContain('3 units uncovered');
    expect(label).not.toContain('nothing to pick');
  });

  test('a batch picklist names itself as one; a single-order one names its order', () => {
    expect(picklistLabel(picklist({ orderId: null }))).toBe('Batch picklist · 2 stops · 2 lines');
    expect(picklistLabel(picklist())).toBe('Order o-1 · 2 stops · 2 lines');
  });

  test('a stop states its quantity, and its uncovered units when it has them', () => {
    expect(pickLineQuantityLabel(line())).toBe('4 units to pick');
    expect(pickLineQuantityLabel(line({ qty: 4, shortfallQty: 2 }))).toBe('4 units to pick · 2 units uncovered');
  });

  test('a stop whose SKU resolves names its unit at the unit\'s declared precision', () => {
    // Story 10.5: a batch walk mixes units, so each row names its own —
    // a kg stop renders 2.500 kg, an each stop grows no decimal suffix.
    const kg = { uom: 'kg', uomPrecision: 3 };
    expect(pickLineQuantityLabel(line({ qty: 2.5 }), kg)).toBe('2.500 kg to pick');
    expect(pickLineQuantityLabel(line({ qty: 2.5, shortfallQty: 0.5 }), kg)).toBe(
      '2.500 kg to pick · 0.500 kg uncovered',
    );
    expect(pickLineQuantityLabel(line({ qty: 4 }), { uom: 'each', uomPrecision: 0 })).toBe(
      '4 each to pick',
    );
    // An unresolvable SKU keeps the unit-agnostic fallback, never a guessed precision.
    expect(pickLineQuantityLabel(line({ qty: 2.5 }), null)).toBe('2.5 units to pick');
  });

  test('a wave whose stops share one unit renders its totals at that unit', () => {
    const kg = { uom: 'kg', uomPrecision: 3 };
    expect(waveTotalsLabel(waveTotals([picklist({ lines: [line({ qty: 2.5 })] })]), kg)).toBe(
      '1 order · 1 picklist · 2 stops · 1 line · 2.500 kg to pick',
    );
    const uncovered = picklist({
      stopCount: 1,
      lines: [
        line({ qty: 4 }),
        line({ id: 'l-2', status: 'unfulfillable', binId: null, binCode: null, qty: 0, shortfallQty: 3 }),
      ],
    });
    expect(waveTotalsLabel(waveTotals([uncovered]), kg)).toBe(
      '1 order · 1 picklist · 1 stop · 2 lines · 4.000 kg to pick · 3.000 kg uncovered · 1 line with nothing to pick',
    );
  });

  test('an unfulfillable slice has no bin and says so rather than rendering null', () => {
    expect(stopBinLabel(line())).toBe('A-01-01');
    expect(stopBinLabel(line({ binCode: null }))).toBe('—');
  });

  test('every pick-line arm reads in plain words, including the two that are not failures', () => {
    expect(pickLineStatusLabel('unfulfillable')).toBe('Nothing to pick');
    expect(pickLineStatusLabel('short')).toBe('Short');
    expect(pickLineStatusLabel('picked')).toBe('Picked');
  });

  test('a short-pick reason reads in words; an unrecognised one falls back to itself', () => {
    expect(pickReasonLabel(null)).toBeNull();
    expect(pickReasonLabel('bin-empty')).toBe('Bin empty');
    expect(pickReasonLabel('invented-later')).toBe('invented-later');
  });
});

describe('the policy summary', () => {
  const policy: WavePolicyDto = {
    id: 'wp-1',
    tenantId: 't-1',
    warehouseId: 'wh-1',
    name: 'Evening courier',
    grouping: 'batch',
    priority: 10,
    maxOrders: 50,
    cutoffLocalTime: '18:00',
    cutoffTimezone: 'Asia/Kolkata',
    carrierRef: null,
    createdAt: '2026-09-16T06:00:00.000Z',
    updatedAt: '2026-09-16T06:00:00.000Z',
  };

  test('the rule reads as words, not enum values', () => {
    expect(policySummary(policy)).toBe(
      'One picklist across the wave · priority 10 · up to 50 orders · cutoff 18:00 Asia/Kolkata',
    );
  });

  test('a null cap is named as the server’s, never invented as a number', () => {
    // The default lives in the backend; restating it here would be a guess
    // that goes stale silently.
    expect(policySummary({ ...policy, grouping: 'single', maxOrders: null, cutoffLocalTime: null })).toBe(
      'One picklist per order · priority 10 · server default cap · no cutoff',
    );
  });
});

describe('the policy draft parse', () => {
  const draft: PolicyDraft = {
    name: 'Evening courier',
    grouping: 'batch',
    priority: '',
    maxOrders: '',
    cutoffLocalTime: '',
  };

  test('a blank optional field is dropped, never sent as an empty string', () => {
    expect(parsePolicyDraft(draft)).toEqual({
      body: { name: 'Evening courier', grouping: 'batch' },
      problem: null,
    });
  });

  test('the optionals are carried when they are filled', () => {
    expect(
      parsePolicyDraft({ ...draft, priority: '10', maxOrders: '50', cutoffLocalTime: '18:00' }).body,
    ).toEqual({
      name: 'Evening courier',
      grouping: 'batch',
      priority: 10,
      maxOrders: 50,
      cutoffLocalTime: '18:00',
    });
  });

  test('a nameless policy is refused before it is sent', () => {
    expect(parsePolicyDraft({ ...draft, name: '   ' }).problem).toContain('Name the policy');
  });

  test('the numeric fields take digits only — `1e3` and `0x10` are what Number() would accept', () => {
    expect(parsePolicyDraft({ ...draft, maxOrders: '1e3' }).body).toBeNull();
    expect(parsePolicyDraft({ ...draft, priority: '0x10' }).body).toBeNull();
    expect(parsePolicyDraft({ ...draft, maxOrders: '0' }).body).toBeNull();
  });

  test('the backend’s own bounds are mirrored so a 400 is never earned', () => {
    expect(parsePolicyDraft({ ...draft, maxOrders: String(MAX_POLICY_ORDERS) }).problem).toBeNull();
    expect(parsePolicyDraft({ ...draft, maxOrders: String(MAX_POLICY_ORDERS + 1) }).problem).toContain(
      String(MAX_POLICY_ORDERS),
    );
    expect(parsePolicyDraft({ ...draft, priority: String(MAX_POLICY_PRIORITY) }).problem).toBeNull();
    expect(
      parsePolicyDraft({ ...draft, priority: String(MAX_POLICY_PRIORITY + 1) }).problem,
    ).toContain(String(MAX_POLICY_PRIORITY));
    // `@Length(1, 120)` on the name, mirrored like the two numeric bounds.
    expect(parsePolicyDraft({ ...draft, name: 'n'.repeat(MAX_POLICY_NAME_LENGTH) }).problem).toBeNull();
    expect(
      parsePolicyDraft({ ...draft, name: 'n'.repeat(MAX_POLICY_NAME_LENGTH + 1) }).problem,
    ).toContain(String(MAX_POLICY_NAME_LENGTH));
  });

  test('a malformed cutoff is refused with the shape it wants', () => {
    expect(parsePolicyDraft({ ...draft, cutoffLocalTime: '6pm' }).problem).toContain('HH:MM');
  });

  test('00:00 is refused with the reason the backend refuses it for', () => {
    expect(parsePolicyDraft({ ...draft, cutoffLocalTime: '00:00' }).problem).toContain(
      'whole day',
    );
  });
});

/* ------------------------------------------------------------------ */

function problem(status: number, code: string, title: string, detail?: string): ApiProblem {
  return new ApiProblem(code, status, detail ?? title, title);
}

describe('the refusals a visible row could not predict are rendered verbatim', () => {
  test('release: a 409 cutoff-passed is the server’s words, not the browser’s estimate', () => {
    const sentence = 'The 18:00 Asia/Kolkata cutoff has passed — the wave stays planned.';
    expect(releaseReason(problem(409, 'cutoff-passed', sentence))).toBe(sentence);
  });

  test('release: any other 409 is verbatim too — a race the row could not show', () => {
    expect(releaseReason(problem(409, 'conflict', 'Wave was cancelled'))).toBe('Wave was cancelled');
  });

  test('generate: the open-wave claim names the claiming wave, so it is kept intact', () => {
    const sentence = 'Order 0198f7a2 is already on open wave 0198f800.';
    expect(generateReason(problem(409, 'conflict', sentence))).toBe(sentence);
  });

  test('generate: both 422 arms are verbatim — neither is knowable client-side', () => {
    expect(generateReason(problem(422, 'no-eligible-orders', 'No accepted order is free to wave'))).toBe(
      'No accepted order is free to wave',
    );
    // The cap is a server default when the policy's is null, so the client
    // cannot even compute whether a selection exceeds it.
    expect(
      generateReason(problem(422, 'wave-cap-exceeded', 'Policy waves at most 200 orders; 240 named')),
    ).toBe('Policy waves at most 200 orders; 240 named');
  });

  test('a title and a distinct detail are joined rather than one being dropped', () => {
    expect(releaseReason(problem(409, 'cutoff-passed', 'Cutoff passed', 'The 18:00 cutoff went by.'))).toBe(
      'Cutoff passed — The 18:00 cutoff went by.',
    );
  });

  test('cancel: a 409 is a race with a release and is rendered verbatim', () => {
    expect(cancelWaveReason(problem(409, 'conflict', 'Wave was released'))).toBe('Wave was released');
  });

  test('the policy name clash is the server’s sentence', () => {
    expect(policyReason(problem(409, 'conflict', 'A policy named "Evening courier" exists'))).toBe(
      'A policy named "Evening courier" exists',
    );
  });
});

describe('the refusals the client CAN speak to', () => {
  test('the role gate reads as the role gate, per verb', () => {
    expect(generateReason(problem(403, 'role-denied', 'Forbidden'))).toBe(
      'Your role cannot generate waves.',
    );
    expect(releaseReason(problem(403, 'role-denied', 'Forbidden'))).toBe(
      'Your role cannot release waves.',
    );
    expect(cancelWaveReason(problem(403, 'role-denied', 'Forbidden'))).toBe(
      'Your role cannot cancel waves.',
    );
    expect(policyReason(problem(403, 'role-denied', 'Forbidden'))).toBe(
      'Your role cannot create wave policies.',
    );
  });

  test('an expired session says so on every verb', () => {
    for (const reason of [generateReason, releaseReason, cancelWaveReason, policyReason]) {
      expect(reason(problem(401, 'unauthenticated', 'Unauthorized'))).toBe(
        'Your session expired — sign in again.',
      );
    }
  });

  test('a validation failure keeps the server’s detail — the 00:00 cutoff rule lives there', () => {
    expect(
      policyReason(problem(400, 'validation-failed', 'Bad request', 'cutoffLocalTime 00:00 is rejected')),
    ).toBe('cutoffLocalTime 00:00 is rejected');
  });

  test('an unreachable API is the house copy, never a progress line', () => {
    for (const reason of [generateReason, releaseReason, cancelWaveReason, policyReason]) {
      expect(reason(new TypeError('Failed to fetch'))).toBe(UNREACHABLE_REASON);
    }
  });
});

/* ------------------------------------------------------------------ */

function waveDto(overrides: Partial<WaveDto> = {}): WaveDto {
  return {
    id: 'w-1',
    tenantId: 't-1',
    warehouseId: 'wh-1',
    policyId: 'wp-1',
    status: 'planned',
    releasedAt: null,
    cancelledAt: null,
    createdAt: '2026-09-16T06:00:00.000Z',
    updatedAt: '2026-09-16T06:00:00.000Z',
    picklists: [picklist()],
    ...overrides,
  };
}

describe('the success banners', () => {
  test('generate reports what was actually planned, and what comes next', () => {
    const outcome = generateOutcome(waveDto());
    expect(outcome.tone).toBe('accepted');
    expect(outcome.word).toBe('Wave generated');
    expect(outcome.reason).toBe(
      '1 order · 1 picklist · 2 stops · 2 lines · 7 units to pick. The wave is planned — release it to send the walk to the floor.',
    );
  });

  test('release counts the READY picklists, not every picklist', () => {
    // `releaseWave` flips a picklist with nothing pickable to `cancelled`
    // first and only the rest to `ready`, so counting the array announced
    // walks that do not exist and sent the floor looking for them.
    const outcome = releaseOutcome(
      waveDto({
        status: 'released',
        picklists: [
          picklist({ id: 'p-1', status: 'ready' }),
          picklist({ id: 'p-2', status: 'ready' }),
          picklist({ id: 'p-3', status: 'ready' }),
          picklist({ id: 'p-4', status: 'cancelled' }),
          picklist({ id: 'p-5', status: 'cancelled' }),
        ],
      }),
    );
    expect(outcome.word).toBe('Wave released');
    expect(outcome.reason).toBe(
      '3 picklists are ready to pick; 2 picklists had nothing to pick and were cancelled; the wave reads released.',
    );
  });

  test('release says nothing about a cancelled remainder when there is none', () => {
    const outcome = releaseOutcome(
      waveDto({ status: 'released', picklists: [picklist({ status: 'ready' })] }),
    );
    expect(outcome.reason).toBe('1 picklist is ready to pick; the wave reads released.');
  });

  test('cancelling a PLANNED wave may say no stock moved', () => {
    const outcome = cancelWaveOutcome(waveDto({ status: 'cancelled' }), 'planned');
    expect(outcome.word).toBe('Wave cancelled');
    expect(outcome.reason).toBe(
      '1 picklist cancelled; its orders are eligible for waving again. No reservation and no stock moved.',
    );
  });

  test('cancelling a RELEASED wave may not — its picked units have left their bins', () => {
    const outcome = cancelWaveOutcome(waveDto({ status: 'cancelled' }), 'released');
    expect(outcome.reason).not.toContain('no stock moved');
    expect(outcome.reason).toContain('Units already picked stay out of their bins');
  });

  test('the confirmation warning branches the same way as the outcome', () => {
    expect(cancelWaveWarning('planned')).toContain('No reservation and no stock moves');
    expect(cancelWaveWarning('released')).toContain('Units already picked stay out of their bins');
    expect(cancelWaveWarning('released')).not.toContain('no stock moves');
  });

  test('the policy banner repeats the rule that was created', () => {
    const outcome = policyOutcome({
      id: 'wp-1',
      tenantId: 't-1',
      warehouseId: 'wh-1',
      name: 'Evening courier',
      grouping: 'batch',
      priority: 10,
      maxOrders: 50,
      cutoffLocalTime: '18:00',
      cutoffTimezone: 'Asia/Kolkata',
      carrierRef: null,
      createdAt: '2026-09-16T06:00:00.000Z',
      updatedAt: '2026-09-16T06:00:00.000Z',
    });
    expect(outcome.word).toBe('Policy created');
    expect(outcome.reason).toBe(
      'Evening courier — One picklist across the wave · priority 10 · up to 50 orders · cutoff 18:00 Asia/Kolkata.',
    );
  });
});

describe('the expanded row’s detail failure', () => {
  test('it names WAVES — the orders module’s mapper said "this order no longer exists"', () => {
    expect(waveDetailReason(problem(404, 'not-found', 'Not found'))).toBe(
      'This wave no longer exists — refresh the list.',
    );
    expect(waveDetailReason(problem(403, 'permission-denied', 'Forbidden'))).toContain('wave');
    expect(waveDetailReason(problem(401, 'unauthenticated', 'Unauthorized'))).toBe(
      'Your session expired — sign in again.',
    );
    expect(waveDetailReason(new TypeError('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });
});
