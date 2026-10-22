'use client';

import { useRef, useState } from 'react';

import { fetchApiBinLabels } from '@/lib/api/client';
import { downloadBlob } from '@/lib/csv';
import {
  binLabelsBody,
  binLabelsFilename,
  binLabelsRefusal,
  type BinLabelsRefusal,
  type LabelFormat,
  type LabelPaper,
} from '@/lib/bin-labels';

/** What to print: the ticked bins, or every printable bin of a zone (all pages). */
export type BinLabelsTarget =
  | { readonly kind: 'bins'; readonly binIds: readonly string[] }
  | { readonly kind: 'zone'; readonly zoneId: string; readonly zoneCode: string };

const selectClass =
  'w-full appearance-none rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';

const PAPER_LABEL: Readonly<Record<LabelPaper, string>> = {
  '4x2': '4 × 2 in label',
  '2x1': '2 × 1 in label',
  a4: 'A4 sheet — 24 labels per page (70 × 36 mm)',
};

/**
 * Story 2-10a — the print panel for bin labels (the Settings card's inline
 * panel pattern, like the merge picker). Format first (ZPL for a Zebra
 * thermal printer, or PDF), then the size, or the A4 sheet for a PDF. The
 * file downloads under the decision-12 name, built here with the IST date —
 * the server's `Content-Disposition` is not readable cross-origin. A refusal
 * renders its words by `code` and lists `extensions.binCodes`.
 */
export function BinLabelsDialog({
  tenantId,
  warehouseId,
  warehouseCode,
  target,
  onClose,
  onPrinted,
}: {
  tenantId: string;
  warehouseId: string;
  warehouseCode: string;
  target: BinLabelsTarget;
  onClose: () => void;
  onPrinted: (summary: string) => void;
}) {
  const [format, setFormat] = useState<LabelFormat>('zpl');
  const [paper, setPaper] = useState<LabelPaper>('4x2');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<BinLabelsRefusal | null>(null);
  // A double click before the busy state renders must not fetch twice.
  const inFlight = useRef(false);

  const papers: readonly LabelPaper[] = format === 'pdf' ? ['4x2', '2x1', 'a4'] : ['4x2', '2x1'];
  const effectivePaper: LabelPaper = format === 'zpl' && paper === 'a4' ? '4x2' : paper;

  async function print() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setRefusal(null);
    try {
      const body = binLabelsBody(
        target.kind === 'zone' ? { zoneId: target.zoneId } : { binIds: target.binIds },
        format,
        effectivePaper,
      );
      const blob = await fetchApiBinLabels(tenantId, warehouseId, body);
      const filename = binLabelsFilename(warehouseCode, body.format, Date.now());
      downloadBlob(filename, blob);
      onPrinted(`${filename} downloaded`);
    } catch (error) {
      setRefusal(binLabelsRefusal(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Print bin labels"
      className="flex flex-col gap-3 rounded-sm border border-(--border) bg-(--muted) p-3"
    >
      <div className="text-xs text-(--muted-foreground)">
        {target.kind === 'zone' ? (
          <>
            Printing every printable bin in zone <span className="font-mono">{target.zoneCode}</span> — all
            pages of the list, not only the one shown. Retired and system bins are skipped.
          </>
        ) : (
          <>
            Printing {target.binIds.length} ticked {target.binIds.length === 1 ? 'bin' : 'bins'}.
          </>
        )}{' '}
        Labels come out in bin-code order. Each barcode is exactly the bin code the handheld scans.
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm font-medium">Format</span>
          <select
            className={selectClass}
            value={format}
            onChange={(e) => setFormat(e.target.value as LabelFormat)}
          >
            <option value="zpl">ZPL — Zebra thermal printer (203 dpi)</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm font-medium">{format === 'pdf' ? 'Size or sheet' : 'Label size'}</span>
          <select
            className={selectClass}
            value={effectivePaper}
            onChange={(e) => setPaper(e.target.value as LabelPaper)}
          >
            {papers.map((p) => (
              <option key={p} value={p}>
                {PAPER_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => print()}
          className="self-end rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60"
        >
          {busy ? 'Printing…' : 'Download labels'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="self-end rounded-sm border border-(--border) px-3 py-2 text-sm hover:bg-(--muted)"
        >
          Cancel
        </button>
      </div>
      {refusal !== null && (
        <div role="alert" className="flex flex-col gap-1 text-sm text-(--destructive)">
          <span>{refusal.reason}</span>
          {refusal.binCodes.length > 0 && (
            <ul className="flex flex-wrap gap-1 font-mono text-xs">
              {refusal.binCodes.map((code) => (
                <li key={code} className="rounded-sm border border-(--destructive) px-1.5 py-0.5">
                  {code}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
