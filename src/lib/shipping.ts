/**
 * Story 4-4a — client-arranged shipping on the web: the pure half of the
 * Pack & Dispatch Shipping cell and panel, the handover builder, the
 * handovers list and sheet, and the shared upload rules the portal reuses.
 * The kind and status words, the refusal copy by `code` for every arm the
 * story's routes answer, the builder's draft model and its key binding.
 *
 * Pure: no React, no fetch, no hook — every sentence is pinned by
 * `shipping.test.ts`, and the portal may import it (portal-boundary).
 */
import { ApiProblem } from '@/lib/api/client';
import type {
  ClientShipmentViewDto,
  CreateHandoverDto,
  FileViewDto,
  HandoverCandidateDto,
  HandoverRefusedParcelDto,
  HandoverResponse,
  ShipmentDto,
} from '@/lib/api/generated';
import { awbProblem, normalizeAwb } from '@/lib/awb';
import { istLocalToIso, normalizePhone, normalizeVehicleNo, PHONE_RE, VEHICLE_NO_RE, VEHICLE_RULE } from '@/lib/gate-ins';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { DISPATCH_VIA_HANDOVER_REASON } from '@/lib/outbound-pack-dispatch';
import { parseCartonCode } from '@/lib/carton-code';
import { parcelTagCode, parcelTagOrderSuffix } from '@/lib/parcel-tag';
import { prepareImageForUpload, sniffImage } from '@/lib/receipt-photos';
import type { StatusTone } from '@/lib/status-tone';

export { normalizeAwb, awbProblem, parcelTagCode };

export type ShipmentKind = NonNullable<ShipmentDto['kind']>;
export type ShipmentStatus = ShipmentDto['status'];
export type DocKind = NonNullable<FileViewDto['docKind']>;
/** Story 4-5a (A21, D5) — the server's union carries the two carton refusals, appended LAST. */
export type HandoverRefusalCode = HandoverRefusedParcelDto['code'];

// ── bounds (mirrored from wms-be, each named) ──────────────────────────────

/** `MAX_HANDOVER_PARCELS` (handover.command.ts) — a larger pickup is two handovers. */
export const MAX_HANDOVER_PARCELS = 100;
/** `MAX_PACKAGE_COUNT` (shipments_package_count_range, 1–999). */
export const MAX_PACKAGE_COUNT = 999;
/** `MAX_WEIGHT_GRAMS` (handover.command.ts, 1–1,000,000 g). */
export const MAX_WEIGHT_GRAMS = 1_000_000;
/** The courier name's bound (`MAX_COURIER_NAME_LENGTH`, courier.ts). */
export const MAX_COURIER_NAME_LENGTH = 100;
/** The pickup person's name bound (handover.command.ts, 1–100). */
export const MAX_PICKUP_NAME_LENGTH = 100;
/** The handover note's bound (handover.command.ts, ≤ 500). */
export const MAX_HANDOVER_NOTE_LENGTH = 500;
/** A void or removal reason (client-label / shipping-files commands, 1–200). */
export const MAX_SHIPPING_REASON_LENGTH = 200;
/** The upload cap (`AttachmentUploadFilter`, 10 MB) — the label, a document, a sheet page. */
export const MAX_SHIPPING_FILE_BYTES = 10_485_760;
/** The web window (`HANDOVER_PAST_MS` / `HANDOVER_FUTURE_MS`, A40): the pickup time is 7 days back at most. */
export const HANDOVER_PAST_MS = 7 * 86_400_000;
export const HANDOVER_FUTURE_MS = 2 * 60_000;
/** A40 / A49 — the builder walks the candidates to the end, at most this many. */
export const MAX_HANDOVER_CANDIDATES = 500;
/** Caps per order and handover (A46). */
export const MAX_WAREHOUSE_DOCUMENTS = 20;
export const MAX_PORTAL_DOCUMENTS = 10;
export const MAX_SHEET_PAGES = 10;

/** The file input's accept list for a label (PDF only) and for a document or a sheet page. */
export const LABEL_ACCEPT = 'application/pdf';
export const DOCUMENT_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';

// ── words ──────────────────────────────────────────────────────────────────

export const SHIPMENT_KIND_WORD: Readonly<Record<ShipmentKind, string>> = {
  carrier: 'Carrier label',
  'client-label': 'Client label',
  'courier-label': 'Courier label',
};

export const SHIPMENT_STATUS_WORD: Readonly<Record<ShipmentStatus, string>> = {
  labelled: 'Labelled',
  manifested: 'Manifested',
  voided: 'Voided',
  handed_over: 'Handed over',
};

export const DOC_KIND_WORD: Readonly<Record<DocKind, string>> = {
  invoice: 'Invoice',
  challan: 'Delivery challan',
  'eway-bill': 'E-way bill',
  pod: 'Proof of delivery',
  other: 'Other document',
};

/** The kinds staff may upload (all), and the portal's (never `pod` — the warehouse's record of delivery). */
export const STAFF_DOC_KINDS: readonly DocKind[] = ['invoice', 'challan', 'eway-bill', 'pod', 'other'];
export const PORTAL_DOC_KINDS = ['invoice', 'challan', 'eway-bill', 'other'] as const satisfies readonly DocKind[];

/** A shipment the client arranged (a client label or a courier label) — dispatched only by a handover. */
export function isClientArranged(shipment: Pick<ShipmentDto, 'kind'> | null | undefined): boolean {
  return shipment !== null && shipment !== undefined && (shipment.kind === 'client-label' || shipment.kind === 'courier-label');
}

/** A live (not voided) client-arranged shipment: the order's Dispatch button gives way to Hand over. */
export function dispatchesByHandover(shipment: Pick<ShipmentDto, 'kind' | 'status'> | null | undefined): boolean {
  return isClientArranged(shipment) && shipment!.status !== 'voided';
}

/** The AWB's last four, `…9012` — the bench and the refusals name only the tail. */
export function awbTail(awb: string): string {
  return awb.length <= 4 ? awb : `…${awb.slice(-4)}`;
}

export interface ShippingCell {
  readonly word: string;
  readonly tone: StatusTone;
}

/**
 * The packed-order row's Shipping cell (A20). Word first, tone second (never
 * colour alone): "Client label · AWB …9012 · verified ✓" / "Client label ·
 * not verified" (amber) / "Courier label · AWB pre-advised" / "No courier
 * record yet". A voided shipment reads as none. `undefined` is "not read yet".
 */
export function shippingCell(shipment: Pick<ShipmentDto, 'kind' | 'status' | 'trackingNumber' | 'carrierName' | 'labelVerifiedAt'> | null | undefined): ShippingCell | null {
  if (shipment === undefined) return null;
  if (shipment === null || shipment.status === 'voided') return { word: 'No courier record yet', tone: 'neutral' };
  const kind: ShipmentKind = shipment.kind ?? 'carrier';
  if (shipment.status === 'handed_over') return { word: `Handed over · AWB ${awbTail(shipment.trackingNumber)}`, tone: 'success' };
  if (kind === 'carrier') {
    return {
      word: `Carrier label · ${shipment.carrierName} ${awbTail(shipment.trackingNumber)}${shipment.status === 'manifested' ? ' · manifested' : ''}`,
      tone: 'info',
    };
  }
  if (kind === 'client-label') {
    return shipment.labelVerifiedAt === null || shipment.labelVerifiedAt === undefined
      ? { word: `Client label · AWB ${awbTail(shipment.trackingNumber)} · not verified`, tone: 'warning' }
      : { word: `Client label · AWB ${awbTail(shipment.trackingNumber)} · verified ✓`, tone: 'success' };
  }
  return { word: `Courier label · AWB ${awbTail(shipment.trackingNumber)} pre-advised`, tone: 'info' };
}

/** The panel's one-line record of a client-arranged shipment. */
export function clientShipmentLine(shipment: Pick<ClientShipmentViewDto, 'kind' | 'courierName' | 'awb' | 'packageCount'>): string {
  const parcels = shipment.packageCount === null ? '' : ` · ${shipment.packageCount} ${shipment.packageCount === 1 ? 'parcel' : 'parcels'}`;
  return `${SHIPMENT_KIND_WORD[shipment.kind]} · ${shipment.courierName} · AWB ${shipment.awb}${parcels}`;
}

const VERIFY_METHOD_WORD: Readonly<Record<NonNullable<ClientShipmentViewDto['labelVerifyMethod']>, string>> = {
  scan: 'scanned at the bench',
  typed: 'typed at the bench',
  'handover-scan': 'scanned at handover',
};

/** "Verified ✓ — scanned at the bench" or "Not verified — scan the printed label". */
export function verifiedLine(shipment: Pick<ClientShipmentViewDto, 'kind' | 'labelVerifiedAt' | 'labelVerifyMethod'>): string | null {
  if (shipment.kind !== 'client-label') return null;
  if (shipment.labelVerifiedAt === null) return 'Not verified — print the label, stick it on the parcel and scan it.';
  return `Verified ✓ — ${shipment.labelVerifyMethod === null ? 'verified' : VERIFY_METHOD_WORD[shipment.labelVerifyMethod]}`;
}

/** A file's line: "Invoice · INV-SO-1-invoice-1.pdf · 2 pages · 120 KB · uploaded by the client". */
export function fileLine(file: Pick<FileViewDto, 'purpose' | 'docKind' | 'fileName' | 'pageCount' | 'byteSize' | 'source'>): string {
  const parts: string[] = [];
  if (file.purpose === 'shipping-document' && file.docKind !== null) parts.push(DOC_KIND_WORD[file.docKind]);
  if (file.purpose === 'shipping-label') parts.push('Client label');
  if (file.purpose === 'handover-sheet') parts.push('Signed sheet');
  parts.push(file.fileName);
  if (file.pageCount !== null) parts.push(`${file.pageCount} ${file.pageCount === 1 ? 'page' : 'pages'}`);
  if (file.byteSize !== null) parts.push(fileSizeLabel(file.byteSize));
  if (file.source === 'portal') parts.push('uploaded by the client');
  if (file.source === 'handheld') parts.push('photographed on the handheld');
  return parts.join(' · ');
}

export function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The parcel tag's download name (CORS hides the server's): `SO-1042-parcel-tag.zpl`. */
export function parcelTagFilename(orderLabel: string, format: 'zpl' | 'pdf'): string {
  const safe = orderLabel.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'order';
  return `${safe}-parcel-tag.${format}`;
}

/** The handovers list's sheet cell: "✓ 2 pages" or "Not uploaded" (amber). */
export function sheetCell(pages: number): ShippingCell {
  return pages > 0 ? { word: `✓ ${pages} ${pages === 1 ? 'page' : 'pages'}`, tone: 'success' } : { word: 'Not uploaded', tone: 'warning' };
}

/** The handover sheet's COD line: "COD ₹1,250.00 on 2 parcels" / "Prepaid". */
export function codTotalLabel(codShipmentCount: number, codTotalPaise: number): string {
  if (codShipmentCount === 0) return 'All prepaid — no cash to collect';
  return `COD ${rupees(codTotalPaise)} on ${codShipmentCount} ${codShipmentCount === 1 ? 'parcel' : 'parcels'}`;
}

export function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A weight in grams as kg, "1.250 kg"; "—" when unknown. */
export function weightLabel(grams: number | null): string {
  return grams === null ? '—' : `${(grams / 1000).toFixed(3)} kg`;
}

// ── the refusal copy ───────────────────────────────────────────────────────

export type ShippingAction =
  | 'label'
  | 'awb'
  | 'void'
  | 'verify'
  | 'document'
  | 'sheet'
  | 'remove'
  | 'handover'
  | 'parcel-tag'
  | 'read';

const ACTION_WORD: Readonly<Record<ShippingAction, string>> = {
  label: 'The label was not recorded',
  awb: 'The AWB was not recorded',
  void: 'The shipment was not voided',
  verify: 'The label was not verified',
  document: 'The document was not attached',
  sheet: 'The sheet page was not attached',
  remove: 'The file was not removed',
  handover: 'Nothing was handed over',
  'parcel-tag': 'The parcel tag was not printed',
  read: 'The shipping record could not be read',
};

/**
 * Every refusal the story's routes answer, by `code` (guide §3). Where the
 * server's detail names something this client cannot see (the other order
 * holding an AWB, the scanned tail) it renders verbatim.
 */
export function shippingReason(error: unknown, action: ShippingAction): string {
  if (!(error instanceof ApiProblem)) return UNREACHABLE_REASON;
  const lead = ACTION_WORD[action];
  switch (error.code) {
    case 'order-not-open':
      return `${lead} — the order is no longer open (it was dispatched or cancelled). Refresh the list.`;
    case 'shipment-exists':
      return error.detail ?? `${lead} — the order already has a label or an AWB. Replace or void it first.`;
    case 'shipment-handed-over':
      return error.detail ?? `${lead} — the parcel was already handed over to the courier.`;
    case 'shipment-not-client-arranged':
      return `${lead} — this order has a carrier label; use the manifest for it.`;
    case 'awb-in-use':
      return error.detail ?? `${lead} — this AWB is already on another open order of this client.`;
    case 'attachment-type-unsupported':
      return action === 'label'
        ? `${lead} — a client label must be a PDF.`
        : `${lead} — only a PDF or a JPEG, PNG or WebP image can be attached.`;
    case 'attachment-too-large':
      return `${lead} — the file is larger than 10 MB.`;
    case 'pdf-unreadable':
      return `${lead} — the PDF could not be read. Remove the password or print restriction and upload it again.`;
    case 'pdf-too-many-pages':
      return `${lead} — the PDF has more than 50 pages.`;
    case 'attachment-content-invalid':
      return `${lead} — the image was damaged or over 8,000 px a side.`;
    case 'file-storage-unavailable':
      return `${lead} — this server has no file storage configured.`;
    case 'file-storage-failed':
      return `${lead} — the file store did not answer. Try again; the retry is safe.`;
    case 'file-storage-busy':
      return `${lead} — the server is busy with other uploads. Try again in a moment.`;
    case 'no-client-label':
      return `${lead} — the order has no client label to verify (a courier brings its own; scan its AWB at handover).`;
    case 'label-mismatch':
      return error.detail ?? `${lead} — the scanned code is not this order’s AWB. Re-print the client label and scan it again.`;
    case 'label-in-use':
      return `${lead} — this is the live client label. Void or replace the shipment instead.`;
    case 'document-limit':
      return `${lead} — the order already has the most documents allowed (${MAX_WAREHOUSE_DOCUMENTS} from the warehouse, ${MAX_PORTAL_DOCUMENTS} from the client). Remove one first.`;
    case 'handover-sheet-limit':
      return `${lead} — the handover already has ${MAX_SHEET_PAGES} sheet pages. Remove one first.`;
    case 'handover-client-mismatch':
      return `${lead} — some parcels belong to another client. One handover carries one client’s parcels; hand the others over separately.`;
    case 'handover-parcels-refused':
      return `${lead} — some parcels cannot go yet. Each is marked below with why; fix them or untick them, then confirm again.`;
    case 'dispatch-via-handover':
      return DISPATCH_VIA_HANDOVER_REASON;
    case 'client-departed':
      return `${lead} — the client has left the warehouse.`;
    case 'client-suspended':
      return `${lead} — the account is suspended.`;
    case 'conflict':
      return error.detail ?? `${lead} — another change landed at the same moment. Try again.`;
    case 'attachment-not-attached':
      return `${lead} — the file was already removed. Refresh the list.`;
    case 'not-found':
      return `${lead} — it no longer exists. Refresh the list.`;
    case 'role-denied':
      return `${lead} — your role cannot do this.`;
    case 'permission-denied':
      return `${lead} — your session belongs to another workspace.`;
    case 'idempotency-key-reuse':
      return `${lead} — the request changed after it was first sent. Submit it again.`;
    case 'validation-failed':
      return error.detail ?? `${lead} — check the fields and try again.`;
    default:
      return error.detail ?? `${lead} (${error.code}).`;
  }
}

// ── the handover's per-parcel refusals ─────────────────────────────────────

/** Why a parcel cannot go, in words — a `Record` over the generated union (a new code fails the compile). */
export const HANDOVER_REFUSAL_WORD: Readonly<Record<HandoverRefusalCode, string>> = {
  'order-not-found': 'The order no longer exists',
  'warehouse-mismatch': 'The order is in another warehouse',
  'order-not-ready': 'Not packed, or cancelled',
  'order-already-dispatched': 'Already dispatched',
  'shipment-not-client-arranged': 'Carrier label — use the manifest',
  'label-not-verified': 'Label not verified — scan it here',
  'awb-mismatch': 'The scanned AWB is not the client’s label',
  'awb-required': 'Scan the courier’s AWB',
  'awb-in-use': 'This AWB is on another open order',
  'order-holds-recalled-batch': 'Holds a recalled lot — it cannot ship',
  'package-count-mismatch': 'The parcel count is not the order’s carton count',
  'carton-not-current': 'An old or foreign carton label — reprint this order’s labels',
};

export interface RefusedParcel {
  readonly code: string;
  readonly word: string;
  readonly detail: string | null;
}

/**
 * The `handover-parcels-refused` answer's `extensions.parcels[{orderId, code,
 * detail}]` as a map by order — the builder marks each row and keeps the
 * draft. Empty for any other problem.
 */
export function handoverRefusals(error: unknown): ReadonlyMap<string, RefusedParcel> {
  const out = new Map<string, RefusedParcel>();
  if (!(error instanceof ApiProblem) || error.code !== 'handover-parcels-refused') return out;
  const parcels = error.extensions['parcels'];
  if (!Array.isArray(parcels)) return out;
  for (const parcel of parcels) {
    if (typeof parcel !== 'object' || parcel === null) continue;
    const { orderId, code, detail } = parcel as Record<string, unknown>;
    if (typeof orderId !== 'string' || typeof code !== 'string') continue;
    const word = (HANDOVER_REFUSAL_WORD as Readonly<Record<string, string>>)[code] ?? code;
    out.set(orderId, { code, word, detail: typeof detail === 'string' ? detail : null });
  }
  return out;
}

/** `handover-client-mismatch`'s `extensions.orderIds` — the rows of another client. */
export function mismatchedOrderIds(error: unknown): readonly string[] {
  if (!(error instanceof ApiProblem) || error.code !== 'handover-client-mismatch') return [];
  const ids = error.extensions['orderIds'];
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

/** The success line: "HO-0007 — 3 parcels handed over to Delhivery; their orders are dispatched." */
export function handoverOutcome(response: Pick<HandoverResponse, 'handover' | 'parcels'>): { word: string; reason: string } {
  const count = response.parcels.length;
  const code = response.handover?.code ?? 'Handover';
  const courier = response.handover?.courierName ?? 'the courier';
  return {
    word: `${code} recorded`,
    reason: `${count} ${count === 1 ? 'parcel' : 'parcels'} handed over to ${courier}; ${count === 1 ? 'its order is' : 'their orders are'} dispatched. Print the sheet for the courier to sign.`,
  };
}

// ── small parsers ──────────────────────────────────────────────────────────

/** A package count field: blank → absent; else a whole number 1–999. */
export function parsePackageCount(text: string): { value: number | undefined; problem: string | null } {
  const trimmed = text.trim();
  if (trimmed === '') return { value: undefined, problem: null };
  if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1 || Number(trimmed) > MAX_PACKAGE_COUNT) {
    return { value: undefined, problem: `Parcels is a whole number from 1 to ${MAX_PACKAGE_COUNT}.` };
  }
  return { value: Number(trimmed), problem: null };
}

/** A weight field in grams: blank → absent (the packed weight is used); else a whole number 1–1,000,000. */
export function parseWeightGrams(text: string): { value: number | undefined; problem: string | null } {
  const trimmed = text.trim();
  if (trimmed === '') return { value: undefined, problem: null };
  if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1 || Number(trimmed) > MAX_WEIGHT_GRAMS) {
    return { value: undefined, problem: `Weight is whole grams, from 1 to ${MAX_WEIGHT_GRAMS.toLocaleString('en-IN')}.` };
  }
  return { value: Number(trimmed), problem: null };
}

/** A courier name: trimmed, 1–100 code points. */
export function courierNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Name the courier (e.g. Delhivery).';
  if ([...trimmed].length > MAX_COURIER_NAME_LENGTH) return `The courier name is at most ${MAX_COURIER_NAME_LENGTH} characters.`;
  return null;
}

/** A void or removal reason: trimmed, 1–200 code points. */
export function parseShippingReason(text: string): { reason: string; problem: null } | { reason: null; problem: string } {
  const reason = text.trim();
  if (reason === '') return { reason: null, problem: 'Say why — the reason is kept with the record.' };
  if ([...reason].length > MAX_SHIPPING_REASON_LENGTH) {
    return { reason: null, problem: `The reason is at most ${MAX_SHIPPING_REASON_LENGTH} characters.` };
  }
  return { reason, problem: null };
}

export type CourierChoice = { readonly transporterId: string } | { readonly courierName: string };

export interface LabelDraft {
  readonly awb: string;
  /** A transporter partner's id (staff only) — or '' to use the typed name. */
  readonly transporterId: string;
  readonly courierName: string;
  readonly packageCount: string;
}

export type ParsedLabelDraft =
  | { readonly awb: string; readonly courier: CourierChoice; readonly packageCount: number | undefined; readonly problem: null }
  | { readonly problem: string };

/** The client label / AWB advice fields → the request's fields (A8, A9) — the server's AWB and courier rules mirrored. */
export function parseLabelDraft(draft: LabelDraft): ParsedLabelDraft {
  const awb = normalizeAwb(draft.awb);
  const awbIssue = awbProblem(awb);
  if (awbIssue !== null) return { problem: awbIssue };
  let courier: CourierChoice;
  if (draft.transporterId !== '') {
    courier = { transporterId: draft.transporterId };
  } else {
    const issue = courierNameProblem(draft.courierName);
    if (issue !== null) return { problem: issue };
    courier = { courierName: draft.courierName.trim() };
  }
  const count = parsePackageCount(draft.packageCount);
  if (count.problem !== null) return { problem: count.problem };
  return { awb, courier, packageCount: count.value, problem: null };
}

async function readHead(file: Blob, bytes: number): Promise<Uint8Array> {
  const slice = file.slice(0, bytes);
  if (typeof slice.arrayBuffer === 'function') return new Uint8Array(await slice.arrayBuffer());
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(slice);
  });
}

/** Is this the start of a PDF (`%PDF-`)? — the sniff, never the name or the declared type. */
export function isPdfHead(head: Uint8Array): boolean {
  return head.length >= 5 && String.fromCharCode(...head.slice(0, 5)) === '%PDF-';
}

export const LABEL_NOT_PDF = 'A client label must be a PDF (the courier’s 4×6 label as downloaded).';
export const FILE_TOO_LARGE = 'This file is larger than 10 MB — pick a smaller one.';
export const FILE_TYPE_UNSUPPORTED = 'Only a PDF, or a JPEG, PNG or WebP photo, can be attached.';
export const FILE_EMPTY = 'This file is empty — pick another.';

/**
 * The file rule mirrored before a key is minted (A21): a label is a PDF, a
 * document or sheet page a PDF or an image; ≤ 10 MB. The server's sanitizer
 * is the authority (encrypted PDFs, page counts, damaged images).
 */
export async function shippingFileProblem(file: File, purpose: 'label' | 'document'): Promise<string | null> {
  if (file.size === 0) return FILE_EMPTY;
  if (file.size > MAX_SHIPPING_FILE_BYTES) return FILE_TOO_LARGE;
  let head: Uint8Array;
  try {
    head = await readHead(file, 64);
  } catch {
    return FILE_EMPTY;
  }
  if (isPdfHead(head)) return null;
  if (purpose === 'label') return LABEL_NOT_PDF;
  const kind = sniffImage(head);
  if (kind === 'heic') return 'HEIC photos are not supported — export as JPEG';
  return kind === 'other' ? FILE_TYPE_UNSUPPORTED : null;
}

/**
 * Prepare a document or sheet page for upload (A14): a PDF goes as picked
 * (≤ 10 MB); a photo is re-encoded by 2-5a's `prepareImageForUpload` (HEIC
 * refused, the long edge fitted, JPEG — a 48 MP phone photo fits under the
 * cap). The key belongs to the PREPARED file (guide §2.3).
 */
export async function prepareShippingFile(file: File): Promise<{ ok: true; file: File } | { ok: false; problem: string }> {
  if (file.size === 0) return { ok: false, problem: FILE_EMPTY };
  let head: Uint8Array;
  try {
    head = await readHead(file, 64);
  } catch {
    return { ok: false, problem: FILE_EMPTY };
  }
  if (isPdfHead(head)) return file.size > MAX_SHIPPING_FILE_BYTES ? { ok: false, problem: FILE_TOO_LARGE } : { ok: true, file };
  const kind = sniffImage(head);
  if (kind === 'other') return { ok: false, problem: FILE_TYPE_UNSUPPORTED };
  return prepareImageForUpload(file);
}

// ── the handover builder's draft ───────────────────────────────────────────

export interface HandoverRowDraft {
  readonly selected: boolean;
  /** The AWB scanned or typed at the dock ('' when none). */
  readonly awb: string;
  readonly packageCount: string;
  readonly weightGrams: string;
  /** Story 4-5a (A21) — the carton labels scanned for this order, canonical (trimmed, upper-cased). */
  readonly cartonCodes?: readonly string[];
}

export interface HandoverDraft {
  readonly clientId: string;
  readonly transporterId: string;
  readonly courierName: string;
  readonly pickupPersonName: string;
  readonly pickupPersonPhone: string;
  readonly vehicleNumber: string;
  /** `<input type="datetime-local">`, read as IST; '' = now. */
  readonly pickedUpAt: string;
  readonly note: string;
  readonly rows: Readonly<Record<string, HandoverRowDraft>>;
}

export const EMPTY_ROW: HandoverRowDraft = { selected: false, awb: '', packageCount: '', weightGrams: '' };

export function emptyHandoverDraft(clientId = ''): HandoverDraft {
  return {
    clientId,
    transporterId: '',
    courierName: '',
    pickupPersonName: '',
    pickupPersonPhone: '',
    vehicleNumber: '',
    pickedUpAt: '',
    note: '',
    rows: {},
  };
}

export function rowOf(draft: HandoverDraft, orderId: string): HandoverRowDraft {
  return draft.rows[orderId] ?? EMPTY_ROW;
}

/**
 * Why a candidate row cannot go as it stands, or null when it can (A20's
 * "Rows show why they cannot go"). The server re-checks every parcel.
 */
export function candidateBlocker(candidate: Pick<HandoverCandidateDto, 'shipment'>, row: HandoverRowDraft): string | null {
  const shipment = candidate.shipment;
  const scanned = normalizeAwb(row.awb);
  if (shipment !== null && shipment.kind === 'carrier') return HANDOVER_REFUSAL_WORD['shipment-not-client-arranged'];
  if (scanned !== '') {
    const issue = awbProblem(scanned);
    if (issue !== null) return issue;
    if (shipment !== null && normalizeAwb(shipment.awb) !== scanned) {
      return `${HANDOVER_REFUSAL_WORD['awb-mismatch']} (expected ${awbTail(shipment.awb)})`;
    }
    return null;
  }
  // The server's rule (A12): a courier label, or no shipment, needs the AWB scanned at the dock.
  if (shipment === null || shipment.kind === 'courier-label') return HANDOVER_REFUSAL_WORD['awb-required'];
  if (shipment.kind === 'client-label' && !shipment.labelVerified) return HANDOVER_REFUSAL_WORD['label-not-verified'];
  return null;
}

export type ScanMatch =
  /** The scan named exactly one candidate (its AWB, or its tag); `needsAwb` when the row still needs the courier's AWB. */
  | { readonly kind: 'matched'; readonly orderId: string; readonly by: 'awb' | 'tag'; readonly needsAwb: boolean }
  /** A tag naming two candidates (64-bit suffixes collide only in theory) — ask which. */
  | { readonly kind: 'ambiguous'; readonly orderIds: readonly string[] }
  /** Not a candidate's AWB or tag. With `awaitingAwbFor` set, the scan is taken as that row's AWB. */
  | { readonly kind: 'awb-for'; readonly orderId: string; readonly awb: string }
  | { readonly kind: 'unknown'; readonly problem: string };

/** Story 4-5a (A21) — a carton label scan: tick carton `seq` of that order, or say why not. */
export type CartonScanMatch =
  | { readonly kind: 'carton'; readonly orderId: string; readonly code: string; readonly seq: number; readonly needsAwb: boolean }
  | { readonly kind: 'ambiguous'; readonly orderIds: readonly string[] }
  | { readonly kind: 'unknown'; readonly problem: string };

/** Story 4-5a — the carton facts a candidate carries (the candidates read's optional `packSeq` / `cartonCount`). */
export interface CartonFacts {
  readonly packSeq?: number | null;
  readonly cartonCount?: number | null;
}

/** A37 — the web refuses a superseded pack's label: the user is present and can reprint. */
export const STALE_CARTON_LABEL = 'Old label — this order was re-packed; reprint its labels.';

/**
 * One scan into the builder's list (A20): an AWB on record or a parcel tag
 * ticks its row; a tag on a row with no AWB on record asks for the courier's
 * AWB next (`awaitingAwbFor`), and the next AWB-shaped scan lands there.
 */
export function matchScan(
  raw: string,
  candidates: readonly Pick<HandoverCandidateDto, 'orderId' | 'parcelTagCode' | 'shipment'>[],
  awaitingAwbFor: string | null,
): ScanMatch {
  const code = normalizeAwb(raw);
  if (code === '') return { kind: 'unknown', problem: 'Nothing was scanned.' };
  const suffix = parcelTagOrderSuffix(code);
  if (suffix !== null) {
    const hits = candidates.filter((c) => c.parcelTagCode.toUpperCase() === code);
    if (hits.length === 0) return { kind: 'unknown', problem: 'Not a parcel awaiting pickup for this client — refresh, or check the tag.' };
    if (hits.length > 1) return { kind: 'ambiguous', orderIds: hits.map((h) => h.orderId) };
    const hit = hits[0]!;
    const needsAwb =
      hit.shipment === null || hit.shipment.kind === 'courier-label' || (hit.shipment.kind === 'client-label' && !hit.shipment.labelVerified);
    return { kind: 'matched', orderId: hit.orderId, by: 'tag', needsAwb };
  }
  const byAwb = candidates.filter((c) => c.shipment !== null && normalizeAwb(c.shipment.awb) === code);
  if (byAwb.length === 1) return { kind: 'matched', orderId: byAwb[0]!.orderId, by: 'awb', needsAwb: false };
  // Two open shipments on one AWB (a replaced label, a typo) — ask which, never guess.
  if (byAwb.length > 1) return { kind: 'ambiguous', orderIds: byAwb.map((c) => c.orderId) };
  if (awaitingAwbFor !== null) {
    const issue = awbProblem(code);
    if (issue !== null) return { kind: 'unknown', problem: issue };
    return { kind: 'awb-for', orderId: awaitingAwbFor, awb: code };
  }
  return { kind: 'unknown', problem: 'Not a parcel awaiting pickup for this client — scan its parcel tag first, then the courier’s label.' };
}

function rowNeedsAwb(shipment: HandoverCandidateDto['shipment']): boolean {
  return shipment === null || shipment.kind === 'courier-label' || (shipment.kind === 'client-label' && !shipment.labelVerified);
}

/**
 * A carton label (A21, A34, A37 web rules), or null when `raw` is not a
 * carton code (then `matchScan` judges it as a tag or AWB): its parcel-tag
 * prefix finds the order; a pack number below the live pack's is a stale
 * label (refused — the user reprints); above it the list is older than the
 * pack (refresh); a candidate without `packSeq` is a virtual pack (pack 1,
 * one carton — A34).
 */
export function matchCartonScan(
  raw: string,
  candidates: readonly (Pick<HandoverCandidateDto, 'orderId' | 'parcelTagCode' | 'shipment'> & CartonFacts)[],
): CartonScanMatch | null {
  const carton = parseCartonCode(raw);
  if (carton === null) return null;
  const code = `${carton.parcelTag}.${carton.packSeq}.${carton.seq}`;
  const hits = candidates.filter((c) => c.parcelTagCode.toUpperCase() === carton.parcelTag);
  if (hits.length === 0) return { kind: 'unknown', problem: 'This carton is not a parcel awaiting pickup for this client — refresh, or check the label.' };
  if (hits.length > 1) return { kind: 'ambiguous', orderIds: hits.map((h) => h.orderId) };
  const hit = hits[0]!;
  const livePack = hit.packSeq ?? 1;
  const count = hit.cartonCount ?? 1;
  if (carton.packSeq < livePack) return { kind: 'unknown', problem: STALE_CARTON_LABEL };
  if (carton.packSeq > livePack) return { kind: 'unknown', problem: 'This order was re-packed after the list was read — refresh, then scan again.' };
  if (carton.seq > count) return { kind: 'unknown', problem: `This order has ${count} ${count === 1 ? 'carton' : 'cartons'} — there is no carton ${carton.seq}. Reprint its labels.` };
  return { kind: 'carton', orderId: hit.orderId, code, seq: carton.seq, needsAwb: rowNeedsAwb(hit.shipment) };
}

/** Tick a scanned carton on its row (selects the row; a second scan of one carton is a no-op). */
export function tickCarton(draft: HandoverDraft, orderId: string, code: string): HandoverDraft {
  const row = rowOf(draft, orderId);
  const parsed = parseCartonCode(code);
  if (parsed === null) return draft;
  const canonical = `${parsed.parcelTag}.${parsed.packSeq}.${parsed.seq}`;
  const codes = row.cartonCodes ?? [];
  const next = codes.includes(canonical) ? codes : [...codes, canonical];
  return { ...draft, rows: { ...draft.rows, [orderId]: { ...row, selected: true, cartonCodes: next } } };
}

/** "2/3" — the cartons scanned of the order's count; null when the order carries no carton facts and none were scanned. */
export function cartonTally(row: HandoverRowDraft, candidate: CartonFacts): string | null {
  const scanned = row.cartonCodes?.length ?? 0;
  const count = candidate.cartonCount ?? null;
  if (count === null && scanned === 0) return null;
  return `${scanned}/${count ?? 1}`;
}

/** The parcels field's prefill (A21, A40): the order's carton count. */
export function defaultPackageCountText(candidate: CartonFacts): string {
  return candidate.cartonCount === null || candidate.cartonCount === undefined ? '' : String(candidate.cartonCount);
}

/**
 * The confirms the builder asks before submit (A24's web twin, A44): fewer
 * cartons scanned than counted ("2 of 3 cartons scanned — hand over all
 * 3?"), and a COD order whose carton 1 was not scanned while another was.
 * Warnings, never refusals — the parcel may already be on the truck.
 */
export function handoverCartonConfirms(
  draft: HandoverDraft,
  candidates: readonly (Pick<HandoverCandidateDto, 'orderId' | 'orderLabel'> & CartonFacts & { readonly codAmountPaise?: number | null })[],
): readonly string[] {
  const out: string[] = [];
  for (const candidate of candidates) {
    const row = rowOf(draft, candidate.orderId);
    if (!row.selected) continue;
    const codes = row.cartonCodes ?? [];
    if (codes.length === 0) continue;
    const typed = parsePackageCount(row.packageCount).value;
    const count = typed ?? candidate.cartonCount ?? codes.length;
    if (codes.length < count) out.push(`${candidate.orderLabel}: ${codes.length} of ${count} cartons scanned — hand over all ${count}?`);
    const cod = (candidate.codAmountPaise ?? 0) > 0;
    if (cod && !codes.some((c) => parseCartonCode(c)?.seq === 1)) {
      out.push(`${candidate.orderLabel}: Carton 1 carries the COD label and was not scanned — hand over anyway?`);
    }
  }
  return out;
}

/** Story 4-5a (A21, A34, A37, A44) — one parcel's cartons at a handover, as the detail reads them. */
export interface HandoverCartonsLine {
  /** "3 cartons, 2 scanned" / "1 carton (packed before cartons were recorded)". */
  readonly text: string;
  /** Amber flags: a COD carton 1 left unscanned; a superseded pack's labels scanned on the handheld. */
  readonly flags: readonly string[];
}

/** Null when the detail carries no cartons (a server before 4-5a). */
export function handoverCartonsLine(
  cartons:
    | {
        readonly cartonCount: number;
        readonly scanned: number;
        readonly legacy: boolean;
        readonly codCartonScanned: boolean | null;
        readonly staleCartonLabels: boolean;
      }
    | undefined,
): HandoverCartonsLine | null {
  if (cartons === undefined) return null;
  const text = cartons.legacy
    ? '1 carton (packed before cartons were recorded)'
    : `${cartons.cartonCount} ${cartons.cartonCount === 1 ? 'carton' : 'cartons'}, ${cartons.scanned} scanned`;
  const flags: string[] = [];
  if (cartons.codCartonScanned === false) flags.push('Carton 1 (the COD label) was not scanned');
  if (cartons.staleCartonLabels) flags.push('Stale carton labels — the order was re-packed; reprint its labels');
  return { text, flags };
}

export type ParsedHandoverDraft = { readonly body: CreateHandoverDto; readonly problem: null } | { readonly body: null; readonly problem: string };

/**
 * The builder's draft → the POST body (A12). Mirrors the server's 400s
 * (courier, names, phone, vehicle, the 7-day window, the note, 1–100
 * parcels, each AWB, count and weight) so nothing is sent that it would only
 * refuse; the per-parcel state rules stay the server's.
 */
export function parseHandoverDraft(
  draft: HandoverDraft,
  warehouseId: string,
  candidates: readonly Pick<HandoverCandidateDto, 'orderId' | 'orderLabel'>[],
  nowMs: number,
): ParsedHandoverDraft {
  const fail = (problem: string): ParsedHandoverDraft => ({ body: null, problem });
  if (draft.clientId === '') return fail('Choose the client whose parcels the courier collects.');
  let courier: CreateHandoverDto['courier'];
  if (draft.transporterId !== '') courier = { transporterId: draft.transporterId };
  else {
    const issue = courierNameProblem(draft.courierName);
    if (issue !== null) return fail(issue);
    courier = { courierName: draft.courierName.trim() };
  }
  const pickupPersonName = draft.pickupPersonName.trim();
  if (pickupPersonName === '') return fail('Enter who collected the parcels (the courier’s pickup person).');
  if ([...pickupPersonName].length > MAX_PICKUP_NAME_LENGTH) return fail(`The pickup person’s name is at most ${MAX_PICKUP_NAME_LENGTH} characters.`);
  const phone = normalizePhone(draft.pickupPersonPhone);
  if (phone !== null && !PHONE_RE.test(phone)) return fail('The phone is 7–15 digits, optionally with a leading +.');
  const vehicle = normalizeVehicleNo(draft.vehicleNumber);
  if (vehicle !== null && !VEHICLE_NO_RE.test(vehicle)) return fail(`The vehicle number is ${VEHICLE_RULE}.`);
  let occurredAt: string | null = null;
  if (draft.pickedUpAt.trim() !== '') {
    occurredAt = istLocalToIso(draft.pickedUpAt);
    if (occurredAt === null) return fail('Enter the pickup time as a date and time.');
    const at = Date.parse(occurredAt);
    if (at > nowMs + HANDOVER_FUTURE_MS) return fail('The pickup time is in the future.');
    if (at < nowMs - HANDOVER_PAST_MS) return fail('The pickup time is at most 7 days back.');
  }
  const note = draft.note.trim();
  if ([...note].length > MAX_HANDOVER_NOTE_LENGTH) return fail(`The note is at most ${MAX_HANDOVER_NOTE_LENGTH} characters.`);
  const chosen = candidates.filter((c) => rowOf(draft, c.orderId).selected);
  if (chosen.length === 0) return fail('Tick or scan the parcels the courier is taking.');
  if (chosen.length > MAX_HANDOVER_PARCELS) {
    return fail(`One handover carries at most ${MAX_HANDOVER_PARCELS} parcels — record the rest as a second handover.`);
  }
  const seen = new Map<string, string>();
  const parcels: CreateHandoverDto['parcels'] = [];
  for (const candidate of chosen) {
    const row = rowOf(draft, candidate.orderId);
    const parcel: CreateHandoverDto['parcels'][number] = { orderId: candidate.orderId };
    const awb = normalizeAwb(row.awb);
    if (awb !== '') {
      const issue = awbProblem(awb);
      if (issue !== null) return fail(`${candidate.orderLabel}: ${issue}`);
      const other = seen.get(awb);
      if (other !== undefined) return fail(`AWB ${awb} is on both ${other} and ${candidate.orderLabel}.`);
      seen.set(awb, candidate.orderLabel);
      parcel.awb = awb;
    }
    const count = parsePackageCount(row.packageCount);
    if (count.problem !== null) return fail(`${candidate.orderLabel}: ${count.problem}`);
    if (count.value !== undefined) parcel.packageCount = count.value;
    const weight = parseWeightGrams(row.weightGrams);
    if (weight.problem !== null) return fail(`${candidate.orderLabel}: ${weight.problem}`);
    if (weight.value !== undefined) parcel.weightGrams = weight.value;
    // Story 4-5a (A21) — the scanned cartons, canonical and sorted; absent when none (a 4-4a body stays a 4-4a body).
    const cartonCodes = [...new Set((row.cartonCodes ?? []).map((c) => c.trim().toUpperCase()))].sort();
    if (cartonCodes.length > 0) parcel.cartonCodes = cartonCodes;
    parcels.push(parcel);
  }
  const body: CreateHandoverDto = {
    warehouseId,
    clientId: draft.clientId,
    courier,
    pickupPersonName,
    parcels,
    ...(phone === null ? {} : { pickupPersonPhone: phone }),
    ...(vehicle === null ? {} : { vehicleNumber: vehicle }),
    ...(occurredAt === null ? {} : { occurredAt }),
    ...(note === '' ? {} : { note }),
  };
  return { body, problem: null };
}

/**
 * The key binding (A20 "one key per draft bound to its body"): the same body
 * reuses its key — a retry after a timeout replays — and any change mints a
 * new one. With no pickup time typed, the body carries none (the server takes
 * its own now), so a retry of an unchanged draft stays the same body.
 */
export function bindHandoverKey(
  current: { readonly key: string; readonly body: string } | null,
  body: CreateHandoverDto,
  mint: () => string,
): { readonly key: string; readonly body: string } {
  const canonical = JSON.stringify(body);
  return current !== null && current.body === canonical ? current : { key: mint(), body: canonical };
}

// ── the handover sheet's parties (frozen snapshots) ────────────────────────

export interface SheetParty {
  readonly name: string;
  readonly lines: readonly string[];
  readonly facts: readonly { readonly label: string; readonly value: string }[];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function addressLines(address: unknown): string[] {
  if (typeof address !== 'object' || address === null) return [];
  const a = address as Record<string, unknown>;
  const lines = [text(a['line1']), text(a['line2'])].filter((l): l is string => l !== null);
  const place = [text(a['city']), text(a['state']) ?? text(a['stateCode']), text(a['pincode'])].filter((l): l is string => l !== null).join(' ');
  if (place !== '') lines.push(place);
  return lines;
}

/**
 * A frozen party snapshot (A12: the client's `ClientPartySnapshotV1`, the
 * warehouse's `{code, name, gstin, originAddress}`, a transporter's
 * `TransporterSnapshotV1`) as the sheet prints it — read defensively (a
 * snapshot is a jsonb the client cannot type), so an unknown shape prints its
 * fallback rather than throwing. The sheet never reads live master data
 * (AC6: a later rename leaves a printed sheet unchanged).
 */
export function sheetParty(snapshot: Readonly<Record<string, unknown>> | null, fallbackName: string): SheetParty {
  if (snapshot === null) return { name: fallbackName, lines: [], facts: [] };
  const name = text(snapshot['legalName']) ?? text(snapshot['name']) ?? fallbackName;
  const lines = addressLines(snapshot['registeredAddress'] ?? snapshot['originAddress'] ?? snapshot['address'] ?? null);
  const facts: { label: string; value: string }[] = [];
  const code = text(snapshot['code']);
  if (code !== null) facts.push({ label: 'Code', value: code });
  const gstin = text(snapshot['gstin']);
  if (gstin !== null) facts.push({ label: 'GSTIN', value: gstin });
  return { name, lines, facts };
}
