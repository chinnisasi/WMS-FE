import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { restoreGlobals, stubGlobal } from '../test/globals';

import {
  ApiProblem,
  fetchApiCorrectSkuClient,
  fetchApiCreateClient,
  fetchApiActivateRateCard,
  fetchApiCancelRateCard,
  fetchApiCreateRateCard,
  fetchApiDiscardRateCard,
  fetchApiDiscardClientInvoice,
  fetchApiGetClientInvoice,
  fetchApiClientInvoiceLineRecords,
  fetchApiClientInvoiceStorageBreakdown,
  fetchApiIssueClientInvoice,
  fetchApiListClientInvoices,
  fetchApiPrepareClientInvoices,
  fetchApiRefreshClientInvoice,
  fetchApiTransitionClientInvoice,
  fetchApiAmendAsn,
  fetchApiCreateAsn,
  fetchApiGetAsn,
  fetchApiListAsns,
  fetchApiTransitionAsn,
  fetchApiUpdateClientTaxDetails,
  fetchApiListRateCards,
  fetchApiRateCardInForce,
  fetchApiClientUsage,
  fetchApiReplaceRateCardLines,
  fetchApiImportCatalog,
  fetchApiListClients,
  fetchApiRenameClient,
  fetchApiCancelOrder,
  fetchApiCancelWave,
  fetchApiCreateKit,
  fetchApiCreateOrder,
  fetchApiCreateProduct,
  fetchApiCreateWarehouse,
  fetchApiCreateWavePolicy,
  fetchApiApproveAdjustmentPending,
  fetchApiListAdjustmentPendings,
  fetchApiListLedgerEvents,
  fetchApiListVariances,
  fetchApiRejectAdjustmentPending,
  fetchApiResolveVariance,
  fetchApiDispatchOrder,
  fetchApiEditProduct,
  fetchApiEditSku,
  fetchApiGenerateWave,
  fetchApiGetOrder,
  fetchApiGetOrderColdChainTrace,
  fetchApiGetSegregationMatrix,
  fetchApiGetWave,
  fetchApiInviteUser,
  fetchApiGenerateInvoice,
  fetchApiAppendEwayStateThreshold,
  fetchApiDismissEwayBill,
  fetchApiExportEwayBills,
  fetchApiGenerateEwayBill,
  fetchApiListEwayBills,
  fetchApiListEwayGstinSettings,
  fetchApiListEwayStateThresholds,
  fetchApiPutEwayGstinSetting,
  fetchApiRecordEwayBill,
  fetchApiUpdateEwayTransport,
  fetchApiGetInvoice,
  fetchApiHsnSummary,
  fetchApiHsnSummaryGstins,
  fetchApiListExcursions,
  fetchApiListInvoices,
  fetchApiListKits,
  fetchApiListOrders,
  fetchApiListProducts,
  fetchApiListSkus,
  fetchApiListWarehouses,
  fetchApiListWavePolicies,
  fetchApiListWaves,
  fetchApiPackOrder,
  fetchApiRegisterTenant,
  fetchApiReleaseWave,
  fetchApiReplaceKit,
  fetchApiReportingOverview,
  fetchApiResolveExcursion,
  refreshSessionUser,
  fetchApiPortalAsn,
  fetchApiPortalAsns,
  fetchApiPortalInvoice,
  fetchApiPortalInvoices,
  fetchApiPortalMe,
  fetchApiPortalOrder,
  fetchApiPortalOrders,
  fetchApiPortalPurchaseOrder,
  fetchApiPortalPurchaseOrders,
  fetchApiPortalStock,
} from './client';
import { SESSION_STORAGE_KEY, writeSession, clearSession, PORTAL_SUSPENDED_EVENT } from '../auth';
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

/**
 * A full origin address (story 11-1) — warehouse creation REQUIRES it; the
 * wrapper forwards it verbatim, so the pincode stays a string.
 */
const TEST_ORIGIN = {
  contactName: 'Priya Sharma',
  phone: '+91 98450 12345',
  line1: '12, Peenya Industrial Area',
  line2: 'Gate 3',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560066',
};

const SESSION: StoredSession = {
  token: 'header.payload.signature',
  tenant: { id: '0198f7a2-1b3c-7d4e-8f90-112233445566', name: 'Priya Spices', gstin: null },
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
      { code: 'BLR-01', name: 'Whitefield', origin: TEST_ORIGIN },
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
  test('the SKU edit PATCH forwards the five attribute fields verbatim (story 11.2)', async () => {
    writeSession(SESSION);
    stubFetch(200, {
      id: 'sku-1',
      tenantId: SESSION.tenant.id,
      code: 'SPICE-01',
      name: 'Turmeric 500g',
      uom: 'each',
      uomPrecision: 0,
      gstRateBps: 1800,
      hsn: '10062020',
      batchTracked: false,
      serialTracked: false,
      catchWeightTracked: false,
      weightGrams: 500,
      lengthMm: 200,
      widthMm: 150,
      heightMm: 100,
      countryOfOrigin: 'IN',
      reorderPoint: '50',
      reorderQty: '100',
      barcode: 'BC-SPICE-01',
      uomConversions: [],
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    // The five story-11.2 attributes go through the same PATCH as the
    // pre-existing fields — the wrapper must forward them verbatim, including
    // the `null` clears (the hsn template) and the absent fields (undefined
    // keys drop out of the JSON body, so the idempotency hash never changes).
    await fetchApiEditSku(
      SESSION.tenant.id,
      'sku-1',
      {
        name: 'Turmeric 500g',
        gstRate: 1800,
        hsn: null,
        batchTracked: false,
        serialTracked: false,
        weightGrams: 500,
        lengthMm: null,
        widthMm: 150,
        heightMm: 100,
        countryOfOrigin: 'IN',
        reorderPoint: 50,
        reorderQty: 100,
        barcode: 'BC-SPICE-01',
      },
      '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    );
    const body = (await lastRequest!.json()) as Record<string, unknown>;
    expect(lastRequest!.method).toBe('PATCH');
    expect(lastRequest!.url).toContain('/catalog/skus/sku-1');
    expect(body.weightGrams).toBe(500);
    expect(body.lengthMm).toBeNull();
    expect(body.widthMm).toBe(150);
    expect(body.heightMm).toBe(100);
    expect(body.countryOfOrigin).toBe('IN');
    expect(body.hsn).toBeNull();
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
        { code: 'BLR-01', name: 'Whitefield', origin: TEST_ORIGIN },
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
    const destination = {
      contactName: 'Priya Sharma',
      phone: '+91 98450 12345',
      line1: '12, Peenya Industrial Area',
      line2: 'Gate 3',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560066',
    };
    await fetchApiCreateOrder(
      SESSION.tenant.id,
      { warehouseId: WAREHOUSE_ID, lines: [{ skuId: 'sku-1', quantity: 4 }], destination },
      KEY,
    );
    expect(lastRequest!.method).toBe('POST');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({
      warehouseId: WAREHOUSE_ID,
      lines: [{ skuId: 'sku-1', quantity: 4 }],
      destination,
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

describe('outbound pack and dispatch wrappers (story 4-2d)', () => {
  const ORDER_ID = '0198f7a2-1b3c-7d4e-8f90-0011223344ff';
  const KEY = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

  test('pack posts the scan body to the tenant-scoped pack path with the key', async () => {
    writeSession(SESSION);
    stubFetch(201, { pack: { orderId: ORDER_ID, lines: [], totalUnits: 7 } });
    await fetchApiPackOrder(
      SESSION.tenant.id,
      ORDER_ID,
      {
        scanned: [
          { skuId: 'sku-1', qty: 4 },
          { skuId: 'sku-2', qty: 3 },
        ],
        weightGrams: 2500,
        dimensionsMm: { lengthMm: 300, widthMm: 200, heightMm: 100 },
      },
      KEY,
    );
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/outbound/orders/${ORDER_ID}/pack`,
    );
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({
      scanned: [
        { skuId: 'sku-1', qty: 4 },
        { skuId: 'sku-2', qty: 3 },
      ],
      weightGrams: 2500,
      dimensionsMm: { lengthMm: 300, widthMm: 200, heightMm: 100 },
    });
    clearSession();
  });

  test('dispatch posts the carrier body and the Idempotency-Key header to the tenant-scoped path', async () => {
    writeSession(SESSION);
    stubFetch(201, { dispatch: { orderId: ORDER_ID, lines: [], totalUnits: 7 } });
    await fetchApiDispatchOrder(
      SESSION.tenant.id,
      ORDER_ID,
      { carrierName: 'Blue Dart', trackingNumber: 'BD0012345678' },
      KEY,
    );
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/outbound/orders/${ORDER_ID}/dispatch`,
    );
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({
      carrierName: 'Blue Dart',
      trackingNumber: 'BD0012345678',
    });
    clearSession();
  });

  test('dispatch with no carrier fields sends an empty body — a complete dispatch', async () => {
    writeSession(SESSION);
    stubFetch(201, { dispatch: { orderId: ORDER_ID, lines: [], totalUnits: 0 } });
    await fetchApiDispatchOrder(SESSION.tenant.id, ORDER_ID, {}, KEY);
    expect(new URL(lastRequest!.url).pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/outbound/orders/${ORDER_ID}/dispatch`,
    );
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({});
    clearSession();
  });

  test('a 422 pack-mismatch refusal unwraps with its title and detail intact', async () => {
    writeSession(SESSION);
    // The refusal's detail names both quantities — the only place picked
    // quantities exist in this whole client, so the surface renders it
    // verbatim and the wrapper must carry both fields through.
    const detail = 'SPICE-01 scanned 4.000 kg but picked 3.000 kg.';
    stubFetch(422, {
      type: 'about:blank',
      code: 'pack-mismatch',
      title: 'Pack mismatch',
      status: 422,
      detail,
    });
    try {
      await fetchApiPackOrder(SESSION.tenant.id, ORDER_ID, { scanned: [{ skuId: 'sku-1', qty: 4 }] }, KEY);
      expect.unreachable();
    } catch (error) {
      const problem = error as ApiProblem;
      expect(problem).toBeInstanceOf(ApiProblem);
      expect(problem.status).toBe(422);
      expect(problem.code).toBe('pack-mismatch');
      expect(problem.title).toBe('Pack mismatch');
      expect(problem.detail).toBe(detail);
    }
    clearSession();
  });

  test('a 409 dispatch refusal (not packed) unwraps with its status intact', async () => {
    writeSession(SESSION);
    stubFetch(409, {
      type: 'about:blank',
      code: 'order-not-packed',
      title: 'Order not packed',
      status: 409,
      detail: 'The order reads accepted, not ready_to_dispatch.',
    });
    try {
      await fetchApiDispatchOrder(SESSION.tenant.id, ORDER_ID, {}, KEY);
      expect.unreachable();
    } catch (error) {
      const problem = error as ApiProblem;
      expect(problem).toBeInstanceOf(ApiProblem);
      expect(problem.status).toBe(409);
      expect(problem.code).toBe('order-not-packed');
      expect(problem.detail).toBe('The order reads accepted, not ready_to_dispatch.');
    }
    clearSession();
  });
});

describe('catalog product and kit wrappers (story 11-6)', () => {
  const PRODUCT_ID = '0198f7a2-1b3c-7d4e-8f90-5566778899aa';
  const SKU_ID = '0198f7a2-1b3c-7d4e-8f90-aabb00112233';
  const KEY = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

  test('the product list is tenant-scoped and sends no query on the first page', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListProducts(SESSION.tenant.id);
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/catalog/products`);
    expect(url.search).toBe('');
    expect(lastRequest!.method).toBe('GET');
    clearSession();
  });

  test('a product cursor is passed through as the keyset query', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListProducts(SESSION.tenant.id, { cursor: 'opaque-cursor' });
    expect(new URL(lastRequest!.url).searchParams.get('cursor')).toBe('opaque-cursor');
    clearSession();
  });

  test('create product sends the body and the Idempotency-Key header', async () => {
    writeSession(SESSION);
    stubFetch(201, { id: PRODUCT_ID, name: 'Shirts', axes: ['size'], skuCount: 0 });
    await fetchApiCreateProduct(
      SESSION.tenant.id,
      { name: 'Shirts', axes: ['size', 'colour'] },
      KEY,
    );
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/catalog/products`,
    );
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({ name: 'Shirts', axes: ['size', 'colour'] });
    clearSession();
  });

  test('edit product PATCHes the tenant-scoped product path', async () => {
    writeSession(SESSION);
    stubFetch(200, { id: PRODUCT_ID, name: 'Shirts', axes: ['size'], skuCount: 0 });
    await fetchApiEditProduct(SESSION.tenant.id, PRODUCT_ID, { name: 'Shirts' }, KEY);
    expect(lastRequest!.method).toBe('PATCH');
    expect(new URL(lastRequest!.url).pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/catalog/products/${PRODUCT_ID}`,
    );
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({ name: 'Shirts' });
    clearSession();
  });

  test('the SKU list passes a productId filter through as the query', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListSkus(SESSION.tenant.id, { productId: PRODUCT_ID });
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/catalog/skus`);
    expect(url.searchParams.get('productId')).toBe(PRODUCT_ID);
    clearSession();
  });

  test('create kit POSTs the component array and the Idempotency-Key header', async () => {
    writeSession(SESSION);
    stubFetch(201, { skuId: SKU_ID, components: [] });
    await fetchApiCreateKit(
      SESSION.tenant.id,
      SKU_ID,
      { components: [{ skuId: 'comp-1', quantity: 2.5 }] },
      KEY,
    );
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/catalog/skus/${SKU_ID}/kit`,
    );
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    // Quantities cross the edge as base-UoM decimals — never raw milli.
    expect(await lastRequest!.json()).toEqual({ components: [{ skuId: 'comp-1', quantity: 2.5 }] });
    clearSession();
  });

  test('replace kit PUTs the whole replacement BOM', async () => {
    writeSession(SESSION);
    stubFetch(200, { skuId: SKU_ID, components: [] });
    await fetchApiReplaceKit(
      SESSION.tenant.id,
      SKU_ID,
      { components: [{ skuId: 'comp-2', quantity: 1 }] },
      KEY,
    );
    expect(lastRequest!.method).toBe('PUT');
    expect(new URL(lastRequest!.url).pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/catalog/skus/${SKU_ID}/kit`,
    );
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({ components: [{ skuId: 'comp-2', quantity: 1 }] });
    clearSession();
  });

  test('the kit list is tenant-scoped and sends no query on the first page', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListKits(SESSION.tenant.id);
    expect(new URL(lastRequest!.url).pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/catalog/kits`,
    );
    expect(new URL(lastRequest!.url).search).toBe('');
    clearSession();
  });

  test('a 409 kit-already-composed refusal unwraps with the machine-readable code', async () => {
    writeSession(SESSION);
    stubFetch(409, { code: 'kit-already-composed', title: 'Already a kit', status: 409, detail: 'x' });
    try {
      await fetchApiCreateKit(SESSION.tenant.id, SKU_ID, { components: [] }, KEY);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiProblem);
      expect((error as ApiProblem).code).toBe('kit-already-composed');
      expect((error as ApiProblem).status).toBe(409);
    }
    clearSession();
  });
});

/**
 * Story 12-7 — the storage/segregation admin and cold-chain trace wrappers.
 * The assertions a component can never make: the exact paths (the matrix is
 * catalog-scoped, the trace is warehouse-scoped under compliance), the
 * excursion list's filter query (and the empty first page that sends no
 * query at all), the resolve POST's required header and its NO-body contract,
 * and that a read wrapper stays a GET with no Idempotency-Key.
 */
describe('compliance and segregation wrappers (story 12-7)', () => {
  const WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';
  const EXCURSION_ID = '0198f7a2-1b3c-7d4e-8f90-3344556677aa';
  const ORDER_ID = '0198f7a2-1b3c-7d4e-8f90-0011223344ff';
  const KEY = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

  test('the segregation matrix read hits the tenant-scoped catalog path with no query', async () => {
    writeSession(SESSION);
    stubFetch(200, { classes: ['explosive'], incompatible: [] });
    const matrix = await fetchApiGetSegregationMatrix(SESSION.tenant.id);
    expect(matrix).toEqual({ classes: ['explosive'], incompatible: [] });
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/catalog/segregation-matrix`);
    expect(url.search).toBe('');
    expect(lastRequest!.method).toBe('GET');
    // An ungated read — no idempotency key rides a GET.
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
    clearSession();
  });

  test('the excursion list sends its warehouse/status/cursor filters as the query', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListExcursions(SESSION.tenant.id, {
      warehouseId: WAREHOUSE_ID,
      status: 'open',
      cursor: 'opaque-cursor',
    });
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/excursions`);
    expect(url.searchParams.get('warehouseId')).toBe(WAREHOUSE_ID);
    expect(url.searchParams.get('status')).toBe('open');
    expect(url.searchParams.get('cursor')).toBe('opaque-cursor');
    expect(lastRequest!.method).toBe('GET');
    clearSession();
  });

  test('the excursion list sends no query on a first page with no filters', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListExcursions(SESSION.tenant.id);
    expect(new URL(lastRequest!.url).search).toBe('');
    clearSession();
  });

  test('resolve POSTs the excursion-scoped path with the Idempotency-Key and no body', async () => {
    writeSession(SESSION);
    stubFetch(200, {
      excursion: {
        id: EXCURSION_ID,
        tenantId: SESSION.tenant.id,
        warehouseId: WAREHOUSE_ID,
        binId: 'bin-1',
        readingC: 9.5,
        note: null,
        holdIds: [],
        status: 'resolved',
        recordedBy: 'user-1',
        occurredAt: '2026-09-20T00:00:00.000Z',
        resolvedBy: 'user-2',
        resolvedAt: '2026-09-21T00:00:00.000Z',
        createdAt: '2026-09-20T00:00:00.000Z',
      },
    });
    const resolved = await fetchApiResolveExcursion(SESSION.tenant.id, EXCURSION_ID, KEY);
    expect(resolved.excursion.status).toBe('resolved');
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/excursions/${EXCURSION_ID}/resolve`,
    );
    expect(lastRequest!.method).toBe('POST');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    // The endpoint declares no body — sending one would be a contract drift
    // (the release-wave precedent).
    expect(await lastRequest!.text()).toBe('');
    clearSession();
  });

  test('the invoice list sends no query on a first page, and only the cursor after', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListInvoices(SESSION.tenant.id);
    expect(new URL(lastRequest!.url).pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/invoices`);
    expect(new URL(lastRequest!.url).search).toBe('');
    await fetchApiListInvoices(SESSION.tenant.id, { cursor: 'opaque-cursor' });
    const url = new URL(lastRequest!.url);
    expect(url.searchParams.get('cursor')).toBe('opaque-cursor');
    expect([...url.searchParams.keys()]).toEqual(['cursor']);
    expect(lastRequest!.method).toBe('GET');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
    clearSession();
  });

  test('the invoice detail read hits the invoice-scoped path', async () => {
    writeSession(SESSION);
    stubFetch(200, { invoice: { id: EXCURSION_ID } });
    await fetchApiGetInvoice(SESSION.tenant.id, EXCURSION_ID);
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/invoices/${EXCURSION_ID}`);
    expect(lastRequest!.method).toBe('GET');
    clearSession();
  });

  test('the HSN summary read sends gstin and period as the query on the summary path, with no key', async () => {
    writeSession(SESSION);
    stubFetch(200, { summary: {} });
    await fetchApiHsnSummary(SESSION.tenant.id, { gstin: '29AAAPZ1234C1ZV', period: 'FY-2627-Q2' });
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/invoices/hsn-summary`);
    expect(url.searchParams.get('gstin')).toBe('29AAAPZ1234C1ZV');
    expect(url.searchParams.get('period')).toBe('FY-2627-Q2');
    expect([...url.searchParams.keys()].sort()).toEqual(['gstin', 'period']);
    expect(lastRequest!.method).toBe('GET');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
    clearSession();
  });

  test('the HSN summary GSTIN list hits its own two-segment path with no query', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [] });
    await fetchApiHsnSummaryGstins(SESSION.tenant.id);
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/invoices/hsn-summary/gstins`);
    expect(url.search).toBe('');
    expect(lastRequest!.method).toBe('GET');
    clearSession();
  });

  test('an HSN summary refusal surfaces as an ApiProblem carrying its code', async () => {
    writeSession(SESSION);
    stubFetch(400, { type: 'about:blank', title: 'Invalid HSN summary period', status: 400, code: 'validation-failed', detail: 'month 13' });
    let caught: unknown;
    try {
      await fetchApiHsnSummary(SESSION.tenant.id, { gstin: '29AAAPZ1234C1ZV', period: '2026-13' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiProblem);
    expect((caught as ApiProblem).code).toBe('validation-failed');
    clearSession();
  });

  test('generate POSTs the order id and rates as the body, with the Idempotency-Key', async () => {
    writeSession(SESSION);
    stubFetch(200, { invoice: { id: EXCURSION_ID, status: 'issued' } });
    const body = { orderId: ORDER_ID, rates: [{ orderLineId: EXCURSION_ID, ratePaise: 12550 }] };
    await fetchApiGenerateInvoice(SESSION.tenant.id, body, KEY);
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/invoices`);
    expect(lastRequest!.method).toBe('POST');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(JSON.parse(await lastRequest!.text())).toEqual(body);
    clearSession();
  });

  test('a generate refusal surfaces as an ApiProblem carrying the 8-1 code', async () => {
    writeSession(SESSION);
    stubFetch(409, { code: 'line-already-priced', title: 'Rate line is already priced', status: 409 });
    let caught: unknown;
    try {
      await fetchApiGenerateInvoice(SESSION.tenant.id, { orderId: ORDER_ID }, KEY);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiProblem);
    expect((caught as ApiProblem).code).toBe('line-already-priced');
    clearSession();
  });

  test('the cold-chain trace read hits the warehouse-scoped compliance path', async () => {
    writeSession(SESSION);
    stubFetch(200, { order: { id: ORDER_ID, status: 'dispatched', carrierName: null, trackingNumber: null, dispatchedAt: '2026-09-20T00:00:00.000Z' }, bins: [], lines: [] });
    const trace = await fetchApiGetOrderColdChainTrace(SESSION.tenant.id, WAREHOUSE_ID, ORDER_ID);
    expect(trace.order.id).toBe(ORDER_ID);
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/warehouses/${WAREHOUSE_ID}/cold-chain/orders/${ORDER_ID}`,
    );
    expect(url.search).toBe('');
    expect(lastRequest!.method).toBe('GET');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
    clearSession();
  });

  test('a 409 excursion-resolved refusal keeps the machine-readable code', async () => {
    writeSession(SESSION);
    stubFetch(409, {
      code: 'excursion-resolved',
      title: 'Already resolved',
      status: 409,
      detail: 'This excursion was resolved at 2026-09-21T00:00:00.000Z.',
    });
    try {
      await fetchApiResolveExcursion(SESSION.tenant.id, EXCURSION_ID, KEY);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiProblem);
      expect((error as ApiProblem).code).toBe('excursion-resolved');
      expect((error as ApiProblem).status).toBe(409);
      expect((error as ApiProblem).detail).toContain('resolved');
    }
    clearSession();
  });
});

/**
 * Story 5-5's six wrappers — the Conflicts & Reviews queue's reads and
 * decisions. The variances and ledger wrappers follow the house read shape
 * (a first page with no filters sends NO query at all), the three decision
 * wrappers carry the fresh ULID `Idempotency-Key` header, and the resolve
 * body carries the approve_adjust statement (`consideredEventSeqs`).
 */
describe('5-5 wrappers (variances, pendings, ledger events)', () => {
  const KEY = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
  const VARIANCE_ID = '0198f7a2-1b3c-7d4e-8f90-5566778899aa';
  const PENDING_ID = '0198f7a2-1b3c-7d4e-8f90-66778899aabb';
  const WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-778899aabbcc';
  const BIN_ID = '0198f7a2-1b3c-7d4e-8f90-8899aabbccdd';

  test('the variance list GET hits the movements path and forwards status + cursor', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListVariances(SESSION.tenant.id, { status: 'open', warehouseId: undefined, cursor: 'c1' });
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/movements/variances`);
    expect(url.searchParams.get('status')).toBe('open');
    expect(url.searchParams.get('cursor')).toBe('c1');
    expect(lastRequest!.method).toBe('GET');
    clearSession();
  });

  test('a variance first page with no filters sends no query at all', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListVariances(SESSION.tenant.id);
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/movements/variances`);
    expect(url.search).toBe('');
    clearSession();
  });

  test('the resolve POST carries the statement body and the fresh key header', async () => {
    writeSession(SESSION);
    stubFetch(200, { variance: { id: VARIANCE_ID, status: 'adjusted' } });
    await fetchApiResolveVariance(
      SESSION.tenant.id,
      VARIANCE_ID,
      { decision: 'approve_adjust', consideredEventSeqs: [3, 1] },
      KEY,
    );
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/movements/variances/${VARIANCE_ID}/resolve`,
    );
    expect(lastRequest!.method).toBe('POST');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({
      decision: 'approve_adjust',
      consideredEventSeqs: [3, 1],
    });
    clearSession();
  });

  test('the recount resolve body carries the decision alone', async () => {
    writeSession(SESSION);
    stubFetch(200, { variance: { id: VARIANCE_ID, status: 'recounted' } });
    await fetchApiResolveVariance(SESSION.tenant.id, VARIANCE_ID, { decision: 'recount' }, KEY);
    expect(await lastRequest!.json()).toEqual({ decision: 'recount' });
    clearSession();
  });

  test('the pendings list GET forwards status + cursor on the inventory path', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListAdjustmentPendings(SESSION.tenant.id, { status: 'pending', cursor: 'p1' });
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/inventory/adjustment-pendings`,
    );
    expect(url.searchParams.get('status')).toBe('pending');
    expect(url.searchParams.get('cursor')).toBe('p1');
    clearSession();
  });

  test('both pendings decisions POST with the key header and no body', async () => {
    writeSession(SESSION);
    stubFetch(200, { pending: { id: PENDING_ID, status: 'approved' } });
    await fetchApiApproveAdjustmentPending(SESSION.tenant.id, PENDING_ID, KEY);
    expect(new URL(lastRequest!.url).pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/inventory/adjustment-pendings/${PENDING_ID}/approve`,
    );
    expect(lastRequest!.method).toBe('POST');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.text()).toBe('');

    stubFetch(200, { pending: { id: PENDING_ID, status: 'rejected' } });
    await fetchApiRejectAdjustmentPending(SESSION.tenant.id, PENDING_ID, KEY);
    expect(new URL(lastRequest!.url).pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/inventory/adjustment-pendings/${PENDING_ID}/reject`,
    );
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    clearSession();
  });

  test('the ledger events GET carries the binId filter for the panel', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListLedgerEvents(SESSION.tenant.id, WAREHOUSE_ID, { binId: BIN_ID });
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/warehouses/${WAREHOUSE_ID}/inventory/events`,
    );
    expect(url.searchParams.get('binId')).toBe(BIN_ID);
    expect(url.searchParams.get('cursor')).toBeNull();
    clearSession();
  });

  test('a 409 variance-resolved refusal keeps the machine-readable code', async () => {
    writeSession(SESSION);
    stubFetch(409, {
      code: 'variance-resolved',
      title: 'Already resolved',
      status: 409,
      detail: 'This variance was resolved moments ago.',
    });
    try {
      await fetchApiResolveVariance(
        SESSION.tenant.id,
        VARIANCE_ID,
        { decision: 'recount' },
        KEY,
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiProblem);
      expect((error as ApiProblem).code).toBe('variance-resolved');
      expect((error as ApiProblem).status).toBe(409);
    }
    clearSession();
  });

  test('a 409 adjustment-pending-decided refusal keeps the machine-readable code', async () => {
    writeSession(SESSION);
    stubFetch(409, {
      code: 'adjustment-pending-decided',
      title: 'Already decided',
      status: 409,
      detail: 'Another approver settled this pend.',
    });
    try {
      await fetchApiApproveAdjustmentPending(SESSION.tenant.id, PENDING_ID, KEY);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiProblem);
      expect((error as ApiProblem).code).toBe('adjustment-pending-decided');
      expect((error as ApiProblem).status).toBe(409);
    }
    clearSession();
  });
});

describe('e-way bill wrappers (story 8-2b)', () => {
  const EKEY = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
  const BILL = '0198f7a2-1b3c-7d4e-8f90-0000000000e1';
  const base = (): string => `/api/v1/tenants/${SESSION.tenant.id}/eway`;

  afterEach(() => clearSession());

  test('the bill list sends no query on an unfiltered first page, then exactly the filters set', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListEwayBills(SESSION.tenant.id);
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/bills`);
    expect(new URL(lastRequest!.url).search).toBe('');
    await fetchApiListEwayBills(SESSION.tenant.id, { status: 'pending', gstin: '29AAAPZ1234C1ZV', cursor: 'c-2' });
    const url = new URL(lastRequest!.url);
    expect(Object.fromEntries(url.searchParams)).toEqual({ status: 'pending', gstin: '29AAAPZ1234C1ZV', cursor: 'c-2' });
    expect(lastRequest!.method).toBe('GET');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
  });

  test('export POSTs the ids with the key; a 409 keeps the per-bill reasons in extensions', async () => {
    writeSession(SESSION);
    stubFetch(200, { file: { version: '1.0.0621', billLists: [] } });
    await fetchApiExportEwayBills(SESSION.tenant.id, [BILL], EKEY);
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/bills/export`);
    expect(lastRequest!.method).toBe('POST');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(EKEY);
    expect(JSON.parse(await lastRequest!.text())).toEqual({ ids: [BILL] });

    stubFetch(409, {
      type: 'x', title: 'E-way bills cannot be exported', status: 409, code: 'eway-not-exportable', detail: 'Refused', instance: '/x',
      bills: [{ id: BILL, reasons: ['mixed-gstin'] }],
    });
    let caught: unknown;
    try {
      await fetchApiExportEwayBills(SESSION.tenant.id, [BILL], EKEY);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiProblem);
    expect((caught as ApiProblem).code).toBe('eway-not-exportable');
    expect((caught as ApiProblem).extensions).toEqual({ bills: [{ id: BILL, reasons: ['mixed-gstin'] }] });
  });

  test('a problem without extension members carries an empty extensions object', async () => {
    writeSession(SESSION);
    stubFetch(409, { type: 'x', title: 't', status: 409, code: 'eway-claimed', detail: 'd' });
    const caught = await fetchApiGenerateEwayBill(SESSION.tenant.id, BILL, EKEY).catch((error: unknown) => error);
    expect((caught as ApiProblem).extensions).toEqual({});
  });

  test('transport PATCHes the bill path; record, dismiss and generate POST theirs — each with the key and its body', async () => {
    writeSession(SESSION);
    stubFetch(200, { bill: { id: BILL } });
    await fetchApiUpdateEwayTransport(SESSION.tenant.id, BILL, { transMode: 1, vehicleNo: 'KA01AB1234', vehicleType: 'R' }, EKEY);
    expect([lastRequest!.method, new URL(lastRequest!.url).pathname]).toEqual(['PATCH', `${base()}/bills/${BILL}/transport`]);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(EKEY);
    expect(JSON.parse(await lastRequest!.text())).toEqual({ transMode: 1, vehicleNo: 'KA01AB1234', vehicleType: 'R' });

    await fetchApiRecordEwayBill(SESSION.tenant.id, BILL, { ewbNo: '141234567890', generatedAt: '2026-10-04T05:00:00.000Z' }, EKEY);
    expect([lastRequest!.method, new URL(lastRequest!.url).pathname]).toEqual(['POST', `${base()}/bills/${BILL}/record`]);
    expect(JSON.parse(await lastRequest!.text())).toEqual({ ewbNo: '141234567890', generatedAt: '2026-10-04T05:00:00.000Z' });
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(EKEY);

    await fetchApiDismissEwayBill(SESSION.tenant.id, BILL, 'Collected in person', EKEY);
    expect([lastRequest!.method, new URL(lastRequest!.url).pathname]).toEqual(['POST', `${base()}/bills/${BILL}/dismiss`]);
    expect(JSON.parse(await lastRequest!.text())).toEqual({ reason: 'Collected in person' });
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(EKEY);

    await fetchApiGenerateEwayBill(SESSION.tenant.id, BILL, EKEY);
    expect([lastRequest!.method, new URL(lastRequest!.url).pathname]).toEqual(['POST', `${base()}/bills/${BILL}/generate`]);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(EKEY);
  });

  test('state thresholds: GET the history with no key; POST appends with the key', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [] });
    await fetchApiListEwayStateThresholds(SESSION.tenant.id);
    expect([lastRequest!.method, new URL(lastRequest!.url).pathname, new URL(lastRequest!.url).search]).toEqual(['GET', `${base()}/state-thresholds`, '']);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
    stubFetch(201, { threshold: {} });
    const body = { stateCode: '27', thresholdPaise: null, effectiveFrom: '2026-04-01' };
    await fetchApiAppendEwayStateThreshold(SESSION.tenant.id, body, EKEY);
    expect([lastRequest!.method, new URL(lastRequest!.url).pathname]).toEqual(['POST', `${base()}/state-thresholds`]);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(EKEY);
    expect(JSON.parse(await lastRequest!.text())).toEqual(body);
  });

  test('GSTIN settings: GET the list; PUT one GSTIN with the flag and the key', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [] });
    await fetchApiListEwayGstinSettings(SESSION.tenant.id);
    expect([lastRequest!.method, new URL(lastRequest!.url).pathname]).toEqual(['GET', `${base()}/gstin-settings`]);
    stubFetch(200, { setting: {} });
    await fetchApiPutEwayGstinSetting(SESSION.tenant.id, '29AAAPZ1234C1ZV', true, EKEY);
    expect([lastRequest!.method, new URL(lastRequest!.url).pathname]).toEqual(['PUT', `${base()}/gstin-settings/29AAAPZ1234C1ZV`]);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(EKEY);
    expect(JSON.parse(await lastRequest!.text())).toEqual({ eInvoiceApplies: true });
  });
});

describe('reporting overview wrapper (story 9-1)', () => {
  const WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';

  test('the overview is a warehouse-scoped GET with no query and no Idempotency-Key', async () => {
    writeSession(SESSION);
    stubFetch(200, { asOf: '2026-10-06T10:00:00.000Z', stale: false, window: {}, tiles: {} });
    const overview = await fetchApiReportingOverview(SESSION.tenant.id, WAREHOUSE_ID);
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(
      `/api/v1/tenants/${SESSION.tenant.id}/warehouses/${WAREHOUSE_ID}/reporting/overview`,
    );
    expect(url.search).toBe('');
    expect(lastRequest!.method).toBe('GET');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
    expect(overview.asOf).toBe('2026-10-06T10:00:00.000Z');
    clearSession();
  });

  test('a refusal surfaces as an ApiProblem carrying its code', async () => {
    writeSession(SESSION);
    stubFetch(404, { type: 'about:blank', title: 'Not found', status: 404, code: 'not-found', detail: 'no warehouse' });
    await expect(fetchApiReportingOverview(SESSION.tenant.id, WAREHOUSE_ID)).rejects.toMatchObject({
      code: 'not-found',
      status: 404,
    });
    clearSession();
  });
});

describe('client admin + attribution wrappers (story 21-2b)', () => {
  const KEY = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
  const CLIENT = {
    id: '0198f7a2-1b3c-7d4e-8f90-000000000001',
    tenantId: SESSION.tenant.id,
    code: 'ACME',
    name: 'Acme Foods',
    status: 'active',
    systemOwned: false,
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
  };

  test('the client list is a GET with no query and no Idempotency-Key', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [CLIENT] });
    const list = await fetchApiListClients(SESSION.tenant.id);
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/clients`);
    expect(url.search).toBe('');
    expect(lastRequest!.method).toBe('GET');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
    expect(list.items[0]!.code).toBe('ACME');
    clearSession();
  });

  test('create POSTs the body with the key and unwraps the client', async () => {
    writeSession(SESSION);
    stubFetch(201, { client: CLIENT });
    const created = await fetchApiCreateClient(SESSION.tenant.id, { code: 'acme', name: 'Acme Foods' }, KEY);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/clients`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({ code: 'acme', name: 'Acme Foods' });
    expect(created.id).toBe(CLIENT.id);
    clearSession();
  });

  test('rename PATCHes the client path with only the name', async () => {
    writeSession(SESSION);
    stubFetch(200, { client: { ...CLIENT, name: 'Acme Foods Pvt Ltd' } });
    const renamed = await fetchApiRenameClient(SESSION.tenant.id, CLIENT.id, 'Acme Foods Pvt Ltd', KEY);
    expect(lastRequest!.method).toBe('PATCH');
    expect(new URL(lastRequest!.url).pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/clients/${CLIENT.id}`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({ name: 'Acme Foods Pvt Ltd' });
    expect(renamed.name).toBe('Acme Foods Pvt Ltd');
    clearSession();
  });

  test('a duplicate code surfaces as an ApiProblem carrying its code', async () => {
    writeSession(SESSION);
    stubFetch(409, { type: 'about:blank', title: 'dup', status: 409, code: 'duplicate-client-code', detail: 'taken' });
    await expect(fetchApiCreateClient(SESSION.tenant.id, { code: 'ACME', name: 'x' }, KEY)).rejects.toMatchObject({
      code: 'duplicate-client-code',
      status: 409,
    });
    clearSession();
  });

  test('the SKU client correction POSTs {clientId} to the SKU\'s client path', async () => {
    writeSession(SESSION);
    stubFetch(200, { id: 'sku-1', clientId: CLIENT.id });
    await fetchApiCorrectSkuClient(SESSION.tenant.id, 'sku-1', CLIENT.id, KEY);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/catalog/skus/sku-1/client`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({ clientId: CLIENT.id });
    clearSession();
  });

  test('the import carries clientId in the multipart form only when given', async () => {
    writeSession(SESSION);
    const file = new File(['sku_code,name,uom,gst_rate\n'], 'catalog.csv', { type: 'text/csv' });
    stubFetch(201, { importId: 'i', mode: 'initial', committedRows: 0, failedRows: 0, skippedRows: 0, errors: [] });
    await fetchApiImportCatalog(SESSION.tenant.id, file, undefined, KEY, CLIENT.id);
    const withClient = await lastRequest!.formData();
    expect(withClient.get('clientId')).toBe(CLIENT.id);
    expect(withClient.get('mode')).toBeNull();
    await fetchApiImportCatalog(SESSION.tenant.id, file, 'fix', KEY);
    const without = await lastRequest!.formData();
    expect(without.get('clientId')).toBeNull();
    expect(without.get('mode')).toBe('fix');
    clearSession();
  });
});

describe('rate-card wrappers (story 21-3)', () => {
  const KEY = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
  const CLIENT_ID = '0198f7a2-1b3c-7d4e-8f90-000000000001';
  const CARD_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000c1';
  const LINES = [
    { chargeCode: 'storage' as const, basis: 'per_thousand_units_per_day' as const, amountPaise: 330 },
    { chargeCode: 'pick' as const, basis: 'per_pick' as const, amountPaise: 300 },
  ];
  const CARD = {
    id: CARD_ID,
    tenantId: SESSION.tenant.id,
    clientId: CLIENT_ID,
    status: 'draft',
    effectiveFrom: null,
    effectiveTo: null,
    lines: LINES,
    createdBy: 'u-1',
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
    activatedBy: null,
    activatedAt: null,
    cancelledBy: null,
    cancelledAt: null,
  };
  const base = `/api/v1/tenants/${SESSION.tenant.id}`;

  test('the list is a GET under the client with no query and no key', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [CARD] });
    const list = await fetchApiListRateCards(SESSION.tenant.id, CLIENT_ID);
    expect(lastRequest!.method).toBe('GET');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/clients/${CLIENT_ID}/rate-cards`);
    expect(new URL(lastRequest!.url).search).toBe('');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
    expect(list.items[0]!.id).toBe(CARD_ID);
    clearSession();
  });

  test('the in-force read sends `at` only when given (the default is the SERVER clock)', async () => {
    writeSession(SESSION);
    stubFetch(200, { rateCard: null, asOf: '2026-10-20T04:30:00.000Z' });
    const now = await fetchApiRateCardInForce(SESSION.tenant.id, CLIENT_ID);
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/clients/${CLIENT_ID}/rate-cards/in-force`);
    expect(new URL(lastRequest!.url).search).toBe('');
    expect(now.rateCard).toBeNull();
    await fetchApiRateCardInForce(SESSION.tenant.id, CLIENT_ID, { at: '2026-10-31T18:30:00Z' });
    expect(new URL(lastRequest!.url).searchParams.get('at')).toBe('2026-10-31T18:30:00Z');
    clearSession();
  });

  test('the usage read (21-4) GETs the client path with from/to and no key', async () => {
    writeSession(SESSION);
    stubFetch(200, {
      clientId: CLIENT_ID,
      from: '2026-09-01',
      to: '2026-09-30',
      asOf: '2026-10-07T04:30:00.000Z',
      storageCompleteThrough: '2026-09-30',
      segments: [],
      totals: { billedPaise: 0, unbilledLines: 0 },
    });
    const usage = await fetchApiClientUsage(SESSION.tenant.id, CLIENT_ID, { from: '2026-09-01', to: '2026-09-30' });
    expect(lastRequest!.method).toBe('GET');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/clients/${CLIENT_ID}/usage`);
    expect(new URL(lastRequest!.url).searchParams.get('from')).toBe('2026-09-01');
    expect(new URL(lastRequest!.url).searchParams.get('to')).toBe('2026-09-30');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
    expect(usage.storageCompleteThrough).toBe('2026-09-30');
    clearSession();
  });

  test('create POSTs the lines with the key; replace PUTs them on the card', async () => {
    writeSession(SESSION);
    stubFetch(201, { rateCard: CARD });
    const created = await fetchApiCreateRateCard(SESSION.tenant.id, CLIENT_ID, LINES, KEY);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/clients/${CLIENT_ID}/rate-cards`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({ lines: LINES });
    expect(created.id).toBe(CARD_ID);

    stubFetch(200, { rateCard: CARD });
    await fetchApiReplaceRateCardLines(SESSION.tenant.id, CARD_ID, [], KEY);
    expect(lastRequest!.method).toBe('PUT');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/rate-cards/${CARD_ID}/lines`);
    expect(await lastRequest!.json()).toEqual({ lines: [] });
    clearSession();
  });

  test('activate POSTs the IST date; cancel POSTs with no body; both carry the key', async () => {
    writeSession(SESSION);
    stubFetch(200, { rateCard: { ...CARD, status: 'active', effectiveFrom: '2026-11-01' } });
    const active = await fetchApiActivateRateCard(SESSION.tenant.id, CARD_ID, '2026-11-01', KEY);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/rate-cards/${CARD_ID}/activate`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({ effectiveFrom: '2026-11-01' });
    expect(active.effectiveFrom).toBe('2026-11-01');

    stubFetch(200, { rateCard: { ...CARD, status: 'cancelled' } });
    const cancelled = await fetchApiCancelRateCard(SESSION.tenant.id, CARD_ID, KEY);
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/rate-cards/${CARD_ID}/cancel`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(cancelled.status).toBe('cancelled');
    clearSession();
  });

  test('discard DELETEs the card and treats the bodyless 204 as success; a refusal is an ApiProblem', async () => {
    writeSession(SESSION);
    stubGlobal('fetch', (async (input: RequestInfo | URL) => {
      lastRequest = input instanceof Request ? input : new Request(input.toString());
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch);
    await fetchApiDiscardRateCard(SESSION.tenant.id, CARD_ID, KEY);
    expect(lastRequest!.method).toBe('DELETE');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/rate-cards/${CARD_ID}`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);

    stubFetch(409, { type: 'about:blank', title: 'Not a draft', status: 409, code: 'rate-card-not-draft', detail: 'active' });
    await expect(fetchApiDiscardRateCard(SESSION.tenant.id, CARD_ID, KEY)).rejects.toMatchObject({
      code: 'rate-card-not-draft',
      status: 409,
    });
    clearSession();
  });
});

describe('client invoices and tax details (story 21-5)', () => {
  const KEY = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
  const CLIENT_ID = '0198f7a2-1b3c-7d4e-8f90-aaaaaaaaaaaa';
  const INVOICE_ID = '0198f7a2-1b3c-7d4e-8f90-bbbbbbbbbbbb';
  const INVOICE = { id: INVOICE_ID, status: 'draft', gaps: [], lines: [] };
  const base = `/api/v1/tenants/${SESSION.tenant.id}`;

  test('tax details PATCH the client path with exactly the body given and the key', async () => {
    writeSession(SESSION);
    stubFetch(200, { client: { id: CLIENT_ID, code: 'ACME' } });
    const saved = await fetchApiUpdateClientTaxDetails(SESSION.tenant.id, CLIENT_ID, { legalName: 'Acme Foods', billingLine2: null }, KEY);
    expect(lastRequest!.method).toBe('PATCH');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/clients/${CLIENT_ID}/tax-details`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({ legalName: 'Acme Foods', billingLine2: null });
    expect(saved.id).toBe(CLIENT_ID);
    clearSession();
  });

  test('prepare POSTs the month under the client with the key', async () => {
    writeSession(SESSION);
    stubFetch(201, { created: [INVOICE], existing: [] });
    const result = await fetchApiPrepareClientInvoices(SESSION.tenant.id, CLIENT_ID, '2026-09', KEY);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/clients/${CLIENT_ID}/invoices`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({ month: '2026-09' });
    expect(result.created).toHaveLength(1);
    clearSession();
  });

  test('the list sends no query on an unfiltered first page, and only the filters given', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListClientInvoices(SESSION.tenant.id);
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/client-invoices`);
    expect(new URL(lastRequest!.url).search).toBe('');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
    await fetchApiListClientInvoices(SESSION.tenant.id, { clientId: CLIENT_ID, cursor: 'abc', limit: 100 });
    const params = new URL(lastRequest!.url).searchParams;
    expect([params.get('clientId'), params.get('cursor'), params.get('limit'), params.get('status')]).toEqual([CLIENT_ID, 'abc', '100', null]);
    stubFetch(200, { invoice: INVOICE });
    await fetchApiGetClientInvoice(SESSION.tenant.id, INVOICE_ID);
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/client-invoices/${INVOICE_ID}`);
    clearSession();
  });

  test('21-5b: the line drill sends no query on a first page, then only the cursor and limit given; the breakdown sends date and warehouse', async () => {
    writeSession(SESSION);
    const LINE_ID = '01900000-0000-7000-8000-0000000000aa';
    stubFetch(200, { kind: 'pick', invoiceStatus: 'issued', summary: { lineQuantity: '1', recordsQuantity: '1', reconciles: true }, records: [], nextCursor: null });
    const first = await fetchApiClientInvoiceLineRecords(SESSION.tenant.id, INVOICE_ID, LINE_ID);
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/client-invoices/${INVOICE_ID}/lines/${LINE_ID}/records`);
    expect(new URL(lastRequest!.url).search).toBe('');
    expect(lastRequest!.method).toBe('GET');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
    expect(first.summary?.reconciles).toBe(true);
    await fetchApiClientInvoiceLineRecords(SESSION.tenant.id, INVOICE_ID, LINE_ID, { cursor: 'abc', limit: 1000 });
    const params = new URL(lastRequest!.url).searchParams;
    expect([params.get('cursor'), params.get('limit')]).toEqual(['abc', '1000']);
    stubFetch(200, { date: '2026-09-14', warehouseId: 'w', warehouseCode: 'WH1', uom: 'each', skus: [], total: '0', snapshotOnHand: null, reconciles: true });
    await fetchApiClientInvoiceStorageBreakdown(SESSION.tenant.id, INVOICE_ID, LINE_ID, '2026-09-14', 'w');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/client-invoices/${INVOICE_ID}/lines/${LINE_ID}/storage-breakdown`);
    const breakdown = new URL(lastRequest!.url).searchParams;
    expect([breakdown.get('date'), breakdown.get('warehouseId')]).toEqual(['2026-09-14', 'w']);
    stubFetch(404, { type: 'about:blank', title: 'Not found', status: 404, code: 'not-found', detail: 'gone' });
    await expect(fetchApiClientInvoiceLineRecords(SESSION.tenant.id, INVOICE_ID, LINE_ID)).rejects.toMatchObject({ code: 'not-found', status: 404 });
    clearSession();
  });

  test('refresh and issue POST the invoice verb with the key; issue returns the outcome', async () => {
    writeSession(SESSION);
    stubFetch(200, { invoice: INVOICE });
    await fetchApiRefreshClientInvoice(SESSION.tenant.id, INVOICE_ID, KEY);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/client-invoices/${INVOICE_ID}/refresh`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    stubFetch(200, { outcome: 'stale', invoice: INVOICE });
    const issued = await fetchApiIssueClientInvoice(SESSION.tenant.id, INVOICE_ID, KEY);
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/client-invoices/${INVOICE_ID}/issue`);
    expect(issued.outcome).toBe('stale');
    stubFetch(409, { type: 'about:blank', title: 'Gaps', status: 409, code: 'invoice-has-gaps', detail: 'x', gaps: [{ code: 'line-unpriced', detail: 'd' }] });
    await expect(fetchApiIssueClientInvoice(SESSION.tenant.id, INVOICE_ID, KEY)).rejects.toMatchObject({
      code: 'invoice-has-gaps',
      extensions: { gaps: [{ code: 'line-unpriced', detail: 'd' }] },
    });
    clearSession();
  });

  test('the transitions POST their own verb; the note is sent only when given', async () => {
    writeSession(SESSION);
    for (const verb of ['dispute', 'settle', 'void'] as const) {
      stubFetch(200, { invoice: { ...INVOICE, status: verb === 'dispute' ? 'disputed' : verb === 'settle' ? 'settled' : 'void' } });
      await fetchApiTransitionClientInvoice(SESSION.tenant.id, INVOICE_ID, verb, verb === 'settle' ? null : 'why', KEY);
      expect(new URL(lastRequest!.url).pathname).toBe(`${base}/client-invoices/${INVOICE_ID}/${verb}`);
      expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
      expect(await lastRequest!.json()).toEqual(verb === 'settle' ? {} : { note: 'why' });
    }
    stubGlobal('fetch', (async (input: RequestInfo | URL) => {
      lastRequest = input instanceof Request ? input : new Request(input.toString());
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch);
    await fetchApiDiscardClientInvoice(SESSION.tenant.id, INVOICE_ID, KEY);
    expect(lastRequest!.method).toBe('DELETE');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/client-invoices/${INVOICE_ID}`);
    clearSession();
  });
});

describe('advance shipment notice wrappers (story 21-6)', () => {
  const KEY = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
  const WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
  const CLIENT_ID = '0198f7a2-1b3c-7d4e-8f90-000000000001';
  const ASN_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000d1';
  const SKU_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000e1';
  const ASN = {
    id: ASN_ID,
    code: 'ASN-001',
    clientId: CLIENT_ID,
    status: 'announced',
    expectedAt: null,
    lineCount: 1,
    announcedTotal: 10,
    receivedTotal: 0,
    createdAt: '2026-10-08T00:00:00.000Z',
    warehouseId: WAREHOUSE_ID,
    statusNote: null,
    updatedAt: '2026-10-08T00:00:00.000Z',
    lines: [{ id: 'l-1', skuId: SKU_ID, announcedQty: 10, receivedQty: 0, openQty: 10 }],
  };
  const base = `/api/v1/tenants/${SESSION.tenant.id}`;

  test('the list GETs the warehouse path; the first page sends no query, filters ride as query params', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [ASN], nextCursor: null });
    await fetchApiListAsns(SESSION.tenant.id, WAREHOUSE_ID);
    expect(lastRequest!.method).toBe('GET');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/warehouses/${WAREHOUSE_ID}/inbound/asns`);
    expect(new URL(lastRequest!.url).search).toBe('');
    await fetchApiListAsns(SESSION.tenant.id, WAREHOUSE_ID, { status: 'partially_received', clientId: CLIENT_ID, cursor: 'c-2' });
    const params = new URL(lastRequest!.url).searchParams;
    expect(params.get('status')).toBe('partially_received');
    expect(params.get('clientId')).toBe(CLIENT_ID);
    expect(params.get('cursor')).toBe('c-2');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
    clearSession();
  });

  test('the detail GETs the tenant-level ASN path', async () => {
    writeSession(SESSION);
    stubFetch(200, { asn: ASN });
    const res = await fetchApiGetAsn(SESSION.tenant.id, ASN_ID);
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/inbound/asns/${ASN_ID}`);
    expect(res.asn.code).toBe('ASN-001');
    clearSession();
  });

  test('create POSTs the body with the Idempotency-Key', async () => {
    writeSession(SESSION);
    stubFetch(201, { asn: ASN });
    const body = { clientId: CLIENT_ID, warehouseId: WAREHOUSE_ID, asnCode: 'ASN-001', lines: [{ skuId: SKU_ID, announcedQty: 10 }] };
    await fetchApiCreateAsn(SESSION.tenant.id, body, KEY);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/inbound/asns`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual(body);
    clearSession();
  });

  test('amend PATCHes the full line set with the key', async () => {
    writeSession(SESSION);
    stubFetch(200, { asn: ASN });
    const body = { expectedAt: null, lines: [{ id: 'l-1', skuId: SKU_ID, announcedQty: 8 }] };
    await fetchApiAmendAsn(SESSION.tenant.id, ASN_ID, body, KEY);
    expect(lastRequest!.method).toBe('PATCH');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/inbound/asns/${ASN_ID}`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual(body);
    clearSession();
  });

  test('close and cancel POST the note to their own verb', async () => {
    writeSession(SESSION);
    stubFetch(200, { asn: { ...ASN, status: 'closed', statusNote: 'short' } });
    await fetchApiTransitionAsn(SESSION.tenant.id, ASN_ID, 'close', 'short', KEY);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/inbound/asns/${ASN_ID}/close`);
    expect(await lastRequest!.json()).toEqual({ note: 'short' });
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    await fetchApiTransitionAsn(SESSION.tenant.id, ASN_ID, 'cancel', 'withdrawn', KEY);
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/inbound/asns/${ASN_ID}/cancel`);
    expect(await lastRequest!.json()).toEqual({ note: 'withdrawn' });
    clearSession();
  });

  test('a refusal surfaces as an ApiProblem carrying the code', async () => {
    writeSession(SESSION);
    stubFetch(409, { type: 'about:blank', title: 'Over-receipts await a decision', status: 409, code: 'over-receipt-pending', detail: 'x' });
    const failure = await fetchApiTransitionAsn(SESSION.tenant.id, ASN_ID, 'close', 'short', KEY).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiProblem);
    expect((failure as ApiProblem).code).toBe('over-receipt-pending');
    clearSession();
  });
});

describe('refreshSessionUser — story 21-7 (the client dimension)', () => {
  const CLIENT_ID = '0198f7a2-1b3c-7d4e-8f90-cccccccccccc';
  const PORTAL_SESSION: StoredSession = {
    ...SESSION,
    user: { ...SESSION.user, role: 'client', clientId: CLIENT_ID },
    client: { id: CLIENT_ID, code: 'BRAND-A', name: 'Brand A' },
  };

  test('a changed clientId from /me is written back', async () => {
    writeSession(SESSION);
    stubFetch(200, { user: { ...SESSION.user, clientId: CLIENT_ID } });
    await refreshSessionUser();
    const stored = JSON.parse(store.get(SESSION_STORAGE_KEY)!) as { user: { clientId: string | null } };
    expect(stored.user.clientId).toBe(CLIENT_ID);
    clearSession();
  });

  test('a portal session re-reads portal/me, never the operator /me', async () => {
    writeSession(PORTAL_SESSION);
    stubFetch(200, {
      user: { id: SESSION.user.id, email: SESSION.user.email, role: 'client', status: 'active', clientId: CLIENT_ID },
      client: { id: CLIENT_ID, code: 'BRAND-A', name: 'Brand A Apparel' },
    });
    await refreshSessionUser();
    expect(new URL(lastRequest!.url).pathname).toEndWith(`/tenants/${SESSION.tenant.id}/portal/me`);
    const stored = JSON.parse(store.get(SESSION_STORAGE_KEY)!) as { client: { name: string } };
    expect(stored.client.name).toBe('Brand A Apparel');
    clearSession();
  });
});

/** The window stub above, but recording every dispatched event's type. */
function recordWindowEvents(): string[] {
  const types: string[] = [];
  stubGlobal('window', { dispatchEvent: (event: Event) => (types.push(event.type), true) });
  return types;
}

describe('portal wrappers (story 21-7)', () => {
  const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
  const ID = '0198f7a2-1b3c-7d4e-8f90-dddddddddddd';
  const EMPTY_PAGE = { items: [], nextCursor: null };

  test.each([
    ['stock', () => fetchApiPortalStock(T), `/tenants/${T}/portal/stock`],
    ['orders', () => fetchApiPortalOrders(T), `/tenants/${T}/portal/orders`],
    ['asns', () => fetchApiPortalAsns(T), `/tenants/${T}/portal/inbound/asns`],
    ['purchase orders', () => fetchApiPortalPurchaseOrders(T), `/tenants/${T}/portal/inbound/purchase-orders`],
    ['invoices', () => fetchApiPortalInvoices(T), `/tenants/${T}/portal/invoices`],
  ] as const)('%s: a first page sends no query at all', async (_name, call, path) => {
    stubFetch(200, EMPTY_PAGE);
    await call();
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toEndWith(path);
    expect(url.search).toBe('');
  });

  test('a later page carries the cursor; an orders status filter rides the query', async () => {
    stubFetch(200, EMPTY_PAGE);
    await fetchApiPortalOrders(T, { cursor: 'abc', status: 'dispatched' });
    const url = new URL(lastRequest!.url);
    expect(url.searchParams.get('cursor')).toBe('abc');
    expect(url.searchParams.get('status')).toBe('dispatched');
  });

  test.each([
    ['me', () => fetchApiPortalMe(T), `/tenants/${T}/portal/me`],
    ['order', () => fetchApiPortalOrder(T, ID), `/tenants/${T}/portal/orders/${ID}`],
    ['asn', () => fetchApiPortalAsn(T, ID), `/tenants/${T}/portal/inbound/asns/${ID}`],
    ['purchase order', () => fetchApiPortalPurchaseOrder(T, ID), `/tenants/${T}/portal/inbound/purchase-orders/${ID}`],
    ['invoice', () => fetchApiPortalInvoice(T, ID), `/tenants/${T}/portal/invoices/${ID}`],
  ] as const)('%s: GET on its own path', async (_name, call, path) => {
    stubFetch(200, {});
    await call();
    expect(lastRequest!.method).toBe('GET');
    expect(new URL(lastRequest!.url).pathname).toEndWith(path);
  });

  test('a client-suspended refusal is thrown as ApiProblem AND announced on window', async () => {
    const announced = recordWindowEvents();
    stubFetch(403, { code: 'client-suspended', status: 403, title: 'Client portal access is suspended' });
    try {
      await fetchApiPortalStock(T);
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiProblem);
      expect((error as ApiProblem).code).toBe('client-suspended');
    }
    expect(announced.filter((type) => type === PORTAL_SUSPENDED_EVENT)).toHaveLength(1);
  });

  test('any other refusal is not announced', async () => {
    const announced = recordWindowEvents();
    stubFetch(404, { code: 'not-found', status: 404 });
    await fetchApiPortalOrder(T, ID).catch(() => undefined);
    expect(announced.filter((type) => type === PORTAL_SUSPENDED_EVENT)).toHaveLength(0);
  });
});
