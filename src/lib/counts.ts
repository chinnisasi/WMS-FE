import { ApiProblem } from '@/lib/api/client';
import type {
  BinResponse,
  CountPolicyDto,
  CountTaskListEntryDto,
  CountTaskDetailVarianceDto,
  CreateCountsBulkResponse,
  BulkSkippedCountBinDto,
  ZoneResponse,
} from '@/lib/api/generated';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

/**
 * Story 3-5a — the web Counts surface (`/moves/counts`): the count-task list
 * and detail, the bulk create, and the per-warehouse ABC schedule. Every
 * sentence the screen shows is built here and pinned by `counts.test.ts`.
 *
 * The handheld counts BLIND (no expected quantity reaches it); the task
 * detail on this surface is the only place expected and counted sit side by
 * side.
 */

/** Fired on `window` after a count mutation so every counts reader refetches. */
export const COUNTS_CHANGED_EVENT = 'wms-counts-changed';

export function notifyCountsChanged(): void {
  window.dispatchEvent(new Event(COUNTS_CHANGED_EVENT));
}

export type CountTaskStatus = CountTaskListEntryDto['status'];
export type CountTaskOrigin = CountTaskListEntryDto['origin'];
export type CountSkipReason = BulkSkippedCountBinDto['reason'];
export type CountVarianceStatus = CountTaskDetailVarianceDto['status'];
export type AbcClass = CountPolicyDto['abcClass'];

export const COUNT_TASK_STATUSES: readonly CountTaskStatus[] = ['pending', 'completed', 'cancelled'];
export const COUNT_TASK_ORIGINS: readonly CountTaskOrigin[] = ['on_demand', 'scheduled', 'recount'];
export const ABC_CLASSES: readonly AbcClass[] = ['a', 'b', 'c'];

/** `Record`s over the generated unions, so a new backend value fails the compile. */
export const COUNT_TASK_STATUS_LABEL: Readonly<Record<CountTaskStatus, string>> = {
  pending: 'Pending',
  completed: 'Counted',
  // Story 3-5b — the cancel verb, or a stock take's abandon.
  cancelled: 'Cancelled',
};

export const COUNT_TASK_ORIGIN_LABEL: Readonly<Record<CountTaskOrigin, string>> = {
  on_demand: 'On demand',
  scheduled: 'Scheduled',
  recount: 'Recount',
};

export const COUNT_SKIP_REASON_LABEL: Readonly<Record<CountSkipReason, string>> = {
  'count-task-open': 'already has an open count',
  'system-bin': 'a system bin — not countable',
  'bin-retired': 'retired',
  // Story 3-5b — frozen for a stock take (the take counts it).
  'stock-take': 'in a stock take',
};

export const COUNT_VARIANCE_STATUS_LABEL: Readonly<Record<CountVarianceStatus, string>> = {
  open: 'Open',
  adjusted: 'Adjusted',
  recounted: 'Recounted',
};

/** The bulk create's client-side ceiling — the server's own (more is 422 `too-many-bins`). */
export const MAX_COUNT_BINS = 500;

/** The deep link to the variance review queue — it opens the WHOLE queue, not this count's rows. */
export const VARIANCE_QUEUE_HREF = '/conflicts?queue=variances';
export const VARIANCE_QUEUE_LINK_LABEL = 'Open the variance queue (all variances, not only this count)';

/** The list's empty copy, per filter. */
export function countTasksEmptyMessage(status: CountTaskStatus | null, origin: CountTaskOrigin | null): string {
  if (status === null && origin === null) return 'No counts in this warehouse yet.';
  const parts = [
    status === null ? null : COUNT_TASK_STATUS_LABEL[status].toLowerCase(),
    origin === null ? null : COUNT_TASK_ORIGIN_LABEL[origin].toLowerCase(),
  ].filter((part): part is string => part !== null);
  return `No ${parts.join(' ')} counts in this warehouse.`;
}

/** A list row's variance cell: "—" before the count, "None", or "2 (1 open)". */
export function varianceCountLabel(entry: Pick<CountTaskListEntryDto, 'status' | 'varianceCount' | 'openVarianceCount'>): string {
  // Story 3-5b — a cancelled count was never counted.
  if (entry.status === 'pending' || entry.status === 'cancelled') return '—';
  if (entry.varianceCount === 0) return 'None';
  return entry.openVarianceCount === 0 ? `${entry.varianceCount}` : `${entry.varianceCount} (${entry.openVarianceCount} open)`;
}

/** Who planned the task: the system (scheduler or a recount), the viewer, or a short id tail. */
export function createdByLabel(createdBy: string | null, viewerId: string | null, users: Readonly<Record<string, string>> | null): string {
  if (createdBy === null) return 'System';
  if (createdBy === viewerId) return 'You';
  return users?.[createdBy] ?? `User …${createdBy.slice(-8)}`;
}

/** Bins a count can target: not system-owned, not retired (the server skips the rest). */
export function countableBins(bins: readonly BinResponse[]): BinResponse[] {
  return bins.filter((bin) => !bin.systemOwned && bin.retiredAt === null).sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * The zones the picker offers: a zone with at least one countable bin. A
 * system zone (Receiving, QC-hold, In-Transit) holds system bins only, so it
 * is never offered — the zone record itself carries no system flag.
 */
export function countableZones(
  zones: readonly ZoneResponse[],
  bins: readonly BinResponse[],
): { zone: ZoneResponse; binCount: number }[] {
  const perZone = new Map<string, number>();
  for (const bin of countableBins(bins)) perZone.set(bin.zoneId, (perZone.get(bin.zoneId) ?? 0) + 1);
  return zones
    .filter((zone) => (perZone.get(zone.id) ?? 0) > 0)
    .map((zone) => ({ zone, binCount: perZone.get(zone.id)! }))
    .sort((a, b) => a.zone.code.localeCompare(b.zone.code));
}

/** The client-side cap's sentence, or null while within it. */
/** A zone over the per-request cap cannot be counted whole (the server answers 422 too-many-bins). */
export function zoneTooLarge(binCount: number): boolean {
  return binCount > MAX_COUNT_BINS;
}

export const ZONE_TOO_LARGE_NOTE = `Zones with more than ${MAX_COUNT_BINS} countable bins cannot be counted whole — choose their bins instead.`;

/** A pending task whose bin held nothing at planning time. */
export const PENDING_NO_LINES_COPY = 'Nothing is listed yet — the operator records what they find';

/** The planner names from the user list: id → email. */
export function plannerNames(users: Readonly<Record<string, { email: string }>> | null): Readonly<Record<string, string>> | null {
  return users === null ? null : Object.fromEntries(Object.entries(users).map(([id, user]) => [id, user.email]));
}

export function tooManyBinsNote(selected: number): string | null {
  return selected > MAX_COUNT_BINS ? `At most ${MAX_COUNT_BINS} bins per request — ${selected} selected. Split the selection.` : null;
}

const MAX_NAMED_SKIPS = 5;

/** The bulk create's outcome, built from the RESPONSE. */
export function createCountsOutcome(response: CreateCountsBulkResponse): { tone: 'accepted' | 'rejected'; word: string; reason: string } {
  const created = response.created.length;
  const skipped = response.skipped;
  const named = skipped
    .slice(0, MAX_NAMED_SKIPS)
    .map((entry) => `${entry.binCode} (${COUNT_SKIP_REASON_LABEL[entry.reason]})`)
    .join(', ');
  const more = skipped.length > MAX_NAMED_SKIPS ? `, …and ${skipped.length - MAX_NAMED_SKIPS} more` : '';
  const skippedSentence = skipped.length === 0 ? '' : ` Skipped ${skipped.length}: ${named}${more}.`;
  if (created === 0) {
    return { tone: 'rejected', word: 'No counts created', reason: `Every bin was skipped.${skippedSentence}` };
  }
  return {
    tone: 'accepted',
    word: created === 1 ? '1 count created' : `${created} counts created`,
    reason: `They are on the handhelds' Count list at the next refresh — no notification is sent for a bulk create.${skippedSentence}`,
  };
}

/** The house refusal sentence for the shared codes. */
function shared(error: ApiProblem, fallback: string): string {
  switch (error.code) {
    case 'unauthenticated':
      return 'Your session expired — sign in again.';
    case 'permission-denied':
      return 'That data belongs to another tenant — sign in again.';
    case 'idempotency-key-reuse':
      return 'This request was already sent with different values — reload and try again.';
    default:
      return error.detail ?? fallback;
  }
}

/** The bulk create's refusal. */
export function createCountsReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'too-many-bins':
        return `At most ${MAX_COUNT_BINS} bins per request — split the selection.`;
      case 'role-denied':
        return 'Your role cannot plan counts.';
      case 'not-found':
        return 'A bin or the zone no longer exists — reload the bins and choose again.';
      case 'validation-failed':
      case 'conflict':
        return error.detail ?? `Not created (${error.code}).`;
      default:
        return shared(error, `Not created (${error.code}).`);
    }
  }
  return UNREACHABLE_REASON;
}

/** The schedule writes' refusal. */
export function countPolicyReason(error: unknown, action: 'save' | 'remove'): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'role-denied':
        return 'Your role cannot change the count schedule.';
      case 'not-found':
        return action === 'remove'
          ? 'That class is no longer scheduled — reload the schedule.'
          : 'This warehouse no longer exists — reload the page.';
      case 'validation-failed':
      case 'conflict':
        return error.detail ?? `Not saved (${error.code}).`;
      default:
        return shared(error, action === 'remove' ? `Not removed (${error.code}).` : `Not saved (${error.code}).`);
    }
  }
  return UNREACHABLE_REASON;
}

/** The expanded row's read failure. */
export function countDetailReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.code === 'not-found') return 'This count no longer exists — refresh the list.';
    return shared(error, `Detail unavailable (${error.code}).`);
  }
  return UNREACHABLE_REASON;
}

/** "Every 7 days" / "Every day". */
export function intervalLabel(days: number): string {
  return days === 1 ? 'Every day' : `Every ${days} days`;
}

export function abcClassLabel(abcClass: AbcClass): string {
  return `Class ${abcClass.toUpperCase()}`;
}

/** A typed interval: a whole number of days, 1–3650, else null. */
export function parseIntervalDays(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const days = Number(trimmed);
  return days >= 1 && days <= 3650 ? days : null;
}

export function policySavedSentence(abcClass: AbcClass, days: number): string {
  return `${abcClassLabel(abcClass)} is counted ${intervalLabel(days).toLowerCase()}.`;
}

export function policyRemovedSentence(abcClass: AbcClass): string {
  return `${abcClassLabel(abcClass)} is no longer scheduled — its open counts stay.`;
}
