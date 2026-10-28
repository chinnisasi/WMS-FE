import { ApiProblem } from '@/lib/api/client';
import type {
  CloseStockTakeResponse,
  StockTakeDetailResponse,
  StockTakeSummaryDto,
  StockTakeVarianceEntryDto,
  UnpostedVarianceDto,
  ZoneResponse,
} from '@/lib/api/generated';
import { UNREACHABLE_REASON, verbatim } from '@/lib/outbound-orders';
import { istDateOf } from '@/lib/rate-cards';
import type { StatusTone } from '@/lib/status-tone';

/**
 * Story 3-5b — the web Stock takes tab (`/moves/counts`): a take freezes
 * every storage bin of a warehouse (or of named zones), is counted blind on
 * the handheld, and is closed by one post. Every sentence the tab shows is
 * built here and pinned by `stock-takes.test.ts`.
 */

export type StockTakeStatus = StockTakeSummaryDto['status'];

/** `Record` over the generated union, so a new backend status fails the compile. */
export const STOCK_TAKE_STATUS_LABEL: Readonly<Record<StockTakeStatus, string>> = {
  counting: 'Counting',
  posting: 'Posting',
  closed: 'Closed',
  abandoned: 'Abandoned',
};

/** One tone per status, list and detail alike: in progress `info`, closed `success`, abandoned `neutral`. */
export function stockTakeStatusTone(status: StockTakeStatus): StatusTone {
  return status === 'closed' ? 'success' : status === 'abandoned' ? 'neutral' : 'info';
}

/** The report's status word — the server's first-column vocabulary. */
export function stockTakeReportStatus(status: StockTakeStatus): 'final' | 'provisional' | 'abandoned' {
  return status === 'closed' ? 'final' : status === 'abandoned' ? 'abandoned' : 'provisional';
}

export const POSTING_NOTE = 'Posting in progress — the variances are being posted in batches. If it was interrupted, resume it.';

/** The server's per-request recount ceiling. */
export const MAX_RECOUNT_BINS = 500;

export const TOO_MANY_RECOUNT_NOTE = `At most ${MAX_RECOUNT_BINS} bins per recount — select fewer.`;

/**
 * Why Post and close cannot run yet (null when it can): pending counts, bins
 * that moved after their count, or over-threshold variances for a non-owner.
 */
export function closeBlockedReason(
  totals: Pick<StockTakeDetailResponse['totals'], 'pending' | 'overThreshold'>,
  recountRequiredCount: number,
  isOwner: boolean,
): string | null {
  if (totals.pending > 0) return `${totals.pending} ${totals.pending === 1 ? 'count is' : 'counts are'} still pending — count every bin first.`;
  if (recountRequiredCount > 0) return `${recountRequiredCount} ${recountRequiredCount === 1 ? 'bin' : 'bins'} moved after the count — recount ${recountRequiredCount === 1 ? 'it' : 'them'} first.`;
  if (totals.overThreshold > 0 && !isOwner) return OWNER_REQUIRED_NOTE;
  return null;
}

/** The recount-required banner: the bins listed, "…and N more" past the list. */
export function recountRequiredSentence(bins: readonly { binCode: string }[], total: number, deviceWrites: number): string {
  const more = total > bins.length ? ` …and ${total - bins.length} more` : '';
  const writes = deviceWrites > 0 ? ` (${deviceWrites} handheld write(s) landed after the freeze)` : '';
  return `${total} counted ${total === 1 ? 'bin' : 'bins'} moved since ${total === 1 ? 'its' : 'their'} count${writes}: ${bins.map((bin) => bin.binCode).join(', ')}${more} — recount them before posting.`;
}

/** The start form's not-ready reason, per scope. */
export function startNotReadyReason(scope: 'warehouse' | 'zones', picked: number, binCount: number, otherFrozen: number): string {
  if (binCount + otherFrozen > MAX_FROZEN_BINS) return freezeCapSentence(binCount, otherFrozen);
  if (scope === 'zones' && picked === 0) return 'Choose at least one zone first.';
  return scope === 'zones' ? 'The chosen zones hold no storage bin.' : 'This warehouse holds no storage bin.';
}

/** The 3,000 cap is shared with the warehouse's other active takes. */
export function freezeCapSentence(binCount: number, otherFrozen: number): string {
  return otherFrozen === 0
    ? freezeCountLabel(binCount)
    : `${binCount} bins, and ${otherFrozen} already frozen by other stock takes — at most ${MAX_FROZEN_BINS} can be frozen in one warehouse at once.`;
}

/** The server's cap: at most this many bins frozen in one warehouse across its active takes. */
export const MAX_FROZEN_BINS = 3000;

export const FREEZE_WARNING =
  'Every movement into or out of these bins is refused until the take is closed or abandoned. Sync every handheld first.';

/** A whole-warehouse take freezes the bins that exist at its start only. */
export const NEW_BINS_OUTSIDE_NOTE = 'A bin created during the take is outside it.';

/** The owner rule, said before the click (5-4 invariant 10, applied in bulk). */
export const OWNER_REQUIRED_NOTE = 'Some variances are over the threshold — only the owner can post this take.';

export const NEEDS_LOT_COUNT_LABEL = 'needs batch- or serial-level count (not yet supported)';

/** "Whole warehouse" or "Zones A, B" (codes in order; an unknown zone reads by its id tail). */
export function stockTakeScopeLabel(zoneIds: readonly string[] | null, zones: readonly Pick<ZoneResponse, 'id' | 'code'>[]): string {
  if (zoneIds === null) return 'Whole warehouse';
  const codes = zoneIds.map((id) => zones.find((zone) => zone.id === id)?.code ?? `…${id.slice(-6)}`).sort((a, b) => a.localeCompare(b));
  return `${codes.length === 1 ? 'Zone' : 'Zones'} ${codes.join(', ')}`;
}

/** "12 of 40 bins counted". */
export function progressLabel(counted: number, bins: number): string {
  return `${counted} of ${bins} ${bins === 1 ? 'bin' : 'bins'} counted`;
}

/** The progress bar's percent (0 for an empty scope). */
export function progressPercent(counted: number, bins: number): number {
  return bins === 0 ? 0 : Math.round((counted / bins) * 100);
}

/** The start's bin count line: "40 bins will be frozen" (or the cap breach). */
export function freezeCountLabel(binCount: number): string {
  if (binCount > MAX_FROZEN_BINS) {
    return `${binCount} bins — at most ${MAX_FROZEN_BINS} can be frozen in one warehouse; take fewer zones.`;
  }
  return `${binCount} ${binCount === 1 ? 'bin' : 'bins'} will be frozen.`;
}

/** Whether the post is refused locally: over-threshold variances need the owner. */
export function closeNeedsOwner(totals: Pick<StockTakeDetailResponse['totals'], 'overThreshold'>, isOwner: boolean): boolean {
  return totals.overThreshold > 0 && !isOwner;
}

/** The Post and close inline confirm, naming the counts. */
export function closeConfirmSentence(detail: Pick<StockTakeDetailResponse, 'totals' | 'stockTake'>): string {
  const { openVariances, overThreshold } = detail.totals;
  const posts =
    openVariances === 0
      ? 'No variance to post'
      : `Post ${openVariances} ${openVariances === 1 ? 'variance' : 'variances'}${overThreshold > 0 ? ` (${overThreshold} over the threshold)` : ''} to the ledger`;
  return `${posts} and lift the freeze on ${detail.stockTake.binCount} ${detail.stockTake.binCount === 1 ? 'bin' : 'bins'}? A variance the adjustment rules refuse stays open on the variance queue.`;
}

export const ABANDON_CONFIRM =
  'Cancel the pending counts and lift the freeze? Nothing is posted; the variances counted so far stay open on the variance queue.';

/** One unposted variance's reason, in words. */
export function unpostedReasonLabel(entry: Pick<UnpostedVarianceDto, 'code' | 'detail' | 'needsLotCount'>): string {
  if (entry.needsLotCount) return NEEDS_LOT_COUNT_LABEL;
  if (entry.code === 'basis-moved') return 'the bin moved after its count — recount it, then resolve it on the variance queue';
  return entry.detail;
}

/** The variance table's outcome cell. */
export function varianceOutcomeLabel(entry: Pick<StockTakeVarianceEntryDto, 'status' | 'unpostedCode' | 'needsLotCount'>): string {
  if (entry.status === 'adjusted') return 'Posted';
  if (entry.status === 'recounted') return 'Recounted';
  if (entry.unpostedCode !== null) return entry.needsLotCount ? `Not posted — ${NEEDS_LOT_COUNT_LABEL}` : `Not posted (${entry.unpostedCode})`;
  return entry.needsLotCount ? `Open — ${NEEDS_LOT_COUNT_LABEL}` : 'Open';
}

/** The close's outcome, from the RESPONSE. */
export function closeOutcome(response: CloseStockTakeResponse): { tone: 'accepted' | 'rejected'; word: string; reason: string } {
  const posted = `${response.postedCount} ${response.postedCount === 1 ? 'variance' : 'variances'} posted`;
  if (response.unposted.length === 0) {
    return { tone: 'accepted', word: 'Stock take closed', reason: `${posted}; the freeze is lifted.` };
  }
  const named = response.unposted
    .slice(0, 5)
    .map((entry) => `${entry.binCode} ${entry.skuCode} (${unpostedReasonLabel(entry)})`)
    .join('; ');
  const more = response.unposted.length > 5 ? `; …and ${response.unposted.length - 5} more` : '';
  return {
    tone: 'accepted',
    word: 'Stock take closed',
    reason: `${posted}; the freeze is lifted. ${response.unposted.length} not posted — they stay on the variance queue: ${named}${more}.`,
  };
}

/** The report's file name, built here (CORS hides the server's): `stock-take-BLR-2026-10-28-GLOW[-provisional|-abandoned].csv`. */
export function stockTakeReportFilename(input: {
  take: Pick<StockTakeSummaryDto, 'startedAt' | 'status'>;
  format: 'csv' | 'xlsx';
  clientCode: string | null;
  warehouseCode: string;
}): string {
  const slug = (value: string) => value.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const parts = ['stock-take', slug(input.warehouseCode), istDateOf(input.take.startedAt), ...(input.clientCode === null ? [] : [slug(input.clientCode)])];
  const status = stockTakeReportStatus(input.take.status);
  return `${parts.join('-')}${status === 'final' ? '' : `-${status}`}.${input.format}`;
}

/** The shared refusal words for the house codes. */
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

export type StockTakeAction = 'start' | 'recount' | 'close' | 'abandon' | 'report';

/**
 * The take's refusals. `stock-take-recount-required`, `stock-take-incomplete`,
 * `bin-frozen` and `variance-owner-required` are shown verbatim — the server
 * names the bins, the counts and the variances.
 */
export function stockTakeReason(error: unknown, action: StockTakeAction): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'stock-take-recount-required':
      case 'stock-take-incomplete':
      case 'bin-frozen':
      case 'variance-owner-required':
        return verbatim(error);
      case 'stock-take-overlap':
        return error.detail ?? 'Another stock take already freezes some of these bins.';
      case 'too-many-bins':
        return error.detail ?? `At most ${MAX_FROZEN_BINS} bins can be frozen in one warehouse — take fewer zones.`;
      case 'stock-take-empty':
        return 'Those zones hold no storage bin to count — pick other zones.';
      case 'stock-take-changed':
        return 'The variances changed since you reviewed them — refresh, review them again, then post.';
      case 'stock-take-not-counting':
        return 'This stock take is no longer counting — refresh it.';
      case 'count-task-open':
        return error.detail ?? 'A bin already has a pending count — count it first.';
      case 'role-denied':
        return action === 'start' || action === 'abandon'
          ? 'Your role cannot start or abandon stock takes.'
          : action === 'report'
            ? 'Your role cannot read stock take variances.'
            : 'Your role cannot recount or post stock takes.';
      case 'not-found':
        return action === 'report' ? 'That client or stock take no longer exists — reload.' : 'That stock take, warehouse or zone no longer exists — reload.';
      case 'conflict':
      case 'validation-failed':
        return error.detail ?? `Refused (${error.code}).`;
      default:
        return shared(error, `Refused (${error.code}).`);
    }
  }
  return UNREACHABLE_REASON;
}

/** The count-task cancel's refusal (story 3-5b). */
export function cancelCountReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'stock-take-task':
        return 'This count belongs to a stock take — abandon the take instead.';
      case 'count-task-completed':
        return 'This count was already counted — nothing to cancel.';
      case 'count-task-cancelled':
        return 'This count was already cancelled.';
      case 'role-denied':
        return 'Your role cannot cancel counts.';
      case 'not-found':
        return 'This count no longer exists — refresh the list.';
      default:
        return shared(error, `Not cancelled (${error.code}).`);
    }
  }
  return UNREACHABLE_REASON;
}
