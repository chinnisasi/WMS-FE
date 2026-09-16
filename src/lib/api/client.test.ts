import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { restoreGlobals, stubGlobal } from '../test/globals';

import {
  ApiProblem,
  fetchApiCancelOrder,
  fetchApiCancelWave,
  fetchApiCreateOrder,
  fetchApiCreateWarehouse,
  fetchApiCreateWavePolicy,
  fetchApiGenerateWave,
  fetchApiGetOrder,
  fetchApiGetWave,
  fetchApiInviteUser,
  fetchApiListOrders,
  fetchApiListWarehouses,
  fetchApiListWavePolicies,
  fetchApiListWaves,
  fetchApiRegisterTenant,
  fetchApiReleaseWave,
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
  stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    lastRequest = input instanceof Request ? input : new Request(input.toString());
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch);
}

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  stubGlobal('localStorage', {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  } as Storage);
  // auth.ts dispatches on write/clear; a no-op window is enough here.
  stubGlobal('window', { dispatchEvent: () => true });
});

afterEach(() => {
  restoreGlobals();
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

  test('a transport failure is surfaced as the fetch’s own Error, not as an ApiProblem', async () => {
    // The generated client hands a rejected fetch back as `error`, so this
    // used to be dressed up as ApiProblem('request-failed') with the raw
    // "TypeError: Failed to fetch" as its detail — which every reason mapper
    // then rendered verbatim, making the house "is wms-be running?" copy
    // unreachable in practice. There is no HTTP response and no server
    // `code` here, so the Error travels as itself.
    stubGlobal('fetch', (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch);
    try {
      await fetchApiListWarehouses(SESSION.tenant.id);
      expect.unreachable();
    } catch (error) {
      expect(error).not.toBeInstanceOf(ApiProblem);
      expect(error).toBeInstanceOf(TypeError);
    }
  });

  test('a non-JSON error body (a proxy’s HTML 502) never reaches a surface as markup', async () => {
    // `String(error)` used to become the `detail` every reason mapper renders
    // in its default arm, putting a `<html>…` page on screen. There is no
    // problem `code` here and nothing the server said in a usable shape, so
    // it is transport-shaped and the house unreachable copy fires.
    stubGlobal('fetch', (async () =>
      new Response('<html><body>502 Bad Gateway</body></html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      })) as unknown as typeof fetch);
    try {
      await fetchApiListWarehouses(SESSION.tenant.id);
      expect.unreachable();
    } catch (error) {
      expect(error).not.toBeInstanceOf(ApiProblem);
      expect(String(error)).not.toContain('<html>');
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
      inviteExpiresAt: '2026-09-15T00:00:00.000Z',
    });
    const invited = await fetchApiInviteUser(
      SESSION.tenant.id,
      { email: 'arjun@example.com', role: 'operator' },
      '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    );
    expect(invited.inviteToken).toBe('raw-token');
    expect(invited.inviteExpiresAt).toBe('2026-09-15T00:00:00.000Z');
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


/**
 * Story 4.2b — the Outbound orders wrappers. The assertions that matter are
 * the ones a component can never make: the URL the warehouse-scoped list
 * actually hits, that every mutating call carries its `Idempotency-Key`
 * header, that cancel sends the required empty body, and that the problem
 * `title` survives unwrapping (the 409 cancel refusal is rendered verbatim,
 * so dropping it would silently blank the only explanation the user gets).
 */
describe('outbound order wrappers (story 4.2b)', () => {
  const WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';
  const ORDER_ID = '0198f7a2-1b3c-7d4e-8f90-0011223344ff';
  const KEY = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

  test('the order list is warehouse-scoped and passes the keyset cursor through', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListOrders(SESSION.tenant.id, WAREHOUSE_ID, { cursor: 'opaque-cursor', limit: 50 });
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/warehouses/${WAREHOUSE_ID}/outbound/orders`,
    );
    expect(url.searchParams.get('cursor')).toBe('opaque-cursor');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(lastRequest!.method).toBe('GET');
    clearSession();
  });

  test('a first-page list sends no query at all', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListOrders(SESSION.tenant.id, WAREHOUSE_ID);
    expect(new URL(lastRequest!.url).search).toBe('');
    clearSession();
  });

  test('the detail read hits the tenant-scoped order path', async () => {
    writeSession(SESSION);
    stubFetch(200, { order: { id: ORDER_ID, lines: [] } });
    await fetchApiGetOrder(SESSION.tenant.id, ORDER_ID);
    expect(new URL(lastRequest!.url).pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/outbound/orders/${ORDER_ID}`,
    );
    clearSession();
  });

  test('create sends the body and the Idempotency-Key header', async () => {
    writeSession(SESSION);
    stubFetch(201, { order: { id: ORDER_ID, lines: [] } });
    await fetchApiCreateOrder(
      SESSION.tenant.id,
      { warehouseId: WAREHOUSE_ID, lines: [{ skuId: 'sku-1', quantity: 4 }] },
      KEY,
    );
    expect(lastRequest!.method).toBe('POST');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({
      warehouseId: WAREHOUSE_ID,
      lines: [{ skuId: 'sku-1', quantity: 4 }],
    });
    clearSession();
  });

  test('cancel sends the required empty body and the Idempotency-Key header', async () => {
    writeSession(SESSION);
    stubFetch(200, { order: { id: ORDER_ID, status: 'cancelled', lines: [] } });
    await fetchApiCancelOrder(SESSION.tenant.id, ORDER_ID, KEY);
    expect(new URL(lastRequest!.url).pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/outbound/orders/${ORDER_ID}/cancel`,
    );
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    // The endpoint's body is required and is `{}` — omitting it 400s.
    expect(await lastRequest!.json()).toEqual({});
    clearSession();
  });

  test('a 409 cancel refusal unwraps with its title and detail intact', async () => {
    writeSession(SESSION);
    // The real wire shape: wms-be's ProblemException sets `message` to the
    // DETAIL, and the problem-details filter renders `title` from
    // `exception.message` — so a refusal arrives with title === detail and
    // the exception's own title ("Order has drawn pick lines") never leaves
    // the server. `verbatim()` collapses the pair; both fields are still
    // carried, which is RFC 9457 hygiene the next endpoint may rely on.
    const sentence =
      'Order "0198f7a2" has 2 drawn pick line(s) — a consuming flow already claimed them.';
    stubFetch(409, {
      type: 'about:blank',
      code: 'conflict',
      title: sentence,
      status: 409,
      detail: sentence,
      errors: [sentence],
    });
    try {
      await fetchApiCancelOrder(SESSION.tenant.id, ORDER_ID, KEY);
      expect.unreachable();
    } catch (error) {
      const problem = error as ApiProblem;
      expect(problem).toBeInstanceOf(ApiProblem);
      expect(problem.status).toBe(409);
      expect(problem.title).toBe(sentence);
      expect(problem.detail).toBe(sentence);
    }
    clearSession();
  });
});

describe('outbound wave wrappers (story 4.2c)', () => {
  const WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';
  const WAVE_ID = '0198f7a2-1b3c-7d4e-8f90-5566778899aa';
  const POLICY_ID = '0198f7a2-1b3c-7d4e-8f90-bbccddee0011';
  const KEY = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

  test('the wave list is warehouse-scoped and sends no query on the first page', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListWaves(SESSION.tenant.id, WAREHOUSE_ID);
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/warehouses/${WAREHOUSE_ID}/outbound/waves`,
    );
    expect(url.search).toBe('');
    clearSession();
  });

  test('a cursor is passed through as the keyset query', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListWaves(SESSION.tenant.id, WAREHOUSE_ID, { cursor: 'opaque-cursor' });
    expect(new URL(lastRequest!.url).searchParams.get('cursor')).toBe('opaque-cursor');
    clearSession();
  });

  test('the policy list is warehouse-scoped too', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListWavePolicies(SESSION.tenant.id, WAREHOUSE_ID);
    expect(new URL(lastRequest!.url).pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/warehouses/${WAREHOUSE_ID}/outbound/wave-policies`,
    );
    clearSession();
  });

  test('the wave detail read hits the tenant-scoped wave path', async () => {
    writeSession(SESSION);
    stubFetch(200, { wave: { id: WAVE_ID, picklists: [] } });
    await fetchApiGetWave(SESSION.tenant.id, WAVE_ID);
    expect(new URL(lastRequest!.url).pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/outbound/waves/${WAVE_ID}`,
    );
    expect(lastRequest!.method).toBe('GET');
    clearSession();
  });

  test('creating a policy sends the body and the Idempotency-Key header', async () => {
    writeSession(SESSION);
    stubFetch(201, { policy: { id: POLICY_ID } });
    await fetchApiCreateWavePolicy(
      SESSION.tenant.id,
      { warehouseId: WAREHOUSE_ID, name: 'Evening courier', grouping: 'batch', cutoffLocalTime: '18:00' },
      KEY,
    );
    expect(new URL(lastRequest!.url).pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/outbound/wave-policies`,
    );
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({
      warehouseId: WAREHOUSE_ID,
      name: 'Evening courier',
      grouping: 'batch',
      cutoffLocalTime: '18:00',
    });
    clearSession();
  });

  test('generate sends the selection body — omitting orderIds is the auto-sweep', async () => {
    writeSession(SESSION);
    stubFetch(201, { wave: { id: WAVE_ID, picklists: [] } });
    await fetchApiGenerateWave(
      SESSION.tenant.id,
      { warehouseId: WAREHOUSE_ID, policyId: POLICY_ID },
      KEY,
    );
    expect(new URL(lastRequest!.url).pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/outbound/waves`,
    );
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({
      warehouseId: WAREHOUSE_ID,
      policyId: POLICY_ID,
    });
    clearSession();
  });

  test('generate carries an explicit order selection when one is given', async () => {
    writeSession(SESSION);
    stubFetch(201, { wave: { id: WAVE_ID, picklists: [] } });
    await fetchApiGenerateWave(
      SESSION.tenant.id,
      { warehouseId: WAREHOUSE_ID, policyId: POLICY_ID, orderIds: ['o-1', 'o-2'] },
      KEY,
    );
    expect(await lastRequest!.json()).toEqual({
      warehouseId: WAREHOUSE_ID,
      policyId: POLICY_ID,
      orderIds: ['o-1', 'o-2'],
    });
    clearSession();
  });

  test('release sends NO body and still sets the Idempotency-Key header', async () => {
    writeSession(SESSION);
    stubFetch(200, { wave: { id: WAVE_ID, status: 'released', picklists: [] } });
    await fetchApiReleaseWave(SESSION.tenant.id, WAVE_ID, KEY);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/outbound/waves/${WAVE_ID}/release`,
    );
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    // Unlike cancel-order, whose `{}` is REQUIRED, this endpoint declares no
    // body at all — sending one would be a contract drift the suite must catch.
    expect(await lastRequest!.text()).toBe('');
    clearSession();
  });

  test('cancel sends NO body and still sets the Idempotency-Key header', async () => {
    writeSession(SESSION);
    stubFetch(200, { wave: { id: WAVE_ID, status: 'cancelled', picklists: [] } });
    await fetchApiCancelWave(SESSION.tenant.id, WAVE_ID, KEY);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/outbound/waves/${WAVE_ID}/cancel`,
    );
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.text()).toBe('');
    clearSession();
  });

  test('a 409 cutoff-passed release refusal unwraps with its title and detail intact', async () => {
    writeSession(SESSION);
    const sentence =
      'The 18:00 Asia/Kolkata cutoff has passed — the wave stays planned.';
    stubFetch(409, {
      type: 'about:blank',
      code: 'cutoff-passed',
      title: sentence,
      status: 409,
      detail: sentence,
    });
    try {
      await fetchApiReleaseWave(SESSION.tenant.id, WAVE_ID, KEY);
      expect.unreachable();
    } catch (error) {
      const problem = error as ApiProblem;
      expect(problem).toBeInstanceOf(ApiProblem);
      expect(problem.status).toBe(409);
      expect(problem.code).toBe('cutoff-passed');
      expect(problem.detail).toBe(sentence);
    }
    clearSession();
  });

  test('a 422 generate refusal keeps the machine-readable code the mapper branches on', async () => {
    writeSession(SESSION);
    stubFetch(422, {
      type: 'about:blank',
      code: 'no-eligible-orders',
      title: 'No accepted order is free to wave',
      status: 422,
      detail: 'Every accepted order in this warehouse is already on an open wave.',
    });
    try {
      await fetchApiGenerateWave(
        SESSION.tenant.id,
        { warehouseId: WAREHOUSE_ID, policyId: POLICY_ID },
        KEY,
      );
      expect.unreachable();
    } catch (error) {
      const problem = error as ApiProblem;
      expect(problem.code).toBe('no-eligible-orders');
      expect(problem.status).toBe(422);
    }
    clearSession();
  });
});
