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
export function rejectedOpsResolveReason(error: unknown): string {
  if (error instanceof ApiProblem) {
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
};

/** The remedy a `grn.lines-refused` row's reviewer reads (Discard only). */
export const GRN_CLIENT_GUIDANCE = 'Receive these lines again on a receipt for their own client, then discard this row.';

/** Story 1-2a — the remedy when the lines were refused because their client departed. */
export const GRN_DEPARTED_GUIDANCE =
  'Their client has departed — an owner can reactivate it in Settings → Clients; receive these lines again after that, then discard this row.';

/**
 * Every remedy a row's reviewer reads: the returns remedies for a
 * `return.receive` row, the receive-again remedy for a `grn.lines-refused`
 * row, none otherwise.
 */
export function rejectedOpGuidance(entry: Pick<RejectedOpResponse, 'opType' | 'payload' | 'problemCode'>): readonly string[] {
  if (entry.opType === 'grn.lines-refused') {
    return [entry.problemCode === 'client-departed' ? GRN_DEPARTED_GUIDANCE : GRN_CLIENT_GUIDANCE];
  }
  return returnReceiveGuidance(entry);
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
  entry: Pick<RejectedOpResponse, 'payload' | 'problemCode'>,
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
    if (typeof item['batchCode'] === 'string') parts.push(`batch ${item['batchCode']}`);
    const owner = typeof refusal['skuClientLabel'] === 'string' ? refusal['skuClientLabel'] : null;
    const reason = grnRefusalWords(String(refusal['reason'] ?? entry.problemCode));
    return `${parts.join(' · ')} — ${reason}${owner === null ? '' : ` (${owner})`}`;
  });
  const count = lines.length;
  const forClient =
    clientLabel === null
      ? ''
      : entry.problemCode === 'client-departed'
        ? ` — ${clientLabel} has departed`
        : ` on a receipt for ${clientLabel}`;
  return { heading: `${grn} — ${count} line${count === 1 ? '' : 's'} not booked${forClient}`, lines: rendered };
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
  if (entry.opType === 'grn.lines-refused') return grnLinesRefusedSummary(entry, skuCode);
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
