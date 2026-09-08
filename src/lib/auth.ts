/**
 * Session persistence — the single source for the storage contract between
 * sign-in/registration (writers) and every API call + the sidebar switcher
 * (readers). Same pattern as src/lib/theme.ts: the key and shape live here
 * so the sides cannot drift.
 *
 * The token is the backend's 15-minute HS256 session (no refresh in Story
 * 1.2) — an expired session reads as signed-out, honestly.
 */
import type { TenantResponse } from '@/lib/api/generated';

export const SESSION_STORAGE_KEY = 'wms-session';

/**
 * Cookie mirror of session *presence* for the server-side proxy gate
 * (`src/proxy.ts`): localStorage is invisible there, so writers keep a
 * non-HttpOnly hint cookie whose lifetime matches the token TTL. Presence
 * only — no token material ever goes into a cookie. Cleared by
 * `clearSession` (and browser-wide, so cross-tab sign-out closes every tab).
 */
export const SESSION_HINT_COOKIE = 'wms-session-hint';

/** Fired on `window` whenever the stored session is written or cleared. */
export const SESSION_CHANGED_EVENT = 'wms-session-changed';

export interface StoredSession {
  token: string;
  tenant: TenantResponse;
  /** Unix ms — token expiry, from the sign-in response TTL. */
  expiresAt: number;
}

/**
 * Pure snapshot read: never mutates storage or dispatches events. This is
 * the `getSnapshot` of `useSyncExternalStore` subscriptions — a side effect
 * here (clearing + dispatching on expiry) runs during render. An expired
 * session simply reads as signed-out; the stored row is cleaned up by the
 * next `writeSession`/`clearSession` or ignored forever (harmless).
 */
export function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as StoredSession).token !== 'string' ||
      typeof (parsed as StoredSession).expiresAt !== 'number' ||
      typeof (parsed as StoredSession).tenant?.id !== 'string'
    ) {
      return null;
    }
    const session = parsed as StoredSession;
    if (session.expiresAt <= Date.now()) {
      return null;
    }
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