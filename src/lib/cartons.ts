/**
 * Story 4-5a (A26, A31, A36, A48) — packing documents on the web: the pure
 * half of the carton grid at pack and at re-carton, the pack and re-carton
 * bodies, the refusal copy by `code` for every route the story adds, the
 * download file names, the per-UoM totals and the remembered print format.
 *
 * The grid is lines × cartons, one row per SKU (the bench counts SKUs, never
 * order lines — the server's `aggregateScan`). Quantities are compared in
 * exact milli-units (`Math.round(qty × 1000)`), never as floats. Validation
 * mirrors the server's shape rules (A6, A31) so nothing is sent that it would
 * only refuse; the server stays the authority on what was picked.
 *
 * Pure: no React, no fetch, no hook (localStorage is touched only by the two
 * remembered-format helpers, each in try/catch). Pinned by `cartons.test.ts`.
 */
import { ApiProblem } from '@/lib/api/client';
import { formatCount, formatQuantity, parseQuantityInput, type QuantityUom } from '@/lib/format-quantity';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

// ── bounds (the server's, A1–A3, A6, A22, A48) ─────────────────────────────

/** Cartons per pack (`order_packs_carton_count_range`). */
export const MAX_CARTONS = 200;
/** Scan lines (SKUs) in one carton. */
export const MAX_LINES_PER_CARTON = 500;
/** Carton lines across one pack. */
export const MAX_CARTON_LINES = 2_000;
/** One carton's weight in grams (the pack's `MAX_WEIGHT_GRAMS`). */
export const MAX_CARTON_WEIGHT_GRAMS = 1_000_000;
/** One side of a carton in millimetres. */
export const MAX_CARTON_DIMENSION_MM = 100_000;
/** The re-carton reason, code points. */
export const MAX_RECARTON_REASON_LENGTH = 200;
/** Labels or slips one print renders (A22, A48). */
export const MAX_LABELS_PER_PRINT = 1_000;
/** Packages on a return's labels (the 0105 / 0113 `package_count` bound). */
export const MAX_PACKAGE_LABELS = 9_999;
/** A shipment's weight bound (0042 `shipments_weight_grams_range`, A33). */
export const MAX_SHIPMENT_WEIGHT_GRAMS = 1_000_000;

const MILLI = 1_000;

function toMilli(qty: number): number {
  return Math.round(qty * MILLI);
}

function fromMilli(milli: number): number {
  return milli / MILLI;
}

// ── the grid ───────────────────────────────────────────────────────────────

/** A catch-weight case (handling unit) the grid places in one carton. */
export interface CartonCase {
  readonly id: string;
  /** What the operator reads on the case (its label code). */
  readonly label: string;
}

/** One SKU row of the grid: what was packed of it, to be split. */
export interface CartonSku {
  readonly skuId: string;
  readonly skuCode: string;
  readonly skuName?: string;
  /** The SKU's unit and precision, or null when unresolved (the server then judges precision). */
  readonly uom: QuantityUom | null;
  /** The packed (or scanned) quantity of this SKU, base units. */
  readonly packedQty: number;
  /** A catch-weight SKU: its quantity is its cases, placed by `assignCase`. */
  readonly catchWeight: boolean;
  readonly cases?: readonly CartonCase[];
}

/** One carton column, every field the raw input string. */
export interface CartonDraft {
  /** skuId → the quantity typed in this carton ('' = none). Catch-weight SKUs are not typed. */
  readonly qty: Readonly<Record<string, string>>;
  readonly weightKg: string;
  readonly lengthCm: string;
  readonly widthCm: string;
  readonly heightCm: string;
}

export interface CartonGrid {
  readonly skus: readonly CartonSku[];
  readonly cartons: readonly CartonDraft[];
  /** Catch-weight case id → the carton index it sits in. */
  readonly caseCarton: Readonly<Record<string, number>>;
}

export const EMPTY_CARTON: CartonDraft = { qty: {}, weightKg: '', lengthCm: '', widthCm: '', heightCm: '' };

function quantityText(qty: number): string {
  return String(fromMilli(toMilli(qty)));
}

/** Every case of every catch-weight SKU in carton 1. */
function allCasesIn(skus: readonly CartonSku[], index: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const sku of skus) {
    if (!sku.catchWeight) continue;
    for (const c of sku.cases ?? []) out[c.id] = index;
  }
  return out;
}

/**
 * The grid as "Split into cartons" opens it: carton 1 holds everything,
 * carton 2 is empty and ready to take some of it.
 */
export function splitGrid(skus: readonly CartonSku[]): CartonGrid {
  const qty: Record<string, string> = {};
  for (const sku of skus) {
    if (!sku.catchWeight && sku.packedQty > 0) qty[sku.skuId] = quantityText(sku.packedQty);
  }
  return { skus, cartons: [{ ...EMPTY_CARTON, qty }, EMPTY_CARTON], caseCarton: allCasesIn(skus, 0) };
}

/** A live pack's carton, as the cartons read (A11) returns it — the fields the grid needs. */
export interface LiveCarton {
  readonly weightGrams: number | null;
  readonly dimensionsMm: { readonly lengthMm: number; readonly widthMm: number; readonly heightMm: number } | null;
  readonly lines: readonly { readonly skuId: string; readonly qty: number; readonly handlingUnitIds?: readonly string[] | null }[];
}

function gramsToKgText(grams: number | null): string {
  return grams === null ? '' : String(grams / 1000);
}

function mmToCmText(mm: number | null | undefined): string {
  return mm === null || mm === undefined ? '' : String(mm / 10);
}

/** The re-carton grid, prefilled from the live pack (A26). */
export function gridFromLivePack(skus: readonly CartonSku[], cartons: readonly LiveCarton[]): CartonGrid {
  const catchWeight = new Set(skus.filter((s) => s.catchWeight).map((s) => s.skuId));
  const caseCarton: Record<string, number> = {};
  const drafts = cartons.map((carton, index): CartonDraft => {
    const qty: Record<string, string> = {};
    for (const line of carton.lines) {
      if (catchWeight.has(line.skuId)) {
        for (const id of line.handlingUnitIds ?? []) caseCarton[id] = index;
      } else if (line.qty > 0) {
        qty[line.skuId] = quantityText(line.qty);
      }
    }
    return {
      qty,
      weightKg: gramsToKgText(carton.weightGrams),
      lengthCm: mmToCmText(carton.dimensionsMm?.lengthMm),
      widthCm: mmToCmText(carton.dimensionsMm?.widthMm),
      heightCm: mmToCmText(carton.dimensionsMm?.heightMm),
    };
  });
  return { skus, cartons: drafts.length > 0 ? drafts : [EMPTY_CARTON], caseCarton };
}

/** Add an empty carton at the end; at `MAX_CARTONS` the grid is returned unchanged. */
export function addCarton(grid: CartonGrid): CartonGrid {
  if (grid.cartons.length >= MAX_CARTONS) return grid;
  return { ...grid, cartons: [...grid.cartons, EMPTY_CARTON] };
}

/** Does carton `index` hold nothing (no typed quantity, no case)? */
export function cartonIsEmpty(grid: CartonGrid, index: number): boolean {
  const carton = grid.cartons[index];
  if (carton === undefined) return true;
  for (const raw of Object.values(carton.qty)) {
    const qty = parseQuantityInput(raw);
    if (raw.trim() !== '' && (qty === null || qty > 0)) return false;
  }
  return !Object.values(grid.caseCarton).includes(index);
}

/** Remove carton `index` — only when it is empty and not the last one; otherwise unchanged. */
export function removeCarton(grid: CartonGrid, index: number): CartonGrid {
  if (grid.cartons.length <= 1 || !cartonIsEmpty(grid, index)) return grid;
  const caseCarton: Record<string, number> = {};
  for (const [id, at] of Object.entries(grid.caseCarton)) caseCarton[id] = at > index ? at - 1 : at;
  return { ...grid, cartons: grid.cartons.filter((_, i) => i !== index), caseCarton };
}

function replaceCarton(grid: CartonGrid, index: number, next: (carton: CartonDraft) => CartonDraft): CartonGrid {
  if (grid.cartons[index] === undefined) return grid;
  return { ...grid, cartons: grid.cartons.map((c, i) => (i === index ? next(c) : c)) };
}

export function setCartonQty(grid: CartonGrid, index: number, skuId: string, raw: string): CartonGrid {
  return replaceCarton(grid, index, (c) => ({ ...c, qty: { ...c.qty, [skuId]: raw } }));
}

export type CartonMeasure = 'weightKg' | 'lengthCm' | 'widthCm' | 'heightCm';

export function setCartonMeasure(grid: CartonGrid, index: number, field: CartonMeasure, raw: string): CartonGrid {
  return replaceCarton(grid, index, (c) => ({ ...c, [field]: raw }));
}

/** Place a catch-weight case in carton `index` (a case is in exactly one carton by construction). */
export function assignCase(grid: CartonGrid, caseId: string, index: number): CartonGrid {
  if (grid.cartons[index] === undefined) return grid;
  return { ...grid, caseCarton: { ...grid.caseCarton, [caseId]: index } };
}

/** One SKU row's total against what was packed — the row turns red when they differ (word first). */
export interface CartonRowTotal {
  readonly skuId: string;
  readonly packedQty: number;
  /** The row's sum across cartons; null when a cell is not a number. */
  readonly cartonedQty: number | null;
  readonly matches: boolean;
  /** "10 of 10 EA" / "Differs — 9 of 10 EA". */
  readonly word: string;
}

function cellMilli(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return 0;
  const qty = parseQuantityInput(raw);
  return qty === null ? null : toMilli(qty);
}

function quantityWord(qty: number, uom: QuantityUom | null): string {
  return uom === null ? `${formatCount(qty)} units` : `${formatQuantity(qty, uom.uomPrecision)} ${uom.uom}`;
}

export function rowTotals(grid: CartonGrid): readonly CartonRowTotal[] {
  return grid.skus.map((sku) => {
    let milli: number | null = 0;
    if (sku.catchWeight) {
      const ids = new Set((sku.cases ?? []).map((c) => c.id));
      milli = Object.entries(grid.caseCarton).filter(([id, at]) => ids.has(id) && grid.cartons[at] !== undefined).length * MILLI;
    } else {
      for (const carton of grid.cartons) {
        const cell = cellMilli(carton.qty[sku.skuId]);
        if (cell === null || milli === null) {
          milli = null;
          break;
        }
        milli += cell;
      }
    }
    const matches = milli !== null && milli === toMilli(sku.packedQty);
    const packed = quantityWord(sku.packedQty, sku.uom);
    const cartoned = milli === null ? '' : sku.uom === null ? formatCount(fromMilli(milli)) : formatQuantity(fromMilli(milli), sku.uom.uomPrecision);
    const word = milli === null ? `Not a number — ${packed} packed` : matches ? `${cartoned} of ${packed}` : `Differs — ${cartoned} of ${packed}`;
    return { skuId: sku.skuId, packedQty: sku.packedQty, cartonedQty: milli === null ? null : fromMilli(milli), matches, word };
  });
}

// ── the bodies ─────────────────────────────────────────────────────────────

export interface CartonScanLine {
  skuId: string;
  qty: number;
  handlingUnitIds?: string[];
}

export interface CartonDimensions {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
}

/** One carton of a pack or re-carton body (the server's `PackCartonDto`). */
export interface CartonBody {
  scanned: CartonScanLine[];
  weightGrams?: number;
  dimensionsMm?: CartonDimensions;
}

export type ParsedCartonGrid =
  | { readonly cartons: CartonBody[]; readonly problem: null }
  | { readonly cartons: null; readonly problem: string };

/** kg (up to 3 decimals) → whole grams, 1–1,000,000; '' → absent. */
export function parseCartonWeightKg(raw: string): { grams: number | undefined; problem: string | null } {
  const trimmed = raw.trim();
  if (trimmed === '') return { grams: undefined, problem: null };
  if (!/^\d+(?:\.\d{1,3})?$/.test(trimmed)) return { grams: undefined, problem: 'Weight is kilograms, to at most 3 decimals (grams).' };
  const grams = Math.round(Number(trimmed) * 1000);
  if (grams < 1) return { grams: undefined, problem: 'Weight is at least 1 gram.' };
  if (grams > MAX_CARTON_WEIGHT_GRAMS) return { grams: undefined, problem: `Weight is at most ${formatCount(MAX_CARTON_WEIGHT_GRAMS / 1000)} kg.` };
  return { grams, problem: null };
}

/** Three sides in cm (up to 1 decimal) → whole mm, all three or none. */
export function parseCartonDimensionsCm(
  lengthCm: string,
  widthCm: string,
  heightCm: string,
): { dimensionsMm: CartonDimensions | undefined; problem: string | null } {
  const sides = [lengthCm, widthCm, heightCm].map((s) => s.trim());
  const filled = sides.filter((s) => s !== '').length;
  if (filled === 0) return { dimensionsMm: undefined, problem: null };
  if (filled < 3) return { dimensionsMm: undefined, problem: 'Dimensions are all three sides together, or none of them.' };
  const mm: number[] = [];
  for (const side of sides) {
    if (!/^\d+(?:\.\d)?$/.test(side)) return { dimensionsMm: undefined, problem: 'Each side is centimetres, to at most 1 decimal.' };
    const value = Math.round(Number(side) * 10);
    if (value < 1) return { dimensionsMm: undefined, problem: 'Each side is at least 1 mm.' };
    if (value > MAX_CARTON_DIMENSION_MM) return { dimensionsMm: undefined, problem: `Each side is at most ${formatCount(MAX_CARTON_DIMENSION_MM / 10)} cm.` };
    mm.push(value);
  }
  return { dimensionsMm: { lengthMm: mm[0]!, widthMm: mm[1]!, heightMm: mm[2]! }, problem: null };
}

/** May the web split this pack? Catch-weight cases are split at the handheld (A26; A50 item 10). */
export function canSplitAtPack(skus: readonly CartonSku[]): boolean {
  return !skus.some((s) => s.catchWeight);
}

export const CATCH_WEIGHT_PACK_NOTE = 'Catch-weight cases are packed on the handheld — split this order there, or re-pack it into cartons after packing.';

/**
 * The grid → the cartons of a pack or re-carton body (A6, A31). Refuses, in
 * words naming the carton: a non-number, a value finer than the SKU's unit,
 * an empty carton, a row that does not add up to what was packed, a case
 * left out, too many lines, a bad weight or dimension. `mode: 'pack'` also
 * refuses catch-weight SKUs (the handheld splits those).
 */
export function parseCartonGrid(grid: CartonGrid, mode: 'pack' | 'recarton'): ParsedCartonGrid {
  const fail = (problem: string): ParsedCartonGrid => ({ cartons: null, problem });
  if (grid.cartons.length === 0) return fail('Add at least one carton.');
  if (grid.cartons.length > MAX_CARTONS) return fail(`A pack holds at most ${MAX_CARTONS} cartons.`);
  if (mode === 'pack' && !canSplitAtPack(grid.skus)) return fail(CATCH_WEIGHT_PACK_NOTE);
  const cartons: CartonBody[] = [];
  let lineCount = 0;
  const totals = new Map<string, number>();
  for (const [index, carton] of grid.cartons.entries()) {
    const n = index + 1;
    const scanned: CartonScanLine[] = [];
    for (const sku of grid.skus) {
      if (sku.catchWeight) {
        const ids = (sku.cases ?? []).filter((c) => grid.caseCarton[c.id] === index).map((c) => c.id).sort();
        if (ids.length === 0) continue;
        scanned.push({ skuId: sku.skuId, qty: ids.length, handlingUnitIds: ids });
        totals.set(sku.skuId, (totals.get(sku.skuId) ?? 0) + ids.length * MILLI);
        continue;
      }
      const raw = carton.qty[sku.skuId];
      if (raw === undefined || raw.trim() === '') continue;
      const qty = parseQuantityInput(raw);
      if (qty === null) return fail(`Carton ${n}: ${sku.skuCode} is not a number.`);
      const milli = toMilli(qty);
      if (milli === 0) continue;
      if (Math.abs(qty * MILLI - milli) > 1e-6) return fail(`Carton ${n}: ${sku.skuCode} is at most 3 decimals.`);
      if (sku.uom !== null) {
        const step = 10 ** (3 - Math.min(Math.max(sku.uom.uomPrecision, 0), 3));
        if (milli % step !== 0) {
          return fail(
            sku.uom.uomPrecision === 0
              ? `Carton ${n}: ${sku.skuCode} counts in whole ${sku.uom.uom} — split it in whole units.`
              : `Carton ${n}: ${sku.skuCode} is at most ${sku.uom.uomPrecision} decimal${sku.uom.uomPrecision === 1 ? '' : 's'} of ${sku.uom.uom}.`,
          );
        }
      }
      scanned.push({ skuId: sku.skuId, qty: fromMilli(milli) });
      totals.set(sku.skuId, (totals.get(sku.skuId) ?? 0) + milli);
    }
    if (scanned.length === 0) return fail(`Carton ${n} is empty — remove it.`);
    if (scanned.length > MAX_LINES_PER_CARTON) return fail(`Carton ${n} holds more than ${MAX_LINES_PER_CARTON} SKUs.`);
    lineCount += scanned.length;
    const weight = parseCartonWeightKg(carton.weightKg);
    if (weight.problem !== null) return fail(`Carton ${n}: ${weight.problem}`);
    const dims = parseCartonDimensionsCm(carton.lengthCm, carton.widthCm, carton.heightCm);
    if (dims.problem !== null) return fail(`Carton ${n}: ${dims.problem}`);
    cartons.push({
      scanned,
      ...(weight.grams === undefined ? {} : { weightGrams: weight.grams }),
      ...(dims.dimensionsMm === undefined ? {} : { dimensionsMm: dims.dimensionsMm }),
    });
  }
  if (lineCount > MAX_CARTON_LINES) return fail(`A pack holds at most ${formatCount(MAX_CARTON_LINES)} carton lines.`);
  for (const sku of grid.skus) {
    const cartoned = totals.get(sku.skuId) ?? 0;
    if (cartoned !== toMilli(sku.packedQty)) {
      return fail(
        `${sku.skuCode}: the cartons hold ${quantityWord(fromMilli(cartoned), sku.uom)} but ${quantityWord(sku.packedQty, sku.uom)} ${mode === 'pack' ? 'were scanned' : 'were packed'} — the cartons must add up.`,
      );
    }
    if (sku.catchWeight) {
      const missing = (sku.cases ?? []).filter((c) => grid.cartons[grid.caseCarton[c.id] ?? -1] === undefined);
      if (missing.length > 0) return fail(`${sku.skuCode}: case ${missing[0]!.label} is in no carton — choose one.`);
    }
  }
  return { cartons, problem: null };
}

/** The pack body the bench sends (`PackOrderDto`). */
export interface PackBody {
  scanned: { skuId: string; qty: number; handlingUnitIds?: string[] }[];
  weightGrams?: number;
  dimensionsMm?: CartonDimensions;
  cartons?: CartonBody[];
}

/**
 * The pack body (A6, A26). With no grid, or a grid of one carton, it is
 * today's exact payload — the bench's own weight and dimensions on top,
 * byte-identical (the server hashes it as main did). With more than one
 * carton: the bench's scanned total, the cartons, and NO top-level weight or
 * dimensions (each carton is weighed instead).
 */
export function buildPackBody(
  oneCarton: { readonly scanned: PackBody['scanned']; readonly weightGrams?: number; readonly dimensionsMm?: CartonDimensions },
  grid: CartonGrid | null,
): { readonly body: PackBody; readonly problem: null } | { readonly body: null; readonly problem: string } {
  if (grid === null) return { body: { ...oneCarton, scanned: [...oneCarton.scanned] }, problem: null };
  const parsed = parseCartonGrid(grid, 'pack');
  if (parsed.problem !== null) return { body: null, problem: parsed.problem };
  if (parsed.cartons.length === 1) {
    // A grid left with one carton (split, then the others removed) is today's
    // payload: that carton's weight and dimensions travel as the top-level
    // ones — the bench's own measurements fieldset is hidden while splitting.
    const only = parsed.cartons[0]!;
    return {
      body: {
        scanned: [...oneCarton.scanned],
        ...(only.weightGrams === undefined ? {} : { weightGrams: only.weightGrams }),
        ...(only.dimensionsMm === undefined ? {} : { dimensionsMm: only.dimensionsMm }),
      },
      problem: null,
    };
  }
  return { body: { scanned: [...oneCarton.scanned], cartons: parsed.cartons }, problem: null };
}

/**
 * The bench's per-SKU scanned totals as grid rows (the bench is per order
 * line; the grid is per SKU, summed exactly in milli-units).
 */
export function cartonSkusFromScanned(
  scanned: readonly { readonly skuId: string; readonly qty: number }[],
  skuOf: (skuId: string) => { readonly skuCode: string; readonly skuName?: string; readonly uom: QuantityUom | null; readonly catchWeight?: boolean } | undefined,
): readonly CartonSku[] {
  const milli = new Map<string, number>();
  for (const line of scanned) milli.set(line.skuId, (milli.get(line.skuId) ?? 0) + toMilli(line.qty));
  return [...milli.entries()].map(([skuId, total]) => {
    const sku = skuOf(skuId);
    return {
      skuId,
      skuCode: sku?.skuCode ?? skuId,
      ...(sku?.skuName === undefined ? {} : { skuName: sku.skuName }),
      uom: sku?.uom ?? null,
      packedQty: fromMilli(total),
      catchWeight: sku?.catchWeight ?? false,
    };
  });
}

/**
 * Does a split grid still describe this scan — the same SKUs with the same
 * exact totals? A scan edit after "Split into cartons" makes it stale, and a
 * stale split is never sent (its cartons would not add up to the scan).
 */
export function gridMatchesScan(grid: CartonGrid, scanned: readonly { readonly skuId: string; readonly qty: number }[]): boolean {
  const key = (rows: readonly { readonly skuId: string; readonly packedQty: number }[]) =>
    JSON.stringify(rows.map((r) => `${r.skuId}:${toMilli(r.packedQty)}`).sort());
  return key(grid.skus) === key(cartonSkusFromScanned(scanned, () => undefined));
}

/** A re-carton reason: trimmed, 1–200 code points. */
export function parseRecartonReason(text: string): { reason: string; problem: null } | { reason: null; problem: string } {
  const reason = text.trim();
  if (reason === '') return { reason: null, problem: 'Say why the order is re-packed — the reason is kept with the pack.' };
  if ([...reason].length > MAX_RECARTON_REASON_LENGTH) return { reason: null, problem: `The reason is at most ${MAX_RECARTON_REASON_LENGTH} characters.` };
  return { reason, problem: null };
}

/** The re-carton body (A8): `{cartons, reason}`. */
export function buildRecartonBody(
  grid: CartonGrid,
  reasonText: string,
): { readonly body: { cartons: CartonBody[]; reason: string }; readonly problem: null } | { readonly body: null; readonly problem: string } {
  const parsed = parseCartonGrid(grid, 'recarton');
  if (parsed.problem !== null) return { body: null, problem: parsed.problem };
  const reason = parseRecartonReason(reasonText);
  if (reason.problem !== null) return { body: null, problem: reason.problem };
  return { body: { cartons: parsed.cartons, reason: reason.reason }, problem: null };
}

/**
 * The key binding (A26 "a key per draft bound to its body"): the same body
 * reuses its key, any change mints a new one.
 */
export function bindRecartonKey(
  current: { readonly key: string; readonly body: string } | null,
  body: { cartons: CartonBody[]; reason: string },
  mint: () => string,
): { readonly key: string; readonly body: string } {
  const canonical = JSON.stringify(body);
  return current !== null && current.body === canonical ? current : { key: mint(), body: canonical };
}

// ── the refusal copy ───────────────────────────────────────────────────────

export type CartonAction = 'pack' | 'recarton' | 'carton-labels' | 'packing-slip' | 'carton-slips' | 'package-labels' | 'read';

const CARTON_ACTION_WORD: Readonly<Record<CartonAction, string>> = {
  pack: 'Not packed',
  recarton: 'Not re-packed',
  'carton-labels': 'The carton labels were not printed',
  'packing-slip': 'The packing slip was not downloaded',
  'carton-slips': 'The carton slips were not printed',
  'package-labels': 'The package labels were not printed',
  read: 'The cartons could not be read',
};

function skuMismatchList(error: ApiProblem): string | null {
  const skus = error.extensions['skus'];
  if (!Array.isArray(skus)) return null;
  const parts: string[] = [];
  for (const entry of skus) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { skuCode, packed, cartoned } = entry as Record<string, unknown>;
    if (typeof skuCode !== 'string') continue;
    parts.push(`${skuCode} packed ${String(packed)}, in cartons ${String(cartoned)}`);
  }
  return parts.length === 0 ? null : parts.join('; ');
}

/** Every refusal the story's routes answer, by `code` (guide §3). */
export function cartonReason(error: unknown, action: CartonAction): string {
  if (!(error instanceof ApiProblem)) return UNREACHABLE_REASON;
  const lead = CARTON_ACTION_WORD[action];
  switch (error.code) {
    case 'validation-failed':
      return error.detail ?? `${lead} — check the cartons and try again.`;
    case 'carton-contents-mismatch': {
      const list = skuMismatchList(error);
      return `${lead} — the cartons must hold exactly what was packed${list === null ? '' : ` (${list})`}. A re-pack changes the split, never the goods.`;
    }
    case 'shipment-labelled-by-carrier':
      return `${lead} — the carrier’s label counts its pieces. Cancel the label and re-pack to change them.`;
    case 'order-not-packed':
      return `${lead} — the order is not packed (or has already left).${error.detail === undefined ? '' : ` ${error.detail}`}`;
    case 'recarton-limit':
      return `${lead} — this order has been re-packed the most times allowed (99 packs).`;
    case 'too-many-labels':
      return error.detail ?? `${lead} — one print renders at most ${formatCount(MAX_LABELS_PER_PRINT)} labels. Print a smaller range.`;
    case 'package-count-mismatch':
      return error.detail ?? `${lead} — the count differs from the packages recorded at dispatch.`;
    case 'carton-not-current':
      return `${lead} — an old carton label (the order was re-packed). Reprint its labels.`;
    case 'consignee-address-missing':
      return `${lead} — the consignee has no address of this kind. Add the address to the partner, or print by hand.`;
    case 'rtv-not-picked':
      return `${lead} — the return to vendor is not picked yet.`;
    case 'rtc-not-picked':
      return `${lead} — the return to client is not picked yet.`;
    case 'not-found':
      return `${lead} — it no longer exists, or that carton number is not on this pack. Refresh.`;
    case 'role-denied':
      return `${lead} — your role cannot do this.`;
    case 'permission-denied':
      return `${lead} — your session belongs to another workspace.`;
    case 'idempotency-key-reuse':
      return `${lead} — the request changed after it was first sent. Submit it again.`;
    case 'conflict':
      return error.detail ?? `${lead} — another change landed at the same moment. Try again.`;
    default:
      return error.detail ?? `${lead} (${error.code}).`;
  }
}

// ── file names (CORS hides the server's) ───────────────────────────────────

/** The 2-10b fold: anything outside `[A-Za-z0-9._-]` becomes `-`. */
export function foldFileStem(label: string, fallback = 'order'): string {
  return label.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

export type LabelFormat = 'zpl' | 'pdf';

export function packingSlipFilename(orderLabel: string): string {
  return `${foldFileStem(orderLabel)}-packing-slip.pdf`;
}

export function cartonSlipsFilename(orderLabel: string, format: LabelFormat): string {
  return `${foldFileStem(orderLabel)}-carton-slips.${format}`;
}

export function cartonLabelsFilename(orderLabel: string, format: LabelFormat): string {
  return `${foldFileStem(orderLabel)}-carton-labels.${format}`;
}

export function packageLabelsFilename(documentCode: string, format: LabelFormat): string {
  return `${foldFileStem(documentCode, 'return')}-package-labels.${format}`;
}

// ── totals and summaries (A36: per UoM, never across units) ────────────────

/**
 * Totals per unit, "12 EA · 2.5 KG" — never one cross-SKU figure (the C33
 * defect class). An unresolved unit groups as "units".
 */
export function perUomTotals(lines: readonly { readonly qty: number; readonly uom: QuantityUom | null }[]): string {
  const byUom = new Map<string, { milli: number; precision: number }>();
  for (const line of lines) {
    const key = line.uom?.uom ?? 'units';
    const precision = line.uom?.uomPrecision ?? 3;
    const entry = byUom.get(key) ?? { milli: 0, precision };
    entry.milli += toMilli(line.qty);
    entry.precision = Math.max(entry.precision, precision);
    byUom.set(key, entry);
  }
  if (byUom.size === 0) return '—';
  return [...byUom.entries()]
    .map(([uom, { milli, precision }]) => {
      const value = fromMilli(milli);
      const digits = uom === 'units' ? formatCount(value) : formatQuantity(value, precision).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
      return `${digits} ${uom}`;
    })
    .join(' · ');
}

/** "3 cartons · 12.4 kg" (the weight only when every carton is weighed); "1 carton". */
export function cartonSummary(cartonCount: number, grossWeightGrams: number | null | undefined): string {
  const count = `${formatCount(cartonCount)} ${cartonCount === 1 ? 'carton' : 'cartons'}`;
  if (grossWeightGrams === null || grossWeightGrams === undefined) return count;
  const kg = (grossWeightGrams / 1000).toLocaleString('en-IN', { maximumFractionDigits: 1 });
  return `${count} · ${kg} kg`;
}

/** "Carton 2 of 3 — 4.2 kg — 40 × 30 × 20 cm". */
export function cartonLine(
  seq: number,
  count: number,
  weightGrams: number | null,
  dimensionsMm: CartonDimensions | null,
): string {
  const parts = [`Carton ${seq} of ${count}`];
  if (weightGrams !== null) parts.push(`${(weightGrams / 1000).toLocaleString('en-IN', { maximumFractionDigits: 3 })} kg`);
  if (dimensionsMm !== null) parts.push(`${dimensionsMm.lengthMm / 10} × ${dimensionsMm.widthMm / 10} × ${dimensionsMm.heightMm / 10} cm`);
  return parts.join(' — ');
}

/** A33 — over a shipment's weight bound the handover takes no default weight. */
export const OVER_SHIPMENT_WEIGHT_NOTE = 'Over 1,000 kg — record the freight weight on the LR (4-9a).';

export function grossOverShipmentBound(grossWeightGrams: number | null | undefined): boolean {
  return grossWeightGrams !== null && grossWeightGrams !== undefined && grossWeightGrams > MAX_SHIPMENT_WEIGHT_GRAMS;
}

/** A40 — the client's label PDF has fewer pages than cartons: warn, never refuse. */
export function clientLabelPagesWarning(pageCount: number | null | undefined, cartonCount: number | null | undefined): string | null {
  if (pageCount === null || pageCount === undefined || cartonCount === null || cartonCount === undefined) return null;
  if (pageCount >= cartonCount) return null;
  return `The client’s label has ${pageCount} ${pageCount === 1 ? 'page' : 'pages'} for ${cartonCount} cartons.`;
}

/** A41 — before buying a carrier label for a multi-carton pack. */
export function carrierMultiCartonWarning(cartonCount: number | null | undefined): string | null {
  if (cartonCount === null || cartonCount === undefined || cartonCount <= 1) return null;
  return `One AWB will cover ${cartonCount} cartons — every carton label prints it.`;
}

// ── the print group and its remembered format (A26) ────────────────────────

export type PackPrintChoice = 'labels-zpl' | 'labels-pdf' | 'labels-a4' | 'slip-a4' | 'slips-zpl';

export const PACK_PRINT_CHOICES: readonly { readonly choice: PackPrintChoice; readonly word: string }[] = [
  { choice: 'labels-zpl', word: 'Carton labels (ZPL)' },
  { choice: 'labels-pdf', word: 'PDF 4×6' },
  { choice: 'labels-a4', word: 'PDF on A4' },
  { choice: 'slip-a4', word: 'Packing slip (A4 PDF)' },
  { choice: 'slips-zpl', word: 'Carton slips (ZPL)' },
];

/** D7: the pack station's default is the 4×6 ZPL. */
export const DEFAULT_PACK_PRINT: PackPrintChoice = 'labels-zpl';

/** The file route and query a print choice asks for, with the download name. */
export function packPrintRequest(
  choice: PackPrintChoice,
  orderLabel: string,
): { readonly route: 'carton-labels' | 'packing-slip'; readonly format: LabelFormat; readonly layout: 'label' | 'a4'; readonly filename: string } {
  switch (choice) {
    case 'labels-zpl':
      return { route: 'carton-labels', format: 'zpl', layout: 'label', filename: cartonLabelsFilename(orderLabel, 'zpl') };
    case 'labels-pdf':
      return { route: 'carton-labels', format: 'pdf', layout: 'label', filename: cartonLabelsFilename(orderLabel, 'pdf') };
    case 'labels-a4':
      return { route: 'carton-labels', format: 'pdf', layout: 'a4', filename: cartonLabelsFilename(orderLabel, 'pdf') };
    case 'slip-a4':
      return { route: 'packing-slip', format: 'pdf', layout: 'a4', filename: packingSlipFilename(orderLabel) };
    case 'slips-zpl':
      return { route: 'packing-slip', format: 'zpl', layout: 'label', filename: cartonSlipsFilename(orderLabel, 'zpl') };
  }
}

export const PACK_PRINT_STORAGE_KEY = 'wms.pack-print-format';

function isPrintChoice(value: unknown): value is PackPrintChoice {
  return PACK_PRINT_CHOICES.some((c) => c.choice === value);
}

/** The last-used print format in this browser — the default when storage is empty, blocked or holds junk. */
export function rememberedPrintChoice(): PackPrintChoice {
  try {
    const value = globalThis.localStorage?.getItem(PACK_PRINT_STORAGE_KEY);
    return isPrintChoice(value) ? value : DEFAULT_PACK_PRINT;
  } catch {
    return DEFAULT_PACK_PRINT;
  }
}

/** Best-effort: a blocked storage keeps the default. */
export function rememberPrintChoice(choice: PackPrintChoice): void {
  try {
    globalThis.localStorage?.setItem(PACK_PRINT_STORAGE_KEY, choice);
  } catch {
    // Private window or blocked storage: the default stays.
  }
}

// ── return package labels (A22, A27, A43) ──────────────────────────────────

export const PACKAGE_LABEL_COUNT_STORAGE_PREFIX = 'wms.package-labels-printed';

export type PackageLabelDraft = { readonly count: string; readonly from: string; readonly to: string };

export type ParsedPackageLabels =
  | { readonly query: { count: number; from?: number; to?: number }; readonly problem: null }
  | { readonly query: null; readonly problem: string };

function wholeIn(text: string, min: number, max: number): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

/** The dialog's count and optional range → the query (A22, A43). */
export function parsePackageLabelDraft(draft: PackageLabelDraft): ParsedPackageLabels {
  const count = wholeIn(draft.count, 1, MAX_PACKAGE_LABELS);
  if (count === null) return { query: null, problem: `Packages is a whole number from 1 to ${formatCount(MAX_PACKAGE_LABELS)}.` };
  const fromText = draft.from.trim();
  const toText = draft.to.trim();
  const from = fromText === '' ? 1 : wholeIn(fromText, 1, count);
  const to = toText === '' ? count : wholeIn(toText, 1, count);
  if (from === null || to === null || from > to) return { query: null, problem: `Print a range within 1–${formatCount(count)}, the first no higher than the last.` };
  if (to - from + 1 > MAX_LABELS_PER_PRINT) {
    return { query: null, problem: `One print renders at most ${formatCount(MAX_LABELS_PER_PRINT)} labels — print ${from}–${from + MAX_LABELS_PER_PRINT - 1} first.` };
  }
  return { query: { count, ...(fromText === '' ? {} : { from }), ...(toText === '' ? {} : { to }) }, problem: null };
}

/** Remember the count last printed for a return document (A43) — best-effort. */
export function rememberPackageLabelCount(documentId: string, count: number): void {
  try {
    globalThis.localStorage?.setItem(`${PACKAGE_LABEL_COUNT_STORAGE_PREFIX}:${documentId}`, String(count));
  } catch {
    // best-effort
  }
}

export function lastPrintedPackageLabelCount(documentId: string): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(`${PACKAGE_LABEL_COUNT_STORAGE_PREFIX}:${documentId}`);
    if (raw === null || raw === undefined || !/^\d+$/.test(raw)) return null;
    return Number(raw);
  } catch {
    return null;
  }
}

/** A43 — the dispatch dialog warns when its count differs from the labels last printed. */
export function packageCountDiffersWarning(dispatchCount: number | undefined, lastPrinted: number | null): string | null {
  if (dispatchCount === undefined || lastPrinted === null || dispatchCount === lastPrinted) return null;
  return `${formatCount(lastPrinted)} package labels were printed, but ${formatCount(dispatchCount)} packages are recorded — reprint the labels if the count changed.`;
}
