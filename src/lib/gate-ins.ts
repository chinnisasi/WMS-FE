/**
 * Story 2-3a — the gate-in (one inbound vehicle visit): the pure half of the
 * Inbound Gate-in tab — the IST time helpers the form and the confirmations
 * prefill with, the words the list shows, the draft parser of the Record /
 * Edit form, the action availability by state, and the refusal mapper.
 *
 * Pure: no React, no fetch — every sentence and derivation is pinned by
 * `gate-ins.test.ts` (a claim left in JSX is a claim nothing can pin).
 */
import { ApiProblem } from '@/lib/api/client';
import type {
  AmendGateInDto,
  ClientDto,
  CreateGateInDto,
  GateInDetailDto,
  GateInDocumentInputDto,
  GateInDto,
  GateInEntryDto,
} from '@/lib/api/generated';
import { isRealDate } from '@/lib/audit';
import { istDateTimeLabel } from '@/lib/audit-exports';
import { istLocalToIso } from '@/lib/eway';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

export { istLocalToIso };

export type GateInStatus = GateInEntryDto['status'];
export type SealStatus = GateInEntryDto['sealStatus'];
export type GateInDocumentKind = GateInDocumentInputDto['kind'];
export type UnloadPhase = 'start' | 'end';

/** The backend's bounds (`GATE_IN_LIMITS`, `gate-in.command.ts`). */
export const GATE_IN_LIMITS = {
  documents: 20,
  documentNumber: 40,
  transporterName: 80,
  lrNumber: 30,
  driverName: 80,
  sealNumber: 120,
  dockDoor: 20,
  packages: 1_000_000,
} as const;

/** The gate-ins tab-count read: one multi-status page at the route's `@Max(200)`. */
export const OPEN_GATE_IN_STATUSES: readonly GateInStatus[] = ['gated_in', 'unloading', 'unloaded'];
export const GATE_IN_PAGE_LIMIT = 200;

// ── the shape rules, mirrored byte for byte from wms-be shared/primitives ────

/** `VEHICLE_NO_RE` (`shared/primitives/vehicle.ts`). */
export const VEHICLE_NO_RE = /^[A-Z0-9]{4,15}$/;
/** `EWB_NO_RE` — an e-way bill number is 12 digits. */
export const EWB_NO_RE = /^[0-9]{12}$/;
/** `PHONE_RE` (`shared/primitives/phone.ts`). */
export const PHONE_RE = /^\+?[0-9]{7,15}$/;
/** The container number (`gate-in.command.ts` `CONTAINER_NO_RE`). */
export const CONTAINER_NO_RE = /^[A-Z0-9]{1,11}$/;

/** Why the Gate-in tab ignores the client switcher (it reuses `AllClientsNote`). */
export const GATE_IN_ALL_CLIENTS_NOTE = 'Gate-ins show every client — a truck can carry several.';

/** The Refresh line: the handheld's unloads reach the list on a reload (no polling). */
export const GATE_IN_REFRESH_NOTE = 'Unloads recorded on a handheld appear when the list is refreshed.';

/** The plate rule in words (decision 13) — the form's hint and its refusal. */
export const VEHICLE_RULE = '4–15 letters and digits; spaces, dots and hyphens are ignored';

/** `normalizeVehicleNo`: upper-cased, spaces, dots and hyphens stripped; blank → null. */
export function normalizeVehicleNo(value: string): string | null {
  const normalized = value.replace(/[\s.-]+/g, '').toUpperCase();
  return normalized === '' ? null : normalized;
}

/** `normalizePhone`: spaces, hyphens, dots and brackets stripped; blank → null. */
export function normalizePhone(value: string): string | null {
  const normalized = value.replace(/[\s().-]+/g, '');
  return normalized === '' ? null : normalized;
}

/** The container as the server normalises it: spaces and hyphens stripped, upper-cased; blank → null. */
export function normalizeContainerNo(value: string): string | null {
  const normalized = value.replace(/[\s-]+/g, '').toUpperCase();
  return normalized === '' ? null : normalized;
}

// ── IST time helpers (a `datetime-local` value is read as IST) ───────────────

const IST_OFFSET_MS = 5.5 * 3_600_000;

/**
 * An instant → the `YYYY-MM-DDTHH:mm` IST wall clock a `datetime-local`
 * input holds. UTC arithmetic only, so a browser in any zone prefills the
 * IST time (never its own); null for a malformed instant.
 */
export function isoToIstLocal(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 16);
}

/** Now, as the IST wall clock a `datetime-local` input holds. */
export function istLocalNow(nowMs: number = Date.now()): string {
  return new Date(nowMs + IST_OFFSET_MS).toISOString().slice(0, 16);
}

/** Today's IST calendar date `YYYY-MM-DD` (a document dated after it is refused). */
export function istToday(nowMs: number = Date.now()): string {
  return istLocalNow(nowMs).slice(0, 10);
}

/** An instant as `21 Oct 2026, 09:40 IST`; '—' when absent. */
export function istTimeLabel(iso: string | null): string {
  return iso === null ? '—' : `${istDateTimeLabel(iso)} IST`;
}

// ── words ────────────────────────────────────────────────────────────────────

export const GATE_IN_STATUS_LABEL: Readonly<Record<GateInStatus, string>> = {
  gated_in: 'Gated in',
  unloading: 'Unloading',
  unloaded: 'Unloaded',
  gated_out: 'Gated out',
};

export const SEAL_STATUS_LABEL: Readonly<Record<SealStatus, string>> = {
  intact: 'Intact',
  broken: 'Broken',
  none: 'No seal',
};

export const DOCUMENT_KIND_LABEL: Readonly<Record<GateInDocumentKind, string>> = {
  invoice: 'Invoice',
  challan: 'Delivery challan',
  bill_of_entry: 'Bill of entry',
};

export const DOCUMENT_KINDS: readonly GateInDocumentKind[] = ['invoice', 'challan', 'bill_of_entry'];
export const SEAL_STATUSES: readonly SealStatus[] = ['intact', 'broken', 'none'];

/**
 * Packages counted against declared, in words (decision 8 — shown, never
 * blocked): "2 short", "3 excess", "Matches"; null when there is no flag
 * (nothing declared — decision 11 — or not counted yet).
 */
export function packagesWords(entry: Pick<GateInEntryDto, 'packagesFlag' | 'packagesDifference'>): string | null {
  switch (entry.packagesFlag) {
    case 'short':
      return `${entry.packagesDifference ?? '?'} short`;
    case 'excess':
      return `${entry.packagesDifference ?? '?'} excess`;
    case 'matches':
      return 'Matches';
    default:
      return null;
  }
}

/** The packages cell: "10 of 12 · 2 short", "12 declared", "10 counted", or '—'. */
export function packagesLabel(
  entry: Pick<GateInEntryDto, 'packagesFlag' | 'packagesDifference' | 'packagesDeclared' | 'packagesCounted'>,
): string {
  const words = packagesWords(entry);
  const { packagesDeclared: declared, packagesCounted: counted } = entry;
  if (counted !== null && declared !== null) return words === null ? `${counted} of ${declared}` : `${counted} of ${declared} · ${words}`;
  if (counted !== null) return `${counted} counted`;
  if (declared !== null) return `${declared} declared`;
  return '—';
}

/** The vehicle cell: the plate, or "Hand delivery" (decision 13). */
export function vehicleLabel(entry: Pick<GateInEntryDto, 'vehicleNo' | 'handDelivery'>): string {
  return entry.vehicleNo ?? (entry.handDelivery ? 'Hand delivery' : '—');
}

/** The GRN list's Gate-in cell: `GI-0001 · KA01AB1234` (the code alone for a hand delivery); '—' unlinked. */
export function grnGateInLabel(grn: { readonly gateInCode?: string; readonly vehicleNo?: string }): string {
  if (grn.gateInCode === undefined) return '—';
  return grn.vehicleNo === undefined ? grn.gateInCode : `${grn.gateInCode} · ${grn.vehicleNo}`;
}

// ── action availability by state (guide §4 level 3) ─────────────────────────

export interface GateInActions {
  readonly start: boolean;
  readonly end: boolean;
  readonly edit: boolean;
  readonly gateOut: boolean;
}

/** Start only on `gated_in`; End on `gated_in` or `unloading`; Edit and Gate out on anything not `gated_out`. */
export function gateInActions(status: GateInStatus): GateInActions {
  return {
    start: status === 'gated_in',
    end: status === 'gated_in' || status === 'unloading',
    edit: status !== 'gated_out',
    gateOut: status !== 'gated_out',
  };
}

// ── the row actions' confirmations ──────────────────────────────────────────

export type GateInAction = 'start' | 'end' | 'gate-out';

/** The question a confirmation asks. */
export function confirmQuestion(action: GateInAction, code: string): string {
  switch (action) {
    case 'start':
      return `Start the unload of ${code}?`;
    case 'end':
      return `End the unload of ${code}?`;
    case 'gate-out':
      return `Closes ${code}; no further edits.`;
  }
}

/**
 * The instant a row action sends. An EDITED time is sent as typed (minutes,
 * read as IST). A time left at its default is the untrimmed instant of the
 * first press — the input holds minutes only, so its value could fall before
 * a floor recorded with seconds in the same minute (400 `time-out-of-order`);
 * kept in `pressed` so a retry of the same confirmation resends the same body.
 */
export function actionInstant(
  timeEdited: boolean,
  typed: string,
  pressed: { current: string | null },
  nowMs: number = Date.now(),
): string {
  if (timeEdited) return typed;
  pressed.current ??= new Date(nowMs).toISOString();
  return pressed.current;
}

/** The confirmation's time and count (frozen in the confirmation), parsed; one problem or the body parts. */
export function parseActionDraft(
  action: GateInAction,
  draft: { readonly time: string; readonly count: string },
): { occurredAt: string; packagesCounted: number | null; problem: null } | { problem: string } {
  const occurredAt = istLocalToIso(draft.time);
  if (occurredAt === null) return { problem: 'Enter the date and time (IST).' };
  if (action !== 'end') return { occurredAt, packagesCounted: null, problem: null };
  const count = draft.count.trim();
  if (!/^[0-9]+$/.test(count) || Number(count) > GATE_IN_LIMITS.packages) {
    return { problem: `Enter the packages counted — a whole number from 0 to ${GATE_IN_LIMITS.packages.toLocaleString('en-IN')}.` };
  }
  return { occurredAt, packagesCounted: Number(count), problem: null };
}

/**
 * The banner after an unload answer, built from the RESPONSE. `applied:
 * false` — the first record stands and nothing changed — says "Already
 * recorded at {time} IST", never a success.
 */
export function unloadOutcome(
  phase: UnloadPhase,
  answer: { readonly applied: boolean; readonly gateIn: Pick<GateInDto, 'code' | 'unloadStartedAt' | 'unloadEndedAt' | 'packagesCounted' | 'packagesDeclared'> },
): { tone: 'accepted' | 'warning'; word: string; reason: string } {
  const { gateIn } = answer;
  const at = phase === 'start' ? gateIn.unloadStartedAt : gateIn.unloadEndedAt;
  if (!answer.applied) {
    return {
      tone: 'warning',
      word: alreadyRecordedSentence(at),
      reason:
        phase === 'start'
          ? `The unload of ${gateIn.code} had already started — the first record stands.`
          : `The unload of ${gateIn.code} had already ended${gateIn.packagesCounted === null ? '' : ` with ${gateIn.packagesCounted} packages counted`} — the first record stands; your count was not recorded.`,
    };
  }
  if (phase === 'start') {
    return { tone: 'accepted', word: `Unload started on ${gateIn.code}`, reason: `Started at ${istTimeLabel(at)}.` };
  }
  const counted = gateIn.packagesCounted;
  const flag =
    counted === null || gateIn.packagesDeclared === null
      ? ''
      : ` — ${packagesWords({
          packagesFlag: counted < gateIn.packagesDeclared ? 'short' : counted > gateIn.packagesDeclared ? 'excess' : 'matches',
          packagesDifference: Math.abs(gateIn.packagesDeclared - counted),
        })}`;
  return {
    tone: 'accepted',
    word: `Unload ended on ${gateIn.code}`,
    reason: `Ended at ${istTimeLabel(at)}; ${counted ?? '?'} package${counted === 1 ? '' : 's'} counted${flag}.`,
  };
}

/** "Already recorded at 21 Oct 2026, 09:40 IST" (the time the first record carries). */
export function alreadyRecordedSentence(at: string | null): string {
  return at === null ? 'Already recorded' : `Already recorded at ${istDateTimeLabel(at)} IST`;
}

/** The gate-out banner (from the response). */
export function gateOutOutcome(gateIn: Pick<GateInDto, 'code' | 'gatedOutAt'>): { tone: 'accepted'; word: string; reason: string } {
  return { tone: 'accepted', word: `${gateIn.code} gated out`, reason: `Left at ${istTimeLabel(gateIn.gatedOutAt)} — the visit is closed.` };
}

/** The Record / Edit banner (from the response). */
export function savedOutcome(gateIn: Pick<GateInDto, 'code'>, mode: 'record' | 'edit'): { tone: 'accepted'; word: string; reason: string } {
  return mode === 'record'
    ? { tone: 'accepted', word: `${gateIn.code} recorded`, reason: 'The vehicle is gated in — the dock can start the unload.' }
    : { tone: 'accepted', word: `${gateIn.code} updated`, reason: 'The gate-in was saved as shown.' };
}

// ── the Record / Edit draft ─────────────────────────────────────────────────

/** One supplier document row as the form holds it. `link` is `''`, `po:<id>` or `asn:<id>`. */
export interface GateInDraftDocument {
  readonly kind: GateInDocumentKind;
  readonly number: string;
  /** `YYYY-MM-DD` as typed (never an instant — D7). */
  readonly documentDate: string;
  readonly ewayBillNo: string;
  readonly link: string;
}

export const EMPTY_DRAFT_DOCUMENT: GateInDraftDocument = { kind: 'invoice', number: '', documentDate: '', ewayBillNo: '', link: '' };

export interface GateInDraft {
  readonly handDelivery: boolean;
  readonly vehicleNo: string;
  readonly containerNo: string;
  /** `partner` = a picked transporter partner; `typed` = "Not listed — type the name". */
  readonly transporterMode: 'partner' | 'typed';
  readonly transporterPartnerId: string;
  readonly transporterName: string;
  readonly lrNumber: string;
  readonly driverName: string;
  readonly driverPhone: string;
  readonly sealStatus: SealStatus;
  readonly sealNumber: string;
  readonly packagesDeclared: string;
  readonly dockDoor: string;
  /** Story 2-3b — "Other — type it": the door is typed, not picked from the warehouse's active doors. */
  readonly dockDoorTyped: boolean;
  /** Story 2-3b — the door was set by hand (an appointment pick no longer prefills it). */
  readonly dockDoorEdited: boolean;
  /** Story 2-3b — the linked dock appointment's id; '' = "No appointment — unscheduled". */
  readonly appointmentId: string;
  /** Story 2-3b — the appointment was picked by hand (the vehicle match no longer pre-selects one). */
  readonly appointmentPicked: boolean;
  /** The `datetime-local` value, read as IST. */
  readonly gatedInAt: string;
  /** Whether the user changed the time — a Record sends it only then (absent = the server's now at save). */
  readonly gatedInAtEdited: boolean;
  readonly documents: readonly GateInDraftDocument[];
}

/** A fresh Record draft: the time is now (IST), one empty document row. */
export function emptyGateInDraft(nowMs: number = Date.now()): GateInDraft {
  return {
    handDelivery: false,
    vehicleNo: '',
    containerNo: '',
    transporterMode: 'partner',
    transporterPartnerId: '',
    transporterName: '',
    lrNumber: '',
    driverName: '',
    driverPhone: '',
    sealStatus: 'intact',
    sealNumber: '',
    packagesDeclared: '',
    dockDoor: '',
    dockDoorTyped: false,
    dockDoorEdited: false,
    appointmentId: '',
    appointmentPicked: false,
    gatedInAt: istLocalNow(nowMs),
    gatedInAtEdited: false,
    documents: [EMPTY_DRAFT_DOCUMENT],
  };
}

/** The Edit draft, from the detail (the full phone reaches a `gate.manage` holder — decision 10). */
export function draftOfGateIn(gateIn: GateInDetailDto): GateInDraft {
  return {
    handDelivery: gateIn.handDelivery,
    vehicleNo: gateIn.vehicleNo ?? '',
    containerNo: gateIn.containerNo ?? '',
    transporterMode: gateIn.transporterPartnerId === null ? 'typed' : 'partner',
    transporterPartnerId: gateIn.transporterPartnerId ?? '',
    transporterName: gateIn.transporterName ?? '',
    lrNumber: gateIn.lrNumber ?? '',
    driverName: gateIn.driverName ?? '',
    driverPhone: gateIn.driverPhone ?? '',
    sealStatus: gateIn.sealStatus,
    sealNumber: gateIn.sealNumber ?? '',
    packagesDeclared: gateIn.packagesDeclared === null ? '' : String(gateIn.packagesDeclared),
    dockDoor: gateIn.dockDoor ?? '',
    dockDoorTyped: false,
    // A stored door is never overwritten by an appointment pick; a blank one is prefilled.
    dockDoorEdited: gateIn.dockDoor !== null,
    // The stored link is the edit's starting point — never re-guessed from the vehicle.
    appointmentId: gateIn.appointment?.id ?? '',
    appointmentPicked: true,
    gatedInAt: isoToIstLocal(gateIn.gatedInAt) ?? '',
    gatedInAtEdited: false,
    documents: [...gateIn.documents]
      .sort((a, b) => a.position - b.position)
      .map((doc) => ({
        kind: doc.kind,
        number: doc.number,
        documentDate: doc.documentDate,
        ewayBillNo: doc.ewayBillNo ?? '',
        link: doc.poId !== null ? `po:${doc.poId}` : doc.asnId !== null ? `asn:${doc.asnId}` : '',
      })),
  };
}

/** The header every write sends — EVERY field (blank → null): an amend is a full replacement. */
export type GateInHeaderBody = Required<Omit<AmendGateInDto, 'gatedInAt'>> & { gatedInAt: string };

const lengthOf = (value: string) => [...value].length;

/**
 * The draft → the header body, or ONE form-level problem naming the field or
 * the document row (nothing is sent while one stands). A fully blank document
 * row is dropped; a row's number is its place on screen.
 */
export function parseGateInDraft(
  draft: GateInDraft,
  nowMs: number = Date.now(),
): { header: GateInHeaderBody; problem: null } | { header: null; problem: string } {
  const refuse = (problem: string) => ({ header: null, problem });
  const optional = (value: string, label: string, max: number): string | null | { problem: string } => {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    if (lengthOf(trimmed) > max) return { problem: `${label} is at most ${max} characters.` };
    return trimmed;
  };

  const vehicleNo = normalizeVehicleNo(draft.vehicleNo);
  if (vehicleNo === null && !draft.handDelivery) {
    return refuse('Enter the vehicle number — or tick Hand delivery when no vehicle came.');
  }
  if (vehicleNo !== null && !VEHICLE_NO_RE.test(vehicleNo)) return refuse(`The vehicle number is ${VEHICLE_RULE}.`);
  const containerNo = normalizeContainerNo(draft.containerNo);
  if (containerNo !== null && !CONTAINER_NO_RE.test(containerNo)) {
    return refuse('The container number is at most 11 letters and digits.');
  }

  let transporterPartnerId: string | null = null;
  let transporterName: string | null = null;
  if (draft.transporterMode === 'partner') {
    if (draft.transporterPartnerId === '') return refuse('Pick the transporter — or choose "Not listed — type the name".');
    transporterPartnerId = draft.transporterPartnerId;
  } else {
    const name = optional(draft.transporterName, 'The transporter name', GATE_IN_LIMITS.transporterName);
    if (typeof name === 'object' && name !== null) return refuse(name.problem);
    if (name === null) return refuse('Type the transporter name.');
    transporterName = name;
  }

  const lrNumber = optional(draft.lrNumber, 'The LR number', GATE_IN_LIMITS.lrNumber);
  if (typeof lrNumber === 'object' && lrNumber !== null) return refuse(lrNumber.problem);
  const driverName = optional(draft.driverName, 'The driver name', GATE_IN_LIMITS.driverName);
  if (typeof driverName === 'object' && driverName !== null) return refuse(driverName.problem);
  const driverPhone = normalizePhone(draft.driverPhone);
  if (driverPhone !== null && !PHONE_RE.test(driverPhone)) {
    return refuse("The driver's phone is 7–15 digits, optionally led by + (spaces, hyphens, dots and brackets are ignored).");
  }

  let sealNumber: string | null = null;
  if (draft.sealStatus !== 'none') {
    const seal = optional(draft.sealNumber, 'The seal number', GATE_IN_LIMITS.sealNumber);
    if (typeof seal === 'object' && seal !== null) return refuse(seal.problem);
    if (seal === null) {
      return refuse(`Enter the seal number — the seal is ${draft.sealStatus} (several seals: type them comma-separated).`);
    }
    sealNumber = seal;
  }

  const declared = draft.packagesDeclared.trim();
  let packagesDeclared: number | null = null;
  if (declared !== '') {
    // The digit grammar, never `Number()` (which reads `1e3` and `0x10`).
    if (!/^[0-9]+$/.test(declared) || Number(declared) > GATE_IN_LIMITS.packages) {
      return refuse(`Packages declared is a whole number from 0 to ${GATE_IN_LIMITS.packages.toLocaleString('en-IN')} — or blank when not declared.`);
    }
    packagesDeclared = Number(declared);
  }

  const dockDoor = optional(draft.dockDoor, 'The dock door', GATE_IN_LIMITS.dockDoor);
  if (typeof dockDoor === 'object' && dockDoor !== null) return refuse(dockDoor.problem);

  const gatedInAt = istLocalToIso(draft.gatedInAt);
  if (gatedInAt === null) return refuse('Enter when the vehicle gated in (date and time, IST).');

  const today = istToday(nowMs);
  const filled = draft.documents
    .map((doc, index) => ({ doc, number: index + 1 }))
    .filter(({ doc }) => doc.number.trim() !== '' || doc.documentDate.trim() !== '' || doc.ewayBillNo.trim() !== '' || doc.link !== '');
  if (filled.length > GATE_IN_LIMITS.documents) return refuse(`A gate-in carries at most ${GATE_IN_LIMITS.documents} documents.`);
  const seen = new Map<string, number>();
  const documents: GateInDocumentInputDto[] = [];
  for (const { doc, number: row } of filled) {
    const label = `Document ${row}`;
    const docNumber = doc.number.trim();
    if (docNumber === '') return refuse(`${label}: enter the document number.`);
    if (lengthOf(docNumber) > GATE_IN_LIMITS.documentNumber) {
      return refuse(`${label}: the number is at most ${GATE_IN_LIMITS.documentNumber} characters.`);
    }
    const date = doc.documentDate.trim();
    if (date === '') return refuse(`${label}: enter the document date.`);
    if (!isRealDate(date)) return refuse(`${label}: the date is not a real date (YYYY-MM-DD).`);
    if (date > today) return refuse(`${label}: the document is dated ${date}, after today (${today}, IST).`);
    const ewb = doc.ewayBillNo.replace(/\s+/g, '');
    if (ewb !== '' && !EWB_NO_RE.test(ewb)) return refuse(`${label}: the e-way bill number is 12 digits (spaces are ignored).`);
    const key = `${doc.kind}|${docNumber.toUpperCase()}`;
    const first = seen.get(key);
    if (first !== undefined) {
      return refuse(`${label} repeats document ${first} — each ${DOCUMENT_KIND_LABEL[doc.kind].toLowerCase()} number appears once on a gate-in.`);
    }
    seen.set(key, row);
    const poId = doc.link.startsWith('po:') ? doc.link.slice(3) : null;
    const asnId = doc.link.startsWith('asn:') ? doc.link.slice(4) : null;
    documents.push({ kind: doc.kind, number: docNumber, documentDate: date, ewayBillNo: ewb === '' ? null : ewb, poId, asnId });
  }

  return {
    header: {
      handDelivery: draft.handDelivery,
      vehicleNo,
      containerNo,
      transporterPartnerId,
      transporterName,
      lrNumber,
      driverName,
      driverPhone,
      sealStatus: draft.sealStatus,
      sealNumber,
      packagesDeclared,
      dockDoor,
      gatedInAt,
      documents,
      // Story 2-3b — '' is unscheduled (null); the create drops a null, the amend always sends it.
      appointmentId: draft.appointmentId === '' ? null : draft.appointmentId,
    },
    problem: null,
  };
}

/**
 * The create body: the header and the warehouse. The time rides only when the
 * user edited it — the prefilled value is the form's OPEN time, so a save
 * twenty minutes later would record the wrong instant; absent, the server
 * stamps its own now.
 */
export function createGateInBody(header: GateInHeaderBody, warehouseId: string, timeEdited: boolean): CreateGateInDto {
  const { gatedInAt, appointmentId, ...rest } = header;
  // Story 2-3b — an unscheduled visit sends no `appointmentId` (the pre-2-3b
  // body, byte for byte); a linked one sends it.
  const linked = appointmentId === null ? rest : { ...rest, appointmentId };
  return timeEdited ? { warehouseId, ...linked, gatedInAt } : { warehouseId, ...linked };
}

/**
 * The amend body — a FULL replacement (every field, blank → null). The time
 * rides only while the gate-in is `gated_in` or when it was changed: an
 * unchanged time resends the STORED instant (never the minute-truncated
 * input, which would move the time and audit a change no one made); a
 * changed time past `gated_in` is the server's 409 `gate-in-time-locked`.
 *
 * Story 2-3b — `appointmentId` is ALWAYS sent (the header carries it: an id
 * keeps or moves the link, null clears it). The server reads an ABSENT key
 * as "unchanged" for an older client; this one always states the link it
 * shows.
 */
export function amendGateInBody(
  header: GateInHeaderBody,
  current: Pick<GateInDto, 'status' | 'gatedInAt'>,
  typedGatedInAt: string,
): AmendGateInDto {
  const { gatedInAt, ...rest } = header;
  const changed = typedGatedInAt !== isoToIstLocal(current.gatedInAt);
  if (changed) return { ...rest, gatedInAt };
  return current.status === 'gated_in' ? { ...rest, gatedInAt: current.gatedInAt } : rest;
}

// ── the PO / ASN link options ───────────────────────────────────────────────

export interface GateInLinkOption {
  /** `po:<id>` / `asn:<id>` — the select's value. */
  readonly value: string;
  readonly label: string;
}

/** "PO-1001 · vendor · client" — the parts that exist. */
export function linkOptionLabel(code: string, vendor: string | null, client: string | null): string {
  return [code, vendor, client].filter((part): part is string => part !== null && part !== '').join(' · ');
}

/** A client as the gate-in names it: the brand's name, or the company for the tenant's own client. */
export function gateInClientName(client: Pick<ClientDto, 'name' | 'systemOwned'> | undefined, tenantName: string | null): string | null {
  if (client === undefined) return null;
  if (client.systemOwned) return tenantName === null || tenantName === '' ? 'Your company' : tenantName;
  return client.name;
}

/** A saved link that is no longer among the options still renders, from the detail's codes. */
export function savedLinkOption(doc: Pick<GateInDetailDto['documents'][number], 'poId' | 'asnId' | 'poCode' | 'asnCode'>): GateInLinkOption | null {
  if (doc.poId !== null) return { value: `po:${doc.poId}`, label: `${doc.poCode ?? 'PO'} (not open)` };
  if (doc.asnId !== null) return { value: `asn:${doc.asnId}`, label: `${doc.asnCode ?? 'ASN'} (not open)` };
  return null;
}

// ── refusals ────────────────────────────────────────────────────────────────

const TRANSPORTER_REFUSAL_CODES: ReadonlySet<string> = new Set(['partner-not-transporter', 'transporter-inactive']);

/** Whether a refusal names the transporter (the form re-reads its transporter options after one). */
export function isTransporterRefusal(error: unknown): boolean {
  return error instanceof ApiProblem && TRANSPORTER_REFUSAL_CODES.has(error.code);
}

/**
 * Every gate-in refusal (record, edit, unload, gate-out), branching on the
 * problem `code` — never on prose. The shared arms read the house copy.
 */
export function gateInReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'validation-failed':
        // The detail names the field or the document row.
        return error.detail ?? 'Check the gate-in and try again.';
      case 'time-in-future':
        return 'That time is more than 5 minutes ahead — check the time entered (IST).';
      case 'time-out-of-order':
        return error.detail ?? 'That time is before the gate-in or the unload start — check the time entered (IST).';
      case 'not-found':
        // A gate-in, the warehouse, the transporter or a document's PO/ASN — the detail says which.
        return error.detail ?? 'It no longer exists — refresh the list.';
      case 'partner-not-transporter':
        return 'That partner is not a transporter — pick another, or type the name.';
      case 'transporter-inactive':
        return 'That transporter is inactive — pick another, or type the name.';
      case 'document-warehouse-mismatch':
        return "A document's PO or ASN belongs to another warehouse — link one of this warehouse's, or leave it unlinked.";
      case 'gate-in-closed':
        return 'This gate-in is gated out — the visit is closed and takes no further edits.';
      case 'gate-in-time-locked':
        return 'The gated-in time is locked once the unload starts — leave it as recorded.';
      case 'gate-in-field-locked':
        return 'The seal and the packages declared are locked once the unload ends — leave them as recorded.';
      case 'conflict':
        return error.detail ?? 'The same submission is still in flight — retry to read the settled result.';
      case 'role-denied':
        return 'Your role cannot record gate-ins.';
      case 'permission-denied':
        return 'Your session belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed with different details — refresh and try again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `The gate-in was not saved (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}
