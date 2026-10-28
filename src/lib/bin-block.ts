/**
 * Story 3-3b — block / unblock a bin, the web's pure half: the reason
 * vocabulary in words, the bin's status line ("Blocked — damaged") and the
 * byline beneath it (the note, who, when), the two drafts' rules (a reason;
 * `other` needs a note; an unblock always says why; notes 1–500 characters
 * after trimming), the impact preview in words, the Status filter, and the
 * refusals by code. Modelled on `batch-block.ts` (3-3a).
 *
 * A bin block takes the bin's whole on-hand out of ATP (it stays on hand),
 * refuses putaway, move, transfer and merge INTO it, and leaves every
 * existing reservation standing — a planned pick stop in it is skipped on the
 * handheld and re-planned. The server is the authority for all of it.
 */
import type { BinBlockImpactResponse, BinResponse, BlockBinDto, UnblockBinDto } from '@/lib/api/generated';
import { ApiProblem } from '@/lib/api/client';
import { istDateTimeLabel } from '@/lib/audit-exports';

export type BinBlockReason = BlockBinDto['reason'];

/** The server's vocabulary (`BIN_BLOCK_REASONS`), in its order — a new reason must be labelled to compile. */
export const BIN_BLOCK_REASON_LABEL: Readonly<Record<BinBlockReason, string>> = {
  damaged: 'Damaged (rack, shelf or floor)',
  maintenance: 'Maintenance',
  contamination: 'Contamination (spill, pest)',
  'temperature-excursion': 'Temperature excursion',
  'safety-hazard': 'Safety hazard',
  investigation: 'Investigation (discrepancy or audit hold)',
  other: 'Other (say what in the note)',
};

export const BIN_BLOCK_REASONS = Object.keys(BIN_BLOCK_REASON_LABEL) as readonly BinBlockReason[];

/** The reason inside a status line ("Blocked — damaged"). */
const BIN_BLOCK_REASON_SHORT: Readonly<Record<BinBlockReason, string>> = {
  damaged: 'damaged',
  maintenance: 'maintenance',
  contamination: 'contamination',
  'temperature-excursion': 'temperature excursion',
  'safety-hazard': 'safety hazard',
  investigation: 'investigation',
  other: 'other',
};

/** The server's note ceiling (code points, after trimming). */
export const BIN_BLOCK_NOTE_MAX = 500;

/** A block reason in a sentence ("temperature excursion"); null → "no reason"; an unknown reason reads as sent. */
export function binBlockReasonWord(reason: string | null): string {
  if (reason === null) return 'no reason';
  return Object.prototype.hasOwnProperty.call(BIN_BLOCK_REASON_SHORT, reason) ? BIN_BLOCK_REASON_SHORT[reason as BinBlockReason] : reason;
}

/** The block facts a status line reads (a bin row; absent fields — an older response — read as null). */
export type BinBlockFacts = Pick<BinResponse, 'blocked'> &
  Partial<Pick<BinResponse, 'blockedReason' | 'blockedNote' | 'blockedAt' | 'blockedByName'>>;

/** The Status pill's word for a blocked bin: "Blocked — damaged". */
export function binBlockedLabel(bin: BinBlockFacts): string {
  return `Blocked — ${binBlockReasonWord(bin.blockedReason ?? null)}`;
}

/**
 * The line beneath the pill: the note, then who and when ("Rack hit by a
 * forklift · by ravi · 26 Oct 2026, 14:05 IST"). A block backfilled from
 * before 3-3b has no blocker — its byline drops "by". Null when there is
 * nothing to say (an active bin, or a blocked one with no facts).
 */
export function binBlockByline(bin: BinBlockFacts): string | null {
  if (!bin.blocked) return null;
  const parts: string[] = [];
  const note = bin.blockedNote ?? null;
  if (note !== null && note !== '') parts.push(note);
  const by = bin.blockedByName ?? null;
  if (by !== null) parts.push(`by ${by}`);
  const at = bin.blockedAt ?? null;
  if (at !== null && !Number.isNaN(Date.parse(at))) parts.push(`${istDateTimeLabel(at)} IST`);
  return parts.length === 0 ? null : parts.join(' · ');
}

// ── the Status filter ────────────────────────────────────────────────────────

export type BinStatusFilter = 'all' | 'active' | 'blocked';

export const BIN_STATUS_FILTER_LABEL: Readonly<Record<BinStatusFilter, string>> = {
  all: 'All',
  active: 'Active',
  blocked: 'Blocked',
};

/**
 * Whether a bin row passes the Status filter. `active` and `blocked` are
 * both LIVE bins (a retired bin is neither); `active` keeps the system bins,
 * which are live and never blocked.
 */
export function binMatchesStatus(bin: Pick<BinResponse, 'blocked' | 'retiredAt'>, filter: BinStatusFilter): boolean {
  if (filter === 'all') return true;
  if (bin.retiredAt !== null) return false;
  return filter === 'blocked' ? bin.blocked : !bin.blocked;
}

// ── the drafts ───────────────────────────────────────────────────────────────

function codePoints(text: string): number {
  return [...text].length;
}

export interface BinBlockDraft {
  readonly reason: BinBlockReason | '';
  readonly note: string;
}

export type ParsedBinDraft<T> = { readonly kind: 'ok'; readonly body: T } | { readonly kind: 'refused'; readonly problem: string };

/** The block draft → its body, or the sentence that refuses it (the server's own rules, mirrored). A blank note is dropped. */
export function parseBinBlockDraft(draft: BinBlockDraft): ParsedBinDraft<BlockBinDto> {
  if (draft.reason === '') return { kind: 'refused', problem: 'Pick a reason for the block.' };
  const note = draft.note.trim();
  if (draft.reason === 'other' && note === '') return { kind: 'refused', problem: 'Say why in the note — the reason is Other.' };
  if (codePoints(note) > BIN_BLOCK_NOTE_MAX) return { kind: 'refused', problem: `The note is at most ${BIN_BLOCK_NOTE_MAX} characters.` };
  return { kind: 'ok', body: note === '' ? { reason: draft.reason } : { reason: draft.reason, note } };
}

/** The unblock draft → its body: lifting a block always says why. */
export function parseBinUnblockDraft(note: string): ParsedBinDraft<UnblockBinDto> {
  const trimmed = note.trim();
  if (trimmed === '') return { kind: 'refused', problem: 'Say why the block is lifted — a note is required.' };
  if (codePoints(trimmed) > BIN_BLOCK_NOTE_MAX) return { kind: 'refused', problem: `The note is at most ${BIN_BLOCK_NOTE_MAX} characters.` };
  return { kind: 'ok', body: { note: trimmed } };
}

// ── the impact preview ───────────────────────────────────────────────────────

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The impact preview in one sentence: "12 units of 3 SKUs on hand will stop
 * being promised; 2 planned pick stops (5 units) will need a Skip and a
 * re-plan; 1 open count line stays open." Units are base-UoM figures as the
 * server sums them, rendered as sent (never rounded). Advisory: a block is
 * never refused for open work.
 */
export function binBlockImpactSentence(impact: BinBlockImpactResponse): string {
  const parts: string[] = [];
  parts.push(
    impact.onHandUnits === 0 && impact.skuCount === 0
      ? 'Nothing is on hand in this bin'
      : `${count(impact.onHandUnits, 'unit', 'units')} of ${count(impact.skuCount, 'SKU', 'SKUs')} on hand will stop being promised`,
  );
  parts.push(
    impact.plannedPickLines === 0
      ? 'no planned pick stops'
      : `${count(impact.plannedPickLines, 'planned pick stop', 'planned pick stops')} (${count(impact.plannedPickUnits, 'unit', 'units')}) will need a Skip and a re-plan`,
  );
  parts.push(
    impact.openCountLines === 0
      ? 'no open count lines'
      : `${count(impact.openCountLines, 'open count line', 'open count lines')} ${impact.openCountLines === 1 ? 'stays' : 'stay'} open`,
  );
  return `${parts.join('; ')}.`;
}

/** One client's share of the impact, for the dialog's list: "GlowCo — 8 units of 2 SKUs · 1 planned pick stop". */
export function binBlockImpactClientLine(row: BinBlockImpactResponse['byClient'][number]): string {
  const stock = `${count(row.units, 'unit', 'units')} of ${count(row.skuCount, 'SKU', 'SKUs')}`;
  const picks = row.plannedPickLines === 0 ? '' : ` · ${count(row.plannedPickLines, 'planned pick stop', 'planned pick stops')}`;
  return `${row.clientName} — ${stock}${picks}`;
}

// ── the refusals ─────────────────────────────────────────────────────────────

const UNREACHABLE = 'The server could not be reached — nothing was changed. Try again.';

/** A block / unblock refusal in words, by code — never the server's prose for a known code. */
export function binBlockReason(error: unknown): string {
  if (!(error instanceof ApiProblem)) return UNREACHABLE;
  switch (error.code) {
    case 'bin-already-blocked':
      return 'This bin is already blocked — refresh the bins.';
    case 'bin-not-blocked':
      return 'This bin is not blocked any more — refresh the bins.';
    case 'bin-retired':
      return 'This bin is retired — retirement is terminal, so it cannot be blocked or unblocked.';
    case 'role-denied':
      return 'Your role cannot block or unblock bins.';
    case 'permission-denied':
      return 'This bin belongs to another tenant — sign in again.';
    case 'not-found':
      return 'The bin or its warehouse no longer exists — refresh the bins.';
    case 'idempotency-key-reuse':
      return 'This request was already sent with different details — close and try again.';
    case 'conflict':
      return 'Another change to this bin is in flight — refresh and try again.';
    case 'unauthenticated':
      return 'Your session expired — sign in again.';
    case 'validation-failed':
      // A system bin, or a note the client could not foresee — the server names it.
      return error.detail ?? 'Check the reason and note and try again.';
    case 'request-failed':
      return UNREACHABLE;
    default:
      return error.detail ?? `Not changed (${error.code}).`;
  }
}

/** The impact read's failure in words (the dialog still lets the block go ahead — the read is advisory). */
export function binBlockImpactReason(error: unknown): string {
  if (!(error instanceof ApiProblem)) return 'The impact could not be read — the server is unreachable.';
  switch (error.code) {
    case 'role-denied':
      return 'Your role cannot read what a block would affect.';
    case 'not-found':
      return 'The bin or its warehouse no longer exists — refresh the bins.';
    default:
      return error.detail ?? `The impact could not be read (${error.code}).`;
  }
}

/**
 * The refusals that mean "the bin moved on under you" — someone else
 * blocked, unblocked or retired it, or it is gone: the list re-reads and the
 * dialog closes.
 */
export function binBlockStale(error: unknown): boolean {
  return (
    error instanceof ApiProblem &&
    (error.code === 'bin-already-blocked' || error.code === 'bin-not-blocked' || error.code === 'bin-retired' || error.code === 'not-found')
  );
}

/** What a block does, in one sentence — the dialog and the banner share it. */
export const BIN_BLOCK_EFFECT =
  'Its stock stays on hand but is no longer promised to orders or channels. Putaway, moves, transfers and merges into it are refused. Orders already reserved against it stand — a planned pick stop in it is skipped on the handheld and re-planned onto other bins.';

/** The banner after a block or unblock, built from the RESPONSE. */
export function binBlockOutcome(kind: 'block' | 'unblock', bin: BinResponse): { readonly word: string; readonly reason: string } {
  if (kind === 'block') {
    return {
      word: `${bin.code} blocked`,
      reason: `${bin.code} is blocked (${binBlockReasonWord(bin.blockedReason)}). ${BIN_BLOCK_EFFECT}`,
    };
  }
  return {
    word: `${bin.code} unblocked`,
    reason: `${bin.code} is active again — its stock is promisable and it takes putaway and picks.`,
  };
}

// ── the stock list chip ──────────────────────────────────────────────────────

/** The chip on a stock row whose bin is blocked (absent on an older response — read as not blocked). */
export const BLOCKED_BIN_CHIP = 'Blocked bin';
export const BLOCKED_BIN_CHIP_TITLE = 'The bin is blocked — this stock stays on hand but is not promised.';

export function stockRowBinBlocked(row: { readonly binBlocked?: boolean }): boolean {
  return row.binBlocked === true;
}
