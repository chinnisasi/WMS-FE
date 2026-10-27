import { ApiProblem } from '@/lib/api/client';
import type { ClientAllocationPolicyDto } from '@/lib/api/generated';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { formatIstDate } from '@/lib/rate-cards';

/**
 * Story 4-3a — the client allocation policy on the web: the rule (FEFO / FIFO)
 * and the minimum remaining shelf life at dispatch, the panel's draft parse,
 * its notes and warnings, and the wave detail's per-line "why this batch" text.
 * The server decides everything; this file only words it.
 */

export type AllocationRule = ClientAllocationPolicyDto['allocationRule'];
export type AllocationPolicy = ClientAllocationPolicyDto;

/** Mirrors the backend's `ALLOCATION_RULES` (the generated union is the compile-time check). */
export const ALLOCATION_RULES: readonly AllocationRule[] = ['fefo', 'fifo'];
export const MIN_OUTBOUND_SHELF_LIFE_DAYS_MIN = 1;
export const MIN_OUTBOUND_SHELF_LIFE_DAYS_MAX = 3650;

/** The radio's label and its one-line explanation. */
export const ALLOCATION_RULE_LABEL: Record<AllocationRule, { label: string; explain: string }> = {
  fefo: {
    label: 'Earliest expiry first (FEFO)',
    explain: 'The batch that expires soonest is picked first, across every bin. Batches with no expiry date go by lot first received.',
  },
  fifo: {
    label: 'Oldest first (FIFO)',
    explain: 'The lot first received earliest is picked first, across every bin.',
  },
};

/** The short wording a line or a task prints for its rule. */
export function allocationRuleShort(rule: AllocationRule): string {
  return rule === 'fifo' ? 'oldest first' : 'earliest expiry first';
}

export interface AllocationPolicyFields {
  allocationRule: AllocationRule;
  /** The minimum as typed; blank = none. */
  minDays: string;
}

export function allocationPolicyFieldsOf(policy: AllocationPolicy): AllocationPolicyFields {
  return {
    allocationRule: policy.allocationRule,
    minDays: policy.minOutboundShelfLifeDays === null ? '' : String(policy.minOutboundShelfLifeDays),
  };
}

/**
 * The draft → the PUT body, or the problem under the minimum. Runs BEFORE a
 * key is minted. A blank minimum sends `null` explicitly (both keys are
 * required); otherwise whole days 1–3650.
 */
export function parseAllocationPolicyDraft(
  fields: AllocationPolicyFields,
): { body: AllocationPolicy; problem: null } | { body: null; problem: string } {
  const days = fields.minDays.trim();
  if (days === '') return { body: { allocationRule: fields.allocationRule, minOutboundShelfLifeDays: null }, problem: null };
  const n = /^\d+$/.test(days) ? Number(days) : NaN;
  if (!Number.isInteger(n) || n < MIN_OUTBOUND_SHELF_LIFE_DAYS_MIN || n > MIN_OUTBOUND_SHELF_LIFE_DAYS_MAX) {
    return {
      body: null,
      problem: `The minimum is a whole number of days from ${MIN_OUTBOUND_SHELF_LIFE_DAYS_MIN} to ${MIN_OUTBOUND_SHELF_LIFE_DAYS_MAX}, or blank for none.`,
    };
  }
  return { body: { allocationRule: fields.allocationRule, minOutboundShelfLifeDays: n }, problem: null };
}

export function minOutboundShelfLifeLabel(days: number | null): string {
  return days === null ? 'None' : `${days} days`;
}

/** A13 — what a save does, both halves. */
export const ALLOCATION_SAVE_EFFECT =
  'Promises change now: stock below the minimum stops being promised to new orders and channels. Open planned waves keep the rule they were planned under — cancel and regenerate one to apply the change.';

export const UNDATED_RULE_NOTE = 'Batches with no expiry date are never limited by the minimum; under FEFO they go by lot first received.';

export function untrackedAllocationNote(untrackedSkuCount: number): string {
  if (untrackedSkuCount === 0) return "Every one of this client's SKUs is batch-tracked.";
  return untrackedSkuCount === 1
    ? "1 of this client's SKUs is untracked — it is picked in bin walk order under either rule."
    : `${untrackedSkuCount} of this client's SKUs are untracked — they are picked in bin walk order under either rule.`;
}

/** One warning: the banner's word and its reason line (rendered by `FeedbackBanner` tone `warning`). */
export interface AllocationWarning {
  word: string;
  reason: string;
}

/**
 * The panel's warnings (never blocks): A12 — a minimum with expiry not
 * required and undated batches on hand; A13 — an outbound minimum above the
 * receiving minimum.
 */
export function allocationPolicyWarnings(input: {
  minDays: number | null;
  expiryRequired: boolean;
  receivingMinDays: number | null;
  undatedBatchesOnHand: number;
}): AllocationWarning[] {
  const warnings: AllocationWarning[] = [];
  if (input.minDays === null) return warnings;
  if (!input.expiryRequired && input.undatedBatchesOnHand > 0) {
    warnings.push({
      word: 'Undated stock is not limited',
      reason: `${input.undatedBatchesOnHand} ${input.undatedBatchesOnHand === 1 ? 'batch' : 'batches'} on hand ${input.undatedBatchesOnHand === 1 ? 'has' : 'have'} no expiry date — the minimum cannot limit ${input.undatedBatchesOnHand === 1 ? 'it' : 'them'}. Turn on "Expiry date required" in the receiving policy.`,
    });
  }
  if (input.receivingMinDays === null) {
    warnings.push({
      word: 'Stock may be received that can never ship',
      reason: `Receiving accepts any remaining shelf life, but the outbound minimum is ${input.minDays} days: goods may be accepted that can never ship — stock received below it stays on hand and is never shipped.`,
    });
  } else if (input.minDays > input.receivingMinDays) {
    warnings.push({
      word: 'Stock may be received that can never ship',
      reason: `The outbound minimum (${input.minDays} days) is above the receiving minimum (${input.receivingMinDays} days): goods may be accepted that can never ship — stock received below it stays on hand and is never shipped.`,
    });
  }
  return warnings;
}

export function allocationPolicySaved(code: string): { word: string; reason: string } {
  return { word: `${code}'s allocation policy saved`, reason: ALLOCATION_SAVE_EFFECT };
}

/** A `validation-failed` naming the minimum renders under its input. */
export function allocationPolicyFieldOf(error: unknown): 'minDays' | null {
  if (!(error instanceof ApiProblem) || error.code !== 'validation-failed') return null;
  const field = error.extensions['field'];
  if (field === 'minOutboundShelfLifeDays') return 'minDays';
  if (typeof field === 'string') return null;
  return error.detail?.includes('minOutboundShelfLifeDays') ? 'minDays' : null;
}

export function allocationPolicyReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'validation-failed':
        return error.detail ?? 'Check the allocation policy and try again.';
      case 'not-found':
        return 'That client no longer exists — refresh the page.';
      case 'role-denied':
        return 'Only an owner can set a client’s allocation policy.';
      case 'permission-denied':
        return 'Your session belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed with different details — edit and save again.';
      case 'conflict':
        return 'The same submission is still in flight — retry to read the settled result.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `Allocation policy not saved (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

export function allocationPolicyReadReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        return 'That client no longer exists — refresh the page.';
      case 'permission-denied':
        return 'Your session belongs to another tenant — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `Allocation policy not loaded (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * The wave detail's per-line text (A5 wording): the batch, its expiry or its
 * lot's first receipt, the frozen rule and the minimum. Every key is optional
 * (a pre-4-3a stored wave lacks them); an absent key prints nothing, and a
 * line with no batch and no rule prints null.
 */
export function allocationReason(line: {
  batchCode?: string | null;
  batchExpiryDate?: string | null;
  batchReceivedOn?: string | null;
  allocationRule?: string | null;
  minOutboundShelfLifeDays?: number | null;
}): string | null {
  const parts: string[] = [];
  if (line.batchCode != null) parts.push(`batch ${line.batchCode}`);
  if (line.batchCode != null) {
    // The fact the rule chose on: FIFO the lot's first receipt; FEFO the
    // expiry, and the first receipt for an undated lot.
    if (line.allocationRule === 'fifo' && line.batchReceivedOn != null) parts.push(`lot first received ${formatIstDate(line.batchReceivedOn)}`);
    else if (line.batchExpiryDate != null) parts.push(`exp ${formatIstDate(line.batchExpiryDate)}`);
    else if (line.batchReceivedOn != null) parts.push(`lot first received ${formatIstDate(line.batchReceivedOn)}`);
  }
  if (line.allocationRule === 'fefo' || line.allocationRule === 'fifo') parts.push(allocationRuleShort(line.allocationRule));
  if (line.minOutboundShelfLifeDays != null) parts.push(`needs ≥ ${line.minOutboundShelfLifeDays} days`);
  return parts.length === 0 ? null : parts.join(' · ');
}
