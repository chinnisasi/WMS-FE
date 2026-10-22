/**
 * Story 2-10a — bin labels on the web: which rows can be printed, the file's
 * name, the request body and the refusal mapper.
 *
 * Pure: no React, no fetch — pinned by `bin-labels.test.ts`. The labels are
 * the backend's (`POST …/warehouses/{w}/bins/labels`, `labels.execute`); this
 * file only decides what to ask for and how to explain a refusal. Refusals
 * branch on `code` and list `extensions.binCodes` — never `detail`.
 */
import { ApiProblem } from '@/lib/api/client';
import type { BinLabelsRequestDto, BinResponse } from '@/lib/api/generated';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { istDateOf } from '@/lib/rate-cards';

export type LabelFormat = BinLabelsRequestDto['format'];
export type LabelSize = NonNullable<BinLabelsRequestDto['size']>;

/** One print takes at most this many labels (the server's `MAX_LABELS_PER_PRINT`). */
export const MAX_LABELS_PER_PRINT = 1000;

/**
 * The longest bin code each paper carries at a scannable (≥ 2-dot) bar —
 * the server's `maxCodeLengthFor`. A4 is the SMALLEST cell of the three.
 */
export const MAX_CODE_LENGTH: Readonly<Record<'4x2' | '2x1' | 'a4', number>> = { '4x2': 28, '2x1': 11, a4: 18 };

/** The dialog's paper choice: a thermal label size, or (PDF only) the A4 sheet. */
export type LabelPaper = LabelSize | 'a4';

/** Mirrors the backend's printable range: printable ASCII 0x20–0x7E, no leading or trailing space. */
export function isBarcodableCode(code: string): boolean {
  if (code.length === 0) return false;
  for (let i = 0; i < code.length; i += 1) {
    const c = code.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return !code.startsWith(' ') && !code.endsWith(' ');
}

/**
 * Why a bin row cannot be ticked for printing, or null when it can. Retired
 * and system bins get no label (no handheld scan accepts a system bin); a
 * code a barcode cannot carry is refused at print time (decision 10).
 */
export function binPrintBlock(bin: Pick<BinResponse, 'code' | 'retiredAt' | 'systemOwned'>): string | null {
  if (bin.retiredAt !== null) return 'Retired — a retired bin gets no label';
  if (bin.systemOwned) return 'System bin — no handheld scan accepts it, so it gets no label';
  if (!isBarcodableCode(bin.code)) {
    return 'Its code has a character a barcode cannot carry (printable ASCII only, no leading or trailing space)';
  }
  return null;
}

/**
 * Decision 12 — `bin-labels-<WH>-<YYYYMMDD>.<ext>`: the IST date of `instant`
 * and the warehouse code with every character outside `[A-Za-z0-9._-]` made
 * `-` — the same name the server puts in `Content-Disposition` (unreadable
 * cross-origin, so the web builds it).
 */
export function binLabelsFilename(warehouseCode: string, format: LabelFormat, instant: string | number): string {
  const wh = warehouseCode.replace(/[^A-Za-z0-9._-]/g, '-');
  return `bin-labels-${wh}-${istDateOf(instant).replace(/-/g, '')}.${format}`;
}

/** The request body: `size` only for a thermal label, `layout: 'a4'` only for a PDF sheet. */
export function binLabelsBody(
  target: { readonly binIds: readonly string[] } | { readonly zoneId: string },
  format: LabelFormat,
  paper: LabelPaper,
): BinLabelsRequestDto {
  const scope = 'zoneId' in target ? { zoneId: target.zoneId } : { binIds: [...target.binIds] };
  if (paper === 'a4') return { ...scope, format: 'pdf', layout: 'a4' };
  return { ...scope, format, layout: 'label', size: paper };
}

/** A refusal, in words, plus the bin codes it names (from `extensions.binCodes`). */
export interface BinLabelsRefusal {
  readonly reason: string;
  readonly binCodes: readonly string[];
}

function binCodesOf(problem: ApiProblem): string[] {
  const codes = problem.extensions.binCodes;
  return Array.isArray(codes) ? codes.filter((c): c is string => typeof c === 'string') : [];
}

export function binLabelsRefusal(error: unknown): BinLabelsRefusal {
  if (!(error instanceof ApiProblem)) return { reason: UNREACHABLE_REASON, binCodes: [] };
  const binCodes = binCodesOf(error);
  switch (error.code) {
    case 'bin-retired':
      return { reason: 'Retired bins get no label — untick these and print again:', binCodes };
    case 'bin-not-printable':
      return { reason: 'System bins get no label — untick these and print again:', binCodes };
    case 'bin-code-not-barcodable':
      return { reason: 'These bin codes have a character a barcode cannot carry (printable ASCII only):', binCodes };
    case 'bin-code-too-long-for-label':
      return {
        reason: `These bin codes are too long for this paper at a scannable bar width — a 4 × 2 in label carries ${MAX_CODE_LENGTH['4x2']} characters, a 2 × 1 in label ${MAX_CODE_LENGTH['2x1']}, an A4 sheet cell ${MAX_CODE_LENGTH.a4}:`,
        binCodes,
      };
    case 'too-many-labels': {
      const count = typeof error.extensions.count === 'number' ? error.extensions.count : null;
      return {
        reason: `${count === null ? 'This zone has' : `This zone has ${count}`} printable bins; one print takes at most ${MAX_LABELS_PER_PRINT} — tick the bins to print instead.`,
        binCodes: [],
      };
    }
    case 'no-bins-to-print':
      return { reason: 'This zone has no printable bins — it is empty, or every bin is retired or a system bin.', binCodes: [] };
    case 'not-found':
      return { reason: 'A bin or the zone is no longer in this warehouse — reload the list and try again.', binCodes: [] };
    case 'role-denied':
    case 'permission-denied':
      return { reason: 'Your role cannot print labels.', binCodes: [] };
    case 'validation-failed':
      return { reason: 'The print request was refused as malformed — reload the page and try again.', binCodes: [] };
    default:
      return { reason: `Labels could not be printed (${error.code}).`, binCodes: [] };
  }
}
