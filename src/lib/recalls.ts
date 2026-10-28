/**
 * Story 3-7a — batch recall on the web, the pure half: the vocabulary in
 * words (status, mode, location role, every figure), the candidates
 * checklist's rules (which lot may be ticked, which is pre-ticked — EXACT
 * matches only), the open / add / close drafts and their bodies, the close
 * rules (which lot may be released; which release needs an override; when the
 * unaccounted acknowledgement is required), the refusals by code, the report
 * file's name and the recall link.
 *
 * Pure — no React, no fetch — and portal-safe (the portal Recalls page reads
 * the figure words and the report helpers from here). Every sentence a
 * recall surface renders lives here, pinned by `recalls.test.ts`.
 */
import { ApiProblem } from '@/lib/api/client';
import type {
  AddRecallBatchesDto,
  CloseRecallDto,
  OpenRecallDto,
  RecallCandidateDto,
  RecallFiguresDto,
  RecallLotDto,
} from '@/lib/api/generated';
import { batchBlockReasonWord } from '@/lib/batch-block';
import { formatCount } from '@/lib/format-quantity';
import { UNREACHABLE_REASON, readReason } from '@/lib/outbound-orders';
import { istDateOf } from '@/lib/rate-cards';
import type { StatusTone } from '@/lib/status-tone';

export type RecallMode = OpenRecallDto['mode'] & string;
export type RecallStatus = 'open' | 'closed';
export type RecallReportFormat = 'csv' | 'xlsx';
export type RecallFigureKey = keyof RecallFiguresDto;

// ── invalidation ─────────────────────────────────────────────────────────────

/** One event for the module (guide §1.4): an open, an add, a close or a download re-reads every recall view. */
export const RECALLS_CHANGED_EVENT = 'wms-recalls-changed';

export function notifyRecallsChanged(): void {
  window.dispatchEvent(new Event(RECALLS_CHANGED_EVENT));
}

// ── bounds (the backend's DTO decorators) ───────────────────────────────────

/** `@ArrayMaxSize(50)` on `batchIds` — and the lots a recall may hold in all. */
export const RECALL_MAX_LOTS = 50;
/** The reason note, the close note, an override reason and a disposition note: 1–500 code points. */
export const RECALL_NOTE_MAX = 500;
/** The brand's reference: at most 100 code points. */
export const RECALL_REF_MAX = 100;
/** The close's evidence reference (a destruction certificate number): at most 200 code points. */
export const RECALL_EVIDENCE_MAX = 200;
/** The XLSX row cap — over it the server answers 422 `report-too-large`. */
export const RECALL_XLSX_MAX_ROWS = 200_000;

function codePoints(text: string): number {
  return [...text].length;
}

// ── words ────────────────────────────────────────────────────────────────────

export const RECALL_STATUS_LABEL: Readonly<Record<RecallStatus, string>> = { open: 'Open', closed: 'Closed' };

/** An open live recall is the blocking state (solid amber); closed is informational. */
export function recallStatusTone(status: string, mode: string): { tone: StatusTone; solid: boolean } {
  if (status === 'open') return mode === 'mock' ? { tone: 'info', solid: false } : { tone: 'warning', solid: true };
  return { tone: 'neutral', solid: false };
}

export function recallStatusWord(status: string): string {
  return Object.hasOwn(RECALL_STATUS_LABEL, status) ? RECALL_STATUS_LABEL[status as RecallStatus] : status;
}

export const RECALL_MODE_LABEL: Readonly<Record<RecallMode, string>> = { live: 'Live', mock: 'Mock' };

/** The two modes as the open form explains them. */
export const RECALL_MODE_HELP: Readonly<Record<RecallMode, string>> = {
  live: 'Blocks every active lot it names in every warehouse, now: stock stops being promised and picked, and dispatch refuses an order already holding it.',
  mock: 'A drill: blocks nothing — picks, dispatch and unblock carry on as normal. The trace and the report are real, labelled MOCK, so you can time a recall end to end.',
};

/** The banner a mock recall's detail carries. */
export const MOCK_RECALL_NOTE =
  'This is a mock recall — a drill. It blocked nothing: picks, dispatch and unblocks are unaffected. Its trace and report are real and labelled MOCK.';

/** The reason note's hint on the open form — the client reads it. */
export const REASON_NOTE_HINT = 'Visible to the client — on its portal and in the report. Say what is wrong with the lot.';

/** The brand reference's hint. */
export const BRAND_REF_HINT =
  "The brand's own recall number. One vendor lot across several clients is one recall per client — link them with the same reference.";

/** The words for each location role (`storage`, or a system bin) — never a bin code. */
const ROLE_LABEL: Readonly<Record<string, string>> = {
  storage: 'Storage',
  RECEIVING: 'Receiving',
  'QC-HOLD': 'QC hold',
  DAMAGED: 'Damaged',
  RETURNS: 'Returns',
  'IN-TRANSIT': 'In transit',
};

export function recallRoleLabel(role: string): string {
  return Object.hasOwn(ROLE_LABEL, role) ? ROLE_LABEL[role]! : role;
}

/** Every figure in words, in the report's order — a Record over the generated keys (a new figure fails the compile). */
export const RECALL_FIGURE_LABEL: Readonly<Record<RecallFigureKey, string>> = {
  received: 'Received',
  receivedDamaged: 'Received damaged',
  onHand: 'On hand',
  inTransit: 'In transit',
  heldInOpenOrders: 'Held in open orders',
  dispatched: 'Dispatched',
  returned: 'Returned',
  returnScrapped: 'Returns scrapped',
  adjustedOut: 'Written off',
  unaccounted: 'Unaccounted',
};

/** What each figure means, for the figures table's description column. */
export const RECALL_FIGURE_HELP: Readonly<Record<RecallFigureKey, string>> = {
  received: 'Booked in on goods receipts',
  receivedDamaged: 'Booked in damaged',
  onHand: 'In a bin in any warehouse (not in transit)',
  inTransit: 'On a transfer not yet confirmed',
  heldInOpenOrders: 'Picked into orders not yet dispatched',
  dispatched: 'Picked into orders that shipped',
  returned: 'Received back on returns',
  returnScrapped: 'Returned units scrapped',
  adjustedOut: 'Removed by stock adjustments',
  unaccounted: 'Should read 0 — stock that does not match the ledger history',
};

export const RECALL_FIGURE_KEYS = Object.keys(RECALL_FIGURE_LABEL) as readonly RecallFigureKey[];

/**
 * A base-unit quantity in its unit, grouped en-IN and never rounded: the
 * recall rows carry the unit but not its precision, so no padding is
 * invented (`2.5 kg`, `1,500 each`).
 */
export function recallQuantity(qty: number, uom: string): string {
  return `${formatCount(qty)} ${uom}`;
}

/** One row of the figures table: the figure, live, and as frozen at close (null while open). */
export interface RecallFigureRow {
  readonly key: RecallFigureKey;
  readonly label: string;
  readonly help: string;
  readonly live: number;
  readonly atClose: number | null;
  /** Unaccounted ≠ 0 (live or at close): the row is amber. */
  readonly attention: boolean;
}

export function recallFigureRows(live: RecallFiguresDto, atClose: RecallFiguresDto | null): readonly RecallFigureRow[] {
  return RECALL_FIGURE_KEYS.map((key) => ({
    key,
    label: RECALL_FIGURE_LABEL[key],
    help: RECALL_FIGURE_HELP[key],
    live: live[key],
    atClose: atClose === null ? null : atClose[key],
    attention: key === 'unaccounted' && (live[key] !== 0 || (atClose !== null && atClose[key] !== 0)),
  }));
}

/** `{reasonCode: qty}` written off, as "damaged 4 · expired 2" (largest first), or null when nothing was. */
export function adjustedOutByReasonLabel(byReason: Readonly<Record<string, number>> | null, uom: string): string | null {
  if (byReason === null) return null;
  const entries = Object.entries(byReason).filter(([, qty]) => qty !== 0);
  if (entries.length === 0) return null;
  return entries
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([reason, qty]) => `${reason.replace(/[-_]/g, ' ')} ${recallQuantity(qty, uom)}`)
    .join(' · ');
}

/** The lot's state now, in words. */
export function recallLotStatusLabel(
  lot: Pick<RecallLotDto, 'status' | 'blockedReason' | 'blockedByRecall' | 'released' | 'expired'>,
  mode: string,
): string {
  let word: string;
  if (lot.released && lot.status === 'active') word = 'Released at close';
  else if (lot.status === 'blocked') {
    if (lot.blockedByRecall && lot.blockedReason === 'recall') word = 'Blocked by this recall';
    else if (!lot.blockedByRecall) word = `Blocked — ${batchBlockReasonWord(lot.blockedReason)} (before the recall; kept)`;
    else word = `Blocked — ${batchBlockReasonWord(lot.blockedReason)}`;
  } else word = mode === 'mock' ? 'Active — a mock recall blocks nothing' : 'Active';
  return lot.expired ? `${word} · Expired` : word;
}

/** "2 h 14 min after opening" — the time to the first report download, or null before one. */
export function timeToReportLabel(seconds: number | null): string | null {
  if (seconds === null) return null;
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return 'under a minute after opening';
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} min after opening`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min after opening`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h after opening`;
}

// ── links ────────────────────────────────────────────────────────────────────

/** A recall code's shape (the backend's CHECK): `RCL-` and 6–9 digits. */
export const RECALL_CODE_RE = /^RCL-[0-9]{6,9}$/;

/** The Recalls tab, on one recall when a code is given (`/inventory?tab=recalls&recall=RCL-000001`). */
export function recallHref(code?: string | null): string {
  if (code === undefined || code === null || !RECALL_CODE_RE.test(code)) return '/inventory?tab=recalls';
  return `/inventory?tab=recalls&recall=${encodeURIComponent(code)}`;
}

/** `?recall=` → one well-shaped recall code, else null (repeated, malformed, absent). */
export function parseRecallParam(params: { readonly [key: string]: string | string[] | undefined }): string | null {
  const value = params.recall;
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return RECALL_CODE_RE.test(code) ? code : null;
}

// ── the candidates checklist ─────────────────────────────────────────────────

export type CandidateAvailability =
  | { readonly kind: 'selectable'; readonly note: string | null }
  | { readonly kind: 'on-this-recall' }
  | { readonly kind: 'on-recall'; readonly code: string };

/**
 * Whether a candidate may be ticked, for a recall of `mode` — `recallId`
 * when ADDING to that recall. A live recall cannot name a lot already on an
 * open LIVE recall (the server's 409 `batch-already-recalled`); a mock may
 * (two drills, or a drill beside a live recall). A lot already on the recall
 * being added to is not offered again.
 */
export function candidateAvailability(candidate: Pick<RecallCandidateDto, 'onRecall'>, mode: string, recallId?: string): CandidateAvailability {
  const on = candidate.onRecall;
  if (on !== null && recallId !== undefined && on.recallId === recallId) return { kind: 'on-this-recall' };
  if (on !== null && mode === 'live' && on.mode === 'live') return { kind: 'on-recall', code: on.code };
  if (on !== null) return { kind: 'selectable', note: on.mode === 'mock' ? `Also on mock ${on.code} (a drill)` : `Also on ${on.code}` };
  return { kind: 'selectable', note: null };
}

/** The words beside a normalised match: the stored code differs from what was typed in more than punctuation and case. */
export const SIMILAR_CODE_LABEL = 'similar code — check the label';

/**
 * The lots the checklist ticks for you: EXACT matches only (a normalised
 * match is a similar code someone must check against the label), that may
 * be ticked — and, when opening a NEW recall, not a lot whose code already
 * sits on an open recall of the client (add it to that recall instead).
 */
export function preTickedCandidates(items: readonly RecallCandidateDto[], mode: string, recallId?: string): readonly string[] {
  return items
    .filter((c) => c.match === 'exact')
    .filter((c) => candidateAvailability(c, mode, recallId).kind === 'selectable')
    .filter((c) => recallId !== undefined || c.sameCodeOnOpenRecall === null)
    .map((c) => c.batchId);
}

/** The candidates read's summary line: "3 lots match AB123 — 2 exact, 1 similar". */
export function candidatesSummary(normalisedCode: string, items: readonly RecallCandidateDto[]): string {
  if (items.length === 0) return `No lot of this client matches ${normalisedCode} — check the code on the label.`;
  const exact = items.filter((c) => c.match === 'exact').length;
  const similar = items.length - exact;
  const head = `${items.length} ${items.length === 1 ? 'lot matches' : 'lots match'} ${normalisedCode}`;
  if (similar === 0) return `${head}.`;
  return `${head} — ${exact} exact, ${similar} similar.`;
}

/** The candidates read stopped at its cap: the checklist is incomplete. */
export const CANDIDATES_TRUNCATED =
  'More than 200 lots match this code — the list below is incomplete. Type more of the code to narrow it before recalling.';

/** A candidate's status now, in words. */
export function candidateStatusLabel(candidate: Pick<RecallCandidateDto, 'status' | 'blockedReason'>): string {
  return candidate.status === 'blocked' ? `Blocked — ${batchBlockReasonWord(candidate.blockedReason)}` : 'Active';
}

// ── the drafts ───────────────────────────────────────────────────────────────

export type Parsed<T> = { readonly body: T; readonly problem: null } | { readonly body: null; readonly problem: string };

const refused = <T>(problem: string): Parsed<T> => ({ body: null, problem });

export interface OpenRecallDraft {
  readonly clientId: string;
  readonly batchIds: readonly string[];
  readonly reasonNote: string;
  readonly externalRef: string;
  readonly mode: RecallMode;
}

/** The open draft → its body, or the sentence that refuses it (the server's shape rules, mirrored). */
export function parseOpenRecallDraft(draft: OpenRecallDraft): Parsed<OpenRecallDto> {
  if (draft.clientId === '') return refused('Pick the client whose lot is recalled.');
  const ids = [...new Set(draft.batchIds)];
  if (ids.length === 0) return refused('Tick at least one lot to recall.');
  if (ids.length > RECALL_MAX_LOTS) return refused(`A recall holds at most ${RECALL_MAX_LOTS} lots — open another for the rest, linked by the brand reference.`);
  const note = draft.reasonNote.trim();
  if (note === '') return refused('Say why the lot is recalled — the client reads this note.');
  if (codePoints(note) > RECALL_NOTE_MAX) return refused(`The reason note is at most ${RECALL_NOTE_MAX} characters.`);
  const ref = draft.externalRef.trim();
  if (codePoints(ref) > RECALL_REF_MAX) return refused(`The brand reference is at most ${RECALL_REF_MAX} characters.`);
  return {
    body: { batchIds: [...ids].sort(), reasonNote: note, ...(ref === '' ? {} : { externalRef: ref }), mode: draft.mode },
    problem: null,
  };
}

/** The add-lots draft → its body: 1–50 new lots, and the recall's lots in all stay within 50. */
export function parseAddBatchesDraft(batchIds: readonly string[], lotsOnRecall: number): Parsed<AddRecallBatchesDto> {
  const ids = [...new Set(batchIds)];
  if (ids.length === 0) return refused('Tick at least one lot to add.');
  if (lotsOnRecall + ids.length > RECALL_MAX_LOTS) {
    return refused(`A recall holds at most ${RECALL_MAX_LOTS} lots — it has ${lotsOnRecall}; open another recall for the rest.`);
  }
  return { body: { batchIds: [...ids].sort() }, problem: null };
}

// ── the close ────────────────────────────────────────────────────────────────

type CloseLot = Pick<RecallLotDto, 'batchId' | 'batchCode' | 'status' | 'blockedReason' | 'blockedByRecall' | 'figures'>;

/** A lot the close may release: THIS recall blocked it, and it is still blocked for the recall. */
export function releaseEligible(lot: Pick<RecallLotDto, 'status' | 'blockedReason' | 'blockedByRecall'>): boolean {
  return lot.blockedByRecall && lot.status === 'blocked' && lot.blockedReason === 'recall';
}

/** Why a lot cannot be released by this close (null when it can). */
export function releaseIneligibleReason(lot: Pick<RecallLotDto, 'status' | 'blockedReason' | 'blockedByRecall'>, mode: string): string | null {
  if (releaseEligible(lot)) return null;
  if (mode === 'mock') return 'A mock recall blocked nothing — there is nothing to release.';
  if (!lot.blockedByRecall) {
    return lot.status === 'blocked'
      ? `Already blocked (${batchBlockReasonWord(lot.blockedReason)}) before the recall — it stays blocked; unblock it from Batches.`
      : 'This recall did not block it.';
  }
  if (lot.status !== 'blocked') return 'Already unblocked.';
  return `Now blocked for ${batchBlockReasonWord(lot.blockedReason)} — it stays blocked.`;
}

/** A released lot still holding stock (on hand, in transit, or picked into open orders) needs an override reason. */
export function releaseNeedsOverride(lot: Pick<RecallLotDto, 'figures'>): boolean {
  return lot.figures.onHand + lot.figures.inTransit > 0 || lot.figures.heldInOpenOrders > 0;
}

/** "4 each on hand · 2 each in open orders" — what a release would let loose, or null when nothing. */
export function releaseStockLabel(lot: Pick<RecallLotDto, 'figures'> & { readonly uom: string }): string | null {
  const parts: string[] = [];
  const { onHand, inTransit, heldInOpenOrders } = lot.figures;
  if (onHand > 0) parts.push(`${recallQuantity(onHand, lot.uom)} on hand`);
  if (inTransit > 0) parts.push(`${recallQuantity(inTransit, lot.uom)} in transit`);
  if (heldInOpenOrders > 0) parts.push(`${recallQuantity(heldInOpenOrders, lot.uom)} in open orders`);
  return parts.length === 0 ? null : parts.join(' · ');
}

/** The lots whose stock does not match their ledger history (unaccounted ≠ 0) — the close needs the acknowledgement. */
export function unaccountedLots<L extends Pick<RecallLotDto, 'figures'>>(lots: readonly L[]): readonly L[] {
  return lots.filter((lot) => lot.figures.unaccounted !== 0);
}

export interface CloseRecallDraft {
  readonly note: string;
  readonly releaseBatchIds: readonly string[];
  readonly overrideReason: string;
  readonly acknowledgeUnaccounted: boolean;
  /** batchId → the disposition note typed for it (blank = none). */
  readonly dispositionNotes: Readonly<Record<string, string>>;
  readonly evidenceRef: string;
}

export const EMPTY_CLOSE_DRAFT: CloseRecallDraft = {
  note: '',
  releaseBatchIds: [],
  overrideReason: '',
  acknowledgeUnaccounted: false,
  dispositionNotes: {},
  evidenceRef: '',
};

/**
 * The draft against the lots as now read: release ticks only for lots still
 * eligible, disposition notes only for lots still on the recall. Returns the
 * same draft when nothing was dropped.
 */
export function pruneCloseDraft(draft: CloseRecallDraft, lots: readonly CloseLot[]): CloseRecallDraft {
  const eligible = new Set(lots.filter(releaseEligible).map((lot) => lot.batchId));
  const onRecall = new Set(lots.map((lot) => lot.batchId));
  const releaseBatchIds = draft.releaseBatchIds.filter((id) => eligible.has(id));
  const noteIds = Object.keys(draft.dispositionNotes);
  const keptNotes = noteIds.filter((id) => onRecall.has(id));
  if (releaseBatchIds.length === draft.releaseBatchIds.length && keptNotes.length === noteIds.length) return draft;
  return {
    ...draft,
    releaseBatchIds,
    dispositionNotes: Object.fromEntries(keptNotes.map((id) => [id, draft.dispositionNotes[id]!])),
  };
}

/** True when the draft's ticked lots include one that still holds stock (the override field shows). */
export function closeNeedsOverride(draft: Pick<CloseRecallDraft, 'releaseBatchIds'>, lots: readonly CloseLot[]): boolean {
  const ticked = new Set(draft.releaseBatchIds);
  return lots.some((lot) => ticked.has(lot.batchId) && releaseNeedsOverride(lot));
}

/**
 * The close draft → its body, or the sentence that refuses it — the
 * server's rules mirrored: a note; only eligible lots released; a release
 * with stock needs an override reason; any unaccounted lot needs the
 * acknowledgement; every text within its bound. Blank optionals are dropped.
 */
export function parseCloseRecallDraft(draft: CloseRecallDraft, lots: readonly CloseLot[]): Parsed<CloseRecallDto> {
  const note = draft.note.trim();
  if (note === '') return refused('Say why the recall is closed — a note is required.');
  if (codePoints(note) > RECALL_NOTE_MAX) return refused(`The close note is at most ${RECALL_NOTE_MAX} characters.`);
  const byId = new Map(lots.map((lot) => [lot.batchId, lot]));
  const release = [...new Set(draft.releaseBatchIds)].filter((id) => byId.has(id));
  const ineligible = release.map((id) => byId.get(id)!).filter((lot) => !releaseEligible(lot));
  if (ineligible.length > 0) return refused(`${ineligible.map((lot) => lot.batchCode).join(', ')} cannot be released by this recall — untick it.`);
  const override = draft.overrideReason.trim();
  const withStock = release.map((id) => byId.get(id)!).filter(releaseNeedsOverride);
  if (withStock.length > 0 && override === '') {
    return refused(`${withStock.map((lot) => lot.batchCode).join(', ')} still has stock — say why it may be released anyway, or leave it blocked.`);
  }
  if (codePoints(override) > RECALL_NOTE_MAX) return refused(`The override reason is at most ${RECALL_NOTE_MAX} characters.`);
  const unaccounted = unaccountedLots(lots);
  if (unaccounted.length > 0 && !draft.acknowledgeUnaccounted) {
    return refused(
      `${unaccounted.map((lot) => lot.batchCode).join(', ')} ${unaccounted.length === 1 ? 'has' : 'have'} stock that does not match the ledger history — tick the acknowledgement to close anyway.`,
    );
  }
  const notes: { batchId: string; note: string }[] = [];
  for (const lot of lots) {
    const text = (draft.dispositionNotes[lot.batchId] ?? '').trim();
    if (text === '') continue;
    if (codePoints(text) > RECALL_NOTE_MAX) return refused(`The note for ${lot.batchCode} is at most ${RECALL_NOTE_MAX} characters.`);
    notes.push({ batchId: lot.batchId, note: text });
  }
  const evidence = draft.evidenceRef.trim();
  if (codePoints(evidence) > RECALL_EVIDENCE_MAX) return refused(`The evidence reference is at most ${RECALL_EVIDENCE_MAX} characters.`);
  return {
    body: {
      note,
      ...(release.length === 0 ? {} : { releaseBatchIds: [...release].sort() }),
      ...(release.length > 0 && override !== '' ? { overrideReason: override } : {}),
      ...(unaccounted.length > 0 ? { acknowledgeUnaccounted: true } : {}),
      ...(notes.length === 0 ? {} : { dispositionNotes: notes.sort((a, b) => a.batchId.localeCompare(b.batchId)) }),
      ...(evidence === '' ? {} : { evidenceRef: evidence }),
    },
    problem: null,
  };
}

// ── outcomes (built from the RESPONSE) ───────────────────────────────────────

type Snapshot = { readonly code: string; readonly mode: string; readonly lots: readonly { readonly blockedByRecall: boolean }[] };

/** The banner after an open: "Recall RCL-000001 opened — 2 lots blocked in every warehouse; 1 already blocked keeps its reason." */
export function openRecallOutcome(recall: Snapshot): { readonly word: string; readonly reason: string } {
  const n = recall.lots.length;
  const lots = `${n} ${n === 1 ? 'lot' : 'lots'}`;
  if (recall.mode === 'mock') return { word: `Mock recall ${recall.code} opened`, reason: `${lots} traced — a drill: nothing was blocked.` };
  const blocked = recall.lots.filter((lot) => lot.blockedByRecall).length;
  const kept = n - blocked;
  const head = `${blocked} ${blocked === 1 ? 'lot' : 'lots'} blocked in every warehouse`;
  return {
    word: `Recall ${recall.code} opened`,
    reason: kept === 0 ? `${head}.` : `${head}; ${kept} already blocked ${kept === 1 ? 'keeps its' : 'keep their'} reason.`,
  };
}

/** The banner after lots are added. */
export function addBatchesOutcome(recall: Snapshot, added: number): { readonly word: string; readonly reason: string } {
  const lots = `${added} ${added === 1 ? 'lot' : 'lots'}`;
  return {
    word: `Added to ${recall.code}`,
    reason: recall.mode === 'mock' ? `${lots} added to the drill — nothing was blocked.` : `${lots} added — blocked in every warehouse unless already blocked.`,
  };
}

/** The banner after a close. */
export function closeRecallOutcome(recall: { readonly code: string; readonly releasedBatchIds: readonly string[] | null }): { readonly word: string; readonly reason: string } {
  const released = recall.releasedBatchIds?.length ?? 0;
  return {
    word: `Recall ${recall.code} closed`,
    reason:
      released === 0
        ? 'The figures are frozen as of now. Every lot stays blocked — unblock one later from Batches.'
        : `The figures are frozen as of now; ${released} ${released === 1 ? 'lot was' : 'lots were'} unblocked. The rest stay blocked.`,
  };
}

// ── refusals ─────────────────────────────────────────────────────────────────

function codesOf(error: ApiProblem, key: string): string | null {
  const raw = error.extensions[key];
  if (!Array.isArray(raw)) return null;
  const codes = raw.filter((value): value is string => typeof value === 'string' && value !== '');
  return codes.length === 0 ? null : codes.join(', ');
}

export type RecallVerb = 'open' | 'add' | 'close';

const NOT_DONE: Readonly<Record<RecallVerb, string>> = { open: 'Not opened', add: 'Not added', close: 'Not closed' };

/** The rejected banner's word for a verb. */
export function recallRefusalWord(verb: RecallVerb): string {
  return NOT_DONE[verb];
}

/** A refusal of open / add / close in words, by code — never the server's prose for a known code. */
export function recallReason(error: unknown, verb: RecallVerb): string {
  if (!(error instanceof ApiProblem)) return UNREACHABLE_REASON;
  switch (error.code) {
    case 'mixed-client':
      return verb === 'add'
        ? "A lot belongs to another client — a recall holds one client's lots only."
        : "These lots belong to more than one client — a recall covers one client's lots. Open one per client, linked by the brand reference.";
    case 'batch-already-recalled': {
      const codes = codesOf(error, 'recallCodes');
      return codes === null
        ? 'A lot is already on an open recall — untick it, or add it to that recall.'
        : `A lot is already on open recall ${codes} — untick it, or add it to ${codes} instead.`;
    }
    case 'recall-not-open':
      return 'This recall is already closed — refresh it.';
    case 'recall-too-many-lots':
      return `A recall holds at most ${RECALL_MAX_LOTS} lots — open another recall for the rest, linked by the brand reference.`;
    case 'recall-batch-not-on-recall':
      return 'A lot named is not on this recall — refresh the recall.';
    case 'recall-release-not-eligible': {
      const codes = codesOf(error, 'batchCodes') ?? 'A lot';
      return `${codes} cannot be released here — this recall did not block it, or it is no longer blocked for the recall. Refresh the recall.`;
    }
    case 'recall-release-has-stock': {
      const codes = codesOf(error, 'batchCodes') ?? 'A lot';
      return `${codes} still has stock on hand, in transit or in open orders — say why it may be released anyway, or leave it blocked.`;
    }
    case 'recall-unaccounted': {
      const codes = codesOf(error, 'batchCodes') ?? 'A lot';
      return `${codes}: the stock does not match the ledger history — tick the acknowledgement to close anyway.`;
    }
    case 'recall-open-contended':
      return 'A lot is being picked, dispatched, blocked or recalled right now — nothing was changed. Try again in a moment.';
    case 'not-found':
      return verb === 'close' ? 'This recall no longer exists — refresh the list.' : 'A lot (or the recall) no longer exists — search the code again.';
    case 'role-denied':
      return 'Your role cannot open or close recalls — an owner or ops manager can.';
    case 'permission-denied':
      return 'That recall belongs to another tenant — sign in again.';
    case 'idempotency-key-reuse':
      return 'This request was already sent with different details — change nothing and try again, or start over.';
    case 'conflict':
      return 'The same request is already in flight — wait a moment, then refresh.';
    case 'unauthenticated':
      return 'Your session expired — sign in again.';
    case 'validation-failed':
      return error.detail ?? 'Check the fields and try again.';
    default:
      return error.detail ?? `${NOT_DONE[verb]} (${error.code}).`;
  }
}

/** True for the refusals that mean the recall moved on under you — the detail re-reads. */
export function recallReasonStale(error: unknown): boolean {
  return (
    error instanceof ApiProblem &&
    ['recall-not-open', 'recall-release-not-eligible', 'recall-release-has-stock', 'recall-unaccounted', 'recall-batch-not-on-recall'].includes(error.code)
  );
}

/** A recall read's failure (the list, the detail, the candidates, a trace page). */
export function recallReadReason(error: unknown, subject: string): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'report-unavailable':
        return `${subject} took too long to read — try again.`;
      case 'not-found':
        return `${subject} could not be found — it may have been removed, or the client no longer exists.`;
      case 'role-denied':
        return 'This list is for warehouse staff.';
      case 'validation-failed':
        return error.detail ?? `${subject} could not be read with these filters.`;
      default:
        return readReason(error, subject);
    }
  }
  return UNREACHABLE_REASON;
}

/** The report download's refusal — the XLSX cap points at the CSV. */
export function recallReportReason(error: unknown, format: RecallReportFormat): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'report-too-large':
        return format === 'xlsx'
          ? `This report is over ${RECALL_XLSX_MAX_ROWS.toLocaleString('en-IN')} rows — too big for one spreadsheet. Download the CSV instead: it carries every row.`
          : 'This report is too large to prepare — try again later.';
      case 'report-unavailable':
        return 'A recall report is already being prepared, or the server is busy — try again in a few seconds.';
      case 'not-found':
        return 'This recall could not be found — it may not belong to your company.';
      case 'client-suspended':
        return "Your company's portal access is suspended.";
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'role-denied':
      case 'permission-denied':
        return 'Your session cannot download this report — sign in again.';
      default:
        return error.detail ?? `Could not prepare the report (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** True when the refusal is the XLSX cap — the CSV button is the way out. */
export function reportNeedsCsv(error: unknown): boolean {
  return error instanceof ApiProblem && error.code === 'report-too-large';
}

/**
 * The downloaded file's name (CORS hides the server's `Content-Disposition`):
 * `recall-RCL-000001-mock-2026-10-28.csv` — the code, MOCK when a drill, and
 * the IST date of `now`.
 */
export function recallReportFilename(input: { code: string; mode: string; format: RecallReportFormat; now: number }): string {
  const code = input.code.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'recall';
  return `recall-${code}${input.mode === 'mock' ? '-mock' : ''}-${istDateOf(input.now)}.${input.format}`;
}

/** The download banner: what landed, and that the CSV's last row says it is complete. */
export function reportDownloadedLabel(format: RecallReportFormat, filename: string): string {
  return format === 'csv'
    ? `${filename} downloaded. Its last row (section "end") carries the row count — a file without it was cut short.`
    : `${filename} downloaded.`;
}
