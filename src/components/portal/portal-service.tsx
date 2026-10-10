'use client';

import { useState } from 'react';

import { defaultServicePeriod, parseServicePeriod } from '@/lib/service-report';
import { usePortalService, usePortalWarehouses } from '@/lib/use-portal';

import { Section } from '@/components/outbound/shell';
import {
  ServicePeriodInputs,
  ServiceReportView,
  serviceButtonClass,
  serviceInputClass,
  serviceLabelClass,
} from '@/components/reports/service-tiles';

const ALL_WAREHOUSES = '';

/**
 * Story 21-8 — the portal's Service page: how the operation performed for
 * this client over an inclusive IST period (default: the last 30 days ending
 * today, IST) — the SAME three tiles, from the same server read, as the
 * operator's `/reports` section for this client. The warehouse filter shows
 * only when the tenant has more than one warehouse (`portal/warehouses` —
 * every tenant warehouse, reused deliberately). Every request is a portal
 * route; the client is the session's, never a parameter.
 */
export function PortalService() {
  const [initial] = useState(() => defaultServicePeriod(Date.now()));
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [warehouseId, setWarehouseId] = useState<string>(ALL_WAREHOUSES);
  const warehouses = usePortalWarehouses();
  const items = warehouses.state === 'ready' ? warehouses.data : [];
  const showWarehouses = items.length > 1;
  const activeWarehouse = showWarehouses && items.some((w) => w.warehouseId === warehouseId) ? warehouseId : ALL_WAREHOUSES;
  const parsed = parseServicePeriod(from, to);
  const report = usePortalService(parsed.period, activeWarehouse === ALL_WAREHOUSES ? null : activeWarehouse);

  return (
    <Section title="Service">
      <div className="flex flex-wrap items-end gap-2">
        <ServicePeriodInputs from={from} to={to} onFrom={setFrom} onTo={setTo} />
        {showWarehouses ? (
          <label className="flex min-w-48 flex-col gap-1">
            <span className={serviceLabelClass}>Warehouse</span>
            <select
              className={serviceInputClass}
              value={activeWarehouse}
              aria-label="Report warehouse"
              onChange={(event) => setWarehouseId(event.target.value)}
            >
              <option value={ALL_WAREHOUSES}>All warehouses</option>
              {items.map((warehouse) => (
                <option key={warehouse.warehouseId} value={warehouse.warehouseId}>
                  {warehouse.warehouseName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="button" className={serviceButtonClass} onClick={report.reload} disabled={parsed.period === null}>
          Refresh
        </button>
      </div>
      {parsed.problem !== null ? (
        <div role="alert" className="text-xs text-(--destructive)">
          {parsed.problem}
        </div>
      ) : (
        <ServiceReportView report={report} failureWord="Report unavailable" />
      )}
    </Section>
  );
}
