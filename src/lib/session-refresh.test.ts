import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { restoreGlobals, stubGlobal } from './test/globals';
import { fetchApiListWarehouses, fetchApiSignIn } from './api/client';
import {
  accessTokenExpired,
  clearSession,
  readSession,
  SESSION_STORAGE_KEY,
  signedOutLoginHref,
  writeSession,
  type StoredSession,
} from './auth';
import { loginNotice } from './portal';
import { refreshAccessToken, signOutEverywhere } from './session-refresh';

/**
 * Story 6-1a — the web half of secure sessions: an expired access token is
 * refreshable (not signed-out), a request refreshes before it is sent, a
 * 401 `token-expired` refreshes once and retries with the same
 * Idempotency-Key, a 401 `session-ended` signs out with the server's reason,
 * and sign-out ends the session on the server.
 */

let store: Map<string, string>;
let sessionStore: Map<string, string>;
let calls: { url: string; method: string; auth: string | null; key: string | null; session: string | null; credentials: string | undefined }[];

const TENANT = '0198f7a2-1b3c-7d4e-8f90-112233445566';

function session(overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    token: 'old.access.token',
    tenant: { id: TENANT, name: 'Priya Spices', gstin: null },
    user: { id: '0198f7a2-1b3c-7d4e-8f90-aabbccddeeff', email: 'priya@example.com', role: 'owner', status: 'active' },
    expiresAt: Date.now() + 60_000,
    refreshUntil: Date.now() + 12 * 60 * 60_000,
    ...overrides,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A scripted fetch: each call takes the next response; every call is recorded. */
function scriptFetch(responses: Array<(request: Request) => Response>): void {
  let index = 0;
  stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input.toString(), init);
    calls.push({
      url: request.url,
      method: request.method,
      auth: request.headers.get('Authorization'),
      key: request.headers.get('Idempotency-Key'),
      session: request.headers.get('X-WMS-Session'),
      credentials: init?.credentials ?? (input instanceof Request ? input.credentials : undefined),
    });
    const next = responses[index] ?? responses[responses.length - 1]!;
    index += 1;
    return next(request);
  }) as unknown as typeof fetch);
}

const WAREHOUSES = { items: [], nextCursor: null };
const REFRESHED = { accessToken: 'new.access.token', tokenType: 'Bearer', expiresInSeconds: 900, refreshExpiresInSeconds: 40_000 };

beforeEach(() => {
  store = new Map();
  sessionStore = new Map();
  calls = [];
  const storage = (map: Map<string, string>) =>
    ({
      getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    }) as Storage;
  stubGlobal('localStorage', storage(store));
  stubGlobal('sessionStorage', storage(sessionStore));
  stubGlobal('window', { dispatchEvent: () => true });
});

afterEach(() => {
  clearSession();
  restoreGlobals();
});

describe('stored session (auth.ts)', () => {
  test('an expired ACCESS token inside refreshUntil is refreshable, not signed-out', () => {
    writeSession(session({ expiresAt: Date.now() - 1_000 }));
    const read = readSession();
    expect(read).not.toBeNull();
    expect(accessTokenExpired(read!)).toBe(true);
  });

  test('past refreshUntil the session reads as signed-out', () => {
    store.set(SESSION_STORAGE_KEY, JSON.stringify(session({ expiresAt: Date.now() - 2_000, refreshUntil: Date.now() - 1_000 })));
    expect(readSession()).toBeNull();
  });

  test('a pre-6-1a row (no refreshUntil) ends at its access expiry, as before', () => {
    store.set(SESSION_STORAGE_KEY, JSON.stringify({ ...session(), refreshUntil: undefined, expiresAt: Date.now() - 1 }));
    expect(readSession()).toBeNull();
  });

  test('clearSession(reason) → the next login href carries it once; the sign-in page has words for it', () => {
    writeSession(session());
    clearSession('idle');
    expect(signedOutLoginHref()).toBe('/login?ended=idle');
    expect(signedOutLoginHref()).toBe('/login');
    expect(loginNotice(undefined, 'idle')).toBe('You were signed out after 2 hours of inactivity.');
    expect(loginNotice(undefined, 'deactivated')).toContain('deactivated');
    expect(loginNotice(undefined, 'nonsense')).toBeNull();
    expect(loginNotice('suspended', 'idle')).toContain('suspended');
  });
});

describe('the API client around the session', () => {
  test('a lapsed access token is refreshed BEFORE the request is sent', async () => {
    writeSession(session({ expiresAt: Date.now() - 1_000 }));
    scriptFetch([() => json(200, REFRESHED), () => json(200, WAREHOUSES)]);
    await fetchApiListWarehouses(TENANT);
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/api/v1/tenants/session/refresh',
      `/api/v1/tenants/${TENANT}/warehouses`,
    ]);
    expect(calls[1]!.auth).toBe('Bearer new.access.token');
    expect(readSession()!.token).toBe('new.access.token');
  });

  test('401 token-expired → one refresh → the request is retried with the SAME Idempotency-Key', async () => {
    writeSession(session());
    const { fetchApiCreateWarehouse } = await import('./api/client');
    scriptFetch([
      () => json(401, { code: 'token-expired', status: 401, title: 'Authentication required' }),
      () => json(200, REFRESHED),
      () => json(201, { id: 'w1', code: 'BLR', name: 'Bengaluru' }),
    ]);
    await fetchApiCreateWarehouse(
      TENANT,
      {
        code: 'BLR',
        name: 'Bengaluru',
        origin: { contactName: 'P', phone: '+91 98450 12345', line1: 'x', city: 'Bengaluru', stateCode: '29', pincode: '560058' },
      } as never,
      'key-0001',
    );
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      `/api/v1/tenants/${TENANT}/warehouses`,
      '/api/v1/tenants/session/refresh',
      `/api/v1/tenants/${TENANT}/warehouses`,
    ]);
    expect(calls[0]!.key).toBe('key-0001');
    expect(calls[2]!.key).toBe('key-0001');
    expect(calls[2]!.auth).toBe('Bearer new.access.token');
  });

  test('401 session-ended clears the session with the server’s reason', async () => {
    writeSession(session());
    scriptFetch([() => json(401, { code: 'session-ended', reason: 'deactivated', status: 401, title: 'Session ended' })]);
    await expect(fetchApiListWarehouses(TENANT)).rejects.toBeDefined();
    expect(readSession()).toBeNull();
    expect(signedOutLoginHref()).toBe('/login?ended=deactivated');
  });

  test('a refresh the server refuses (idle) signs out with that reason; the original 401 stands', async () => {
    writeSession(session({ expiresAt: Date.now() - 1_000 }));
    scriptFetch([
      () => json(401, { code: 'session-ended', reason: 'idle', status: 401, title: 'Session ended' }),
      () => json(401, { code: 'unauthenticated', status: 401, title: 'Authentication required' }),
    ]);
    await expect(fetchApiListWarehouses(TENANT)).rejects.toBeDefined();
    expect(readSession()).toBeNull();
    expect(signedOutLoginHref()).toBe('/login?ended=idle');
  });

  test('an unreachable API during refresh keeps the session (the next request tries again)', async () => {
    writeSession(session({ expiresAt: Date.now() - 1_000 }));
    stubGlobal('fetch', (async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch);
    expect(await refreshAccessToken()).toBe(false);
    expect(readSession()).not.toBeNull();
  });

  test('concurrent refreshes in one tab share ONE request', async () => {
    writeSession(session({ expiresAt: Date.now() - 1_000 }));
    scriptFetch([() => json(200, REFRESHED)]);
    const results = await Promise.all([refreshAccessToken(), refreshAccessToken(), refreshAccessToken()]);
    expect(results).toEqual([true, true, true]);
    expect(calls).toHaveLength(1);
  });

  test('sign-out calls the server with the bearer token, then clears locally — even when the call fails', async () => {
    writeSession(session());
    scriptFetch([() => new Response(null, { status: 204 })]);
    await signOutEverywhere();
    expect(new URL(calls[0]!.url).pathname).toBe('/api/v1/tenants/session/sign-out');
    expect(calls[0]!.auth).toBe('Bearer old.access.token');
    expect(readSession()).toBeNull();

    writeSession(session());
    stubGlobal('fetch', (async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch);
    await signOutEverywhere();
    expect(readSession()).toBeNull();
  });
});

describe('code review additions', () => {
  test('refresh and sign-out send credentials: include and X-WMS-Session: 1; sign-in sends credentials: include', async () => {
    writeSession(session({ expiresAt: Date.now() - 1_000 }));
    scriptFetch([() => json(200, REFRESHED)]);
    await refreshAccessToken();
    expect(calls[0]).toMatchObject({ credentials: 'include', session: '1', method: 'POST' });

    scriptFetch([() => new Response(null, { status: 204 })]);
    calls = [];
    await signOutEverywhere();
    expect(calls[0]).toMatchObject({ credentials: 'include', session: '1' });

    calls = [];
    scriptFetch([
      () =>
        json(200, {
          accessToken: 't',
          tokenType: 'Bearer',
          expiresInSeconds: 900,
          refreshExpiresInSeconds: 43200,
          tenant: { id: TENANT, name: 'x', gstin: null },
          user: { id: 'u', email: 'e@example.com', role: 'owner', status: 'active', clientId: null, createdAt: 'x' },
          client: null,
        }),
    ]);
    await fetchApiSignIn({ email: 'e@example.com', password: 'p' });
    expect(calls[0]!.credentials).toBe('include');
  });

  test('C20: refresh, sign-out and the request around them go to the RUNTIME base, full URL — never an import-time constant', async () => {
    const base = 'https://api.runtime.example/api/v1';
    stubGlobal('window', { dispatchEvent: () => true, __WMS_CONFIG__: { apiBaseUrl: base } });
    writeSession(session({ expiresAt: Date.now() - 1_000 }));
    scriptFetch([() => json(200, REFRESHED), () => json(200, WAREHOUSES), () => new Response(null, { status: 204 })]);
    await fetchApiListWarehouses(TENANT);
    await signOutEverywhere();
    expect(calls.map((call) => call.url)).toEqual([
      `${base}/tenants/session/refresh`,
      `${base}/tenants/${TENANT}/warehouses`,
      `${base}/tenants/session/sign-out`,
    ]);
  });

  test('a retried request that answers 401 session-ended still signs out with the reason', async () => {
    writeSession(session());
    scriptFetch([
      () => json(401, { code: 'token-expired', status: 401, title: 'x' }),
      () => json(200, REFRESHED),
      () => json(401, { code: 'session-ended', reason: 'deactivated', status: 401, title: 'x' }),
    ]);
    await expect(fetchApiListWarehouses(TENANT)).rejects.toBeDefined();
    expect(readSession()).toBeNull();
    expect(signedOutLoginHref()).toBe('/login?ended=deactivated');
  });

  test('a garbled 200 refresh keeps the session and reports failure (never throws)', async () => {
    writeSession(session({ expiresAt: Date.now() - 1_000 }));
    scriptFetch([() => new Response('<html>proxy</html>', { status: 200 })]);
    expect(await refreshAccessToken()).toBe(false);
    expect(readSession()).not.toBeNull();
  });

  test('an ?ended= value naming an Object.prototype member reads as no notice', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(loginNotice(undefined, name)).toBeNull();
  });
});
