'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';

import { readSession, subscribeSession } from '@/lib/auth';
import { NOTIFICATIONS_EMPTY, type NotificationEntry } from '@/lib/notifications';
import { useNotificationLookups, useNotifications } from '@/lib/use-notifications';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { ReadFailure, Section } from '@/components/shared/surface';
import { NotificationEntryLink } from './notification-entry';

/**
 * Story 9-2 — `/notifications`: every entry the caller can act on, newest
 * raised first, on the keyset cursor (`DataTable` Prev/Next). The same entry
 * rendering as the bell's panel; the empty state is the API's empty page —
 * this client mirrors no routing table. Reading this page does not clear
 * the bell's dot: only opening the panel records an open.
 */
export function NotificationsView() {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );
  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <Section title="Notifications">
        <div className="text-(--muted-foreground)">
          Sign in to read your notifications —{' '}
          <Link href="/login" className="text-(--primary) underline underline-offset-2">
            go to sign in
          </Link>
          .
        </div>
      </Section>
    );
  }
  return <NotificationsTable />;
}

function NotificationsTable() {
  const entries = useNotifications();
  const lookups = useNotificationLookups();
  const nowMs = entries.state === 'ready' ? entries.data.fetchedAtMs : 0;

  const columns: readonly DataTableColumn<NotificationEntry>[] = [
    {
      key: 'entry',
      header: 'Notification',
      render: (entry) => <NotificationEntryLink entry={entry} lookups={lookups} nowMs={nowMs} />,
    },
  ];

  return (
    <Section title="Notifications">
      <div className="text-(--muted-foreground)">
        Everything waiting on a decision you can make, newest first. An entry resolves itself when its source clears.
      </div>
      {entries.state === 'failed' ? (
        <ReadFailure word="Notifications unavailable" reason={entries.reason} onRetry={entries.reload} />
      ) : (
        // Mounted while a page loads: its Prev/Next cursor is internal state.
        <DataTable<NotificationEntry>
          columns={columns}
          rows={entries.state === 'ready' ? entries.data.items : []}
          nextCursor={entries.state === 'ready' ? entries.data.nextCursor : null}
          onCursor={entries.onCursor}
          emptyMessage={entries.state === 'loading' ? 'Loading notifications…' : NOTIFICATIONS_EMPTY}
        />
      )}
    </Section>
  );
}
