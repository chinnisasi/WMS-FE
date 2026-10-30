/**
 * Story 4-4a (A7, A41, D13, D18) — the AWB / LR number a client-arranged
 * shipment carries, as STORED: `normalizeAwb` trims, upper-cases and strips
 * every space and hyphen (a barcode scan and a printed `1234-5678` read
 * alike; `/` stays — LR numbers use it). Pure. A byte-for-byte mirror of
 * wms-be `src/shared/primitives/awb.ts` (and wms-mobile `src/lib/awb.ts`),
 * pinned by the shared vector file `awb.vectors.json`, copied verbatim.
 */

/** A stored AWB: 4–50 characters, letters, digits and `/`, starting with a letter or digit. */
export const AWB_RE = /^[A-Z0-9][A-Z0-9/]{3,49}$/;

/** The parcel tag's code shape (`parcel-tag.ts`) — never an AWB. */
export const PARCEL_TAG_CODE_RE = /^O[0-9A-F]{16}$/;

/**
 * Story 4-5a (A25, A38) — a carton label's code shape (`carton-code.ts`):
 * the parcel tag + `.{pack seq}.{carton seq}`, no leading zeros — never an
 * AWB (`AWB_RE` has no `.`).
 */
export const CARTON_CODE_RE = /^O[0-9A-F]{16}\.[1-9][0-9]?\.[1-9][0-9]{0,2}$/;

/** Trim, upper-case, strip spaces and hyphens. */
export function normalizeAwb(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]+/g, '');
}

/**
 * Why a NORMALISED value is not an AWB, in the words the surfaces show —
 * null when it is one.
 */
export function awbProblem(value: string): string | null {
  if (value === '') return 'Enter the AWB (the courier’s waybill or LR number).';
  if (PARCEL_TAG_CODE_RE.test(value)) return 'This is the parcel tag — scan the courier’s label.';
  if (CARTON_CODE_RE.test(value)) return 'This is a carton label — scan the courier’s label.';
  if (!AWB_RE.test(value)) {
    return 'An AWB is 4–50 letters, digits or “/”, starting with a letter or digit.';
  }
  return null;
}
