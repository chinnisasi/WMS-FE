import { describe, expect, test } from 'bun:test';

import {
  NO_DATA,
  STALE_AFTER_MS,
  asOfLabel,
  countingSinceNote,
  failuresLabel,
  formatFigure,
  formatMinutes,
  isOverviewStale,
  lagLabel,
  sevenDayCaption,
  shortDate,
  staleReason,
  syncHealthLabel,
  syncReasonText,
} from './overview';

describe('formatFigure', () => {
  test('null is "No data", never zero', () => {
    for (const kind of ['count', 'minutes', 'per1000', 'percent'] as const) {
      expect(formatFigure(null, kind)).toBe(NO_DATA);
    }
    expect(formatFigure(0, 'count')).toBe('0');
  });

  test('each kind', () => {
    expect(formatFigure(12, 'count')).toBe('12');
    expect(formatFigure(42.4, 'minutes')).toBe('42 min');
    expect(formatFigure(3.333, 'per1000')).toBe('3.3 per 1,000');
    expect(formatFigure(0, 'per1000')).toBe('0.0 per 1,000');
    expect(formatFigure(0, 'percent')).toBe('0%');
    expect(formatFigure(1, 'percent')).toBe('100%');
    expect(formatFigure(0.3333, 'percent')).toBe('33.3%');
  });

  test('minutes past an hour read as hours and minutes', () => {
    expect(formatMinutes(59.4)).toBe('59 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(135)).toBe('2 h 15 min');
  });

  test('the 7-day caption', () => {
    expect(sevenDayCaption(5, 'count')).toBe('7 days: 5');
    expect(sevenDayCaption(null, 'percent')).toBe('7 days: No data');
  });
});

describe('the stale check (render-time)', () => {
  const asOf = '2026-10-06T10:00:00.000Z';
  const at = Date.parse(asOf);

  test('the server saying stale is stale', () => {
    expect(isOverviewStale({ stale: true, asOf }, at)).toBe(true);
  });

  test('fresh until more than 5 minutes old', () => {
    expect(STALE_AFTER_MS).toBe(5 * 60_000);
    expect(isOverviewStale({ stale: false, asOf }, at)).toBe(false);
    expect(isOverviewStale({ stale: false, asOf }, at + STALE_AFTER_MS)).toBe(false);
    expect(isOverviewStale({ stale: false, asOf }, at + STALE_AFTER_MS + 1)).toBe(true);
  });

  test('an unreadable asOf is stale', () => {
    expect(isOverviewStale({ stale: false, asOf: 'nonsense' }, at)).toBe(true);
  });

  test('the reason names which cause', () => {
    expect(staleReason({ stale: true })).toContain('Unavailable');
    expect(staleReason({ stale: false })).toContain('more than 5 minutes old');
  });
});

describe('labels', () => {
  test('As of HH:MM in local time', () => {
    const asOf = '2026-10-06T04:05:00.000Z';
    const d = new Date(asOf);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    expect(asOfLabel(asOf)).toBe(`As of ${hh}:${mm}`);
    expect(asOfLabel('bad')).toBe('As of —');
  });

  test('short date', () => {
    const d = new Date(2026, 9, 6, 12, 0, 0);
    expect(shortDate(d.toISOString())).toBe('6 Oct 2026');
  });

  test('counting since, with the partial-window note only inside the 7-day window', () => {
    const d7From = '2026-09-29T18:30:00.000Z';
    const inside = countingSinceNote('2026-10-03T12:00:00.000Z', d7From);
    expect(inside!.since).toStartWith('Counting since ');
    expect(inside!.partial).not.toBeNull();
    const before = countingSinceNote('2026-09-01T12:00:00.000Z', d7From);
    expect(before!.partial).toBeNull();
    expect(countingSinceNote(null, d7From)).toBeNull();
  });

  test('sync health in words', () => {
    expect(syncHealthLabel('ok')).toBe('Healthy');
    expect(syncHealthLabel('degraded')).toBe('Degraded');
    expect(syncHealthLabel('error')).toBe('Error');
    expect(syncReasonText('ingest-warehouse-unset')).toContain('No ingest warehouse');
    expect(syncReasonText('breaker-open')).toContain('paused');
    expect(syncReasonText('ingest-failures')).toContain('failed to ingest');
    expect(syncReasonText('disconnected')).toContain('Disconnected');
    expect(syncReasonText('sync-lag')).toContain('behind');
    expect(syncReasonText(null)).toBeNull();
  });

  test('lag and failures', () => {
    expect(lagLabel(null)).toBe('Never synced');
    expect(lagLabel(30)).toBe('Synced 30 s ago');
    expect(lagLabel(600)).toBe('Synced 10 min ago');
    expect(lagLabel(7200)).toBe('Synced 2 h ago');
    expect(lagLabel(3 * 86400)).toBe('Synced 3 days ago');
    expect(failuresLabel(1)).toBe('1 ingest failure in 24 h');
    expect(failuresLabel(0)).toBe('0 ingest failures in 24 h');
  });
});
