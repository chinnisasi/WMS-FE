'use client';

import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';

import type {
  ReportingFigureDto,
  ReportingOverviewResponse,
  ReportingWindowedFigureDto,
} from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { drillHref, drillLinkText } from '@/lib/drill-routes';
import {
  asOfLabel,
  countingSinceNote,
  currentTime,
  failuresLabel,
  formatFigure,
  isOverviewStale,
  lagLabel,
  sevenDayCaption,
  STALE_AFTER_MS,
  staleReason,
  syncHealthLabel,
  syncReasonText,
  type FigureKind,
} from '@/lib/overview';
import { useOutboundWarehouses } from '@/lib/use-outbound-orders';
import { useReportingOverview } from '@/lib/use-reporting-overview';
import { readActiveWarehouseId, subscribeActiveWarehouse } from '@/lib/warehouses';

import { FeedbackBanner } from '@/components/feedback/banner';
import { KpiTile } from '@/components/kpi-tile';
import { buttonClass, ReadFailure } from '@/components/outbound/shell';

/**
 * The Overview (story 9-1, FR-27): ten live KPI tiles for one warehouse —
 * the sidebar switcher's pick, else the tenant's first.
 *
 * Every number is the server's projection; this surface formats and links,
 * nothing more. It reads once per warehouse and again only on Refresh — no
 * polling (UX-DR19). "As of HH:MM" is always on screen, and the amber stale
 * banner appears when a tile is unavailable or the read is over 5 minutes
 * old against the render-time clock.
 */
export function OverviewDashboard({ health }: { health: string }) {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Overview</h1>
        <p className="mt-1 text-sm text-(--muted-foreground)">
          Every figure is a projection of the warehouse&apos;s own records — a number, or Unavailable. Select a
          figure's "Open …" link to see the rows behind it.
        </p>
      </div>
      {sessioned === null ? null : sessioned ? (
        <OverviewSessioned />
      ) : (
        <div className="text-sm text-(--muted-foreground)">
          Sign in to see the dashboard —{' '}
          <Link href="/login" className="text-(--primary) underline underline-offset-2">
            go to sign in
          </Link>
          .
        </div>
      )}
      <p className="text-xs text-(--muted-foreground)" data-testid="api-health">
        API health: <span className="data">{health}</span>
      </p>
    </section>
  );
}

function OverviewSessioned() {
  const warehouses = useOutboundWarehouses();
  const tenantId = warehouses.state === 'ready' ? warehouses.data.tenantId : null;
  const items = warehouses.state === 'ready' ? warehouses.data.items : [];
  const activeId = useSyncExternalStore(
    subscribeActiveWarehouse,
    () => (tenantId === null ? null : readActiveWarehouseId(tenantId)),
    () => null,
  );
  // The pick when it still belongs to this tenant, else the first warehouse
  // (the outbound surface's rule). Resolved before the overview hook so the
  // hook is keyed on exactly the warehouse shown.
  const warehouseId =
    activeId !== null && items.some((w) => w.id === activeId) ? activeId : (items[0]?.id ?? null);
  const overview = useReportingOverview(warehouses.state === 'ready' ? warehouseId : null);

  if (warehouses.state === 'loading') {
    return <div className="text-sm text-(--muted-foreground)">Loading warehouses…</div>;
  }
  if (warehouses.state === 'failed') {
    return <ReadFailure word="Warehouses unavailable" reason={warehouses.reason} onRetry={warehouses.reload} />;
  }
  if (warehouseId === null) {
    return (
      <div className="text-sm text-(--muted-foreground)" data-testid="overview-empty">
        No warehouse yet — the dashboard reads one.{' '}
        <Link href="/settings" className="text-(--primary) underline underline-offset-2">
          Create a warehouse in Settings
        </Link>
        .
      </div>
    );
  }
  const warehouse = items.find((w) => w.id === warehouseId);

  if (overview.state === 'loading') {
    return <div className="text-sm text-(--muted-foreground)">Loading the overview…</div>;
  }
  if (overview.state === 'failed') {
    return <ReadFailure word="Overview unavailable" reason={overview.reason} onRetry={overview.reload} />;
  }
  return (
    <OverviewTiles
      data={overview.data}
      warehouseLabel={warehouse === undefined ? null : `${warehouse.code} ${warehouse.name}`}
      onRefresh={overview.reload}
    />
  );
}

function OverviewTiles({
  data,
  warehouseLabel,
  onRefresh,
}: {
  data: ReportingOverviewResponse;
  warehouseLabel: string | null;
  onRefresh: () => void;
}) {
  // The age arm of the stale check is judged at render, so something must
  // render when the read crosses 5 minutes: ONE timer per response, at
  // asOf + 5 min, that only re-renders (never refetches). A new response
  // (Refresh, a warehouse switch) or unmount clears it.
  const [, setAgedTick] = useState(0);
  useEffect(() => {
    const at = Date.parse(data.asOf);
    if (Number.isNaN(at)) return;
    const wait = at + STALE_AFTER_MS - currentTime() + 1;
    if (wait <= 0) return;
    const timer = setTimeout(() => setAgedTick((n) => n + 1), wait);
    return () => clearTimeout(timer);
  }, [data]);
  const stale = isOverviewStale(data, currentTime());
  const t = data.tiles;
  const d7From = data.window.d7From;
  const refresh = (
    <button type="button" onClick={onRefresh} className={buttonClass}>
      Refresh
    </button>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-(--muted-foreground)">{warehouseLabel ?? ''}</span>
        <span className="flex items-center gap-3">
          <span className="data" data-testid="as-of">
            {asOfLabel(data.asOf)}
          </span>
          {stale ? null : refresh}
        </span>
      </div>
      {stale ? (
        <FeedbackBanner tone="warning" word="Figures may be stale" reason={staleReason(data)} action={refresh} />
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Dock-to-stock (median)"
          {...windowedTile(t.dockToStock.medianMinutes, 'minutes', t.dockToStock.state)}
        >
          <SubFigures state={t.dockToStock.state}>
            <LiveLine label="Awaiting putaway" figure={t.dockToStock.awaitingPutaway} kind="count" />
          </SubFigures>
        </KpiTile>

        <KpiTile label="Pick lines" {...windowedTile(t.pickRate.pickLines, 'count', t.pickRate.state)}>
          <SubFigures state={t.pickRate.state}>
            <LiveLine label="Last hour" figure={t.pickRate.lastHour} kind="count" />
          </SubFigures>
        </KpiTile>

        <KpiTile label="Short-picked lines" {...windowedTile(t.shortPicks.shortLines, 'count', t.shortPicks.state)} />

        <KpiTile
          label="Over-receipts"
          {...windowedTile(t.grnVariances.overReceipts, 'count', t.grnVariances.state)}
        >
          <SubFigures state={t.grnVariances.state}>
            <LiveLine label="Pending decision" figure={t.grnVariances.pendingOverReceipts} kind="count" />
            <WindowedLine label="Blind GRNs" figure={t.grnVariances.blindGrns} kind="count" />
          </SubFigures>
        </KpiTile>

        <KpiTile
          label="Order accuracy — defects (SM-3)"
          {...windowedTile(t.orderAccuracy.defectsPer1000, 'per1000', t.orderAccuracy.state)}
        >
          <SubFigures state={t.orderAccuracy.state}>
            <WindowedLine label="Short lines" figure={t.orderAccuracy.shortLines} kind="count" />
            <WindowedLine label="Pack mismatches" figure={t.orderAccuracy.packFailures} kind="count" />
            <WindowedLine label="Dispatched lines" figure={t.orderAccuracy.dispatchedLines} kind="count" />
            <CountingNote countingSince={t.orderAccuracy.countingSince} d7From={d7From} />
          </SubFigures>
        </KpiTile>

        <KpiTile
          label="Oversell — backordered channel orders (SM-4)"
          {...windowedTile(t.oversell.backorderedOrders, 'count', t.oversell.state)}
        >
          <SubFigures state={t.oversell.state}>
            <WindowedLine label="Prevented (refused)" figure={t.oversell.prevented} kind="count" />
            <CountingNote countingSince={t.oversell.countingSince} d7From={d7From} />
          </SubFigures>
        </KpiTile>

        <KpiTile
          label="Open expiry alerts"
          {...liveTile(t.expiryAlerts.openExpiryUpcoming, 'count', t.expiryAlerts.state)}
        >
          <SubFigures state={t.expiryAlerts.state}>
            <LiveLine label="Open aged-stock alerts" figure={t.expiryAlerts.openAged} kind="count" />
            <WindowedLine label="Raised" figure={t.expiryAlerts.raised} kind="count" />
          </SubFigures>
        </KpiTile>

        <KpiTile
          label="Channel sync health"
          value={t.syncHealth.connections === null ? '' : String(t.syncHealth.connections.length)}
          href={drillHref(t.syncHealth.drill)}
          linkText={drillLinkText(t.syncHealth.drill.apiPath) ?? undefined}
          unavailable={t.syncHealth.state === 'unavailable'}
          secondary="connected channels"
        >
          {t.syncHealth.state === 'unavailable' || t.syncHealth.connections === null ? null : t.syncHealth
              .connections.length === 0 ? (
            <p className="mt-2 text-xs text-(--muted-foreground)">No channel ingests into this warehouse.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1 text-xs" data-testid="sync-connections">
              {t.syncHealth.connections.map((c) => {
                const reason = syncReasonText(c.reason);
                return (
                  <li key={c.integrationId} data-health={c.health}>
                    <span className="font-medium">{c.provider}</span> · {syncHealthLabel(c.health)}
                    {reason === null ? null : <> — {reason}</>}
                    <span className="block text-(--muted-foreground)">
                      {lagLabel(c.lagSeconds)} · {failuresLabel(c.ingestFailures24h)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </KpiTile>

        <KpiTile
          label="Ready to dispatch"
          {...liveTile(t.dispatchPipeline.readyToDispatch, 'count', t.dispatchPipeline.state)}
        >
          <SubFigures state={t.dispatchPipeline.state}>
            <LiveLine label="Accepted, not packed" figure={t.dispatchPipeline.accepted} kind="count" />
            <LiveLine label="Labelled, not manifested" figure={t.dispatchPipeline.labelledNotManifested} kind="count" />
            <WindowedLine label="Orders dispatched" figure={t.dispatchPipeline.ordersDispatched} kind="count" />
          </SubFigures>
        </KpiTile>

        <KpiTile
          label="E-way bills by gateway (SM-8)"
          {...windowedTile(t.sm8.gatewayShare, 'percent', t.sm8.state)}
        >
          <SubFigures state={t.sm8.state}>
            <WindowedLine label="No manual pricing (invoices)" figure={t.sm8.noManualPricingShare} kind="percent" />
            <WindowedLine label="Eligible bills" figure={t.sm8.eligible} kind="count" />
          </SubFigures>
        </KpiTile>
      </div>
    </div>
  );
}

/** A windowed primary figure: today's value, the 7-day line beneath, today's drill as the link. */
function windowedTile(figure: ReportingWindowedFigureDto, kind: FigureKind, state: 'ok' | 'unavailable') {
  return {
    value: formatFigure(figure.today.value, kind),
    valueCaption: 'Today (IST)',
    secondary: sevenDayCaption(figure.d7.value, kind),
    href: drillHref(figure.today.drill),
    linkText: drillLinkText(figure.today.drill.apiPath) ?? undefined,
    unavailable: state === 'unavailable',
  };
}

/** A live primary figure: no window, so no 7-day line. */
function liveTile(figure: ReportingFigureDto, kind: FigureKind, state: 'ok' | 'unavailable') {
  return {
    value: formatFigure(figure.value, kind),
    href: drillHref(figure.drill),
    linkText: drillLinkText(figure.drill.apiPath) ?? undefined,
    unavailable: state === 'unavailable',
  };
}

/** An unavailable tile shows no sub-figures at all — every value would be null. */
function SubFigures({ state, children }: { state: 'ok' | 'unavailable'; children: React.ReactNode }) {
  if (state === 'unavailable') return null;
  return <div className="mt-2 flex flex-col gap-1 text-xs">{children}</div>;
}

function MaybeLink({
  drill,
  label,
  children,
}: {
  drill: ReportingFigureDto['drill'];
  label: string;
  children: React.ReactNode;
}) {
  const href = drillHref(drill);
  if (href === null) return <span>{children}</span>;
  return (
    <Link
      href={href}
      aria-label={`${drillLinkText(drill.apiPath)} — ${label}`}
      className="underline-offset-2 hover:underline"
    >
      {children}
    </Link>
  );
}

function LiveLine({ label, figure, kind }: { label: string; figure: ReportingFigureDto; kind: FigureKind }) {
  const text = formatFigure(figure.value, kind);
  return (
    <div>
      <span className="text-(--muted-foreground)">{label}: </span>
      <MaybeLink drill={figure.drill} label={`${label}: ${text}`}>
        <span className="data">{text}</span>
      </MaybeLink>
    </div>
  );
}

function WindowedLine({
  label,
  figure,
  kind,
}: {
  label: string;
  figure: ReportingWindowedFigureDto;
  kind: FigureKind;
}) {
  const today = formatFigure(figure.today.value, kind);
  const d7 = formatFigure(figure.d7.value, kind);
  return (
    <div>
      <span className="text-(--muted-foreground)">{label}: </span>
      <MaybeLink drill={figure.today.drill} label={`${label} today: ${today}`}>
        <span className="data">{today}</span>
      </MaybeLink>
      <span className="text-(--muted-foreground)"> · 7 days: </span>
      <MaybeLink drill={figure.d7.drill} label={`${label}, 7 days: ${d7}`}>
        <span className="data">{d7}</span>
      </MaybeLink>
    </div>
  );
}

function CountingNote({ countingSince, d7From }: { countingSince: string | null; d7From: string }) {
  const note = countingSinceNote(countingSince, d7From);
  if (note === null) return null;
  return (
    <p className="text-(--muted-foreground)" data-testid="counting-since">
      {note.since}
      {note.partial === null ? null : <span className="block">{note.partial}</span>}
    </p>
  );
}
