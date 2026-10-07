'use client';

import { useState } from 'react';

import type { ClientDto, RateCardDto, UsageLineDto, UsageSegmentDto } from '@/lib/api/generated';
import {
  ESTIMATE_NOTICE,
  billedTotalLabel,
  defaultUsageMonth,
  parseCustomRange,
  periodInProgress,
  segmentHeading,
  segmentTotalLabel,
  storageNotice,
  usageAmountLabel,
  usageChargeLabel,
  usageMonthLabel,
  usageMonthOptions,
  usageQuantityLabel,
  usageRateLabel,
  usageUnitLabel,
} from '@/lib/usage';
import { useClientUsage } from '@/lib/use-client-usage';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { ReadFailure } from '@/components/outbound/shell';

const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
const labelClass = 'text-sm font-medium';
const rowButtonClass =
  'rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40';

const CUSTOM = 'custom';

type UsageRow = UsageLineDto & { readonly id: string };

function columnsFor(segment: UsageSegmentDto): DataTableColumn<UsageRow>[] {
  return [
    { key: 'charge', header: 'Charge', render: (line) => usageChargeLabel(line) },
    { key: 'uom', header: 'Base unit', render: (line) => usageUnitLabel(line) },
    { key: 'quantity', header: 'Quantity', numeric: true, render: (line) => usageQuantityLabel(line) },
    { key: 'rate', header: 'Rate', numeric: true, render: (line) => usageRateLabel(line) },
    { key: 'amount', header: 'Amount', numeric: true, render: (line) => usageAmountLabel(line, segment) },
  ];
}

/**
 * Story 21-4 — the Usage section of one client's rate cards: pick a month
 * (from the client's creation to the current month, which is marked in
 * progress) or a custom range of at most 366 days, and read each charge's
 * quantity per rate-card segment with its rate and amount — or "Not billed".
 * Storage reads as base-unit-days per base unit. Everything is an estimate
 * until invoiced and excludes GST; the server decides every figure, and this
 * only lays them out. Member-open, like the cards. The month list runs on
 * the SERVER's clock (the rate-cards read's `asOf`).
 */
export function ClientUsage({ client, cards, asOf }: { client: ClientDto; cards: readonly RateCardDto[]; asOf: string }) {
  const months = usageMonthOptions(client.createdAt, asOf);
  const fallback = defaultUsageMonth(months);
  const [choice, setChoice] = useState<string>(fallback?.value ?? CUSTOM);
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const month = months.find((option) => option.value === choice) ?? null;
  const period = choice === CUSTOM ? custom : month === null ? null : { from: month.from, to: month.to };
  const usage = useClientUsage(client.id, period);

  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = parseCustomRange(draftFrom, draftTo);
    if (parsed.period === null) {
      setProblem(parsed.problem);
      return;
    }
    setProblem(null);
    setCustom(parsed.period);
  };

  return (
    <div aria-label="Usage" role="region" className="flex flex-col gap-2 border-t border-(--border) pt-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="font-medium">Usage</h3>
        <div className="text-(--muted-foreground)">{ESTIMATE_NOTICE}</div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-56 flex-col gap-1">
          <span className={labelClass}>Period</span>
          <select className={inputClass} value={choice} aria-label="Usage period" onChange={(event) => setChoice(event.target.value)}>
            {months.map((option) => (
              <option key={option.value} value={option.value}>
                {usageMonthLabel(option)}
              </option>
            ))}
            <option value={CUSTOM}>Custom range…</option>
          </select>
        </label>
        {choice === CUSTOM ? (
          <form onSubmit={apply} aria-label="Custom usage range" className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>From (IST)</span>
              <input type="date" className={inputClass} value={draftFrom} aria-label="Usage from" onChange={(event) => setDraftFrom(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>To (IST)</span>
              <input type="date" className={inputClass} value={draftTo} aria-label="Usage to" onChange={(event) => setDraftTo(event.target.value)} />
            </label>
            <button type="submit" className={rowButtonClass}>
              Show
            </button>
          </form>
        ) : null}
      </div>
      {problem !== null ? (
        <div role="alert" className="text-xs text-(--destructive)">
          {problem}
        </div>
      ) : null}

      {period === null ? (
        <div className="text-(--muted-foreground)">Pick a start and an end date (at most 366 days).</div>
      ) : usage.state === 'failed' ? (
        <ReadFailure word="Usage unavailable" reason={usage.reason} onRetry={usage.reload} />
      ) : usage.state === 'loading' ? (
        <div className="text-(--muted-foreground)">Loading usage…</div>
      ) : (
        <div className="flex flex-col gap-3">
          <div aria-label="Usage notices" className="flex flex-col gap-0.5 text-(--muted-foreground)">
            <span>{storageNotice(usage.data)}</span>
            {periodInProgress(usage.data) ? <span>In progress — the counts run to now.</span> : null}
          </div>
          {usage.data.segments.map((segment) => (
            <div key={`${segment.fromDate}-${segment.rateCardId ?? 'none'}`} className="flex flex-col gap-1">
              <div className="font-medium">{segmentHeading(segment, cards)}</div>
              <DataTable<UsageRow>
                columns={columnsFor(segment)}
                rows={segment.lines.map((line, index) => ({ ...line, id: `${segment.fromDate}-${index}` }))}
                emptyMessage="Nothing metered."
              />
              <div className="data text-right">{segmentTotalLabel(segment)}</div>
            </div>
          ))}
          <div className="data text-right font-medium">{billedTotalLabel(usage.data)}</div>
        </div>
      )}
    </div>
  );
}
