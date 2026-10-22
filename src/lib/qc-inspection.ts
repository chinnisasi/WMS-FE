/**
 * Story 2-8a — the QC inspection outcome, the web's pure half: the dialog's
 * draft per held arm (passed defaults to the whole arm; failed is computed;
 * a reason when anything fails), the request body it sends, the summary line
 * ("N pass, M fail → DAMAGED"), the expired-batch warning (warns, never
 * blocks) and an inspected hold's result on the list.
 */
import type { InspectQcHoldDto, QcHeldArmDto, QcHoldEntryDto, QcInspectionLineDto } from '@/lib/api/generated';
import { batchExpired, istDateToInstant } from '@/lib/adjust';
import { formatQuantity, parseQuantityInput } from '@/lib/format-quantity';

export type QcFailReason = NonNullable<QcInspectionLineDto['failReason']>;

/** The server's vocabulary, in its order (a new reason must be labelled to compile). */
export const QC_FAIL_REASON_LABEL: Readonly<Record<QcFailReason, string>> = {
  damaged: 'Damaged',
  expired: 'Expired',
  contaminated: 'Contaminated',
  'wrong-item': 'Wrong item',
  'spec-failure': 'Failed spec',
  other: 'Other (say what in the note)',
};

export const QC_FAIL_REASONS = Object.keys(QC_FAIL_REASON_LABEL) as readonly QcFailReason[];

/** The server's note ceiling (code points, after trimming). */
export const MAX_INSPECTION_NOTE_LENGTH = 500;

/** One held arm's draft: the passed field as typed, and the reason when something fails. */
export interface InspectArmDraft {
  readonly passed: string;
  readonly reason: QcFailReason | '';
}

/** Passed defaults to the whole arm (an all-pass inspection is one click) — a plain decimal, never grouped. */
export function initialArmDraft(arm: Pick<QcHeldArmDto, 'quantity'>): InspectArmDraft {
  return { passed: String(arm.quantity), reason: '' };
}

const places = (precision: number): number => Math.min(Math.max(Math.trunc(precision), 0), 3);

/** `held − passed`, exact at milli-units (no float drift), or null while passed is not a number in range. */
export function failedOf(held: number, passedRaw: string): number | null {
  const passed = parseQuantityInput(passedRaw);
  if (passed === null || passed < 0 || passed > held) return null;
  return (Math.round(held * 1000) - Math.round(passed * 1000)) / 1000;
}

/** The dialog's running totals (passed, failed), or null while any arm's Passed is not a number in range. */
export function draftTotals(
  arms: readonly Pick<QcHeldArmDto, 'quantity'>[],
  drafts: readonly InspectArmDraft[],
): { readonly passed: number; readonly failed: number } | null {
  let passedMilli = 0;
  let failedMilli = 0;
  for (const [index, arm] of arms.entries()) {
    const failed = failedOf(arm.quantity, drafts[index]?.passed ?? '');
    if (failed === null) return null;
    failedMilli += Math.round(failed * 1000);
    passedMilli += Math.round(arm.quantity * 1000) - Math.round(failed * 1000);
  }
  return { passed: passedMilli / 1000, failed: failedMilli / 1000 };
}

export type InspectDraftResult =
  | { readonly ok: true; readonly body: InspectQcHoldDto; readonly passed: number; readonly failed: number }
  | { readonly ok: false; readonly problem: string };

/**
 * The request body from the dialog, or the first problem in words. The arms
 * are the server's (`GET …/qc-holds/{id}`) — the body covers exactly them;
 * held quantities are never sent.
 */
export function buildInspectBody(
  arms: readonly QcHeldArmDto[],
  drafts: readonly InspectArmDraft[],
  note: string,
  sku: { readonly uom: string; readonly uomPrecision: number },
): InspectDraftResult {
  const p = places(sku.uomPrecision);
  const trimmed = note.trim();
  if ([...trimmed].length > MAX_INSPECTION_NOTE_LENGTH) {
    return { ok: false, problem: `The note is at most ${MAX_INSPECTION_NOTE_LENGTH} characters.` };
  }
  let passedTotal = 0;
  let failedTotal = 0;
  const lines: InspectQcHoldDto['lines'] = [];
  for (const [index, arm] of arms.entries()) {
    const draft = drafts[index] ?? { passed: '', reason: '' };
    const name = arm.batchCode ?? (arm.batchId === null ? 'the stock' : 'this batch');
    const passed = parseQuantityInput(draft.passed);
    if (passed === null || passed < 0) {
      return { ok: false, problem: `Enter the units of ${name} that passed (0 to ${formatQuantity(arm.quantity, p)}).` };
    }
    if (Math.round(passed * 10 ** p) / 10 ** p !== passed) {
      return {
        ok: false,
        problem: p === 0 ? `${sku.uom} counts in whole units — ${draft.passed.trim()} is not one.` : `${sku.uom} takes at most ${p} decimal place(s).`,
      };
    }
    const failed = failedOf(arm.quantity, draft.passed);
    if (failed === null) {
      return { ok: false, problem: `${name} holds ${formatQuantity(arm.quantity, p)} ${sku.uom} — passed cannot be more.` };
    }
    if (failed > 0 && draft.reason === '') {
      return { ok: false, problem: `Pick why ${formatQuantity(failed, p)} of ${name} failed.` };
    }
    if (failed > 0 && draft.reason === 'other' && trimmed === '') {
      return { ok: false, problem: 'A failure with the reason Other needs a note saying what failed.' };
    }
    passedTotal += passed;
    failedTotal += failed;
    lines.push({
      batchId: arm.batchId,
      passed,
      failed: failed > 0 && draft.reason !== '' ? [{ reason: draft.reason, quantity: failed }] : [],
    });
  }
  return {
    ok: true,
    body: trimmed === '' ? { lines } : { lines, note: trimmed },
    passed: Math.round(passedTotal * 1000) / 1000,
    failed: Math.round(failedTotal * 1000) / 1000,
  };
}

/** The dialog's summary line and an inspected hold's result: "7 pass, 3 fail → DAMAGED". */
export function inspectionSummary(passed: number, failed: number, precision: number): string {
  const p = places(precision);
  return `${formatQuantity(passed, p)} pass, ${formatQuantity(failed, p)} fail → DAMAGED`;
}

/**
 * The expired-batch warning (never a block): passing units of an expired
 * batch returns expired stock to stock. "Expired" is the server's rule — the
 * one instant compare FEFO uses (`batchExpired`): the expiry is stored as the
 * IST midnight that BEGINS its date, so a batch counts as expired from the
 * start of its expiry day. `arm.expiryDate` is that IST date (`YYYY-MM-DD`).
 */
export function expiredPassWarning(arm: Pick<QcHeldArmDto, 'batchCode' | 'expiryDate'>, passed: number, nowMs: number): string | null {
  if (arm.expiryDate === null || passed <= 0) return null;
  const instant = istDateToInstant(arm.expiryDate);
  if (instant === null || !batchExpired({ expiryDate: instant }, nowMs)) return null;
  return `Batch ${arm.batchCode ?? '—'} expired on ${arm.expiryDate} — passing it puts expired stock back. Fail it as Expired unless that is intended.`;
}

/** An inspected row's result on the list: its passed and failed units (held − failed passed). */
export function inspectedResultLabel(hold: Pick<QcHoldEntryDto, 'heldQty' | 'failedQuantity'>, precision: number): string {
  const failed = hold.failedQuantity ?? 0;
  const passed = (Math.round(hold.heldQty * 1000) - Math.round(failed * 1000)) / 1000;
  return inspectionSummary(passed, failed, precision);
}
