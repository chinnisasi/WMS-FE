import { API_BASE_URL } from '@/lib/api/base-url';
import { clearSession, readSession, writeSession } from '@/lib/auth';

/**
 * Story 6-1a — keeping a web / portal session alive.
 *
 * The access token lives 15 minutes; the session lives on through the
 * httpOnly refresh cookie (`wms_refresh`, path /api/v1/tenants/session) until
 * its idle or absolute limit. There is NO timer: a request whose access token
 * has lapsed refreshes first, and a 401 `token-expired` refreshes once and
 * retries. Refresh is serialised — one in flight per tab, and across tabs
 * through `navigator.locks` (re-reading storage once the lock is held, so a
 * tab that waited uses the token another tab just minted instead of
 * presenting the already-rotated cookie). The server's 30 s grace covers a
 * browser without Web Locks.
 *
 * These calls use plain `fetch` (never the generated client), so the client's
 * interceptors cannot recurse into themselves.
 */

const SESSION_URL = `${API_BASE_URL}/tenants/session`;
const LOCK_NAME = 'wms-session-refresh';

let inFlight: Promise<boolean> | null = null;

type RefreshBody = { accessToken: string; expiresInSeconds: number; refreshExpiresInSeconds: number };

/**
 * Refreshes the access token. True when a usable token is now stored; false
 * when the session is over (it was cleared, with the server's reason) or the
 * API is unreachable (the session is kept — the next request tries again).
 */
export function refreshAccessToken(): Promise<boolean> {
  if (inFlight === null) {
    inFlight = withCrossTabLock(runRefresh).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function withCrossTabLock(fn: (tokenBefore: string | null) => Promise<boolean>): Promise<boolean> {
  const tokenBefore = readSession()?.token ?? null;
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (locks?.request === undefined) return fn(tokenBefore);
  return locks.request(LOCK_NAME, () => fn(tokenBefore));
}

async function runRefresh(tokenBefore: string | null): Promise<boolean> {
  const current = readSession();
  if (current === null) return false;
  // Another tab refreshed while this one waited for the lock: use its token.
  if (current.token !== tokenBefore && current.expiresAt - 5_000 > Date.now()) return true;

  let response: Response;
  try {
    response = await fetch(`${SESSION_URL}/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-WMS-Session': '1' },
    });
  } catch {
    return false;
  }
  if (response.ok) {
    let body: RefreshBody;
    try {
      body = (await response.json()) as RefreshBody;
    } catch {
      // A garbled 200 (a proxy page): keep the session; the request fails on its own.
      return false;
    }
    if (typeof body.accessToken !== 'string' || typeof body.expiresInSeconds !== 'number') return false;
    const latest = readSession() ?? current;
    const now = Date.now();
    writeSession({
      ...latest,
      token: body.accessToken,
      expiresAt: now + body.expiresInSeconds * 1000,
      refreshUntil: now + body.refreshExpiresInSeconds * 1000,
    });
    return true;
  }
  if (response.status === 401) {
    clearSession(await reasonOf(response));
    return false;
  }
  // 403 (origin refused) or a 5xx: keep the session; the request fails on its own.
  return false;
}

async function reasonOf(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { code?: unknown; reason?: unknown };
    return body.code === 'session-ended' && typeof body.reason === 'string' ? body.reason : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sign-out: ends the session on the server (cookie + bearer, so it works with
 * an expired access token), then clears it here. A failed call still signs
 * out locally — the server session then ends at its own limit.
 */
export async function signOutEverywhere(): Promise<void> {
  const session = readSession();
  try {
    await fetch(`${SESSION_URL}/sign-out`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-WMS-Session': '1',
        ...(session === null ? {} : { Authorization: `Bearer ${session.token}` }),
      },
    });
  } catch {
    // unreachable API — sign out locally anyway
  }
  clearSession();
}
