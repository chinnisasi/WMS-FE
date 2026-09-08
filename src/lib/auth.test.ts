import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  SESSION_CHANGED_EVENT,
  SESSION_STORAGE_KEY,
  clearSession,
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

function installShims(): void {
  store = new Map();
  removed = [];
  dispatched = [];
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
  expiresAt: Date.now() + 60_000,
};

const EXPIRED: StoredSession = {
  ...SESSION,
  tenant: { ...SESSION.tenant },
  expiresAt: Date.now() - 1,
};

beforeEach(installShims);
afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage;
  delete (globalThis as Record<string, unknown>).window;
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