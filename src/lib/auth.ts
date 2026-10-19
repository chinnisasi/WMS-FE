/**
 * Session persistence — the single source for the storage contract between
 * sign-in/registration (writers) and every API call + the sidebar switcher
 * (readers). Same pattern as src/lib/theme.ts: the key and shape live here
 * so the sides cannot drift.
 *
 * Story 6-1a — the token is a 15-minute ACCESS token over a server-side
 * session that lives on through refresh (`lib/session-refresh.ts`, the
 * httpOnly refresh cookie) until `refreshUntil`, the session's absolute end.
 * An expired access token is therefore NOT signed-out: it is refreshable. A
 * session past `refreshUntil` (or one the server ended) reads as signed-out.
 */
import { clearActiveClientId } from '@/lib/active-client';
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
  /** Unix ms — ACCESS token expiry, from the sign-in / refresh response TTL. */
  expiresAt: number;
  /**
   * Story 6-1a — Unix ms: the session's absolute end (`refreshExpiresInSeconds`).
   * Until then an expired access token is refreshable. Absent on a row stored
   * before 6-1a — then `expiresAt` is the end, as it always was.
   */
  refreshUntil?: number;
}

/** Story 6-1a — the instant a stored session is over (refresh can no longer revive it). */
export function sessionEndsAt(session: Pick<StoredSession, 'expiresAt' | 'refreshUntil'>): number {
  return typeof session.refreshUntil === 'number' ? session.refreshUntil : session.expiresAt;
}

/** Story 6-1a — true when the access token has lapsed (or is about to) and needs a refresh first. */
export function accessTokenExpired(session: Pick<StoredSession, 'expiresAt'>, skewMs = 5_000): boolean {
  return session.expiresAt - skewMs <= Date.now();
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
    // Story 6-1a — an expired ACCESS token is refreshable, not signed-out;
    // only the session's own end is.
    if (sessionEndsAt(stored) <= Date.now()) {
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

/**
 * Story 6-1b — refuses a body that is not a session: a string token and a
 * finite expiry (and a finite `refreshUntil` when one is given). An old
 * bundle reading a challenge as a session would otherwise store `NaN`
 * expiries and loop between /login and the shell. Answers whether it wrote.
 */
export function writeSession(session: StoredSession): boolean {
  if (
    typeof session.token !== 'string' ||
    session.token === '' ||
    !Number.isFinite(session.expiresAt) ||
    (session.refreshUntil !== undefined && !Number.isFinite(session.refreshUntil))
  ) {
    return false;
  }
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // private mode — session simply won't persist. Skip the hint cookie too:
    // the proxy gate would then admit the user into pages that cannot call
    // the API, which is worse than an honest /login.
    return false;
  }
  writeSessionHint(sessionEndsAt(session));
  scheduleExpiryDispatch(sessionEndsAt(session));
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
  return true;
}

/**
 * Story 6-1a — why the last session ended (the server's `reason`), kept in
 * sessionStorage for the shell's redirect to put on /login (`?ended=`), so
 * the sign-in page can say why. Read once.
 */
export const SIGNED_OUT_REASON_KEY = 'wms-signed-out-reason';

export function takeSignedOutReason(): string | null {
  try {
    const reason = sessionStorage.getItem(SIGNED_OUT_REASON_KEY);
    if (reason !== null) sessionStorage.removeItem(SIGNED_OUT_REASON_KEY);
    return reason;
  } catch {
    return null;
  }
}

/** The /login href a signed-out shell goes to, carrying the reason when there is one. */
export function signedOutLoginHref(): string {
  const reason = takeSignedOutReason();
  return reason === null ? '/login' : `/login?ended=${encodeURIComponent(reason)}`;
}

export function clearSession(reason?: string): void {
  if (reason !== undefined) {
    try {
      sessionStorage.setItem(SIGNED_OUT_REASON_KEY, reason);
    } catch {
      // no session storage — the sign-in page just shows no reason
    }
  }
  if (expiryTimer !== undefined) {
    clearTimeout(expiryTimer);
    expiryTimer = undefined;
  }
  try {
    // Story 1-5a — the logout forgets this user's client filter (read off the
    // raw row: an ended session no longer reads through `readSession`).
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    const stored = raw === null ? null : (JSON.parse(raw) as Partial<StoredSession> | null);
    const tenantId = stored?.tenant?.id;
    const userId = stored?.user?.id;
    if (typeof tenantId === 'string' && typeof userId === 'string') clearActiveClientId(tenantId, userId);
  } catch {
    // an unreadable row has no pick to forget
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
    writeSessionHint(sessionEndsAt(session));
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