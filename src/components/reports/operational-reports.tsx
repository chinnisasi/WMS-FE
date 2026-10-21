'use client';

import { useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiReportFile } from '@/lib/api/client';
import type { ReportFormat, ReportName } from '@/lib/api/client';
import { readSession, subscribeSession } from '@/lib/auth';
import { clientLabel } from '@/lib/clients';
import { downloadBlob } from '@/lib/csv';
import {
  ALL_REPORT_CLIENTS,
  REPORT_FORMAT_LABEL,
  REPORT_ORDER,
  REPORTS,
  reportFilename,
  reportReason,
  resolveReportClient,
  resolveReportWarehouse,
} from '@/lib/reports';
import { defaultServicePeriod, parseServicePeriod } from '@/lib/service-report';
import { useActiveClient } from '@/lib/use-active-client';
import { useTenantWarehouses } from '@/lib/use-tenant-warehouses';

import { FeedbackBanner } from '@/components/feedback/banner';
import { ReadFailure, Section } from '@/components/outbound/shell';
import { ServicePeriodInputs, serviceButtonClass, serviceInputClass, serviceLabelClass } from '@/components/reports/service-tiles';
import { AllClientsNote } from '@/components/shared/client-filter-chip';
import { WarehousesFailure, WarehousesRefreshNote } from '@/components/shared/warehouses-failure';

/**
 * Story 5-3a — the "Operational reports" section at the top of `/reports`:
 * pick a register (stock on hand, the inbound and outbound registers, the
 * stock ledger, batch ageing / near expiry), a warehouse, optionally a
 * client and — for a dated register — an inclusive IST period, and download
 * it as CSV or Excel.
 *
 * Defaults (decision 9): the client is a local pick, else the active switcher
 * client, else All (with the "All clients" note while the switcher names a
 * client); the warehouse is a local pick, else the first one; the period is
 * the last 30 IST days. A snapshot register reads "As of now" and sends no
 * dates. A period the server would refuse is never sent. The file is fetched
 * with the session (a plain link cannot carry the bearer) and named here —
 * CORS hides the server's name. Member-open: every staff role downloads.
 */
export function OperationalReports() {
  const active = useActiveClient();
  const clients = active.clients;
  const warehouses = useTenantWarehouses();
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [report, setReport] = useState<ReportName>('stock-on-hand');
  const [format, setFormat] = useState<ReportFormat>('csv');
  const [pickedClient, setPickedClient] = useState<string | null>(null);
  const [pickedWarehouse, setPickedWarehouse] = useState<string | null>(null);
  const [initial] = useState(() => defaultServicePeriod(Date.now()));
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [busy, setBusy] = useState(false);
  // A pre-render double-click fires both handlers before `disabled` renders.
  const inFlight = useRef(false);
  const [outcome, setOutcome] = useState<{ tone: 'accepted' | 'rejected'; word: string; reason: string } | null>(null);

  const definition = REPORTS[report];
  const clientList = clients.state === 'ready' ? clients.data : [];
  const clientId =
    clients.state === 'ready'
      ? resolveReportClient(pickedClient, active.state === 'client' ? active.client.id : null, clientList.map((c) => c.id))
      : null;
  const client = clientList.find((c) => c.id === clientId) ?? null;
  const warehouseItems = warehouses.state === 'ready' ? warehouses.data.items : [];
  const warehouseId = resolveReportWarehouse(pickedWarehouse, warehouseItems.map((w) => w.id));
  const warehouse = warehouseItems.find((w) => w.id === warehouseId) ?? null;
  const parsed = parseServicePeriod(from, to);
  const period = definition.dated ? parsed.period : null;
  const periodProblem = definition.dated ? parsed.problem : null;
  // Only once the clients read has settled OK (and a stored switcher pick has
  // resolved): a failed read must never silently download every client's rows.
  const clientsSettled = clients.state === 'ready' && active.state !== 'pending';
  const canDownload =
    tenantId !== null && warehouse !== null && clientsSettled && periodProblem === null && (!definition.dated || period !== null) && !busy;

  async function download(): Promise<void> {
    if (inFlight.current || tenantId === null || warehouse === null) return;
    inFlight.current = true;
    setBusy(true);
    setOutcome(null);
    try {
      const blob = await fetchApiReportFile(tenantId, warehouse.id, report, { format, clientId, period });
      const filename = reportFilename({
        report,
        format,
        warehouseCode: warehouse.code,
        clientCode: client?.code ?? null,
        period,
        now: Date.now(),
      });
      downloadBlob(filename, blob);
      setOutcome({ tone: 'accepted', word: 'Downloaded', reason: filename });
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not downloaded', reason: reportReason(error, report) });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Section title="Operational reports">
      <p className="max-w-prose text-(--muted-foreground)">
        Registers of what is in stock, what came in, what went out and every movement — as CSV or Excel, up to 50,000 rows.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-56 flex-col gap-1">
          <span className={serviceLabelClass}>Register</span>
          <select
            className={serviceInputClass}
            value={report}
            aria-label="Register"
            onChange={(event) => {
              setReport(event.target.value as ReportName);
              setOutcome(null);
            }}
          >
            {REPORT_ORDER.map((name) => (
              <option key={name} value={name}>
                {REPORTS[name].label}
              </option>
            ))}
          </select>
        </label>
        {warehouses.state === 'failed' ? (
          <div className="min-w-48">
            <WarehousesFailure state={warehouses} />
          </div>
        ) : (
          <label className="flex min-w-48 flex-col gap-1">
            <span className={serviceLabelClass}>Warehouse</span>
            <select
              className={serviceInputClass}
              value={warehouseId ?? ''}
              aria-label="Register warehouse"
              disabled={warehouseItems.length === 0}
              onChange={(event) => setPickedWarehouse(event.target.value)}
            >
              {warehouses.state === 'loading' && <option value="">Loading warehouses…</option>}
              {warehouses.state === 'ready' && warehouseItems.length === 0 && <option value="">No warehouse yet</option>}
              {warehouseItems.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {warehouses.state === 'ready' && warehouses.data.refreshFailed !== null && (
          <WarehousesRefreshNote reason={warehouses.data.refreshFailed} onRetry={warehouses.reload} />
        )}
        {clients.state === 'failed' ? (
          <div className="min-w-48">
            <ReadFailure word="Clients not loaded — retry before downloading" reason={clients.reason} onRetry={clients.reload} />
          </div>
        ) : (
          <label className="flex min-w-48 flex-col gap-1">
            <span className={serviceLabelClass}>Client</span>
            <select
              className={serviceInputClass}
              value={clientId ?? ALL_REPORT_CLIENTS}
              aria-label="Register client"
              disabled={clients.state === 'loading'}
              onChange={(event) => setPickedClient(event.target.value)}
            >
              <option value={ALL_REPORT_CLIENTS}>All clients</option>
              {clientList.map((c) => (
                <option key={c.id} value={c.id}>
                  {clientLabel(c, active.tenantName)}
                </option>
              ))}
            </select>
          </label>
        )}
        {definition.dated ? (
          <ServicePeriodInputs from={from} to={to} onFrom={setFrom} onTo={setTo} labelPrefix="Register" />
        ) : (
          <div className="flex flex-col gap-1">
            <span className={serviceLabelClass}>Period</span>
            <span className="py-1.5 text-(--muted-foreground)" data-testid="register-as-of-now">
              As of now
            </span>
          </div>
        )}
        <label className="flex flex-col gap-1">
          <span className={serviceLabelClass}>Format</span>
          <select className={serviceInputClass} value={format} aria-label="Register format" onChange={(event) => setFormat(event.target.value as ReportFormat)}>
            {(Object.keys(REPORT_FORMAT_LABEL) as ReportFormat[]).map((f) => (
              <option key={f} value={f}>
                {REPORT_FORMAT_LABEL[f]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={serviceButtonClass} onClick={() => void download()} disabled={!canDownload} aria-busy={busy}>
          {busy ? 'Preparing…' : 'Download'}
        </button>
      </div>
      <p className="text-xs text-(--muted-foreground)">{definition.description}</p>
      {clientId === null && clients.state === 'ready' && <AllClientsNote active={active} title="This register covers every client." />}
      {periodProblem !== null && (
        <div role="alert" className="text-xs text-(--destructive)">
          {periodProblem}
        </div>
      )}
      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}
    </Section>
  );
}
