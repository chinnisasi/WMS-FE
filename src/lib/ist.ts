/**
 * Story 2-3b — the IST calendar helpers the dock calendar is built on: an IST
 * date's midnight, a day's wall-clock minute, the ISO weekday, the week of a
 * date, and an instant from an IST date and minute.
 *
 * UTC arithmetic only (IST is UTC+05:30 all year, no DST), so a browser in
 * any zone computes the IST grid — never its own. `istDateOf` is re-exported
 * from `lib/rate-cards.ts`, not copied; `istToday` stays in `lib/gate-ins.ts`.
 *
 * Pure: no React, no fetch — pinned by `ist.test.ts`.
 */
import { isRealDate } from '@/lib/audit';
import { istDateOf } from '@/lib/rate-cards';

export { istDateOf, isRealDate };

const IST_OFFSET_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

/** The minutes in one IST day; `closesAt` may be `24:00` (= 1440). */
export const MINUTES_PER_DAY = 1440;

/** The UTC epoch milliseconds of an IST date's 00:00 (`2026-10-28` → 2026-10-27T18:30Z). */
export function istMidnightMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) - IST_OFFSET_MS;
}

/** `date` plus `days` calendar days (negative goes back). */
export function addIsoDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The whole days from `from` to `to` (both IST dates). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** The ISO weekday of an IST date: 1 = Monday … 7 = Sunday (the backend's `istWeekdayOf`). */
export function istWeekdayOf(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The IST wall-clock minute of an instant, 0–1439 (the backend's `istMinuteOfDay`). */
export function istMinuteOfDay(instant: string | number): number {
  const ms = typeof instant === 'number' ? instant : Date.parse(instant);
  const shifted = new Date(ms + IST_OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** The instant (ISO, UTC) of an IST date and a wall-clock minute (1440 is the next midnight). */
export function istInstantOf(date: string, minute: number): string {
  return new Date(istMidnightMs(date) + minute * 60_000).toISOString();
}

/** The Monday … Sunday of the week holding `date` (a Sunday belongs to the week it ends). */
export function weekOf(date: string): string[] {
  const monday = addIsoDays(date, 1 - istWeekdayOf(date));
  return Array.from({ length: 7 }, (_, index) => addIsoDays(monday, index));
}

/** A wall-clock minute as `HH:MM` (1440 → `24:00`). */
export function minuteLabel(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** `HH:MM` → the minute of the day (`24:00` → 1440); null when malformed. */
export function parseMinute(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (match === null) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (m > 59 || h > 24 || (h === 24 && m !== 0)) return null;
  return h * 60 + m;
}

/** An instant's IST wall clock, `10:30`. */
export function istClockLabel(instant: string): string {
  return minuteLabel(istMinuteOfDay(instant));
}

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** ISO weekday → `Mon` … `Sun`. */
export function weekdayShort(isoDay: number): string {
  return WEEKDAY_SHORT[isoDay - 1] ?? '?';
}

/** ISO weekday → `Monday` … `Sunday`. */
export function weekdayLong(isoDay: number): string {
  return WEEKDAY_LONG[isoDay - 1] ?? '?';
}

/** An IST date as `Wed 28 Oct` (no zone: it already is an IST date). */
export function istDayLabel(date: string): string {
  const [, month, day] = date.split('-').map(Number) as [number, number, number];
  return `${weekdayShort(istWeekdayOf(date))} ${day} ${MONTHS[month - 1] ?? '?'}`;
}
