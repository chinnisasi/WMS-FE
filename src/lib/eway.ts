import { ApiProblem } from '@/lib/api/client';
import type {
  AppendEwayStateThresholdDto,
  EwayBillDto,
  EwayBlockerDto,
  EwayTransportDto,
  RecordEwayDto,
  UpdateEwayTransportDto,
} from '@/lib/api/generated';
import { formatRupees, placeOfSupplyLabel } from '@/lib/invoices';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { parseRupees } from '@/lib/rupees';

/**
 * Story 8-2b — the /compliance E-way bills section's pure decisions: the
 * module broadcaster, blocker and refusal copy (branching on the problem
 * `code`, never on prose), the Part B / record / threshold form parsers, the
 * one-GSTIN selection rule and the NIC JSON download name. The backend
 * decides every rule; these only shape requests and render answers.
 */

// ── the module broadcaster ───────────────────────────────────────────────────

export const EWAY_CHANGED_EVENT = 'wms-eway-changed';

export function notifyEwayChanged(): void {
  window.dispatchEvent(new Event(EWAY_CHANGED_EVENT));
}

// ── vocabulary ───────────────────────────────────────────────────────────────

export const EWAY_TABS = ['pending', 'generated', 'dismissed'] as const;
export type EwayTab = (typeof EWAY_TABS)[number];

export const EWAY_TAB_LABEL: Readonly<Record<EwayTab, string>> = {
  pending: 'Pending',
  generated: 'Generated',
  dismissed: 'Dismissed',
};

export type EwayBlockerCode = EwayBlockerDto['code'];

/** Copy for every blocker the backend computes (all eleven codes). */
export const BLOCKER_LABEL: Readonly<Record<EwayBlockerCode, string>> = {
  'invoice-unavailable': 'Invoice no longer issued',
  'hsn-issue': 'HSN missing or invalid',
  'doc-too-old': 'Invoice older than 180 days',
  'too-many-lines': 'More than 250 lines',
  'address-incomplete': 'Address or buyer name incomplete',
  'state-unresolved': 'Address state not recognised',
  'ship-to-differs': 'Ship-to state differs from bill-to',
  'unsupported-supply': 'Export / other-territory supply',
  'rate-not-standard': 'GST rate not in NIC table',
  'needs-irn': 'Needs an IRN (e-invoicing)',
  'transport-incomplete': 'Transport details needed',
};

const BLOCKER_FIX: Readonly<Record<'needs-irn' | 'transport-incomplete', string>> = {
  'needs-irn': 'E-invoicing applies to this GSTIN: NIC will not take a B2B bill without an IRN. Turn the flag off if it no longer applies.',
  'transport-incomplete': 'Enter Part B (a vehicle, or a transport document), or at least the transporter id for a Part-A-only bill.',
};

/**
 * The `needs-irn` fix for a viewer who CANNOT change the flag (story 8-1d):
 * the e-invoicing flag is `eway.configure` (owner-only), so telling an
 * accountant to "turn the flag off" names an action their role lacks.
 */
const NEEDS_IRN_FIX_UNCONFIGURABLE =
  'E-invoicing applies to this GSTIN: NIC will not take a B2B bill without an IRN. If it no longer applies, ask an owner to turn the flag off.';

/** What a terminal blocker tells the user: the invoice is frozen, so the portal is the only path. */
export const TERMINAL_BLOCKER_HINT =
  'The invoice is frozen, so this cannot be fixed here — generate this e-way bill on the NIC portal by hand, then record its number here.';

export function blockerLabel(code: string): string {
  return BLOCKER_LABEL[code as EwayBlockerCode] ?? code;
}

/**
 * The hover/inline explanation of one blocker. `canConfigure` is whether the
 * viewer holds `eway.configure` — the capability that changes the e-invoicing
 * flag — so the `needs-irn` fix follows what the viewer can actually do.
 */
export function blockerHint(blocker: { code: string; terminal: boolean }, canConfigure: boolean): string {
  if (blocker.terminal) return TERMINAL_BLOCKER_HINT;
  if (blocker.code === 'needs-irn' && !canConfigure) return NEEDS_IRN_FIX_UNCONFIGURABLE;
  return BLOCKER_FIX[blocker.code as 'needs-irn' | 'transport-incomplete'] ?? 'Fix the bill and try again.';
}

export const TRANS_MODE_LABEL: Readonly<Record<number, string>> = { 1: 'Road', 2: 'Rail', 3: 'Air', 4: 'Ship' };

/** `National` / `State override (27 — Maharashtra)`. */
export function thresholdRuleLabel(rule: string): string {
  if (rule === 'national') return 'National';
  const match = /^state:(\d{2})$/.exec(rule);
  return match === null ? rule : `State override (${placeOfSupplyLabel(match[1]!)})`;
}

/** A threshold amount; null = no e-way bill required. */
export function thresholdAmountLabel(paise: number | null): string {
  return paise === null ? 'None required' : formatRupees(paise);
}

/** One-line Part B summary for a list row. */
export function transportSummary(transport: EwayTransportDto): string {
  const mode = (transport.transMode as number | null) ?? null;
  const parts: string[] = [];
  if (mode !== null) parts.push(TRANS_MODE_LABEL[mode] ?? `Mode ${mode}`);
  if (transport.vehicleNo !== null) parts.push(transport.vehicleNo);
  if (transport.transDocNo !== null) parts.push(`doc ${transport.transDocNo}`);
  if (transport.transporterId !== null) parts.push(`transporter ${transport.transporterId}`);
  if (transport.distanceKm !== null) parts.push(`${transport.distanceKm} km`);
  return parts.length === 0 ? 'Not entered' : parts.join(' · ');
}

/** An instant as IST date and time (`04 Oct 2026, 10:30`). */
export function istDateTimeLabel(iso: string | null): string {
  if (iso === null) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// ── selection (one GSTIN per NIC file) ───────────────────────────────────────

/** A pending bill the backend reports no blocker for. */
export function isReady(bill: EwayBillDto): boolean {
  return bill.status === 'pending' && bill.blockers.length === 0;
}

/**
 * Whether a bill's checkbox may be ticked: pending, and of the GSTIN already
 * selected (a NIC file is one supplier GSTIN's — mixing is a guaranteed 409).
 */
export function canSelect(bill: EwayBillDto, selectedGstin: string | null): boolean {
  return bill.status === 'pending' && (selectedGstin === null || bill.originGstin === selectedGstin);
}

/** The GSTIN of the current selection, or null when nothing is selected. */
export function selectionGstin(selected: readonly EwayBillDto[]): string | null {
  return selected[0]?.originGstin ?? null;
}

/** The selection split into what goes in the file and what is skipped. */
export function splitSelection(selected: readonly EwayBillDto[]): { ready: EwayBillDto[]; blocked: EwayBillDto[] } {
  return { ready: selected.filter(isReady), blocked: selected.filter((bill) => !isReady(bill)) };
}

export function downloadLabel(readyCount: number): string {
  return `Download NIC JSON (${readyCount})`;
}

/** `2 skipped (blocked)`, or null when nothing is skipped. */
export function skippedLabel(blockedCount: number): string | null {
  return blockedCount === 0 ? null : `${blockedCount} skipped (blocked)`;
}

/** `ewb-bulk-29AAAPZ1234C1ZV-20261004-1030.json` — the IST stamp of the download. */
export function ewayJsonFilename(gstin: string, nowMs: number = Date.now()): string {
  const ist = new Date(nowMs + 5.5 * 3_600_000).toISOString();
  return `ewb-bulk-${gstin}-${ist.slice(0, 10).replace(/-/g, '')}-${ist.slice(11, 16).replace(':', '')}.json`;
}

// ── refusals ─────────────────────────────────────────────────────────────────

export interface ExportRefusal {
  readonly id: string;
  readonly reasons: readonly string[];
}

/** The per-bill reasons a 409 `eway-not-exportable` carries, read defensively; null if absent. */
export function readExportRefusals(error: unknown): ExportRefusal[] | null {
  if (!(error instanceof ApiProblem) || error.code !== 'eway-not-exportable') return null;
  const bills = error.extensions.bills;
  if (!Array.isArray(bills)) return null;
  const refusals: ExportRefusal[] = [];
  for (const entry of bills) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, reasons } = entry as { id?: unknown; reasons?: unknown };
    if (typeof id !== 'string' || !Array.isArray(reasons)) continue;
    refusals.push({ id, reasons: reasons.filter((r): r is string => typeof r === 'string') });
  }
  return refusals;
}

const REFUSAL_REASON_LABEL: Readonly<Record<string, string>> = {
  'not-found': 'no longer exists',
  'not-pending': 'no longer pending',
  claimed: 'being generated through the gateway',
  'mixed-gstin': 'a different GSTIN from the rest',
};

export function refusalReasonLabel(reason: string): string {
  return REFUSAL_REASON_LABEL[reason] ?? blockerLabel(reason);
}

/** `29/2627/000001: no longer pending; 29/2627/000002: Transport details needed`. */
export function refusalList(refusals: readonly ExportRefusal[], labelOf: (id: string) => string): string {
  return refusals.map((r) => `${labelOf(r.id)}: ${r.reasons.map(refusalReasonLabel).join(', ')}`).join('; ');
}

/** The refusals every e-way mutation shares; null when the code is the caller's own. */
function sharedReason(error: ApiProblem, subject: string): string | null {
  switch (error.code) {
    case 'not-found':
      return 'This e-way bill no longer exists — refresh the list.';
    case 'role-denied':
      return `Your role cannot ${subject}.`;
    case 'permission-denied':
      return 'That bill belongs to another tenant — sign in again.';
    case 'unauthenticated':
      return 'Your session expired — sign in again.';
    case 'idempotency-key-reuse':
      return 'This request was already processed with different details — edit the form and submit again.';
    case 'conflict':
      return 'The same request is already being processed — wait a moment and refresh.';
    case 'eway-not-pending':
      return 'This bill is no longer pending — it was recorded, generated or dismissed meanwhile. The list has been refreshed.';
    case 'eway-claimed':
      return 'A gateway generation for this bill is in flight — wait two minutes, then refresh.';
    case 'validation-failed':
      return error.detail ?? 'Check the form and try again.';
    default:
      return null;
  }
}

export function ewayListReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.code === 'invalid-cursor') return 'That page reference is stale — Retry restarts the list from the first page.';
    return sharedReason(error, 'read e-way bills') ?? error.detail ?? 'Could not load the e-way bills.';
  }
  return UNREACHABLE_REASON;
}

export function exportReason(error: unknown, labelOf: (id: string) => string = (id) => id.slice(0, 8)): string {
  if (error instanceof ApiProblem) {
    const refusals = readExportRefusals(error);
    if (refusals !== null && refusals.length > 0) {
      return `Nothing was exported — ${refusalList(refusals, labelOf)}.`;
    }
    return sharedReason(error, 'export e-way bills') ?? error.detail ?? `Not exported (${error.code}).`;
  }
  return UNREACHABLE_REASON;
}

export function transportReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    return sharedReason(error, 'enter transport details') ?? error.detail ?? `Not saved (${error.code}).`;
  }
  return UNREACHABLE_REASON;
}

export function recordReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.code === 'ewb-no-taken') return 'That EWB number is already recorded on another bill — check the number the portal returned.';
    return sharedReason(error, 'record e-way bills') ?? error.detail ?? `Not recorded (${error.code}).`;
  }
  return UNREACHABLE_REASON;
}

export function dismissReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    return sharedReason(error, 'dismiss e-way bills') ?? error.detail ?? `Not dismissed (${error.code}).`;
  }
  return UNREACHABLE_REASON;
}

export function generateEwayReason(error: unknown, labelOf: (id: string) => string = (id) => id.slice(0, 8)): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'gateway-unconfigured':
        return 'No e-way gateway is configured — download the NIC JSON, upload it on the portal and record the number here.';
      case 'eway-gateway-refused':
        return `The gateway refused this bill: ${error.detail ?? 'no reason given'}`;
      case 'eway-gateway-unavailable':
        return 'The gateway could not be reached — try again in two minutes.';
      case 'ewb-no-taken':
        return 'The gateway returned a number already recorded on another bill — refresh and check.';
      case 'eway-not-exportable': {
        const refusals = readExportRefusals(error);
        if (refusals !== null && refusals.length > 0) return `Blocked — ${refusalList(refusals, labelOf)}.`;
        break;
      }
    }
    return sharedReason(error, 'generate e-way bills') ?? error.detail ?? `Not generated (${error.code}).`;
  }
  return UNREACHABLE_REASON;
}

export function configureReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.code === 'not-found') return 'That GSTIN is not one of the tenant\'s registrations.';
    return sharedReason(error, 'change the e-way settings') ?? error.detail ?? `Not saved (${error.code}).`;
  }
  return UNREACHABLE_REASON;
}

// ── forms ────────────────────────────────────────────────────────────────────

export interface TransportDraft {
  transMode: '' | '1' | '2' | '3' | '4';
  vehicleNo: string;
  vehicleType: '' | 'R' | 'O';
  transporterId: string;
  transporterName: string;
  transDocNo: string;
  transDocDate: string;
  distanceKm: string;
}

export function draftFromTransport(transport: EwayTransportDto): TransportDraft {
  const mode = (transport.transMode as number | null) ?? null;
  return {
    transMode: mode === null ? '' : (String(mode) as TransportDraft['transMode']),
    vehicleNo: transport.vehicleNo ?? '',
    vehicleType: (transport.vehicleType as TransportDraft['vehicleType'] | null) ?? '',
    transporterId: transport.transporterId ?? '',
    transporterName: transport.transporterName ?? '',
    transDocNo: transport.transDocNo ?? '',
    transDocDate: transport.transDocDate ?? '',
    distanceKm: transport.distanceKm === null ? '' : String(transport.distanceKm),
  };
}

/**
 * The Part B form → the PATCH body. The PATCH REPLACES the whole Part B, so a
 * blank field is simply omitted (absent clears it) — an all-blank form clears
 * Part B. Only the distance is shape-checked here (a whole number of km);
 * every NIC rule is the backend's, which names each one it refuses.
 */
export function parseTransportDraft(draft: TransportDraft): { body: UpdateEwayTransportDto } | { problem: string } {
  const body: UpdateEwayTransportDto = {};
  if (draft.transMode !== '') body.transMode = Number(draft.transMode) as UpdateEwayTransportDto['transMode'];
  const text = (value: string): string | undefined => (value.trim() === '' ? undefined : value.trim());
  // The vehicle belongs to Road only: a draft switched to Rail/Air/Ship (or
  // to no mode) must not carry the hidden vehicle fields — the backend
  // refuses them and the user could not see what to clear.
  if (draft.transMode === '1') {
    const vehicleNo = text(draft.vehicleNo);
    if (vehicleNo !== undefined) body.vehicleNo = vehicleNo;
    if (draft.vehicleType !== '') body.vehicleType = draft.vehicleType;
  }
  const transporterId = text(draft.transporterId);
  if (transporterId !== undefined) body.transporterId = transporterId;
  const transporterName = text(draft.transporterName);
  if (transporterName !== undefined) body.transporterName = transporterName;
  const transDocNo = text(draft.transDocNo);
  if (transDocNo !== undefined) body.transDocNo = transDocNo;
  const transDocDate = text(draft.transDocDate);
  if (transDocDate !== undefined) body.transDocDate = transDocDate;
  const distance = draft.distanceKm.trim();
  if (distance !== '') {
    if (!/^\d+$/.test(distance) || Number(distance) > 4000) {
      return { problem: 'Distance is a whole number of kilometres, 0–4000.' };
    }
    body.distanceKm = Number(distance);
  }
  return { body };
}

export interface RecordDraft {
  ewbNo: string;
  /** `<input type="datetime-local">` value, read as IST. */
  generatedAt: string;
  validUntil: string;
}

/** A `YYYY-MM-DDTHH:mm` wall-clock time in IST → the UTC ISO instant; null if malformed. */
export function istLocalToIso(local: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (match === null) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const utc = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) return null;
  return new Date(utc - 5.5 * 3_600_000).toISOString();
}

/** The record form → the POST body: a 12-digit number (spaces tolerated) and IST times. */
export function parseRecordDraft(draft: RecordDraft): { body: RecordEwayDto } | { problem: string } {
  const ewbNo = draft.ewbNo.replace(/\s+/g, '');
  if (!/^\d{12}$/.test(ewbNo)) return { problem: 'The EWB number is exactly 12 digits.' };
  const generatedAt = istLocalToIso(draft.generatedAt);
  if (generatedAt === null) return { problem: 'Enter when the portal generated it (date and time, IST).' };
  if (draft.validUntil.trim() === '') return { body: { ewbNo, generatedAt } };
  const validUntil = istLocalToIso(draft.validUntil);
  if (validUntil === null) return { problem: 'Valid-until is a date and time (IST), or blank for a Part-A-only bill.' };
  return { body: { ewbNo, generatedAt, validUntil } };
}

export const DISMISS_REASON_MAX = 200;

export function parseDismissReason(reason: string): { reason: string } | { problem: string } {
  const trimmed = reason.trim();
  if (trimmed.length < 1 || trimmed.length > DISMISS_REASON_MAX) {
    return { problem: `Give a reason of 1–${DISMISS_REASON_MAX} characters.` };
  }
  return { reason: trimmed };
}

export interface ThresholdDraft {
  stateCode: string;
  /** Rupees; ignored when `noneRequired`. */
  amount: string;
  noneRequired: boolean;
  effectiveFrom: string;
}

/** The override form → the POST body (amount in exact paise via the shared rupee grammar). */
export function parseThresholdDraft(draft: ThresholdDraft): { body: AppendEwayStateThresholdDto } | { problem: string } {
  if (!/^\d{2}$/.test(draft.stateCode)) return { problem: 'Pick a state.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.effectiveFrom)) return { problem: 'Pick the date the override takes effect.' };
  if (draft.noneRequired) {
    return { body: { stateCode: draft.stateCode, thresholdPaise: null, effectiveFrom: draft.effectiveFrom } };
  }
  const parsed = parseRupees(draft.amount);
  if ('problem' in parsed) return { problem: parsed.problem };
  return { body: { stateCode: draft.stateCode, thresholdPaise: parsed.paise, effectiveFrom: draft.effectiveFrom } };
}

/** States an intra-state override can name: the CBIC list minus 97 and 99. */
export function overrideStateCodes(names: Readonly<Record<string, string>>): string[] {
  return Object.keys(names)
    .filter((code) => code !== '97' && code !== '99')
    .sort();
}

export const QUEUE_COPY =
  'New bills appear shortly after an invoice issues; a Part-A-only bill lapses after 15 days without Part B.';

export const OVERRIDE_COPY =
  'An override applies to intra-state invoices issued on or after its date. Adding one does not re-evaluate bills already queued, nor invoices that were not queued. Overrides are append-only: a later row for the same date supersedes an earlier one.';
