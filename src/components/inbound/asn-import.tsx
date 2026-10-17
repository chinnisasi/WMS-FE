'use client';

import { useRef, useState } from 'react';

import { fetchApiImportAsns } from '@/lib/api/client';
import type { AsnImportResponseDto } from '@/lib/api/generated';
import {
  MAX_ASN_IMPORT_ASNS,
  MAX_ASN_IMPORT_BYTES,
  MAX_ASN_IMPORT_ROWS,
  MAX_RENDERED_IMPORT_ERRORS,
  asnImportErrorReport,
  asnImportOutcome,
  asnImportReason,
  asnImportReasonLabel,
  asnImportReportName,
  asnImportTemplate,
  fileReadProblem,
} from '@/lib/asn-import';
import { readSession } from '@/lib/auth';
import { downloadText } from '@/lib/csv';
import { ulid } from '@/lib/ulid';

import { FeedbackBanner } from '@/components/feedback/banner';
import { lineButtonClass as buttonClass, lineInputClass as inputClass } from '@/components/shared/line-rows';

const primaryClass =
  'rounded-sm bg-(--primary) px-3 py-1 text-xs font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60';
const headClass = 'h-9 border-b border-(--border) px-3 text-left font-medium text-(--muted-foreground)';

/**
 * The ASN import (2026-10-17) — "Import from file" on the ASN card, for
 * `asn.manage` only (the card mounts it; it renders no gate of its own). Two
 * steps over one route: **Check file** (`dryRun`, no key) shows what would
 * be created and every refused row, writing nothing; **Import** creates every
 * valid ASN of the checked file, exactly as the Announce form would.
 *
 * The Idempotency-Key lives as long as the CHECKED FILE: minted when a file
 * is checked, reused by every Import of it (a retry after a timeout replays
 * the stored answer instead of reporting every ASN as a used code), and
 * dropped the moment another file is picked. The component is mounted keyed
 * by warehouse, so a switch starts over.
 */
export function AsnImport({
  warehouseId,
  warehouseCode,
  onImported,
  onClose,
}: {
  warehouseId: string;
  warehouseCode: string | null;
  onImported: (result: AsnImportResponseDto) => void;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  // The result belongs to ONE picked file (keyed derivation: picking another
  // file invalidates it in the same render).
  const [checked, setChecked] = useState<{ file: File; result: AsnImportResponseDto } | null>(null);
  const [imported, setImported] = useState<{ file: File; result: AsnImportResponseDto } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<'check' | 'import' | null>(null);
  const keyRef = useRef<{ file: File; key: string } | null>(null);
  const inFlight = useRef(false);

  const checkResult = checked !== null && checked.file === file ? checked.result : null;
  const importResult = imported !== null && imported.file === file ? imported.result : null;
  const result = importResult ?? checkResult;
  const tooLarge = file !== null && file.size > MAX_ASN_IMPORT_BYTES;

  function pick(next: File | null) {
    setFile(next);
    setProblem(null);
    // A different file is a different intent: its Import gets a new key.
    if (keyRef.current !== null && keyRef.current.file !== next) keyRef.current = null;
  }

  async function run(step: 'check' | 'import') {
    const session = readSession();
    if (session === null || file === null || inFlight.current) return;
    inFlight.current = true;
    setBusy(step);
    setProblem(null);
    try {
      // Read it first: a file moved or changed since it was picked fails
      // here with its own words, not as "the API is unreachable".
      try {
        await file.arrayBuffer();
      } catch {
        setProblem(fileReadProblem(file.name));
        return;
      }
      if (step === 'check') {
        const response = await fetchApiImportAsns(session.tenant.id, file, warehouseId, { dryRun: true });
        setChecked({ file, result: response });
        if (keyRef.current === null || keyRef.current.file !== file) keyRef.current = { file, key: ulid() };
      } else {
        if (keyRef.current === null || keyRef.current.file !== file) keyRef.current = { file, key: ulid() };
        const response = await fetchApiImportAsns(session.tenant.id, file, warehouseId, {
          dryRun: false,
          idempotencyKey: keyRef.current.key,
        });
        setImported({ file, result: response });
        onImported(response);
      }
    } catch (error) {
      setProblem(asnImportReason(error));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  const outcome = result === null ? null : asnImportOutcome(result);
  const canImport = checkResult !== null && checkResult.acceptedCount > 0 && importResult === null;

  return (
    <section aria-label="Import ASNs from a file" className="flex flex-col gap-2 rounded-sm border border-(--border) p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 className="font-medium">Import from file</h3>
          <div className="text-xs text-(--muted-foreground)">
            CSV or Excel (.xlsx), one row per ASN line — columns asn_code, sku and quantity, and optionally client
            (blank = the client the SKUs belong to), warehouse (blank or this warehouse) and expected_at
            (YYYY-MM-DD or YYYY-MM-DD HH:mm, read as IST; or ISO-8601 with an offset, like 2026-10-20T14:30+05:30 — a
            time without an offset, like 2026-10-20T14:30, is refused). asn_code and sku are case-sensitive; client and
            warehouse are not. Other columns are ignored. At most{' '}
            {MAX_ASN_IMPORT_ROWS.toLocaleString('en-IN')} rows, {MAX_ASN_IMPORT_ASNS} ASNs and 5 MB. An ASN with any bad
            row is refused whole; the others are created.
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={buttonClass}
            onClick={() => downloadText('asn-import-template.csv', asnImportTemplate(warehouseCode))}
          >
            Download template
          </button>
          <button type="button" className={buttonClass} onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-60 flex-1 flex-col gap-1 text-xs">
          <span className="font-medium">ASN file (.csv / .xlsx)</span>
          <input
            className={inputClass}
            type="file"
            aria-label="ASN file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => {
              pick(event.target.files?.[0] ?? null);
              // Cleared, so picking the same (fixed) file again fires a change.
              event.target.value = '';
            }}
          />
          {file !== null && <span className="text-(--muted-foreground)">Selected: {file.name}</span>}
        </label>
        <button
          type="button"
          className={buttonClass}
          disabled={file === null || tooLarge || busy !== null}
          onClick={() => void run('check')}
        >
          {busy === 'check' ? 'Checking…' : 'Check file'}
        </button>
        <button type="button" className={primaryClass} disabled={!canImport || busy !== null} onClick={() => void run('import')}>
          {busy === 'import' ? 'Importing…' : 'Import'}
        </button>
      </div>

      {tooLarge && file !== null && (
        <div className="text-xs text-(--destructive)">
          {file.name} is {(file.size / (1024 * 1024)).toFixed(1)} MB — the cap is 5 MB.
        </div>
      )}
      {problem !== null && <FeedbackBanner tone="rejected" word="Not imported" reason={problem} />}
      {result !== null && outcome !== null && (
        <AsnImportResult result={result} outcome={outcome} />
      )}
    </section>
  );
}

/** The result: the ASNs created (or ready), and every refused row with its report. */
export function AsnImportResult({
  result,
  outcome,
}: {
  result: AsnImportResponseDto;
  outcome: ReturnType<typeof asnImportOutcome>;
}) {
  return (
    <div className="flex flex-col gap-2" data-testid="asn-import-result">
      <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />
      {result.asns.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-xs font-medium">{result.dryRun ? 'Ready to create' : 'Created'}</div>
          <ul className="flex flex-wrap gap-1.5" aria-label={result.dryRun ? 'ASNs ready to create' : 'ASNs created'}>
            {result.asns.map((asn) => (
              <li key={`${asn.clientId}|${asn.asnCode}`} className="rounded-sm bg-(--muted) px-1.5 py-0.5 text-xs">
                <span className="font-mono">{asn.asnCode}</span> · {asn.clientLabel} · <span className="data">{asn.lineCount}</span>{' '}
                {asn.lineCount === 1 ? 'line' : 'lines'}
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.errors.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="overflow-x-auto rounded-md border border-(--border)">
            <table className="w-full border-collapse text-sm" aria-label="Refused rows">
              <thead className="sticky top-0 bg-(--muted)">
                <tr>
                  <th scope="col" className={`${headClass} text-right`}>
                    Row
                  </th>
                  <th scope="col" className={headClass}>
                    ASN code
                  </th>
                  <th scope="col" className={headClass}>
                    Reason
                  </th>
                  <th scope="col" className={headClass}>
                    Detail
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.errors.slice(0, MAX_RENDERED_IMPORT_ERRORS).map((error, index) => (
                  <tr key={`${error.rowNumber}-${error.code}-${index}`} className="h-9 border-b border-(--border) last:border-b-0">
                    <td className="data px-3 text-right">{error.rowNumber}</td>
                    <td className="px-3 font-mono text-xs">{error.asnCode ?? '—'}</td>
                    <td className="px-3 text-xs">{asnImportReasonLabel(error.code)}</td>
                    <td className="px-3 text-(--muted-foreground)">{error.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.errors.length > MAX_RENDERED_IMPORT_ERRORS && (
            <div className="text-xs text-(--muted-foreground)">
              Showing the first {MAX_RENDERED_IMPORT_ERRORS} of {result.errors.length} refused rows — the report carries them all.
            </div>
          )}
          <button
            type="button"
            className={`${buttonClass} self-start`}
            onClick={() => downloadText(asnImportReportName(result), asnImportErrorReport(result))}
          >
            Download error report (.csv)
          </button>
        </div>
      )}
    </div>
  );
}
