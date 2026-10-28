/**
 * Story 2-8b — the return to vendor (RTV), the web's pure half: the words
 * (status, reason, document, address kind, source kind), the refusal copy by
 * `code`, the create dialog's draft model (the pool and source caps checked
 * here so a refusal is rare — never relied on), the dispatch capture
 * (`lib/consignment-capture.ts`, shared with 4-7c) bound to the RTV's
 * creation date, and the printable note's model.
 *
 * Pure: no React, no fetch — pinned by `vendor-returns.test.ts`.
 */
import { ApiProblem } from '@/lib/api/client';
import type {
  CreateVendorReturnDto,
  PartnerAddressDto,
  PartnerDto,
  ReturnableArmDto,
  ReturnableSourceDto,
  VendorReturnDto,
  VendorReturnLineDto,
  VendorReturnSummaryDto,
} from '@/lib/api/generated';
import { istDateTimeLabel } from '@/lib/audit-exports';
import { CLIENT_DEPARTED_REASON } from '@/lib/client-departed';
import {
  BRAND_DOCUMENT_LABEL,
  parseConsignmentDraft,
  stateCodeLabel,
  type ConsignmentDraft,
  type DispatchNoteModel,
  type NoteLine,
  type ParsedConsignment,
} from '@/lib/consignment-capture';

export type { DispatchNoteModel, NoteLine, NoteParty } from '@/lib/consignment-capture';
import { formatCount, formatQuantity, parseQuantityInput } from '@/lib/format-quantity';
import { gstinStateName } from '@/lib/gst-states';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { formatIstDate, istDateOf } from '@/lib/rate-cards';
import type { StatusTone } from '@/lib/status-tone';

export type VendorReturnStatus = VendorReturnDto['status'];
export type RtvReasonCode = VendorReturnLineDto['reasonCode'];
export type ConsigneeAddressKind = CreateVendorReturnDto['consigneeAddress'];
export type ReturnableSourceKind = ReturnableSourceDto['kind'];

// ── words ────────────────────────────────────────────────────────────────────

/** Record-typed over the generated unions: a new arm fails the compile until it is named. */
export const VENDOR_RETURN_STATUS_LABEL: Readonly<Record<VendorReturnStatus, string>> = {
  draft: 'Draft — awaiting pick',
  picked: 'Picked — ready to dispatch',
  dispatched: 'Dispatched',
  cancelled: 'Cancelled',
};

/** The status filter's words (short — the chip carries the long form). */
export const VENDOR_RETURN_STATUS_FILTER_LABEL: Readonly<Record<VendorReturnStatus, string>> = {
  draft: 'Draft',
  picked: 'Picked',
  dispatched: 'Dispatched',
  cancelled: 'Cancelled',
};

export const VENDOR_RETURN_STATUSES = Object.keys(VENDOR_RETURN_STATUS_LABEL) as readonly VendorReturnStatus[];

/** The StatusChip tone: a draft waits on the floor (info), a picked one waits on a dispatch (warning). */
export const VENDOR_RETURN_STATUS_TONE: Readonly<Record<VendorReturnStatus, StatusTone>> = {
  draft: 'info',
  picked: 'warning',
  dispatched: 'success',
  cancelled: 'neutral',
};

export function vendorReturnStatusLabel(status: string): string {
  return Object.hasOwn(VENDOR_RETURN_STATUS_LABEL, status) ? VENDOR_RETURN_STATUS_LABEL[status as VendorReturnStatus] : status;
}

export function vendorReturnStatusTone(status: string): StatusTone {
  return Object.hasOwn(VENDOR_RETURN_STATUS_TONE, status) ? VENDOR_RETURN_STATUS_TONE[status as VendorReturnStatus] : 'neutral';
}

export const RTV_REASON_LABEL: Readonly<Record<RtvReasonCode, string>> = {
  damaged: 'Damaged',
  'quality-failure': 'Failed quality check',
  expired: 'Expired',
  'wrong-item': 'Wrong item',
  recall: 'Recall',
  other: 'Other (say what in the note)',
};

export const RTV_REASON_CODES = Object.keys(RTV_REASON_LABEL) as readonly RtvReasonCode[];

export const CONSIGNEE_ADDRESS_LABEL: Readonly<Record<ConsigneeAddressKind, string>> = {
  dispatch: 'Dispatch address',
  registered: 'Registered address',
};

export const CONSIGNEE_ADDRESS_KINDS = Object.keys(CONSIGNEE_ADDRESS_LABEL) as readonly ConsigneeAddressKind[];

export const SOURCE_KIND_LABEL: Readonly<Record<ReturnableSourceKind, string>> = {
  'receipt-damage': 'Damaged at receipt',
  'qc-fail': 'Failed QC',
};

export { BRAND_DOCUMENT_LABEL };

/** The reason a line defaults to from its source kind (receipt damage → damaged, a QC fail → quality failure). */
export function defaultReasonFor(kind: ReturnableSourceKind | null): RtvReasonCode {
  return kind === 'qc-fail' ? 'quality-failure' : 'damaged';
}

// ── copy ─────────────────────────────────────────────────────────────────────

/** A draft's floor instruction (decision 11 — the pick is handheld-only). */
export const RTV_PICK_GUIDANCE = 'Pick it on the handheld (Returns out tab). Nothing moves until it is dispatched — the units stay in DAMAGED.';

/** A16 — the floor instruction when a picked RTV is cancelled. */
export const RTV_CANCEL_PICKED_INSTRUCTION = 'Return the staged units to the DAMAGED location.';

/** The note's footer sentence (decision 10). */
export const RTV_NOT_A_TAX_INVOICE = "Not a tax invoice — goods move under the consignor's document above.";

/** The watermark on a note printed before dispatch. */
export const RTV_DRAFT_WATERMARK = 'DRAFT — not dispatched';

/** The watermark on a cancelled return's print — never a live pick list. */
export const RTV_CANCELLED_WATERMARK = 'CANCELLED — not dispatched';

/** A typed line the build cannot see (hidden by the SKU filter, or no longer returnable). */
export const RTV_HIDDEN_LINE_PROBLEM = 'A line is hidden by the SKU filter or is no longer returnable — show all SKUs and check it.';

/** The note's title. */
export const RTV_NOTE_TITLE = 'Return to Vendor — Dispatch Note';

/** The three copies of a dispatched note (decision 10). */
export const RTV_NOTE_COPIES = ['Vendor copy', 'Transporter copy', 'Warehouse copy'] as const;

/** A16 — how units reach DAMAGED, for the empty returnable list. */
export function returnableEmptySentence(clientName: string, warehouseLabel: string): string {
  return `Nothing of ${clientName} is in DAMAGED at ${warehouseLabel} to return. Units reach DAMAGED by receipt damage (booked on the handheld at receiving), or by a manual QC hold on their bin followed by an inspection that fails them.`;
}

/** A15 — the read's caps bit. */
export const RETURNABLE_TRUNCATED_HINT =
  'Showing the first 500 damaged SKU/batch arms (20 sources each) — filter by SKU to see the rest.';

// ── bounds (the backend's) ───────────────────────────────────────────────────

export const RTV_LIMITS = {
  /** `CreateVendorReturnDto.lines` 1–200. */
  lines: 200,
  /** The header note and the cancel reason, 1–500 after trimming. */
  note: 500,
  cancelReason: 500,
} as const;

// ── refusals ─────────────────────────────────────────────────────────────────

export type RtvAction = 'create' | 'dispatch' | 'cancel' | 'read';

const num = (value: unknown): string | null => (typeof value === 'number' && Number.isFinite(value) ? formatCount(value) : null);
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

const ROLE_DENIED: Readonly<Record<RtvAction, string>> = {
  create: 'Your role cannot create returns to vendor.',
  dispatch: 'Your role cannot dispatch returns to vendor.',
  cancel: 'Your role cannot cancel returns to vendor.',
  read: 'Your role cannot read returns to vendor.',
};

/**
 * A refused RTV request in words, by `code` — never by prose. The numbers
 * come from the problem's extension members (the server names the arm and
 * its figures); the server's `detail` is the fallback only for a code this
 * build does not know.
 */
export function rtvReason(error: unknown, action: RtvAction = 'create'): string {
  if (!(error instanceof ApiProblem)) return UNREACHABLE_REASON;
  const x = error.extensions;
  const status = str(x['rtvStatus']);
  const now = status === null ? '' : ` (it is ${vendorReturnStatusLabel(status).toLowerCase()} now)`;
  switch (error.code) {
    // ── create ──
    case 'rtv-sku-unsupported':
      return 'A serial-tracked, catch-weight or kit SKU cannot go on a return to vendor — remove that line.';
    case 'mixed-client':
      return "Every line must be one client's SKUs — a return to vendor carries one brand's goods.";
    case 'client-departed':
      return CLIENT_DEPARTED_REASON;
    case 'partner-not-vendor':
      return 'That partner is not a vendor — pick a vendor.';
    case 'vendor-inactive':
      return 'That vendor is inactive — reactivate it under Settings → Partners, or pick another.';
    case 'vendor-not-linked':
      return 'That vendor is not linked to this client — link it under Settings → Partners, or pick another.';
    case 'rtv-exceeds-damaged': {
      const onHand = num(x['onHandQty']);
      const claimed = num(x['claimedQty']);
      const available = num(x['availableQty']);
      const requested = num(x['requestedQty']);
      if (onHand === null || available === null) return 'DAMAGED no longer holds that much after the other open returns — refresh and lower the quantity.';
      return `DAMAGED holds ${onHand}${claimed !== null && claimed !== '0' ? `, ${claimed} already claimed by open returns` : ''} — at most ${available} can go on a new return${requested === null ? '' : ` (asked ${requested})`}. Refresh and lower the quantity.`;
    }
    case 'rtv-vendor-mismatch':
      return "A source line was received against another vendor's purchase order — its units go back to that vendor. Pick that vendor, or clear the source.";
    case 'rtv-exceeds-source': {
      const claimable = num(x['claimableQty']);
      const requested = num(x['requestedQty']);
      if (claimable === null) return 'The source GRN line cannot claim that much any more — lower the quantity or clear the source.';
      return `The source GRN line can still claim ${claimable}${requested === null ? '' : ` (asked ${requested})`} — lower the quantity or clear the source.`;
    }
    case 'rtv-source-mismatch':
      return 'A source GRN line is not a receipt of that SKU and batch in this warehouse — refresh and pick the source again, or clear it.';
    // ── pick (device-only; a stale page may still meet them) ──
    case 'rtv-not-draft':
      return `Only a draft return is picked${now} — refresh.`;
    case 'rtv-pick-mismatch':
      return "The pick does not match the return's lines — pick it again on the handheld.";
    case 'rtv-pick-empty':
      return 'Nothing was picked — cancel the return instead.';
    // ── dispatch ──
    case 'rtv-not-picked':
      return `Only a picked return is dispatched${now} — pick it on the handheld first, or refresh.`;
    case 'partner-not-transporter':
      return 'That partner is not a transporter — pick another, or type the carrier name.';
    case 'transporter-inactive':
      return 'That transporter is inactive — pick another, or type the carrier name.';
    case 'disposition-scope-quarantined':
      return 'The DAMAGED stock is under a reconcile quarantine — clear it (Reports → Ledger integrity), then dispatch.';
    case 'rtv-damaged-short': {
      const onHand = num(x['onHandQty']);
      const picked = num(x['pickedQty']);
      const sku = str(x['skuCode']);
      const batch = str(x['batchCode']);
      const arm = sku === null ? 'a line' : batch === null ? sku : `${sku} batch ${batch}`;
      return `DAMAGED holds ${onHand ?? 'less'} of ${arm} but the return ships ${picked ?? 'more'} — units were taken out of DAMAGED after the return was created. Cancel the return and create it again for what is there. Nothing was dispatched.`;
    }
    case 'damaged-bin-conflict':
      return 'A location of yours uses the code DAMAGED — rename it in Settings → Zones & bins, then dispatch.';
    // ── cancel ──
    case 'rtv-closed':
      return `A dispatched or cancelled return cannot be cancelled${now} — refresh.`;
    // ── the house set ──
    case 'not-found':
      return action === 'dispatch'
        ? 'The return, or the transporter, no longer exists — refresh.'
        : action === 'create'
          ? (error.detail ?? 'Something the return names no longer exists — refresh.')
          : 'This return to vendor no longer exists — refresh the list.';
    case 'role-denied':
      return ROLE_DENIED[action];
    case 'permission-denied':
      return 'That return belongs to another tenant — sign in again.';
    case 'unauthenticated':
      return 'Your session expired — sign in again.';
    case 'validation-failed':
      return error.detail ?? 'The server refused the request as sent — check it and try again.';
    case 'idempotency-key-reuse':
      return 'This was already sent with different details — change something and send it again.';
    case 'conflict':
      return 'The same request is still being processed — try again to read the result.';
    case 'invalid-cursor':
      return 'The page position expired — refresh the list.';
    default:
      return error.detail ?? `Not recorded (${error.code}).`;
  }
}

/** A refusal after which the RTV moved (or vanished) — the open view re-reads it. */
export function rtvRefusalReloads(error: unknown): boolean {
  return error instanceof ApiProblem && ['rtv-not-picked', 'rtv-closed', 'rtv-not-draft', 'not-found'].includes(error.code);
}

/** A refusal after which the returnable read is stale (a claim or a write-off moved it). */
export function rtvRefusalStalesReturnable(error: unknown): boolean {
  return error instanceof ApiProblem && ['rtv-exceeds-damaged', 'rtv-exceeds-source', 'rtv-source-mismatch'].includes(error.code);
}

/** A refusal after which the vendor list is stale. */
export function rtvVendorRefusal(error: unknown): boolean {
  return error instanceof ApiProblem && ['partner-not-vendor', 'vendor-inactive', 'vendor-not-linked'].includes(error.code);
}

/** A refusal after which the transporter list is stale. */
export function rtvTransporterRefusal(error: unknown): boolean {
  return error instanceof ApiProblem && ['partner-not-transporter', 'transporter-inactive'].includes(error.code);
}

// ── state → affordances ──────────────────────────────────────────────────────

export const canCancelVendorReturn = (status: string): boolean => status === 'draft' || status === 'picked';
export const canDispatchVendorReturn = (status: string): boolean => status === 'picked';

/** The cancel confirmation's sentence — a picked RTV's units are staged on the dock (A16). */
export function cancelConfirmSentence(rtv: Pick<VendorReturnDto, 'code' | 'status'>): string {
  return rtv.status === 'picked'
    ? `Cancel ${rtv.code}? Nothing has moved in the system. ${RTV_CANCEL_PICKED_INSTRUCTION}`
    : `Cancel ${rtv.code}? Nothing has moved — its claim on DAMAGED is released.`;
}

export function parseCancelReason(text: string): { readonly reason: string | null; readonly problem: string | null } {
  const reason = text.trim();
  if (reason === '') return { reason: null, problem: 'Say why the return is cancelled.' };
  if ([...reason].length > RTV_LIMITS.cancelReason) return { reason: null, problem: `The reason is at most ${RTV_LIMITS.cancelReason} characters.` };
  return { reason, problem: null };
}

// ── outcomes (built from the response) ──────────────────────────────────────

export interface RtvOutcome {
  readonly tone: 'accepted';
  readonly word: string;
  readonly reason: string;
}

const lineCount = (n: number): string => `${n} line${n === 1 ? '' : 's'}`;

export function createdOutcome(rtv: Pick<VendorReturnDto, 'code' | 'lines' | 'vendor'>): RtvOutcome {
  return {
    tone: 'accepted',
    word: `${rtv.code} created`,
    reason: `${lineCount(rtv.lines.length)} for ${rtv.vendor.name}. ${RTV_PICK_GUIDANCE}`,
  };
}

export function dispatchedOutcome(rtv: Pick<VendorReturnDto, 'code' | 'vendor' | 'dispatch'>): RtvOutcome {
  const packages = rtv.dispatch?.packageCount ?? 0;
  const doc = rtv.dispatch === null ? '' : ` under ${BRAND_DOCUMENT_LABEL[rtv.dispatch.brandDocument.type].toLowerCase()} ${rtv.dispatch.brandDocument.number}`;
  return {
    tone: 'accepted',
    word: `${rtv.code} dispatched`,
    reason: `${packages} package${packages === 1 ? '' : 's'} to ${rtv.vendor.name}${doc}. The units left DAMAGED — print the dispatch note for the transporter.`,
  };
}

export function cancelledOutcome(rtv: Pick<VendorReturnDto, 'code' | 'picked'>): RtvOutcome {
  return {
    tone: 'accepted',
    word: `${rtv.code} cancelled`,
    reason: rtv.picked !== null ? `Its claim on DAMAGED is released. ${RTV_CANCEL_PICKED_INSTRUCTION}` : 'Its claim on DAMAGED is released.',
  };
}

// ── the list ─────────────────────────────────────────────────────────────────

/** The list's quantity cell: picked of asked once picked, else asked (base units — lines may mix units). */
export function summaryQuantityLabel(row: Pick<VendorReturnSummaryDto, 'totalQuantity' | 'totalPickedQuantity'>): string {
  return row.totalPickedQuantity === null
    ? formatCount(row.totalQuantity)
    : `${formatCount(row.totalPickedQuantity)} of ${formatCount(row.totalQuantity)}`;
}

/** The moment that matters for the row: dispatched, cancelled, picked, else created — in IST. */
export function summaryWhenLabel(row: Pick<VendorReturnSummaryDto, 'status' | 'createdAt' | 'pickedAt' | 'dispatchedAt' | 'cancelledAt'>): string {
  const at = row.dispatchedAt ?? row.cancelledAt ?? row.pickedAt ?? row.createdAt;
  return istDateTimeLabel(at);
}

/** An actor stamp: `Asha · 27 Oct 2026, 09:40 IST`. */
export function stampLabel(stamp: { readonly byName: string | null; readonly at: string } | null): string {
  if (stamp === null) return '—';
  return `${stamp.byName ?? 'A former member'} · ${istDateTimeLabel(stamp.at)} IST`;
}

/** A quantity at its unit's precision, when known; grouping only otherwise (never rounded). */
export function lineQuantityLabel(qty: number, precision: number | null): string {
  return precision === null ? formatCount(qty) : formatQuantity(qty, precision);
}

// ── the create draft ─────────────────────────────────────────────────────────

/** One returnable arm's identity (the pool the claim counts on). */
export function armKey(arm: Pick<ReturnableArmDto, 'skuId' | 'batchId'>): string {
  return `${arm.skuId}|${arm.batchId ?? ''}`;
}

/** The arm in words: `SKU-1 batch B1`. */
export function armLabel(arm: Pick<ReturnableArmDto, 'skuCode' | 'batchCode' | 'batchId'>): string {
  if (arm.batchId === null) return arm.skuCode;
  return `${arm.skuCode} batch ${arm.batchCode ?? `…${arm.batchId.slice(-8)}`}`;
}

/**
 * One draft line as typed. `source` and `reason` are what the viewer picked,
 * or null — untouched — so the effective values follow the vendor and the
 * source (A5: default to a source of the chosen vendor; the reason from the
 * source kind).
 */
export interface RtvDraftLine {
  /** A local id (React key; never sent). */
  readonly id: string;
  readonly armKey: string;
  readonly quantity: string;
  /** null — untouched; '' — explicitly no source; else a grnLineId. */
  readonly source: string | null;
  readonly reason: RtvReasonCode | null;
}

export interface RtvDraft {
  readonly vendorId: string;
  /** '' until picked. */
  readonly consigneeAddress: ConsigneeAddressKind | '';
  readonly note: string;
  readonly lines: readonly RtvDraftLine[];
}

/** A fresh draft: one empty line per arm. */
export function emptyRtvDraft(arms: readonly ReturnableArmDto[]): RtvDraft {
  return { vendorId: '', consigneeAddress: '', note: '', lines: arms.map((arm) => draftLineFor(arm, 0)) };
}

export function draftLineFor(arm: Pick<ReturnableArmDto, 'skuId' | 'batchId'>, ordinal: number): RtvDraftLine {
  return { id: `${armKey(arm)}#${ordinal}`, armKey: armKey(arm), quantity: '', source: null, reason: null };
}

/**
 * Whether `source` may go back to `vendorId`: a PO source only to its PO's
 * vendor; an ASN or blind receipt's (vendorId null) to any linked vendor.
 */
export function sourceFitsVendor(source: Pick<ReturnableSourceDto, 'vendorId'>, vendorId: string): boolean {
  return source.vendorId === null || vendorId === '' || source.vendorId === vendorId;
}

/** A5 — the source a line defaults to: the arm's first source of exactly the chosen vendor with something to claim. */
export function defaultSourceFor(arm: Pick<ReturnableArmDto, 'sources'>, vendorId: string): ReturnableSourceDto | null {
  if (vendorId === '') return null;
  return arm.sources.find((source) => source.vendorId === vendorId && source.claimableQty > 0) ?? null;
}

export interface ResolvedLine {
  readonly source: ReturnableSourceDto | null;
  readonly reason: RtvReasonCode;
}

/** A line's effective source and reason under the chosen vendor. */
export function resolveLine(line: RtvDraftLine, arm: Pick<ReturnableArmDto, 'sources'>, vendorId: string): ResolvedLine {
  const source =
    line.source === null
      ? defaultSourceFor(arm, vendorId)
      : line.source === ''
        ? null
        : (arm.sources.find((entry) => entry.grnLineId === line.source) ?? null);
  const kind = source?.kind ?? arm.sources[0]?.kind ?? null;
  return { source, reason: line.reason ?? defaultReasonFor(kind) };
}

/** A source option's words: `GRN-0007 · PO-1001 (Acme) · damaged at receipt · 4 claimable`. */
export function sourceOptionLabel(source: ReturnableSourceDto, precision: number): string {
  const doc = source.poCode === null ? 'no PO' : `${source.poCode}${source.vendorName === null ? '' : ` (${source.vendorName})`}`;
  return `${source.grnCode} · ${doc} · ${SOURCE_KIND_LABEL[source.kind].toLowerCase()} · ${formatQuantity(source.claimableQty, precision)} claimable`;
}

/** Why the vendor's address kind cannot be chosen (A7 — no silent fallback), or null. */
export function addressKindBlock(vendor: Pick<PartnerDto, 'dispatchAddress' | 'registeredAddress'> | null, kind: ConsigneeAddressKind): string | null {
  if (vendor === null) return null;
  const address = kind === 'dispatch' ? vendor.dispatchAddress : vendor.registeredAddress;
  return address === null ? `This vendor has no ${CONSIGNEE_ADDRESS_LABEL[kind].toLowerCase()}` : null;
}

/** The address kind a vendor defaults to: its dispatch address, else its registered one, else none. */
export function defaultAddressKind(vendor: Pick<PartnerDto, 'dispatchAddress' | 'registeredAddress'> | null): ConsigneeAddressKind | '' {
  if (vendor === null) return '';
  if (vendor.dispatchAddress !== null) return 'dispatch';
  if (vendor.registeredAddress !== null) return 'registered';
  return '';
}

export type BuiltCreate =
  | { readonly ok: true; readonly body: CreateVendorReturnDto; readonly lineCount: number }
  | { readonly ok: false; readonly problem: string; readonly lineId?: string };

const milli = (qty: number): number => Math.round(qty * 1000);

/**
 * The draft → the create body, or the first problem. Lines left blank (or 0)
 * stay in DAMAGED and are not sent. Checked here, because the client holds
 * the figures (never relied on — the server decides): the pool cap
 * (`available`, summed per arm across the draft's lines, A4), each source's
 * `claimableQty` (summed across lines naming it), the source's vendor, the
 * unit's precision, `other` ⇒ a note, the bounds.
 */
export function buildCreateBody(
  draft: RtvDraft,
  arms: readonly ReturnableArmDto[],
  context: { readonly warehouseId: string; readonly vendor: Pick<PartnerDto, 'id' | 'dispatchAddress' | 'registeredAddress'> | null },
): BuiltCreate {
  if (draft.vendorId === '' || context.vendor === null || context.vendor.id !== draft.vendorId) {
    return { ok: false, problem: 'Pick the vendor the goods go back to.' };
  }
  if (draft.consigneeAddress === '') return { ok: false, problem: "Pick which of the vendor's addresses the goods go to." };
  const block = addressKindBlock(context.vendor, draft.consigneeAddress);
  if (block !== null) return { ok: false, problem: `${block} — pick the other, or add it under Settings → Partners.` };
  const note = draft.note.trim();
  if ([...note].length > RTV_LIMITS.note) return { ok: false, problem: `The note is at most ${RTV_LIMITS.note} characters.` };

  const byKey = new Map(arms.map((arm) => [armKey(arm), arm]));
  const armTotals = new Map<string, number>();
  const sourceTotals = new Map<string, number>();
  const seen = new Set<string>();
  const lines: CreateVendorReturnDto['lines'] = [];
  for (const line of draft.lines) {
    const arm = byKey.get(line.armKey);
    const raw = line.quantity.trim();
    if (raw === '') continue;
    // Never drop a typed line silently: its arm is filtered out or gone from the read.
    if (arm === undefined) return { ok: false, problem: RTV_HIDDEN_LINE_PROBLEM, lineId: line.id };
    const name = armLabel(arm);
    const qty = parseQuantityInput(raw);
    if (qty === null) return { ok: false, problem: `${name}: enter a quantity in ${arm.uom} (a number), or leave it blank.`, lineId: line.id };
    if (qty === 0) continue;
    const p = Math.min(Math.max(Math.trunc(arm.uomPrecision), 0), 3);
    if (Math.round(qty * 10 ** p) / 10 ** p !== qty) {
      return {
        ok: false,
        problem: p === 0 ? `${name}: ${arm.uom} counts in whole units — ${raw} is not one.` : `${name}: ${arm.uom} takes at most ${p} decimal place${p === 1 ? '' : 's'}.`,
        lineId: line.id,
      };
    }
    const resolved = resolveLine(line, arm, draft.vendorId);
    if (resolved.source !== null && !sourceFitsVendor(resolved.source, draft.vendorId)) {
      return {
        ok: false,
        problem: `${name}: ${resolved.source.grnCode} was received against ${resolved.source.poCode ?? 'a purchase order'} of ${resolved.source.vendorName ?? 'another vendor'} — its units go back to that vendor. Pick that vendor, or clear the source.`,
        lineId: line.id,
      };
    }
    const unique = `${line.armKey}|${resolved.source?.grnLineId ?? ''}`;
    if (seen.has(unique)) return { ok: false, problem: `${name}: two lines name the same source — put the quantity on one.`, lineId: line.id };
    seen.add(unique);
    const armTotal = (armTotals.get(line.armKey) ?? 0) + milli(qty);
    armTotals.set(line.armKey, armTotal);
    if (armTotal > milli(arm.available)) {
      return {
        ok: false,
        problem: `${name}: at most ${formatQuantity(arm.available, p)} ${arm.uom} can go back (DAMAGED holds ${formatQuantity(arm.onHand, p)}${arm.claimed > 0 ? `, ${formatQuantity(arm.claimed, p)} claimed by ${arm.claimedBy.join(', ')}` : ''}) — the lines ask ${formatQuantity(armTotal / 1000, p)}.`,
        lineId: line.id,
      };
    }
    if (resolved.source !== null) {
      const sourceTotal = (sourceTotals.get(resolved.source.grnLineId) ?? 0) + milli(qty);
      sourceTotals.set(resolved.source.grnLineId, sourceTotal);
      if (sourceTotal > milli(resolved.source.claimableQty)) {
        return {
          ok: false,
          problem: `${name}: ${resolved.source.grnCode} can still claim ${formatQuantity(resolved.source.claimableQty, p)} ${arm.uom} — lower the quantity or clear the source.`,
          lineId: line.id,
        };
      }
    }
    if (resolved.reason === 'other' && note === '') {
      return { ok: false, problem: `${name}: the reason Other needs the note to say what is wrong.`, lineId: line.id };
    }
    lines.push({
      skuId: arm.skuId,
      ...(arm.batchId === null ? {} : { batchId: arm.batchId }),
      ...(resolved.source === null ? {} : { grnLineId: resolved.source.grnLineId }),
      quantity: qty,
      reasonCode: resolved.reason,
    });
  }
  if (lines.length === 0) return { ok: false, problem: 'Enter a quantity on at least one line — the units to send back.' };
  if (lines.length > RTV_LIMITS.lines) return { ok: false, problem: `A return to vendor carries at most ${RTV_LIMITS.lines} lines — split it.` };
  return {
    ok: true,
    lineCount: lines.length,
    body: {
      warehouseId: context.warehouseId,
      vendorId: draft.vendorId,
      consigneeAddress: draft.consigneeAddress,
      ...(note === '' ? {} : { note }),
      lines,
    },
  };
}

/** The draft's running total per arm (milli-exact), for the row's "of N available" hint. */
export function draftArmTotal(draft: RtvDraft, key: string): number {
  let total = 0;
  for (const line of draft.lines) {
    if (line.armKey !== key) continue;
    const qty = parseQuantityInput(line.quantity);
    if (qty !== null) total += milli(qty);
  }
  return total / 1000;
}

/**
 * One Idempotency-Key per draft (the 2-8a C1 lesson): the key is bound to
 * the body it was minted for — a retry of the same body reuses it, any change
 * to the body mints a new one, and success clears it.
 */
export function keyForBody(
  current: { readonly key: string; readonly body: string } | null,
  body: string,
  mint: () => string,
): { readonly key: string; readonly body: string } {
  return current !== null && current.body === body ? current : { key: mint(), body };
}

// ── the dispatch ─────────────────────────────────────────────────────────────

/** The dispatch capture for this RTV: the shared parser, its 30-day window counted from the RTV's creation. */
export function parseRtvDispatch(draft: ConsignmentDraft, rtv: Pick<VendorReturnDto, 'created'>, nowMs: number): ParsedConsignment {
  return parseConsignmentDraft(draft, { createdAt: rtv.created.at, nowMs });
}

// ── the printable note's model (kind-neutral, `return-dispatch-note.tsx`) ────

export function addressLines(address: PartnerAddressDto | null): readonly string[] {
  if (address === null) return [];
  return [
    address.line1,
    ...(address.line2 === null || address.line2 === '' ? [] : [address.line2]),
    `${address.city} — ${address.pincode}`,
    `State: ${stateCodeLabel(address.stateCode)}`,
  ];
}

function gstinFact(gstin: string | null): { label: string; value: string } {
  if (gstin === null) return { label: 'GSTIN', value: 'Unregistered' };
  const state = gstinStateName(gstin);
  return { label: 'GSTIN', value: state === null ? gstin : `${gstin} (${state})` };
}

/**
 * The note's model from the detail read — every party as frozen on the RTV
 * (A6, A7): the brand (consignor) with the GSTIN the challan names, the
 * warehouse "operated by" the 3PL with no consignor GSTIN there, the vendor
 * (consignee) at the chosen frozen address with its GSTIN and state code.
 * Before dispatch it is a pick list: the asked quantities, one copy, the
 * draft watermark, no capture. Once dispatched: the shipped (picked) lines
 * only, three copies.
 */
export function vendorReturnNoteModel(rtv: VendorReturnDto, precisionOf: (skuId: string) => number | null = () => null): DispatchNoteModel {
  const dispatch = rtv.dispatch;
  const dispatched = rtv.status === 'dispatched' && dispatch !== null;
  const consignorGstin = dispatched ? dispatch.consignorGstin : rtv.client.gstin;
  const wh = rtv.warehouse;
  const origin = wh.originAddress;
  const lines: NoteLine[] = rtv.lines
    .filter((line) => !dispatched || (line.pickedQuantity ?? 0) > 0)
    .map((line) => ({
      key: line.id,
      lineNo: line.lineNo,
      skuCode: line.skuCode,
      skuName: line.skuName,
      hsn: line.hsn ?? '—',
      batch: line.batchCode ?? '—',
      quantity: lineQuantityLabel(dispatched ? (line.pickedQuantity ?? 0) : line.quantity, precisionOf(line.skuId)),
      uom: line.uom,
      reason: RTV_REASON_LABEL[line.reasonCode] ?? line.reasonCode,
    }));
  const capture: { label: string; value: string }[] = [];
  if (dispatched) {
    const doc = dispatch.brandDocument;
    capture.push({ label: "Consignor's document", value: `${BRAND_DOCUMENT_LABEL[doc.type] ?? doc.type} ${doc.number} · ${formatIstDate(doc.date)}` });
    if (dispatch.debitNoteNumber !== null) capture.push({ label: 'Debit note', value: dispatch.debitNoteNumber });
    capture.push({
      label: 'E-way bill',
      value:
        dispatch.ewayBill === null
          ? 'None recorded'
          : `${dispatch.ewayBill.number} · ${formatIstDate(dispatch.ewayBill.date)}${dispatch.ewayBill.validUntil === null ? '' : ` · valid until ${formatIstDate(dispatch.ewayBill.validUntil)}`}`,
    });
    const carrier = dispatch.transporter !== null ? `${dispatch.transporter.name} (${dispatch.transporter.code})` : dispatch.carrierName;
    capture.push({ label: 'Transporter', value: carrier ?? '—' });
    if (dispatch.transporter !== null && dispatch.carrierName !== null) capture.push({ label: 'Carrier', value: dispatch.carrierName });
    capture.push({ label: 'Vehicle', value: dispatch.vehicleNumber ?? '—' });
    capture.push({ label: 'AWB / LR', value: dispatch.trackingRef ?? '—' });
    capture.push({ label: 'Packages', value: formatCount(dispatch.packageCount) });
    capture.push({ label: 'Dispatched', value: stampLabel(dispatch) });
  }
  return {
    title: RTV_NOTE_TITLE,
    code: rtv.code,
    dateLabel: formatIstDate(istDateOf(dispatched ? dispatch.at : rtv.created.at)),
    dispatched,
    watermark: dispatched ? null : rtv.status === 'cancelled' ? RTV_CANCELLED_WATERMARK : RTV_DRAFT_WATERMARK,
    copies: dispatched ? RTV_NOTE_COPIES : rtv.status === 'cancelled' ? ['Cancelled'] : ['Pick list'],
    consignor: {
      heading: 'Consignor (the brand)',
      name: rtv.client.legalName ?? rtv.client.name,
      lines: [...(rtv.client.legalName !== null && rtv.client.legalName !== rtv.client.name ? [rtv.client.name] : []), ...addressLines(rtv.client.registeredAddress)],
      facts: [gstinFact(consignorGstin)],
    },
    dispatchedFrom: {
      heading: `Dispatched from — operated by ${wh.operatorName}`,
      name: `${wh.name} (${wh.code})`,
      lines:
        origin === null
          ? []
          : [
              origin.line1,
              ...(origin.line2 === null || origin.line2 === '' ? [] : [origin.line2]),
              `${origin.city} — ${origin.pincode}`,
              `State: ${origin.state}`,
              `Contact: ${origin.contactName} · ${origin.phone}`,
            ],
      facts: [],
    },
    consignee: {
      heading: `Consignee (the vendor) — ${CONSIGNEE_ADDRESS_LABEL[rtv.consigneeAddressKind]?.toLowerCase() ?? rtv.consigneeAddressKind}`,
      name: rtv.vendor.legalName ?? rtv.vendor.name,
      lines: [`Vendor ${rtv.vendor.code}`, ...addressLines(rtv.consigneeAddress)],
      facts: [gstinFact(rtv.vendor.gstin), { label: 'State code', value: stateCodeLabel(rtv.vendor.stateCode) }],
    },
    lines,
    capture,
    note: rtv.note,
    footer: RTV_NOT_A_TAX_INVOICE,
    signatures: ['Transporter — received the goods', `For ${wh.operatorName} — warehouse`],
  };
}
