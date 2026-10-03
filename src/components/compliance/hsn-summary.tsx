'use client';

import { useState, useSyncExternalStore } from 'react';

import type { HsnSummaryDto, HsnSummaryGstinDto, HsnSummaryRowDto, HsnSummarySectionDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { downloadText } from '@/lib/csv';
import {
  AATO_NOTE,
  hsnCsvFilename,
  hsnSummaryCsv,
  issueShortfallNote,
  istMonthOf,
  mixedUnitsNote,
  periodOptionLabel,
  periodOptions,
  qtyMilliExact,
  type HsnSection,
  type PeriodOption,
} from '@/lib/hsn-summary';
import { formatRupees, gstRateLabel } from '@/lib/invoices';
import { useHsnSummary, useHsnSummaryGstins } from '@/lib/use-hsn-summary';

import { FeedbackBanner } from '@/components/feedback/banner';
import { ReadFailure, Section, buttonClass, labelClass, selectClass } from '@/components/outbound/shell';

/**
 * The /compliance HSN summary (story 8-2a): GSTR-1 Table 12's per-HSN
 * figures over the ISSUED invoices of one supplier GSTIN in one month or FY
 * quarter, B2B and B2C, with one CSV per section in the GSTN offline-tool
 * layout. Read-only and open to every member — every figure is the server's
 * exact paise sum; the client only formats it.
 */

export function HsnSummary() {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );
  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <Section title="HSN summary">
        <div className="text-(--muted-foreground)">Sign in to read the HSN summary.</div>
      </Section>
    );
  }
  return <HsnSummarySessioned />;
}

function HsnSummarySessioned() {
  const gstins = useHsnSummaryGstins();
  if (gstins.state === 'loading') {
    return (
      <Section title="HSN summary">
        <div className="text-(--muted-foreground)">Loading…</div>
      </Section>
    );
  }
  if (gstins.state === 'failed') {
    return (
      <Section title="HSN summary">
        <ReadFailure word="Not loaded" reason={gstins.reason} onRetry={gstins.reload} />
      </Section>
    );
  }
  if (gstins.data.length === 0) {
    return (
      <Section title="HSN summary">
        <div className="text-(--muted-foreground)">
          No invoice has been issued yet. The HSN summary covers issued invoices only — it fills in as invoices issue.
        </div>
      </Section>
    );
  }
  return <HsnSummaryPicker gstins={gstins.data} />;
}

function HsnSummaryPicker({ gstins }: { gstins: readonly HsnSummaryGstinDto[] }) {
  const [chosenGstin, setChosenGstin] = useState<string | null>(null);
  // Keyed derivation (guide §1.5): a chosen GSTIN that is no longer listed
  // falls back to the first, and a period chosen for another GSTIN is ignored.
  const entry = gstins.find((g) => g.gstin === chosenGstin) ?? gstins[0]!;
  const [chosenPeriod, setChosenPeriod] = useState<{ gstin: string; period: string } | null>(null);
  // `now` is read once per mount: the "in progress" mark is a label, and a
  // re-render must not move the option list under the viewer.
  const [now] = useState(() => Date.now());
  const options = periodOptions(entry, now);
  const all: PeriodOption[] = [...options.months, ...options.quarters];
  // Default: the IST month of this GSTIN's LAST issue — the latest month
  // with data. The current (in-progress) month is still offered and labelled,
  // but is usually empty early on, so it is not the default.
  const lastMonth = istMonthOf(entry.lastIssuedAt);
  const defaultPeriod = `${lastMonth.year}-${String(lastMonth.month0 + 1).padStart(2, '0')}`;
  const period =
    chosenPeriod !== null && chosenPeriod.gstin === entry.gstin && all.some((o) => o.value === chosenPeriod.period)
      ? chosenPeriod.period
      : defaultPeriod;
  const summary = useHsnSummary(entry.gstin, period);

  return (
    <Section title="HSN summary">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Supplier GSTIN</span>
          <select
            className={selectClass}
            value={entry.gstin}
            onChange={(event) => setChosenGstin(event.target.value)}
            aria-label="Supplier GSTIN"
          >
            {gstins.map((g) => (
              <option key={g.gstin} value={g.gstin}>
                {g.gstin}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Period</span>
          <select
            className={selectClass}
            value={period}
            onChange={(event) => setChosenPeriod({ gstin: entry.gstin, period: event.target.value })}
            aria-label="Period"
          >
            <optgroup label="Months">
              {options.months.map((o) => (
                <option key={o.value} value={o.value}>
                  {periodOptionLabel(o)}
                </option>
              ))}
            </optgroup>
            <optgroup label="FY quarters">
              {options.quarters.map((o) => (
                <option key={o.value} value={o.value}>
                  {periodOptionLabel(o)}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>
      <p className="text-xs text-(--muted-foreground)">
        Issued invoices only, by IST issue date. Each GSTIN files its own return. {AATO_NOTE}
      </p>
      {summary.state === 'loading' && <div className="text-(--muted-foreground)">Loading…</div>}
      {summary.state === 'failed' && <ReadFailure word="Not loaded" reason={summary.reason} onRetry={summary.reload} />}
      {summary.state === 'ready' && <SummaryBody summary={summary.data} />}
    </Section>
  );
}

function SummaryBody({ summary }: { summary: HsnSummaryDto }) {
  if (summary.totals.invoiceCount === 0) {
    return (
      <div className="text-(--muted-foreground)" data-testid="hsn-empty">
        No invoice was issued under {summary.gstin} in this period.
      </div>
    );
  }
  const shortfall = issueShortfallNote(summary.issueLines, formatRupees);
  return (
    <div className="flex flex-col gap-4">
      {shortfall !== null && <FeedbackBanner tone="rejected" word="HSN issues" reason={shortfall} />}
      <SectionTable title="B2B — registered recipients" section="b2b" data={summary.b2b} summary={summary} />
      <SectionTable title="B2C — unregistered recipients" section="b2c" data={summary.b2c} summary={summary} />
      <div className="text-sm" data-testid="hsn-grand-total">
        All issued invoices: <span className="data">{summary.totals.invoiceCount}</span> · taxable{' '}
        <span className="data">{formatRupees(summary.totals.taxablePaise)}</span> · GST{' '}
        <span className="data">{formatRupees(summary.totals.gstPaise)}</span>
      </div>
      {summary.issueLines.length > 0 && <IssueLines summary={summary} />}
    </div>
  );
}

const th = 'px-2 py-1 text-left font-medium';
const thNum = 'px-2 py-1 text-right font-medium data';
const td = 'px-2 py-1';
const tdNum = 'px-2 py-1 text-right data';

function SectionTable({ title, section, data, summary }: { title: string; section: HsnSection; data: HsnSummarySectionDto; summary: HsnSummaryDto }) {
  const exportable = data.rows.filter((row) => !row.hsnIssue).length;
  function download() {
    downloadText(hsnCsvFilename(section, summary.gstin, summary.period.label), hsnSummaryCsv(data.rows, section));
  }
  return (
    <div className="flex flex-col gap-2" data-testid={`hsn-${section}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{title}</h3>
        <button type="button" className={buttonClass} onClick={download} disabled={exportable === 0}>
          Download {section.toUpperCase()} CSV
        </button>
      </div>
      {data.rows.length === 0 ? (
        <div className="text-(--muted-foreground)">No {section.toUpperCase()} invoice in this period.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-(--border)">
                <th className={th}>HSN</th>
                <th className={th}>UQC</th>
                <th className={thNum}>Quantity</th>
                <th className={thNum}>Rate</th>
                <th className={thNum}>Taxable</th>
                <th className={thNum}>IGST</th>
                <th className={thNum}>CGST</th>
                <th className={thNum}>SGST/UTGST</th>
                <th className={thNum}>Total value</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <Row key={`${row.hsn ?? ''}|${row.uqc}|${row.gstBps}`} row={row} />
              ))}
              <tr className="border-t border-(--border) font-medium" data-testid={`hsn-${section}-totals`}>
                <td className={td} colSpan={4}>
                  Total · {data.totals.invoiceCount} {data.totals.invoiceCount === 1 ? 'invoice' : 'invoices'}
                </td>
                <td className={tdNum}>{formatRupees(data.totals.taxablePaise)}</td>
                <td className={tdNum}>{formatRupees(data.totals.igstPaise)}</td>
                <td className={tdNum}>{formatRupees(data.totals.cgstPaise)}</td>
                <td className={tdNum}>{formatRupees(data.totals.sgstPaise)}</td>
                <td className={tdNum}>{formatRupees(data.totals.totalValuePaise)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ row }: { row: HsnSummaryRowDto }) {
  const mixed = mixedUnitsNote(row);
  return (
    <tr className="border-b border-(--border)" data-hsn-issue={row.hsnIssue ? 'true' : undefined}>
      <td className={td}>
        <span className="font-mono text-xs">{row.hsn ?? '(blank)'}</span>
        {row.hsnIssue && (
          <span className="ml-2 text-xs text-(--warning)" data-testid="hsn-issue-flag">
            ⚠ HSN issue — not in CSV
          </span>
        )}
      </td>
      <td className={td}>
        <span className="font-mono text-xs">{row.uqc}</span>
        <span className="ml-1 text-xs text-(--muted-foreground)">({row.sourceUoms.join(', ')})</span>
        {mixed !== null && (
          <span className="block text-xs text-(--warning)" data-testid="hsn-mixed-units">
            ⚠ {mixed}
          </span>
        )}
      </td>
      <td className={tdNum}>{qtyMilliExact(row.qtyMilli)}</td>
      <td className={tdNum}>{gstRateLabel(row.gstBps)}</td>
      <td className={tdNum}>{formatRupees(row.taxablePaise)}</td>
      <td className={tdNum}>{formatRupees(row.igstPaise)}</td>
      <td className={tdNum}>{formatRupees(row.cgstPaise)}</td>
      <td className={tdNum}>{formatRupees(row.sgstPaise)}</td>
      <td className={tdNum}>{formatRupees(row.totalValuePaise)}</td>
    </tr>
  );
}

function IssueLines({ summary }: { summary: HsnSummaryDto }) {
  return (
    <div className="flex flex-col gap-2" data-testid="hsn-issue-lines">
      <h3 className="font-medium">Lines with a blank or malformed HSN</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-(--border)">
              <th className={th}>Invoice</th>
              <th className={th}>Section</th>
              <th className={th}>SKU</th>
              <th className={th}>HSN on invoice</th>
              <th className={th}>Catalog HSN now</th>
              <th className={thNum}>Value</th>
            </tr>
          </thead>
          <tbody>
            {summary.issueLines.map((line, i) => (
              <tr key={`${line.invoiceId}-${line.skuCode}-${i}`} className="border-b border-(--border)">
                <td className={td}>
                  <span className="font-mono text-xs">{line.invoiceNo}</span>
                </td>
                <td className={td}>{line.section.toUpperCase()}</td>
                <td className={td}>
                  <span className="font-mono text-xs">{line.skuCode}</span>
                </td>
                <td className={td}>
                  <span className="font-mono text-xs">{line.hsn ?? '(blank)'}</span>
                </td>
                <td className={td}>
                  <span className="font-mono text-xs">{line.catalogHsn ?? '(none)'}</span>
                </td>
                <td className={tdNum}>{formatRupees(line.valuePaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
