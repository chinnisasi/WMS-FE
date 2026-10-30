import { ApiProblem } from '@/lib/api/client';
import type {
  CreateFreightLoadDto,
  DispatchFreightLoadDto,
  FreightCandidateDto,
  FreightConsignmentViewDto,
  FreightDeliveryDto,
  FreightDispatchResponse,
  FreightLoadListRowDto,
  FreightLoadViewDto,
  FreightRefusedEntryDto,
  FreightScanResponse,
  OrderFreightBlockDto,
  RecordFreightDeliveryDto,
  RecordFreightLrDto,
  UpdateFreightLoadDto,
} from '@/lib/api/generated';
import { istDateTimeLabel } from '@/lib/audit-exports';
import { COMPLIANCE_EXCEPTION_WORD, consignmentBlockerWord } from '@/lib/consignment';
import type { ConsignmentGateState } from '@/lib/consignment-gate';
import { istLocalToIso } from '@/lib/eway';
import {
  DRIVER_LICENCE_RE,
  FREIGHT_LIMITS,
  SEAL_RE,
  lrProblem,
  normalizeDriverLicence,
  normalizeLr,
  normalizeSeal,
  type DeliveryOutcome,
  type FreightMode,
  type FreightTerms,
  type VehicleType,
} from '@/lib/freight-primitives';
import { CONTAINER_NO_RE, PHONE_RE, VEHICLE_NO_RE, VEHICLE_RULE, istToday, normalizeContainerNo, normalizePhone, normalizeVehicleNo } from '@/lib/gate-ins';
import { DISPATCH_VIA_FREIGHT_REASON } from '@/lib/outbound-pack-dispatch';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import type { StatusTone } from '@/lib/status-tone';

/**
 * Story 4-9a — B2B freight dispatch on the web: the load's and consignment's
 * words, the refusal copy for every code the freight commands answer, the
 * load header / departure / LR / delivery drafts and their parsers (the
 * server's shape rules, mirrored so a body the server can only 400 is never
 * sent), the key binding, capacity maths and the loading order. Pure — pinned
 * by `freight.test.ts`. Every vocabulary is a `Record` over the GENERATED
 * union, so a status or code the backend adds fails this file's compile.
 */

export type FreightLoadStatus = FreightLoadViewDto['status'];
export type FreightConsignmentStatus = FreightConsignmentViewDto['status'];
export type FreightLoadException = NonNullable<FreightConsignmentViewDto['loadException']>;
export type FreightOrderRefusalCode = FreightRefusedEntryDto['code'];
export type FreightLoadsListView = 'open' | 'dispatched' | 'pod-pending' | 'delivery-exceptions' | 'cancelled';

export { FREIGHT_LIMITS };

/** The longest a web departure may be back-dated (A14: `[now − 7 days, now + 2 min]`). */
export const DEPARTURE_PAST_MS = 7 * 86_400_000;
export const FUTURE_SKEW_MS = 2 * 60_000;
/** The candidates picker walks to the end, at most this many (A20's scan bound). */
export const MAX_FREIGHT_CANDIDATES = 2_000;

// ── words ──────────────────────────────────────────────────────────────────

export const LOAD_STATUS_WORD: Readonly<Record<FreightLoadStatus, string>> = {
  open: 'Loading',
  dispatched: 'Departed',
  cancelled: 'Cancelled',
};

export const LOAD_STATUS_TONE: Readonly<Record<FreightLoadStatus, StatusTone>> = {
  open: 'info',
  dispatched: 'success',
  cancelled: 'neutral',
};

export const CONSIGNMENT_STATUS_WORD: Readonly<Record<FreightConsignmentStatus, string>> = {
  planned: 'On the load',
  removed: 'Removed',
  dispatched: 'Departed',
};

export const FREIGHT_MODE_WORD: Readonly<Record<FreightMode, string>> = {
  ftl: 'FTL (full truck)',
  ltl: 'LTL (shared truck)',
};

export const FREIGHT_MODE_SHORT: Readonly<Record<FreightMode, string>> = { ftl: 'FTL', ltl: 'LTL' };

export const VEHICLE_TYPE_WORD: Readonly<Record<VehicleType, string>> = {
  tempo: 'Tempo',
  lcv: 'LCV',
  mcv: 'MCV',
  hcv: 'HCV',
  trailer: 'Trailer',
  'container-20': '20 ft container',
  'container-40': '40 ft container',
  other: 'Other',
};

export const FREIGHT_TERMS_WORD: Readonly<Record<FreightTerms, string>> = {
  paid: 'Paid',
  'to-pay': 'To pay',
  tbb: 'To be billed',
};

export const DELIVERY_OUTCOME_WORD: Readonly<Record<DeliveryOutcome, string>> = {
  delivered: 'Delivered',
  'delivered-with-exceptions': 'Delivered with exceptions',
  refused: 'Refused by the consignee',
};

export const DELIVERY_OUTCOME_TONE: Readonly<Record<DeliveryOutcome, StatusTone>> = {
  delivered: 'success',
  'delivered-with-exceptions': 'warning',
  refused: 'danger',
};

export const LOAD_EXCEPTION_WORD: Readonly<Record<FreightLoadException, string>> = {
  'packages-unscanned': 'Left with packages unscanned',
  'not-on-device-list': 'Left though not on the handheld’s list',
};

export const FREIGHT_VIEW_LABEL: Readonly<Record<FreightLoadsListView, string>> = {
  open: 'Open',
  dispatched: 'Dispatched',
  'pod-pending': 'POD pending',
  'delivery-exceptions': 'Delivery exceptions',
  cancelled: 'Cancelled',
};

export const FREIGHT_VIEWS = Object.keys(FREIGHT_VIEW_LABEL) as readonly FreightLoadsListView[];

/** Why an order cannot be added or sent, in words — one per code of `FREIGHT_ADD_REFUSALS` and `FREIGHT_DISPATCH_REFUSALS`. */
export const FREIGHT_ORDER_REFUSAL_WORD: Readonly<Record<FreightOrderRefusalCode, string>> = {
  'order-not-found': 'The order no longer exists',
  'warehouse-mismatch': 'The order is in another warehouse',
  'order-not-open': 'Not open — dispatched or cancelled',
  'order-on-freight-load': 'Already on another truck',
  'order-has-courier-shipment': 'Has a courier or client label — void it first',
  'consignment-removed': 'Taken off this truck meanwhile',
  'order-not-ready': 'Not packed, or cancelled',
  'order-already-dispatched': 'Already dispatched',
  'client-departed': 'The client has left the warehouse',
  'packages-not-loaded': 'Not every package is loaded — tick “Send with packages unscanned” or leave it',
  'order-holds-recalled-batch': 'Holds a recalled lot — it cannot ship',
  'consignment-documents-missing': 'Invoice not recorded — record it first',
  'eway-bill-required': 'E-way bill not recorded — record it first',
  'eway-bill-expired': 'E-way bill expired — record the extended bill first',
};

export { COMPLIANCE_EXCEPTION_WORD, DISPATCH_VIA_FREIGHT_REASON };

// ── figures ────────────────────────────────────────────────────────────────

/** "340 of 600 loaded" — the word first (UI-PATTERNS §9.2). */
export function loadedWords(loaded: number, total: number): string {
  if (total === 0) return 'No packages yet';
  return `${loaded.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} loaded`;
}

/** A load weight in kg with lakh grouping ("9,840 kg"); "—" unknown. */
export function kgLabel(grams: number | null): string {
  if (grams === null) return '—';
  return `${(Math.round(grams / 100) / 10).toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg`;
}

/** The weight cell against capacity: "9,840 of 20,000 kg", "Over capacity" when above it. */
export function capacityCell(grams: number | null, capacityKg: number | null): { readonly text: string; readonly over: boolean } {
  const weight = kgLabel(grams);
  if (capacityKg === null) return { text: weight, over: false };
  const over = grams !== null && grams > capacityKg * 1000;
  return { text: grams === null ? `— of ${capacityKg.toLocaleString('en-IN')} kg` : `${weight.replace(' kg', '')} of ${capacityKg.toLocaleString('en-IN')} kg`, over };
}

/** "15 pallets, 2 cartons" — a pack's packages in words. */
export function packagesWords(total: number, pallets: number): string {
  const cartons = total - pallets;
  const parts: string[] = [];
  if (pallets > 0) parts.push(`${pallets} pallet${pallets === 1 ? '' : 's'}`);
  if (cartons > 0 || pallets === 0) parts.push(`${cartons} carton${cartons === 1 ? '' : 's'}`);
  return parts.join(', ');
}

/** The list row's client column: "ACME, GLOW +2". */
export function clientCodesLabel(row: Pick<FreightLoadListRowDto, 'clientCodes' | 'clientMore'>): string {
  if (row.clientCodes.length === 0) return '—';
  return row.clientCodes.join(', ') + (row.clientMore > 0 ? ` +${row.clientMore}` : '');
}

/** The loading order: the reverse of the stop order (last drop loaded first — A12). */
export function loadingOrder<T extends { readonly stopSeq: number }>(stops: readonly T[]): T[] {
  return [...stops].sort((a, b) => b.stopSeq - a.stopSeq);
}

/** A planned set moved one place (the Reorder stops editor). Out-of-range moves return the list unchanged. */
export function moveStop<T>(list: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** The planned consignments of a load, in stop order. */
export function plannedConsignments(load: Pick<FreightLoadViewDto, 'consignments'>): FreightConsignmentViewDto[] {
  return load.consignments.filter((c) => c.status === 'planned').sort((a, b) => a.stopSeq - b.stopSeq);
}

/** A consignment row's loading facts: "Re-packed after loading started — scan the new labels" when stale scans exist. */
export function staleScansNote(packages: Pick<FreightConsignmentViewDto['packages'], 'staleScans'>): string | null {
  return packages.staleScans > 0 ? 'Re-packed after loading started — scan the new labels.' : null;
}

/** A row whose order an old api task cancelled (A34): "Order cancelled — remove it". */
export function cancelledOrderNote(consignment: Pick<FreightConsignmentViewDto, 'status' | 'orderStatus'>): string | null {
  return consignment.status === 'planned' && consignment.orderStatus === 'cancelled' ? 'Order cancelled — remove it from the load.' : null;
}

/** The candidate's gate mark (A30): selectable, but it cannot leave until the brand's documents are recorded. */
export function candidateGateNote(candidate: Pick<FreightCandidateDto, 'consignment'>): string | null {
  if (candidate.consignment === undefined || !candidate.consignment.blocking) return null;
  const word = consignmentBlockerWord(candidate.consignment.state as ConsignmentGateState);
  return `${word ?? 'Documents missing'} — it cannot leave until recorded.`;
}

/** The candidates picker's running total against the capacity. */
export function selectionTotals(
  candidates: readonly Pick<FreightCandidateDto, 'orderId' | 'packages' | 'grossWeightGrams'>[],
  selected: ReadonlySet<string>,
  capacityKg: number | null,
): { readonly orders: number; readonly cartons: number; readonly pallets: number; readonly grams: number; readonly weightKnown: boolean; readonly over: boolean } {
  let orders = 0;
  let cartons = 0;
  let pallets = 0;
  let grams = 0;
  let weightKnown = true;
  for (const c of candidates) {
    if (!selected.has(c.orderId)) continue;
    orders += 1;
    cartons += c.packages.cartons;
    pallets += c.packages.pallets;
    if (c.grossWeightGrams === null) weightKnown = false;
    else grams += c.grossWeightGrams;
  }
  return { orders, cartons, pallets, grams, weightKnown, over: capacityKg !== null && grams > capacityKg * 1000 };
}

// ── the delivery in words ─────────────────────────────────────────────────

/** "1 short, 2 damaged" — null when neither. */
export function exceptionCounts(short: number | null, damaged: number | null): string | null {
  const parts: string[] = [];
  if (short !== null && short > 0) parts.push(`${short} short`);
  if (damaged !== null && damaged > 0) parts.push(`${damaged} damaged`);
  return parts.length === 0 ? null : parts.join(', ');
}

/** "Delivered 2 Nov 2026, 11:20 IST — received by A. Kumar"; exceptions and a note follow. */
export function deliveryLine(delivery: Pick<FreightDeliveryDto, 'outcome' | 'deliveredAt' | 'receiverName' | 'short' | 'damaged' | 'note'>): string {
  const when = `${istDateTimeLabel(delivery.deliveredAt)} IST`;
  const receiver = delivery.receiverName === null ? '' : ` — received by ${delivery.receiverName}`;
  const counts = exceptionCounts(delivery.short, delivery.damaged);
  const note = delivery.note === null ? '' : `: “${delivery.note}”`;
  switch (delivery.outcome) {
    case 'delivered':
      return `Delivered ${when}${receiver}`;
    case 'delivered-with-exceptions':
      return `Delivered with exceptions ${when}${receiver}${counts === null ? '' : ` — ${counts}`}${note}`;
    case 'refused':
      return `Refused by the consignee ${when}${note}`;
  }
}

/** The order's Shipping panel freight block (A20), as one sentence. */
export function orderFreightLine(freight: OrderFreightBlockDto): string {
  if (freight.status === 'planned') return `On truck ${freight.loadCode} (stop ${freight.stopSeq}) — ${freight.transporterName}`;
  if (freight.status === 'removed') return `Taken off truck ${freight.loadCode}`;
  const vehicle = freight.vehicleNumber === null ? '' : `, vehicle ${freight.vehicleNumber}`;
  const lr = freight.lrNumber === null ? ', no LR yet' : `, LR ${freight.lrNumber}`;
  const when = freight.dispatchedAt === null ? '' : ` on ${istDateTimeLabel(freight.dispatchedAt)} IST`;
  return `Left by truck ${freight.consignmentRef}${when} — ${freight.transporterName}${vehicle}${lr}`;
}

/** The Pack & Dispatch shipping cell for an order on an open load. */
export function onTruckCell(freight: Pick<OrderFreightBlockDto, 'loadCode' | 'stopSeq'>): string {
  return `On truck ${freight.loadCode} (stop ${freight.stopSeq})`;
}

// ── drafts: the reason, the header ─────────────────────────────────────────

export function parseFreightReason(text: string): { readonly reason: string; readonly problem: null } | { readonly reason: null; readonly problem: string } {
  const reason = text.trim();
  if (reason === '') return { reason: null, problem: 'Say why — the reason is kept with the load.' };
  if ([...reason].length > FREIGHT_LIMITS.reason) return { reason: null, problem: `The reason is at most ${FREIGHT_LIMITS.reason} characters.` };
  return { reason, problem: null };
}

export interface FreightHeaderDraft {
  readonly mode: FreightMode;
  /** `partner` — a transporter partner picked; `typed` — "Not listed — type the name". */
  readonly transporterKind: 'partner' | 'typed';
  readonly transporterId: string;
  readonly transporterName: string;
  readonly vehicleType: VehicleType | '';
  readonly vehicleNumber: string;
  readonly containerNumber: string;
  readonly capacityKg: string;
  readonly driverName: string;
  readonly driverPhone: string;
  readonly driverLicenceNumber: string;
  readonly dockDoor: string;
  /** `datetime-local`, IST; blank → none. */
  readonly reportedAt: string;
  readonly note: string;
}

export const EMPTY_FREIGHT_HEADER: FreightHeaderDraft = {
  mode: 'ftl',
  transporterKind: 'partner',
  transporterId: '',
  transporterName: '',
  vehicleType: '',
  vehicleNumber: '',
  containerNumber: '',
  capacityKg: '',
  driverName: '',
  driverPhone: '',
  driverLicenceNumber: '',
  dockDoor: '',
  reportedAt: '',
  note: '',
};

/** The edit form prefilled from the load (`reportedAt` as the IST wall clock). */
export function headerDraftOf(load: FreightLoadViewDto, toLocal: (iso: string) => string | null): FreightHeaderDraft {
  return {
    mode: load.mode,
    transporterKind: load.transporter.partnerId === null ? 'typed' : 'partner',
    transporterId: load.transporter.partnerId ?? '',
    transporterName: load.transporter.partnerId === null ? load.transporter.name : '',
    vehicleType: load.vehicle.type ?? '',
    vehicleNumber: load.vehicle.number ?? '',
    containerNumber: load.vehicle.containerNumber ?? '',
    capacityKg: load.vehicle.capacityKg === null ? '' : String(load.vehicle.capacityKg),
    driverName: load.driver.name ?? '',
    // A masked phone (no dispatch.execute) is never prefilled — the server would refuse it.
    driverPhone: load.driver.phone !== null && PHONE_RE.test(load.driver.phone) ? load.driver.phone : '',
    driverLicenceNumber: load.driver.licenceNumber !== null && DRIVER_LICENCE_RE.test(load.driver.licenceNumber) ? load.driver.licenceNumber : '',
    dockDoor: load.dockDoor ?? '',
    reportedAt: load.vehicle.reportedAt === null ? '' : (toLocal(load.vehicle.reportedAt) ?? ''),
    note: load.note ?? '',
  };
}

const DOCK_DOOR_RE = /^[A-Z0-9-]{1,20}$/;

type Parsed<T> = { readonly body: T; readonly problem: null } | { readonly body: null; readonly problem: string };

function bad<T>(problem: string): Parsed<T> {
  return { body: null, problem };
}

/** The vehicle and driver fields shared by the header and the departure; problems name the field. */
function parseVehicleAndDriver(
  draft: Pick<FreightHeaderDraft, 'vehicleNumber' | 'containerNumber' | 'driverName' | 'driverPhone' | 'driverLicenceNumber'>,
  required: boolean,
):
  | { readonly problem: string }
  | {
      readonly problem: null;
      readonly vehicleNumber: string | null;
      readonly containerNumber: string | null;
      readonly driverName: string | null;
      readonly driverPhone: string | null;
      readonly driverLicenceNumber: string | null;
    } {
  const vehicleNumber = normalizeVehicleNo(draft.vehicleNumber);
  if (vehicleNumber === null && required) return { problem: 'Enter the vehicle number.' };
  if (vehicleNumber !== null && !VEHICLE_NO_RE.test(vehicleNumber)) return { problem: `Vehicle number: ${VEHICLE_RULE}.` };
  const containerNumber = normalizeContainerNo(draft.containerNumber);
  if (containerNumber !== null && !CONTAINER_NO_RE.test(containerNumber)) return { problem: 'Container number: up to 11 letters and digits.' };
  const driverName = draft.driverName.trim() === '' ? null : draft.driverName.trim();
  if (driverName === null && required) return { problem: 'Enter the driver’s name.' };
  if (driverName !== null && [...driverName].length > FREIGHT_LIMITS.driverName) return { problem: `The driver’s name is at most ${FREIGHT_LIMITS.driverName} characters.` };
  const driverPhone = normalizePhone(draft.driverPhone);
  if (driverPhone !== null && !PHONE_RE.test(driverPhone)) return { problem: 'Driver’s phone: 7–15 digits, an optional leading +.' };
  const licence = draft.driverLicenceNumber.trim() === '' ? null : normalizeDriverLicence(draft.driverLicenceNumber);
  if (licence !== null && !DRIVER_LICENCE_RE.test(licence)) return { problem: 'Driving licence: 6–20 letters and digits (spaces and hyphens are ignored).' };
  return { problem: null, vehicleNumber, containerNumber, driverName, driverPhone, driverLicenceNumber: licence };
}

/** The load header (A9) — create adds the picked orders. */
export function parseFreightHeader(draft: FreightHeaderDraft, nowMs: number): Parsed<UpdateFreightLoadDto> {
  let transporter: UpdateFreightLoadDto['transporter'];
  if (draft.transporterKind === 'partner') {
    if (draft.transporterId === '') return bad('Pick the transporter, or choose “Not listed — type the name”.');
    transporter = { transporterId: draft.transporterId };
  } else {
    const name = draft.transporterName.trim();
    if (name === '') return bad('Type the transporter’s name.');
    if ([...name].length > FREIGHT_LIMITS.transporterName) return bad(`The transporter’s name is at most ${FREIGHT_LIMITS.transporterName} characters.`);
    transporter = { name };
  }
  const vd = parseVehicleAndDriver(draft, false);
  if (vd.problem !== null) return bad(vd.problem);
  let capacity: number | null = null;
  if (draft.capacityKg.trim() !== '') {
    const text = draft.capacityKg.trim();
    if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > FREIGHT_LIMITS.capacityKgMax) {
      return bad(`Capacity is whole kilograms, from 1 to ${FREIGHT_LIMITS.capacityKgMax.toLocaleString('en-IN')}.`);
    }
    capacity = Number(text);
  }
  const dock = draft.dockDoor.trim().toUpperCase();
  if (dock !== '' && !DOCK_DOOR_RE.test(dock)) return bad('Dock door: up to 20 letters, digits and hyphens.');
  let reportedAt: string | null = null;
  if (draft.reportedAt.trim() !== '') {
    reportedAt = istLocalToIso(draft.reportedAt);
    if (reportedAt === null) return bad('Reported at: enter a date and time.');
    const ms = Date.parse(reportedAt);
    if (ms > nowMs + FUTURE_SKEW_MS) return bad('Reported at cannot be in the future.');
    if (ms < nowMs - DEPARTURE_PAST_MS) return bad('Reported at is at most 7 days ago.');
  }
  const note = draft.note.trim();
  if ([...note].length > FREIGHT_LIMITS.note) return bad(`The note is at most ${FREIGHT_LIMITS.note} characters.`);
  const body: UpdateFreightLoadDto = {
    mode: draft.mode,
    transporter,
    ...(draft.vehicleType === '' ? {} : { vehicleType: draft.vehicleType }),
    ...(vd.vehicleNumber === null ? {} : { vehicleNumber: vd.vehicleNumber }),
    ...(vd.containerNumber === null ? {} : { containerNumber: vd.containerNumber }),
    ...(capacity === null ? {} : { vehicleCapacityKg: capacity }),
    ...(vd.driverName === null ? {} : { driverName: vd.driverName }),
    ...(vd.driverPhone === null ? {} : { driverPhone: vd.driverPhone }),
    ...(vd.driverLicenceNumber === null ? {} : { driverLicenceNumber: vd.driverLicenceNumber }),
    ...(dock === '' ? {} : { dockDoor: dock }),
    ...(reportedAt === null ? {} : { vehicleReportedAt: reportedAt }),
    ...(note === '' ? {} : { note }),
  };
  return { body, problem: null };
}

export function createLoadBody(header: UpdateFreightLoadDto, orderIds: readonly string[]): CreateFreightLoadDto {
  return orderIds.length === 0 ? { ...header } : { ...header, orderIds: [...orderIds] };
}

/** One key per draft bound to its body (the handover rule): an unchanged retry replays, any edit mints anew. */
export function bindFreightKey(
  current: { readonly key: string; readonly body: string } | null,
  body: unknown,
  mint: () => string,
): { readonly key: string; readonly body: string } {
  const canonical = JSON.stringify(body);
  return current !== null && current.body === canonical ? current : { key: mint(), body: canonical };
}

// ── the departure (A14) ────────────────────────────────────────────────────

export type DispatchDecision = 'dispatch' | 'leave';

export interface DispatchRowDraft {
  readonly decision: DispatchDecision | null;
  readonly lrNumber: string;
  readonly lrDate: string;
  readonly freightTerms: FreightTerms | '';
  readonly unscannedAcknowledged: boolean;
}

export interface DispatchDraft {
  readonly vehicleNumber: string;
  readonly vehicleType: VehicleType | '';
  readonly containerNumber: string;
  readonly driverName: string;
  readonly driverPhone: string;
  readonly driverLicenceNumber: string;
  readonly seals: readonly string[];
  /** `datetime-local`, IST; blank → now (the server's clock). */
  readonly departedAt: string;
  readonly ewayPartBConfirmed: boolean;
  readonly overCapacityAcknowledged: boolean;
  readonly note: string;
  readonly rows: Readonly<Record<string, DispatchRowDraft>>;
}

/** Loaded state of one consignment, for its default decision. */
export function loadingState(packages: Pick<FreightConsignmentViewDto['packages'], 'loaded' | 'total'>): 'full' | 'partial' | 'none' {
  if (packages.total > 0 && packages.loaded >= packages.total) return 'full';
  return packages.loaded === 0 ? 'none' : 'partial';
}

/** A row's default decision (A32's rule, on the web): fully loaded → Send; none → Leave; a blocking gate → Leave; partly → no default. */
export function defaultDecision(consignment: Pick<FreightConsignmentViewDto, 'packages' | 'gate' | 'orderStatus'>): DispatchDecision | null {
  if (consignment.gate?.blocking === true) return 'leave';
  if (consignment.orderStatus !== 'ready_to_dispatch') return 'leave';
  const state = loadingState(consignment.packages);
  if (state === 'full') return 'dispatch';
  if (state === 'none') return 'leave';
  return null;
}

export function emptyDispatchRow(consignment: FreightConsignmentViewDto): DispatchRowDraft {
  return {
    decision: defaultDecision(consignment),
    lrNumber: consignment.lr.number ?? '',
    lrDate: consignment.lr.date ?? '',
    freightTerms: consignment.lr.terms ?? '',
    unscannedAcknowledged: false,
  };
}

export function emptyDispatchDraft(load: FreightLoadViewDto): DispatchDraft {
  const rows: Record<string, DispatchRowDraft> = {};
  for (const c of plannedConsignments(load)) rows[c.orderId] = emptyDispatchRow(c);
  return {
    vehicleNumber: load.vehicle.number ?? '',
    vehicleType: load.vehicle.type ?? '',
    containerNumber: load.vehicle.containerNumber ?? '',
    driverName: load.driver.name ?? '',
    driverPhone: load.driver.phone !== null && PHONE_RE.test(load.driver.phone) ? load.driver.phone : '',
    driverLicenceNumber: load.driver.licenceNumber !== null && DRIVER_LICENCE_RE.test(load.driver.licenceNumber) ? load.driver.licenceNumber : '',
    seals: [...load.seals],
    departedAt: '',
    ewayPartBConfirmed: false,
    overCapacityAcknowledged: false,
    note: '',
    rows,
  };
}

/**
 * After `freight-members-changed`: the draft over the re-read load, keeping
 * the vehicle fields and every surviving row's choices (A30).
 */
export function rebaseDispatchDraft(draft: DispatchDraft, load: FreightLoadViewDto): DispatchDraft {
  const rows: Record<string, DispatchRowDraft> = {};
  for (const c of plannedConsignments(load)) rows[c.orderId] = draft.rows[c.orderId] ?? emptyDispatchRow(c);
  return { ...draft, rows };
}

/** A seal typed or scanned: normalised, refused when malformed, a duplicate, or the sixth. */
export function addSeal(seals: readonly string[], raw: string): { readonly seals: readonly string[]; readonly problem: string | null } {
  const seal = normalizeSeal(raw);
  if (seal === '') return { seals, problem: null };
  if (!SEAL_RE.test(seal)) return { seals, problem: 'A seal number is 1–30 letters, digits, “-” or “/”.' };
  if (seals.includes(seal)) return { seals, problem: `Seal ${seal} is already listed.` };
  if (seals.length >= FREIGHT_LIMITS.seals) return { seals, problem: `At most ${FREIGHT_LIMITS.seals} seals.` };
  return { seals: [...seals, seal], problem: null };
}

/** The ISO date of an IST date-time instant. */
function istDateOfMs(ms: number): string {
  return istToday(ms);
}

/** The LR fields of a row (A14 / A16 / A48): a problem names the order. */
function parseLrFields(
  label: string,
  row: Pick<DispatchRowDraft, 'lrNumber' | 'lrDate' | 'freightTerms'>,
  recorded: string | null,
  departureIstDate: string,
): { readonly problem: string } | { readonly problem: null; readonly lrNumber: string | null; readonly lrDate: string | null; readonly freightTerms: FreightTerms | null } {
  const typed = row.lrNumber.trim();
  const lrNumber = typed === '' ? null : normalizeLr(typed);
  if (lrNumber !== null) {
    const problem = lrProblem(lrNumber);
    if (problem !== null) return { problem: `${label}: ${problem}` };
  }
  const lrDate = row.lrDate.trim() === '' ? null : row.lrDate.trim();
  const freightTerms = row.freightTerms === '' ? null : row.freightTerms;
  if (lrNumber === null && recorded === null && (lrDate !== null || freightTerms !== null)) {
    return { problem: `${label}: an LR date or freight terms need the LR number.` };
  }
  if (lrDate !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lrDate)) return { problem: `${label}: the LR date is a calendar date.` };
    const earliest = new Date(Date.parse(`${departureIstDate}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
    if (lrDate > departureIstDate || lrDate < earliest) return { problem: `${label}: the LR date must be within 30 days before the departure (${departureIstDate}).` };
  }
  return { problem: null, lrNumber, lrDate, freightTerms };
}

/**
 * The departure body (A14, web): the vehicle and driver rules, the seals, the
 * departure time window (A54's floor: not before the load was created or the
 * vehicle reported), one explicit decision per planned order, at least one
 * Send, the LR rules, one client per LR, the unscanned acknowledgement, the
 * Part B and capacity acknowledgements. Problems name the field or the order.
 */
export function parseDispatchDraft(draft: DispatchDraft, load: FreightLoadViewDto, nowMs: number): Parsed<DispatchFreightLoadDto> {
  const vd = parseVehicleAndDriver(draft, true);
  if (vd.problem !== null) return bad(vd.problem);
  for (const seal of draft.seals) if (!SEAL_RE.test(seal)) return bad(`Seal ${seal}: 1–30 letters, digits, “-” or “/”.`);
  if (new Set(draft.seals).size !== draft.seals.length) return bad('A seal is listed twice.');
  if (draft.seals.length > FREIGHT_LIMITS.seals) return bad(`At most ${FREIGHT_LIMITS.seals} seals.`);
  let departedAt: string | null = null;
  let departedMs = nowMs;
  if (draft.departedAt.trim() !== '') {
    departedAt = istLocalToIso(draft.departedAt);
    if (departedAt === null) return bad('Departed at: enter a date and time.');
    departedMs = Date.parse(departedAt);
    if (departedMs > nowMs + FUTURE_SKEW_MS) return bad('Departed at cannot be in the future.');
    if (departedMs < nowMs - DEPARTURE_PAST_MS) return bad('Departed at is at most 7 days ago.');
    const floor = Math.max(Date.parse(load.createdAt), load.vehicle.reportedAt === null ? 0 : Date.parse(load.vehicle.reportedAt));
    if (departedMs < floor) return bad('Departed at cannot be before the load was opened or the vehicle reported.');
  }
  const note = draft.note.trim();
  if ([...note].length > FREIGHT_LIMITS.note) return bad(`The note is at most ${FREIGHT_LIMITS.note} characters.`);
  const departureIstDate = istDateOfMs(Math.min(departedMs, nowMs));
  const consignments: DispatchFreightLoadDto['consignments'] = [];
  const clientsByLr = new Map<string, Set<string>>();
  let sending = 0;
  for (const c of plannedConsignments(load)) {
    const row = draft.rows[c.orderId];
    if (row === undefined || row.decision === null) return bad(`${c.orderLabel}: choose Send or Leave on the dock.`);
    if (row.decision === 'leave') {
      consignments.push({ orderId: c.orderId, decision: 'leave' });
      continue;
    }
    sending += 1;
    const lr = parseLrFields(c.orderLabel, row, c.lr.number, departureIstDate);
    if (lr.problem !== null) return bad(lr.problem);
    const partial = c.packages.packed && c.packages.loaded < c.packages.total;
    if (partial && !row.unscannedAcknowledged) {
      return bad(`${c.orderLabel}: ${c.packages.loaded} of ${c.packages.total} packages loaded — tick “Send with ${c.packages.total - c.packages.loaded} unscanned” or leave it on the dock.`);
    }
    const effectiveLr = lr.lrNumber ?? c.lr.number;
    if (effectiveLr !== null) clientsByLr.set(effectiveLr, new Set([...(clientsByLr.get(effectiveLr) ?? []), c.clientId]));
    consignments.push({
      orderId: c.orderId,
      decision: 'dispatch',
      ...(lr.lrNumber === null ? {} : { lrNumber: lr.lrNumber }),
      ...(lr.lrDate === null ? {} : { lrDate: lr.lrDate }),
      ...(lr.freightTerms === null ? {} : { freightTerms: lr.freightTerms }),
      ...(partial ? { unscannedAcknowledged: true } : {}),
    });
  }
  if (consignments.length === 0) return bad('No order is on this load — cancel it instead.');
  if (sending === 0) return bad('Every order is left on the dock — cancel the load instead.');
  for (const [lr, clients] of clientsByLr) {
    if (clients.size > 1) return bad(`LR ${lr} is given to orders of ${clients.size} clients — an LR covers one client’s goods.`);
  }
  if (load.partB.required && !draft.ewayPartBConfirmed) {
    return bad(`Update the e-way bills’ Part B with vehicle ${vd.vehicleNumber} on the e-way portal, then tick the confirmation.`);
  }
  if (load.totals.overCapacity && !draft.overCapacityAcknowledged) {
    return bad('The truck is over its stated capacity — acknowledge it to send.');
  }
  const body: DispatchFreightLoadDto = {
    vehicleNumber: vd.vehicleNumber!,
    ...(draft.vehicleType === '' ? {} : { vehicleType: draft.vehicleType }),
    ...(vd.containerNumber === null ? {} : { containerNumber: vd.containerNumber }),
    driverName: vd.driverName!,
    ...(vd.driverPhone === null ? {} : { driverPhone: vd.driverPhone }),
    ...(vd.driverLicenceNumber === null ? {} : { driverLicenceNumber: vd.driverLicenceNumber }),
    seals: [...draft.seals],
    ...(departedAt === null ? {} : { departedAt }),
    ...(load.partB.required ? { ewayPartBConfirmed: true } : {}),
    ...(load.totals.overCapacity ? { overCapacityAcknowledged: true } : {}),
    consignments,
    ...(note === '' ? {} : { note }),
  };
  return { body, problem: null };
}

/** The departure's answer in words (built from the RESPONSE). */
export function dispatchOutcome(response: Pick<FreightDispatchResponse, 'load' | 'dispatched' | 'left'>): { readonly word: string; readonly reason: string } {
  const n = response.dispatched.length;
  const left = response.left.length;
  const unscanned = response.dispatched.filter((d) => d.loadException === 'packages-unscanned').length;
  const parts = [`${n} order${n === 1 ? '' : 's'} dispatched`];
  if (left > 0) parts.push(`${left} left on the dock`);
  if (unscanned > 0) parts.push(`${unscanned} with packages unscanned`);
  return { word: `${response.load.code} departed`, reason: `${parts.join(', ')}.` };
}

// ── LR (A16) and delivery (A17) ────────────────────────────────────────────

export interface LrDraft {
  readonly lrNumber: string;
  readonly lrDate: string;
  readonly freightTerms: FreightTerms | '';
  readonly reason: string;
}

export function lrDraftOf(consignment: Pick<FreightConsignmentViewDto, 'lr'>): LrDraft {
  return { lrNumber: consignment.lr.number ?? '', lrDate: consignment.lr.date ?? '', freightTerms: consignment.lr.terms ?? '', reason: '' };
}

/** A16 — the LR body; after departure a reason is required and the date window is the departure's IST date. */
export function parseLrDraft(
  draft: LrDraft,
  consignment: Pick<FreightConsignmentViewDto, 'status' | 'dispatchedAt' | 'orderLabel'>,
  nowMs: number,
): Parsed<RecordFreightLrDto> {
  if (draft.lrNumber.trim() === '') return bad('Enter the LR number (the transporter’s lorry receipt).');
  const departureIstDate = consignment.dispatchedAt === null ? istToday(nowMs) : istToday(Date.parse(consignment.dispatchedAt));
  const lr = parseLrFields('LR', draft, null, departureIstDate);
  if (lr.problem !== null) return bad(lr.problem.replace(/^LR: /, ''));
  const dispatched = consignment.status === 'dispatched';
  let reason: string | null = null;
  if (dispatched) {
    const parsed = parseFreightReason(draft.reason);
    if (parsed.problem !== null) return bad('Say why the LR changes after departure — the reason is kept with the order.');
    reason = parsed.reason;
  }
  return {
    body: {
      lrNumber: lr.lrNumber!,
      ...(lr.lrDate === null ? {} : { lrDate: lr.lrDate }),
      ...(lr.freightTerms === null ? {} : { freightTerms: lr.freightTerms }),
      ...(reason === null ? {} : { reason }),
    },
    problem: null,
  };
}

export interface DeliveryDraft {
  readonly outcome: DeliveryOutcome | '';
  /** `datetime-local`, IST. */
  readonly deliveredAt: string;
  readonly receiverName: string;
  readonly short: string;
  readonly damaged: string;
  readonly note: string;
  readonly reason: string;
}

export function deliveryDraftOf(delivery: FreightDeliveryDto | null, toLocal: (iso: string) => string | null): DeliveryDraft {
  if (delivery === null) return { outcome: '', deliveredAt: '', receiverName: '', short: '', damaged: '', note: '', reason: '' };
  return {
    outcome: delivery.outcome,
    deliveredAt: toLocal(delivery.deliveredAt) ?? '',
    receiverName: delivery.receiverName ?? '',
    short: delivery.short === null || delivery.short === 0 ? '' : String(delivery.short),
    damaged: delivery.damaged === null || delivery.damaged === 0 ? '' : String(delivery.damaged),
    note: delivery.note ?? '',
    reason: '',
  };
}

function parseCount(text: string, label: string): { readonly value: number | null; readonly problem: string | null } {
  const trimmed = text.trim();
  if (trimmed === '') return { value: null, problem: null };
  if (!/^\d+$/.test(trimmed) || Number(trimmed) > 9_999) return { value: null, problem: `${label} is a whole number.` };
  return { value: Number(trimmed), problem: null };
}

/**
 * A17 — the delivery body: the outcome's rules (delivered carries no counts;
 * with exceptions needs a note and at least one short or damaged package;
 * refused needs a note), short + damaged ≤ the consignment's packages, not
 * before the departure nor in the future, and a reason for an amendment.
 */
export function parseDeliveryDraft(
  draft: DeliveryDraft,
  consignment: { readonly packageCount: number; readonly dispatchedAt: string | null; readonly amending: boolean },
  nowMs: number,
): Parsed<RecordFreightDeliveryDto> {
  if (draft.outcome === '') return bad('Choose the outcome: delivered, delivered with exceptions, or refused.');
  if (draft.deliveredAt.trim() === '') return bad('Enter when it was delivered (IST).');
  const deliveredAt = istLocalToIso(draft.deliveredAt);
  if (deliveredAt === null) return bad('Delivered at: enter a date and time.');
  const ms = Date.parse(deliveredAt);
  if (ms > nowMs + FUTURE_SKEW_MS) return bad('Delivered at cannot be in the future.');
  if (consignment.dispatchedAt !== null && ms < Date.parse(consignment.dispatchedAt)) return bad('Delivered at is before the truck left.');
  const receiver = draft.receiverName.trim();
  if ([...receiver].length > FREIGHT_LIMITS.receiverName) return bad(`The receiver’s name is at most ${FREIGHT_LIMITS.receiverName} characters.`);
  const short = parseCount(draft.short, 'Short');
  if (short.problem !== null) return bad(short.problem);
  const damaged = parseCount(draft.damaged, 'Damaged');
  if (damaged.problem !== null) return bad(damaged.problem);
  const note = draft.note.trim();
  if ([...note].length > FREIGHT_LIMITS.note) return bad(`The note is at most ${FREIGHT_LIMITS.note} characters.`);
  const exceptions = (short.value ?? 0) + (damaged.value ?? 0);
  if (draft.outcome === 'delivered' && exceptions > 0) return bad('A clean delivery has no short or damaged packages — choose “Delivered with exceptions”.');
  if (draft.outcome === 'delivered-with-exceptions') {
    if (exceptions === 0) return bad('Enter how many packages were short or damaged.');
    if (note === '') return bad('Describe the exceptions in the note.');
  }
  if (draft.outcome === 'refused' && note === '') return bad('Say why the consignee refused it.');
  if (exceptions > consignment.packageCount) return bad(`Short and damaged together cannot pass the ${consignment.packageCount} packages sent.`);
  let reason: string | null = null;
  if (consignment.amending) {
    const parsed = parseFreightReason(draft.reason);
    if (parsed.problem !== null) return bad('Say why the delivery is amended — the reason is kept with the order.');
    reason = parsed.reason;
  }
  const keepCounts = draft.outcome !== 'delivered';
  return {
    body: {
      outcome: draft.outcome,
      deliveredAt,
      ...(receiver === '' ? {} : { receiverName: receiver }),
      ...(keepCounts && short.value !== null ? { shortPackageCount: short.value } : {}),
      ...(keepCounts && damaged.value !== null ? { damagedPackageCount: damaged.value } : {}),
      ...(note === '' ? {} : { note }),
      ...(reason === null ? {} : { reason }),
    },
    problem: null,
  };
}

/** Recording a delivery is `dispatch.execute`; amending a recorded one is an office role's (`orders.manage`, A17). */
export function canRecordDelivery(consignment: Pick<FreightConsignmentViewDto, 'status' | 'delivery'>, canDispatch: boolean, canManage: boolean): boolean {
  if (consignment.status !== 'dispatched') return false;
  return consignment.delivery === null ? canDispatch : canManage && consignment.delivery.deliverySeq < FREIGHT_LIMITS.deliverySeqMax;
}

// ── refusals ───────────────────────────────────────────────────────────────

export type FreightAction =
  | 'create'
  | 'update'
  | 'add'
  | 'remove'
  | 'stops'
  | 'scan'
  | 'dispatch'
  | 'cancel'
  | 'sheet'
  | 'lr'
  | 'delivery'
  | 'print'
  | 'read';

const LEAD: Readonly<Record<FreightAction, string>> = {
  create: 'Load not created',
  update: 'Load not saved',
  add: 'Orders not added',
  remove: 'Order not removed',
  stops: 'Stops not saved',
  scan: 'Not loaded',
  dispatch: 'Not dispatched',
  cancel: 'Load not cancelled',
  sheet: 'Sheet not attached',
  lr: 'LR not saved',
  delivery: 'Delivery not recorded',
  print: 'Not printed',
  read: 'Not loaded',
};

export interface FreightOrderRefusal {
  readonly code: string;
  readonly word: string;
  readonly detail: string | null;
  readonly loadCode: string | null;
}

/** `freight-orders-refused`'s `extensions.orders[{orderId, code, detail, loadCode?}]` by order — empty for any other answer. */
export function freightOrderRefusals(error: unknown): ReadonlyMap<string, FreightOrderRefusal> {
  const out = new Map<string, FreightOrderRefusal>();
  if (!(error instanceof ApiProblem) || error.code !== 'freight-orders-refused') return out;
  const orders = error.extensions['orders'];
  if (!Array.isArray(orders)) return out;
  for (const entry of orders) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { orderId, code, detail, loadCode } = entry as Record<string, unknown>;
    if (typeof orderId !== 'string' || typeof code !== 'string') continue;
    const base = (FREIGHT_ORDER_REFUSAL_WORD as Readonly<Record<string, string>>)[code] ?? code;
    const word = code === 'order-on-freight-load' && typeof loadCode === 'string' ? `Already on truck ${loadCode}` : base;
    out.set(orderId, { code, word, detail: typeof detail === 'string' ? detail : null, loadCode: typeof loadCode === 'string' ? loadCode : null });
  }
  return out;
}

/** The ids of `freight-members-changed`'s current list (the reload hint). */
export function membersChanged(error: unknown): boolean {
  return error instanceof ApiProblem && error.code === 'freight-members-changed';
}

/** A refusal whose cause is that the world moved: the surface re-reads the load and keeps its draft. */
export function freightRefusalReloads(error: unknown): boolean {
  if (!(error instanceof ApiProblem)) return false;
  return ['freight-members-changed', 'load-not-open', 'load-dispatched', 'load-cancelled', 'consignment-removed', 'consignment-not-dispatched', 'not-found', 'freight-orders-refused'].includes(error.code);
}

/** `eway-part-b-unconfirmed`'s e-way bills, for the dialog's Part B list. */
export function partBOrders(error: unknown): readonly { readonly orderId: string; readonly ewayBillNumber: string }[] {
  if (!(error instanceof ApiProblem) || error.code !== 'eway-part-b-unconfirmed') return [];
  const orders = error.extensions['orders'];
  if (!Array.isArray(orders)) return [];
  return orders.flatMap((o) => {
    if (typeof o !== 'object' || o === null) return [];
    const { orderId, ewayBillNumber } = o as Record<string, unknown>;
    return typeof orderId === 'string' && typeof ewayBillNumber === 'string' ? [{ orderId, ewayBillNumber }] : [];
  });
}

/** Every freight refusal in words, by `code` (A39). */
export function freightReason(error: unknown, action: FreightAction): string {
  if (!(error instanceof ApiProblem)) return UNREACHABLE_REASON;
  const lead = LEAD[action];
  switch (error.code) {
    case 'load-not-open':
      return `${lead} — the load has already left or was cancelled. The list is refreshed.`;
    case 'load-dispatched':
      return `${lead} — this truck has already left.`;
    case 'load-cancelled':
      return `${lead} — this load was cancelled.`;
    case 'load-full':
      return `${lead} — a truck carries at most ${FREIGHT_LIMITS.consignments} orders. Start a second load.`;
    case 'freight-orders-refused':
      return `${lead} — some orders cannot ${action === 'dispatch' ? 'leave' : 'go on this truck'}. Each is marked below with why; fix it, leave it, or untick it, then try again.`;
    case 'freight-members-changed':
      return `${lead} — the orders on this load changed meanwhile. The list was re-read; check it and confirm again.`;
    case 'eway-part-b-unconfirmed':
      return error.detail ?? `${lead} — update the e-way bills’ Part B with the vehicle, then confirm it.`;
    case 'load-over-capacity':
      return error.detail ?? `${lead} — the truck is over its stated capacity. Acknowledge it to send.`;
    case 'package-not-on-load': {
      const other = error.extensions['loadCode'];
      return typeof other === 'string' ? `${lead} — this package belongs to ${other}, not this truck.` : `${lead} — this package is not on this truck. Check where it belongs.`;
    }
    case 'carton-not-current':
      return `${lead} — an old label: the order was re-packed. Reprint its labels and scan the new one.`;
    case 'package-code-invalid':
      return `${lead} — this is not a package label. Scan the carton or pallet label.`;
    case 'package-code-ambiguous':
      return `${lead} — this is the order’s parcel tag and it has several packages. Scan each carton or pallet label.`;
    case 'order-not-packed':
      return `${lead} — the order is not packed yet. Pack it, print its labels, then load.`;
    case 'order-on-freight-load':
      return error.detail ?? `${lead} — the order is on a truck. Remove it from the load first.`;
    case 'dispatch-via-freight':
      return DISPATCH_VIA_FREIGHT_REASON;
    case 'consignment-removed':
      return `${lead} — the order was taken off this truck meanwhile.`;
    case 'consignment-not-dispatched':
      return `${lead} — the order has not left on this truck yet.`;
    case 'delivery-amend-limit':
      return `${lead} — this delivery has been amended too many times.`;
    case 'loading-sheet-limit':
      return `${lead} — the load already has 10 sheet pages. Remove one first.`;
    case 'transporter-inactive':
      return `${lead} — that transporter is inactive. Pick another or reactivate it in Partners.`;
    case 'partner-not-transporter':
      return `${lead} — that partner is not a transporter.`;
    case 'warehouse-mismatch':
      return `${lead} — the order or load is in another warehouse.`;
    case 'client-departed':
      return `${lead} — the client has left the warehouse.`;
    case 'eway-threshold-missing':
      return `${lead} — no e-way threshold is configured for that date. Contact support.`;
    case 'conflict':
      return error.detail ?? `${lead} — another change landed at the same moment. Try again.`;
    case 'not-found':
      return `${lead} — it no longer exists. Refresh the list.`;
    case 'role-denied':
      return action === 'delivery' ? `${lead} — only an office role can amend a recorded delivery.` : `${lead} — your role cannot do this.`;
    case 'permission-denied':
      return `${lead} — your session belongs to another workspace.`;
    case 'idempotency-key-reuse':
      return `${lead} — the request changed after it was first sent. Submit it again.`;
    case 'validation-failed':
      return error.detail ?? `${lead} — check the fields and try again.`;
    default:
      if (error.code.startsWith('file-storage')) return `${lead} — file storage is unavailable. Try again shortly.`;
      return error.detail ?? `${lead} (${error.code}).`;
  }
}

/** A web scan's answer (A13), built from the response: green when loaded, amber when it already was. */
export function scanOutcome(
  response: Pick<FreightScanResponse, 'scan' | 'alreadyLoaded' | 'progress'>,
  orderLabel: string | null,
): { readonly tone: 'accepted' | 'warning'; readonly word: string; readonly reason: string } {
  const who = orderLabel === null ? '' : `${orderLabel}: `;
  const progress = `${who}${loadedWords(response.progress.loaded, response.progress.total)}.`;
  if (response.scan.status === 'unloaded') return { tone: 'accepted', word: `${response.scan.packageCode} unloaded`, reason: progress };
  if (response.alreadyLoaded) return { tone: 'warning', word: `${response.scan.packageCode} already loaded`, reason: progress };
  return { tone: 'accepted', word: `${response.scan.packageCode} loaded`, reason: progress };
}


/** The PDFs' file names. */
export function loadingSheetFilename(load: Pick<FreightLoadViewDto, 'code' | 'status'>): string {
  return `${load.code}-loading-sheet${load.status === 'open' ? '-plan' : ''}.pdf`;
}

export function freightNoteFilename(consignmentRef: string): string {
  return `${consignmentRef.replace('/', '-')}-freight-note.pdf`;
}
