/**
 * Story 9-3c — the `/reports` "Ledger integrity" section (AD-16): its words,
 * the status priority, the WORM line, the proof file name and the refusal
 * mapper.
 *
 * Pure: no React, no fetch — pinned by `ledger-integrity.test.ts`. The check
 * is the backend's (`GET …/inventory/ledger/integrity`, owner-only); this
 * file formats it.
 */
import { ApiProblem } from '@/lib/api/client';
import type { ChainBreakDto, LedgerAnchorDto, LedgerIntegrityResponse, WarehouseLedgerIntegrityDto } from '@/lib/api/generated';
import { istDateLabel, istDateTimeLabel } from '@/lib/audit-exports';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

/** The anchor the panel's ledger-chain-break entries link to (`/reports#ledger-integrity`). */
export const LEDGER_INTEGRITY_ANCHOR = 'ledger-integrity';

/**
 * Asks a mounted Ledger integrity section to reload and scroll into view —
 * the bell's `ledger-chain-break` entry dispatches it on click (Next's
 * `<Link>` navigates with `pushState`, which fires no `hashchange`; the
 * 9-3b `AUDIT_EXPORTS_REFRESH_EVENT` pattern).
 */
export const LEDGER_INTEGRITY_REFRESH_EVENT = 'wms:ledger-integrity-refresh';

export function requestLedgerIntegrityRefresh(): void {
  window.dispatchEvent(new CustomEvent(LEDGER_INTEGRITY_REFRESH_EVENT));
}

export type WormStoreMode = LedgerIntegrityResponse['wormStore'];
type BreakKind = ChainBreakDto['kind'];

/** A break's kind, in words — a `Record` over the GENERATED enum (a new kind fails the compile until it has copy). */
export const BREAK_KIND_LABEL: Readonly<Record<BreakKind, string>> = {
  chain: 'Chain',
  worm: 'WORM copy',
};

/** The status line's tone: `broken` is red text AND the word "Broken" — never colour alone. */
export type IntegrityTone = 'broken' | 'verified' | 'unchecked';

export interface IntegrityStatus {
  readonly tone: IntegrityTone;
  readonly text: string;
}

/**
 * The status, in priority order:
 *  1. "Broken at #N" (with " · acknowledged" once no break is open —
 *     `openBreakCount === 0`) —
 *     `brokenAtSeq` is never cleared, so a warehouse that broke stays broken
 *     whatever was verified since;
 *  2. "Verified through #N · <IST>";
 *  3. "Not yet checked" (the worker has not run, or is off).
 */
export function integrityStatus(row: Pick<WarehouseLedgerIntegrityDto, 'brokenAtSeq' | 'verifiedThroughSeq' | 'verifiedAt' | 'openBreakCount'>): IntegrityStatus {
  if (row.brokenAtSeq !== null) {
    // From the server's count of EVERY open break — the listed breaks are
    // only the newest 10, and an older open one must not hide behind them.
    const acknowledged = row.openBreakCount === 0;
    return { tone: 'broken', text: `Broken at #${row.brokenAtSeq}${acknowledged ? ' · acknowledged' : ''}` };
  }
  if (row.verifiedThroughSeq !== null) {
    const at = row.verifiedAt === null ? '' : ` · ${istDateTimeLabel(row.verifiedAt)}`;
    return { tone: 'verified', text: `Verified through #${row.verifiedThroughSeq}${at}` };
  }
  return { tone: 'unchecked', text: 'Not yet checked' };
}

/** "N events verified in the pre-0026 form" — only when the baseline found any (B > 0). */
export function legacyLabel(legacyThroughSeq: number): string | null {
  if (legacyThroughSeq <= 0) return null;
  return `${legacyThroughSeq.toLocaleString('en-IN')} ${legacyThroughSeq === 1 ? 'event' : 'events'} verified in the pre-0026 form`;
}

/** The last anchor's range and time. */
export function lastAnchorLabel(anchor: Pick<LedgerAnchorDto, 'fromSeq' | 'toSeq' | 'anchoredAt'> | null): string {
  if (anchor === null) return 'No anchor yet';
  return `Last anchor #${anchor.fromSeq}–#${anchor.toSeq} · ${istDateTimeLabel(anchor.anchoredAt)}`;
}

/**
 * The WORM line:
 *  - "WORM storage not configured" (`LEDGER_ANCHOR_WORM=none`);
 *  - "N anchors waiting for WORM copy" while any anchor is uncopied;
 *  - "Stored in WORM until <date>" — the last anchor's Object Lock date;
 *  - nothing while there is no anchor to store.
 */
export function wormLabel(row: Pick<WarehouseLedgerIntegrityDto, 'wormPending' | 'lastAnchor'>, mode: WormStoreMode): string | null {
  if (mode === 'none') return 'WORM storage not configured';
  if (row.wormPending > 0) {
    return `${row.wormPending.toLocaleString('en-IN')} ${row.wormPending === 1 ? 'anchor' : 'anchors'} waiting for WORM copy`;
  }
  if (row.lastAnchor?.worm) return `Stored in WORM until ${istDateLabel(row.lastAnchor.worm.retainUntil)}`;
  return null;
}

/** One break, in words: kind, first seq and when (the reason is shown beside it, verbatim). */
export function breakLabel(entry: Pick<ChainBreakDto, 'kind' | 'firstSeq' | 'detectedAt'>): string {
  return `${BREAK_KIND_LABEL[entry.kind]} break at #${entry.firstSeq} · ${istDateTimeLabel(entry.detectedAt)}`;
}

/** Shown beside a downloaded proof whose recomputed digest no longer matches (`matches: false`) — words, never colour alone. */
export const PROOF_MISMATCH = 'This range no longer matches its anchor';

/** The proof's file name: `ledger-proof-<warehouseCode>-<fromSeq>-<toSeq>.json`. */
export function ledgerProofFilename(warehouseCode: string, anchor: Pick<LedgerAnchorDto, 'fromSeq' | 'toSeq'>): string {
  return `ledger-proof-${warehouseCode}-${anchor.fromSeq}-${anchor.toSeq}.json`;
}

export const LEDGER_INTEGRITY_ROLE_DENIED = 'Only the owner can see the ledger integrity status';

/** The section's refusal copy — branching on `code`, never prose. */
export function integrityReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'role-denied':
        return LEDGER_INTEGRITY_ROLE_DENIED;
      case 'chain-break-not-found':
        return 'That break no longer exists in this warehouse — the section is refreshed.';
      case 'chain-break-acknowledged':
        return 'That break was already acknowledged.';
      case 'anchor-not-found':
        return 'That anchor no longer exists in this warehouse — the list is refreshed.';
      case 'invalid-cursor':
        return 'That page of anchors is no longer valid — start from the first page.';
      case 'validation-failed':
        return error.detail ?? 'That request was malformed.';
      case 'permission-denied':
        return 'Your session belongs to another company — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `The ledger integrity read failed (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** Whether a refusal means the caller may not see the section at all (it hides). */
export function isIntegrityRoleDenied(error: unknown): boolean {
  return error instanceof ApiProblem && error.code === 'role-denied';
}

/** Whether an acknowledge refusal is the benign "someone already did" (reload silently). */
export function isAlreadyAcknowledged(error: unknown): boolean {
  return error instanceof ApiProblem && error.code === 'chain-break-acknowledged';
}
