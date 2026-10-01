import { ApiProblem } from '@/lib/api/client';
import type { SubmitSuggestedPoResponse } from '@/lib/api/generated';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

/**
 * The replenishment surface's pure decisions (story 6-1, the
 * `review-queue.ts`/`outbound-orders.ts` pattern): the queue vocabularies,
 * the milli-quantity input grammar, and the machine-problem reason strings
 * of the reads and commands. Clients branch on the problem `code`, never on
 * prose.
 */

/** The breach alert lifecycle (the backend CHECK): `open` plus the three terminal arms. */
export const REPLENISHMENT_BREACH_STATUSES = ['open', 'recovered', 'actioned', 'dismissed'] as const;
export type BreachStatus = (typeof REPLENISHMENT_BREACH_STATUSES)[number];

/** The suggested-PO lifecycle (the backend CHECK): the draft queue plus its two settled arms. */
export const SUGGESTED_PO_STATUSES = ['draft', 'submitted', 'dismissed'] as const;
export type SuggestedPoStatus = (typeof SUGGESTED_PO_STATUSES)[number];

export const BREACH_TAB_LABEL: Record<BreachStatus, string> = {
  open: 'Open',
  recovered: 'Recovered',
  actioned: 'Actioned',
  dismissed: 'Dismissed',
};

export const SUGGESTED_PO_TAB_LABEL: Record<SuggestedPoStatus, string> = {
  draft: 'Drafts',
  submitted: 'Submitted',
  dismissed: 'Dismissed',
};

/** Fired on `window` after a replenishment mutation (policy, dismiss, submit). */
export const REPLENISHMENT_CHANGED_EVENT = 'wms-replenishment-changed';

export function notifyReplenishmentChanged(): void {
  window.dispatchEvent(new Event(REPLENISHMENT_CHANGED_EVENT));
}

/**
 * A base-unit decimal typed into a quantity input → milli-units
 * (base UoM × 10³ — this module's wire unit, per the policy upsert and the
 * submit `quantityMilli`). The grammar admits whole and 1–3-decimal
 * literals and nothing else: bare `Number()` accepts `1e3`, `0x10` and
 * `Infinity`, none of which a number field can produce and all of which are
 * silent quantity changes; a 4th decimal cannot be expressed in integer
 * milli at all, so no value finer than milli is admitted and nothing is
 * rounded client-side — the caller refuses and sends nothing.
 *
 * `0` is returned as 0, not null: the grammar-admitted value goes to the
 * server, whose positivity refusal (400 naming the field) is the documented
 * authority. Returns null only when the string is not a milli-admitted
 * decimal shape.
 */
export function parseMilliInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+(?:\.\d{1,3})?$/.test(trimmed)) return null;
  const dot = trimmed.indexOf('.');
  if (dot === -1) return Number(trimmed) * 1000;
  const whole = Number(trimmed.slice(0, dot));
  const frac = trimmed.slice(dot + 1).padEnd(3, '0');
  return whole * 1000 + Number(frac);
}

/** Milli-units → the base-unit number a label renders at the SKU's declared precision. */
export function milliToBase(milli: number): number {
  return milli / 1000;
}

/**
 * The list reads' failure reasons (policies, breaches, suggested POs — one
 * shape, `subject` names the queue in the fallthrough). The `invalid-cursor`
 * arm is the stale-page recovery; the routes' only 404 is a foreign
 * warehouse filter.
 */
export function replenishmentListReason(
  error: unknown,
  subject: 'reorder policies' | 'breaches' | 'suggested POs',
): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'invalid-cursor':
        return 'That page reference is stale — the queue restarted from the first page.';
      case 'not-found':
        return 'That warehouse does not exist in this tenant — refresh the page.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the queue filters and try again.';
      default:
        return error.detail ?? `Could not load the ${subject}.`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * A policy upsert's failure reasons (capability `replenishment.manage`).
 * The 404 answers an unknown or foreign warehouse or SKU; there is no 409 —
 * the upsert is last-write-wins.
 */
export function policyUpsertReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        return 'That warehouse or SKU no longer exists — refresh the page.';
      case 'role-denied':
        return 'Your role cannot edit reorder points.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This save was already processed — click again to send a fresh request.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'The point and quantity must both be decimals above zero.';
      default:
        return error.detail ?? `Not saved (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** A policy delete's failure reasons — the 404 covers an already-removed row. */
export function policyDeleteReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        return 'This override is already gone — refresh the table.';
      case 'role-denied':
        return 'Your role cannot edit reorder points.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This removal was already processed — click again to send a fresh request.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Not removed — check the request and try again.';
      default:
        return error.detail ?? `Not removed (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * A breach dismissal's failure reasons (capability `replenishment.manage`).
 * All three 409 arms — `breach-not-open` (recovered by a sweep, actioned by
 * a submit, or dismissed in another tab) — land here verbatim: the cause is
 * invisible in every DTO this client holds, so the server's own words are
 * the only honest rendering. The queue reloads on any 409 either way
 * (the component's contract), so the copied words stay true.
 */
export function dismissBreachReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.status === 409) {
      return error.title !== undefined
        ? `${error.title}${error.detail === undefined ? '' : ` — ${error.detail}`}`
        : (error.detail ?? `Not dismissed (${error.code}).`);
    }
    switch (error.code) {
      case 'not-found':
        return 'This breach no longer exists — refresh the queue.';
      case 'role-denied':
        return 'Your role cannot dismiss breaches.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This dismissal was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Not dismissed — check the request and try again.';
      default:
        return error.detail ?? `Not dismissed (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * A suggested-PO submit's failure reasons (capability `replenishment.manage`).
 * `suggested-po-vendor-required` is a 400 on a draft whose suggested vendor
 * was null — the picker is the remedy. Every 409 (the `suggested-po-submitted`
 * repeat, and the inner PO command's re-execution refusing because the vendor
 * or SKU moved since the draft) renders verbatim — guard-class refusals the
 * re-execution names are invisible in this client's DTOs — and the queue
 * reloads on any 409, leaving the draft row what the server says it is.
 */
export function submitSuggestedPoReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.status === 409) {
      return error.title !== undefined
        ? `${error.title}${error.detail === undefined ? '' : ` — ${error.detail}`}`
        : (error.detail ?? `Not submitted (${error.code}).`);
    }
    switch (error.code) {
      case 'suggested-po-vendor-required':
        return 'Choose a vendor first — this draft carries none, and the PO cannot be minted without one.';
      case 'not-found':
        return 'This suggested PO no longer exists — refresh the queue.';
      case 'role-denied':
        return 'Your role cannot submit suggested POs.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Quantity must be a decimal above zero — check the input and try again.';
      default:
        return error.detail ?? `Not submitted (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * The submit success sentence — built from the RESPONSE (flat: `purchaseOrder`
 * IS the minted PO, `{id, code, lines…}`); reading the code off a nested
 * snapshot used to make every success copy silently empty. The suggested-PO
 * ids this sentence names are never minted here — the backend's submit
 * command is the only writer, and this sentence merely quotes its answer
 * (the submit-never-auto rule: nothing on this surface fires except a click).
 */
export function submitAcceptedSentence(response: SubmitSuggestedPoResponse): string {
  const lines = response.purchaseOrder.lines.length;
  return `Purchase order ${response.purchaseOrder.code} minted with ${lines} line${
    lines === 1 ? '' : 's'
  } — the suggested PO is submitted and its breach reads actioned.`;
}

/** The dismissal success sentence — built from the response's own state. */
export function dismissAcceptedSentence(): string {
  return 'The breach is dismissed. Its suggested PO stays a draft — the draft queue decides whether anything is ordered.';
}

/** The policy save's one-sentence acceptance, built from the snapshot. */
export function policySavedSentence(): string {
  return 'The per-warehouse override is saved — the sweep evaluates it against the SKU-column default from the next tick.';
}

/** The policy removal's one-sentence acceptance. */
export function policyDeletedSentence(): string {
  return 'The override is gone — the SKU’s tenant-wide defaults resume as the effective point.';
}