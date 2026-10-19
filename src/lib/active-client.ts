/**
 * Story 1-5a — the active client: one switcher in the shell (beside the
 * warehouse switcher) that every staff list, stock and stock-history screen
 * reads. The `lib/warehouses.ts` storage shape: a per-viewer localStorage
 * convenience, never a URL parameter, every storage access in try/catch.
 *
 * - **Per tenant and per user** (decision 14): the key carries both ids, so
 *   a shared workstation never inherits another user's filter, and a
 *   re-sign-in as another tenant never reads the previous tenant's pick.
 * - **Cleared on logout** (`clearSession` calls `clearActiveClientId`).
 * - **Never erased by a reader** (decision 8): a stored id absent from the
 *   loaded clients is ignored (lists unfiltered), not removed — only a pick
 *   ("All clients", "Show all clients") or a logout writes it.
 *
 * No imports from the app: `auth.ts` imports this module to clear the pick
 * on logout, so a dependency the other way would be a cycle. The pure
 * derivations and copy below are pinned by `active-client.test.ts`.
 */
import type { ClientDto } from '@/lib/api/generated';
import type { ResourceState } from '@/lib/resource-state';

/** Fired on `window` when the picked client changes in this tab. */
export const ACTIVE_CLIENT_CHANGED_EVENT = 'wms-active-client-changed';

/** Key prefix — the suffix is `<tenantId>:<userId>`. */
export const ACTIVE_CLIENT_STORAGE_KEY = 'wms-active-client';

function activeClientKey(tenantId: string, userId: string): string {
  return `${ACTIVE_CLIENT_STORAGE_KEY}:${tenantId}:${userId}`;
}

export function readActiveClientId(tenantId: string, userId: string): string | null {
  try {
    const id = localStorage.getItem(activeClientKey(tenantId, userId));
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

/** Writes the pick; `null` is "All clients" (the key is removed). */
export function writeActiveClientId(tenantId: string, userId: string, id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(activeClientKey(tenantId, userId));
    else localStorage.setItem(activeClientKey(tenantId, userId), id);
  } catch {
    // private mode — the pick just won't persist
  }
  window.dispatchEvent(new Event(ACTIVE_CLIENT_CHANGED_EVENT));
}

/** Logout: forget this user's pick in this tenant (no event — the session event re-renders everything). */
export function clearActiveClientId(tenantId: string, userId: string): void {
  try {
    localStorage.removeItem(activeClientKey(tenantId, userId));
  } catch {
    // nothing to clear without storage
  }
}

/**
 * React subscription for the picked client — pairs with
 * `useSyncExternalStore`. The storage event covers other tabs (an open tab
 * refilters on a switch, as the warehouse switcher does); the local event
 * covers picks in this tab.
 */
export function subscribeActiveClient(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(ACTIVE_CLIENT_STORAGE_KEY)) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(ACTIVE_CLIENT_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(ACTIVE_CLIENT_CHANGED_EVENT, onChange);
  };
}

/* ── the resolved active client ─────────────────────────────────────── */

/**
 * The active client as a screen sees it:
 * - `pending` — a client is stored and the clients list is still loading:
 *   lists wait (no request), so the first request is never the wrong one;
 * - `client` — the stored client, found in the loaded list;
 * - `all` — nothing stored, a single-client tenant, a stored id absent from
 *   the loaded list, or the clients list failed (decision 8).
 */
export type ActiveClient =
  | { readonly state: 'pending' }
  | { readonly state: 'client'; readonly client: ClientDto }
  | { readonly state: 'all' };

/**
 * What a list hook receives: the client id to send, `null` for all clients,
 * or `CLIENT_PENDING` — a hook given pending sends nothing and reads as
 * loading. A symbol, so no string (a uuid) can ever be mistaken for it.
 */
export const CLIENT_PENDING: unique symbol = Symbol('client-pending');
export type ClientFilter = string | null | typeof CLIENT_PENDING;

/**
 * Whether the client dimension is visible at all: a tenant holding only its
 * own `self` client is the D2C case and sees no client column, no picker, no
 * switcher and no filter. The ONE rule — `lib/clients.ts` re-exports it (it
 * lives here because `clients.ts` cannot be imported from this module).
 */
export function showClients(clients: readonly ClientDto[] | null): boolean {
  return clients !== null && clients.length > 1;
}

export function resolveActiveClient(
  storedId: string | null,
  clients: ResourceState<readonly ClientDto[]>,
): ActiveClient {
  if (storedId === null) return { state: 'all' };
  if (clients.state === 'loading') return { state: 'pending' };
  if (clients.state === 'failed') return { state: 'all' };
  // A single-client tenant (`showClients` false) never filters, even with a stored id.
  if (!showClients(clients.data)) return { state: 'all' };
  const client = clients.data.find((entry) => entry.id === storedId);
  return client === undefined ? { state: 'all' } : { state: 'client', client };
}

/** The filter a list hook receives for an active client. */
export function clientFilterOf(active: ActiveClient): ClientFilter {
  if (active.state === 'pending') return CLIENT_PENDING;
  return active.state === 'client' ? active.client.id : null;
}

/**
 * The filter a hook actually applies: a drilled view ignores the switcher
 * (decision 11 — the drill equals its tile), so it is all clients there.
 */
export function clientFilterForDrill(clientId: ClientFilter, drilled: boolean): ClientFilter {
  return drilled ? null : clientId;
}

/**
 * The filter as a remount-key fragment: join it into a `<DataTable key>`
 * (frontend guide §1.11) so a switch remounts the table with an empty
 * Prev/Next stack — never a cursor minted under another client.
 */
export function clientFilterKey(clientId: ClientFilter): string {
  if (clientId === CLIENT_PENDING) return 'client:pending';
  return clientId === null ? 'client:all' : `client:${clientId}`;
}

/** The `clientId` query fragment a list wrapper spreads: sent only when set. */
export function clientQuery(clientId: string | null | undefined): { clientId?: string } {
  return clientId === null || clientId === undefined ? {} : { clientId };
}

/* ── copy ───────────────────────────────────────────────────────────── */

export const ALL_CLIENTS = 'All clients';
export const SHOW_ALL_CLIENTS = 'Show all clients';
export const CLIENTS_UNAVAILABLE = 'Client list unavailable — showing all clients';
/** Title on an "All clients" note: why this section ignores the switcher. */
export const NOT_FILTERED_BY_CLIENT = 'This section is not filtered by client';

/** How a client is named in the switcher and the chip (`clientLabel` of `lib/clients.ts`, inlined: no import cycle). */
export function activeClientLabel(client: ClientDto, tenantName: string | null): string {
  if (client.systemOwned) {
    return tenantName === null || tenantName === '' ? 'Your company' : `${tenantName} (your company)`;
  }
  return `${client.code} — ${client.name}`;
}

/** A switcher option: the label, a departed client marked (decision 7 — still selectable). */
export function clientOptionLabel(client: ClientDto, tenantName: string | null): string {
  const label = activeClientLabel(client, tenantName);
  return client.status === 'departed' ? `${label} (departed)` : label;
}

/** The chip on a filtered screen. */
export function clientChipLabel(client: ClientDto, tenantName: string | null): string {
  return `Client: ${clientOptionLabel(client, tenantName)}`;
}

/**
 * Decision 10 — a create for another client than the active one succeeds
 * but the new row is hidden by the filter; say so. Null when nothing is
 * hidden (no filter, the same client, or the created client unknown).
 */
export function hiddenByClientFilterNote(
  active: ActiveClient,
  createdClientId: string | null | undefined,
  clients: readonly ClientDto[] | null,
  tenantName: string | null,
): string | null {
  if (active.state !== 'client' || createdClientId === null || createdClientId === undefined) return null;
  if (createdClientId === active.client.id) return null;
  const created = clients?.find((entry) => entry.id === createdClientId);
  const label = created === undefined ? 'another client' : activeClientLabel(created, tenantName);
  return `Created for ${label} — hidden by the client filter`;
}

/**
 * A create form's default client: the active one when it is offered by the
 * form's picker (a departed client is not), else the form's own default.
 */
export function defaultFormClientId(
  active: ActiveClient,
  offered: readonly { readonly id: string }[] | null,
  fallback: string,
): string {
  if (active.state !== 'client') return fallback;
  return offered !== null && offered.some((entry) => entry.id === active.client.id) ? active.client.id : fallback;
}
