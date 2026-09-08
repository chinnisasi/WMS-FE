'use client';

import { useState, useSyncExternalStore } from 'react';

import {
  ApiProblem,
  fetchApiImportCatalog,
} from '@/lib/api/client';
import type { CatalogImportErrorResponse, CatalogImportResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { notifyCatalogChanged } from '@/lib/catalog';
import { ulid } from '@/lib/ulid';

import { FeedbackBanner } from '@/components/feedback/banner';

const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
const labelClass = 'text-sm font-medium';

/** Client-side pre-check mirrors the backend caps (spec 1.4). */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** The on-screen table shows a bounded window; the CSV report carries all rows. */
const MAX_RENDERED_ERRORS = 100;

/**
 * Catalog import wizard (story 1.4), a Settings sub-card. One pass: pick a
 * CSV/XLSX file, optionally run it as a fix round, submit — the backend
 * commits valid rows and returns per-row errors, which this card lists and
 * offers as a downloadable CSV error report (generated client-side, per
 * spec). Partial commit is honest: a 201 can carry failures, and the banner
 * says so instead of celebrating.
 */
export function ImportCatalogCard() {
  // `null` = unknown (server render) → render nothing, no hydration mismatch.
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );

  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <div className="rounded-md border border-(--border) p-3 text-sm">
        <div className="font-medium">Catalog import</div>
        <div className="text-(--muted-foreground)">Sign in to import your catalog.</div>
      </div>
    );
  }
  return <ImportCatalogCardSessioned />;
}

function ImportCatalogCardSessioned() {
  const [file, setFile] = useState<File | null>(null);
  const [fixMode, setFixMode] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<CatalogImportResponse | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const session = readSession();
    if (session === null || file === null) return;
    setPending(true);
    setRejection(null);
    setResult(null);
    try {
      const run = await fetchApiImportCatalog(
        session.tenant.id,
        file,
        fixMode ? 'fix' : undefined,
        ulid(),
      );
      setResult(run);
      // Both outcomes move the catalog (and the checklist's catalog step).
      notifyCatalogChanged();
    } catch (error) {
      setRejection(rejectionReason(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">Import catalog</h2>
        <div className="text-(--muted-foreground)">
          CSV or XLSX, at most 10,000 rows and 5 MB. Valid rows commit; invalid rows are listed
          below — never an all-or-nothing rejection. Columns (fixed header):
          sku_code, name, uom, uom_conversions, gst_rate, hsn, batch_tracked, serial_tracked,
          reorder_point, reorder_qty, barcode — sku_code, name, uom and gst_rate are required
          (gst_rate in basis points, 18% = 1800). UoM conversions look like{' '}
          <span className="font-mono">box:12;case:144</span>.
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Catalog file (.csv / .xlsx)</span>
          <input
            className={inputClass}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              setRejection(null);
            }}
            required
          />
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs">
          <input type="checkbox" checked={fixMode} onChange={(e) => setFixMode(e.target.checked)} />
          <span>
            Fix run — process only the rows whose SKU codes failed in the latest import; everything
            else in the file is skipped.
          </span>
        </label>
        <button
          type="submit"
          disabled={pending || file === null || file.size > MAX_FILE_BYTES}
          className="self-end rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Importing…' : 'Import'}
        </button>
      </div>

      {file !== null && file.size > MAX_FILE_BYTES && (
        <div className="text-xs text-(--destructive)">
          {file.name} is {(file.size / (1024 * 1024)).toFixed(1)} MB — the cap is 5 MB.
        </div>
      )}

      {rejection !== null && (
        <FeedbackBanner tone="rejected" word="Not imported" reason={rejection} />
      )}
      {result !== null && <ImportResult result={result} />}
    </form>
  );
}

/** The honest post-run view: counts, per-row error table, downloadable report. */
function ImportResult({ result }: { result: CatalogImportResponse }) {
  const allClean = result.failedRows === 0 && result.errors.length === 0;
  return (
    <div className="flex flex-col gap-2">
      <FeedbackBanner
        tone="accepted"
        word={
          allClean
            ? `${result.committedRows} committed`
            : `${result.committedRows} committed · ${result.failedRows} failed` +
              (result.skippedRows > 0 ? ` · ${result.skippedRows} skipped` : '')
        }
        reason={
          allClean
            ? 'The catalog is live.'
            : 'Valid rows are committed; fix the rows below and re-import them as a fix run.'
        }
      />
      {result.errors.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="overflow-x-auto rounded-md border border-(--border)">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-(--muted)">
                <tr>
                  <th scope="col" className="h-10 border-b border-(--border) px-3 text-left font-medium text-(--muted-foreground)">
                    Row
                  </th>
                  <th scope="col" className="h-10 border-b border-(--border) px-3 text-left font-medium text-(--muted-foreground)">
                    SKU code
                  </th>
                  <th scope="col" className="h-10 border-b border-(--border) px-3 text-left font-medium text-(--muted-foreground)">
                    Reason
                  </th>
                  <th scope="col" className="h-10 border-b border-(--border) px-3 text-left font-medium text-(--muted-foreground)">
                    Detail
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.errors.slice(0, MAX_RENDERED_ERRORS).map((error) => (
                  <ErrorRow key={`${error.rowNumber}-${error.skuCode ?? ''}`} error={error} />
                ))}
              </tbody>
            </table>
          </div>
          {result.errors.length > MAX_RENDERED_ERRORS && (
            <div className="text-xs text-(--muted-foreground)">
              Showing the first {MAX_RENDERED_ERRORS} of {result.errors.length} errors — the
              downloadable report carries the full list.
            </div>
          )}
          <button
            type="button"
            onClick={() => downloadErrorReport(result)}
            className="self-start rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted)"
          >
            Download error report (.csv)
          </button>
        </div>
      )}
    </div>
  );
}

function ErrorRow({ error }: { error: CatalogImportErrorResponse }) {
  return (
    <tr className="h-10 border-b border-(--border) last:border-b-0 hover:bg-(--muted)">
      <td className="px-3 data">{error.rowNumber}</td>
      <td className="px-3 font-mono text-xs">{error.skuCode ?? '—'}</td>
      <td className="px-3 font-mono text-xs">{error.code}</td>
      <td className="px-3 text-(--muted-foreground)">{error.detail}</td>
    </tr>
  );
}

/** The error report is generated client-side from the response (spec 1.4). */
function downloadErrorReport(result: CatalogImportResponse): void {
  const header = 'row_number,sku_code,code,detail';
  const lines = result.errors.map((error) =>
    [
      String(error.rowNumber),
      csvField(error.skuCode ?? ''),
      csvField(error.code),
      csvField(error.detail),
    ].join(','),
  );
  // UTF-8 BOM so Excel opens the report as UTF-8 instead of mojibake.
  const blob = new Blob([`\uFEFF${[header, ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `import-${result.importId}-errors.csv`;
  // Firefox needs the anchor in the document before click(); Safari can
  // reclaim the object URL before the click lands, so revoke on a timer
  // instead of inline.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function csvField(value: string): string {
  // Spreadsheet applications execute a leading =, +, - or @ as a formula —
  // neutralize it so row detail can never become an injection vector.
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${guarded.replaceAll('"', '""')}"`;
}

/**
 * Clients branch on the machine-readable problem `code`, never on prose —
 * same convention as the zone/bin forms, extended with the new import codes
 * (spec 1.4).
 */
function rejectionReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'import-too-large':
        return error.detail ?? 'Keep the file under 10,000 data rows and 5 MB.';
      case 'unsupported-file-type':
        return 'Only .csv and .xlsx files can be imported.';
      case 'file-unreadable':
        return error.detail ?? 'The file could not be read — check the header row uses the documented column names.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the file and try again.';
      default:
        return error.detail ?? `Import failed (${error.code}).`;
    }
  }
  return 'The API is unreachable — is wms-be running?';
}