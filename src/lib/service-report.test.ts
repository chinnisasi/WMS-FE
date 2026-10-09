import { afterEach, describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import type { ServiceReportDto } from './api/generated';
import { PORTAL_SUSPENDED_MESSAGE } from './portal';
import {
  DEFAULT_SERVICE_DAYS,
  MAX_SERVICE_REPORT_DAYS,
  PORTAL_SERVICE_WAREHOUSE_GONE,
  SERVICE_TIMEOUT_REASON,
  defaultServicePeriod,
  formatServiceRate,
  parseServicePeriod,
  portalServiceReason,
  serviceClientOption,
  serviceReportReason,
  serviceTiles,
} from './service-report';
import { parseCustomRange } from './usage';

const REPORT: ServiceReportDto = {
  from: '2026-09-01',
  to: '2026-09-30',
  warehouseId: null,
  asOf: '2026-10-07T04:30:00.000Z',
  targetHours: 24,
  dockToStock: { medianMinutes: 95, placements: 12 },
  pickAccuracy: {
    accuracy: 0.9375,
    linesDispatched: 16,
    linesShortPicked: 1,
    packFailures: 2,
    packFailuresCountingSince: '2026-10-06T04:30:00.000Z',
  },
  dispatchTimeliness: { ordersDispatched: 5, onTime: 4, onTimeRate: 0.8, medianMinutes: 600, lateNotDispatched: 3 },
};

const EMPTY: ServiceReportDto = {
  ...REPORT,
  dockToStock: { medianMinutes: null, placements: 0 },
  pickAccuracy: { accuracy: null, linesDispatched: 0, linesShortPicked: 0, packFailures: 0, packFailuresCountingSince: null },
  dispatchTimeliness: { ordersDispatched: 0, onTime: 0, onTimeRate: null, medianMinutes: null, lateNotDispatched: 0 },
};

describe('the default period', () => {
  // `bun test` runs in UTC unless TZ says otherwise; deleting TZ would fall
  // back to the MACHINE zone and leak into later files — restore the
  // resolved zone by assignment instead.
  const originalTz = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  test('the last 30 days ending today (IST)', () => {
    expect(DEFAULT_SERVICE_DAYS).toBe(30);
    expect(defaultServicePeriod(Date.parse('2026-10-10T12:00:00+05:30'))).toEqual({ from: '2026-09-11', to: '2026-10-10' });
    // Across a month boundary, in UTC date arithmetic.
    expect(defaultServicePeriod(Date.parse('2026-03-01T09:00:00+05:30'))).toEqual({ from: '2026-01-31', to: '2026-03-01' });
  });

  test('between 00:00 and 05:30 IST a viewer west of India is still on yesterday — the period ends on the IST date', () => {
    process.env.TZ = 'America/Los_Angeles';
    const at = Date.parse('2026-10-10T00:30:00+05:30'); // 2026-10-09 12:00 in Los Angeles
    // Meaningful: the viewer's local date really is the day before.
    expect(new Date(at).getDate()).toBe(9);
    expect(defaultServicePeriod(at)).toEqual({ from: '2026-09-11', to: '2026-10-10' });
    // And just before IST midnight it is still the previous IST day.
    expect(defaultServicePeriod(Date.parse('2026-10-09T23:59:59+05:30')).to).toBe('2026-10-09');
  });
});

describe('the period parse — a period the server would refuse is never sent', () => {
  test('366 days pass, 367 are refused naming the bound', () => {
    expect(MAX_SERVICE_REPORT_DAYS).toBe(366);
    expect(parseServicePeriod('2025-09-01', '2026-09-01')).toEqual({ period: { from: '2025-09-01', to: '2026-09-01' }, problem: null });
    expect(parseServicePeriod('2025-09-01', '2026-09-02')).toEqual({ period: null, problem: 'A period covers at most 366 days.' });
  });

  test('from after to, a blank and an impossible date are refused', () => {
    expect(parseServicePeriod('2026-09-30', '2026-09-01').problem).toBe('The start date is after the end date.');
    expect(parseServicePeriod('', '2026-09-01').problem).toBe('Pick both a start and an end date.');
    expect(parseServicePeriod('2026-02-31', '2026-03-01').problem).toBe('Pick both a start and an end date.');
  });

  test('parseCustomRange takes the bound as a parameter (the usage default stays 366)', () => {
    expect(parseCustomRange('2026-09-01', '2026-09-10', 5).problem).toBe('A period covers at most 5 days.');
    expect(parseCustomRange('2026-09-01', '2026-09-05', 5).problem).toBeNull();
  });
});

describe('the tiles', () => {
  test('values, counts and the population each tile is computed over', () => {
    expect(serviceTiles(REPORT)).toEqual([
      {
        label: 'Dock-to-stock (median)',
        value: '1 h 35 min',
        secondary: '12 placements',
        caption: 'Placements made in the period: GRN recorded → placed in a bin',
        notes: [],
      },
      {
        label: 'Pick accuracy',
        value: '93.8%',
        secondary: '16 lines dispatched · 1 short-picked',
        caption: 'Order lines dispatched in the period that never had a short pick',
        notes: ['2 failed pack checks', 'Pack checks counted since 6 Oct 2026'],
      },
      {
        label: 'Dispatched within 24 h',
        value: '80%',
        secondary: '4 of 5 orders · median 10 h',
        caption: 'Orders dispatched in the period, from received to dispatched',
        notes: ['3 orders late, not yet dispatched (received in the period)'],
      },
    ]);
  });

  test('null reads "No data" — never 0 — and the counting note is absent when unknown', () => {
    const tiles = serviceTiles(EMPTY);
    expect(tiles.map((tile) => tile.value)).toEqual(['No data', 'No data', 'No data']);
    expect(tiles[2]!.secondary).toBe('0 of 0 orders · median No data');
    expect(tiles[1]!.notes).toEqual(['0 failed pack checks']);
    expect(tiles[2]!.notes).toEqual(['0 orders late, not yet dispatched (received in the period)']);
  });

  test('singular counts', () => {
    const one = serviceTiles({
      ...EMPTY,
      dockToStock: { medianMinutes: 5, placements: 1 },
      pickAccuracy: { ...EMPTY.pickAccuracy, accuracy: 1, linesDispatched: 1, packFailures: 1 },
      dispatchTimeliness: { ...EMPTY.dispatchTimeliness, ordersDispatched: 1, onTime: 1, onTimeRate: 1, medianMinutes: 5, lateNotDispatched: 1 },
    });
    expect(one.map((tile) => tile.secondary)).toEqual(['1 placement', '1 line dispatched · 0 short-picked', '1 of 1 order · median 5 min']);
    expect(one[1]!.notes[0]).toBe('1 failed pack check');
    expect(one[2]!.notes[0]).toBe('1 order late, not yet dispatched (received in the period)');
  });
});

describe('the service rates — below 1 never reads 100%', () => {
  test('0.9996 (one short line in ~2,500) reads 99.9%, never 100%', () => {
    expect(formatServiceRate(0.9996)).toBe('99.9%');
  });
  test('exactly 1 reads 100%; ordinary values and null are formatFigure\'s', () => {
    expect(formatServiceRate(1)).toBe('100%');
    expect(formatServiceRate(0.7143)).toBe('71.4%');
    expect(formatServiceRate(null)).toBe('No data');
  });
});

describe('the client picker', () => {
  test('every status is offered, named when not active; the tenant’s own reads as the company', () => {
    const base = { systemOwned: false, code: 'BRAND-A', name: 'Brand A' };
    expect(serviceClientOption({ ...base, status: 'active' }, 'Three PL')).toBe('BRAND-A — Brand A');
    expect(serviceClientOption({ ...base, status: 'suspended' }, 'Three PL')).toBe('BRAND-A — Brand A (suspended)');
    expect(serviceClientOption({ systemOwned: true, code: 'self', name: 'Three PL', status: 'active' }, 'Three PL')).toBe('Three PL (your company)');
  });
});

describe('refusals', () => {
  test('operator: 404, 503, 400 detail, transport', () => {
    expect(serviceReportReason(new ApiProblem('not-found', 404))).toBe('That client or warehouse is no longer available — pick again.');
    expect(serviceReportReason(new ApiProblem('report-unavailable', 503))).toBe(SERVICE_TIMEOUT_REASON);
    expect(serviceReportReason(new ApiProblem('validation-failed', 400, 'from (x) is after to (y).', 'Invalid report period'))).toBe('from (x) is after to (y).');
    expect(serviceReportReason(new Error('fetch failed'))).toBe('The API is unreachable — is wms-be running?');
  });

  test('portal: the warehouse 404 and the 503 copy; the session codes stay the portal’s', () => {
    expect(portalServiceReason(new ApiProblem('not-found', 404))).toBe(PORTAL_SERVICE_WAREHOUSE_GONE);
    expect(PORTAL_SERVICE_WAREHOUSE_GONE).toBe('That warehouse is no longer available');
    expect(portalServiceReason(new ApiProblem('report-unavailable', 503))).toBe('The report took too long — try a shorter period');
    expect(portalServiceReason(new ApiProblem('client-suspended', 403))).toBe(PORTAL_SUSPENDED_MESSAGE);
  });
});
