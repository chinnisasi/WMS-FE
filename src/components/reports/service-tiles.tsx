'use client';

import type { ServiceReportDto } from '@/lib/api/generated';
import { asOfLabel } from '@/lib/overview';
import { serviceTiles } from '@/lib/service-report';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

import { KpiTile } from '@/components/kpi-tile';
import { ReadFailure } from '@/components/outbound/shell';

export const serviceInputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
export const serviceLabelClass = 'text-sm font-medium';
export const serviceButtonClass =
  'rounded-sm border border-(--border) px-3 py-2 text-sm hover:bg-(--muted) disabled:opacity-40';

/**
 * Story 21-8 — the period inputs both service surfaces share: an inclusive
 * IST `from`/`to`. Presentational only — the caller parses the draft
 * (`parseServicePeriod`) and sends nothing while a problem stands.
 */
export function ServicePeriodInputs({
  from,
  to,
  onFrom,
  onTo,
}: {
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
}) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className={serviceLabelClass}>From (IST)</span>
        <input type="date" className={serviceInputClass} value={from} aria-label="Report from" onChange={(event) => onFrom(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={serviceLabelClass}>To (IST)</span>
        <input type="date" className={serviceInputClass} value={to} aria-label="Report to" onChange={(event) => onTo(event.target.value)} />
      </label>
    </>
  );
}

/**
 * Story 21-8 — the three service tiles (dock-to-stock, pick accuracy,
 * dispatch timeliness), each naming the population it is computed over.
 * Presentational and shared by the operator `/reports` section and the
 * portal Service page — it mounts no hook and issues no request, so the
 * portal never runs operator code through it. Null reads "No data".
 */
export function ServiceReportView({
  report,
  failureWord,
}: {
  report: ResourceState<ServiceReportDto> & Reloadable;
  failureWord: string;
}) {
  if (report.state === 'loading') return <div className="text-(--muted-foreground)">Loading the report…</div>;
  if (report.state === 'failed') return <ReadFailure word={failureWord} reason={report.reason} onRetry={report.reload} />;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-(--muted-foreground)" data-testid="service-as-of">
        {asOfLabel(report.data.asOf)}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {serviceTiles(report.data).map((tile) => (
          <KpiTile key={tile.label} label={tile.label} value={tile.value} secondary={tile.secondary}>
            <div className="mt-1 text-xs text-(--muted-foreground)">{tile.caption}</div>
            {tile.notes.map((note) => (
              <div key={note} className="data mt-1 text-xs text-(--muted-foreground)">
                {note}
              </div>
            ))}
          </KpiTile>
        ))}
      </div>
    </div>
  );
}
