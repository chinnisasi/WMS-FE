import { ApiProblem } from '@/lib/api/client';
import type {
  CountVarianceEntryResponseDto,
  RejectedGrnLineDto,
  RejectedOpResponse,
  ReturnEntryRefusedDto,
} from '@/lib/api/generated';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { shortIdTail } from '@/lib/audit';
import { RETURN_CONDITION_LABEL } from '@/lib/returns';

/**
 * The Conflicts & Reviews queue's pure decisions (story 5-5, the
 * `over-receipt.ts`/`excursion.ts` pattern): the approve_adjust statement's
 * shape, the owner-only over-threshold flag, and the machine-problem reason
 * strings of the variance and adjustment-pending queues' reads and decisions.
 * Clients branch on the problem `code`, never on prose.
 */

/**
 * The backend's `consideredEventSeqs` ceiling on the resolve request
 * (`@Size(max=200)`) — approve_adjust states what it consulted, and a
 * statement longer than this is refused. A checkbox selection past the cap
 * is refused client-side for the same reason the statement exists at all:
 * an unexplained correction is not buildable from this UI.
 */
export const MAX_CONSIDERED_EVENT_SEQS = 200;

/**
 * The approve_adjust arm's consulted-seqs requirement: the statement is the
 * flow's backbone — the server stores it, audits it, and validates every
 * seq against the bin's warehouse ledger, so client selection cannot
 * fabricate history. Refused client-side (non-empty, within 200) only where
 * the rule is knowable without a DB row; duplicates are NOT checked here —
 * the sender normalizes (dedupes + sorts) at send. Everything else is the
 * 400/409 the server answers.
 */
export function resolveDraftProblem(
  decision: 'approve_adjust' | 'recount',
  consideredEventSeqs: readonly number[],
): string | null {
  if (decision === 'recount') return null;
  if (consideredEventSeqs.length === 0) {
    return 'Select the ledger events you checked before approving the correction — an unexplained adjustment cannot be approved.';
  }
  if (consideredEventSeqs.length > MAX_CONSIDERED_EVENT_SEQS) {
    return `Select at most ${MAX_CONSIDERED_EVENT_SEQS} ledger events for this resolution.`;
  }
  return null;
}

/**
 * The submit-frozen threshold's owner-only carve-out: strictly over the
 * threshold is an owner decision (`variance-owner-required` below owner) —
 * at-threshold resolves by manager too, and `null` threshold means the
 * policy was disabled when the variance submitted, so every size is a
 * manager decision. The card flags the badge; it never hides the card — an
 * ops_manager sees the card and the 403 names the gate.
 */
export function isOwnerOnlyVariance(entry: CountVarianceEntryResponseDto): boolean {
  return entry.thresholdQuantity !== null && Math.abs(entry.delta) > entry.thresholdQuantity;
}

/** The variance list read's failure reasons (the `excursionListReason` shape). */
export function varianceListReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'invalid-cursor':
        return 'That page reference is stale — the queue restarted from the first page.';
      // No not-found arm: the variances list route has no 404 server-side.
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the queue filters and try again.';
      default:
        return error.detail ?? 'Could not load the variance queue.';
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * The variance resolve command's failure reasons (capability
 * `variances.resolve`). The 409 arms mirror the excursion-over-decided
 * pattern: two are recoverable by reload (`variance-resolved`) or by the
 * sibling arm the server names as the remedy (`variance-basis-moved` →
 * recount), and both say so instead of rendering a raw conflict.
 */
export function varianceResolveReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'variance-resolved':
        return 'This variance was already resolved — the queue has refreshed.';
      case 'variance-basis-moved':
        return 'The bin moved while this variance was open: the frozen basis no longer matches. Open a recount instead — the recount becomes the corrected basis.';
      case 'variance-owner-required':
        return 'This variance is over the threshold frozen at submit, so only an owner can resolve it.';
      case 'count-task-open':
        return 'This bin already has an open count task — the recount arm needs the bin free.';
      case 'not-found':
        return 'This variance no longer exists — refresh the queue.';
      case 'role-denied':
        return 'Your role cannot resolve count variances.';
      case 'idempotency-key-reuse':
        return 'This resolution was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the consulted events and try again.';
      default:
        return error.detail ?? `Resolve failed (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** The adjustment-pending list read's failure reasons (the same shape). */
export function adjustmentListReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'invalid-cursor':
        return 'That page reference is stale — the queue restarted from the first page.';
      case 'not-found':
        return 'This tenant no longer exists — refresh the page.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the queue filters and try again.';
      default:
        return error.detail ?? 'Could not load the adjustment-pending queue.';
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * An adjustment-pending decide command's failure reasons (capability
 * `adjustments.approve`). `adjustment-pending-decided` is the
 * already-decided 409 the queue recovers from by reloading; the re-execution
 * refusals (a moved world answered verbatim by the approve arm's guard set —
 * `kit-cannot-hold-stock`, `insufficient-on-hand`, a retired bin) render the
 * server's own words, because the cause lives in state this client holds no
 * DTO for and the row stays pending either way.
 */
export function adjustmentDecisionReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (
      error.status === 409 &&
      error.code !== 'adjustment-pending-decided' &&
      error.code !== 'conflict' &&
      error.code !== 'idempotency-key-reuse'
    ) {
      // A guard-class 409 from the approve arm's re-execution — the world
      // moved since the pend (bin retired, an active handling unit gone…).
      // The server's own words are the only explanation this client can
      // render, and the row stays pending on the server.
      return error.title !== undefined
        ? `${error.title}${error.detail === undefined ? '' : ` — ${error.detail}`}`
        : (error.detail ?? `The decision was refused (${error.code}).`);
    }
    switch (error.code) {
      case 'adjustment-pending-decided':
        return 'This pending adjustment was already decided — the queue has refreshed.';
      case 'conflict':
        return 'Another decision was in flight — the queue has refreshed.';
      case 'insufficient-on-hand':
        return 'The pend cannot settle: the stock it draws from is no longer there. The row stays pending — reject it and re-raise the adjustment.';
      case 'kit-cannot-hold-stock':
        return 'This SKU became a kit since the adjustment was raised — kits hold no stock. The row stays pending for a reject.';
      case 'idempotency-key-reuse':
        return 'This decision was already processed — click again to send a fresh request.';
      case 'not-found':
        return 'This pending adjustment no longer exists — refresh the queue.';
      case 'role-denied':
        return 'Your role cannot decide pending adjustments.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the request and try again.';
      default:
        return error.detail ?? `Decision failed (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * The ledger panel's list-read failure reasons — the bin history walk the
 * approve arm requires. Its default arm carries the house unreachable copy
 * from the transport arm, like every read mapper.
 */
export function ledgerListReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'invalid-cursor':
        return 'That page reference is stale — the timeline restarted from the first page.';
      case 'not-found':
        // The events route's 404 is the WAREHOUSE (a bin is only a query
        // filter, never a 404 of its own).
        return 'This warehouse no longer exists — refresh the queue.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the timeline filters and try again.';
      default:
        return error.detail ?? 'Could not load the ledger timeline.';
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * The sync-report payload's bin-field probe — EXACTLY the server's recount
 * arm's read (`payload.binId ?? payload.toBinId`): a pick/count/pack or
 * excursion payload names its bin as `binId`, a transfer/putaway placement
 * names it as `toBinId`, and the recount arm serves BOTH (so the ledger walk
 * and the bin label follow the same). The probe that read `binId` alone hid a
 * placement row's recount though the server would have served it (review
 * Entry D) — every client-side bin gate reads through this helper.
 */
export function rejectedOpPayloadBinId(payload: Record<string, unknown>): string | null {
  const direct = payload['binId'];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const placement = payload['toBinId'];
  return typeof placement === 'string' && placement.length > 0 ? placement : null;
}

/** The rejected-ops list read's failure reasons (the same shape). */
export function rejectedOpsListReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'invalid-cursor':
        return 'That page reference is stale — the queue restarted from the first page.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the queue filters and try again.';
      default:
        return error.detail ?? 'Could not load the rejected-ops queue.';
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * A rejected-op resolve command's failure reasons (capability
 * `review.decide`). The apply and recount arms RE-EXECUTE against the live
 * guard set, so their refusals surface the server's own words verbatim (the
 * `adjustmentDecisionReason` guard-class pattern) — the cause lives in state
 * this client holds no DTO for, and the row stays open on either side. Two
 * 409s are recoverable: `rejected-op-resolved` (another reviewer moved
 * first) reloads the queue; `count-task-open` names the bin's open count
 * task. The recount arm's payload-less refusal is a 400 BACKSTOP — the
 * client never sends recount without a bin, so reaching it is a defect.
 */
export function rejectedOpsResolveReason(error: unknown, entry?: Pick<RejectedOpResponse, 'opType'>): string {
  if (error instanceof ApiProblem) {
    // Story 1-6d — a licence row's Apply is owner-only (`licences.manage`):
    // its 403 names that, so the server's own detail is shown.
    if (error.code === 'role-denied' && entry?.opType === 'grn.licence-refused' && error.detail !== undefined) {
      return error.detail;
    }
    switch (error.code) {
      case 'rejected-op-resolved':
        return 'This rejected op was already resolved — the queue has refreshed.';
      case 'count-task-open':
        return 'This bin already has an open count task — the recount arm needs the bin free.';
      case 'idempotency-key-reuse':
        return 'This resolution was already processed.';
      case 'not-found':
        // The 404 is ambiguous BY DESIGN: it covers the op row itself AND an
        // inner command's re-executed refusal (a re-applied putaway whose bin
        // vanished names the bin). The server's detail is the truth; the
        // fallback reads as the op itself.
        return error.detail ?? 'This rejected op no longer exists — refresh the queue.';
      case 'role-denied':
        return 'Your role cannot resolve rejected ops.';
      case 'decision-not-available':
        // Story 13-2 — the per-type rule (a return.receive row is Discard
        // only); the buttons follow it, so reaching this is a stale page.
        return 'That decision is not available for this op — refresh the queue.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the request and try again.';
    }
    // The apply/recount re-execution's own refusals — a 403 device-revoked
    // (the device was revoked since the op ran), or a 409 the re-executed
    // command raised (`insufficient-on-hand`, a bin epoch moved…) — render
    // the server's own words; the row stays open either way.
    if (error.status === 403 || error.status === 409) {
      return error.title !== undefined
        ? `${error.title}${error.detail === undefined ? '' : ` — ${error.detail}`}`
        : (error.detail ?? `The resolution was refused (${error.code}).`);
    }
    return error.detail ?? `Resolve failed (${error.code}).`;
  }
  return UNREACHABLE_REASON;
}

// ── story 13-2: per-type decisions and the return.receive summary ──────────

export type RejectedOpDecision = 'apply' | 'recount' | 'discard';

/** The decisions every pre-13-2 row admitted (recount still needs a payload bin). */
const LEGACY_DECISIONS: readonly RejectedOpDecision[] = ['apply', 'recount', 'discard'];

/**
 * The decision buttons a row offers: the server's per-type rule
 * (`decisions`, story 13-2 — a `return.receive` row is `['discard']`), else
 * the pre-13-2 behaviour when the field is absent (an old resolve snapshot).
 * Recount additionally needs a payload bin — the server's own recount read.
 */
export function rejectedOpDecisions(
  entry: Pick<RejectedOpResponse, 'decisions' | 'payload'>,
): readonly RejectedOpDecision[] {
  const admitted = entry.decisions ?? LEGACY_DECISIONS;
  return admitted.filter((decision) => decision !== 'recount' || rejectedOpPayloadBinId(entry.payload) !== null);
}

/** The authorization remedy (human decision 4 — Discard only): the units were not on the return. */
export const RETURN_RECEIVE_REVIEW_GUIDANCE = 'Create a return authorization for these units, then receive them again.';

/** The re-scan remedy: the authorization covers them, the capture was wrong. */
export const RETURN_RECAPTURE_GUIDANCE = 'Re-scan these units with the correct capture (serial, batch, weight or quantity), then receive them again.';

/** The master-data remedy: a location or warehouse problem, not the units. */
export const RETURN_MASTER_DATA_GUIDANCE = 'Fix the location or warehouse master data, then receive these units again.';

/** The closed-authorization remedy. */
export const RETURN_RMA_CLOSED_GUIDANCE =
  'The return authorization is cancelled or already received — create a new one for these units, then receive them again.';

/** Why a returned unit was not booked, in words — a `Record` over the generated union. */
export const RETURN_REFUSAL_LABEL: Readonly<Record<ReturnEntryRefusedDto['reason'], string>> = {
  'not-on-authorization': 'not on the return',
  'exceeds-authorized': 'more than authorized',
  'serial-not-authorized': 'serial not authorized',
  'serial-in-stock': 'serial already in stock',
  'batch-not-dispatched': 'batch not dispatched',
  'missing-capture': 'capture missing',
  'unexpected-capture': 'capture not expected',
  'weight-out-of-range': 'weight out of range',
  'qty-precision': 'quantity too precise',
};

/** Per refusal reason / whole-op problem code, the remedy a reviewer reads. */
const GUIDANCE_BY_CODE: Readonly<Record<string, string>> = {
  'not-on-authorization': RETURN_RECEIVE_REVIEW_GUIDANCE,
  'exceeds-authorized': RETURN_RECEIVE_REVIEW_GUIDANCE,
  'serial-not-authorized': RETURN_RECEIVE_REVIEW_GUIDANCE,
  'return-entries-refused': RETURN_RECEIVE_REVIEW_GUIDANCE,
  'missing-capture': RETURN_RECAPTURE_GUIDANCE,
  'unexpected-capture': RETURN_RECAPTURE_GUIDANCE,
  'weight-out-of-range': RETURN_RECAPTURE_GUIDANCE,
  'qty-precision': RETURN_RECAPTURE_GUIDANCE,
  'batch-not-dispatched': RETURN_RECAPTURE_GUIDANCE,
  'serial-in-stock': RETURN_RECAPTURE_GUIDANCE,
  'returns-bin-conflict': RETURN_MASTER_DATA_GUIDANCE,
  'document-warehouse-mismatch': RETURN_MASTER_DATA_GUIDANCE,
  'rma-not-receivable': RETURN_RMA_CLOSED_GUIDANCE,
};

/**
 * The remedies a `return.receive` row's reviewer reads (story 13-2), one per
 * distinct remedy, in the order the row's reasons first name them: a
 * server-raised row reads its `refusals`, a device-uploaded whole-op row its
 * `problemCode`. Empty for any other op type (the guidance is a returns
 * thing); an unknown code falls back to the authorization remedy.
 */
export function returnReceiveGuidance(entry: Pick<RejectedOpResponse, 'opType' | 'payload' | 'problemCode'>): readonly string[] {
  if (entry.opType !== 'return.receive') return [];
  const refusals = Array.isArray(entry.payload['refusals']) ? (entry.payload['refusals'] as Record<string, unknown>[]) : null;
  const codes = refusals === null ? [entry.problemCode] : refusals.map((item) => String(item['reason'] ?? entry.problemCode));
  const out: string[] = [];
  for (const code of codes) {
    const guidance = GUIDANCE_BY_CODE[code] ?? RETURN_RECEIVE_REVIEW_GUIDANCE;
    if (!out.includes(guidance)) out.push(guidance);
  }
  return out;
}

// ── story 1-1: a blind receipt's lines of another client ─────────────────────

/**
 * Why a goods receipt line was not booked, in words — a `Record` over the
 * generated union, so a new reason without words is a compile error. Story
 * 1-1 adds `sku-client-mismatch`: a blind receipt's line whose SKU belongs
 * to another client than the receipt's.
 */
export const GRN_REFUSAL_LABEL: Readonly<Record<RejectedGrnLineDto['code'], string>> = {
  'po-line-not-found': 'not on the purchase order',
  'po-line-not-open': 'purchase order line not open',
  'asn-line-not-found': 'not on the shipment notice',
  'sku-client-mismatch': "another client's SKU",
  // Story 1-2a — a line of any receipt whose SKU's client has departed.
  'client-departed': 'its client has departed',
  // Story 1-2b — the expiry rules, each per line.
  'expiry-on-untracked': 'expiry date on an untracked SKU',
  'expiry-before-mfg': 'expiry date before its mfg date',
  'batch-expiry-mismatch': "expiry date differs from its batch's",
  'expiry-required': 'expiry date required',
  'shelf-life-short': 'shelf life too short',
  // Story 1-6d — licence enforcement: no valid client and site licence on the receipt date.
  'licence-not-covered': 'no valid licence',
};

/** The remedy a `grn.lines-refused` row's reviewer reads (Discard only). */
export const GRN_CLIENT_GUIDANCE = 'Receive these lines again on a receipt for their own client, then discard this row.';

/** Story 1-2a — the remedy when the lines were refused because their client departed. */
export const GRN_DEPARTED_GUIDANCE =
  'Their client has departed — an owner can reactivate it in Settings → Clients; receive these lines again after that, then discard this row.';

/** Story 1-2b — the remedies for the expiry refusals of a `grn.lines-refused` row. */
export const GRN_EXPIRY_ON_UNTRACKED_GUIDANCE =
  'These SKUs are not batch-tracked, so they carry no expiry date — receive these lines again without one, then discard this row.';
export const GRN_EXPIRY_BEFORE_MFG_GUIDANCE =
  'The expiry date is before the mfg date — check the label, receive these lines again with the right dates, then discard this row.';
export const GRN_BATCH_EXPIRY_MISMATCH_GUIDANCE =
  "The expiry date differs from the one this batch already has (or another line's for the same batch) — check the label; receive these lines again with the batch's expiry, or under their own batch code, then discard this row.";
export const GRN_EXPIRY_REQUIRED_GUIDANCE =
  "This client requires an expiry date on batch-tracked goods — receive these lines again with the label's expiry date, then discard this row.";

/** Story 1-2b — the `grn.shelf-life-refused` row's remedy (Accept anyway with a note, or Discard). */
export const GRN_SHELF_LIFE_GUIDANCE =
  "Short-dated for this client's minimum: accept them anyway with a note saying why (they book as on any receipt — QC and tolerance still apply), or discard this row and return the goods.";

/** Story 1-6d — the `grn.licence-refused` row's remedy (an owner accepts with a note, or Discard). */
export const GRN_LICENCE_GUIDANCE =
  'No valid client and site licence covered these goods on the receipt date: an owner can accept them anyway with a note saying why (they book as on any receipt), or discard this row and return the goods. Add or renew the licence under Compliance → Licences.';

/** Story 1-6d — what a non-owner reads where the licence row's Accept anyway would be. */
export const GRN_LICENCE_OWNER_ONLY = 'An owner can accept these';

/**
 * The remedy per `grn.lines-refused` code, in the server's `problemCode`
 * precedence order (`client-departed` > `sku-client-mismatch` >
 * `batch-expiry-mismatch` > `expiry-before-mfg` > `expiry-on-untracked` >
 * `expiry-required`) — the row's remedies read in this order.
 */
const GRN_LINES_GUIDANCE: readonly (readonly [RejectedGrnLineDto['code'], string])[] = [
  ['client-departed', GRN_DEPARTED_GUIDANCE],
  ['sku-client-mismatch', GRN_CLIENT_GUIDANCE],
  ['batch-expiry-mismatch', GRN_BATCH_EXPIRY_MISMATCH_GUIDANCE],
  ['expiry-before-mfg', GRN_EXPIRY_BEFORE_MFG_GUIDANCE],
  ['expiry-on-untracked', GRN_EXPIRY_ON_UNTRACKED_GUIDANCE],
  ['expiry-required', GRN_EXPIRY_REQUIRED_GUIDANCE],
];

/**
 * Every remedy a row's reviewer reads: the returns remedies for a
 * `return.receive` row; for a `grn.lines-refused` row one remedy per
 * distinct refusal code its lines carry (story 1-2b — a row may mix codes;
 * a row whose refusals name none reads its `problemCode`), in precedence
 * order; the Accept-anyway remedy for a `grn.shelf-life-refused` row; none
 * otherwise.
 */
export function rejectedOpGuidance(entry: Pick<RejectedOpResponse, 'opType' | 'payload' | 'problemCode'>): readonly string[] {
  if (entry.opType === 'grn.shelf-life-refused') return [GRN_SHELF_LIFE_GUIDANCE];
  if (entry.opType === 'grn.licence-refused') return [GRN_LICENCE_GUIDANCE];
  // Story 1-4b — one line per inactive SKU the receipt booked.
  if (isInactiveSkuFlag(entry)) return inactiveSkuCodesOf(entry).map(inactiveSkuGuidance);
  if (entry.opType === 'grn.lines-refused') {
    const refusals = Array.isArray(entry.payload['refusals']) ? (entry.payload['refusals'] as unknown[]) : [];
    const codes = new Set<string>([entry.problemCode]);
    for (const refusal of refusals) {
      const reason = typeof refusal === 'object' && refusal !== null ? (refusal as Record<string, unknown>)['reason'] : undefined;
      if (typeof reason === 'string') codes.add(reason);
    }
    const out = GRN_LINES_GUIDANCE.filter(([code]) => codes.has(code)).map(([, guidance]) => guidance);
    return out.length > 0 ? out : [GRN_CLIENT_GUIDANCE];
  }
  return returnReceiveGuidance(entry);
}

/**
 * Story 1-2b — what the waived re-run of an Accept anyway actually did, read
 * from the resolve's outcome (`outcome.snapshot` is the re-run receipt's own
 * answer): "N line(s) booked on GRN-…; M refused again: <reasons>". The
 * re-run applies every other rule (departure, tolerance, a batch's expiry),
 * so lines can be refused again — or no receipt recorded at all. Null when
 * the outcome carries no recognisable snapshot. Story 1-6d renamed it (it
 * was `shelfLifeRerunSummary`) — the licence row's Accept anyway reads the
 * same answer; the output is unchanged.
 */
export function waivedRerunSummary(outcome: Record<string, unknown> | null): string | null {
  const snapshot = outcome?.['snapshot'];
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  const goodsReceipt = (snapshot as { goodsReceipt?: unknown }).goodsReceipt;
  const refusedReceipt = (snapshot as { refusedReceipt?: unknown }).refusedReceipt;
  const codesOf = (lines: unknown): string[] =>
    Array.isArray(lines)
      ? lines.map((line) => (typeof line === 'object' && line !== null ? String((line as { code?: unknown }).code ?? '') : '')).filter((code) => code !== '')
      : [];
  const refusedWords = (codes: string[]): string =>
    `${codes.length} refused again: ${[...new Set(codes)].map(grnRefusalWords).join(', ')}`;
  if (goodsReceipt === null) {
    const codes = codesOf((refusedReceipt as { rejectedLines?: unknown } | undefined)?.rejectedLines);
    return codes.length === 0 ? 'No receipt was recorded' : `No line booked; ${refusedWords(codes)}`;
  }
  if (typeof goodsReceipt !== 'object') return null;
  const grn = goodsReceipt as { code?: unknown; lines?: unknown; rejectedLines?: unknown };
  const booked = Array.isArray(grn.lines) ? grn.lines.length : 0;
  const head = `${booked} line(s) booked on ${typeof grn.code === 'string' ? grn.code : 'the receipt'}`;
  const codes = codesOf(grn.rejectedLines);
  return codes.length === 0 ? head : `${head}; ${refusedWords(codes)}`;
}

function grnRefusalWords(reason: string): string {
  return (GRN_REFUSAL_LABEL as Readonly<Record<string, string>>)[reason] ?? reason;
}

/**
 * A `grn.lines-refused` row's summary (story 1-1, server-raised): the
 * receipt and its client, then each refused line naming the client its SKU
 * belongs to — the stored `skuCode` and `skuClientLabel` the server froze
 * with the row (the catalog may have moved since; the row says what was
 * refused). `lines[i]` pairs with `refusals[i]`.
 */
function grnLinesRefusedSummary(
  entry: Pick<RejectedOpResponse, 'opType' | 'payload' | 'problemCode'>,
  skuLabel: (skuId: string) => string | null,
): { heading: string; lines: readonly string[] } {
  const payload = entry.payload;
  const grnCode = typeof payload['grnCode'] === 'string' ? payload['grnCode'] : null;
  const grnId = typeof payload['grnId'] === 'string' ? payload['grnId'] : null;
  const grn = grnCode ?? (grnId === null ? 'unknown receipt' : `receipt …${shortIdTail(grnId)}`);
  const clientLabel = typeof payload['clientLabel'] === 'string' ? payload['clientLabel'] : null;
  const lines = Array.isArray(payload['lines']) ? (payload['lines'] as Record<string, unknown>[]) : [];
  const refusals = Array.isArray(payload['refusals']) ? (payload['refusals'] as Record<string, unknown>[]) : [];
  const rendered = lines.map((item, index) => {
    const refusal = refusals[index] ?? {};
    const skuId = typeof item['skuId'] === 'string' ? item['skuId'] : '';
    const sku =
      (typeof refusal['skuCode'] === 'string' ? refusal['skuCode'] : null) ??
      skuLabel(skuId) ??
      (skuId === '' ? 'unknown SKU' : `SKU …${shortIdTail(skuId)}`);
    const qty = typeof item['qty'] === 'number' ? item['qty'] : '?';
    const parts = [`${sku} × ${qty}`];
    const batchCode = typeof refusal['batchCode'] === 'string' ? refusal['batchCode'] : item['batchCode'];
    if (typeof batchCode === 'string') parts.push(`batch ${batchCode}`);
    // Story 1-2b — the expiry the rule judged (the refusal's; else the line's own).
    const expiry = typeof refusal['expiryDate'] === 'string' ? refusal['expiryDate'] : item['expiryDate'];
    if (typeof expiry === 'string') parts.push(`expires ${expiry}`);
    const owner = typeof refusal['skuClientLabel'] === 'string' ? refusal['skuClientLabel'] : null;
    const reason = grnRefusalWords(String(refusal['reason'] ?? entry.problemCode));
    // Story 1-6d — a licence refusal names each missing need and holder.
    const detail = shelfLifeWords(refusal) ?? missingLicenceWords(refusal);
    return `${parts.join(' · ')} — ${reason}${detail === null ? '' : ` (${detail})`}${owner === null ? '' : ` (${owner})`}`;
  });
  const count = lines.length;
  const noun = `${count} line${count === 1 ? '' : 's'}`;
  if (isWaivableOpType(entry.opType)) {
    return { heading: WAIVER_COPY[entry.opType].heading(grn, noun, clientLabel), lines: rendered };
  }
  const forClient =
    clientLabel === null
      ? ''
      : entry.problemCode === 'client-departed'
        ? ` — ${clientLabel} has departed`
        : ` on a receipt for ${clientLabel}`;
  return { heading: `${grn} — ${noun} not booked${forClient}`, lines: rendered };
}

/**
 * Story 1-2b — a short-dated refusal's numbers: the days left and the
 * client's minimum (`0 days left, minimum 0` reads as expired — a client
 * that requires expiry with no minimum refuses an expired batch). Null when
 * the refusal carries neither.
 */
function shelfLifeWords(refusal: Record<string, unknown>): string | null {
  const remaining = typeof refusal['remainingDays'] === 'number' ? refusal['remainingDays'] : null;
  const minimum = typeof refusal['minShelfLifeDays'] === 'number' ? refusal['minShelfLifeDays'] : null;
  if (remaining === null && minimum === null) return null;
  const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
  const left = remaining === null ? null : remaining < 0 ? `expired ${days(-remaining)} ago` : `${days(remaining)} left`;
  const floor = minimum === null ? null : minimum === 0 ? 'expired goods refused' : `minimum ${days(minimum)}`;
  return [left, floor].filter((part) => part !== null).join(', ');
}

/** Story 1-6d — the licence a need calls for, short (`FSSAI licence — site`). */
const MISSING_NEED_WORDS: Readonly<Record<string, string>> = {
  'drug-20b': 'Form 20B',
  'drug-21b': 'Form 21B',
  'drug-20g': 'Form 20G',
  ndps: 'NDPS licence',
  fssai: 'FSSAI licence',
};

/**
 * Story 1-6d — a licence refusal's `missing` entries, worded: `FSSAI licence
 * — site; NDPS licence — client`. Read defensively (a stored row is data);
 * null when the refusal carries none.
 */
export function missingLicenceWords(refusal: Record<string, unknown>): string | null {
  const missing = refusal['missing'];
  if (!Array.isArray(missing)) return null;
  const words = missing
    .map((item) => {
      if (typeof item !== 'object' || item === null) return null;
      const need = (item as Record<string, unknown>)['need'];
      const holder = (item as Record<string, unknown>)['holder'];
      if (typeof need !== 'string' || (holder !== 'client' && holder !== 'site')) return null;
      return `${MISSING_NEED_WORDS[need] ?? need} — ${holder}`;
    })
    .filter((word): word is string => word !== null);
  return words.length === 0 ? null : words.join('; ');
}

function refusalWords(reason: string): string {
  return (RETURN_REFUSAL_LABEL as Readonly<Record<string, string>>)[reason] ?? reason;
}

function conditionWords(condition: unknown): string | null {
  if (typeof condition !== 'string') return null;
  return (RETURN_CONDITION_LABEL as Readonly<Record<string, string>>)[condition] ?? condition;
}

/**
 * A `return.receive` row's summary (story 13-2): the RMA (its code, else a
 * short form of its id) and each refused entry with its reason. A
 * server-raised row (`return-entries-refused`) pairs `entries[i]` with
 * `refusals[i]`; a device-uploaded whole-op refusal carries the whole op, so
 * every entry reads with the row's problem code. Story 1-1: a
 * `grn.lines-refused` row reads `grnLinesRefusedSummary`. Null for any other
 * op type. `skuCode` resolves a SKU id to its label (`skuDisplayLabel` —
 * the code, with its client once the tenant has several) when the caller
 * has the catalog.
 */
export function rejectedOpSummary(
  entry: Pick<RejectedOpResponse, 'opType' | 'payload' | 'problemCode'>,
  skuCode: (skuId: string) => string | null = () => null,
): { heading: string; lines: readonly string[] } | null {
  // Story 1-2b — a `grn.shelf-life-refused` row has the same shape (the
  // receipt's header plus its short-dated lines, `lines[i]` ↔ `refusals[i]`).
  // Story 1-6d — so has a `grn.licence-refused` row (its lines and their `missing`).
  if (entry.opType === 'grn.lines-refused' || isWaivableOpType(entry.opType)) return grnLinesRefusedSummary(entry, skuCode);
  if (isInactiveSkuFlag(entry)) return inactiveSkuReceivedSummary(entry, skuCode);
  if (entry.opType !== 'return.receive') return null;
  const payload = entry.payload;
  const rmaCode = typeof payload['rmaCode'] === 'string' ? payload['rmaCode'] : null;
  const rmaId = typeof payload['rmaId'] === 'string' ? payload['rmaId'] : null;
  // The random tail (`shortIdTail`) — a UUIDv7's head is its timestamp (guide §1.10).
  const rma = rmaCode ?? (rmaId === null ? 'unknown return' : `return …${shortIdTail(rmaId)}`);
  const entries = Array.isArray(payload['entries']) ? (payload['entries'] as Record<string, unknown>[]) : [];
  const refusals = Array.isArray(payload['refusals']) ? (payload['refusals'] as Record<string, unknown>[]) : null;
  const lines = entries.map((item, index) => {
    const skuId = typeof item['skuId'] === 'string' ? item['skuId'] : '';
    const sku = skuCode(skuId) ?? (skuId === '' ? 'unknown SKU' : `SKU …${shortIdTail(skuId)}`);
    const qty = typeof item['qty'] === 'number' ? item['qty'] : '?';
    const condition = conditionWords(item['condition']);
    const parts = [`${sku} × ${qty}`];
    if (condition !== null) parts.push(condition);
    if (typeof item['batchCode'] === 'string') parts.push(`batch ${item['batchCode']}`);
    if (typeof item['serialNumber'] === 'string') parts.push(`serial ${item['serialNumber']}`);
    if (typeof item['weightGrams'] === 'number') parts.push(`${(item['weightGrams'] / 1000).toFixed(3)} kg`);
    if (typeof item['note'] === 'string') parts.push(`“${item['note']}”`);
    if (typeof item['rmaLineId'] !== 'string') parts.push('not on any line');
    const reasonCode = refusals === null ? entry.problemCode : String(refusals[index]?.['reason'] ?? entry.problemCode);
    return `${parts.join(' · ')} — ${refusalWords(reasonCode)}`;
  });
  const units = entries.length;
  return { heading: `${rma} — ${units} entr${units === 1 ? 'y' : 'ies'} not booked`, lines };
}

// ── story 1-2b: Accept anyway (a grn.shelf-life-refused row) ─────────────────

/** The backend's `RESOLVE_NOTE_MAX` — code points, after trimming. */
export const MAX_RESOLVE_NOTE_LENGTH = 500;

/**
 * Story 1-6d — the two review types whose Apply is an "Accept anyway": a
 * recorded judgment that waives one receipt rule for these lines, with a
 * mandatory note (the server 400s Apply without one).
 */
export const WAIVABLE_OP_TYPES = ['grn.shelf-life-refused', 'grn.licence-refused'] as const;
export type WaivableOpType = (typeof WAIVABLE_OP_TYPES)[number];

export function isWaivableOpType(opType: string): opType is WaivableOpType {
  return (WAIVABLE_OP_TYPES as readonly string[]).includes(opType);
}

/** The words of one waivable type's Accept anyway — every place the queue names it reads this table. */
export interface WaiverCopy {
  /** The note's label. */
  readonly noteLabel: string;
  /** The problem a blank note reads. */
  readonly blankNote: string;
  /** The Apply button. */
  readonly button: string;
  /** The settled outcome's word. */
  readonly outcomeWord: string;
  /** The outcome's opening when the re-run's answer is unreadable. */
  readonly outcomeFallback: string;
  /** The outcome's ending, after what the re-run did. */
  readonly outcomeEnding: string;
  /** The summary's heading: the receipt, the line count, the client label. */
  readonly heading: (grn: string, noun: string, clientLabel: string | null) => string;
  /** A failed Accept anyway's word. */
  readonly failedWord: string;
}

/**
 * Story 1-6d — one copy table keyed by the two waivable types. The
 * shelf-life values are 1-2b's words, copied out unchanged (its pins prove
 * the bytes).
 */
export const WAIVER_COPY: Readonly<Record<WaivableOpType, WaiverCopy>> = {
  'grn.shelf-life-refused': {
    noteLabel: 'Why accept these short-dated goods? (required)',
    blankNote: 'Say why these short-dated goods are accepted — the note is required.',
    button: 'Accept anyway',
    outcomeWord: 'Accepted anyway',
    outcomeFallback: 'The short-dated lines booked',
    outcomeEnding: ' — the shelf-life rule waived for this receipt only; QC and tolerance applied as on any receipt; the note is audited.',
    heading: (grn, noun, clientLabel) => `${grn} — ${noun} not booked: short-dated${clientLabel === null ? '' : ` for ${clientLabel}`}`,
    failedWord: 'Not accepted',
  },
  'grn.licence-refused': {
    noteLabel: 'Why accept goods without a valid licence?',
    blankNote: 'Say why these goods are accepted without a valid licence — the note is required.',
    button: 'Accept anyway',
    outcomeWord: 'Accepted anyway',
    outcomeFallback: 'The lines booked',
    outcomeEnding: ' — licence waived for these lines only; the note is audited.',
    heading: (grn, noun, clientLabel) => `Lines in licence review — ${grn}, ${noun} not booked${clientLabel === null ? '' : ` for ${clientLabel}`}`,
    failedWord: 'Not accepted',
  },
};

/**
 * Whether a row's Apply is an Accept anyway — accepting short-dated goods
 * (1-2b) or goods without a valid licence (1-6d), which needs a note.
 */
export function applyNeedsNote(entry: Pick<RejectedOpResponse, 'opType'>): boolean {
  return isWaivableOpType(entry.opType);
}

/**
 * The note an Accept anyway sends, trimmed, or a problem (blank — worded for
 * the row's type — or past 500 code points); the button stays disabled
 * while there is one. Story 1-6d added the entry (the blank-note words).
 */
export function acceptAnywayNote(
  entry: Pick<RejectedOpResponse, 'opType'>,
  text: string,
): { note: string; problem: null } | { note: null; problem: string } {
  const note = text.trim();
  if (note === '') {
    return { note: null, problem: isWaivableOpType(entry.opType) ? WAIVER_COPY[entry.opType].blankNote : 'The note is required.' };
  }
  if ([...note].length > MAX_RESOLVE_NOTE_LENGTH) {
    return { note: null, problem: `The note is at most ${MAX_RESOLVE_NOTE_LENGTH} characters.` };
  }
  return { note, problem: null };
}

/**
 * Story 1-6d — whether this viewer may Apply the row: `review.decide`, plus
 * `licences.manage` (owner-only) on a `grn.licence-refused` row — the
 * server's own rule; a non-owner sees Discard and `GRN_LICENCE_OWNER_ONLY`.
 */
export function canApplyRow(entry: Pick<RejectedOpResponse, 'opType'>, canDecide: boolean, canManageLicences: boolean): boolean {
  return canDecide && (entry.opType !== 'grn.licence-refused' || canManageLicences);
}

/** The outcome banner of a settled resolve, by the row's new status and type. */
export function rejectedOpResolvedOutcome(
  entry: Pick<RejectedOpResponse, 'opType'>,
  status: string,
  outcome?: Record<string, unknown> | null,
): { word: string; reason: string } {
  if (status === 'applied' && isWaivableOpType(entry.opType)) {
    const copy = WAIVER_COPY[entry.opType];
    const rerun = waivedRerunSummary(outcome ?? null);
    return { word: copy.outcomeWord, reason: (rerun === null ? copy.outcomeFallback : rerun) + copy.outcomeEnding };
  }
  if (status === 'applied') {
    return {
      word: 'Op applied',
      reason: 'The op re-executed against the live guards and landed — the same ledger truth every other path writes.',
    };
  }
  if (status === 'recounted') {
    return {
      word: 'Recount opened',
      reason: 'A fresh count task is the corrected basis — the bin’s history, not a force-write, answers the op.',
    };
  }
  if (isInactiveSkuFlag(entry)) {
    return { word: 'Acknowledged', reason: 'The flag is closed — the lines stay booked; nothing moved.' };
  }
  return { word: 'Discarded', reason: 'The op is retired with a discard marker — its refusal stays readable in the row.' };
}

// ── story 1-4b: the inactive-SKU flag (a grn.inactive-sku-received row) ─────

/**
 * Whether the row is the server-raised flag for lines of an INACTIVE SKU a
 * receipt booked (blind or unmatched). Its lines were booked — the row is a
 * flag, not a refusal: the badge reads "flagged", its only decision (Discard)
 * is labelled Acknowledge, and it books nothing.
 */
export function isInactiveSkuFlag(entry: Pick<RejectedOpResponse, 'opType'>): boolean {
  return entry.opType === 'grn.inactive-sku-received';
}

/** The row's badge: quarantined, flagged (1-4b), or refused. */
export function rejectedOpBadge(entry: Pick<RejectedOpResponse, 'opType' | 'classification'>): string {
  if (entry.classification === 'quarantined') return 'quarantined · AD-14';
  return isInactiveSkuFlag(entry) ? 'flagged' : 'refused';
}

/** The Discard button's label: Acknowledge on the inactive-SKU flag. */
export function discardLabel(entry: Pick<RejectedOpResponse, 'opType'>): string {
  return isInactiveSkuFlag(entry) ? 'Acknowledge' : 'Discard';
}

/** The failed discard's outcome word. */
export function discardFailedWord(entry: Pick<RejectedOpResponse, 'opType'>): string {
  return isInactiveSkuFlag(entry) ? 'Not acknowledged' : 'Not discarded';
}

/** The guidance for one inactive SKU the receipt booked. */
export function inactiveSkuGuidance(code: string): string {
  return `Booked — ${code} is inactive; check why it arrived`;
}

function inactiveSkuLines(entry: Pick<RejectedOpResponse, 'payload'>): Record<string, unknown>[] {
  const lines = entry.payload['lines'];
  return Array.isArray(lines) ? (lines.filter((line) => typeof line === 'object' && line !== null) as Record<string, unknown>[]) : [];
}

function inactiveSkuCodesOf(entry: Pick<RejectedOpResponse, 'payload'>): string[] {
  const codes = inactiveSkuLines(entry)
    .map((line) => line['skuCode'])
    .filter((code): code is string => typeof code === 'string');
  return [...new Set(codes)];
}

/** The flag's summary: the receipt, then each booked line (`code × qty uom`). */
function inactiveSkuReceivedSummary(
  entry: Pick<RejectedOpResponse, 'payload'>,
  skuLabel: (skuId: string) => string | null,
): { heading: string; lines: readonly string[] } {
  const grnCode = typeof entry.payload['grnCode'] === 'string' ? entry.payload['grnCode'] : null;
  const grnId = typeof entry.payload['grnId'] === 'string' ? entry.payload['grnId'] : null;
  const grn = grnCode ?? (grnId === null ? 'unknown receipt' : `receipt …${shortIdTail(grnId)}`);
  const lines = inactiveSkuLines(entry);
  const rendered = lines.map((line) => {
    const skuId = typeof line['skuId'] === 'string' ? line['skuId'] : '';
    const sku =
      (typeof line['skuCode'] === 'string' ? line['skuCode'] : null) ??
      skuLabel(skuId) ??
      (skuId === '' ? 'unknown SKU' : `SKU …${shortIdTail(skuId)}`);
    const qty = typeof line['qty'] === 'number' ? line['qty'] : '?';
    const uom = typeof line['uom'] === 'string' ? ` ${line['uom']}` : '';
    return `${sku} × ${qty}${uom} — booked, SKU inactive`;
  });
  const count = lines.length;
  return { heading: `${grn} — ${count} line${count === 1 ? '' : 's'} of inactive SKUs booked`, lines: rendered };
}
