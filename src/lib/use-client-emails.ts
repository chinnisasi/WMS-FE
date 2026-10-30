'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiListClientEmails } from '@/lib/api/client';
import type { ClientEmailLogResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { CLIENT_EMAIL_POLL_MS, clientEmailQueued, clientEmailsReadReason, shouldPollClientEmails } from '@/lib/client-emails';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

/** The log's page size. */
export const CLIENT_EMAILS_PAGE_SIZE = 25;

/**
 * Story 5-2b — one client's email log, in the `useClientContacts` shape: the
 * tenant through the session subscription, a `cancelled` cleanup, the result
 * stamped with its scope (tenant, client, filter, cursor) and filtered at
 * render. It owns the filter and the cursor (IMPLEMENTATION-GUIDE §1.11):
 * a filter change or `reload()` returns to page one and bumps `epoch`, which
 * the table is keyed on so its Prev/Next stack starts empty. `refresh()`
 * re-reads the same page without clearing.
 *
 * While any row on screen is queued (pending / sending) it re-reads every
 * 5 s, for at most 60 s from the first queued read (5-1a decision 8); the
 * window starts afresh once nothing is queued, and on every user action that
 * re-reads (reload, Refresh, a filter or page change) — the timer's own
 * re-reads never extend it.
 */
export function useClientEmails(clientId: string): ResourceState<ClientEmailLogResponse> &
  Reloadable & {
    refresh: () => void;
    problems: boolean;
    setProblems: (problems: boolean) => void;
    setCursor: (cursor: string | null) => void;
    epoch: number;
  } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [problems, setProblemsState] = useState(false);
  const [cursor, setCursorState] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    scope: string;
    state: ResourceState<ClientEmailLogResponse>;
  } | null>(null);
  const scope = `${tenantId}|${clientId}|${problems}|${cursor ?? ''}`;

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    const stamp = `${tenantId}|${clientId}|${problems}|${cursor ?? ''}`;
    (async () => {
      try {
        const data = await fetchApiListClientEmails(tenantId, clientId, { problems, cursor, limit: CLIENT_EMAILS_PAGE_SIZE });
        if (!cancelled) setResult({ scope: stamp, state: { state: 'ready', data } });
      } catch (error) {
        if (!cancelled) setResult({ scope: stamp, state: { state: 'failed', reason: clientEmailsReadReason(error) } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, clientId, problems, cursor, revision]);

  const stale = tenantId === null || result === null || result.scope !== scope;
  const ready = !stale && result.state.state === 'ready' ? result.state.data : null;

  const pollingSince = useRef<number | null>(null);
  useEffect(() => {
    if (ready === null) return;
    const now = Date.now();
    if (!shouldPollClientEmails(ready.items, pollingSince.current, now)) {
      if (!ready.items.some((item) => clientEmailQueued(item.status))) pollingSince.current = null;
      return;
    }
    pollingSince.current ??= now;
    const timer = setTimeout(() => setRevision((r) => r + 1), CLIENT_EMAIL_POLL_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  const reload = useCallback(() => {
    pollingSince.current = null;
    setResult(null);
    setCursorState(null);
    setEpoch((e) => e + 1);
    setRevision((r) => r + 1);
  }, []);
  const refresh = useCallback(() => {
    pollingSince.current = null;
    setRevision((r) => r + 1);
  }, []);
  const setProblems = useCallback((next: boolean) => {
    pollingSince.current = null;
    setProblemsState(next);
    setCursorState(null);
    setEpoch((e) => e + 1);
  }, []);
  const setCursor = useCallback((next: string | null) => {
    pollingSince.current = null;
    setCursorState(next);
  }, []);

  return {
    ...(stale ? ({ state: 'loading' } as const) : result.state),
    reload,
    refresh,
    problems,
    setProblems,
    setCursor,
    epoch,
  };
}
