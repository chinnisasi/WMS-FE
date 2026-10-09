/**
 * Session persistence — the single source for the storage contract between
 * sign-in/registration (writers) and every API call + the sidebar switcher
 * (readers). Same pattern as src/lib/theme.ts: the key and shape live here
 * so the sides cannot drift.
 *
 * The token is the backend's 15-minute HS256 session (no refresh in Story
 * 1.2) — an expired session reads as signed-out, honestly.
 */
import type { SessionClientResponse, TenantResponse, UserResponse } from '@/lib/api/generated';

export const SESSION_STORAGE_KEY = 'wms-session';

/**
 * The signed-in user, as of the last sign-in or /me bootstrap refresh
 * (story 1.5). The role here only *hides* surfaces the backend would deny —
 * the per-command DB read on wms-be stays the authority.
 */
export interface SessionUser {
  id: string;
  email: string;
  role: UserResponse['role'];
  status: UserResponse['status'];
  /**
   * Story 21-7 — the client brand of a client-portal user; null for the
   * tenant's own staff. A session stored before 21-7 has no such key —
   * `readSession` normalises it to null (staff), never `undefined`.
   */
  clientId: string | null;
}

/** Story 21-7 — the portal user's client brand (the portal shell prints its name). */
export type SessionClient = SessionClientResponse;

/**
 * Cookie mirror of session *presence* for the server-side proxy gate
 * (`src/proxy.ts`): localStorage is invisible there, so writers keep a
 * non-HttpOnly hint cookie whose lifetime matches the token TTL. Presence
 * only — no token material ever goes into a cookie. Cleared by
 * `clearSession` (and browser-wide, so cross-tab sign-out closes every tab).
 */
export const SESSION_HINT_COOKIE = 'wms-session-hint';

/**
 * Story 21-7 — fired on `window` when a portal read is refused
 * `client-suspended` (the client brand was suspended mid-session): the
 * portal shell clears the session and goes to /login with the notice.
 */
export const PORTAL_SUSPENDED_EVENT = 'wms-portal-suspended';

/** Fired on `window` whenever the stored session is written or cleared. */
export const SESSION_CHANGED_EVENT = 'wms-session-changed';

/**
 * The shape WRITTEN to storage. Story 21-7's two keys are optional here:
 * a row stored before 21-7 lacks them, and a writer for a staff session may
 * omit them — `readSession` hands every reader the normalised `Session`.
 */
export interface StoredSession {
  token: string;
  tenant: TenantResponse;
  user: Omit<SessionUser, 'clientId'> & { clientId?: string | null };
  /**
   * Story 21-7 — the client brand of a portal session (from sign-in or the
   * `portal/me` refresh); null/absent for staff and for a pre-21-7 row.
   */
  client?: SessionClient | null;
  /** Unix ms — token expiry, from the sign-in response TTL. */
  expiresAt: number;
}

/** What every reader gets: `user.clientId` and `client` always present (null for staff). */
export interface Session extends StoredSession {
  user: SessionUser;
  client: SessionClient | null;
}

/** Story 21-7 — true for a client-portal session (the user carries a client). */
export function isPortalSession(session: Session | null): boolean {
  return session !== null && session.user.clientId !== null;
}

/**
 * Pure snapshot read: never mutates storage or dispatches events. This is
 * the `getSnapshot` of `useSyncExternalStore` subscriptions — a side effect
 * here (clearing + dispatching on expiry) runs during render. An expired
 * session simply reads as signed-out; the stored row is cleaned up by the
 * next `writeSession`/`clearSession` or ignored forever (harmless).
 */
let lastRaw: string | null = null;
let lastSession: Session | null = null;

export function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as StoredSession).token !== 'string' ||
      typeof (parsed as StoredSession).expiresAt !== 'number' ||
      typeof (parsed as StoredSession).tenant?.id !== 'string' ||
      // Fail closed on a session without a user (pre-1.5 rows): surface
      // gating would have no role to read, so the row reads as signed-out
      // and the next sign-in rewrites it in the new shape.
      typeof (parsed as StoredSession).user?.id !== 'string' ||
      typeof (parsed as StoredSession).user.role !== 'string'
    ) {
      return null;
    }
    const stored = parsed as StoredSession;
    if (stored.expiresAt <= Date.now()) {
      return null;
    }
    // Story 21-7: normalise the two keys a pre-21-7 row lacks. Memoised on
    // the raw string so `useSyncExternalStore` snapshots selecting an object
    // stay referentially stable between reads of an unchanged row.
    if (raw === lastRaw && lastSession !== null) return lastSession;
    const clientId = typeof stored.user.clientId === 'string' ? stored.user.clientId : null;
    const client =
      clientId !== null && typeof stored.client === 'object' && stored.client !== null && typeof stored.client.id === 'string'
        ? stored.client
        : null;
    const session: Session = { ...stored, user: { ...stored.user, clientId }, client };
    lastRaw = raw;
    lastSession = session;
    return session;
  } catch {
    return null;
  }
}

/**
 * The expiry flip (review loop 3): readSession() is pure by design, so
 * nothing inside a render notices the TTL passing. This timer is the
 * watchdog — it fires SESSION_CHANGED_EVENT the moment the token expires,
 * flipping every subscribed surface (forms, switchers) to signed-out without
 * waiting for the next navigation.
 */
let expiryTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleExpiryDispatch(expiresAt: number): void {
  if (expiryTimer !== undefined) clearTimeout(expiryTimer);
  const delay = Math.min(Math.max(expiresAt - Date.now(), 0), 2 ** 31 - 1);
  expiryTimer = setTimeout(() => {
    expiryTimer = undefined;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
    }
  }, delay);
}

export function writeSession(session: StoredSession): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // private mode — session simply won't persist. Skip the hint cookie too:
    // the proxy gate would then admit the user into pages that cannot call
    // the API, which is worse than an honest /login.
    return;
  }
  writeSessionHint(session.expiresAt);
  scheduleExpiryDispatch(session.expiresAt);
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}

export function clearSession(): void {
  if (expiryTimer !== undefined) {
    clearTimeout(expiryTimer);
    expiryTimer = undefined;
  }
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // nothing to clear without storage
  }
  writeSessionHint(0);
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}

/** Mirror session presence into the proxy-readable hint cookie. */
function writeSessionHint(expiresAt: number): void {
  try {
    if (typeof document === 'undefined') return;
    const maxAge = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    const secure = window.location?.protocol === 'https:' ? '; Secure' : '';
    // max-age 0 deletes the cookie — the clear path.
    document.cookie = `${SESSION_HINT_COOKIE}=1; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
  } catch {
    // no cookie jar — the proxy gate simply can't see the session
  }
}

/**
 * Re-assert the hint cookie for a live session (bootstrap path): a page
 * first rendered by the proxy while the cookie had expired — but
 * localStorage still held the fresh token — would otherwise redirect on the
 * next hard navigation even though the session is valid. Cheap to call
 * per request; the cookie write is a no-op when already present.
 */
export function ensureSessionHint(): void {
  if (typeof document === 'undefined') return;
  const session = readSession();
  if (session === null) return;
  const present = document.cookie
    .split('; ')
    .some((pair) => pair.startsWith(`${SESSION_HINT_COOKIE}=`));
  if (!present) {
    writeSessionHint(session.expiresAt);
  }
}

/**
 * React subscription for session presence — pairs with useSyncExternalStore
 * so components re-render when another writer (sign-in, expiry, another
 * tab's storage event) changes the session.
 */
export function subscribeSession(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SESSION_STORAGE_KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(SESSION_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(SESSION_CHANGED_EVENT, onChange);
  };
}