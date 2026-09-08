import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  ApiProblem,
  fetchApiCreateWarehouse,
  fetchApiInviteUser,
  fetchApiListWarehouses,
  fetchApiRegisterTenant,
  refreshSessionUser,
} from './client';
import { SESSION_STORAGE_KEY, writeSession, clearSession } from '../auth';
import type { StoredSession } from '../auth';

/**
 * Error-mapping contract for the API wrappers: a problem+json body becomes
 * an `ApiProblem` carrying the machine-readable `code` (what the forms
 * branch on), not prose and not a generic Error. Network behavior is
 * stubbed at `fetch` — the generated client is a fetch wrapper.
 *
 * The interceptor tests capture the request the stubbed fetch receives, so
 * the bearer attachment (review loop 2) is asserted, not assumed: deleting
 * the interceptor body used to keep the suite green while every signed-in
 * call 401'd.
 */
let lastRequest: Request | undefined;

function stubFetch(status: number, body: unknown): void {
  (globalThis as Record<string, unknown>).fetch = (async (input: RequestInfo | URL) => {
    lastRequest = input instanceof Request ? input : new Request(input.toString());
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  } as Storage;
  // auth.ts dispatches on write/clear; a no-op window is enough here.
  (globalThis as Record<string, unknown>).window = { dispatchEvent: () => true };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).fetch;
  delete (globalThis as Record<string, unknown>).localStorage;
  delete (globalThis as Record<string, unknown>).window;
  lastRequest = undefined;
});

const SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: '0198f7a2-1b3c-7d4e-8f90-112233445566', name: 'Priya Spices' },
  // Story 1.5: the session carries the signed-in user (role → surface gating).
  user: {
    id: '0198f7a2-1b3c-7d4e-8f90-aabbccddeeff',
    email: 'priya@example.com',
    role: 'operator',
    status: 'active',
  },
  expiresAt: Date.now() + 60_000,
};

describe('ApiProblem error mapping', () => {
  test('problem+json body → ApiProblem with the machine-readable code', async () => {
    stubFetch(409, {
      code: 'duplicate-email',
      title: 'Owner email already registered',
      status: 409,
      detail: 'An account for priya@example.com already exists.',
    });
    try {
      await fetchApiRegisterTenant(
        { name: 'Priya Spices', ownerEmail: 'priya@example.com', password: 'secret-password' },
        '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiProblem);
      const problem = error as ApiProblem;
      expect(problem.code).toBe('duplicate-email');
      expect(problem.status).toBe(409);
      expect(problem.detail).toContain('priya@example.com');
    }
  });

  test('non-problem error body → ApiProblem with the fallback code', async () => {
    stubFetch(500, { message: 'boom' });
    try {
      await fetchApiRegisterTenant(
        { name: 'Priya Spices', ownerEmail: 'priya@example.com', password: 'secret-password' },
        '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiProblem);
      expect((error as ApiProblem).code).toBe('request-failed');
    }
  });
});

describe('bearer interceptor', () => {
  test('a stored session is attached as Authorization: Bearer on API calls', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListWarehouses(SESSION.tenant.id);
    expect(lastRequest).toBeDefined();
    expect(lastRequest!.headers.get('Authorization')).toBe(`Bearer ${SESSION.token}`);
    // Drop the expiry timer the write scheduled — no pending handle at test end.
    clearSession();
  });

  test('signed out, no Authorization header is attached', async () => {
    clearSession();
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListWarehouses(SESSION.tenant.id);
    expect(lastRequest).toBeDefined();
    expect(lastRequest!.headers.get('Authorization')).toBeNull();
    // And the storage row is really gone.
    expect(store.has(SESSION_STORAGE_KEY)).toBe(false);
  });

  test('a mutating wrapper forwards its Idempotency-Key header', async () => {
    writeSession(SESSION);
    stubFetch(200, { id: 'w1', tenantId: SESSION.tenant.id, code: 'BLR-01', name: 'Whitefield', createdAt: '2026-09-08T00:00:00.000Z' });
    await fetchApiCreateWarehouse(
      SESSION.tenant.id,
      { code: 'BLR-01', name: 'Whitefield' },
      '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    );
    expect(lastRequest).toBeDefined();
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    clearSession();
  });

  test('the invite wrapper forwards its Idempotency-Key and posts the invite body (story 1.5)', async () => {
    writeSession(SESSION);
    stubFetch(201, {
      user: {
        id: '0198f7a2-1b3c-7d4e-8f90-998877665544',
        email: 'arjun@example.com',
        role: 'operator',
        status: 'invited',
      },
      inviteToken: 'raw-token',
      expiresAt: '2026-09-15T00:00:00.000Z',
    });
    const invited = await fetchApiInviteUser(
      SESSION.tenant.id,
      { email: 'arjun@example.com', role: 'operator' },
      '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    );
    expect(invited.inviteToken).toBe('raw-token');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(lastRequest!.headers.get('Authorization')).toBe(`Bearer ${SESSION.token}`);
    const body = (await lastRequest!.json()) as Record<string, unknown>;
    expect(body).toEqual({ email: 'arjun@example.com', role: 'operator' });
    clearSession();
  });
});

describe('refreshSessionUser (story 1.5 /me bootstrap)', () => {
  test('a changed role is refetched from /me and written back into the session', async () => {
    writeSession(SESSION);
    stubFetch(200, {
      user: { ...SESSION.user, role: 'accountant' },
    });
    await refreshSessionUser();
    const stored = JSON.parse(store.get(SESSION_STORAGE_KEY)!) as { user: { role: string } };
    expect(stored.user.role).toBe('accountant');
    clearSession();
  });

  test('an unchanged /me response does not rewrite the stored row', async () => {
    writeSession(SESSION);
    const before = store.get(SESSION_STORAGE_KEY);
    stubFetch(200, {
      user: { ...SESSION.user },
    });
    await refreshSessionUser();
    expect(store.get(SESSION_STORAGE_KEY)).toBe(before);
    clearSession();
  });

  test('a failed refresh keeps the stored session (best-effort bootstrap)', async () => {
    writeSession(SESSION);
    // 500, not 401 — a 401 would trigger the interceptor's clearSession, a
    // different (authoritative) path than the refresh's own catch-silent.
    stubFetch(500, { message: 'boom' });
    // Must not throw — the refresh is cosmetic; the backend still gates
    // every command, so a stale stored role is only a hiding hint.
    await refreshSessionUser();
    expect(store.has(SESSION_STORAGE_KEY)).toBe(true);
    clearSession();
  });
});

describe('401 response interceptor', () => {
  test('a 401 clears the stored session — the backend verdict is authoritative', async () => {
    writeSession(SESSION);
    stubFetch(401, {
      code: 'unauthenticated',
      title: 'Authentication required',
      status: 401,
    });
    try {
      await fetchApiListWarehouses(SESSION.tenant.id);
      expect.unreachable();
    } catch {
      // The wrapper maps the error; the interceptor has already run by now.
    }
    expect(store.has(SESSION_STORAGE_KEY)).toBe(false);
  });

  test('other error statuses leave the session alone', async () => {
    writeSession(SESSION);
    stubFetch(409, {
      code: 'duplicate-warehouse-code',
      title: 'Warehouse code already in use',
      status: 409,
    });
    try {
      await fetchApiCreateWarehouse(
        SESSION.tenant.id,
        { code: 'BLR-01', name: 'Whitefield' },
        '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      );
      expect.unreachable();
    } catch {
      // mapped error — asserted elsewhere
    }
    expect(store.has(SESSION_STORAGE_KEY)).toBe(true);
    clearSession();
  });
});