'use client';

import { useState, useSyncExternalStore } from 'react';

import { readSession, subscribeSession } from '@/lib/auth';
import { defaultServicePeriod, parseServicePeriod, serviceClientOption } from '@/lib/service-report';
import { useClients } from '@/lib/use-clients';
import { useServiceReport } from '@/lib/use-service-report';
import { useTenantWarehouses } from '@/lib/use-tenant-warehouses';

import { ReadFailure, Section } from '@/components/outbound/shell';
import {
  ServicePeriodInputs,
  ServiceReportView,
  serviceButtonClass,
  serviceInputClass,
  serviceLabelClass,
} from '@/components/reports/service-tiles';

const ALL_WAREHOUSES = '';

/**
 * Story 21-8 — the operator `/reports` "Client service" section: pick a
 * client (every status — a suspended client is reportable; the tenant's own
 * reads as the company), an inclusive IST period (default: the last 30 days
 * ending today, IST) and optionally one warehouse, and read the three service
 * tiles. The same facade read the client sees on its portal Service page.
 * A period the server would refuse is never sent — its problem shows
 * instead. Member-open. No polling — Refresh reads again.
 */
export function ClientService() {
  const clients = useClients();
  const warehouses = useTenantWarehouses();
  const tenantName = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.name ?? null,
    () => null,
  );
  const [initial] = useState(() => defaultServicePeriod(Date.now()));
  const [chosenClient, setChosenClient] = useState<string | null>(null);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [warehouseId, setWarehouseId] = useState<string>(ALL_WAREHOUSES);

  const list = clients.state === 'ready' ? clients.data : [];
  // The chosen client while it is still listed, else the first (keyed derivation, no reset effect).
  const clientId = list.find((client) => client.id === chosenClient)?.id ?? list[0]?.id ?? null;
  const warehouseItems = warehouses?.items ?? [];
  // A warehouse that left the list falls back to every warehouse.
  const activeWarehouse = warehouseItems.some((w) => w.id === warehouseId) ? warehouseId : ALL_WAREHOUSES;
  const parsed = parseServicePeriod(from, to);
  const report = useServiceReport(clientId, parsed.period, activeWarehouse === ALL_WAREHOUSES ? null : activeWarehouse);

  return (
    <Section title="Client service">
      {clients.state === 'failed' ? (
        <ReadFailure word="Clients not loaded" reason={clients.reason} onRetry={clients.reload} />
      ) : clients.state === 'loading' ? (
        <div className="text-(--muted-foreground)">Loading clients…</div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-56 flex-col gap-1">
              <span className={serviceLabelClass}>Client</span>
              <select
                className={serviceInputClass}
                value={clientId ?? ''}
                aria-label="Report client"
                onChange={(event) => setChosenClient(event.target.value)}
              >
                {list.map((client) => (
                  <option key={client.id} value={client.id}>
                    {serviceClientOption(client, tenantName)}
                  </option>
                ))}
              </select>
            </label>
            <ServicePeriodInputs from={from} to={to} onFrom={setFrom} onTo={setTo} />
            <label className="flex min-w-48 flex-col gap-1">
              <span className={serviceLabelClass}>Warehouse</span>
              <select
                className={serviceInputClass}
                value={activeWarehouse}
                aria-label="Report warehouse"
                onChange={(event) => setWarehouseId(event.target.value)}
              >
                <option value={ALL_WAREHOUSES}>All warehouses</option>
                {warehouseItems.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className={serviceButtonClass} onClick={report.reload} disabled={parsed.period === null || clientId === null}>
              Refresh
            </button>
          </div>
          {parsed.problem !== null ? (
            <div role="alert" className="text-xs text-(--destructive)">
              {parsed.problem}
            </div>
          ) : clientId === null ? (
            <div className="text-(--muted-foreground)">No clients yet.</div>
          ) : (
            <ServiceReportView report={report} failureWord="Report unavailable" />
          )}
        </>
      )}
    </Section>
  );
}
