'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListUsers } from '@/lib/api/client';
import type { UserResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { USERS_CHANGED_EVENT } from '@/lib/users';

export interface UsersPage {
  items: readonly UserResponse[];
  /** Cursor for the DataTable's Next button; null on the last page. */
  nextCursor: string | null;
}

/**
 * One cursor-paginated page of the tenant's users (Story 1.5), wired to the
 * DataTable's Prev/Next — the same external-store pattern as use-catalog.ts.
 * Reads are open to every tenant member (reads are never gated); the invite
 * form and inline role changes live in users-card.tsx and bump the revision
 * via USERS_CHANGED_EVENT or the returned `reload`.
 */
export function useUsers(): (UsersPage & { onCursor: (cursor: string | null) => void; reload: () => void }) | null {
  // `null` = unknown (server render) or signed out.
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [requested, setRequested] = useState<{ tenantId: string; cursor: string | null } | null>(null);
  const activeCursor =
    requested !== null && requested.tenantId === tenantId ? requested.cursor : null;
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<{
    tenantId: string;
    requested: string | null;
    page: UsersPage;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(USERS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(USERS_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchApiListUsers(
          tenantId,
          activeCursor === null ? undefined : { cursor: activeCursor },
        );
        if (!cancelled) {
          setPage({ tenantId, requested: activeCursor, page: result });
        }
      } catch {
        // Quiet chrome on failure — the render-time key check hides stale data.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null) return;
      setRequested({ tenantId, cursor });
    },
    [tenantId],
  );
  const reload = useCallback(() => setRevision((r) => r + 1), []);

  if (
    tenantId === null ||
    page === null ||
    page.tenantId !== tenantId ||
    page.requested !== activeCursor
  ) {
    return null;
  }
  return { ...page.page, onCursor, reload };
}