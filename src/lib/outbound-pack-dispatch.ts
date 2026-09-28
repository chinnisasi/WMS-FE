import { ApiProblem } from '@/lib/api/client';
import type {
  CarrierConnectionResponse,
  DispatchDto,
  DispatchedLineDto,
  LabelOrderDto,
  ManifestDto,
  OrderLineDto,
  PackDto,
  PackedLineDto,
  ShipmentDto,
} from '@/lib/api/generated';
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

/* ------------------------------------------------------------------ */
/* Labels and manifests (story 4.6c)                                   */
/* ------------------------------------------------------------------ */

/**
 * The decisions that live here for the label and manifest step (4.6c):
 *   5. The label failure arms render VERBATIM — the 501
 *      `carrier-transport-unconfigured` (a DIRECT carrier with no transport
 *      on this deployment) and the 503 `carrier-encryption-unavailable` are
 *      REFUSALS, not errors: nothing was written, the order stays
 *      `ready_to_dispatch`, and the retry is a fresh submit. The 409 state
 *      refusals are verbatim for the same reason the pack/dispatch ones are
 *      (the state they name is server truth).
 *   6. A manifest is terminal — there is no un-manifest — and the closure is
 *      an all-or-nothing set: the form refuses an empty selection
 *      client-side, and every offender 409 names is server truth.
 */

/** Labelling is offered for exactly one state — the label precondition's status arm. */
export function canLabelOrder(status: OrderStatus): boolean {
  return status === 'ready_to_dispatch';
}

/**
 * The label form's draft → request body. The connection id is required (the
 * picker's empty value is a client-side refusal, never a 400); the optional
 * measurements ride the SAME rule as the pack bench's — whole grams, all
 * three sides together or none — so the label form reuses `parsePackDraft`'s
 * measurement arm verbatim by sending it an empty scan set and taking the
 * body's measurement arms back.
 */
export interface ParsedLabelDraft {
  readonly body: LabelOrderDto | null;
  readonly problem: string | null;
}

export function parseLabelDraft(
  carrierConnectionId: string,
  measurements: PackMeasurements,
): ParsedLabelDraft {
  if (carrierConnectionId.trim() === '') {
    return { body: null, problem: 'Pick the carrier connection this label generates through.' };
  }
  // The measurement rule IS the pack bench's rule, verbatim — an empty scan
  // list contributes no entries and leaves only the measurement arms. The
  // parser's `scanned` arm is the pack body's shape, not the label's — the
  // measurements are taken back alone.
  const parsed = parsePackDraft([], measurements);
  if (parsed.problem !== null) {
    return { body: null, problem: parsed.problem };
  }
  const measurementsOnly =
    parsed.body === null
      ? {}
      : {
          ...(parsed.body.weightGrams === undefined ? {} : { weightGrams: parsed.body.weightGrams }),
          ...(parsed.body.dimensionsMm === undefined ? {} : { dimensionsMm: parsed.body.dimensionsMm }),
        };
  return {
    body: {
      carrierConnectionId,
      ...measurementsOnly,
    },
    problem: null,
  };
}

/** One connection picker's option: the display name and the account label. */
export function connectionOptionLabel(connection: CarrierConnectionResponse): string {
  return `${connection.carrierName} — ${connection.accountLabel}`;
}

/**
 * The label result, built from the RESPONSE's own shipment: the carrier, the
 * adapter-issued tracking and the measurements, and the fact the order
 * itself did not move — the label is a station act beside the state machine.
 */
export function labelOutcome(shipment: ShipmentDto): Outcome {
  return {
    tone: 'accepted',
    word: 'Label generated',
    reason: `${shipment.carrierName} · tracking ${shipment.trackingNumber} · ${parcelMeasurementLabel(
      shipment,
    )}. The order stays ready to dispatch.`,
  };
}

/**
 * One shipment record's carrier arms, as the panel states them: the carrier,
 * the tracking, and the manifest it closed onto — honestly terminal.
 */
export function shipmentRecordLabel(shipment: ShipmentDto): string {
  const parts = [`Carrier ${shipment.carrierName}`, `Tracking ${shipment.trackingNumber}`];
  return shipment.manifestId === null ? parts.join(' · ') : `${parts.join(' · ')} · manifested`;
}

/** The manifest confirm's terminal warning — a closed shipment never returns. */
export const MANIFEST_TERMINAL_WARNING =
  'Manifesting is terminal — a shipment never returns to labelled after it closes onto a manifest.';

/**
 * The manifest form's selection → request body. An empty selection is a
 * client-side refusal; the order of the selection and its duplicates are the
 * server's concern to normalize (the set is the intent), so the ids go as
 * given.
 */
export interface ParsedManifestDraft {
  /** Mutable: this object is passed straight to the SDK as `CreateManifestDto`. */
  readonly body: { readonly shipmentIds: string[] } | null;
  readonly problem: string | null;
}

export function parseManifestDraft(shipmentIds: readonly string[]): ParsedManifestDraft {
  if (shipmentIds.length === 0) {
    return { body: null, problem: 'Pick at least one labelled shipment to manifest.' };
  }
  return { body: { shipmentIds: [...shipmentIds] }, problem: null };
}

/**
 * The manifest result, built from the RESPONSE's own record: how many
 * shipments the hand-over document closed, and onto which carrier.
 */
export function manifestOutcome(manifest: ManifestDto): Outcome {
  const count = manifest.shipmentCount;
  return {
    tone: 'accepted',
    word: 'Manifest created',
    reason: `${count} ${count === 1 ? 'shipment' : 'shipments'} closed onto ${manifest.carrierCode}. There is no un-manifest.`,
  };
}

/**
 * Label failures. The 409 and BOTH retryable-failure arms (the 501
 * `carrier-transport-unconfigured` naming the carrier, the 503
 * `carrier-encryption-unavailable`) render VERBATIM — they are refusals
 * whose cause is server truth, and rendering them in the server's own words
 * is the UX-DR19 retryable-inline contract. The 422 `idempotency-key-reuse`
 * is the fixed house copy.
 */
export function labelReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.status === 409 || error.status === 501 || error.status === 503) {
      return verbatim(error);
    }
    switch (error.code) {
      case 'not-found':
        return 'This order or carrier connection no longer exists — refresh the page.';
      case 'role-denied':
        return 'Your role cannot generate labels.';
      case 'permission-denied':
        return 'That carrier connection belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This label was already processed with a different request.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the connection and measurements and try again.';
      default:
        return error.detail ?? `Label not generated (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * Manifest failures. The 409 arms name the offender server-side (missing,
 * foreign, wrong state, two connections) — verbatim. The 422
 * `idempotency-key-reuse` is the fixed house copy.
 */
export function manifestReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.status === 409) return verbatim(error);
    switch (error.code) {
      case 'not-found':
        return 'The warehouse no longer exists — refresh the page.';
      case 'role-denied':
        return 'Your role cannot manifest shipments.';
      case 'permission-denied':
        return 'That warehouse belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This manifest was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the selected shipments and try again.';
      default:
        return error.detail ?? `Manifest not created (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/* ------------------------------------------------------------------ */
/* The rates strip (story 4.6d)                                        */
/* ------------------------------------------------------------------ */

/**
 * INR money from integer paise (AD-9) — the rate quote's only money shape.
 * Indian digit grouping is rendered by hand (the last three digits are the
 * first group and every group before it holds two: `1,23,456` — never
 * `123,456`) so the surface never depends on the runtime's ICU build; the
 * paise fraction is always shown (₹25.00, not ₹25) because a quote is an
 * exact paise figure, not an approximation.
 */
export function formatInrPaise(amountPaise: number): string {
  const negative = amountPaise < 0;
  const abs = Math.abs(Math.trunc(amountPaise));
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  const digits = String(rupees);
  const grouped =
    digits.length <= 3
      ? digits
      : `${digits.slice(0, digits.length - 3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${digits.slice(-3)}`;
  return `${negative ? '−' : ''}₹${grouped}.${String(paise).padStart(2, '0')}`;
}

/**
 * The rates read's failures (story 4.6d). The 409 arms — `missing-sku-weight`
 * naming the SKUs, `conflict` naming the order's state — and the whole-read
 * 503s (an unreadable credential is a deployment fault, not a quote) render
 * VERBATIM: they are the server's own words about this order, and the retry
 * (after the operator fixes the catalog) is a fresh read. The 404 never
 * reaches this mapper — the hook renders it as "no rates" (a null), never a
 * failed read.
 */
export function ratesReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.status === 409 || error.status === 501 || error.status === 503) {
      return verbatim(error);
    }
    switch (error.code) {
      case 'not-found':
        return 'This order no longer exists — refresh the page.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the order and retry.';
      default:
        return error.detail ?? `Rates unavailable (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}
