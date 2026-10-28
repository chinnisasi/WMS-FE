import { ApiProblem } from '@/lib/api/client';
import type { CreateSkuDto, SkuResponse } from '@/lib/api/generated';

/** The create body (the generated DTO). */
export type CreateSkuBody = CreateSkuDto;
import { CLIENT_DEPARTED_REASON } from '@/lib/client-departed';
import {
  dgHazardReason,
  emptyGoodsTypeDraft,
  goodsTypeCreateFields,
  hazardToSend,
  type GoodsTypeDraft,
} from '@/lib/goods-type';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

/**
 * Story 12-7 — the storage/hazard class admin's pure decisions, extracted
 * from the surfaces (the `over-receipt.ts` pattern) so they are testable:
 * the class vocabularies the two edit forms pick from, the class-column
 * labels, and the machine-problem reason strings of the SKU class PATCH and
 * the bin structure-arm PATCH. Clients branch on the problem `code`, never
 * on prose.
 *
 * The 409 class-refusal codes name the conflicting parties in `detail` — the
 * conflicting (sku, bin, hold) rows a stranding class change leaves behind —
 * so those arms render the detail VERBATIM: paraphrasing a list of stock
 * that must be relocated first would be guessing.
 */

/** The SKU's storage class (FR-40) — the required, non-nullable vocabulary. */
export type StorageClass = SkuResponse['storageClass'];

/**
 * The storage-class vocabulary, surfaced verbatim from the backend's 12-1
 * three-layer pattern (TS tuple / DB CHECK / DTO @IsIn) — the same
 * `BIN_TYPES` precedent in `zone-bin-setup.tsx`: the picker mirrors the
 * server's fixed vocabulary; the server's decorators remain the boundary.
 */
export const STORAGE_CLASSES = [
  'ambient',
  'chilled',
  'frozen',
  'controlled',
  'hazardous',
  'secure',
] as const satisfies readonly StorageClass[];

/**
 * The hazard-class vocabulary (FR-41), mirrored for the edit picker. The
 * matrix CARD does not use this — the matrix card renders the endpoint's
 * `classes` array, the only source for the matrix view — but an edit form
 * needs its options before the matrix read resolves, and this is the same
 * fixed vocabulary the backend declares.
 */
export const HAZARD_CLASSES = [
  'explosive',
  'oxidizer',
  'flammable',
  'corrosive-acid',
  'corrosive-base',
  'toxic',
  'gas',
] as const;

/** The SKU's hazard class (FR-41), or null when it carries none. */
export type HazardClass = SkuResponse['hazardClass'] | null;

/**
 * The SKU table's Storage column. Every SKU carries a class (required on the
 * response since the 12-1 schema) — but the KNOWN-BAD generated types have
 * taught this repo to trust runtime truth over the declared type, so a row
 * that somehow arrives class-less renders the house em-dash instead of
 * `undefined`.
 */
export function storageClassLabel(sku: SkuResponse): string {
  return sku.storageClass ?? '—';
}

/**
 * The SKU table's Hazard column (story 12-7): null carries no rule — the
 * decided 12-2 narrowing — so a class-less SKU renders "—" ("no rule"), not
 * a fake class. The generated type drops `| null` (KNOWN-BAD, tracked in
 * PENDING); the runtime-nullable rendering here follows the BE contract,
 * not the broken type.
 */
export function hazardClassLabel(sku: SkuResponse): string {
  return (sku.hazardClass as string | null) ?? '—';
}

/**
 * The SKU class-edit PATCH's failure reasons, branched on the problem
 * `code` — the same contract as `decisionReason` / `qcReason`. The two class
 * codes surface the server's detail verbatim: `storage-class-conflict` names
 * the stranded bins, `hazard-segregation-conflict` names the co-located
 * stock (SKUs, bins and the pinning hold, where one exists) and — since
 * story 1-6b — the rule the change newly fires: it answers any edit to the
 * SKU's segregation profile (hazard class, DG classes, drug schedules, food
 * category, allergens), so its fallback names no single field.
 */
export function skuClassReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'storage-class-conflict':
        return error.detail ?? 'The class change would strand stock in bins that no longer fit it.';
      case 'hazard-segregation-conflict':
        return error.detail ?? 'This change conflicts with stock in the same bins — relocate it first.';
      case 'not-found':
        return 'That SKU no longer exists — refresh the page.';
      case 'role-denied':
        return 'Your role cannot edit SKUs.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the entered values and try again.';
      default:
        return error.detail ?? `Update failed (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * The bin Edit-class PATCH's failure reasons (the structure arm, gated
 * `bin.create` on the backend): the same shared `storage-class-conflict`
 * code as the SKU form, plus the bin's own `bin-retired` (retirement is
 * terminal) and the house set.
 */
export function binClassReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'storage-class-conflict':
        // The backend's detail names the conflicting stock — the (sku, qty)
        // rows the class change strands — verbatim.
        return error.detail ?? 'The class change would strand stock that no longer fits the bin.';
      // Story 1-5b — the dedicated-client arm of the same structure PATCH:
      // the server's detail names the other client's SKUs (or the bin and
      // the client) verbatim.
      case 'bin-client-conflict':
        return error.detail ?? "The bin holds another client's stock or QC holds — move them first.";
      case 'bin-client-mismatch':
        return error.detail ?? 'That bin is dedicated to another client — choose another bin.';
      case 'client-departed':
        return CLIENT_DEPARTED_REASON;
      case 'bin-retired':
        return error.detail ?? 'That bin is retired — retirement is terminal.';
      case 'not-found':
        return 'That bin no longer exists — refresh the page.';
      case 'role-denied':
        return 'Your role cannot edit bin structure.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the entered values and try again.';
      default:
        return error.detail ?? `Update failed (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}
/* ------------------------------------------------------------------ */
/* Story 1-4 — the SKU master: create, shelf life, pack levels, barcodes */
/* ------------------------------------------------------------------ */

/** The ABC classes (5-3), mirrored for the edit and create pickers. */
export const ABC_CLASSES = ['a', 'b', 'c'] as const satisfies readonly SkuResponse['abcClass'][];

/**
 * The uom vocabulary, mirrored from the generated `SkuResponse['uom']`
 * union (the backend's 10.2 tuple — `satisfies` fails the build if the
 * server drops a unit; a unit added there shows up here when someone adds
 * it). Count / packaging units first, then measured.
 */
export const UOM_OPTIONS = [
  'each', 'box', 'case', 'carton', 'pack', 'pallet', 'bag', 'drum', 'roll', 'crate', 'bundle', 'pair', 'dozen',
  'bottle', 'can', 'tin', 'jar', 'tube', 'tray', 'sheet', 'bar', 'cylinder', 'keg', 'set',
  'g', 'kg', 'tonne', 'ml', 'litre', 'kl', 'mm', 'cm', 'm', 'sqm', 'sqft',
] as const satisfies readonly SkuResponse['uom'][];

/** Decision 12 — the barcode rule, byte-for-byte the backend's `BARCODE_RE`. */
export const BARCODE_RE = /^[!-~]([ -~]*[!-~])?$/;
export const BARCODE_MAX = 64;
/** Decision 8 — the backend's `MIN_PACK_FACTOR` / `MAX_PACK_FACTOR`. */
export const MIN_PACK_FACTOR = 2;
export const MAX_PACK_FACTOR = 1_000_000;
/** Decision 5 — the backend's shelf-life bounds (`skus_shelf_life_days_check`). */
export const MIN_SHELF_LIFE_DAYS = 1;
export const MAX_SHELF_LIFE_DAYS = 3650;

/** The note the packaging panel always shows (decision 10: a stale factor is shown, not detected). */
export const PACKAGING_REFRESH_NOTE =
  'Refresh handhelds after changing pack sizes — a handheld counts a case or pallet scan with the pack size its last catalog refresh carried.';

/** The shelf-life field's label (decision 5 — total life, not the client's minimum remaining life). */
export const SHELF_LIFE_LABEL = 'Shelf life — total days from manufacture';
/** Story 2-4b — the shelf-life field's hint (both SKU forms): what the number now does at receipt. */
export const SHELF_LIFE_HINT = "Sets a received batch's expiry from its mfg date when none is typed";

/** A trimmed barcode against the rule, or the sentence that refuses it (null = fine). */
export function barcodeProblem(raw: string, field = 'Barcode'): string | null {
  const value = raw.trim();
  if (value.length === 0 || value.length > BARCODE_MAX) return `${field} must be 1–${BARCODE_MAX} characters.`;
  if (value.includes(';')) return `${field} "${value}" may not contain ";".`;
  if (!BARCODE_RE.test(value)) return `${field} "${value}" must be printable ASCII (letters, digits, symbols) with no leading or trailing space.`;
  return null;
}

/** The shelf-life field: blank → null (clear / unset); else a whole 1–3650. */
export function parseShelfLifeInput(raw: string): { value: number | null; problem: string | null } {
  const trimmed = raw.trim();
  if (trimmed === '') return { value: null, problem: null };
  if (!/^\d+$/.test(trimmed)) return { value: null, problem: 'Shelf life must be a whole number of days.' };
  const value = Number(trimmed);
  if (value < MIN_SHELF_LIFE_DAYS || value > MAX_SHELF_LIFE_DAYS) {
    return { value: null, problem: `Shelf life must be ${MIN_SHELF_LIFE_DAYS}–${MAX_SHELF_LIFE_DAYS} days.` };
  }
  return { value, problem: null };
}

/**
 * Decision 5 — a non-blocking warning: a SKU whose TOTAL shelf life is below
 * its client's minimum REMAINING shelf life on receipt can never be received
 * without a waiver. Null when there is nothing to say.
 */
export function shelfLifeWarning(shelfLifeDays: number | null, minShelfLifeDays: number | null | undefined): string | null {
  if (shelfLifeDays === null || minShelfLifeDays === null || minShelfLifeDays === undefined) return null;
  if (shelfLifeDays >= minShelfLifeDays) return null;
  return `This client requires at least ${minShelfLifeDays} days of remaining shelf life on receipt — a ${shelfLifeDays}-day product can never arrive with that much left.`;
}

/** The table's Shelf life cell. */
export function shelfLifeLabel(sku: Pick<SkuResponse, 'shelfLifeDays'>): string {
  return sku.shelfLifeDays === null || sku.shelfLifeDays === undefined ? '—' : `${sku.shelfLifeDays} d`;
}

/** The table's Pack levels cell: `case ×12 · pallet ×480`, the base unit implied. */
export function packLevelsLabel(sku: Pick<SkuResponse, 'uomConversions'>): string {
  return sku.uomConversions.length === 0 ? '—' : sku.uomConversions.map((level) => `${level.uom} ×${level.factor}`).join(' · ');
}

export interface PackLevelRow {
  readonly id: string;
  readonly uom: string;
  readonly factor: string;
}

export interface PackBarcodeRow {
  readonly id: string;
  readonly barcode: string;
  readonly uom: string;
}

export interface ParsedPackaging {
  readonly body: { levels: { uom: string; factor: number }[]; barcodes: { barcode: string; uom: string }[] };
  /** Non-null when nothing should be sent. */
  readonly problem: string | null;
}

/**
 * The packaging editor's rows → the PUT body (or the create's `levels` /
 * `barcodes`), refusing what the backend could only answer 400/409 to and
 * this client genuinely knows: a level equal to the base unit or repeated, a
 * factor outside 2–1,000,000, a barcode breaking the rule, equal to the
 * primary, on a level that is neither the base unit nor a declared level, or
 * listed twice. Blank rows are dropped. Uniqueness against OTHER SKUs stays
 * the server's.
 */
export function parsePackagingDraft(
  baseUom: string,
  primaryBarcode: string,
  levelRows: readonly PackLevelRow[],
  barcodeRows: readonly PackBarcodeRow[],
): ParsedPackaging {
  const levels: { uom: string; factor: number }[] = [];
  const empty = { levels: [], barcodes: [] };
  for (const row of levelRows) {
    if (row.uom === '' && row.factor.trim() === '') continue;
    if (row.uom === '') return { body: empty, problem: 'Choose a unit for every pack level.' };
    if (row.uom === baseUom) return { body: empty, problem: `A pack level cannot be the base unit (${baseUom}).` };
    if (levels.some((level) => level.uom === row.uom)) return { body: empty, problem: `The ${row.uom} level is listed twice.` };
    const factor = row.factor.trim();
    if (!/^\d+$/.test(factor) || Number(factor) < MIN_PACK_FACTOR || Number(factor) > MAX_PACK_FACTOR) {
      return {
        body: empty,
        problem: `One ${row.uom} must hold a whole number of ${baseUom} from ${MIN_PACK_FACTOR} to ${MAX_PACK_FACTOR.toLocaleString('en-IN')}.`,
      };
    }
    levels.push({ uom: row.uom, factor: Number(factor) });
  }
  const barcodes: { barcode: string; uom: string }[] = [];
  for (const row of barcodeRows) {
    const barcode = row.barcode.trim();
    if (barcode === '' && row.uom === '') continue;
    const problem = barcodeProblem(barcode);
    if (problem !== null) return { body: empty, problem };
    if (barcode === primaryBarcode.trim()) return { body: empty, problem: `${barcode} is already the primary barcode.` };
    if (row.uom === '') return { body: empty, problem: `Choose the level ${barcode} names.` };
    if (row.uom !== baseUom && !levels.some((level) => level.uom === row.uom)) {
      return { body: empty, problem: `${barcode} names the ${row.uom} level, which this SKU does not declare — add the level first.` };
    }
    if (barcodes.some((entry) => entry.barcode === barcode)) return { body: empty, problem: `${barcode} is listed twice.` };
    barcodes.push({ barcode, uom: row.uom });
  }
  return { body: { levels, barcodes }, problem: null };
}

/**
 * Story 1-4 — the SKU create, edit and packaging refusals, branched on the
 * problem `code`. The server's detail names the holder of a taken barcode
 * (and its level) and the stock blocking a flag change, so those render
 * verbatim.
 */
export function skuMasterReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'sku-has-stock':
        return error.detail ?? 'Tracking cannot change while the SKU has stock, a pending over-receipt or a pending adjustment.';
      case 'barcode-level-unknown':
        return error.detail ?? 'A barcode names a level this SKU does not declare — add the pack level first.';
      case 'duplicate-barcode':
        return error.detail ?? 'A barcode already belongs to another SKU of this client.';
      case 'barcode-is-code':
        return error.detail ?? 'A barcode may not equal a SKU code in this client.';
      case 'duplicate-sku-code':
        return error.detail ?? 'This client already has a SKU with that code.';
      case 'client-required':
        return 'Choose the client this SKU belongs to.';
      case 'client-departed':
        return 'That client has departed — it takes no new SKUs.';
      case 'product-client-mismatch':
        return error.detail ?? "That product belongs to another client — a product's variants share its client.";
      case 'storage-class-conflict':
      case 'hazard-segregation-conflict':
        return skuClassReason(error);
      // Story 1-6a — decision 7: the hazard class against the DG class.
      case 'dg-hazard-mismatch':
      case 'dg-hazard-required':
        return dgHazardReason(error.code, error.detail);
      case 'not-found':
        return 'That SKU or client no longer exists — refresh the page.';
      case 'role-denied':
        return 'Your role cannot edit the catalog.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the entered values and try again.';
      default:
        return error.detail ?? `Not saved (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** The create card's draft — every field as the form holds it (strings until submit). */
export interface SkuCreateDraft {
  readonly clientId: string;
  readonly code: string;
  readonly name: string;
  readonly uom: string;
  readonly gstPercent: string;
  readonly hsn: string;
  readonly barcode: string;
  readonly batchTracked: boolean;
  readonly serialTracked: boolean;
  /** Story 2-6a — consulted only while `serialTracked`. */
  readonly serialFormat: SerialFormat;
  readonly catchWeightTracked: boolean;
  readonly weightGrams: string;
  readonly lengthMm: string;
  readonly widthMm: string;
  readonly heightMm: string;
  readonly countryOfOrigin: string;
  readonly storageClass: string;
  readonly hazardClass: string;
  readonly abcClass: string;
  readonly reorderPoint: string;
  readonly reorderQty: string;
  readonly shelfLifeDays: string;
  readonly levels: readonly PackLevelRow[];
  readonly barcodes: readonly PackBarcodeRow[];
  /**
   * Story 1-6a — the goods-type fields. `hazardClass` above follows decision
   * 7 against `goods.dgClass`: a mapped class derives it (not sent), class 8
   * needs acid, base or `none`.
   */
  readonly goods: GoodsTypeDraft;
}

export function emptySkuCreateDraft(): SkuCreateDraft {
  return {
    clientId: '',
    code: '',
    name: '',
    uom: 'each',
    gstPercent: '18',
    hsn: '',
    barcode: '',
    batchTracked: false,
    serialTracked: false,
    serialFormat: 'free',
    catchWeightTracked: false,
    weightGrams: '',
    lengthMm: '',
    widthMm: '',
    heightMm: '',
    countryOfOrigin: '',
    storageClass: 'ambient',
    hazardClass: '',
    abcClass: '',
    reorderPoint: '',
    reorderQty: '',
    shelfLifeDays: '',
    levels: [],
    barcodes: [],
    goods: emptyGoodsTypeDraft(),
  };
}

const WHOLE = /^\d+$/;
const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * The create card's draft → the `POST …/catalog/skus` body, or the sentence
 * that keeps it unsent. Optional fields left blank are DROPPED (never `''`);
 * the client is required only when the tenant holds more than one
 * (`requireClient`) — otherwise the server's single-client default applies.
 * Range rules the server owns beyond these (attribute caps, precision) are
 * sent and its named refusal renders.
 */
export function parseSkuCreateDraft(
  draft: SkuCreateDraft,
  requireClient: boolean,
): { body: CreateSkuBody | null; problem: string | null } {
  const fail = (problem: string) => ({ body: null, problem });
  if (requireClient && draft.clientId === '') return fail('Choose the client this SKU belongs to.');
  const code = draft.code.trim();
  if (code === '' || code.length > 64) return fail('Code must be 1–64 characters.');
  const name = draft.name.trim();
  if (name === '' || name.length > 200) return fail('Name must be 1–200 characters.');
  const gst = draft.gstPercent.trim();
  if (!DECIMAL.test(gst) || Number(gst) > 100) return fail('GST % must be a number from 0 to 100.');
  if (/\.\d{3,}$/.test(gst)) return fail('GST % takes at most two decimals (basis points).');
  const gstRate = Math.round(Number(gst) * 100);
  if (draft.serialTracked && draft.catchWeightTracked) return fail('A SKU cannot be both serial and catch-weight tracked — pick one.');
  const hsn = draft.hsn.trim();
  if (hsn.length > 32) return fail('HSN must be at most 32 characters.');
  const barcode = draft.barcode.trim();
  if (barcode !== '') {
    const problem = barcodeProblem(barcode);
    if (problem !== null) return fail(problem);
  }
  const attributes: { weightGrams?: number; lengthMm?: number; widthMm?: number; heightMm?: number; countryOfOrigin?: string } = {};
  for (const [key, label] of [
    ['weightGrams', 'Weight'],
    ['lengthMm', 'Length'],
    ['widthMm', 'Width'],
    ['heightMm', 'Height'],
  ] as const) {
    const raw = draft[key].trim();
    if (raw === '') continue;
    if (!WHOLE.test(raw) || Number(raw) < 1) return fail(`${label} must be a positive whole number.`);
    attributes[key] = Number(raw);
  }
  const origin = draft.countryOfOrigin.trim().toUpperCase();
  if (origin !== '') {
    if (!/^[A-Z]{2}$/.test(origin)) return fail('Origin must be a two-letter country code (e.g. IN).');
    attributes.countryOfOrigin = origin;
  }
  const reorder: { reorderPoint?: number; reorderQty?: number } = {};
  for (const [key, label] of [
    ['reorderPoint', 'Reorder point'],
    ['reorderQty', 'Reorder quantity'],
  ] as const) {
    const raw = draft[key].trim();
    if (raw === '') continue;
    if (!DECIMAL.test(raw)) return fail(`${label} must be a non-negative number.`);
    reorder[key] = Number(raw);
  }
  const shelf = parseShelfLifeInput(draft.shelfLifeDays);
  if (shelf.problem !== null) return fail(shelf.problem);
  const packaging = parsePackagingDraft(draft.uom, barcode, draft.levels, draft.barcodes);
  if (packaging.problem !== null) return fail(packaging.problem);
  // Story 1-6a — the goods-type keys (the flags always, blank optionals
  // dropped) and the hazard key under decision 7 (a create has no stored
  // state: a mapped DG class derives it, so it is not sent).
  const goods = goodsTypeCreateFields(draft.goods);
  if (goods.problem !== null) return fail(goods.problem);
  const hazard = hazardToSend(draft.goods.dgClass, draft.hazardClass, { dgClass: '', hazardClass: '' });
  if (hazard.problem !== null) return fail(hazard.problem);
  return {
    body: {
      code,
      name,
      uom: draft.uom,
      gstRate,
      ...(hsn === '' ? {} : { hsnCode: hsn }),
      ...(barcode === '' ? {} : { barcode }),
      batchTracked: draft.batchTracked,
      serialTracked: draft.serialTracked,
      // Story 2-6a — sent only when it says something: `imei` on a serial SKU
      // (free is the server default, and `imei` without serials is a 400).
      ...serialFormatCreateField(draft.serialTracked, draft.serialFormat),
      catchWeightTracked: draft.catchWeightTracked,
      ...(Object.keys(attributes).length === 0 ? {} : { attributes }),
      storageClass: draft.storageClass as StorageClass,
      // The generated type drops `| null` on hazardClass (the KNOWN-BAD
      // family); class 8's "none" rides as null through the cast.
      ...(hazard.value === undefined ? {} : { hazardClass: hazard.value as NonNullable<CreateSkuBody['hazardClass']> }),
      ...(draft.abcClass === '' ? {} : { abcClass: draft.abcClass as NonNullable<CreateSkuBody['abcClass']> }),
      ...reorder,
      ...(shelf.value === null ? {} : { shelfLifeDays: shelf.value }),
      ...(draft.clientId === '' ? {} : { clientId: draft.clientId }),
      ...(packaging.body.levels.length === 0 ? {} : { levels: packaging.body.levels }),
      ...(packaging.body.barcodes.length === 0 ? {} : { barcodes: packaging.body.barcodes }),
      ...goods.body,
    },
    problem: null,
  };
}

/**
 * Story 1-4 — a create form that needs the client list must wait for it: while
 * it loads (or after it failed) the form cannot know whether a client is
 * required, so submit is disabled and this note says why. Null when ready.
 */
export function clientsUnavailableNote(state: { readonly state: 'loading' | 'ready' | 'failed'; readonly reason?: string }): string | null {
  if (state.state === 'ready') return null;
  if (state.state === 'loading') return 'Loading clients…';
  return `Clients not loaded — ${state.reason ?? 'retry'}. Creating waits for the client list.`;
}

// ── story 2-6a: the serial format ─────────────────────────────────────────────

export type SerialFormat = NonNullable<SkuResponse['serialFormat']>;

/** The two serial formats, in the order the select offers them. */
export const SERIAL_FORMAT_OPTIONS: readonly { readonly value: SerialFormat; readonly label: string }[] = [
  { value: 'free', label: 'Free text (any serial)' },
  { value: 'imei', label: 'IMEI 1 (15 digits, check digit)' },
];

/** A SKU's stored format; a SKU answered before 2-6a carries none and reads `free`. */
export function serialFormatOf(sku: Pick<SkuResponse, 'serialFormat'>): SerialFormat {
  return sku.serialFormat ?? 'free';
}

/** The create body's format key: only `imei` on a serial-tracked SKU is sent. */
export function serialFormatCreateField(serialTracked: boolean, format: SerialFormat): { serialFormat?: SerialFormat } {
  return serialTracked && format === 'imei' ? { serialFormat: 'imei' } : {};
}

/**
 * The edit body's format key (A15): only while the SKU stays serial-tracked
 * and the format changed. Ending serial tracking sends nothing — the server
 * resets the format to `free` itself — so `imei` never rides without serials.
 */
export function serialFormatEditField(
  sku: Pick<SkuResponse, 'serialFormat'>,
  serialTracked: boolean,
  format: SerialFormat,
): { serialFormat?: SerialFormat } {
  if (!serialTracked) return {};
  return format === serialFormatOf(sku) ? {} : { serialFormat: format };
}

/** The table's tracking words: `Serial (IMEI)` for an imei SKU. */
export function trackingLabel(sku: Pick<SkuResponse, 'batchTracked' | 'serialTracked' | 'catchWeightTracked' | 'serialFormat'>): string {
  return (
    [
      sku.batchTracked ? 'Batch' : null,
      sku.serialTracked ? (serialFormatOf(sku) === 'imei' ? 'Serial (IMEI)' : 'Serial') : null,
      sku.catchWeightTracked ? 'Catch weight' : null,
    ]
      .filter((flag) => flag !== null)
      .join(' + ') || '—'
  );
}
