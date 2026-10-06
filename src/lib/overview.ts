import type { ReportingOverviewResponse, SyncConnectionHealthDto } from '@/lib/api/generated';

/**
 * Story 9-1 — every sentence and derivation the Overview renders, kept here
 * so it is pinned by `overview.test.ts` rather than left in JSX.
 *
 * The figures are the backend's: this file formats, it never computes a KPI
 * (no client-side arithmetic over counts — the server is the ledger's
 * projection, AD-1).
 */

/** Past this age a read is stale even when every tile answered (UX-DR19: no polling, so the viewer is told). */
export const STALE_AFTER_MS = 5 * 60_000;

/** How each figure is read. */
export type FigureKind = 'count' | 'minutes' | 'per1000' | 'percent';

/** The copy for a figure with no value (an empty median or ratio, or an unavailable tile). */
export const NO_DATA = 'No data';

/** The visible word on a tile the server could not compute — text, never colour alone. */
export const UNAVAILABLE = 'Unavailable';

/** A figure's display text; null renders as "No data", never as 0. */
export function formatFigure(value: number | null, kind: FigureKind): string {
  if (value === null) return NO_DATA;
  switch (kind) {
    case 'count':
      return String(value);
    case 'minutes':
      return `${formatMinutes(value)}`;
    case 'per1000':
      return `${value.toFixed(1)} per 1,000`;
    case 'percent':
      return `${(value * 100).toFixed(1).replace(/\.0$/, '')}%`;
  }
}

/** Median minutes as minutes, or hours and minutes past the hour. */
export function formatMinutes(minutes: number): string {
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** The 7-day caption beneath today's figure. */
export function sevenDayCaption(value: number | null, kind: FigureKind): string {
  return `7 days: ${formatFigure(value, kind)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "As of HH:MM", in the viewer's local time. */
export function asOfLabel(asOf: string): string {
  const at = new Date(asOf);
  if (Number.isNaN(at.getTime())) return 'As of —';
  return `As of ${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
}

/**
 * Whether the stale banner shows: the server said a tile is unavailable, or
 * the read is older than `STALE_AFTER_MS` against the render-time clock.
 */
export function isOverviewStale(overview: Pick<ReportingOverviewResponse, 'stale' | 'asOf'>, now: number): boolean {
  if (overview.stale) return true;
  const at = Date.parse(overview.asOf);
  if (Number.isNaN(at)) return true;
  return now - at > STALE_AFTER_MS;
}

/** The stale banner's reason line. */
export function staleReason(overview: Pick<ReportingOverviewResponse, 'stale'>): string {
  return overview.stale
    ? 'Some tiles could not be read in time and show Unavailable. Refresh to try again.'
    : 'These figures are more than 5 minutes old. Refresh to read them again.';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "6 Oct 2026", local date — no locale-dependent formatter. */
export function shortDate(instant: string): string {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return '—';
  return `${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}`;
}

/**
 * The SM-3/SM-4 counting note. The facts behind them are recorded from the
 * 0058 deploy onwards (no backfill), so the tile says when counting began —
 * and, when that is inside the 7-day window, that the 7-day figure covers
 * only part of it.
 */
export function countingSinceNote(
  countingSince: string | null,
  d7From: string,
): { readonly since: string; readonly partial: string | null } | null {
  if (countingSince === null) return null;
  const since = `Counting since ${shortDate(countingSince)}`;
  const partial =
    Date.parse(countingSince) > Date.parse(d7From)
      ? 'The 7-day figure covers only the days since counting began.'
      : null;
  return { since, partial };
}

/** Sync health, as words. */
export function syncHealthLabel(health: SyncConnectionHealthDto['health']): string {
  switch (health) {
    case 'ok':
      return 'Healthy';
    case 'degraded':
      return 'Degraded';
    case 'error':
      return 'Error';
  }
}

/** Why a connection is not healthy. */
export function syncReasonText(reason: SyncConnectionHealthDto['reason']): string | null {
  switch (reason) {
    case 'disconnected':
      return 'Disconnected — nothing syncs or ingests';
    case 'ingest-warehouse-unset':
      return 'No ingest warehouse set — channel orders land nowhere';
    case 'breaker-open':
      return 'Sync paused after repeated failures';
    case 'breaker-half-open':
      return 'Sync recovering — retrying after failures';
    case 'last-delivery-failed':
      return 'The last sync delivery failed';
    case 'never-synced':
      return 'Never synced';
    case 'sync-lag':
      return 'Sync is behind (over a minute since the last success)';
    case 'ingest-failures':
      return 'Channel orders failed to ingest in the last 24 h';
    case null:
      return null;
  }
}

/** Seconds since the last sync, as-is (no threshold judged here). */
export function lagLabel(lagSeconds: number | null): string {
  if (lagSeconds === null) return 'Never synced';
  if (lagSeconds < 60) return `Synced ${lagSeconds} s ago`;
  const minutes = Math.floor(lagSeconds / 60);
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `Synced ${hours} h ago`;
  return `Synced ${Math.floor(hours / 24)} days ago`;
}

/** The failures caption of one connection. */
export function failuresLabel(count: number): string {
  return count === 1 ? '1 ingest failure in 24 h' : `${count} ingest failures in 24 h`;
}

/**
 * The render-time clock the stale check compares against. A named seam
 * (not an inline `Date.now()` in the component) so the comparison is
 * visibly a render-time read and tests can pin `Date`.
 */
export function currentTime(): number {
  return Date.now();
}
