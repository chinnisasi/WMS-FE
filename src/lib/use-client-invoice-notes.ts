'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import {
  fetchApiClientInvoiceNoteRegister,
  fetchApiClientInvoiceNotes,
  fetchApiGetClientInvoiceNote,
  fetchApiNotePolicy,
} from '@/lib/api/client';
import type { InvoiceNotesResponse, NoteDto, NotePolicyResponse, NoteRegisterResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { CLIENT_INVOICES_CHANGED_EVENT } from '@/lib/client-invoices';
import { noteReadReason } from '@/lib/client-invoice-notes';
import type { Reloadable, ResourceState } from '@/lib/use-outbound-orders';

/**
 * Story 5-6a — the credit / debit note reads, in the house shape (the
 * `use-client-invoices.ts` detail hook): session identity through
 * `useSyncExternalStore`, a `useEffect` fetch with `cancelled` in the
 * cleanup, stale results filtered at render, an explicit `failed` arm. Every
 * read refetches on `CLIENT_INVOICES_CHANGED_EVENT` (a note moves its
 * invoice's document value, and a settling credit moves its status).
 */

function useTenantId(): string | null {
  return useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
}

function useRevision(): [number, () => void] {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(CLIENT_INVOICES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CLIENT_INVOICES_CHANGED_EVENT, onChange);
  }, []);
  return [revision, () => setRevision((r) => r + 1)];
}

/** A keyed read: `key` null reads nothing; a superseded success stays on screen while its refetch is in flight. */
function useKeyedRead<T>(key: string | null, read: (tenantId: string) => Promise<T>): ResourceState<T> & Reloadable {
  const tenantId = useTenantId();
  const [revision, bump] = useRevision();
  const [result, setResult] = useState<{ scope: string; revision: number; state: ResourceState<T> } | null>(null);
  const scope = `${tenantId ?? ''}|${key ?? ''}`;

  useEffect(() => {
    if (tenantId === null || key === null) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await read(tenantId);
        if (!cancelled) setResult({ scope, revision, state: { state: 'ready', data } });
      } catch (error) {
        if (!cancelled) setResult({ scope, revision, state: { state: 'failed', reason: noteReadReason(error) } });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `read` is rebuilt every render; the scope and the revision decide a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, key, scope, revision]);

  const reload = useCallback(() => {
    setResult(null);
    bump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = tenantId !== null && key !== null && result !== null && result.scope === scope && (result.revision === revision || result.state.state === 'ready');
  return { ...(current ? result.state : ({ state: 'loading' } as const)), reload };
}

/** One invoice's notes (drafts included) and its document value after the issued ones. */
export function useInvoiceNotes(invoiceId: string | null): ResourceState<InvoiceNotesResponse> & Reloadable {
  return useKeyedRead(invoiceId, (tenantId) => fetchApiClientInvoiceNotes(tenantId, invoiceId!));
}

/** One note, with its lines, the copied party and the original invoice. */
export function useClientInvoiceNote(noteId: string | null): ResourceState<NoteDto> & Reloadable {
  return useKeyedRead(noteId, (tenantId) => fetchApiGetClientInvoiceNote(tenantId, noteId!));
}

export interface NoteRegisterQuery {
  readonly gstin: string;
  readonly from: string;
  readonly to: string;
  readonly kind: 'credit' | 'debit' | null;
  readonly status: 'issued' | 'void' | null;
}

/** One page of the notes register; `cursor` null is the first page. */
export function useNoteRegister(query: NoteRegisterQuery | null, cursor: string | null): ResourceState<NoteRegisterResponse> & Reloadable {
  const key = query === null ? null : `${JSON.stringify(query)}|${cursor ?? ''}`;
  return useKeyedRead(key, (tenantId) =>
    fetchApiClientInvoiceNoteRegister(tenantId, {
      gstin: query!.gstin,
      from: query!.from,
      to: query!.to,
      ...(query!.kind === null ? {} : { kind: query!.kind }),
      ...(query!.status === null ? {} : { status: query!.status }),
      ...(cursor === null ? {} : { cursor }),
    }),
  );
}

/** The tenant's credit-note maker/checker setting. */
export function useNotePolicy(): ResourceState<NotePolicyResponse> & Reloadable {
  return useKeyedRead('policy', (tenantId) => fetchApiNotePolicy(tenantId));
}
