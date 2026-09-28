import { ApiProblem } from '@/lib/api/client';
import type { DispatchDto, DispatchedLineDto, OrderLineDto, PackDto, PackedLineDto } from '@/lib/api/generated';
import { parseQuantityInput, quantityLabel, sharedQuantityUom, type QuantityUom } from '@/lib/format-quantity';
import { UNREACHABLE_REASON, verbatim, type OrderStatus, type Outcome } from '@/lib/outbound-orders';

/**
 * Pure copy and derivation for the Outbound pack & dispatch surface
 * (story 4-2d) — the web consumer of the pack (4.5) and dispatch (4.6)
 * commands, extracted from the component the way `outbound-orders.ts` was.
 *
 * The decisions that live here rather than in JSX:
 *   1. The server is the sole picked-vs-scanned authority. No web read
 *      exposes picked quantities (order lines carry ordered/reserved/
 *      shortfall only), so the bench shows ordered-vs-scanned and every
 *      refusal arm — the 422 `pack-mismatch` naming both quantities, the 409
 *      naming the outstanding lines — is rendered verbatim. Pre-verifying
 *      client-side would mean re-deriving pick state the API does not expose.
 *   2. Dispatch is terminal. The confirmation says so; there is no un-dispatch.
 *   3. `carrierName` / `trackingNumber` are labeled free text — no client-side
 *      vocabulary is invented here (4-6c structures them).
 *   4. Scanned entries start from the ORDERED quantity and the packer edits
 *      down. A short-picked order gets the server's 422 naming both
 *      quantities, and the packer corrects — the epic's stated behavior.
 */

/* ------------------------------------------------------------------ */
/* The page scope                                                      */
/* ------------------------------------------------------------------ */

/**
 * The statuses the pipeline page shows. Cancelled orders are not on the
 * pipeline — there is nothing to pack or dispatch about them — so the list is
 * filtered to these three client-side, page-scoped, exactly like the status
 * filters on the sibling surfaces (the order list API is `cursor`+`limit`
 * only and offers no status filter).
 */
export const PIPELINE_STATUSES = ['accepted', 'ready_to_dispatch', 'dispatched'] as const;

export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

/** Membership is derived, never a negative check: a fifth lifecycle arm must
 * opt in here (and in `ORDER_STATUS_LABEL`'s compile) or it stays off the
 * pipeline — it must never auto-appear. */
export function isPipelineStatus(status: OrderStatus): status is PipelineStatus {
  return (PIPELINE_STATUSES as readonly string[]).includes(status);
}

/** Packing is offered for exactly one state — the pack precondition's status arm. */
export function canPackOrder(status: OrderStatus): boolean {
  return status === 'accepted';
}

/** Dispatching is offered for exactly one state — `ready_to_dispatch`. */
export function canDispatchOrder(status: OrderStatus): boolean {
  return status === 'ready_to_dispatch';
}

/* ------------------------------------------------------------------ */
/* The pack draft                                                      */
/* ------------------------------------------------------------------ */

/**
 * One scanned entry on the bench panel: an order line and what the operator
 * counted into the parcel for it, as the raw input string. Entries start from
 * the line's ORDERED quantity (the fast common full pack) and the packer
 * edits down; a short-picked order then gets the server's 422 naming both
 * quantities and the packer corrects.
 */
export interface PackScanDraftLine {
  readonly orderLineId: string;
  readonly skuId: string;
  readonly orderedQty: number;
  readonly scanned: string;
}

export function packScanDraftFromLines(lines: readonly OrderLineDto[]): readonly PackScanDraftLine[] {
  return lines.map((line) => ({
    orderLineId: line.id,
    skuId: line.skuId,
    orderedQty: line.qty,
    // Seeded from ORDERED, per the story's decided input model — the server
    // (not this form) is the picked-vs-scanned authority.
    scanned: String(line.qty),
  }));
}

/**
 * The optional parcel measurements, as raw input strings. The backend takes
 * them all-or-nothing per GROUP — weight stands alone; dimensions are all
 * three sides together or the object omitted (`PackDimensionsDto` requires
 * all three arms inside the object) — so a partially-typed measurement is a
 * client-side refusal, never a 400 round trip.
 */
export interface PackMeasurements {
  readonly weightGrams: string;
  readonly lengthMm: string;
  readonly widthMm: string;
  readonly heightMm: string;
}

export const EMPTY_MEASUREMENTS: PackMeasurements = {
  weightGrams: '',
  lengthMm: '',
  widthMm: '',
  heightMm: '',
};

/** The backend's `@Max` on `weightGrams` (pack.command.ts:72). */
export const MAX_WEIGHT_GRAMS = 1_000_000;
/** The backend's `@Max` on each dimension side (pack.command.ts:74). */
export const MAX_DIMENSION_MM = 100_000;
/**
 * The backend's `@Min` on one scanned line's qty (outbound.dto.ts, PackScanLineDto).
 * A SKU counted as none is OMITTED from the body — the wire has no zero-qty
 * scan line, and the server reads an absent SKU as scanned 0.
 */
export const MIN_SCAN_QTY = 0.001;
/**
 * The backend's `@Max` on one scanned line's qty (outbound.dto.ts,
 * PackScanLineDto) — wms-be's `MAX_QUANTITY_BASE` (quantity.ts), the largest
 * exact milli-unit count: `Math.floor(MAX_SAFE_INTEGER / 10 ** 3)`.
 */
export const MAX_QUANTITY_BASE = Math.floor(Number.MAX_SAFE_INTEGER / 1_000);

export interface ParsedPackDraft {
  readonly body: {
    /** Mutable: this object is passed straight to the SDK as `PackOrderDto`. */
    readonly scanned: { skuId: string; qty: number }[];
    readonly weightGrams?: number;
    readonly dimensionsMm?: { readonly lengthMm: number; readonly widthMm: number; readonly heightMm: number };
  } | null;
  /** Non-null when the draft cannot be sent — nothing is requested. */
  readonly problem: string | null;
}

/** Whole-number shape for the measurement inputs — grams and millimetres are integers. */
function parseIntegerInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/**
 * The pack bench draft → request body. Blank (or zero) entries mean "none of
 * this SKU counted" and are dropped from the body — the server reads an
 * absent SKU as scanned 0, which is exactly what the operator means. Bounds
 * mirror the backend's decorators with a comment naming each; a value finer
 * than the SKU's unit allows is NEVER clamped or rounded here — the backend's
 * precision refusal is the authority, and this parser only decides shape.
 */
export function parsePackDraft(
  scans: readonly PackScanDraftLine[],
  measurements: PackMeasurements,
): ParsedPackDraft {
  const scanned: { skuId: string; qty: number }[] = [];
  for (const line of scans) {
    const raw = line.scanned.trim();
    // Blank and zero are the same claim — nothing of this SKU in the parcel —
    // and an absent SKU reads as scanned 0 on the server.
    if (raw === '') continue;
    const qty = parseQuantityInput(raw);
    if (qty === null) {
      return { body: null, problem: 'Every scanned quantity is a decimal number.' };
    }
    if (qty === 0) continue;
    // The backend's `@Min(0.001)` on a scan line (the milli-unit floor): a
    // positive value finer than it is a guaranteed 400.
    if (qty < MIN_SCAN_QTY) {
      return { body: null, problem: `A scanned quantity is at least ${MIN_SCAN_QTY}.` };
    }
    // The backend's `@Max(MAX_QUANTITY_BASE)` on a scan line: a value past
    // the largest exact milli-unit count is a guaranteed 400.
    if (qty > MAX_QUANTITY_BASE) {
      return {
        body: null,
        problem: `A scanned quantity is at most ${MAX_QUANTITY_BASE.toLocaleString('en-US')}.`,
      };
    }
    scanned.push({ skuId: line.skuId, qty });
  }

  let weightGrams: number | undefined;
  const weightRaw = measurements.weightGrams.trim();
  if (weightRaw !== '') {
    const weight = parseIntegerInput(weightRaw);
    // The backend's `@IsInt() @Min(1)` — a non-positive weight is a 400.
    if (weight === null || weight < 1) {
      return { body: null, problem: 'Weight is a whole number of grams, at least 1.' };
    }
    if (weight > MAX_WEIGHT_GRAMS) {
      return { body: null, problem: `Weight is at most ${MAX_WEIGHT_GRAMS.toLocaleString('en-US')} grams.` };
    }
    weightGrams = weight;
  }

  const sides = [measurements.lengthMm, measurements.widthMm, measurements.heightMm].map((side) => side.trim());
  const filled = sides.filter((side) => side !== '');
  let dimensionsMm: { lengthMm: number; widthMm: number; heightMm: number } | undefined;
  if (filled.length > 0) {
    // All three sides together, or the object omitted — a box with two sides
    // is not a measurement, and the backend refuses it with a 400.
    if (filled.length < 3) {
      return { body: null, problem: 'Dimensions are all three sides together, or none of them.' };
    }
    const values: number[] = [];
    for (const side of sides) {
      const value = parseIntegerInput(side);
      // The backend's `@IsInt() @Min(1) @Max(MAX_DIMENSION_MM)` per side.
      if (value === null || value < 1) {
        return { body: null, problem: 'Each dimension is a whole number of millimetres.' };
      }
      if (value > MAX_DIMENSION_MM) {
        return { body: null, problem: `Each dimension is at most ${MAX_DIMENSION_MM.toLocaleString('en-US')} mm.` };
      }
      values.push(value);
    }
    dimensionsMm = { lengthMm: values[0]!, widthMm: values[1]!, heightMm: values[2]! };
  }

  return {
    body: {
      scanned,
      ...(weightGrams === undefined ? {} : { weightGrams }),
      ...(dimensionsMm === undefined ? {} : { dimensionsMm }),
    },
    problem: null,
  };
}

/* ------------------------------------------------------------------ */
/* The dispatch draft                                                  */
/* ------------------------------------------------------------------ */

/**
 * The dispatch confirm's two free-text fields → the request body. Optional
 * fields the viewer left blank are DROPPED from the body, never sent as `''` —
 * an empty body is a complete dispatch, and the backend treats a blank string
 * as absent anyway. Nothing here can be refused client-side: the fields are
 * free text bounded by the input's own `maxLength`, which mirrors the
 * backend's `@Length(0, MAX_CARRIER_NAME_LENGTH)` /
 * `@Length(0, MAX_TRACKING_NUMBER_LENGTH)` (dispatch.command.ts — both 200).
 */
export function parseDispatchDraft(fields: { readonly carrierName: string; readonly trackingNumber: string }): {
  readonly carrierName?: string;
  readonly trackingNumber?: string;
} {
  const carrierName = fields.carrierName.trim();
  const trackingNumber = fields.trackingNumber.trim();
  return {
    ...(carrierName === '' ? {} : { carrierName }),
    ...(trackingNumber === '' ? {} : { trackingNumber }),
  };
}

/** The confirmation's terminal warning — dispatch has no reverse arm. */
export const DISPATCH_TERMINAL_WARNING =
  'Dispatch is terminal — there is no un-dispatch. Every committed reservation the order still owns is retired, which is what restores ATP.';

/* ------------------------------------------------------------------ */
/* Outcomes                                                            */
/* ------------------------------------------------------------------ */

export const MAX_NAMED_SHORT_LINES = 5;

/**
 * The pack result, built from the RESPONSE's own slip (never from the
 * request): the parcel's totals, and every short-packed line named per its
 * own SKU's unit. A shortfall on the slip is an acceptance — the order packed
 * honestly under what was picked — never a failure.
 */
export function packOutcome(
  pack: PackDto,
  uomOf: (skuId: string) => QuantityUom | undefined,
): Outcome {
  const q = (value: number, skuId: string) => quantityLabel(value, uomOf(skuId) ?? null);
  const head = `${pack.lines.length} ${pack.lines.length === 1 ? 'line' : 'lines'} · ${quantityLabel(
    pack.totalUnits,
    sharedQuantityUom(pack.lines, uomOf),
  )} packed`;
  const shortLines = pack.lines.filter((line) => line.shortfallQty > 0);
  if (shortLines.length === 0) {
    return {
      tone: 'accepted',
      word: 'Order packed',
      reason: `${head}. The order is ready to dispatch.`,
    };
  }
  const named = shortLines
    .slice(0, MAX_NAMED_SHORT_LINES)
    .map((line) => `${line.skuCode} short ${q(line.shortfallQty, line.skuId)}`)
    .join(', ');
  const hidden = shortLines.length - MAX_NAMED_SHORT_LINES;
  const short = hidden > 0 ? `${named} …and ${hidden} more` : named;
  return {
    tone: 'accepted',
    word: 'Packed with a shortfall',
    reason: `${head}; shipped under-filled — ${short}.`,
  };
}

/**
 * The dispatch result, built from the response's own record. The retired
 * holds are the point of the command — the ATP correction — so the count is
 * named, and the terminality is stated rather than implied. The headline is
 * unit-aware exactly like `packOutcome`: the shipped total at the lines'
 * shared unit, or the raw-number fallback when the units mix.
 */
export function dispatchOutcome(
  dispatch: DispatchDto,
  uomOf: (skuId: string) => QuantityUom | undefined,
): Outcome {
  const retired = dispatch.retiredReservationIds.length;
  const retiredClause =
    retired === 0
      ? 'no reservation holds were left to retire'
      : retired === 1
        ? '1 reservation hold retired'
        : `${retired} reservation holds retired`;
  return {
    tone: 'accepted',
    word: 'Order dispatched',
    reason: `${dispatch.lines.length} ${dispatch.lines.length === 1 ? 'line' : 'lines'} · ${quantityLabel(
      dispatch.totalUnits,
      sharedQuantityUom(dispatch.lines, uomOf),
    )} shipped; ${retiredClause}. The order is dispatched — there is no un-dispatch.`,
  };
}

/* ------------------------------------------------------------------ */
/* Slip and record labels                                              */
/* ------------------------------------------------------------------ */

/** One packing-slip line's quantities, at its own SKU's precision. */
export function packedLineLabel(line: PackedLineDto, uom?: QuantityUom | null): string {
  const q = (value: number) => quantityLabel(value, uom ?? null);
  const base = `${q(line.orderedQty)} ordered · ${q(line.packedQty)} packed`;
  return line.shortfallQty > 0 ? `${base} · ${q(line.shortfallQty)} short` : base;
}

/** One dispatch-record line's quantities, at its own SKU's precision. */
export function dispatchedLineLabel(line: DispatchedLineDto, uom?: QuantityUom | null): string {
  const q = (value: number) => quantityLabel(value, uom ?? null);
  const base = `${q(line.orderedQty)} ordered · ${q(line.dispatchedQty)} shipped`;
  return line.shortfallQty > 0 ? `${base} · ${q(line.shortfallQty)} short` : base;
}

/**
 * The parcel's measurements as the slip states them: grams, then the three
 * sides, or the honest "Unmeasured" when neither was taken.
 */
export function parcelMeasurementLabel(
  pack: Pick<PackDto, 'weightGrams' | 'dimensionsMm'>,
): string {
  const parts: string[] = [];
  if (pack.weightGrams !== null) {
    parts.push(`${pack.weightGrams.toLocaleString('en-US')} g`);
  }
  if (pack.dimensionsMm !== null) {
    parts.push(
      `${pack.dimensionsMm.lengthMm.toLocaleString('en-US')} × ${pack.dimensionsMm.widthMm.toLocaleString('en-US')} × ${pack.dimensionsMm.heightMm.toLocaleString('en-US')} mm`,
    );
  }
  return parts.length === 0 ? 'Unmeasured' : parts.join(' · ');
}

/** The dispatch record's carrier arms, honestly absent when none was recorded. */
export function dispatchRecordLabel(
  dispatch: Pick<DispatchDto, 'carrierName' | 'trackingNumber'>,
): string {
  if (dispatch.carrierName === null && dispatch.trackingNumber === null) {
    return 'No carrier recorded';
  }
  return [
    dispatch.carrierName === null ? null : `Carrier ${dispatch.carrierName}`,
    dispatch.trackingNumber === null ? null : `Tracking ${dispatch.trackingNumber}`,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

/* ------------------------------------------------------------------ */
/* Refusals                                                            */
/* ------------------------------------------------------------------ */

/**
 * Pack failures. The 409 and the `pack-mismatch` 422 are rendered VERBATIM:
 * `pack-mismatch` names every divergent SKU with both quantities (the only
 * place picked quantities exist in this whole client), and the 409 arms —
 * already packed, never waved, plan withdrawn, a still-planned pick line —
 * are decided against pick state no DTO the web client holds can show. The
 * 422 `idempotency-key-reuse` is NOT verbatim: its cause is fully visible
 * client-side (an edited draft replaying an old key), so it gets the fixed
 * house copy that names the parcel, like the dispatch mapper's.
 */
export function packReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.status === 409) return verbatim(error);
    if (error.status === 422 && error.code === 'pack-mismatch') return verbatim(error);
    switch (error.code) {
      case 'not-found':
        return 'This order no longer exists — refresh the list.';
      case 'role-denied':
        return 'Your role cannot pack orders.';
      case 'permission-denied':
        return 'That order belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This pack was already processed with a different parcel.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the scanned quantities and measurements and try again.';
      default:
        return error.detail ?? `Not packed (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * Dispatch failures. The 409 is verbatim: "not packed — it reads accepted"
 * is a race with a pack this client cannot see, and "already dispatched"
 * likewise. The 422 `idempotency-key-reuse` is the fixed house copy.
 */
export function dispatchReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.status === 409) return verbatim(error);
    switch (error.code) {
      case 'not-found':
        return 'This order no longer exists — refresh the list.';
      case 'role-denied':
        return 'Your role cannot dispatch orders.';
      case 'permission-denied':
        return 'That order belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This dispatch was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the carrier fields and try again.';
      default:
        return error.detail ?? `Not dispatched (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}
