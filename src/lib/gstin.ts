import { isGstinStateCode } from '@/lib/gst-states';

/**
 * The GSTIN input (story 8-1c) — the one gate every web form that collects a
 * GSTIN runs (registration, warehouse create, order create).
 *
 * What it checks: the SHAPE, and (story 8-1d) that the two-digit prefix is a
 * GST registration state code — the same predicate the backend refuses on at
 * all three entries. The PAN segment and the checksum character are not
 * validated anywhere, client or server. Blank means "absent" and is omitted
 * from the body, never sent as `''`.
 */

/**
 * A byte-for-byte mirror of the backend's `GSTIN_RE`
 * (wms-be `src/shared/primitives/gstin.ts`): two digits (the state code) then
 * thirteen alphanumerics, case-insensitive. The backend's DTO transform
 * uppercases before matching, so uppercasing here is for consistency of what
 * the viewer sees echoed back — not load-bearing.
 */
export const GSTIN_RE = /^[0-9]{2}[A-Za-z0-9]{13}$/;

/** The help line under every GSTIN input: the columns are create-only. */
export const GSTIN_HELP = "Can't be changed after creation yet.";

export interface ParsedGstin {
  /** The canonical (trimmed, uppercased) GSTIN; absent when the field is blank. */
  readonly gstin?: string;
  /** Non-null when the value cannot be sent — nothing is requested. */
  readonly problem: string | null;
}

/**
 * The field text → the wire value. Trim and uppercase; a blank (or
 * whitespace-only) field is absent; a malformed one is a problem naming
 * `label` (e.g. "Business GSTIN").
 */
export function parseGstinField(text: string, label: string): ParsedGstin {
  const value = text.trim().toUpperCase();
  if (value === '') return { problem: null };
  if (!GSTIN_RE.test(value)) {
    return {
      problem: `${label} is 15 characters — two digits (the state code), then 13 letters or digits. Leave it blank if there is none.`,
    };
  }
  const prefix = value.slice(0, 2);
  if (!isGstinStateCode(prefix)) {
    // The code only — never its seed label (99's "Other Country" is wrong).
    return {
      problem: `${label} begins "${prefix}", which is not a GST registration state code — the first two digits are the state the GSTIN is registered in.`,
    };
  }
  return { gstin: value, problem: null };
}
