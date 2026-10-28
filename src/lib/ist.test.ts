import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  addIsoDays,
  istClockLabel,
  istDateOf,
  istDayLabel,
  istInstantOf,
  istMidnightMs,
  istMinuteOfDay,
  istWeekdayOf,
  minuteLabel,
  parseMinute,
  weekOf,
} from './ist';
import { istDateOf as rateCardsIstDateOf } from './rate-cards';

/**
 * Story 2-3b — the IST helpers the dock grid is built on. Every case runs in
 * a browser zone far from IST (Los Angeles, UTC−7/−8): the grid is IST
 * arithmetic, never the browser's own clock — the hour between 00:00 and
 * 05:30 IST (still the previous UTC date) is where a local-time slip shows.
 */
let savedTz: string | undefined;
beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

describe('ist', () => {
  test('istDateOf is the rate-cards helper, re-exported — not a copy', () => {
    expect(istDateOf).toBe(rateCardsIstDateOf);
  });

  test('00:00, 05:29, 05:30 and 23:59 UTC land on the right IST date and minute', () => {
    // The zone really is not IST here: the local clock reads 17:00 the day before.
    expect(new Date('2026-10-27T00:00:00Z').getHours()).toBe(17);
    expect(istDateOf('2026-10-27T00:00:00Z')).toBe('2026-10-27');
    expect(istMinuteOfDay('2026-10-27T00:00:00Z')).toBe(330); // 05:30 IST
    expect(istDateOf('2026-10-27T18:29:00Z')).toBe('2026-10-27');
    expect(istMinuteOfDay('2026-10-27T18:29:00Z')).toBe(1439); // 23:59 IST
    expect(istDateOf('2026-10-27T18:30:00Z')).toBe('2026-10-28'); // 00:00 IST the next day
    expect(istMinuteOfDay('2026-10-27T18:30:00Z')).toBe(0);
    expect(istMinuteOfDay('2026-10-27T23:59:00Z')).toBe(329); // 05:29 IST
    expect(istDateOf('2026-10-27T23:59:00Z')).toBe('2026-10-28');
  });

  test('an IST date and minute → the instant, and back (midnight and 24:00)', () => {
    expect(istMidnightMs('2026-10-28')).toBe(Date.parse('2026-10-27T18:30:00Z'));
    expect(istInstantOf('2026-10-28', 630)).toBe('2026-10-28T05:00:00.000Z'); // 10:30 IST
    expect(istInstantOf('2026-10-28', 1440)).toBe('2026-10-28T18:30:00.000Z'); // the next midnight
    expect(istClockLabel(istInstantOf('2026-10-28', 15))).toBe('00:15');
  });

  test('the ISO weekday and the Mon–Sun week of a date — a Sunday belongs to the week it ends', () => {
    expect(istWeekdayOf('2026-10-26')).toBe(1); // Monday
    expect(istWeekdayOf('2026-11-01')).toBe(7); // Sunday
    expect(weekOf('2026-11-01')).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
    expect(weekOf('2026-10-26')[0]).toBe('2026-10-26');
    expect(weekOf('2026-12-31')).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
  });

  test('calendar steps and spans', () => {
    expect(addIsoDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addIsoDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  test('HH:MM both ways; 24:00 is 1440 and nothing past it', () => {
    expect(minuteLabel(0)).toBe('00:00');
    expect(minuteLabel(1440)).toBe('24:00');
    expect(parseMinute('09:30')).toBe(570);
    expect(parseMinute('24:00')).toBe(1440);
    expect(parseMinute('24:30')).toBeNull();
    expect(parseMinute('9:30')).toBeNull();
    expect(parseMinute('10:60')).toBeNull();
  });

  test('a day label never moves with the browser zone', () => {
    expect(istDayLabel('2026-10-28')).toBe('Wed 28 Oct');
  });
});
