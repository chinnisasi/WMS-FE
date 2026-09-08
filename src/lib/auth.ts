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

/** Fired on `window` whenever the stored session is written or cleared. */
export const SESSION_CHANGED_EVENT = 'wms-session-changed';

export interface StoredSession {
  token: string;
  tenant: TenantResponse;
  /** Unix ms — token expiry, from the sign-in response TTL. */
  expiresAt: number;
}

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
      clearSession();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function writeSession(session: StoredSession): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // private mode — session simply won't persist
  }
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // nothing to clear without storage
  }
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
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