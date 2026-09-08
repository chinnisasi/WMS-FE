import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  SESSION_CHANGED_EVENT,
  SESSION_HINT_COOKIE,
  SESSION_STORAGE_KEY,
  clearSession,
  ensureSessionHint,
  readSession,
  subscribeSession,
  writeSession,
  type StoredSession,
} from './auth';

/**
 * localStorage/window shims — bun:test has no DOM. auth.ts touches the
 * globals only inside its functions, so installing shims before the calls
 * is enough. The spies let the purity contract (readSession mutates
 * nothing) be asserted, not just assumed.
 */
let store: Map<string, string>;
let removed: string[];
let dispatched: string[];
let cookieJar: Map<string, string>;

function installShims(): void {
  store = new Map();
  removed = [];
  dispatched = [];
  cookieJar = new Map();
  // Minimal document.cookie shim: set via `name=value; ...` assignments,
  // read back as `name=value` pairs (enough for the hint cookie's shape).
  (globalThis as Record<string, unknown>).document = {
    set cookie(value: string) {
      const [pair] = value.split(';');
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq);
      const val = pair!.slice(eq + 1);
      const maxAge = /Max-Age=(\d+)/.exec(value)?.[1];
      if (val === '' || maxAge === '0') {
        cookieJar.delete(name);
      } else {
        cookieJar.set(name, val);
      }
    },
    get cookie() {
      return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
  } as unknown as Document;
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => {
      store.delete(key);
      removed.push(key);
    },
  } as Storage;
  const eventTarget = new EventTarget();
  (globalThis as Record<string, unknown>).window = {
    dispatchEvent: (event: Event) => {
      dispatched.push(event.type);
      return eventTarget.dispatchEvent(event);
    },
    // Real EventTarget behavior so subscription tests exercise the actual
    // listener wiring; bun's environment has no DOM window of its own.
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
  } as unknown as typeof window;
}

const SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: '0198f7a2-1b3c-7d4e-8f90-112233445566', name: 'Priya Spices' },
  // Story 1.5: every stored session carries the signed-in user — the role
  // feeds the surface gating (hide surfaces, never "blocked" screens).
  user: {
    id: '0198f7a2-1b3c-7d4e-8f90-aabbccddeeff',
    email: 'priya@example.com',
    role: 'owner',
    status: 'active',
  },
  expiresAt: Date.now() + 60_000,
};

const EXPIRED: StoredSession = {
  ...SESSION,
  tenant: { ...SESSION.tenant },
  expiresAt: Date.now() - 1,
};

beforeEach(installShims);
afterEach(() => {
  // Drop any expiry timer a write scheduled (clearSession clears it) before
  // the shims go away, so no stray timer outlives a test.
  clearSession();
  delete (globalThis as Record<string, unknown>).localStorage;
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).document;
});

describe('readSession (pure snapshot read)', () => {
  test('absent key → null', () => {
    expect(readSession()).toBeNull();
  });

  test('valid session → parsed object', () => {
    store.set(SESSION_STORAGE_KEY, JSON.stringify(SESSION));
    expect(readSession()?.tenant.id).toBe(SESSION.tenant.id);
  });

  test('expired session → null, without mutating storage or dispatching', () => {
    store.set(SESSION_STORAGE_KEY, JSON.stringify(EXPIRED));
    expect(readSession()).toBeNull();
    // Purity: the snapshot getter runs during render — no clear, no dispatch.
    expect(removed).toEqual([]);
    expect(dispatched).toEqual([]);
    expect(store.has(SESSION_STORAGE_KEY)).toBe(true);
  });

  test('corrupt JSON → null, no throw', () => {
    store.set(SESSION_STORAGE_KEY, '{not json');
    expect(readSession()).toBeNull();
  });

  test('wrong shape (missing token) → null', () => {
    store.set(SESSION_STORAGE_KEY, JSON.stringify({ expiresAt: Date.now() + 1 }));
    expect(readSession()).toBeNull();
  });

  test('pre-1.5 session row without a user → null (fail closed)', () => {
    // Story 1.5 made `user` required: a row written by the previous build
    // has no role for the surface gating to read, so it reads as signed-out
    // and the next sign-in rewrites it in the new shape.
    store.set(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        token: SESSION.token,
        tenant: SESSION.tenant,
        expiresAt: SESSION.expiresAt,
      }),
    );
    expect(readSession()).toBeNull();
  });

  test('session row with an incomplete user → null', () => {
    store.set(
      SESSION_STORAGE_KEY,
      JSON.stringify({ ...SESSION, user: { id: 'x', email: 'x@example.com' } }),
    );
    expect(readSession()).toBeNull();
  });
});

describe('writeSession / clearSession (writers dispatch)', () => {
  test('writeSession stores and dispatches', () => {
    writeSession(SESSION);
    expect(store.get(SESSION_STORAGE_KEY)).toContain(SESSION.tenant.id);
    expect(dispatched).toEqual([SESSION_CHANGED_EVENT]);
  });

  test('clearSession removes and dispatches', () => {
    writeSession(SESSION);
    clearSession();
    expect(store.has(SESSION_STORAGE_KEY)).toBe(false);
    expect(dispatched).toEqual([SESSION_CHANGED_EVENT, SESSION_CHANGED_EVENT]);
  });
});

describe('session hint cookie (proxy gate mirror)', () => {
  test('writeSession sets the hint with the token TTL; clearSession deletes it', () => {
    writeSession(SESSION);
    expect(cookieJar.get(SESSION_HINT_COOKIE)).toBe('1');

    clearSession();
    expect(cookieJar.has(SESSION_HINT_COOKIE)).toBe(false);
  });

  test('an expired session leaves no live hint on the next write', () => {
    writeSession({ ...EXPIRED, expiresAt: Date.now() - 60_000 });
    expect(cookieJar.has(SESSION_HINT_COOKIE)).toBe(false);
  });
});

describe('expiry watchdog (review loop 3)', () => {
  test('a stored session flips to signed-out when its TTL passes', async () => {
    writeSession({ ...SESSION, expiresAt: Date.now() + 30 });
    // One dispatch from the write itself; the timer fires ~30ms later.
    expect(dispatched).toEqual([SESSION_CHANGED_EVENT]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(dispatched).toEqual([SESSION_CHANGED_EVENT, SESSION_CHANGED_EVENT]);
    // And the session honestly reads as signed-out now.
    expect(readSession()).toBeNull();
  });

  test('a later write reschedules — the old timer cannot fire early', async () => {
    writeSession({ ...SESSION, expiresAt: Date.now() + 30 });
    writeSession({ ...SESSION, expiresAt: Date.now() + 5000 });
    await new Promise((resolve) => setTimeout(resolve, 80));
    // Only the two write dispatches; the first (30ms) timer was cancelled.
    expect(dispatched).toEqual([SESSION_CHANGED_EVENT, SESSION_CHANGED_EVENT]);
  });
});

describe('ensureSessionHint (bootstrap re-assert)', () => {
  test('a valid session with a missing cookie re-asserts the hint', () => {
    store.set(SESSION_STORAGE_KEY, JSON.stringify(SESSION));
    expect(cookieJar.has(SESSION_HINT_COOKIE)).toBe(false);
    ensureSessionHint();
    expect(cookieJar.get(SESSION_HINT_COOKIE)).toBe('1');
  });

  test('an existing hint is left alone (no duplicate writes)', () => {
    store.set(SESSION_STORAGE_KEY, JSON.stringify(SESSION));
    cookieJar.set(SESSION_HINT_COOKIE, '1');
    ensureSessionHint();
    expect(cookieJar.get(SESSION_HINT_COOKIE)).toBe('1');
  });

  test('no session — nothing to assert', () => {
    ensureSessionHint();
    expect(cookieJar.has(SESSION_HINT_COOKIE)).toBe(false);
    expect(dispatched).toEqual([]);
  });
});

describe('subscribeSession', () => {
  test('notifies on the session-changed event and storage events, unsubscribe stops it', () => {
    let calls = 0;
    const unsubscribe = subscribeSession(() => {
      calls += 1;
    });
    window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
    // No StorageEvent in bun — a tagged Event carries the same `.key` the
    // listener reads.
    const storageEvent = new Event('storage');
    Object.assign(storageEvent, { key: SESSION_STORAGE_KEY });
    window.dispatchEvent(storageEvent);
    expect(calls).toBe(2);
    unsubscribe();
    window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
    expect(calls).toBe(2);
  });
});