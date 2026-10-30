/**
 * Story 4-4a (A7) — the parcel tag's code: `'O'` + the order id's LAST 16
 * hex digits, upper-cased (17 characters). The code is a MATCH KEY against a
 * list the server provided (the web's handover candidates read) — never
 * resolved server-side alone; a list holding two matches makes the client
 * ask which. Pure. A byte-for-byte mirror of wms-be
 * `src/shared/primitives/parcel-tag.ts`, pinned by `parcel-tag.vectors.json`.
 */

import { PARCEL_TAG_CODE_RE } from './awb';

/** The 17-character code printed on the parcel tag. */
export function parcelTagCode(orderId: string): string {
  const hex = orderId.replace(/-/g, '').toUpperCase();
  return `O${hex.slice(-16)}`;
}

/** The order-id suffix (16 lower-case hex digits) a tag code names, or null when it is not a tag code. */
export function parcelTagOrderSuffix(code: string): string | null {
  const value = code.trim().toUpperCase();
  return PARCEL_TAG_CODE_RE.test(value) ? value.slice(1).toLowerCase() : null;
}

/** Does `code` name `orderId`? */
export function parcelTagMatches(code: string, orderId: string): boolean {
  const suffix = parcelTagOrderSuffix(code);
  return suffix !== null && orderId.replace(/-/g, '').toLowerCase().endsWith(suffix);
}
