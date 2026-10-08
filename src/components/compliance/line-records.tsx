'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiClientInvoiceLineRecords, fetchApiClientInvoiceStorageBreakdown } from '@/lib/api/client';
import type { ClientInvoiceDto, ClientInvoiceLineDto, StorageBreakdownResponse, StorageDayRecordDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { lineDescription, lineQuantityLabel, notifyClientInvoicesChanged } from '@/lib/client-invoices';
import { downloadText } from '@/lib/csv';
import {
  INVOICE_CHANGED_WORD,
  SESSION_EXPIRED_REASON,
  breakdownNotice,
  buildLineRecordsCsv,
  collectLineRecords,
  exportCapNotice,
  exportProgressLabel,
  formatIstInstant,
  lineRecordsFilename,
  lineRecordsReason,
  needsInvoiceReload,
  orderRefLabel,
  pseudonymsOf,
  receiptDocumentLabel,
  reconcileNotice,
  recordCountLabel,
  summaryLabel,
  type LineRecord,
} from '@/lib/invoice-records';
import { groupDecimal } from '@/lib/usage';
import { useLineRecords } from '@/lib/use-invoice-records';

import { FeedbackBanner } from '@/components/feedback/banner';
import { ReadFailure, buttonClass, rowButtonClass } from '@/components/outbound/shell';

/**
 * Story 21-5b — the dispute drill-down: a "Line records" panel UNDER the
 * printable invoice, never inside `data-print-root`, and `print:hidden` (the
 * records are an operator's working view, not part of the tax document).
 * Each line has a native toggle (`aria-expanded` / `aria-controls`); its
 * panel names the line, states whether the records add up to its quantity
 * (the server's summary), lists the records page by page ("Load more"), and
 * exports them as CSV — every page, staff pseudonymised (decision 2), capped
 * at 50,000 rows (decision 1). A storage day expands to its per-SKU
 * breakdown on demand.
 */
export function LineRecordsPanel({ invoice }: { invoice: ClientInvoiceDto }) {
  const [openLine, setOpenLine] = useState<string | null>(null);
  const headingId = `line-records-${invoice.id}`;
  // A refreshed draft rewrites its lines: an open id that is gone simply closes.
  const open = invoice.lines.some((line) => line.id === openLine) ? openLine : null;
  return (
    <section aria-labelledby={headingId} data-line-records className="flex flex-col gap-2 rounded-md border border-(--border) p-3 text-sm print:hidden">
      <h4 id={headingId} className="font-medium">
        Line records
      </h4>
      <div className="text-xs text-(--muted-foreground)">
        Expand a line to the records its quantity was counted from — to answer a dispute. Times are IST.
      </div>
      <ul className="flex flex-col gap-2">
        {invoice.lines.map((line) => {
          const panelId = `line-records-panel-${line.id}`;
          const expanded = open === line.id;
          return (
            <li key={line.id} className="flex flex-col gap-2">
              <div>
                <button
                  type="button"
                  className={rowButtonClass}
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => setOpenLine(expanded ? null : line.id)}
                >
                  {expanded ? 'Hide records' : 'Show records'} — {lineDescription(line)} · {lineQuantityLabel(line)}
                </button>
              </div>
              {expanded ? <LineRecords key={line.id} id={panelId} invoice={invoice} line={line} /> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type ExportState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'running'; readonly rows: number }
  | { readonly phase: 'done'; readonly notice: string | null }
  | { readonly phase: 'failed'; readonly reason: string; readonly reload: boolean };

function LineRecords({ id, invoice, line }: { id: string; invoice: ClientInvoiceDto; line: ClientInvoiceLineDto }) {
  const records = useLineRecords(invoice.id, line.id, invoice.status);
  const [exporting, setExporting] = useState<ExportState>({ phase: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);

  // An export in flight must not keep paging — or download — once the panel is gone.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function runExport() {
    const session = readSession();
    if (session === null || abortRef.current !== null) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setExporting({ phase: 'running', rows: 0 });
    try {
      const exported = await collectLineRecords(
        (cursor, limit, signal) =>
          fetchApiClientInvoiceLineRecords(session.tenant.id, invoice.id, line.id, { ...(cursor === undefined ? {} : { cursor }), limit, signal }),
        controller.signal,
        (rows) => setExporting({ phase: 'running', rows }),
      );
      const pseudonyms = await pseudonymsOf(session.tenant.id, exported.records);
      if (controller.signal.aborted) return;
      downloadText(lineRecordsFilename(invoice, line), buildLineRecordsCsv({ invoice, line, exported, pseudonyms, generatedAt: new Date().toISOString() }));
      setExporting({ phase: 'done', notice: exportCapNotice(exported.truncated) });
    } catch (error) {
      if (controller.signal.aborted) {
        setExporting({ phase: 'idle' });
        return;
      }
      setExporting({ phase: 'failed', reason: lineRecordsReason(error, invoice.status), reload: needsInvoiceReload(error, invoice.status) });
    } finally {
      abortRef.current = null;
    }
  }

  function cancelExport() {
    abortRef.current?.abort();
  }

  const heading = `Records — ${lineDescription(line)}`;
  return (
    <div id={id} role="region" aria-label={heading} className="flex flex-col gap-2 rounded-md border border-(--border) p-3">
      <h5 className="font-medium">{heading}</h5>
      {records.state === 'loading' ? <div className="text-(--muted-foreground)">Loading records…</div> : null}
      {records.state === 'failed' ? (
        records.invoiceChanged ? (
          <FeedbackBanner
            tone="warning"
            word={INVOICE_CHANGED_WORD}
            reason={records.reason}
            action={
              <button type="button" className={rowButtonClass} onClick={() => notifyClientInvoicesChanged()}>
                Reload
              </button>
            }
          />
        ) : (
          <ReadFailure word="Records unavailable" reason={records.reason} onRetry={records.reload} />
        )
      ) : null}
      {records.state === 'ready' ? (
        <>
          {records.data.summary !== null ? (
            <>
              <div className="data text-xs">{summaryLabel(line, records.data.summary)}</div>
              {(() => {
                const notice = reconcileNotice(records.data.invoiceStatus, line, records.data.summary);
                return notice === null ? null : <FeedbackBanner tone={notice.tone} word={notice.word} reason={notice.reason} />;
              })()}
            </>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {exporting.phase === 'running' ? (
              <>
                <span role="status" className="text-xs">
                  {exportProgressLabel(exporting.rows)}
                </span>
                <button type="button" className={rowButtonClass} onClick={cancelExport}>
                  Cancel export
                </button>
              </>
            ) : (
              <button type="button" className={buttonClass} onClick={runExport}>
                Export CSV
              </button>
            )}
            <span className="text-xs text-(--muted-foreground)">{recordCountLabel(records.data.kind, records.data.records.length, records.data.nextCursor !== null)}</span>
          </div>
          {exporting.phase === 'done' && exporting.notice !== null ? <FeedbackBanner tone="warning" word="Export capped" reason={exporting.notice} /> : null}
          {exporting.phase === 'failed' ? (
            <FeedbackBanner
              tone={exporting.reload ? 'warning' : 'rejected'}
              word={exporting.reload ? INVOICE_CHANGED_WORD : 'Not exported'}
              reason={exporting.reason}
              action={
                exporting.reload ? (
                  <button type="button" className={rowButtonClass} onClick={() => notifyClientInvoicesChanged()}>
                    Reload
                  </button>
                ) : undefined
              }
            />
          ) : null}
          <RecordsTable
            records={records.data.records}
            openDay={openDay}
            onToggleDay={(key) => setOpenDay(openDay === key ? null : key)}
            invoice={invoice}
            line={line}
          />
          {records.data.nextCursor !== null ? (
            <div>
              <button type="button" className={buttonClass} disabled={records.loadingMore} onClick={records.loadMore}>
                {records.loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          ) : null}
          {records.moreError !== null ? (
            records.moreError.invoiceChanged ? (
              <FeedbackBanner
                tone="warning"
                word={INVOICE_CHANGED_WORD}
                reason={records.moreError.reason}
                action={
                  <button type="button" className={rowButtonClass} onClick={() => notifyClientInvoicesChanged()}>
                    Reload
                  </button>
                }
              />
            ) : (
              <FeedbackBanner tone="rejected" word="More records unavailable" reason={records.moreError.reason} />
            )
          ) : null}
        </>
      ) : null}
    </div>
  );
}

const th = 'py-1 pr-2 text-left font-medium';
const thNum = 'data py-1 pr-2 text-right font-medium';
const td = 'py-1 pr-2';
const tdNum = 'data py-1 pr-2 text-right';

function actorLabel(record: { actorEmail: string | null; actorId: string }): string {
  return record.actorEmail ?? `Unknown user (${record.actorId.slice(0, 8)}…)`;
}

function RecordsTable({
  records,
  openDay,
  onToggleDay,
  invoice,
  line,
}: {
  records: readonly LineRecord[];
  openDay: string | null;
  onToggleDay: (key: string) => void;
  invoice: ClientInvoiceDto;
  line: ClientInvoiceLineDto;
}) {
  if (records.length === 0) return <div className="text-xs text-(--muted-foreground)">No records.</div>;
  const kind = records[0]!.kind;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs" aria-label="Line records">
        <thead>
          <tr className="border-b border-(--border)">
            {kind === 'receipt-line' ? (
              <>
                <th className={th}>Recorded (IST)</th>
                <th className={th}>GRN</th>
                <th className={th}>Document</th>
                <th className={th}>Warehouse</th>
                <th className={th}>SKU</th>
                <th className={thNum}>Received</th>
                <th className={thNum}>Applied</th>
                <th className={th}>By</th>
              </>
            ) : null}
            {kind === 'pick' ? (
              <>
                <th className={th}>Picked (IST)</th>
                <th className={th}>Warehouse</th>
                <th className={th}>Channel ref</th>
                <th className={th}>SKU</th>
                <th className={thNum}>Qty</th>
                <th className={th}>Bin</th>
                <th className={th}>By</th>
              </>
            ) : null}
            {kind === 'order' ? (
              <>
                <th className={th}>First dispatched (IST)</th>
                <th className={th}>Warehouse</th>
                <th className={th}>Channel ref</th>
                <th className={thNum}>Lines</th>
                <th className={th}>Carrier</th>
                <th className={th}>Tracking</th>
                <th className={th}>By</th>
              </>
            ) : null}
            {kind === 'storage-day' ? (
              <>
                <th className={th}>Day (IST)</th>
                <th className={th}>Warehouse</th>
                <th className={thNum}>On hand</th>
                <th className={th}>
                  <span className="sr-only">Breakdown</span>
                </th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            switch (record.kind) {
              case 'receipt-line':
                return (
                  <tr key={record.id} className="border-b border-(--border)">
                    <td className={td}>{formatIstInstant(record.recordedAt)}</td>
                    <td className={`${td} font-mono`}>{record.grnCode}</td>
                    <td className={`${td} font-mono`}>{receiptDocumentLabel(record)}</td>
                    <td className={td}>{record.warehouseCode}</td>
                    <td className={td}>
                      <span className="font-mono">{record.skuCode}</span> {record.skuName}
                    </td>
                    <td className={tdNum}>{groupDecimal(record.qty)}</td>
                    <td className={tdNum}>{groupDecimal(record.appliedQty)}</td>
                    <td className={td}>{actorLabel(record)}</td>
                  </tr>
                );
              case 'pick':
                return (
                  <tr key={record.id} className="border-b border-(--border)">
                    <td className={td}>{formatIstInstant(record.pickedAt)}</td>
                    <td className={td}>{record.warehouseCode}</td>
                    <td className={`${td} font-mono`}>{orderRefLabel(record.orderRef)}</td>
                    <td className={td}>
                      <span className="font-mono">{record.skuCode}</span> {record.skuName}
                    </td>
                    <td className={tdNum}>{groupDecimal(record.qty)}</td>
                    <td className={`${td} font-mono`}>{record.binCode ?? '—'}</td>
                    <td className={td}>{actorLabel(record)}</td>
                  </tr>
                );
              case 'order':
                return (
                  <tr key={record.id} className="border-b border-(--border)">
                    <td className={td}>{formatIstInstant(record.dispatchedAt)}</td>
                    <td className={td}>{record.warehouseCode}</td>
                    <td className={`${td} font-mono`}>{orderRefLabel(record.orderRef)}</td>
                    <td className={tdNum}>{record.lines}</td>
                    <td className={td}>{record.carrierName ?? '—'}</td>
                    <td className={`${td} font-mono`}>{record.trackingNumber ?? '—'}</td>
                    <td className={td}>{actorLabel(record)}</td>
                  </tr>
                );
              case 'storage-day':
                return <StorageDayRow key={`${record.date}|${record.warehouseId}`} record={record} openDay={openDay} onToggleDay={onToggleDay} invoice={invoice} line={line} />;
            }
          })}
        </tbody>
      </table>
    </div>
  );
}

function StorageDayRow({
  record,
  openDay,
  onToggleDay,
  invoice,
  line,
}: {
  record: StorageDayRecordDto;
  openDay: string | null;
  onToggleDay: (key: string) => void;
  invoice: ClientInvoiceDto;
  line: ClientInvoiceLineDto;
}) {
  const key = `${record.date}|${record.warehouseId}`;
  const expanded = openDay === key;
  const breakdownId = `storage-breakdown-${line.id}-${record.date}-${record.warehouseId}`;
  return (
    <>
      <tr className="border-b border-(--border)">
        <td className={td}>{record.date}</td>
        <td className={td}>{record.warehouseCode}</td>
        <td className={tdNum}>
          {groupDecimal(record.onHand)} {record.uom}
        </td>
        <td className={td}>
          <button
            type="button"
            className={rowButtonClass}
            aria-expanded={expanded}
            aria-controls={breakdownId}
            aria-label={`${expanded ? 'Hide SKUs' : 'Show SKUs'} for ${record.date} in ${record.warehouseCode}`}
            onClick={() => onToggleDay(key)}
          >
            {expanded ? 'Hide SKUs' : 'By SKU'}
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr id={breakdownId} className="border-b border-(--border)">
          <td colSpan={4} className="bg-(--muted) px-2 py-1">
            <StorageBreakdown invoice={invoice} line={line} date={record.date} warehouseId={record.warehouseId} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * One storage day's per-SKU breakdown, fetched when the row is expanded (it
 * unmounts on collapse). The result is stamped with the revision it was read
 * for (Retry bumps it) and filtered at render — never a reset in an effect.
 */
function StorageBreakdown({ invoice, line, date, warehouseId }: { invoice: ClientInvoiceDto; line: ClientInvoiceLineDto; date: string; warehouseId: string }) {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<
    | { revision: number; phase: 'ready'; data: StorageBreakdownResponse }
    | { revision: number; phase: 'failed'; reason: string; invoiceChanged: boolean }
    | null
  >(null);
  const invoiceId = invoice.id;
  const status = invoice.status;
  const lineId = line.id;
  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchApiClientInvoiceStorageBreakdown(tenantId, invoiceId, lineId, date, warehouseId);
        if (!cancelled) setResult({ revision, phase: 'ready', data });
      } catch (error) {
        if (!cancelled) setResult({ revision, phase: 'failed', reason: lineRecordsReason(error, status), invoiceChanged: needsInvoiceReload(error, status) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, invoiceId, lineId, status, date, warehouseId, revision]);
  if (tenantId === null) return <FeedbackBanner tone="rejected" word="Breakdown unavailable" reason={SESSION_EXPIRED_REASON} />;
  const state = result !== null && result.revision === revision ? result : null;
  if (state === null) return <div className="text-(--muted-foreground)">Loading the SKUs…</div>;
  if (state.phase === 'failed') {
    return state.invoiceChanged ? (
      <FeedbackBanner
        tone="warning"
        word={INVOICE_CHANGED_WORD}
        reason={state.reason}
        action={
          <button type="button" className={rowButtonClass} onClick={() => notifyClientInvoicesChanged()}>
            Reload
          </button>
        }
      />
    ) : (
      <ReadFailure word="Breakdown unavailable" reason={state.reason} onRetry={() => setRevision((r) => r + 1)} />
    );
  }
  const { data } = state;
  return (
    <div className="flex flex-col gap-1">
      <table className="w-full border-collapse text-xs" aria-label={`SKUs on ${data.date} in ${data.warehouseCode}`}>
        <thead>
          <tr>
            <th className={th}>SKU</th>
            <th className={thNum}>On hand ({data.uom})</th>
          </tr>
        </thead>
        <tbody>
          {data.skus.map((sku) => (
            <tr key={sku.skuId}>
              <td className={td}>
                <span className="font-mono">{sku.skuCode}</span> {sku.skuName}
              </td>
              <td className={tdNum}>{groupDecimal(sku.onHand)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(() => {
        const notice = breakdownNotice(status, data);
        return notice === null ? null : <FeedbackBanner tone={notice.tone} word={notice.word} reason={notice.reason} />;
      })()}
      <div className="data text-xs">
        Σ SKUs {groupDecimal(data.total)} · snapshot {data.snapshotOnHand === null ? 'none (closed at or below zero)' : groupDecimal(data.snapshotOnHand)} ·{' '}
        {data.reconciles ? 'adds up' : 'does not add up'}
      </div>
    </div>
  );
}
