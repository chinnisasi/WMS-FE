'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import type { FreightLoadListRowDto } from '@/lib/api/generated';
import { istDateTimeLabel } from '@/lib/audit-exports';
import {
  FREIGHT_MODE_SHORT,
  FREIGHT_VIEWS,
  FREIGHT_VIEW_LABEL,
  LOAD_STATUS_TONE,
  LOAD_STATUS_WORD,
  capacityCell,
  clientCodesLabel,
  loadedWords,
  type FreightLoadsListView,
} from '@/lib/freight';
import { useActiveClient } from '@/lib/use-active-client';
import { useFreightLoads } from '@/lib/use-freight';
import { roleHasCapability } from '@/lib/users';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import { FreightLoadDetail } from '@/components/outbound/freight-load-detail';
import { FreightLoadDrawer } from '@/components/outbound/freight-load-drawer';
import type { OutboundSurfaceProps } from '@/components/outbound/outbound';
import { primaryClass, ReadFailure, rowButtonClass, Section } from '@/components/outbound/shell';
import { ClientFilterChip } from '@/components/shared/client-filter-chip';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusChip } from '@/components/shared/status-chip';

/** The in-place URL write for `?open=` (a plain parameter beside `?tab=freight`, guide §1.8). */
function writeOpen(loadId: string | null): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  params.set('tab', 'freight');
  if (loadId === null) params.delete('open');
  else params.set('open', loadId);
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
}

/** `?open=` of the Freight tab, when it is a load id. */
function openOf(params: { get(name: string): string | null } | null): string | null {
  if (params === null || params.get('tab') !== 'freight') return null;
  const open = params.get('open');
  return open !== null && /^[0-9a-f-]{36}$/i.test(open) ? open : null;
}

/** The live URL on mount (outside the App Router `useSearchParams` is null — tests, a plain render). */
function readOpen(): string | null {
  return typeof window === 'undefined' ? null : openOf(new URLSearchParams(window.location.search));
}

const EMPTY_WORDS: Readonly<Record<FreightLoadsListView, string>> = {
  open: 'No truck is loading — start a new load for packed B2B orders.',
  dispatched: 'No truck has left yet.',
  'pod-pending': 'Every departed consignment has its delivery recorded.',
  'delivery-exceptions': 'No consignment was refused or delivered short.',
  cancelled: 'No load was cancelled.',
};

/**
 * Story 4-9a (A30) — the Freight tab (`/outbound?tab=freight`): the
 * warehouse's freight loads by view (Open, Dispatched, POD pending,
 * Delivery exceptions, Cancelled), filtered by the shell's client switcher.
 * A load opens in a detail drawer (`?open=<loadId>`); **New load**
 * (`dispatch.execute`, hidden without it) opens the create drawer.
 */
export function FreightLoadsCard({ tenantId, warehouseId, warehouseLabel, role }: OutboundSurfaceProps) {
  const canDispatch = roleHasCapability(role, 'dispatch.execute');
  const canManage = roleHasCapability(role, 'orders.manage');
  const active = useActiveClient();
  const [view, setView] = useState<FreightLoadsListView>('open');
  const loads = useFreightLoads(warehouseId, view, active.filter);
  // A soft navigation (Pack & Dispatch's "Open load") changes `?open=` without a remount: follow it at render (guide §1.5).
  const urlOpen = openOf(useSearchParams());
  const [seenUrlOpen, setSeenUrlOpen] = useState<string | null>(urlOpen);
  const [openId, setOpenId] = useState<string | null>(() => urlOpen ?? readOpen());
  const [creating, setCreating] = useState(false);
  // A child drawer with a write in flight: nothing here may replace it (guide §2.4).
  const [childBusy, setChildBusy] = useState(false);
  if (urlOpen !== seenUrlOpen) {
    setSeenUrlOpen(urlOpen);
    if (urlOpen !== null && !childBusy) {
      setOpenId(urlOpen);
      setCreating(false);
    }
  }
  const [banner, setBanner] = useState<{ word: string; reason: string } | null>(null);
  const [pageEpoch, setPageEpoch] = useState(0);

  function open(loadId: string | null) {
    if (childBusy) return;
    setOpenId(loadId);
    writeOpen(loadId);
    if (loadId !== null) setCreating(false);
  }

  const columns: readonly DataTableColumn<FreightLoadListRowDto>[] = [
    {
      key: 'code',
      header: 'Load',
      render: (row) => (
        <button type="button" onClick={() => open(row.id)} className="font-mono text-xs text-(--primary) underline underline-offset-2" data-testid={`open-load-${row.code}`}>
          {row.code}
        </button>
      ),
    },
    { key: 'transporter', header: 'Transporter', render: (row) => `${row.transporterName} · ${FREIGHT_MODE_SHORT[row.mode]}` },
    { key: 'vehicle', header: 'Vehicle', render: (row) => <span className="font-mono text-xs">{row.vehicleNumber ?? '—'}</span>, priority: 2 },
    { key: 'clients', header: 'Clients', render: (row) => clientCodesLabel(row), priority: 2 },
    { key: 'consignments', header: 'Orders', numeric: true, render: (row) => row.consignmentCount },
    {
      key: 'packages',
      header: 'Packages',
      render: (row) => (
        <span className="flex flex-col gap-0.5">
          <span>{loadedWords(row.packages.loaded, row.packages.total)}</span>
          {row.packages.total > 0 && (
            <meter className="h-1.5 w-24" min={0} max={row.packages.total} value={row.packages.loaded} aria-label={loadedWords(row.packages.loaded, row.packages.total)} />
          )}
        </span>
      ),
    },
    {
      key: 'weight',
      header: 'Weight',
      render: (row) => {
        const cell = capacityCell(row.grossWeightGrams, row.capacityKg);
        return (
          <span className="flex flex-col gap-0.5">
            <span className="data">{cell.text}</span>
            {cell.over && <StatusChip tone="warning">Over capacity</StatusChip>}
          </span>
        );
      },
      priority: 3,
    },
    { key: 'status', header: 'Status', render: (row) => <StatusChip tone={LOAD_STATUS_TONE[row.status]}>{LOAD_STATUS_WORD[row.status]}</StatusChip> },
    {
      key: 'departed',
      header: 'Departed (IST)',
      render: (row) => (row.dispatchedAt === null ? '—' : <time dateTime={row.dispatchedAt}>{istDateTimeLabel(row.dispatchedAt)}</time>),
      priority: 3,
    },
    {
      key: 'delivered',
      header: 'Delivered',
      numeric: true,
      render: (row) => (row.status === 'dispatched' ? `${row.deliveredCount} of ${row.consignmentCount}` : '—'),
    },
  ];

  return (
    <Section title="Freight">
      <div className="text-(--muted-foreground)">
        {warehouseLabel === null ? 'Trucks for B2B orders.' : `${warehouseLabel} — one truck per load: FTL or LTL, any clients’ orders, loaded by scanning every carton and pallet.`}
      </div>
      {canDispatch && (
        <div>
          <button type="button" className={primaryClass} onClick={() => {
              if (childBusy) return;
              open(null);
              setCreating(true);
            }}
            disabled={creating || childBusy}
            data-testid="new-freight-load">
            New load
          </button>
        </div>
      )}
      {banner !== null && <FeedbackBanner tone="accepted" word={banner.word} reason={banner.reason} />}
      {creating && (
        <FreightLoadDrawer
          mode="create"
          tenantId={tenantId}
          warehouseId={warehouseId}
          load={null}
          onBusy={setChildBusy}
          onClose={() => setCreating(false)}
          onSaved={(saved) => {
            setChildBusy(false);
            setCreating(false);
            setBanner({ word: `${saved.code} created`, reason: `${saved.consignments.length} order${saved.consignments.length === 1 ? '' : 's'} on the load.` });
            setView('open');
            loads.onCursor(null);
            setPageEpoch((e) => e + 1);
            open(saved.id);
          }}
        />
      )}
      {openId !== null && (
        <FreightLoadDetail key={openId} tenantId={tenantId} warehouseId={warehouseId} loadId={openId} canDispatch={canDispatch} canManage={canManage} onBusy={setChildBusy} onClose={() => open(null)} />
      )}
      <div role="tablist" aria-label="Freight views" className="flex flex-wrap gap-2">
        {FREIGHT_VIEWS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={`${rowButtonClass} ${view === id ? 'bg-(--muted) font-medium' : ''}`}
            onClick={() => {
              setView(id);
              setPageEpoch((e) => e + 1);
            }}
            data-testid={`freight-view-${id}`}
          >
            {FREIGHT_VIEW_LABEL[id]}
          </button>
        ))}
      </div>
      <ClientFilterChip active={active} tenantName={active.tenantName} />
      {loads.state === 'failed' ? (
        <ReadFailure word="Loads unavailable" reason={loads.reason} onRetry={loads.reload} />
      ) : (
        <DataTable<FreightLoadListRowDto>
          key={`${view}#${pageEpoch}#${loads.epoch}`}
          columns={columns}
          rows={loads.state === 'ready' ? loads.data.items : []}
          nextCursor={loads.state === 'ready' ? loads.data.nextCursor : null}
          onCursor={loads.onCursor}
          emptyMessage={<EmptyState kind={view === 'open' ? 'first-use' : 'cleared'}>{EMPTY_WORDS[view]}</EmptyState>}
          loading={loads.state === 'loading' ? 'Loading loads…' : undefined}
          rowNoun={{ one: 'load', many: 'loads' }}
        />
      )}
    </Section>
  );
}
