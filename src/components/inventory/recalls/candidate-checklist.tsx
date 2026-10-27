'use client';

import type { ReactNode } from 'react';

import type { RecallCandidateDto } from '@/lib/api/generated';
import { istDateLabel } from '@/lib/audit-exports';
import { SIMILAR_CODE_LABEL, candidateAvailability, candidateStatusLabel, recallQuantity } from '@/lib/recalls';

import { StatusChip } from '@/components/shared/status-chip';

/**
 * Story 3-7a — the lots matching a typed lot code, as a checklist: the
 * batch code (a NORMALISED match says "similar code — check the label"),
 * the SKU, expiry, its status now and on hand across every warehouse. A lot
 * already on an open live recall cannot be ticked ("Already on RCL-x"); a
 * lot of the same code as one already on an open recall offers that recall
 * through `renderAdd` ("Add to RCL-x"). Ticking is the caller's state.
 */
export function CandidateChecklist({
  items,
  mode,
  recallId,
  selected,
  disabled,
  onToggle,
  renderAdd,
}: {
  readonly items: readonly RecallCandidateDto[];
  readonly mode: string;
  /** Set when adding to this recall: its own lots read "On this recall". */
  readonly recallId?: string;
  readonly selected: ReadonlySet<string>;
  readonly disabled: boolean;
  readonly onToggle: (batchId: string) => void;
  readonly renderAdd?: (candidate: RecallCandidateDto) => ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-(--border)">
      <table className="w-full border-collapse text-sm" data-testid="recall-candidates">
        <thead className="bg-(--muted)">
          <tr>
            <th scope="col" className="h-10 w-10 border-b border-(--border) px-3 text-left font-medium">
              <span className="sr-only">Recall</span>
            </th>
            {['Lot', 'SKU', 'Expires', 'Status now'].map((header) => (
              <th key={header} scope="col" className="h-10 border-b border-(--border) px-3 text-left font-medium">
                {header}
              </th>
            ))}
            <th scope="col" className="data h-10 border-b border-(--border) px-3 text-right font-medium">
              On hand (all warehouses)
            </th>
            <th scope="col" className="h-10 border-b border-(--border) px-3 text-left font-medium">
              Recall
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((candidate) => {
            const availability = candidateAvailability(candidate, mode, recallId);
            const selectable = availability.kind === 'selectable';
            const add = recallId === undefined && candidate.sameCodeOnOpenRecall !== null && selectable ? renderAdd?.(candidate) : null;
            return (
              <tr key={candidate.batchId} data-batch-id={candidate.batchId} className="h-10 border-b border-(--border) last:border-b-0">
                <td className="px-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    aria-label={`Recall lot ${candidate.batchCode} of ${candidate.skuCode}`}
                    checked={selectable && selected.has(candidate.batchId)}
                    disabled={disabled || !selectable}
                    onChange={() => onToggle(candidate.batchId)}
                  />
                </td>
                <td className="px-3">
                  <span className="flex flex-col gap-0.5">
                    <span className="font-mono text-xs">{candidate.batchCode}</span>
                    {candidate.match === 'normalised' && (
                      <StatusChip tone="warning" glyph="≈" className="w-fit" data-testid="similar-code">
                        {SIMILAR_CODE_LABEL}
                      </StatusChip>
                    )}
                  </span>
                </td>
                <td className="px-3">
                  <span className="flex flex-col">
                    <span className="font-mono text-xs">{candidate.skuCode}</span>
                    <span className="text-xs text-(--muted-foreground)">{candidate.skuName}</span>
                  </span>
                </td>
                <td className="px-3 text-xs">{candidate.expiryDate === null ? '—' : istDateLabel(candidate.expiryDate)}</td>
                <td className="px-3 text-xs">{candidateStatusLabel(candidate)}</td>
                <td className="data px-3 text-right">{recallQuantity(candidate.onHand, candidate.uom)}</td>
                <td className="px-3 text-xs">
                  {availability.kind === 'on-recall' ? (
                    <span data-testid="already-on-recall">Already on {availability.code}</span>
                  ) : availability.kind === 'on-this-recall' ? (
                    <span>On this recall</span>
                  ) : (
                    <span className="flex flex-col items-start gap-1">
                      {availability.note !== null && <span className="text-(--muted-foreground)">{availability.note}</span>}
                      {candidate.sameCodeOnOpenRecall !== null && recallId === undefined && (
                        <span className="text-(--muted-foreground)">Same code on {candidate.sameCodeOnOpenRecall}</span>
                      )}
                      {add}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
