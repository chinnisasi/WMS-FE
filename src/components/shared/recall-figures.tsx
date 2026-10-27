import type { RecallFiguresDto } from '@/lib/api/generated';
import { formatCount } from '@/lib/format-quantity';
import { recallFigureRows, recallQuantity, recallStatusTone, recallStatusWord, recallRoleLabel } from '@/lib/recalls';

import { StatusChip } from '@/components/shared/status-chip';

/**
 * Story 3-7a — the recall pieces staff and the portal draw alike, so a
 * recall reads the same on both: the status and MOCK chips, the per-lot
 * figures table (live beside frozen-at-close) and the on-hand-by-warehouse
 * table (warehouse and location role — never a bin). Portal-allowed: no
 * hook, no operator import.
 */

export function RecallChips({ status, mode }: { readonly status: string; readonly mode: string }) {
  const tone = recallStatusTone(status, mode);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <StatusChip tone={tone.tone} variant={tone.solid ? 'solid' : 'outline'} glyph={status === 'open' ? '●' : '✓'} data-testid="recall-status-chip">
        {recallStatusWord(status)}
      </StatusChip>
      {mode === 'mock' && (
        <StatusChip tone="info" glyph="◇" data-testid="recall-mock-chip" title="A drill — it blocks nothing">
          MOCK
        </StatusChip>
      )}
    </span>
  );
}

/** One lot's figures: every figure, live and (once closed) as frozen at close. Unaccounted ≠ 0 is amber, with a word. */
export function RecallFiguresTable({
  figures,
  closeFigures,
  uom,
  caption,
}: {
  readonly figures: RecallFiguresDto;
  readonly closeFigures: RecallFiguresDto | null;
  readonly uom: string;
  readonly caption: string;
}) {
  const rows = recallFigureRows(figures, closeFigures);
  return (
    <div className="overflow-x-auto rounded-md border border-(--border) bg-(--background)">
      <table className="w-full border-collapse text-xs" data-testid="recall-figures">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="h-8 border-b border-(--border) px-3 text-left font-medium">
              Figure
            </th>
            <th scope="col" className="data h-8 border-b border-(--border) px-3 text-right font-medium">
              Live ({uom})
            </th>
            <th scope="col" className="data h-8 border-b border-(--border) px-3 text-right font-medium">
              At close ({uom})
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} data-figure={row.key} className={`h-8 border-b border-(--border) last:border-b-0 ${row.attention ? 'bg-(--warning)/10' : ''}`}>
              <th scope="row" className="px-3 text-left font-normal">
                <span className="flex flex-col">
                  <span className={row.attention ? 'font-medium' : ''}>
                    {row.attention && <span aria-hidden>⚠ </span>}
                    {row.label}
                  </span>
                  <span className="text-(--muted-foreground)">{row.help}</span>
                </span>
              </th>
              <td className="data px-3 text-right">{formatCount(row.live)}</td>
              <td className="data px-3 text-right">{row.atClose === null ? '—' : formatCount(row.atClose)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** On hand per lot × warehouse × location role (no bins — the operator's copy is the client's). */
export function RecallOnHandTable({
  rows,
  uomOf,
}: {
  readonly rows: readonly { readonly warehouseCode: string; readonly role: string; readonly batchCode: string; readonly quantity: number }[];
  readonly uomOf: (batchCode: string) => string;
}) {
  if (rows.length === 0) return <p className="text-(--muted-foreground)">None of the recalled lots is on hand or in transit anywhere.</p>;
  return (
    <div className="overflow-x-auto rounded-md border border-(--border)">
      <table className="w-full border-collapse text-sm" data-testid="recall-on-hand">
        <thead className="bg-(--muted)">
          <tr>
            {['Warehouse', 'Location', 'Lot'].map((header) => (
              <th key={header} scope="col" className="h-10 border-b border-(--border) px-3 text-left font-medium">
                {header}
              </th>
            ))}
            <th scope="col" className="data h-10 border-b border-(--border) px-3 text-right font-medium">
              Quantity
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.warehouseCode}|${row.role}|${row.batchCode}`} className="h-10 border-b border-(--border) last:border-b-0">
              <td className="px-3 font-mono text-xs">{row.warehouseCode}</td>
              <td className="px-3">{recallRoleLabel(row.role)}</td>
              <td className="px-3 font-mono text-xs">{row.batchCode}</td>
              <td className="data px-3 text-right">{recallQuantity(row.quantity, uomOf(row.batchCode))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
