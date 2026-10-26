import { ApiProblem } from '@/lib/api/client';
import type {
  CountVarianceEntryResponseDto,
  MissingLicenceDto,
  RejectedGrnLineDto,
  RejectedOpResponse,
  ReturnEntryRefusedDto,
} from '@/lib/api/generated';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { shortIdTail } from '@/lib/audit';
import { istDateTimeLabel } from '@/lib/audit-exports';
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
  // Story 2-6a — serial capture: two whole-line codes, six per-serial codes.
  'serials-required': 'serial numbers missing',
  'serials-on-untracked': 'serials on an untracked SKU',
  'serial-format-invalid': 'not a valid IMEI',
  'serial-in-stock': 'serial already in stock',
  'serial-in-transit': 'serial in transit on a transfer',
  'serial-pending-approval': "serial awaiting another receipt's approval",
  'serial-dispatched-use-returns': 'serial left on an order — receive as a return',
  'serial-blocked': 'serial blocked',
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

/** Story 2-6a — the remedies for the serial refusals of a `grn.lines-refused` row (Discard only). */
export const GRN_SERIALS_REQUIRED_GUIDANCE =
  'These SKUs are serial-tracked and the lines carried no serials (an older handheld build, or a receipt queued before serial capture) — receive them again on the current build, scanning each unit, then discard this row.';
export const GRN_SERIALS_ON_UNTRACKED_GUIDANCE =
  'These SKUs are not serial-tracked, so their lines carry no serials — receive them again without serials, then discard this row.';
export const GRN_SERIAL_IN_STOCK_GUIDANCE =
  'These serials are already in stock (each entry names where) — one serial is one unit. Check the units and their labels, then discard this row; the rest of each line booked.';
export const GRN_SERIAL_IN_TRANSIT_GUIDANCE =
  "These serials are on a stock transfer in transit — confirm the transfer's arrival instead of receiving them, then discard this row.";
export const GRN_SERIAL_PENDING_GUIDANCE =
  "These serials are waiting on another receipt's over-receipt approval — decide that approval first, then discard this row.";
export const GRN_SERIAL_DISPATCHED_GUIDANCE =
  'These serials left the warehouse on a customer order — receive them as a return against that order, then discard this row.';
export const GRN_SERIAL_BLOCKED_GUIDANCE = 'These serials are blocked — check why before receiving them again, then discard this row.';
export const GRN_SERIAL_FORMAT_GUIDANCE =
  "These SKUs take IMEI 1 as the serial (15 digits with a check digit) and the scanned values are not valid IMEIs — scan the IMEI 1 barcode on each unit's box and receive them again, then discard this row.";

/** Story 1-2b — the `grn.shelf-life-refused` row's remedy (Accept anyway with a note, or Discard). */
export const GRN_SHELF_LIFE_GUIDANCE =
  "Short-dated for this client's minimum: accept them anyway with a note saying why (they book as on any receipt — QC and tolerance still apply), or discard this row and return the goods.";

/** Story 1-6d — the `grn.licence-refused` row's remedy (an owner accepts with a note, or Discard). */
export const GRN_LICENCE_GUIDANCE =
  'No valid client and site licence covered these goods on the receipt date: an owner can accept them anyway with a note saying why (they book as on any receipt), or discard this row and return the goods. Add or renew the licence under Compliance → Licences.';

/**
 * Story 2-4a — a device `grn.submit` refused whole with `damaged-bin-conflict`
 * (defensive since code review CR1): a user zone or bin coded DAMAGED blocks
 * the system damaged bin. Migration 0087 re-codes every such pre-rule
 * location, and nothing in the product can — codes cannot be renamed and a
 * retire frees nothing — so the remedy is an administrator's re-code, never a
 * retire.
 */
export const GRN_DAMAGED_BIN_CONFLICT_GUIDANCE =
  'A zone or bin coded DAMAGED blocks the system damaged bin, so this receipt booked nothing. An administrator must re-code that location (migration 0087 re-codes such locations); then apply this row to receive it again.';

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
  // Story 2-6a — after every older code, in the server's precedence.
  ['serials-required', GRN_SERIALS_REQUIRED_GUIDANCE],
  ['serials-on-untracked', GRN_SERIALS_ON_UNTRACKED_GUIDANCE],
  ['serial-in-stock', GRN_SERIAL_IN_STOCK_GUIDANCE],
  ['serial-in-transit', GRN_SERIAL_IN_TRANSIT_GUIDANCE],
  ['serial-pending-approval', GRN_SERIAL_PENDING_GUIDANCE],
  ['serial-dispatched-use-returns', GRN_SERIAL_DISPATCHED_GUIDANCE],
  ['serial-blocked', GRN_SERIAL_BLOCKED_GUIDANCE],
  ['serial-format-invalid', GRN_SERIAL_FORMAT_GUIDANCE],
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
  // Story 2-3a — a refused device unload: Discard only; the web re-records it.
  if (entry.opType === 'gate-in.unload') return [gateInUnloadGuidance(entry.problemCode)];
  // Story 3-1 — a refused handheld move: Apply re-runs it, or Discard.
  if (entry.opType === 'stock.move') return [STOCK_MOVE_GUIDANCE];
  // Story 3-2b — a refused handheld adjustment: Apply re-submits it, or Discard.
  if (entry.opType === 'stock.adjust') return [STOCK_ADJUST_GUIDANCE];
  // Story 2-5a — a refused damage photo: Discard only; the receipt booked regardless.
  if (entry.opType === 'receipt-photo.stage') return [RECEIPT_PHOTO_GUIDANCE];
  if (entry.opType === 'grn.shelf-life-refused') return [GRN_SHELF_LIFE_GUIDANCE];
  // Story 2-4a — the whole receipt was refused for the DAMAGED code collision.
  if (entry.opType === 'grn.submit' && entry.problemCode === 'damaged-bin-conflict') return [GRN_DAMAGED_BIN_CONFLICT_GUIDANCE];
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

/** Story 2-4a — the damage reasons in words (the server's `DAMAGE_REASON_CODES`). */
const DAMAGE_REASON_WORDS: Readonly<Record<string, string>> = {
  crushed: 'crushed',
  wet: 'wet',
  'torn-packaging': 'torn packaging',
  broken: 'broken',
  leaking: 'leaking',
  pest: 'pest',
  other: 'other',
};

/** Story 2-4a — the short reasons in words (the server's `SHORT_REASON_CODES`). */
const SHORT_REASON_WORDS: Readonly<Record<string, string>> = {
  'not-shipped': 'not shipped',
  'short-packed': 'short-packed',
  'lost-in-transit': 'lost in transit',
  other: 'other',
};

/**
 * Story 2-4a — a stored GRN line's quantities in words. A line without
 * damage or short reads `× 3` exactly as before (a pre-2-4a row is
 * unchanged); a line carrying either reads `good 3 · damaged 1 (wet) · short
 * 2 (not shipped)` — never `× 0` for an all-damaged line. Read defensively (a
 * stored row is data).
 */
export function grnLineQuantityWords(item: Record<string, unknown>): string {
  const qty = typeof item['qty'] === 'number' ? item['qty'] : '?';
  const damaged = typeof item['damagedQty'] === 'number' && item['damagedQty'] > 0 ? item['damagedQty'] : null;
  const short = typeof item['shortQty'] === 'number' && item['shortQty'] > 0 ? item['shortQty'] : null;
  if (damaged === null && short === null) return `× ${qty}`;
  const reason = (words: Readonly<Record<string, string>>, code: unknown) =>
    typeof code === 'string' ? ` (${words[code] ?? code})` : '';
  const parts = [`good ${qty}`];
  if (damaged !== null) parts.push(`damaged ${damaged}${reason(DAMAGE_REASON_WORDS, item['damageReasonCode'])}`);
  if (short !== null) parts.push(`short ${short}${reason(SHORT_REASON_WORDS, item['shortReasonCode'])}`);
  return parts.join(' · ');
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
    const parts = [`${sku} ${grnLineQuantityWords(item)}`];
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

/**
 * Story 1-6d — the licence a need calls for, short (`FSSAI licence — site
 * WH-PUN`). A `Record` over the generated need union, so a new need fails
 * the compile until it has words.
 */
const MISSING_NEED_WORDS: Readonly<Record<MissingLicenceDto['need'], string>> = {
  'drug-20b': 'Form 20B',
  'drug-21b': 'Form 21B',
  'drug-20g': 'Form 20G',
  ndps: 'NDPS licence',
  fssai: 'FSSAI licence',
};

/**
 * Story 1-6d — a licence refusal's `missing` entries, worded: `FSSAI licence
 * — site WH-PUN; NDPS licence — client`. The site is named when the entry
 * carries `siteCode` (an older row may not). Read defensively (a stored row
 * is data); null when the refusal carries none.
 */
export function missingLicenceWords(refusal: Record<string, unknown>): string | null {
  const missing = refusal['missing'];
  if (!Array.isArray(missing)) return null;
  const words = missing
    .map((item) => {
      if (typeof item !== 'object' || item === null) return null;
      const need = (item as Record<string, unknown>)['need'];
      const holder = (item as Record<string, unknown>)['holder'];
      const siteCode = (item as Record<string, unknown>)['siteCode'];
      if (typeof need !== 'string' || (holder !== 'client' && holder !== 'site')) return null;
      const words = (MISSING_NEED_WORDS as Readonly<Record<string, string>>)[need] ?? need;
      return `${words} — ${holder}${holder === 'site' && typeof siteCode === 'string' && siteCode !== '' ? ` ${siteCode}` : ''}`;
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
  if (entry.opType === 'gate-in.unload') return gateInUnloadSummary(entry);
  if (entry.opType === 'stock.move') return stockMoveSummary(entry, skuCode);
  if (entry.opType === 'stock.adjust') return stockAdjustSummary(entry, skuCode);
  if (entry.opType === 'receipt-photo.stage') return receiptPhotoSummary(entry);
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
  // Story 3-2b (A3) — an applied `stock.adjust` row re-ran as the op's own
  // operator: a floor operator's request (or an over-threshold one) PENDS
  // again, so the outcome holds the pend — say so, never "landed".
  if (status === 'applied' && entry.opType === 'stock.adjust' && isPendOutcome(outcome)) {
    return {
      word: 'Sent for approval',
      reason:
        'The adjustment was re-submitted as the operator recorded it and now waits in the adjustment approval queue — stock is unchanged until an owner approves it.',
    };
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

/** Story 3-2b — the resolve outcome's snapshot is a 202 pend (`{ pendingAdjustment }`). */
function isPendOutcome(outcome: Record<string, unknown> | null | undefined): boolean {
  const snapshot = outcome?.['snapshot'];
  return typeof snapshot === 'object' && snapshot !== null && 'pendingAdjustment' in snapshot;
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
    // Story 2-4a — a line that also booked damaged units into DAMAGED says so.
    const damaged = typeof line['damagedQty'] === 'number' && line['damagedQty'] > 0 ? ` + ${line['damagedQty']}${uom} damaged` : '';
    return `${sku} × ${qty}${uom}${damaged} — booked, SKU inactive`;
  });
  const count = lines.length;
  return { heading: `${grn} — ${count} line${count === 1 ? '' : 's'} of inactive SKUs booked`, lines: rendered };
}

// ── story 2-3a: a refused device gate-in unload (a gate-in.unload row) ───────

/**
 * The remedy a `gate-in.unload` row's reviewer reads (Discard only — the row
 * re-applies nothing): the dock's unload was refused on replay (an unknown
 * gate-in, a malformed body, an operator without `gate.manage`), so the
 * unload is recorded again from the web.
 */
export const GATE_IN_UNLOAD_GUIDANCE =
  'Record the unload on the web from Inbound → Gate-in, then discard this row.';

/** A `not-found` refusal: the gate-in is gone, so there is nothing to record against. */
export const GATE_IN_UNLOAD_GONE_GUIDANCE = 'The gate-in no longer exists — discard this row.';

/** The guidance by the row's problem code (a vanished gate-in cannot take a web unload). */
export function gateInUnloadGuidance(problemCode: string): string {
  return problemCode === 'not-found' ? GATE_IN_UNLOAD_GONE_GUIDANCE : GATE_IN_UNLOAD_GUIDANCE;
}

/** Why the device unload was refused, in words (the row's whole-op `problemCode`). */
const GATE_IN_UNLOAD_PROBLEM_WORDS: Readonly<Record<string, string>> = {
  'not-found': 'gate-in not found',
  'validation-failed': 'the unload was malformed',
  'role-denied': 'the operator may not record gate-ins',
  'permission-denied': 'the operator may not record gate-ins',
};

/**
 * A `gate-in.unload` row's summary: the gate-in (a short form of its id — the
 * device payload carries no code), the phase, the device time in IST and, for
 * an end, the packages counted; then the refusal in words. The payload is the
 * device's own body, read defensively (a stored row is data).
 */
function gateInUnloadSummary(
  entry: Pick<RejectedOpResponse, 'payload' | 'problemCode'>,
): { heading: string; lines: readonly string[] } {
  const payload = entry.payload;
  const gateInId = typeof payload['gateInId'] === 'string' ? payload['gateInId'] : null;
  const gateIn = gateInId === null ? 'unknown gate-in' : `gate-in …${shortIdTail(gateInId)}`;
  const phase = payload['phase'] === 'start' ? 'start' : payload['phase'] === 'end' ? 'end' : null;
  const occurredAt = typeof payload['occurredAt'] === 'string' && !Number.isNaN(Date.parse(payload['occurredAt'])) ? payload['occurredAt'] : null;
  const counted = typeof payload['packagesCounted'] === 'number' ? payload['packagesCounted'] : null;
  const parts = [phase === null ? 'Unload' : phase === 'start' ? 'Unload start' : 'Unload end'];
  if (occurredAt !== null) parts.push(`at ${istDateTimeLabel(occurredAt)} IST`);
  if (phase === 'end' && counted !== null) parts.push(`${counted} package${counted === 1 ? '' : 's'} counted`);
  const problem = GATE_IN_UNLOAD_PROBLEM_WORDS[entry.problemCode] ?? entry.problemCode;
  return {
    heading: phase === null ? `${gateIn} — unload not recorded` : `${gateIn} — unload ${phase} not recorded`,
    lines: [`${parts.join(' · ')} — ${problem}`],
  };
}

// ── story 3-1: a refused handheld move (a stock.move row) ───────────────────

/**
 * The remedy a `stock.move` row's reviewer reads. Apply re-runs the move as
 * the handheld recorded it, every rule checked again (the target's gates, the
 * origin's stock, the serials) under the op's own operator; when the floor no
 * longer matches it — a gate refusal that still holds — Discard it and record
 * a move or an adjustment on the web that matches the floor.
 */
export const STOCK_MOVE_GUIDANCE =
  'Apply re-runs the move as recorded, every rule checked again. If the floor no longer matches it, discard this row and record a move or an adjustment on the Moves or Inventory page that matches the floor.';

/** Why the move was refused, in words (the row's whole-op `problemCode`); an unknown code reads as itself. */
export const STOCK_MOVE_PROBLEM_WORDS: Readonly<Record<string, string>> = {
  'move-source-short': 'the origin bin held less than the move',
  'bin-not-movable': 'a system bin on one end',
  'bin-retired': 'a retired bin',
  'bin-blocked': 'the target bin is blocked',
  'bin-full': 'the target bin is full',
  'bin-overweight': 'the target bin would be overweight',
  'bin-volume-exceeded': 'the target bin would be over its volume',
  'bin-item-oversize': 'the item does not fit the target bin',
  'bin-storage-mismatch': "the target bin's storage class does not suit the SKU",
  'bin-client-mismatch': 'the target bin is dedicated to another client',
  'bin-segregation-conflict': 'the target bin holds goods that must be kept apart',
  'bin-occupancy-conflict': 'the target bulk asset holds another SKU',
  'move-scope-quarantined': 'the stock is under a reconcile quarantine',
  'kit-cannot-hold-stock': 'a kit holds no stock',
  'serial-elsewhere': 'a serial is in another bin',
  'serial-unknown': 'a serial is unknown',
  'not-found': 'a bin, SKU or batch no longer exists',
  'role-denied': 'the operator may not move this stock',
  'validation-failed': 'the move was malformed',
  'operator-mismatch': 'captured by another operator',
  'device-revoked': 'the device was revoked',
};

/**
 * A `stock.move` row's summary: the quantity and SKU, the two bins (short ids
 * — the payload carries no codes), the batch or serials, the reason and note,
 * then the refusal in words. Read defensively (a stored row is data).
 */
function stockMoveSummary(
  entry: Pick<RejectedOpResponse, 'payload' | 'problemCode'>,
  skuCode: (skuId: string) => string | null,
): { heading: string; lines: readonly string[] } {
  const payload = entry.payload;
  const skuId = typeof payload['skuId'] === 'string' ? payload['skuId'] : '';
  const sku = skuCode(skuId) ?? (skuId === '' ? 'unknown SKU' : `SKU …${shortIdTail(skuId)}`);
  const qty = typeof payload['qty'] === 'number' ? String(payload['qty']) : '?';
  const bin = (key: string): string => {
    const id = payload[key];
    return typeof id === 'string' && id !== '' ? `bin …${shortIdTail(id)}` : 'unknown bin';
  };
  const parts = [`${bin('fromBinId')} → ${bin('toBinId')}`];
  if (typeof payload['batchCode'] === 'string') parts.push(`batch ${payload['batchCode']}`);
  if (Array.isArray(payload['serials'])) {
    const serials = (payload['serials'] as unknown[]).filter((serial): serial is string => typeof serial === 'string');
    if (serials.length > 0) parts.push(`serials ${serials.join(', ')}`);
  }
  if (typeof payload['reasonCode'] === 'string') parts.push(`reason ${payload['reasonCode']}`);
  if (typeof payload['note'] === 'string' && payload['note'] !== '') parts.push(`“${payload['note']}”`);
  const problem = STOCK_MOVE_PROBLEM_WORDS[entry.problemCode] ?? entry.problemCode;
  return { heading: `${sku} × ${qty} — not moved`, lines: [`${parts.join(' · ')} — ${problem}`] };
}

// ── story 3-2b: a refused handheld adjustment (a stock.adjust row) ──────────

/**
 * The remedy a `stock.adjust` row's reviewer reads. Apply re-submits the
 * adjustment as the handheld recorded it, every rule checked again, under the
 * op's own operator — so a floor operator's request goes to the adjustment
 * approval queue again rather than changing stock here. When the floor no
 * longer matches it, Discard it and record the adjustment on the Inventory
 * page.
 */
export const STOCK_ADJUST_GUIDANCE =
  "Apply re-submits the adjustment as recorded, every rule checked again — a floor operator's request then waits in the adjustment approval queue. If the floor no longer matches it, discard this row and record the adjustment on the Inventory page.";

/** Why the adjustment was refused, in words (the row's whole-op `problemCode`); an unknown code reads as itself. */
export const STOCK_ADJUST_PROBLEM_WORDS: Readonly<Record<string, string>> = {
  'insufficient-on-hand': 'the bin (or the batch) held less than the removal',
  'serial-elsewhere': 'a serial is in another bin',
  'duplicate-serial': 'a serial is already in a bin',
  'serial-unknown': 'a serial is unknown',
  'bin-retired': 'the bin is retired',
  'qc-bin-not-adjustable': 'a QC-hold or in-transit bin is not adjusted by hand',
  'returns-bin-not-adjustable': 'the Returns bin is not adjusted by hand',
  'damaged-bin-write-off-only': 'the Damaged bin takes only a write-off',
  'kit-cannot-hold-stock': 'a kit holds no stock',
  'client-departed': "the SKU's client has departed",
  'not-found': 'a bin, SKU or batch no longer exists',
  'role-denied': 'the operator may not adjust stock',
  'validation-failed': 'the adjustment was malformed',
  conflict: 'the same adjustment was being processed twice',
  'idempotency-key-reuse': 'the op id was reused with a different adjustment',
  'operator-mismatch': 'captured by another operator',
  'device-revoked': 'the device was revoked',
};

/**
 * A `stock.adjust` row's summary: the signed quantity and SKU, the bin (a
 * short id — the payload carries no code), the batch (or FEFO) and serials,
 * the reason and note, then the refusal in words. Read defensively (a stored
 * row is data).
 */
function stockAdjustSummary(
  entry: Pick<RejectedOpResponse, 'payload' | 'problemCode'>,
  skuCode: (skuId: string) => string | null,
): { heading: string; lines: readonly string[] } {
  const payload = entry.payload;
  const skuId = typeof payload['skuId'] === 'string' ? payload['skuId'] : '';
  const sku = skuCode(skuId) ?? (skuId === '' ? 'unknown SKU' : `SKU …${shortIdTail(skuId)}`);
  const delta = typeof payload['quantityDelta'] === 'number' ? payload['quantityDelta'] : null;
  const signed = delta === null ? '?' : `${delta < 0 ? '−' : '+'}${Math.abs(delta)}`;
  const binId = payload['binId'];
  const parts = [typeof binId === 'string' && binId !== '' ? `bin …${shortIdTail(binId)}` : 'unknown bin'];
  const batch = payload['batch'];
  if (typeof batch === 'object' && batch !== null && typeof (batch as Record<string, unknown>)['code'] === 'string') {
    const override = (batch as Record<string, unknown>)['overrideReason'];
    parts.push(
      `batch ${(batch as Record<string, unknown>)['code'] as string}` +
        (typeof override === 'string' && override !== '' ? ` (instead of FEFO: ${override})` : ''),
    );
  }
  if (Array.isArray(payload['serials'])) {
    const serials = (payload['serials'] as unknown[]).filter((serial): serial is string => typeof serial === 'string');
    if (serials.length > 0) parts.push(`serials ${serials.join(', ')}`);
  }
  if (typeof payload['reasonCode'] === 'string') parts.push(`reason ${payload['reasonCode']}`);
  if (typeof payload['note'] === 'string' && payload['note'] !== '') parts.push(`“${payload['note']}”`);
  const problem = STOCK_ADJUST_PROBLEM_WORDS[entry.problemCode] ?? entry.problemCode;
  return { heading: `${sku} ${signed} — not adjusted`, lines: [`${parts.join(' · ')} — ${problem}`] };
}

// ── story 2-5a: a refused handheld damage photo (a receipt-photo.stage row) ──

/**
 * The remedy a `receipt-photo.stage` row's reviewer reads (Discard only —
 * the photo's bytes are gone with the refusal; the receipt booked as
 * captured either way).
 */
export const RECEIPT_PHOTO_GUIDANCE =
  'The receipt is not affected. If the damage still needs evidence, add a photo to the receipt line on the web (Inbound → Goods receipt notes), then discard this row.';

/** Why the photo was refused, in words (the row's whole-op `problemCode`); an unknown code reads as itself. */
export const RECEIPT_PHOTO_PROBLEM_WORDS: Readonly<Record<string, string>> = {
  'attachment-type-unsupported': 'not a JPEG, PNG or WebP photo',
  'attachment-too-large': 'larger than 10 MB',
  'attachment-content-invalid': 'the image was damaged or over 8,000 px a side',
  'attachment-ref-conflict': 'a different photo was already stored under the same id',
  'attachment-staging-limit': 'the device had too many photos waiting for their receipts',
  'file-storage-unavailable': 'photo storage was off for over 7 days',
  'photo-file-missing': 'the photo file was missing on the device',
  'validation-failed': 'the upload was malformed',
  'role-denied': 'the operator may not receive goods',
  'idempotency-key-reuse': 'the op id was reused with a different photo',
  'device-revoked': 'the device was revoked',
};

/**
 * A `receipt-photo.stage` row's summary — "Damage photo not uploaded": the
 * photo (a short form of its ref — the device payload carries no code), the
 * receipt line it was for, the capture time in IST, then the refusal in
 * words. The payload is the device's own body, read defensively.
 */
function receiptPhotoSummary(entry: Pick<RejectedOpResponse, 'payload' | 'problemCode'>): { heading: string; lines: readonly string[] } {
  const payload = entry.payload;
  const ref = typeof payload['ref'] === 'string' && payload['ref'] !== '' ? payload['ref'] : null;
  const lineIndex = typeof payload['lineIndex'] === 'number' && Number.isInteger(payload['lineIndex']) ? payload['lineIndex'] : null;
  const capturedAt =
    typeof payload['capturedAt'] === 'string' && !Number.isNaN(Date.parse(payload['capturedAt'])) ? payload['capturedAt'] : null;
  const parts = [ref === null ? 'Photo' : `Photo …${ref.slice(-8)}`];
  if (lineIndex !== null) parts.push(`receipt line ${lineIndex + 1}`);
  if (capturedAt !== null) parts.push(`taken ${istDateTimeLabel(capturedAt)} IST`);
  const problem = RECEIPT_PHOTO_PROBLEM_WORDS[entry.problemCode] ?? entry.problemCode;
  return { heading: 'Damage photo not uploaded', lines: [`${parts.join(' · ')} — ${problem}`] };
}
