import { ApiProblem } from '@/lib/api/client';
import type { CountVarianceEntryResponseDto } from '@/lib/api/generated';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

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
        return 'This rejected op no longer exists — refresh the queue.';
      case 'role-denied':
        return 'Your role cannot resolve rejected ops.';
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
