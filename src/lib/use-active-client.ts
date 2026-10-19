'use client';

import { useSyncExternalStore } from 'react';

import {
  clientFilterOf,
  readActiveClientId,
  resolveActiveClient,
  subscribeActiveClient,
  type ActiveClient,
  type ClientFilter,
} from '@/lib/active-client';
import { fetchApiListClients } from '@/lib/api/client';
import type { ClientDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { CLIENTS_CHANGED_EVENT } from '@/lib/clients';
import { readReason } from '@/lib/outbound-orders';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

/* ── the one shared clients read ────────────────────────────────────── */

/**
 * Story 1-5a — ONE clients resource for the shell's switcher and every
 * screen's `useActiveClient()`, so they can never disagree (a client shown
 * picked in the switcher while the screen lists all clients with no chip).
 * A module-level external store:
 *
 * - it reads while anything subscribes, and forgets everything when the
 *   last subscriber leaves (no state outlives the mounted app — or a test);
 * - one read per tenant: a later subscriber joins the current state;
 * - a tenant change (the session event) reads the new tenant's clients;
 * - `CLIENTS_CHANGED_EVENT` re-reads, keeping the last-good list on screen
 *   until the answer lands (a refetch never flips the lists to pending);
 * - `reload()` (the switcher's Retry) clears to loading and reads again.
 *
 * A sequence number drops a superseded answer (frontend guide §1.3).
 */
type ClientsSnapshot = { readonly tenantId: string | null; readonly state: ResourceState<readonly ClientDto[]> };

const LOADING: ResourceState<readonly ClientDto[]> = { state: 'loading' };
const EMPTY: ClientsSnapshot = { tenantId: null, state: LOADING };
let snapshot: ClientsSnapshot = EMPTY;
let readSeq = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function readClients(tenantId: string, clear: boolean): void {
  const seq = ++readSeq;
  if (clear || snapshot.tenantId !== tenantId) {
    snapshot = { tenantId, state: LOADING };
    emit();
  }
  fetchApiListClients(tenantId).then(
    (list) => {
      if (seq !== readSeq) return;
      snapshot = { tenantId, state: { state: 'ready', data: list.items } };
      emit();
    },
    (error: unknown) => {
      if (seq !== readSeq) return;
      snapshot = { tenantId, state: { state: 'failed', reason: readReason(error, 'the clients') } };
      emit();
    },
  );
}

/** Follow the session: read for a new tenant, forget on sign-out. */
function syncTenant(): void {
  const tenantId = readSession()?.tenant.id ?? null;
  if (tenantId === snapshot.tenantId) return;
  if (tenantId === null) {
    readSeq++;
    snapshot = EMPTY;
    emit();
    return;
  }
  readClients(tenantId, true);
}

function onClientsChanged(): void {
  const tenantId = readSession()?.tenant.id ?? null;
  if (tenantId !== null) readClients(tenantId, false);
}

let unsubscribeSession: (() => void) | null = null;

function subscribeClients(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    unsubscribeSession = subscribeSession(syncTenant);
    window.addEventListener(CLIENTS_CHANGED_EVENT, onClientsChanged);
    syncTenant();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      unsubscribeSession?.();
      unsubscribeSession = null;
      window.removeEventListener(CLIENTS_CHANGED_EVENT, onClientsChanged);
      readSeq++;
      snapshot = EMPTY;
    }
  };
}

function reloadClients(): void {
  const tenantId = readSession()?.tenant.id ?? null;
  if (tenantId !== null) readClients(tenantId, true);
}

/** The shared clients read (the house `ResourceState & Reloadable` shape). */
export function useSharedClients(): ResourceState<readonly ClientDto[]> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const current = useSyncExternalStore(subscribeClients, () => snapshot, () => EMPTY);
  // A snapshot of another tenant (the session moved; the store re-reads) is loading here.
  const state = tenantId !== null && current.tenantId === tenantId ? current.state : LOADING;
  return { ...state, reload: reloadClients };
}

/** What a screen holds: the active client, the filter its list hooks take, and the one clients read. */
export type ActiveClientState = ActiveClient & {
  /** Pass to every list hook on the screen (never to a drill, a lookup or a write-side picker). */
  readonly filter: ClientFilter;
  /** The screen's one clients read — reuse it for client columns and pickers rather than reading again. */
  readonly clients: ResourceState<readonly ClientDto[]> & Reloadable;
  readonly tenantName: string | null;
};

/**
 * Story 1-5a — the active client for one screen, over the one shared clients
 * read the switcher also shows. Call it ONCE per screen and
 * pass `filter` down to the list hooks (one clients read per screen). Never
 * writes storage (decision 8): a stored id absent from the loaded list reads
 * as all clients and stays stored.
 */
export function useActiveClient(): ActiveClientState {
  const clients = useSharedClients();
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const userId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.id ?? null,
    () => null,
  );
  const tenantName = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.name ?? null,
    () => null,
  );
  const storedId = useSyncExternalStore(
    subscribeActiveClient,
    () => (tenantId === null || userId === null ? null : readActiveClientId(tenantId, userId)),
    () => null,
  );
  const active = resolveActiveClient(storedId, clients);
  return { ...active, filter: clientFilterOf(active), clients, tenantName };
}
