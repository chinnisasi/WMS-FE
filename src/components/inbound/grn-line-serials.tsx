'use client';

import { useId, useState } from 'react';
import type { GoodsReceiptLineEntryDto } from '@/lib/api/generated';
import {
  SERIAL_AFTER_WRITE_OFF_LABEL,
  SERIAL_STATE_LABEL,
  SERIAL_STATE_TONE,
  filterSerials,
  grnSerialSummary,
  qcSkippedLabel,
  unreadableSerialLabel,
  type GrnLineSerial,
} from '@/lib/grn-lines';

/** Show a search box once a line carries more serials than this. */
const SEARCH_FROM = 10;

const TONE_CLASS: Record<'neutral' | 'warning' | 'error', string> = {
  neutral: 'border-(--border) text-(--muted-foreground)',
  warning: 'border-(--warning) text-(--warning)',
  error: 'border-(--destructive) text-(--destructive)',
};

/**
 * Story 2-6a (A19, A22) — a GRN line's captured serials: collapsed to a
 * one-line summary ("3 serials · 2 booked · 1 awaiting approval"), expanded
 * to the list in capture order with each unit's state in words (never colour
 * alone), searchable once the line is long (a line carries up to 500), plus
 * the unreadable units and the QC-on-receipt skip. Renders nothing on a line
 * without serial capture.
 */
export function GrnLineSerials({
  line,
}: {
  line: Pick<GoodsReceiptLineEntryDto, 'skuCode' | 'serials' | 'unreadableSerialQty' | 'qcSkipped'>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const listId = useId();
  const serials: readonly GrnLineSerial[] = line.serials ?? [];
  const summary = grnSerialSummary(serials);
  const unreadable = unreadableSerialLabel(line);
  const qcSkipped = qcSkippedLabel(line);
  if (summary === null && unreadable === null && qcSkipped === null) return null;
  const shown = filterSerials(serials, query);
  return (
    <div className="ml-4 mt-0.5 flex flex-col gap-1" data-testid="grn-line-serials">
      <div className="flex flex-wrap items-center gap-2 text-(--muted-foreground)">
        {summary !== null && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((value) => !value)}
            className="rounded-sm border border-(--border) px-1.5 py-0.5 text-xs text-(--foreground) hover:bg-(--muted)"
          >
            <span aria-hidden="true">{open ? '▾' : '▸'}</span> <span className="data">{summary}</span>
            <span className="sr-only"> — {open ? 'hide' : 'show'} the serials of {line.skuCode}</span>
          </button>
        )}
        {unreadable !== null && <span data-testid="grn-line-unreadable">{unreadable}</span>}
        {qcSkipped !== null && (
          <span className="rounded-full border border-(--warning) px-2 py-0.5 font-medium text-(--warning)" data-testid="grn-line-qc-skipped">
            {qcSkipped}
          </span>
        )}
      </div>
      {open && summary !== null && (
        <div id={listId} className="flex flex-col gap-1">
          {serials.length > SEARCH_FROM && (
            <label className="flex items-center gap-2">
              <span className="sr-only">Find a serial of {line.skuCode}</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a serial"
                className="w-56 rounded-sm border border-(--border) bg-(--background) px-2 py-1 text-xs"
              />
              <span className="text-(--muted-foreground)" aria-live="polite">
                {query.trim() === '' ? `${serials.length} serials` : `${shown.length} of ${serials.length}`}
              </span>
            </label>
          )}
          {shown.length === 0 ? (
            <div className="text-(--muted-foreground)">No serial matches “{query.trim()}”.</div>
          ) : (
            <ol className="max-h-64 overflow-y-auto rounded-sm border border-(--border)" aria-label={`Serials of ${line.skuCode}`}>
              {shown.map((serial) => (
                <li key={serial.serial} className="flex flex-wrap items-center gap-2 border-b border-(--border) px-2 py-1 last:border-b-0" data-testid="grn-serial">
                  <span className="font-mono">{serial.serial}</span>
                  <span className={`rounded-full border px-2 py-0.5 font-medium ${TONE_CLASS[SERIAL_STATE_TONE[serial.state]]}`}>
                    {SERIAL_STATE_LABEL[serial.state]}
                  </span>
                  {serial.afterWriteOff === true && <span className="text-(--muted-foreground)">{SERIAL_AFTER_WRITE_OFF_LABEL}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
