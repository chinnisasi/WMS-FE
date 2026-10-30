'use client';

import { useState } from 'react';

import type { FreightCandidatesStatus } from '@/lib/api/client';
import type { FreightCandidateDto } from '@/lib/api/generated';
import { FREIGHT_LIMITS, MAX_FREIGHT_CANDIDATES, candidateGateNote, kgLabel, packagesWords, selectionTotals } from '@/lib/freight';
import { useSharedClients } from '@/lib/use-active-client';
import { useFreightCandidates, type FreightCandidateFilters } from '@/lib/use-freight';

import { FeedbackBanner } from '@/components/feedback/banner';
import { inputClass, ReadFailure, rowButtonClass, selectClass } from '@/components/outbound/shell';
import { StatusChip } from '@/components/shared/status-chip';

const STATUS_LABEL: Readonly<Record<FreightCandidatesStatus, string>> = {
  packed: 'Packed only',
  accepted: 'Not packed yet',
  all: 'Packed and not packed',
};

/**
 * Story 4-9a (A30) — the orders that may go on a truck: the candidates read
 * walked to the end (≤ 2,000) under the applied filters (client, state, city,
 * pincode, packed / accepted), multi-select with a running total of
 * packages, pallets and weight against the capacity. A row whose 4-6a gate
 * blocks is selectable but marked — it can be loaded, not sent.
 */
export function FreightCandidatesPicker({
  warehouseId,
  initialClientId,
  selected,
  onChange,
  capacityKg,
  disabled = false,
  maxSelectable = FREIGHT_LIMITS.consignments,
}: {
  warehouseId: string;
  initialClientId: string | null;
  selected: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
  capacityKg: number | null;
  disabled?: boolean;
  /** How many more orders this load can take (100 less its live consignments). */
  maxSelectable?: number;
}) {
  const clients = useSharedClients();
  const [draft, setDraft] = useState<FreightCandidateFilters>({ clientId: initialClientId, state: '', city: '', pincode: '', status: 'packed' });
  const [applied, setApplied] = useState<FreightCandidateFilters>(draft);
  const candidates = useFreightCandidates(warehouseId, applied);
  const items = candidates.state === 'ready' ? candidates.data.items : [];
  const totals = selectionTotals(items, selected, capacityKg);

  function toggle(row: FreightCandidateDto) {
    const next = new Set(selected);
    if (next.has(row.orderId)) next.delete(row.orderId);
    else if (next.size < maxSelectable) next.add(row.orderId);
    onChange(next);
  }

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled} data-testid="freight-candidates">
      <legend className="text-sm font-medium">Orders for this truck</legend>
      <form
        className="grid grid-cols-2 gap-2 md:grid-cols-5"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(draft);
        }}
      >
        <select
          aria-label="Client"
          className={selectClass}
          value={draft.clientId ?? ''}
          onChange={(e) => setDraft({ ...draft, clientId: e.target.value === '' ? null : e.target.value })}
        >
          <option value="">All clients</option>
          {clients.state === 'ready' &&
            clients.data.map((client) => (
              <option key={client.id} value={client.id}>
                {client.code}
              </option>
            ))}
        </select>
        <input aria-label="State" placeholder="State" className={inputClass} value={draft.state} onChange={(e) => setDraft({ ...draft, state: e.target.value })} />
        <input aria-label="City" placeholder="City" className={inputClass} value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
        <input aria-label="Pincode" placeholder="Pincode" className={inputClass} value={draft.pincode} onChange={(e) => setDraft({ ...draft, pincode: e.target.value })} />
        <select aria-label="Packed" className={selectClass} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as FreightCandidatesStatus })}>
          {(Object.keys(STATUS_LABEL) as FreightCandidatesStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <div className="col-span-2 md:col-span-5">
          <button type="submit" className={rowButtonClass}>
            Apply filters
          </button>
        </div>
      </form>
      <div className="text-xs" role="status" data-testid="freight-selection-totals">
        {totals.orders} selected · {packagesWords(totals.cartons + totals.pallets, totals.pallets)} · {totals.weightKnown ? kgLabel(totals.grams) : `${kgLabel(totals.grams)} + unweighed`}
        {capacityKg !== null && ` of ${capacityKg.toLocaleString('en-IN')} kg`}
        {totals.over && (
          <>
            {' '}
            <StatusChip tone="warning">Over capacity</StatusChip>
          </>
        )}
      </div>
      {candidates.state === 'failed' && <ReadFailure word="Orders unavailable" reason={candidates.reason} onRetry={candidates.reload} />}
      {candidates.state === 'loading' && <div className="text-xs text-(--muted-foreground)">Loading the orders…</div>}
      {candidates.state === 'ready' && candidates.data.truncated && (
        <FeedbackBanner tone="warning" word="Showing the first orders" reason={`At most ${MAX_FREIGHT_CANDIDATES.toLocaleString('en-IN')} orders are listed — packed orders first. Narrow the filters to find the rest.`} />
      )}
      {candidates.state === 'ready' && items.length === 0 && <div className="text-xs text-(--muted-foreground)">No order matches — every packed order is on a truck, handed over or labelled, or the filters are too narrow.</div>}
      {items.length > 0 && (
        <ul className="flex max-h-80 flex-col divide-y divide-(--border) overflow-y-auto rounded-sm border border-(--border)">
          {items.map((row) => {
            const note = candidateGateNote(row);
            const checked = selected.has(row.orderId);
            return (
              <li key={row.orderId} className="flex items-start gap-2 px-2 py-1.5" data-testid={`candidate-${row.orderLabel}`}>
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={checked}
                  disabled={!checked && selected.size >= maxSelectable}
                  onChange={() => toggle(row)}
                  aria-label={`Select ${row.orderLabel}`}
                />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span>
                    <span className="font-medium">{row.orderLabel}</span> · {row.clientCode} · {[row.consignee.name, row.consignee.city, row.consignee.pincode].filter((v) => v !== null && v !== '').join(', ') || '—'}
                  </span>
                  <span className="text-xs text-(--muted-foreground)">
                    {row.packages.packed ? packagesWords(row.packages.cartons + row.packages.pallets, row.packages.pallets) : 'Not packed yet'} · <span className="data">{kgLabel(row.grossWeightGrams)}</span>
                  </span>
                  {note !== null && (
                    <span>
                      <StatusChip tone="warning">{note}</StatusChip>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {selected.size >= maxSelectable && <div className="text-xs text-(--muted-foreground)">A truck carries at most {FREIGHT_LIMITS.consignments} orders.</div>}
    </fieldset>
  );
}
