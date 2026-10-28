/**
 * Story 2-10b — LPN (licence plate) labels on the web: the default split, the
 * mint and print bodies, the file's name, the chunking and the refusal mapper.
 *
 * Pure: no React, no fetch — pinned by `lpn-labels.test.ts`. The LPNs are the
 * backend's (`POST …/goods-receipts/{grnId}/lpns`, `labels.execute`); this
 * file only decides what to ask for and how to explain a refusal. Refusals
 * branch on `code` and list `extensions.lpnCodes` — never `detail`, except
 * where the server's sentence is the only place the number lives.
 */
import { ApiProblem } from '@/lib/api/client';
import type { LpnDto, LpnLabelsRequestDto, LpnLineUnlabelledDto, MintLpnsRequestDto, SkuResponse, VoidLpnRequestDto } from '@/lib/api/generated';
import { MAX_LABELS_PER_PRINT, type LabelFormat, type LabelPaper } from '@/lib/bin-labels';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { istDateOf } from '@/lib/rate-cards';

export { MAX_LABELS_PER_PRINT };

/** One mint creates at most this many labels (the server's `MAX_LPN_MINT_QUANTITIES`). */
export const MAX_LABELS_PER_MINT = 1000;

/** The void reasons (the server's `LPN_VOID_REASON_CODES`), with their words. */
export const LPN_VOID_REASONS: readonly { readonly code: VoidLpnRequestDto['reasonCode']; readonly label: string }[] = [
  { code: 'misprint', label: 'Misprint' },
  { code: 'wrong-quantity', label: 'Wrong quantity' },
  { code: 'label-damaged', label: 'Label damaged' },
  { code: 'other', label: 'Other (say why)' },
];

const SCALE = 1000;

/**
 * Story 2-10b (decision 2) — split `unlabelled` units into labels of
 * `perLabel` units each plus one remainder label, computed in integer
 * thousandths (so `12.5 / 2.5` is exact and `10 / 3` cannot drift). Empty
 * when there is nothing to label, the per-label figure is not positive, or
 * either figure is finer than the SKU's precision allows.
 */
export function splitLabelQuantities(unlabelled: number, perLabel: number, precision: number): number[] {
  if (!Number.isFinite(unlabelled) || !Number.isFinite(perLabel)) return [];
  const step = 10 ** (3 - Math.max(0, Math.min(3, precision)));
  const total = Math.round(unlabelled * SCALE);
  const per = Math.round(perLabel * SCALE);
  if (total <= 0 || per <= 0) return [];
  if (Math.abs(perLabel * SCALE - per) > 1e-6 || per % step !== 0 || total % step !== 0) return [];
  const full = Math.floor(total / per);
  const remainder = total - full * per;
  const out: number[] = Array.from({ length: full }, () => per / SCALE);
  if (remainder > 0) out.push(remainder / SCALE);
  return out;
}

/**
 * A6 — "units per label" defaults to the SKU's `pallet` pack level, else
 * `carton`, else `case`, else the whole unlabelled quantity (one label).
 */
export function defaultUnitsPerLabel(sku: Pick<SkuResponse, 'uomConversions'> | null, unlabelled: number): number {
  for (const level of ['pallet', 'carton', 'case'] as const) {
    const found = sku?.uomConversions?.find((conversion) => conversion.uom === level);
    if (found !== undefined && found.factor > 0) return found.factor;
  }
  return unlabelled;
}

/** The labelled total of a line: Σ its non-voided LPNs (in thousandths, so a sum never drifts). */
export function labelledQuantity(lpns: readonly Pick<LpnDto, 'qty' | 'status'>[]): number {
  return lpns.filter((lpn) => lpn.status !== 'voided').reduce((sum, lpn) => sum + Math.round(lpn.qty * SCALE), 0) / SCALE;
}

/**
 * What may still go on labels for a line — the server's own figure (the list
 * read's `lines[].unlabelledQty`: applied + approved excess − failed
 * inspection − placed − active labels), 0 when the read does not name the line.
 */
export function unlabelledOf(lines: readonly Pick<LpnLineUnlabelledDto, 'grnLineId' | 'unlabelledQty'>[], grnLineId: string): number {
  return lines.find((line) => line.grnLineId === grnLineId)?.unlabelledQty ?? 0;
}

/** "3 labels: 40, 40, 20" — or, for a long split, "120 labels: 119 × 40 and 1 × 20". */
export function splitPreview(quantities: readonly number[]): string {
  if (quantities.length === 0) return 'No labels';
  const noun = quantities.length === 1 ? 'label' : 'labels';
  if (quantities.length <= 6) return `${quantities.length} ${noun}: ${quantities.join(', ')}`;
  const first = quantities[0]!;
  const last = quantities[quantities.length - 1]!;
  const full = last === first ? quantities.length : quantities.length - 1;
  return `${quantities.length} ${noun}: ${full} × ${first}${last === first ? '' : ` and 1 × ${last}`}`;
}

/** The mint body for one line. */
export function mintBody(grnLineId: string, quantities: readonly number[]): MintLpnsRequestDto {
  return { lines: [{ grnLineId, quantities: [...quantities] }] };
}

/** The void body: the reason, and the trimmed note only when there is one. */
export function voidBody(reasonCode: VoidLpnRequestDto['reasonCode'], note: string): VoidLpnRequestDto {
  const trimmed = note.trim();
  return trimmed === '' ? { reasonCode } : { reasonCode, note: trimmed };
}

/** The print body: `size` only for a thermal label, `layout: 'a4'` only for a PDF sheet. */
export function lpnLabelsBody(target: { readonly lpnIds: readonly string[] } | { readonly grnLineId: string }, format: LabelFormat, paper: LabelPaper): LpnLabelsRequestDto {
  const scope = 'grnLineId' in target ? { grnLineId: target.grnLineId } : { lpnIds: [...target.lpnIds] };
  if (paper === 'a4') return { ...scope, format: 'pdf', layout: 'a4' };
  return { ...scope, format, layout: 'label', size: paper };
}

/** A5 — ids in chunks of at most 1000, in the order given (code order). */
export function chunkIds(ids: readonly string[], size = MAX_LABELS_PER_PRINT): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * `lpn-labels-<GRN>-<YYYYMMDD>.<ext>` — the IST date and the GRN code with
 * every character outside `[A-Za-z0-9._-]` made `-` (the server's
 * `Content-Disposition` name, unreadable cross-origin). A chunked download
 * (A5) names each part `…-part<n>of<m>.<ext>`.
 */
export function lpnLabelsFilename(grnCode: string, format: LabelFormat, instant: string | number, part?: { readonly n: number; readonly of: number }): string {
  const grn = grnCode.replace(/[^A-Za-z0-9._-]/g, '-');
  const suffix = part === undefined || part.of <= 1 ? '' : `-part${part.n}of${part.of}`;
  return `lpn-labels-${grn}-${istDateOf(instant).replace(/-/g, '')}${suffix}.${format}`;
}

/** A line's LPN count for every member (A12): "3 LPNs", counting the non-voided ones. */
export function lpnCountLabel(lpns: readonly Pick<LpnDto, 'status'>[]): string | null {
  const live = lpns.filter((lpn) => lpn.status !== 'voided').length;
  if (live === 0) return null;
  return `${live} ${live === 1 ? 'LPN' : 'LPNs'}`;
}

/** The status words of an LPN row. */
export function lpnStatusLabel(status: LpnDto['status']): string {
  switch (status) {
    case 'active':
      return 'Labelled';
    case 'placed':
      return 'Put away';
    case 'voided':
      return 'Voided';
    default:
      return status;
  }
}

/** A refusal, in words, plus the LPN codes it names (from `extensions.lpnCodes`). */
export interface LpnRefusal {
  readonly reason: string;
  readonly lpnCodes: readonly string[];
}

function lpnCodesOf(problem: ApiProblem): string[] {
  const codes = problem.extensions.lpnCodes;
  return Array.isArray(codes) ? codes.filter((c): c is string => typeof c === 'string') : [];
}

function numberOf(problem: ApiProblem, key: string): number | null {
  const value = problem.extensions[key];
  return typeof value === 'number' ? value : null;
}

/** Every LPN refusal — mint, void and print — by `code`. */
export function lpnRefusal(error: unknown): LpnRefusal {
  if (!(error instanceof ApiProblem)) return { reason: UNREACHABLE_REASON, lpnCodes: [] };
  const lpnCodes = lpnCodesOf(error);
  switch (error.code) {
    case 'lpn-quantity-exceeds-line': {
      const remaining = numberOf(error, 'remaining');
      return {
        reason:
          remaining === null
            ? 'More than this line holds — void a label to free its quantity.'
            : remaining === 0
              ? 'Every unit of this line is already on a label — void one to free its quantity.'
              : `Only ${remaining} more can go on labels for this line — void a label to free more.`,
        lpnCodes: [],
      };
    }
    case 'too-many-labels': {
      const count = numberOf(error, 'count');
      return {
        reason: `Too many labels${count === null ? '' : ` (${count})`} — a line holds at most 5000 and one print or creation takes at most ${MAX_LABELS_PER_PRINT}.`,
        lpnCodes: [],
      };
    }
    case 'lpn-voided':
      return { reason: 'Voided LPNs never print — untick these and download again:', lpnCodes };
    case 'lpn-code-too-long-for-label':
      return { reason: 'These LPN codes are too long for this paper at a scannable bar width — pick a larger label:', lpnCodes };
    case 'lpn-not-active':
      return {
        reason: error.extensions.lpnStatus === 'placed' ? 'This LPN was already put away — it cannot be voided.' : 'This LPN is already voided.',
        lpnCodes: typeof error.extensions.lpnCode === 'string' ? [error.extensions.lpnCode] : [],
      };
    case 'no-lpns-to-print':
      return { reason: 'There is no LPN to print — create labels first.', lpnCodes: [] };
    case 'not-found':
      return { reason: 'The receipt, the line or an LPN is no longer there — reload and try again.', lpnCodes: [] };
    case 'role-denied':
    case 'permission-denied':
      return { reason: 'Your role cannot create, print or void labels.', lpnCodes: [] };
    case 'idempotency-key-reuse':
      return { reason: 'This request changed while a retry was pending — try again.', lpnCodes: [] };
    case 'conflict':
      return { reason: 'Another request for these labels was in flight — try again.', lpnCodes: [] };
    case 'validation-failed':
      return { reason: error.detail ?? 'The request was refused as malformed — check the quantities and try again.', lpnCodes: [] };
    default:
      return { reason: error.detail ?? `The labels could not be processed (${error.code}).`, lpnCodes: [] };
  }
}

/**
 * The words when the mint succeeded but the download after it did not: the
 * labels EXIST — say which, and point at the reprint, so nobody creates them
 * twice.
 */
export function mintedButNotDownloaded(codes: readonly string[], downloadReason: string): string {
  const range = codes.length === 0 ? 'The labels' : codes.length === 1 ? codes[0]! : `${codes[0]}–${codes[codes.length - 1]}`;
  return `${range} ${codes.length === 1 ? 'was' : 'were'} created, but the download failed (${downloadReason}) — tick ${codes.length === 1 ? 'it' : 'them'} in the list and download again; do not create them again.`;
}
