/**
 * Story 4-5a (A25, A38) — a carton label's code: the order's parcel tag
 * (`parcel-tag.ts`) + `.{pack seq}.{carton seq}`, e.g.
 * `O8FE5145B99902272.1.2`. Pack 1–99, carton 1–200, no leading zeros. The
 * prefix finds the order in a list the server provided (never resolved
 * server-side alone); the pack number makes a superseded pack's labels
 * detectably stale. Parsing trims and upper-cases first (a scanner's trailing
 * CR, a lower-case keyboard wedge).
 *
 * Pure. A byte-for-byte mirror of wms-be `src/shared/primitives/carton-code.ts`
 * (and wms-mobile `src/lib/carton-code.ts`), pinned by the shared vector file
 * `carton-code.vectors.json`, copied verbatim.
 */

import { CARTON_CODE_RE } from './awb';
import { parcelTagCode } from './parcel-tag';

/** The highest pack number (`order_packs_seq_range`). */
export const MAX_PACK_SEQ = 99;
/** The highest carton number (`order_cartons_seq_range`). */
export const MAX_CARTON_SEQ = 200;

export interface ParsedCartonCode {
  /** The order's 17-character parcel tag, upper-case. */
  readonly parcelTag: string;
  readonly packSeq: number;
  readonly seq: number;
}

/** The code printed on carton `seq` of pack `packSeq` of the order. */
export function cartonCode(orderId: string, packSeq: number, seq: number): string {
  return `${parcelTagCode(orderId)}.${packSeq}.${seq}`;
}

/** The parts of a carton code, or null when `code` is not one. */
export function parseCartonCode(code: string): ParsedCartonCode | null {
  const value = code.trim().toUpperCase();
  if (!CARTON_CODE_RE.test(value)) return null;
  const [parcelTag, pack, carton] = value.split('.') as [string, string, string];
  const packSeq = Number(pack);
  const seq = Number(carton);
  if (packSeq < 1 || packSeq > MAX_PACK_SEQ || seq < 1 || seq > MAX_CARTON_SEQ) return null;
  return { parcelTag, packSeq, seq };
}
