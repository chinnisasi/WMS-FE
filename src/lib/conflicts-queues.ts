import type { SearchParamsRecord } from '@/lib/drill';

/**
 * Story 9-2 — the Conflicts & Reviews queue ids, and the plain (non-drill)
 * `?queue=<id>` parameter that opens the page on one queue: a notification
 * for a pending adjustment, an over-threshold variance or a rejected device
 * op lands on ITS queue, not the default over-receipts tab.
 *
 * `queue` is not a drill key: a link carrying it has no `list`, so
 * `parseDrill` reads it as a plain visit (null). Anything but one known id
 * is ignored — the page opens on its default queue.
 */
export const CONFLICTS_QUEUES = ['over-receipts', 'variances', 'adjustment-pendings', 'excursions', 'rejected-ops'] as const;
export type ConflictsQueue = (typeof CONFLICTS_QUEUES)[number];

export function parseQueueParam(params: SearchParamsRecord): ConflictsQueue | null {
  const value = params.queue;
  return typeof value === 'string' && (CONFLICTS_QUEUES as readonly string[]).includes(value) ? (value as ConflictsQueue) : null;
}

/** The link that opens Conflicts & Reviews on one queue. */
export function conflictsQueueHref(queue: ConflictsQueue): string {
  return `/conflicts?queue=${queue}`;
}
