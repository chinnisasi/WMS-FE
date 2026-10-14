'use client';

import Link from 'next/link';

import {
  istTimeLabel,
  notificationCategory,
  notificationDescription,
  notificationHref,
  notificationResolvedLabel,
  relativeTimeLabel,
  type NotificationEntry,
  type NotificationLookups,
} from '@/lib/notifications';
import { requestAuditExportsRefresh } from '@/lib/audit-exports';

/**
 * Story 9-2 — one notification entry, as the panel and the page both draw
 * it: a link to its source, the category, a one-line description, and the
 * relative time (the IST instant as its title). An OPEN entry is amber (a
 * left rule and the word "Open" — never colour alone); a resolved one is
 * muted, with "Resolved · {resolution}". No action button: acting happens
 * on the source's own screen.
 */
export function NotificationEntryLink({
  entry,
  lookups,
  nowMs,
  onNavigate,
}: {
  entry: NotificationEntry;
  lookups: NotificationLookups;
  nowMs: number;
  onNavigate?: () => void;
}) {
  const resolved = notificationResolvedLabel(entry);
  return (
    <Link
      href={notificationHref(entry)}
      onClick={() => {
        // Story 9-3b: on `/reports` already, the Link's pushState fires no
        // hashchange — ask the mounted exports list to reload and scroll.
        if (entry.sourceType === 'audit-export') requestAuditExportsRefresh();
        onNavigate?.();
      }}
      data-notification={entry.sourceType}
      data-state={resolved === null ? 'open' : 'resolved'}
      className={
        resolved === null
          ? 'block border-l-4 border-(--warning) px-3 py-2 hover:bg-(--muted) focus-visible:outline-2 focus-visible:outline-(--ring)'
          : 'block border-l-4 border-transparent px-3 py-2 text-(--muted-foreground) hover:bg-(--muted) focus-visible:outline-2 focus-visible:outline-(--ring)'
      }
    >
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <span className={resolved === null ? 'font-medium' : ''}>{notificationCategory(entry)}</span>
        <time dateTime={entry.raisedAt} title={istTimeLabel(entry.raisedAt)} className="text-xs text-(--muted-foreground)">
          {relativeTimeLabel(entry.raisedAt, nowMs)}
        </time>
      </span>
      <span className="block text-xs">{notificationDescription(entry, lookups)}</span>
      <span className={resolved === null ? 'block text-xs font-medium text-(--warning)' : 'block text-xs'}>
        {resolved ?? 'Open'}
      </span>
    </Link>
  );
}
