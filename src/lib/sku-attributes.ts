/**
 * The SKU's static physical attributes (story 11-2) — the one place their
 * presentation is derived.
 *
 * The attributes are WYSIWYG integers: grams and millimetres, straight off
 * `SkuResponse` (the backend's `assertSkuAttributes` bounds are the only
 * authority; nothing here re-validates or rounds). A SKU without them is
 * unrateable by design — attributes are optional — so the label renders the
 * em-dash placeholder exactly like the other optional columns, and partial
 * attributes render the parts that exist rather than hiding the row's facts.
 */

/** The attribute fields `SkuResponse` carries (the nullable five). */
export interface SkuPhysicalAttributes {
  readonly weightGrams: number | null;
  readonly lengthMm: number | null;
  readonly widthMm: number | null;
  readonly heightMm: number | null;
  readonly countryOfOrigin: string | null;
}

/**
 * The table's weight·dims summary: `500 g · 200×150×100 mm · IN`.
 *
 * Dimensions read L×W×H only when all three are present — a `200×—×100`
 * composite would fabricate a package shape out of partial data; the present
 * axes are named individually instead (`L 200 mm`). Origin renders as the
 * bare ISO code. All absent → the em-dash placeholder.
 */
export function skuPhysicalLabel(sku: SkuPhysicalAttributes): string {
  const parts: string[] = [];
  if (sku.weightGrams !== null) parts.push(`${sku.weightGrams} g`);
  if (sku.lengthMm !== null && sku.widthMm !== null && sku.heightMm !== null) {
    parts.push(`${sku.lengthMm}×${sku.widthMm}×${sku.heightMm} mm`);
  } else {
    if (sku.lengthMm !== null) parts.push(`L ${sku.lengthMm} mm`);
    if (sku.widthMm !== null) parts.push(`W ${sku.widthMm} mm`);
    if (sku.heightMm !== null) parts.push(`H ${sku.heightMm} mm`);
  }
  if (sku.countryOfOrigin !== null) parts.push(sku.countryOfOrigin);
  return parts.length === 0 ? '—' : parts.join(' · ');
}
