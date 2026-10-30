'use client';

import { useRef, useState } from 'react';

import { fetchApiClientReturnPackageLabels, fetchApiVendorReturnPackageLabels } from '@/lib/api/client';
import { readSession } from '@/lib/auth';
import {
  cartonReason,
  lastPrintedPackageLabelCount,
  packageLabelsFilename,
  parsePackageLabelDraft,
  rememberPackageLabelCount,
  type LabelFormat,
  type PackageLabelDraft,
} from '@/lib/cartons';
import { downloadBlob } from '@/lib/csv';

const selectClass =
  'w-full appearance-none rounded-sm border border-(--input) bg-(--background) px-2 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-(--ring)';
const inputClass = 'w-24 rounded-sm border border-(--input) bg-(--background) px-2 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-(--ring)';
const buttonClass = 'rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-60';
const primaryClass = 'rounded-md bg-(--primary) px-2.5 py-1.5 text-xs font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60';

export type PackageLabelKind = 'rtv' | 'rtc';

type Layout = 'label' | 'a4';

/** The statuses a return prints package labels in (A22: picked or dispatched). */
export function canPrintPackageLabels(status: string): boolean {
  return status === 'picked' || status === 'dispatched';
}

/**
 * Story 4-5a (A22, A27, A43) — "Print package labels" for a return to vendor
 * or to client, the 2-10b dialog pattern: a count (prefilled from the
 * dispatched `packageCount`, else the count last printed here), an optional
 * from/to slice, the format (ZPL first, D7) and the layout (A4 is PDF only).
 * One file per print; the count printed is remembered per document so the
 * dispatch form can warn when it records another (A43). `labels.execute`
 * gates it at the caller; the server checks it first.
 */
export function PackageLabelsDialog({
  kind,
  documentId,
  documentCode,
  dispatchedCount,
  onClose,
}: {
  kind: PackageLabelKind;
  documentId: string;
  documentCode: string;
  /** The `packageCount` recorded at dispatch; null before dispatch (then a count is required). */
  dispatchedCount: number | null;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<PackageLabelDraft>(() => {
    const prefill = dispatchedCount ?? lastPrintedPackageLabelCount(documentId);
    return { count: prefill === null ? '' : String(prefill), from: '', to: '' };
  });
  const [format, setFormat] = useState<LabelFormat>('zpl');
  const [layout, setLayout] = useState<Layout>('label');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const inFlight = useRef(false);
  const effectiveLayout: Layout = format === 'zpl' ? 'label' : layout;

  function edit(patch: Partial<PackageLabelDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setProblem(null);
    setDone(null);
  }

  async function download() {
    if (inFlight.current) return;
    const session = readSession();
    if (session === null) {
      setProblem('Your session expired — sign in again.');
      return;
    }
    const parsed = parsePackageLabelDraft(draft);
    if (parsed.query === null) {
      setProblem(parsed.problem);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    setDone(null);
    try {
      const query = { format, layout: effectiveLayout, ...parsed.query };
      const blob =
        kind === 'rtv'
          ? await fetchApiVendorReturnPackageLabels(session.tenant.id, documentId, query)
          : await fetchApiClientReturnPackageLabels(session.tenant.id, documentId, query);
      const name = packageLabelsFilename(documentCode, format);
      downloadBlob(name, blob);
      rememberPackageLabelCount(documentId, parsed.query.count);
      setDone(`${name} downloaded`);
    } catch (error) {
      setProblem(cartonReason(error, 'package-labels'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={`Package labels for ${documentCode}`}
      className="flex flex-col gap-2 rounded-md border border-(--border) bg-(--card) p-3 text-xs"
      data-testid="package-labels-dialog"
    >
      <span className="font-medium">
        Package labels — <span className="font-mono">{documentCode}</span>
      </span>
      <span className="text-(--muted-foreground)">
        One 4 × 6 label per package: “PACKAGE n/N”, the consignee and a barcode {documentCode}.n.
        {dispatchedCount === null ? ' Enter how many packages you are sending.' : ' The count is the one recorded at dispatch.'}
      </span>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="font-medium">Packages</span>
          <input
            className={inputClass}
            inputMode="numeric"
            value={draft.count}
            onChange={(e) => edit({ count: e.target.value })}
            data-testid="package-labels-count"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="font-medium">From (optional)</span>
          <input className={inputClass} inputMode="numeric" value={draft.from} onChange={(e) => edit({ from: e.target.value })} data-testid="package-labels-from" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="font-medium">To (optional)</span>
          <input className={inputClass} inputMode="numeric" value={draft.to} onChange={(e) => edit({ to: e.target.value })} data-testid="package-labels-to" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="font-medium">Format</span>
          <select className={selectClass} value={format} onChange={(e) => setFormat(e.target.value as LabelFormat)} data-testid="package-labels-format">
            <option value="zpl">ZPL — Zebra thermal 4 × 6 (203 dpi)</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        {format === 'pdf' && (
          <label className="flex flex-col gap-0.5">
            <span className="font-medium">Layout</span>
            <select className={selectClass} value={layout} onChange={(e) => setLayout(e.target.value as Layout)} data-testid="package-labels-layout">
              <option value="label">4 × 6 label per page</option>
              <option value="a4">A4 sheet (two per page)</option>
            </select>
          </label>
        )}
      </div>
      {problem !== null && (
        <div role="alert" className="text-(--destructive)" data-testid="package-labels-problem">
          {problem}
        </div>
      )}
      {done !== null && (
        <div role="status" className="text-(--accent)">
          {done}
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" className={primaryClass} disabled={busy} onClick={() => void download()} data-testid="package-labels-download">
          {busy ? 'Preparing…' : 'Download labels'}
        </button>
        <button type="button" className={buttonClass} disabled={busy} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
