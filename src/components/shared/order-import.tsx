'use client';

import { useRef, useState, type ReactNode } from 'react';

import type { OrderImportStep } from '@/lib/api/client';
import { downloadText } from '@/lib/csv';
import {
  MAX_ORDER_IMPORT_BYTES,
  MAX_RENDERED_ORDER_IMPORT_ERRORS,
  orderImportErrorReport,
  orderImportFileReadProblem,
  orderImportHelp,
  orderImportOutcome,
  orderImportReason,
  orderImportReasonLabel,
  orderImportReportName,
  orderImportTemplate,
  sameOrderImportFile,
  templateShipBy,
  type OrderImportResult,
  type OrderImportSurface,
} from '@/lib/order-import';
import { ulid } from '@/lib/ulid';

import { FeedbackBanner } from '@/components/feedback/banner';
import { buttonClass, inputClass, primaryClass } from '@/components/shared/surface';
import { StatusChip } from '@/components/shared/status-chip';

const headClass = 'h-9 border-b border-(--border) px-3 text-left font-medium text-(--foreground)';

/**
 * Story 4-1c — the order import panel, shared by the staff Outbound → Orders
 * page and the client portal's Orders page. Two steps over one route:
 * **Check file** (no key) runs every order through the create's rules and
 * writes nothing; **Import** creates each valid order exactly as the
 * one-at-a-time form would. The caller supplies `run` (the surface's fetch),
 * so this component imports no operator hook or fetcher and stays
 * portal-allowed (`lib/portal-boundary.test.ts`).
 *
 * The Idempotency-Key lives as long as the CHECKED FILE (A13): minted at
 * Check, reused by every Import of that file — also after re-picking the
 * same file (same name, size and last-modified) following a timeout, so the
 * retry resumes instead of refusing every order as a used number — and
 * dropped for any other file or warehouse. An unfinished run (`complete:
 * false`) keeps Import enabled: pressing it again finishes the file.
 */
export function OrderImport({
  surface,
  warehouseId,
  todayIst,
  run,
  onImported,
  onClose,
  warehousePicker,
}: {
  surface: OrderImportSurface;
  /** Null until a warehouse is chosen (the portal's picker); the steps are disabled meanwhile. */
  warehouseId: string | null;
  /** Today's IST date — the template's example ship-by is three days after it. */
  todayIst: string;
  run: (file: File, warehouseId: string, step: OrderImportStep) => Promise<OrderImportResult>;
  onImported: (result: OrderImportResult) => void;
  onClose: () => void;
  /** The portal's warehouse select (rendered beside the file input). */
  warehousePicker?: ReactNode;
}) {
  const [file, setFile] = useState<File | null>(null);
  // Each result and the key belong to ONE (file, warehouse): the import's
  // fingerprint is the file's bytes and the warehouse, so a switch of either
  // invalidates them in the same render (no reset effect, no remount — a
  // first warehouse pick keeps the file already chosen).
  const [checked, setChecked] = useState<{ file: File; warehouseId: string; result: OrderImportResult } | null>(null);
  const [imported, setImported] = useState<{ file: File; warehouseId: string; result: OrderImportResult } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<'check' | 'import' | null>(null);
  const keyRef = useRef<{ file: File; warehouseId: string; key: string } | null>(null);
  const inFlight = useRef(false);

  const holds = (entry: { file: File; warehouseId: string } | null): boolean =>
    entry !== null && entry.warehouseId === warehouseId && sameOrderImportFile(entry.file, file);
  const checkResult = holds(checked) ? checked!.result : null;
  const importResult = holds(imported) ? imported!.result : null;
  const result = importResult ?? checkResult;
  const tooLarge = file !== null && file.size > MAX_ORDER_IMPORT_BYTES;
  const finished = importResult !== null && importResult.complete;
  const canImport = checkResult !== null && checkResult.acceptedCount > 0 && !finished && warehouseId !== null;

  function pick(next: File | null) {
    setFile(next);
    setProblem(null);
    // A different file is a different intent: its Import gets a new key.
    if (keyRef.current !== null && !sameOrderImportFile(keyRef.current.file, next)) keyRef.current = null;
  }

  async function step(kind: 'check' | 'import') {
    if (file === null || warehouseId === null || inFlight.current) return;
    inFlight.current = true;
    setBusy(kind);
    setProblem(null);
    try {
      // Read it first: a file moved or changed since it was picked fails here
      // with its own words, not as "the server is unreachable".
      try {
        await file.arrayBuffer();
      } catch {
        setProblem(orderImportFileReadProblem(file.name));
        return;
      }
      const current = keyRef.current;
      if (current === null || current.warehouseId !== warehouseId || !sameOrderImportFile(current.file, file)) {
        keyRef.current = { file, warehouseId, key: ulid() };
      }
      if (kind === 'check') {
        setChecked({ file, warehouseId, result: await run(file, warehouseId, { dryRun: true }) });
        setImported(null);
      } else {
        const response = await run(file, warehouseId, { dryRun: false, idempotencyKey: keyRef.current!.key });
        setImported({ file, warehouseId, result: response });
        onImported(response);
      }
    } catch (error) {
      setProblem(orderImportReason(error, surface));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  const outcome = result === null ? null : orderImportOutcome(result, surface);
  const importLabel = importResult !== null && !importResult.complete ? 'Import again' : 'Import';
  const disabledWhy =
    warehouseId === null
      ? 'Choose a warehouse first.'
      : file === null
        ? 'Pick a file first.'
        : tooLarge
          ? 'The file is over 5 MB — split it.'
          : checkResult === null
            ? 'Check the file before importing it.'
            : finished
              ? 'This file is imported — pick another file to import more.'
              : checkResult.acceptedCount === 0
                ? 'No order in this file is ready — fix the refused rows, then check it again.'
                : null;

  return (
    <section aria-label="Import orders from a file" className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex max-w-3xl flex-col gap-1">
          <h3 className="font-medium">Import orders from a file</h3>
          <p className="text-xs text-(--muted-foreground)">{orderImportHelp(surface)}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={buttonClass}
            onClick={() => downloadText(`order-import-template${surface === 'portal' ? '' : '-staff'}.csv`, orderImportTemplate(surface, templateShipBy(todayIst)))}
          >
            Download template
          </button>
          <button type="button" className={buttonClass} onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {warehousePicker}
        <label className="flex min-w-60 flex-1 flex-col gap-1 text-xs">
          <span className="font-medium">Order file (.csv / .xlsx)</span>
          <input
            className={inputClass}
            type="file"
            aria-label="Order file"
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
          disabled={file === null || tooLarge || warehouseId === null || busy !== null}
          onClick={() => void step('check')}
        >
          {busy === 'check' ? 'Checking…' : 'Check file'}
        </button>
        <button
          type="button"
          className={primaryClass}
          disabled={!canImport || busy !== null}
          aria-describedby={disabledWhy === null ? undefined : 'order-import-why'}
          onClick={() => void step('import')}
        >
          {busy === 'import' ? 'Importing…' : importLabel}
        </button>
      </div>
      {disabledWhy !== null && !canImport && (
        <div id="order-import-why" className="text-xs text-(--muted-foreground)">
          {disabledWhy}
        </div>
      )}
      {busy === 'import' && (
        <div role="status" className="text-xs text-(--muted-foreground)">
          Creating orders one by one — a large file can take up to about 20 seconds.
        </div>
      )}
      {tooLarge && file !== null && (
        <div role="alert" className="text-xs text-(--destructive)">
          {file.name} is {(file.size / (1024 * 1024)).toFixed(1)} MB — the cap is 5 MB.
        </div>
      )}
      {problem !== null && <FeedbackBanner tone="rejected" word="Not imported" reason={problem} />}
      {result !== null && outcome !== null && <OrderImportResultView result={result} outcome={outcome} surface={surface} />}
    </section>
  );
}

/** The result: the orders created (or ready), and every refused row with its report. */
export function OrderImportResultView({
  result,
  outcome,
  surface,
}: {
  result: OrderImportResult;
  outcome: ReturnType<typeof orderImportOutcome>;
  surface: OrderImportSurface;
}) {
  return (
    <div className="flex flex-col gap-2" data-testid="order-import-result">
      <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />
      {result.orders.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-xs font-medium">{result.dryRun ? 'Ready' : surface === 'portal' ? 'Placed' : 'Created'}</div>
          <ul className="flex flex-wrap gap-1.5" aria-label={result.dryRun ? 'Orders ready' : 'Orders imported'}>
            {result.orders.map((order) => {
              const backordered = 'backorderedLineCount' in order ? (order.backorderedLineCount ?? 0) : 0;
              return (
                <li key={`${'clientId' in order ? order.clientId : ''}|${order.clientOrderRef}`} className="flex items-center gap-1.5 rounded-sm bg-(--muted) px-1.5 py-0.5 text-xs">
                  <span className="font-mono">{order.clientOrderRef}</span>
                  {'clientLabel' in order && <span>· {order.clientLabel}</span>}
                  <span>
                    · <span className="data">{order.lineCount}</span> {order.lineCount === 1 ? 'line' : 'lines'}
                  </span>
                  {backordered > 0 && <StatusChip tone="warning">{`${backordered} backordered`}</StatusChip>}
                  {order.replayed && <StatusChip tone="neutral">Earlier run</StatusChip>}
                </li>
              );
            })}
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
                    Order number
                  </th>
                  <th scope="col" className={headClass}>
                    SKU
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
                {result.errors.slice(0, MAX_RENDERED_ORDER_IMPORT_ERRORS).map((error, index) => (
                  <tr key={`${error.rowNumber}-${error.code}-${index}`} className="h-9 border-b border-(--border) last:border-b-0">
                    <td className="data px-3 text-right">{error.rowNumber}</td>
                    <td className="px-3 font-mono text-xs">{error.orderRef ?? '—'}</td>
                    <td className="px-3 font-mono text-xs">{error.sku ?? '—'}</td>
                    <td className="px-3 text-xs">
                      <StatusChip tone="danger">{orderImportReasonLabel(error.code)}</StatusChip>
                    </td>
                    <td className="px-3 text-(--muted-foreground)">{error.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.errors.length > MAX_RENDERED_ORDER_IMPORT_ERRORS && (
            <div className="text-xs text-(--muted-foreground)">
              Showing the first {MAX_RENDERED_ORDER_IMPORT_ERRORS} of {result.errors.length} refused rows — the report carries them all.
            </div>
          )}
          <button
            type="button"
            className={`${buttonClass} self-start`}
            onClick={() => downloadText(orderImportReportName(result), orderImportErrorReport(result))}
          >
            Download error report (.csv)
          </button>
        </div>
      )}
    </div>
  );
}
