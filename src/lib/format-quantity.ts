/**
 * The one quantity-formatting statement (story 10.5).
 *
 * Every quantity on screen is a number in the SKU's base UoM at the precision
 * that unit DECLARES (each = 0 places, kg = 3) — the server already holds it
 * at that precision, so `toFixed(precision)` at render absorbs float dust
 * rather than rounding anything the operator typed. The unit's precision comes
 * from the SKU payload (`SkuResponse.uomPrecision`); nothing here infers
 * precision from the unit string, and nothing here rounds an input the server
 * already holds at the precision it names — a caller passing a value finer
 * than the precision it gives is misusing the helper (none exists).
 */

/**
 * The (unit, precision) pair a quantity label formats against, as the SKU
 * payload carries it. `null` means the SKU could not be resolved for this
 * row — the label then falls back to the raw number rather than guessing a
 * precision it does not know.
 */
export interface QuantityUom {
  readonly uom: string;
  readonly uomPrecision: number;
}

/**
 * `qty` at `precision` decimal places, with the integer part grouped
 * (2.5/3 → '2.500', 3000/0 → '3,000', 1234.5/3 → '1,234.500').
 *
 * A 0-precision unit never grows a `.000` suffix, and the grouping applies to
 * the integer part only — the fraction stays a plain digit run. The clamp
 * keeps a malformed precision from throwing (`toFixed` throws past 100);
 * 20 is far above anything the vocabulary declares and the server only ever
 * sends 0-3.
 */
export function formatQuantity(qty: number, precision: number): string {
  const places = Math.min(Math.max(Math.trunc(precision), 0), 20);
  const fixed = qty.toFixed(places);
  const dot = fixed.indexOf('.');
  const intPart = dot === -1 ? fixed : fixed.slice(0, dot);
  const fracPart = dot === -1 ? '' : fixed.slice(dot);
  return fracPart === '' ? Number(intPart).toLocaleString('en-US') : `${Number(intPart).toLocaleString('en-US')}${fracPart}`;
}

/**
 * The one-line hint a quantity input carries for its SKU's unit: whole-unit
 * vocabulary stays whole, measured units name how many decimal places the
 * operator may type. Precision refusals are the SERVER's copy (naming unit
 * and precision byte-identically across HTTP and CSV) — this sentence only
 * describes the input, never pre-refuses a value.
 */
export function quantityInputLabel(precision: number): string {
  return precision === 0
    ? 'Whole units — this unit counts in whole numbers.'
    : `Decimals to ${precision} place${precision === 1 ? '' : 's'}.`;
}

/**
 * One quantity label: `value` at the (unit, precision) the SKU payload
 * carries, unit named; or, when the SKU does not resolve (or the set's units
 * mix), the ONE unit-agnostic fallback — "`N` units" — everywhere. A bare
 * number without "units" would read as a count, and a guessed unit or
 * precision would fabricate a fact; the fallback does neither.
 */
export function quantityLabel(value: number, uom: QuantityUom | null): string {
  return uom === null ? `${value} units` : `${formatQuantity(value, uom.uomPrecision)} ${uom.uom}`;
}

/**
 * The single (unit, precision) a set of lines shares, or `null` when the set
 * is empty, a SKU is unresolvable, or the lines mix units — an aggregate
 * across mixed units has no precision to render at and keeps the raw-number
 * fallback copy.
 */
export function sharedQuantityUom<Line extends { readonly skuId: string }>(
  lines: readonly Line[],
  skuOf: (skuId: string) => QuantityUom | undefined,
): QuantityUom | null {
  let shared: QuantityUom | null = null;
  for (const line of lines) {
    const sku = skuOf(line.skuId);
    if (sku === undefined) return null;
    if (shared === null) {
      shared = { uom: sku.uom, uomPrecision: sku.uomPrecision };
    } else if (shared.uom !== sku.uom || shared.uomPrecision !== sku.uomPrecision) {
      return null;
    }
  }
  return shared;
}

/**
 * The decimal-literal shape a quantity INPUT may carry, as a validator: the
 * same string-shape rule `parseDraftLines` applies to order lines, applied to
 * the string the number field emitted. It exists because bare `Number()`
 * accepts `1e3`, `0x10` and `Infinity`, none of which a `type="number"` field
 * can produce and all of which are silent quantity changes. Returns the
 * number, or `null` when the shape (or sign) is wrong — the caller renders
 * its own refusal and sends nothing.
 */
export function parseQuantityInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null;
  return Number(trimmed);
}