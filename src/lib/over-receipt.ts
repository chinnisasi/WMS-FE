import { ApiProblem } from '@/lib/api/client';
import { quantityLabel, type QuantityUom } from '@/lib/format-quantity';

/**
 * Pure copy decisions of the story 3.3 surfaces (Inbound + Conflicts &
 * Reviews) — extracted from the components so the behavior is testable:
 * the negative-open callout (an approved over-receipt legitimately drives a
 * PO line's derived open quantity past zero) and the machine-problem reason
 * strings of an over-receipt decision. Clients branch on the problem `code`,
 * never on prose.
 */

/**
 * A PO line's open quantity for the table cells — negative means
 * over-received. The line's own SKU names the unit and its precision (the
 * PO-lines column mixes units, so each row states its own); an
 * unresolvable SKU falls back to the unit-agnostic "`N` units".
 */
export function openQtyLabel(openQty: number, uom?: QuantityUom | null): string {
  const qty = quantityLabel(openQty, uom ?? null);
  return openQty < 0 ? `${qty} (over-received)` : qty;
}

/**
 * Story 21-9 — the document statuses that make an over-receipt LATE: a
 * receipt that landed after its PO closed or its ASN was cancelled or
 * closed pends whole (nothing applied), so "over open" no longer describes
 * it. Read from the PO / ASN detail the queue already fetches — no BE field.
 */
const TERMINAL_DOCUMENT_STATUSES: ReadonlySet<string> = new Set(['closed', 'cancelled']);

/**
 * Story 21-9 — whether a row is a LATE receipt: PENDING on a closed or
 * cancelled document (unknown status → not late). The status is the
 * document's CURRENT one, so only a pending row can be judged: a close or
 * cancel is refused while a row is pending, so a terminal document under a
 * pending row means the receipt came after it. A decided row's document may
 * have closed later — it keeps the neutral wording.
 */
export function isLateOverReceipt(entry: { status: string }, documentStatus: string | null): boolean {
  return entry.status === 'pending' && documentStatus !== null && TERMINAL_DOCUMENT_STATUSES.has(documentStatus);
}

/**
 * Story 21-9 — an over-receipt pending against its document with NO line (a
 * late receipt's line that matched none: no reference, a SKU mismatch, a
 * removed line). An ASN row carries `asnLineId` only when it names a line;
 * a PO row's `poLineId` is null then.
 */
export function isUnmatchedOverReceipt(entry: { poLineId: string | null; asnId?: string; asnLineId?: string }): boolean {
  return entry.asnId !== undefined ? entry.asnLineId === undefined : entry.poLineId === null;
}

/**
 * Story 21-6 — the document an over-receipt pended against, named for the
 * card: a PO (its code resolved by the caller, null while unknown) or an
 * ASN (its code rides the row). Every over-receipt carries exactly one.
 * Story 21-9: a closed or cancelled document says so ("· cancelled").
 */
export function overReceiptDocumentLabel(
  entry: { poId: string | null; asnId?: string; asnCode?: string; status?: string },
  poCode: string | null,
  documentStatus: string | null = null,
): string {
  const suffix = isLateOverReceipt({ status: entry.status ?? 'pending' }, documentStatus) ? ` · ${documentStatus}` : '';
  if (entry.asnId !== undefined) return `ASN ${entry.asnCode ?? '—'}${suffix}`;
  return entry.poId === null ? '—' : `PO ${poCode ?? '—'}${suffix}`;
}

/**
 * Story 21-9 — the card's headline quantity: "+N unmatched" for a row with
 * no line (there is no line to be over), "+N late receipt" for a late row
 * (the whole receipt pends — there was no open quantity to be over), else
 * "+N over open" for an excess past an open line.
 */
export function excessHeadline(quantity: string, kind: { unmatched: boolean; late: boolean }): string {
  if (kind.unmatched) return `+${quantity} unmatched`;
  return kind.late ? `+${quantity} late receipt` : `+${quantity} over open`;
}

/**
 * The approve outcome, document-neutral (a PO line or an ASN line takes the
 * excess). Story 21-9: a row with no line credits none — the units go to
 * stock and nothing else moves.
 */
export function approvedReason(entry: { poLineId: string | null; asnId?: string; asnLineId?: string }): string {
  if (isUnmatchedOverReceipt(entry)) return 'Applied to stock; no line credited.';
  return entry.asnId === undefined
    ? 'The excess applied to the PO line and the ledger.'
    : 'The excess applied to the ASN line and the ledger.';
}

/** The decision outcome's reason: the problem code branches, in plain words. */
export function decisionReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'over-receipt-decided':
        return 'This over-receipt was already decided — refresh the queue.';
      case 'not-found':
        return 'This over-receipt no longer exists — refresh the queue.';
      case 'role-denied':
        return 'Your role cannot decide over-receipts.';
      case 'idempotency-key-reuse':
        return 'This decision was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the request and try again.';
      default:
        return error.detail ?? `Decision failed (${error.code}).`;
    }
  }
  return 'The API is unreachable — is wms-be running?';
}

/**
 * Story 3.4 — the QC hold/release surfaces' machine-problem reason strings,
 * same contract as `decisionReason`: branch on the problem `code`.
 */
export function qcReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'qc-hold-open':
        return 'An open QC hold already covers this scope — release it first.';
      case 'qc-hold-released':
        return 'This hold was already released — refresh the list.';
      case 'qc-hold-origin-bin-gone':
        return 'The origin bin no longer exists, so the stock cannot return to it — the hold stays open.';
      case 'not-found':
        return 'This hold no longer exists — refresh the list.';
      case 'role-denied':
        return 'Your role cannot place or release QC holds.';
      case 'idempotency-key-reuse':
        return 'This action was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the request and try again.';
      default:
        return error.detail ?? `The action failed (${error.code}).`;
    }
  }
  return 'The API is unreachable — is wms-be running?';
}