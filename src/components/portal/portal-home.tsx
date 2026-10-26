'use client';

import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';

import type { PortalOrderRowDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import {
  asnExpected,
  atLeastCount,
  orderDestination,
  orderReference,
  orderStatusLabel,
  portalCompanyLabel,
  portalDate,
} from '@/lib/portal';
import { defaultServicePeriod } from '@/lib/service-report';
import { ORDER_STATUS_TONE } from '@/lib/status-tone';
import { usePortalAsns, usePortalOrders, usePortalService } from '@/lib/use-portal';

import { KpiTile } from '@/components/kpi-tile';
import { ServiceReportView } from '@/components/reports/service-tiles';
import { PageHeader } from '@/components/shared/page-header';
import { LoadingStatus, SkeletonBar } from '@/components/shared/skeleton';
import { StatusChip } from '@/components/shared/status-chip';
import { ReadFailure, Section, buttonClass, primaryClass } from '@/components/shared/surface';

/**
 * Story UI-1 (UI-PATTERNS §7) — the portal's Home: what a brand's ops person
 * asks first. Three counts, each a door to its list; the last 30 days'
 * service tiles (the Service page's own read); the five newest orders.
 *
 * Every count is read from ONE page of an existing portal list and says so:
 * "3+" when the list has a further page (`atLeastCount`) — never a total the
 * API did not return. A failed read fails its own tile only. Every request
 * is a portal route; the client is the session's, never a parameter.
 */
export function PortalHome() {
  const company = useSyncExternalStore(subscribeSession, () => portalCompanyLabel(readSession()), () => '');
  const accepted = usePortalOrders('accepted');
  const packed = usePortalOrders('ready_to_dispatch');
  const asns = usePortalAsns();
  const recent = usePortalOrders(null);
  const [period] = useState(() => defaultServicePeriod(Date.now()));
  const service = usePortalService(period, null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={company === '' ? 'Home' : `Welcome, ${company}`}
        description="Your stock, orders and shipments at the warehouse — and how the warehouse is performing for you."
        actions={
          <>
            <Link href="/portal/inbound" className={buttonClass}>
              Announce a shipment
            </Link>
            <Link href="/portal/orders" className={primaryClass}>
              Place an order
            </Link>
          </>
        }
      />

      <section aria-labelledby="portal-home-now" className="flex flex-col gap-3">
        <h2 id="portal-home-now" className="text-sm font-medium">
          Right now
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <CountTile
            label="Being prepared"
            caption="Accepted orders, not yet packed"
            read={accepted}
            count={(items) => items.length}
            href="/portal/orders"
            linkText="Open Orders"
          />
          <CountTile
            label="Packed, awaiting dispatch"
            caption="Ready to hand to the carrier"
            read={packed}
            count={(items) => items.length}
            href="/portal/orders"
            linkText="Open Orders"
          />
          <CountTile
            label="Shipments expected"
            caption="Announced to the warehouse, not fully received"
            read={asns}
            count={(items) => items.filter(asnExpected).length}
            href="/portal/inbound"
            linkText="Open Inbound"
          />
        </div>
      </section>

      <Section title="Service — last 30 days">
        <ServiceReportView report={service} failureWord="Report unavailable" />
      </Section>

      <Section
        title="Recent orders"
        action={
          <Link href="/portal/orders" className="text-xs text-(--primary) underline underline-offset-2">
            All orders
          </Link>
        }
      >
        <RecentOrders read={recent} />
      </Section>
    </div>
  );
}

type ListRead<T> =
  | { readonly state: 'loading'; readonly reload: () => void }
  | { readonly state: 'failed'; readonly reason: string; readonly reload: () => void }
  | { readonly state: 'ready'; readonly data: { readonly items: readonly T[]; readonly nextCursor: string | null }; readonly reload: () => void };

function CountTile<T>({
  label,
  caption,
  read,
  count,
  href,
  linkText,
}: {
  label: string;
  caption: string;
  read: ListRead<T>;
  count: (items: readonly T[]) => number;
  href: string;
  linkText: string;
}) {
  if (read.state === 'loading') {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-(--border) bg-(--card) p-4" data-testid="skeleton-tile">
        <LoadingStatus label={`Loading ${label.toLowerCase()}…`} />
        <SkeletonBar className="h-3 w-1/2" />
        <SkeletonBar className="h-7 w-1/3" />
        <SkeletonBar className="h-3 w-2/3" />
      </div>
    );
  }
  if (read.state === 'failed') {
    return (
      <div className="rounded-md border border-(--border) p-4">
        <ReadFailure word={`${label} not loaded`} reason={read.reason} onRetry={read.reload} />
      </div>
    );
  }
  return (
    <KpiTile
      label={label}
      value={atLeastCount(count(read.data.items), read.data.nextCursor)}
      secondary={caption}
      href={href}
      linkText={linkText}
    />
  );
}

function RecentOrders({ read }: { read: ListRead<PortalOrderRowDto> }) {
  if (read.state === 'loading') {
    return (
      <div className="flex flex-col gap-2" aria-hidden>
        {Array.from({ length: 3 }, (_, i) => (
          <SkeletonBar key={i} className="h-4 w-full" />
        ))}
      </div>
    );
  }
  if (read.state === 'failed') return <ReadFailure word="Orders not loaded" reason={read.reason} onRetry={read.reload} />;
  const rows = read.data.items.slice(0, 5);
  if (rows.length === 0) {
    return (
      <p className="text-(--muted-foreground)">
        No orders yet —{' '}
        <Link href="/portal/orders" className="text-(--primary) underline underline-offset-2">
          place the first one
        </Link>
        .
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-(--border)" data-testid="recent-orders">
      {rows.map((order) => (
        <li key={order.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
          <span className="font-medium">{orderReference(order)}</span>
          <StatusChip tone={ORDER_STATUS_TONE[order.status]}>{orderStatusLabel(order.status)}</StatusChip>
          <span className="text-(--muted-foreground)">{orderDestination(order)}</span>
          <span className="data ml-auto text-xs text-(--muted-foreground)">Placed {portalDate(order.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}
