import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { restoreGlobals, stubGlobal } from '../test/globals';

import {
  ApiProblem,
  fetchApiAdjustStock,
  fetchApiListGoodsReceiptLines,
  fetchApiCorrectSkuClient,
  fetchApiCreateClient,
  fetchApiCreatePartner,
  fetchApiCreatePartnerLink,
  fetchApiListPartners,
  fetchApiUpdatePartner,
  fetchApiUpdatePartnerLink,
  fetchApiUpdatePartnerStatus,
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
  fetchApiCreatePurchaseOrder,
  fetchApiAmendGateIn,
  fetchApiCreateGateIn,
  fetchApiGateOutGateIn,
  fetchApiGetGateIn,
  fetchApiListGateIns,
  fetchApiUnloadGateIn,
  fetchApiCancelReturn,
  fetchApiDisposeReturn,
  fetchApiListAwaitingReturns,
  fetchApiPortalReturn,
  fetchApiPortalReturns,
  fetchApiCreateReturn,
  fetchApiGetReturn,
  fetchApiListReturns,
  fetchApiReturnable,
  fetchApiGetAsn,
  fetchApiListAsns,
  fetchApiTransitionAsn,
  fetchApiUpdateClientTaxDetails,
  fetchApiUpdateClientAddresses,
  fetchApiGetClientReceivingPolicy,
  fetchApiUpdateClientReceivingPolicy,
  fetchApiReleaseReceiptQcHolds,
  fetchApiListQcHolds,
  fetchApiListClientContacts,
  fetchApiListLicences,
  fetchApiLicenceCoverage,
  fetchApiAddLicence,
  fetchApiEditLicence,
  fetchApiWithdrawLicence,
  fetchApiAddClientContact,
  fetchApiEditClientContact,
  fetchApiRemoveClientContact,
  fetchApiUpdateClientStatus,
  fetchApiListRateCards,
  fetchApiRateCardInForce,
  fetchApiClientUsage,
  fetchApiClientServiceReport,
  fetchApiReportFile,
  fetchApiAuditTrail,
  fetchApiPortalService,
  fetchApiReplaceRateCardLines,
  fetchApiImportCatalog,
  fetchApiListReceiptPhotos,
  fetchApiAddReceiptPhoto,
  fetchApiRemoveReceiptPhoto,
  fetchApiPortalGoodsReceipts,
  fetchApiPortalGoodsReceipt,
  fetchApiImportAsns,
  fetchApiListClients,
  fetchApiRenameClient,
  fetchApiCancelOrder,
  fetchApiCancelWave,
  fetchApiCreateKit,
  fetchApiCreateOrder,
  fetchApiCreateProduct,
  fetchApiCreateSku,
  fetchApiReplacePackaging,
  fetchApiCreateWarehouse,
  fetchApiCreateWavePolicy,
  fetchApiApproveAdjustmentPending,
  fetchApiListAdjustmentPendings,
  fetchApiListLedgerEvents,
  fetchApiListBatches,
  fetchApiMoveStock,
  fetchApiListStock,
  fetchApiListPutawayTasks,
  fetchApiListVariances,
  fetchApiListCountTasks,
  fetchApiGetCountTask,
  fetchApiCreateCounts,
  fetchApiGetCountPolicies,
  fetchApiUpsertCountPolicies,
  fetchApiDeleteCountPolicy,
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
  fetchApiSecondFactor,
  fetchApiListWavePolicies,
  fetchApiListWaves,
  fetchApiPackOrder,
  fetchApiRegisterTenant,
  fetchApiReleaseWave,
  fetchApiReplaceKit,
  fetchApiReportingOverview,
  fetchApiListNotifications,
  fetchApiNotificationStatus,
  fetchApiMarkNotificationsOpened,
  fetchApiResolveExcursion,
  refreshSessionUser,
  fetchApiPortalAsn,
  fetchApiPortalAsns,
  fetchApiPortalInvoice,
  fetchApiPortalInvoices,
  fetchApiPortalMe,
  fetchApiPortalOrder,
  fetchApiPortalOrders,
  fetchApiPortalPlaceOrder,
  fetchApiPortalPurchaseOrder,
  fetchApiPortalPurchaseOrders,
  fetchApiPortalStock,
  fetchApiListPurchaseOrders,
  fetchApiListGoodsReceipts,
  fetchApiListOverReceipts,
  fetchApiListManifests,
  fetchApiListReorderPolicies,
  fetchApiListBreaches,
  fetchApiListSuggestedPos,
  fetchApiListBatchAlerts,
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

  test('story 6-1b — a 401 from the second sign-in step (a wrong code) never clears a session', async () => {
    writeSession(SESSION);
    stubFetch(401, { code: 'second-factor-invalid', title: 'Wrong code', status: 401, attemptsLeft: 4 });
    try {
      await fetchApiSecondFactor({ challengeToken: 'x.y', code: '000000' });
      expect.unreachable();
    } catch (error) {
      expect((error as ApiProblem).extensions.attemptsLeft).toBe(4);
    }
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

  test('story 4-1b: the search rides as reference, beside the client filter and the cursor', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListOrders(SESSION.tenant.id, WAREHOUSE_ID, { reference: 'SO-1042', clientId: 'c-1', cursor: 'p2' });
    const url = new URL(lastRequest!.url);
    expect(url.searchParams.get('reference')).toBe('SO-1042');
    expect(url.searchParams.get('clientId')).toBe('c-1');
    expect(url.searchParams.get('cursor')).toBe('p2');
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

  test('story 1-4: create SKU POSTs the typed body (levels + barcodes included) with its Idempotency-Key', async () => {
    writeSession(SESSION);
    stubFetch(201, { sku: { id: 'sku-new' } });
    const body = {
      code: 'TEA-1',
      name: 'Assam tea',
      uom: 'each',
      gstRate: 500,
      batchTracked: false,
      serialTracked: false,
      catchWeightTracked: false,
      shelfLifeDays: 365,
      clientId: PRODUCT_ID,
      levels: [{ uom: 'case', factor: 12 }],
      barcodes: [{ barcode: '8901234567890', uom: 'case' }],
    };
    const created = await fetchApiCreateSku(SESSION.tenant.id, body, KEY);
    expect(created.sku.id).toBe('sku-new');
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/catalog/skus`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual(body);
    clearSession();
  });

  test('story 1-4: replace packaging PUTs the levels and the non-primary barcodes', async () => {
    writeSession(SESSION);
    stubFetch(200, { sku: { id: 'sku-1' } });
    const body = { levels: [{ uom: 'case', factor: 12 }], barcodes: [{ barcode: '8901', uom: 'case' }] };
    await fetchApiReplacePackaging(SESSION.tenant.id, 'sku-1', body, KEY);
    expect(lastRequest!.method).toBe('PUT');
    expect(new URL(lastRequest!.url).pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/catalog/skus/sku-1/packaging`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual(body);
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
    const rules = [{ code: 'drug-chemical', description: 'A scheduled drug never shares a bin with a chemical.' }];
    stubFetch(200, { classes: ['explosive'], incompatible: [], rules });
    const matrix = await fetchApiGetSegregationMatrix(SESSION.tenant.id);
    expect(matrix).toEqual({ classes: ['explosive'], incompatible: [], rules });
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

describe('client master record wrappers (story 1-2a)', () => {
  const KEY = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
  const CLIENT_ID = '0198f7a2-1b3c-7d4e-8f90-000000000001';
  const CONTACT = { id: 'k-1', clientId: CLIENT_ID, name: 'Asha', email: 'asha@acme.example', phone: null, roles: [], isPrimary: true, createdAt: '', updatedAt: '' };
  const base = () => `/api/v1/tenants/${SESSION.tenant.id}/clients/${CLIENT_ID}`;

  test('contacts: GET (no key), POST, PATCH and DELETE on the contact paths, each write with its key', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [CONTACT] });
    const list = await fetchApiListClientContacts(SESSION.tenant.id, CLIENT_ID);
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/contacts`);
    expect(lastRequest!.method).toBe('GET');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
    expect(list[0]!.email).toBe('asha@acme.example');

    stubFetch(201, { contact: CONTACT });
    await fetchApiAddClientContact(SESSION.tenant.id, CLIENT_ID, { name: 'Asha', email: 'asha@acme.example', phone: null, roles: ['billing'] }, KEY);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/contacts`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({ name: 'Asha', email: 'asha@acme.example', phone: null, roles: ['billing'] });

    stubFetch(200, { contact: CONTACT });
    await fetchApiEditClientContact(SESSION.tenant.id, CLIENT_ID, 'k-1', { isPrimary: true }, KEY);
    expect(lastRequest!.method).toBe('PATCH');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/contacts/k-1`);
    expect(await lastRequest!.json()).toEqual({ isPrimary: true });

    stubFetch(200, { contact: CONTACT });
    const removed = await fetchApiRemoveClientContact(SESSION.tenant.id, CLIENT_ID, 'k-1', KEY);
    expect(lastRequest!.method).toBe('DELETE');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/contacts/k-1`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(removed.id).toBe('k-1');
    clearSession();
  });

  test('addresses PATCH sends only the given group; a blocker refusal keeps its extensions', async () => {
    writeSession(SESSION);
    stubFetch(200, { client: { id: CLIENT_ID } });
    await fetchApiUpdateClientAddresses(SESSION.tenant.id, CLIENT_ID, { return: null }, KEY);
    expect(lastRequest!.method).toBe('PATCH');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/addresses`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({ return: null });

    stubFetch(409, { type: 'about:blank', title: 'x', status: 409, code: 'client-not-wound-down', detail: 'y', blockers: [{ kind: 'stock', count: 1 }] });
    await expect(fetchApiUpdateClientStatus(SESSION.tenant.id, CLIENT_ID, 'departed', KEY)).rejects.toMatchObject({
      code: 'client-not-wound-down',
      extensions: { blockers: [{ kind: 'stock', count: 1 }] },
    });
    clearSession();
  });
});

describe('licence wrappers (story 1-6c)', () => {
  const KEY = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
  const LICENCE = {
    id: 'l-1', holder: 'site', clientId: null, warehouseId: 'w-1', kind: 'fssai-state', number: '10012345678901',
    validFrom: null, validUntil: '2027-03-31', note: null, status: 'active', createdAt: '', updatedAt: '',
  };
  const base = () => `/api/v1/tenants/${SESSION.tenant.id}/licences`;

  test('the reads: GET list and GET coverage, no key', async () => {
    writeSession(SESSION);
    stubFetch(200, { asOfDate: '2026-11-01', items: [] });
    const list = await fetchApiListLicences(SESSION.tenant.id);
    expect(lastRequest!.method).toBe('GET');
    expect(new URL(lastRequest!.url).pathname).toBe(base());
    expect(new URL(lastRequest!.url).search).toBe('');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
    expect(list.asOfDate).toBe('2026-11-01');

    stubFetch(200, { asOfDate: '2026-11-01', gaps: [] });
    await fetchApiLicenceCoverage(SESSION.tenant.id);
    expect(lastRequest!.method).toBe('GET');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/coverage`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
    clearSession();
  });

  test('the writes: POST add, PATCH edit and POST withdraw, each with its key and body', async () => {
    writeSession(SESSION);
    stubFetch(201, { licence: LICENCE });
    await fetchApiAddLicence(SESSION.tenant.id, { warehouseId: 'w-1', kind: 'fssai-state', number: '10012345678901', validUntil: '2027-03-31' }, KEY);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(base());
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({ warehouseId: 'w-1', kind: 'fssai-state', number: '10012345678901', validUntil: '2027-03-31' });

    stubFetch(200, { licence: LICENCE });
    await fetchApiEditLicence(SESSION.tenant.id, 'l-1', { validFrom: null, note: 'renewed' }, KEY);
    expect(lastRequest!.method).toBe('PATCH');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/l-1`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({ validFrom: null, note: 'renewed' });

    stubFetch(200, { licence: { ...LICENCE, status: 'withdrawn' } });
    const withdrawn = await fetchApiWithdrawLicence(SESSION.tenant.id, 'l-1', KEY);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/l-1/withdraw`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(withdrawn.status).toBe('withdrawn');
    clearSession();
  });
});

describe('receiving policy and receipt-hold wrappers (story 1-2b)', () => {
  const KEY = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
  const CLIENT_ID = '0198f7a2-1b3c-7d4e-8f90-000000000001';
  const GRN_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000b7';
  const POLICY = { receivingToleranceBps: 250, qcOnReceipt: true, expiryRequired: true, minShelfLifeDays: 90 };

  test('the policy read: GET on the receiving-policy path, no key; answers the policy and the untracked count', async () => {
    writeSession(SESSION);
    stubFetch(200, { clientId: CLIENT_ID, ...POLICY, untrackedSkuCount: 4 });
    const read = await fetchApiGetClientReceivingPolicy(SESSION.tenant.id, CLIENT_ID);
    expect(lastRequest!.method).toBe('GET');
    expect(new URL(lastRequest!.url).pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/clients/${CLIENT_ID}/receiving-policy`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
    expect(read.untrackedSkuCount).toBe(4);
    clearSession();
  });

  test('the policy write: PUT, all four fields (a null minimum sent as null), with its key; answers the client', async () => {
    writeSession(SESSION);
    stubFetch(200, { client: { id: CLIENT_ID, receivingPolicy: POLICY } });
    const body = { receivingToleranceBps: 500, qcOnReceipt: false, expiryRequired: false, minShelfLifeDays: null };
    const client = await fetchApiUpdateClientReceivingPolicy(SESSION.tenant.id, CLIENT_ID, body, KEY);
    expect(lastRequest!.method).toBe('PUT');
    expect(new URL(lastRequest!.url).pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/clients/${CLIENT_ID}/receiving-policy`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual(body);
    expect(client.receivingPolicy).toEqual(POLICY);

    stubFetch(400, { title: 'Invalid receiving policy', status: 400, code: 'validation-failed', detail: 'minShelfLifeDays needs expiryRequired' });
    await expect(fetchApiUpdateClientReceivingPolicy(SESSION.tenant.id, CLIENT_ID, body, KEY)).rejects.toMatchObject({
      code: 'validation-failed',
      status: 400,
    });
    clearSession();
  });

  test('release-receipt: POST {grnId} with its key; a receipt with no open hold is 409 qc-hold-released', async () => {
    writeSession(SESSION);
    stubFetch(200, { grnId: GRN_ID, grnCode: 'GRN-0042', qcHolds: [] });
    const released = await fetchApiReleaseReceiptQcHolds(SESSION.tenant.id, GRN_ID, KEY);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/receiving/qc-holds/release-receipt`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({ grnId: GRN_ID });
    expect(released.grnCode).toBe('GRN-0042');

    stubFetch(409, { title: 'x', status: 409, code: 'qc-hold-released', detail: 'y' });
    await expect(fetchApiReleaseReceiptQcHolds(SESSION.tenant.id, GRN_ID, KEY)).rejects.toMatchObject({ code: 'qc-hold-released' });
    clearSession();
  });

  test('the holds list takes a grnId filter beside status', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListQcHolds(SESSION.tenant.id, { status: 'open', grnId: GRN_ID });
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/receiving/qc-holds`);
    expect(url.searchParams.get('grnId')).toBe(GRN_ID);
    expect(url.searchParams.get('status')).toBe('open');
    expect(url.searchParams.get('warehouseId')).toBeNull();
    clearSession();
  });
});

describe('fetchApiImportAsns (the ASN import, 2026-10-17)', () => {
  const KEY = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
  const WAREHOUSE = '0198f7a2-1b3c-7d4e-8f90-0000000000aa';
  const RESULT = {
    importId: null,
    dryRun: true,
    warehouseId: WAREHOUSE,
    fileSha256: 'ab'.repeat(32),
    rowCount: 1,
    asnCount: 1,
    acceptedCount: 1,
    refusedCount: 0,
    asns: [],
    errors: [],
  };

  test('Check file posts the multipart form with dryRun=true and NO Idempotency-Key; Import sends the key and no dryRun', async () => {
    writeSession(SESSION);
    const file = new File(['asn_code,sku,quantity\nA,S,1\n'], 'asns.csv', { type: 'text/csv' });
    stubFetch(200, RESULT);
    await fetchApiImportAsns(SESSION.tenant.id, file, WAREHOUSE, { dryRun: true });
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/inbound/asn-imports`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
    const checked = await lastRequest!.formData();
    expect(checked.get('warehouseId')).toBe(WAREHOUSE);
    expect(checked.get('dryRun')).toBe('true');
    expect((checked.get('file') as File).name).toBe('asns.csv');

    stubFetch(201, { ...RESULT, dryRun: false, importId: 'i-1' });
    const imported = await fetchApiImportAsns(SESSION.tenant.id, file, WAREHOUSE, { dryRun: false, idempotencyKey: KEY });
    expect(imported.importId).toBe('i-1');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    const form = await lastRequest!.formData();
    expect(form.get('dryRun')).toBeNull();
    expect(form.get('warehouseId')).toBe(WAREHOUSE);
    clearSession();
  });

  test('a file-level refusal surfaces as an ApiProblem with its code', async () => {
    writeSession(SESSION);
    const file = new File(['x'], 'asns.pdf', { type: 'application/pdf' });
    stubFetch(415, { type: 'about:blank', title: 'Unsupported import file type', status: 415, code: 'unsupported-file-type', detail: 'Only .csv and .xlsx files can be imported (got "asns.pdf").' });
    await expect(fetchApiImportAsns(SESSION.tenant.id, file, WAREHOUSE, { dryRun: true })).rejects.toMatchObject({ code: 'unsupported-file-type', status: 415 });
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

  test('the audit trail (9-3a): a GET to reporting/audit with no query on an unfiltered first page; filters and the cursor only when given; no key', async () => {
    writeSession(SESSION);
    const SYSTEM = '01900000-0000-7000-8000-000000000000';
    stubFetch(200, { items: [], nextCursor: null, systemActorId: SYSTEM });
    const page = await fetchApiAuditTrail(SESSION.tenant.id, {});
    expect(lastRequest!.method).toBe('GET');
    expect(new URL(lastRequest!.url).pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/reporting/audit`);
    expect(new URL(lastRequest!.url).search).toBe('');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
    expect(page.systemActorId).toBe(SYSTEM);

    await fetchApiAuditTrail(
      SESSION.tenant.id,
      { actionPrefix: 'transfer.', targetType: 'transfer_order', from: '2026-10-12T00:00:00+05:30', to: '2026-10-13T00:00:00+05:30' },
      { cursor: 'CURSOR-2' },
    );
    expect(Object.fromEntries(new URL(lastRequest!.url).searchParams)).toEqual({
      actionPrefix: 'transfer.',
      targetType: 'transfer_order',
      from: '2026-10-12T00:00:00+05:30',
      to: '2026-10-13T00:00:00+05:30',
      cursor: 'CURSOR-2',
    });
    clearSession();
  });

  test('the register file (5-3a): GET …/warehouses/{w}/reports/{report} with only the set filters, no key, read as a Blob; a refusal is an ApiProblem', async () => {
    writeSession(SESSION);
    const WH = '0198f7a2-1b3c-7d4e-8f90-0000000000aa';
    const CLIENT = '0198f7a2-1b3c-7d4e-8f90-cccccccccc0a';
    stubGlobal('fetch', (async (input: RequestInfo | URL) => {
      lastRequest = input instanceof Request ? input : new Request(input.toString());
      return new Response('\uFEFFwarehouse,zone\r\n', { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8' } });
    }) as unknown as typeof fetch);
    const blob = await fetchApiReportFile(SESSION.tenant.id, WH, 'stock-on-hand', { format: 'csv', clientId: null, period: null });
    expect(lastRequest!.method).toBe('GET');
    expect(new URL(lastRequest!.url).pathname).toBe(`/api/v1/tenants/${SESSION.tenant.id}/warehouses/${WH}/reports/stock-on-hand`);
    expect([...new URL(lastRequest!.url).searchParams.entries()]).toEqual([['format', 'csv']]);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
    expect(blob).toBeInstanceOf(Blob);
    expect(await blob.text()).toBe('\uFEFFwarehouse,zone\r\n');

    await fetchApiReportFile(SESSION.tenant.id, WH, 'ledger', { format: 'xlsx', clientId: CLIENT, period: { from: '2026-09-01', to: '2026-09-30' } });
    expect(Object.fromEntries(new URL(lastRequest!.url).searchParams)).toEqual({ format: 'xlsx', clientId: CLIENT, from: '2026-09-01', to: '2026-09-30' });

    stubFetch(422, { code: 'report-too-large', status: 422, title: 'Register too large', detail: 'More than 50,000 rows.' });
    const refused = await fetchApiReportFile(SESSION.tenant.id, WH, 'ledger', { format: 'csv', clientId: null, period: { from: '2026-09-01', to: '2026-09-30' } }).catch(
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(ApiProblem);
    expect((refused as ApiProblem).code).toBe('report-too-large');
    clearSession();
  });

  test('the service report (21-8): the operator GET carries from/to, the warehouse only when chosen, no key; the portal GET never a clientId', async () => {
    writeSession(SESSION);
    const REPORT = {
      from: '2026-09-01',
      to: '2026-09-30',
      warehouseId: null,
      asOf: '2026-10-07T04:30:00.000Z',
      targetHours: 24,
      dockToStock: { medianMinutes: null, placements: 0 },
      pickAccuracy: { accuracy: null, linesDispatched: 0, linesShortPicked: 0, packFailures: 0, packFailuresCountingSince: null },
      dispatchTimeliness: { ordersDispatched: 0, onTime: 0, onTimeRate: null, medianMinutes: null, lateNotDispatched: 0 },
    };
    stubFetch(200, REPORT);
    const report = await fetchApiClientServiceReport(SESSION.tenant.id, CLIENT_ID, { from: '2026-09-01', to: '2026-09-30', warehouseId: null });
    expect(lastRequest!.method).toBe('GET');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/reporting/clients/${CLIENT_ID}/service`);
    expect([...new URL(lastRequest!.url).searchParams.keys()].sort()).toEqual(['from', 'to']);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
    expect(report.targetHours).toBe(24);

    const WH = '0198f7a2-1b3c-7d4e-8f90-0000000000aa';
    await fetchApiClientServiceReport(SESSION.tenant.id, CLIENT_ID, { from: '2026-09-01', to: '2026-09-30', warehouseId: WH });
    expect(new URL(lastRequest!.url).searchParams.get('warehouseId')).toBe(WH);

    await fetchApiPortalService(SESSION.tenant.id, { from: '2026-09-01', to: '2026-09-30', warehouseId: WH });
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/portal/service`);
    expect([...new URL(lastRequest!.url).searchParams.keys()].sort()).toEqual(['from', 'to', 'warehouseId']);
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

  // Story 2-1 — the PO create: the existing CreatePurchaseOrderDto as is
  // (no clientId — the server derives it from the SKUs), the per-draft key.
  test('PO create POSTs the CreatePurchaseOrderDto body with the Idempotency-Key — no clientId', async () => {
    writeSession(SESSION);
    stubFetch(201, { purchaseOrder: { id: 'po-1', code: 'PO-1001', lines: [] } });
    const body = {
      warehouseId: WAREHOUSE_ID,
      vendorId: 'v-1',
      code: 'PO-1001',
      lines: [{ skuId: SKU_ID, orderedQty: 10, unitCostPaise: 1250, expectedDate: '2026-10-24T18:30:00.000Z' }],
    };
    const res = await fetchApiCreatePurchaseOrder(SESSION.tenant.id, body, KEY);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/inbound/purchase-orders`);
    expect(new URL(lastRequest!.url).search).toBe('');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    const sent = (await lastRequest!.json()) as Record<string, unknown>;
    expect(sent).toEqual(body);
    expect('clientId' in sent).toBe(false);
    expect(res.purchaseOrder.code).toBe('PO-1001');
    clearSession();
  });

  test('the SKU list sends limit only when set (story 2-1: the PO form reads 200 a page)', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListSkus(SESSION.tenant.id, { clientId: CLIENT_ID, status: 'active', limit: 200 });
    const params = new URL(lastRequest!.url).searchParams;
    expect(params.get('limit')).toBe('200');
    expect(params.get('clientId')).toBe(CLIENT_ID);
    expect(params.get('status')).toBe('active');
    await fetchApiListSkus(SESSION.tenant.id, { clientId: CLIENT_ID });
    expect(new URL(lastRequest!.url).searchParams.has('limit')).toBe(false);
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

  test('story 4-1b: the orders search rides as reference — alone, or beside the cursor', async () => {
    stubFetch(200, EMPTY_PAGE);
    await fetchApiPortalOrders(T, { reference: 'SO-7' });
    expect(new URL(lastRequest!.url).search).toBe('?reference=SO-7');
    await fetchApiPortalOrders(T, { reference: 'SO-7', cursor: 'abc' });
    const url = new URL(lastRequest!.url);
    expect(url.searchParams.get('reference')).toBe('SO-7');
    expect(url.searchParams.get('cursor')).toBe('abc');
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

  test('story 4-1a — place an order: POST portal/orders with the key and the body as given (no clientId, no rate)', async () => {
    const KEY = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const body = {
      warehouseId: ID,
      lines: [{ skuId: ID, quantity: 2.5 }],
      destination: { contactName: 'Asha', phone: '+91 90000 00000', line1: '1 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
    };
    stubFetch(201, { orderId: ID, warehouseName: 'Main', lineCount: 1, placedAt: '2026-10-22T05:00:00.000Z' });
    const placed = await fetchApiPortalPlaceOrder(T, body, KEY);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toEndWith(`/tenants/${T}/portal/orders`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual(body);
    expect(placed).toEqual({ orderId: ID, warehouseName: 'Main', lineCount: 1, placedAt: '2026-10-22T05:00:00.000Z' });
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

describe('story 9-1b — the drill filters on the list wrappers', () => {
  const T9 = '0198f7a2-1b3c-7d4e-8f90-112233445566';
  const W9 = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';

  afterEach(() => {
    restoreGlobals();
  });

  test('the putaway task list: the warehouse rides the query, nothing else', async () => {
    stubFetch(200, { items: [] });
    await fetchApiListPutawayTasks(T9, W9);
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(`/api/v1/tenants/${T9}/putaway/tasks`);
    expect([...url.searchParams.entries()]).toEqual([['warehouseId', W9]]);
  });

  test('a first page with no options still sends no query', async () => {
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListOrders(T9, W9);
    expect(new URL(lastRequest!.url).search).toBe('');
    await fetchApiListInvoices(T9);
    expect(new URL(lastRequest!.url).search).toBe('');
    await fetchApiListLedgerEvents(T9, W9);
    expect(new URL(lastRequest!.url).search).toBe('');
  });

  test('booleans serialise as true/false and a one-element type as one `type`', async () => {
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListOrders(T9, W9, { source: 'ingested', backordered: true });
    expect(new URL(lastRequest!.url).searchParams.get('backordered')).toBe('true');
    await fetchApiListLedgerEvents(T9, W9, { type: ['pick.picked'], shortPick: false });
    const url = new URL(lastRequest!.url);
    expect(url.searchParams.getAll('type')).toEqual(['pick.picked']);
    expect(url.searchParams.get('shortPick')).toBe('false');
  });
});

describe('notification wrappers (story 9-2)', () => {
  const base = (): string => `/api/v1/tenants/${SESSION.tenant.id}/notifications`;

  afterEach(() => clearSession());

  test('the list sends no query on a first page, then exactly the cursor and limit given — no key', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListNotifications(SESSION.tenant.id);
    expect(new URL(lastRequest!.url).pathname).toBe(base());
    expect(new URL(lastRequest!.url).search).toBe('');
    await fetchApiListNotifications(SESSION.tenant.id, { limit: 10 });
    expect(Object.fromEntries(new URL(lastRequest!.url).searchParams)).toEqual({ limit: '10' });
    await fetchApiListNotifications(SESSION.tenant.id, { cursor: 'c-2', limit: 10 });
    expect(Object.fromEntries(new URL(lastRequest!.url).searchParams)).toEqual({ cursor: 'c-2', limit: '10' });
    expect(lastRequest!.method).toBe('GET');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
  });

  test('status is a plain GET; opened is a POST with NO Idempotency-Key and no body (the documented exception)', async () => {
    writeSession(SESSION);
    stubFetch(200, { hasNew: true });
    expect(await fetchApiNotificationStatus(SESSION.tenant.id)).toEqual({ hasNew: true });
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/status`);
    expect(lastRequest!.method).toBe('GET');

    stubFetch(200, { hasNew: false });
    expect(await fetchApiMarkNotificationsOpened(SESSION.tenant.id)).toEqual({ hasNew: false });
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/opened`);
    expect(lastRequest!.method).toBe('POST');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
    expect(await lastRequest!.text()).toBe('');
  });

  test('a refusal surfaces as an ApiProblem carrying its code', async () => {
    writeSession(SESSION);
    stubFetch(400, { type: 'x', title: 'Malformed pagination cursor', status: 400, code: 'invalid-cursor', detail: 'bad' });
    await expect(fetchApiListNotifications(SESSION.tenant.id, { cursor: 'bad' })).rejects.toMatchObject({ code: 'invalid-cursor', status: 400 });
  });
});

describe('return authorization wrappers (story 13-1)', () => {
  const KEY = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
  const WAREHOUSE_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
  const ORDER_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000b1';
  const RMA_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000c1';
  const LINE_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000c2';
  const RMA = {
    id: RMA_ID,
    code: 'RMA-0001',
    status: 'open',
    orderId: ORDER_ID,
    orderReference: null,
    warehouseId: WAREHOUSE_ID,
    clientId: WAREHOUSE_ID,
    externalReference: null,
    orderDispatchedAt: '2026-10-15T00:00:00.000Z',
    createdAt: '2026-10-16T00:00:00.000Z',
    createdBy: 'u-1',
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    lines: [],
  };
  const base = `/api/v1/tenants/${SESSION.tenant.id}`;

  test('the returnable read GETs the literal path with the orderId query', async () => {
    writeSession(SESSION);
    stubFetch(200, { orderId: ORDER_ID, status: 'dispatched', warehouseId: WAREHOUSE_ID, orderReference: null, dispatchedAt: null, lines: [] });
    await fetchApiReturnable(SESSION.tenant.id, ORDER_ID);
    expect(lastRequest!.method).toBe('GET');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/returns/returnable`);
    expect(new URL(lastRequest!.url).searchParams.get('orderId')).toBe(ORDER_ID);
    clearSession();
  });

  test('the list GETs the tenant path; the first page sends no query, filters ride as query params', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [RMA], nextCursor: null });
    await fetchApiListReturns(SESSION.tenant.id);
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/returns`);
    expect(new URL(lastRequest!.url).search).toBe('');
    await fetchApiListReturns(SESSION.tenant.id, { warehouseId: WAREHOUSE_ID, status: 'open', cursor: 'c-2' });
    const params = new URL(lastRequest!.url).searchParams;
    expect(params.get('warehouseId')).toBe(WAREHOUSE_ID);
    expect(params.get('status')).toBe('open');
    expect(params.get('cursor')).toBe('c-2');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
    clearSession();
  });

  test('the detail GETs the RMA path', async () => {
    writeSession(SESSION);
    stubFetch(200, RMA);
    const res = await fetchApiGetReturn(SESSION.tenant.id, RMA_ID);
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/returns/${RMA_ID}`);
    expect(res.code).toBe('RMA-0001');
    clearSession();
  });

  test('create POSTs the body with the Idempotency-Key', async () => {
    writeSession(SESSION);
    stubFetch(201, RMA);
    const body = { orderId: ORDER_ID, lines: [{ orderLineId: LINE_ID, qty: 2, reasonCode: 'damaged' as const }] };
    await fetchApiCreateReturn(SESSION.tenant.id, body, KEY);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/returns`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual(body);
    clearSession();
  });

  test('cancel POSTs the reason to the cancel verb with the key; a 409 carries its extension members', async () => {
    writeSession(SESSION);
    stubFetch(200, { ...RMA, status: 'cancelled' });
    await fetchApiCancelReturn(SESSION.tenant.id, RMA_ID, 'kept it', KEY);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/returns/${RMA_ID}/cancel`);
    expect(await lastRequest!.json()).toEqual({ reason: 'kept it' });
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    stubFetch(409, { type: 'x', title: 'More than can be returned', status: 409, code: 'exceeds-returnable', detail: 'd', orderLineId: LINE_ID, returnableQty: 1 });
    await expect(fetchApiCreateReturn(SESSION.tenant.id, { orderId: ORDER_ID, lines: [] }, KEY)).rejects.toMatchObject({
      code: 'exceeds-returnable',
      extensions: { orderLineId: LINE_ID, returnableQty: 1 },
    });
    clearSession();
  });
});

describe('inventory-screen — the stock and batch list wrappers', () => {
  const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
  const W = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';
  const SKU = '0198f7a2-1b3c-7d4e-8f90-aabbccddeeff';

  afterEach(() => {
    restoreGlobals();
  });

  test('the stock list: a first page with no options sends no query (the QC-hold caller is unchanged)', async () => {
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListStock(T, W);
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(`/api/v1/tenants/${T}/warehouses/${W}/inventory/stock`);
    expect(url.search).toBe('');
  });

  test('the stock list sends limit, order=location and nonZero=true, plus the SKU and cursor given', async () => {
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListStock(T, W, { limit: 200, order: 'location', nonZero: true });
    expect(Object.fromEntries(new URL(lastRequest!.url).searchParams)).toEqual({
      limit: '200',
      order: 'location',
      nonZero: 'true',
    });
    await fetchApiListStock(T, W, { skuId: SKU, cursor: 'c-2', limit: 200, order: 'location', nonZero: true });
    expect(Object.fromEntries(new URL(lastRequest!.url).searchParams)).toEqual({
      skuId: SKU,
      cursor: 'c-2',
      limit: '200',
      order: 'location',
      nonZero: 'true',
    });
    expect(lastRequest!.method).toBe('GET');
  });

  test('the batch list is warehouse-scoped and sends exactly the SKU', async () => {
    stubFetch(200, { items: [] });
    await fetchApiListBatches(T, W, SKU);
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(`/api/v1/tenants/${T}/warehouses/${W}/inventory/batches`);
    expect([...url.searchParams.entries()]).toEqual([['skuId', SKU]]);
    expect(lastRequest!.method).toBe('GET');
  });

  test('a refusal keeps its machine-readable code', async () => {
    stubFetch(400, { code: 'invalid-cursor', title: 'Malformed pagination cursor', status: 400, detail: 'd' });
    await expect(fetchApiListStock(T, W, { cursor: 'x', order: 'location' })).rejects.toMatchObject({ code: 'invalid-cursor' });
  });

  test('story 3-1 — the batch list narrows to one bin when binId is given (and only then)', async () => {
    stubFetch(200, { items: [] });
    await fetchApiListBatches(T, W, SKU, { binId: 'bin-1' });
    const url = new URL(lastRequest!.url);
    expect([...url.searchParams.entries()]).toEqual([
      ['skuId', SKU],
      ['binId', 'bin-1'],
    ]);
  });

  test('story 3-1 — a move POSTs the body verbatim to the warehouse moves route under the Idempotency-Key', async () => {
    stubFetch(201, { moveId: 'mv-1', events: [] });
    const body = {
      skuId: SKU,
      fromBinId: 'bin-a',
      toBinId: 'bin-b',
      qty: 20,
      batchCode: null,
      serials: null,
      reasonCode: 'consolidate' as const,
      note: null,
    };
    const result = await fetchApiMoveStock(T, W, body, '01JZ3K8Q4M7N2P5R9S6T1V0MVE');
    expect(result).toEqual({ moveId: 'mv-1', events: [] });
    expect(new URL(lastRequest!.url).pathname).toBe(`/api/v1/tenants/${T}/warehouses/${W}/inventory/moves`);
    expect(lastRequest!.method).toBe('POST');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe('01JZ3K8Q4M7N2P5R9S6T1V0MVE');
    expect(JSON.parse(await lastRequest!.text())).toEqual(body);
  });
});

describe('business partner wrappers (story 1-3)', () => {
  const PKEY = '01JZ3K8Q4M7N2P5R9S6T1V0W3X';
  const PARTNER = { id: 'p-1', code: 'V-1', name: 'Prime', links: [] };
  const base = () => `/api/v1/tenants/${SESSION.tenant.id}/partners`;

  test('list sends only the filters given, and none on a bare first page', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListPartners(SESSION.tenant.id);
    expect(new URL(lastRequest!.url).pathname).toBe(base());
    expect(new URL(lastRequest!.url).search).toBe('');
    await fetchApiListPartners(SESSION.tenant.id, { role: 'vendor', clientId: 'c-1', status: 'active', q: 'pri', cursor: 'cur', limit: 10 });
    const params = new URL(lastRequest!.url).searchParams;
    expect(Object.fromEntries(params.entries())).toEqual({ role: 'vendor', clientId: 'c-1', status: 'active', q: 'pri', cursor: 'cur', limit: '10' });
    clearSession();
  });

  test('create, update and status carry the key and unwrap the partner', async () => {
    writeSession(SESSION);
    stubFetch(201, { partner: PARTNER });
    expect((await fetchApiCreatePartner(SESSION.tenant.id, { code: 'V-1', name: 'Prime', roles: ['vendor'] }, PKEY)).id).toBe('p-1');
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(base());
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(PKEY);
    expect(await lastRequest!.json()).toEqual({ code: 'V-1', name: 'Prime', roles: ['vendor'] });

    stubFetch(200, { partner: PARTNER });
    await fetchApiUpdatePartner(SESSION.tenant.id, 'p-1', { gstin: null }, PKEY);
    expect(lastRequest!.method).toBe('PATCH');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/p-1`);
    // null clears (tri-state) — it reaches the wire as null, not dropped.
    expect(await lastRequest!.json()).toEqual({ gstin: null });

    stubFetch(200, { partner: PARTNER });
    await fetchApiUpdatePartnerStatus(SESSION.tenant.id, 'p-1', { status: 'inactive', reason: 'stopped' }, PKEY);
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/p-1/status`);
    expect(await lastRequest!.json()).toEqual({ status: 'inactive', reason: 'stopped' });
    clearSession();
  });

  test('link create and update hit the link paths with the key', async () => {
    writeSession(SESSION);
    stubFetch(201, { partner: PARTNER });
    await fetchApiCreatePartnerLink(SESSION.tenant.id, 'p-1', { clientId: 'c-1', role: 'vendor', isDefault: true }, PKEY);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/p-1/links`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(PKEY);
    expect(await lastRequest!.json()).toEqual({ clientId: 'c-1', role: 'vendor', isDefault: true });
    stubFetch(200, { partner: PARTNER });
    await fetchApiUpdatePartnerLink(SESSION.tenant.id, 'p-1', 'l-1', { active: false }, PKEY);
    expect(lastRequest!.method).toBe('PATCH');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/p-1/links/l-1`);
    expect(await lastRequest!.json()).toEqual({ active: false });
    clearSession();
  });

  test('a refusal keeps its code', async () => {
    writeSession(SESSION);
    stubFetch(409, { code: 'partner-gstin-taken', title: 't', status: 409, detail: 'GSTIN 27… already belongs to partner "V-9"' });
    await expect(fetchApiCreatePartner(SESSION.tenant.id, { code: 'V-1', name: 'P', roles: ['vendor'] }, PKEY)).rejects.toMatchObject({ code: 'partner-gstin-taken', status: 409 });
    clearSession();
  });
});

describe('client filter on the list wrappers (story 1-5a)', () => {
  const T = SESSION.tenant.id;
  const W = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
  const C = '0198f7a2-1b3c-7d4e-8f90-0000000000c2';
  const base = `/api/v1/tenants/${T}`;
  /** Each wrapper, its path, and a call that takes the optional `clientId`. */
  const CASES: readonly [string, string, (clientId?: string) => Promise<unknown>][] = [
    ['SKUs', `${base}/catalog/skus`, (clientId) => fetchApiListSkus(T, { clientId })],
    ['products', `${base}/catalog/products`, (clientId) => fetchApiListProducts(T, { clientId })],
    ['kits', `${base}/catalog/kits`, (clientId) => fetchApiListKits(T, { clientId })],
    ['POs', `${base}/warehouses/${W}/inbound/purchase-orders`, (clientId) => fetchApiListPurchaseOrders(T, W, { clientId })],
    ['GRNs', `${base}/receiving/goods-receipts`, (clientId) => fetchApiListGoodsReceipts(T, { clientId })],
    ['over-receipts', `${base}/receiving/over-receipts`, (clientId) => fetchApiListOverReceipts(T, { clientId })],
    ['QC holds', `${base}/receiving/qc-holds`, (clientId) => fetchApiListQcHolds(T, { clientId })],
    ['putaway tasks', `${base}/putaway/tasks`, (clientId) => fetchApiListPutawayTasks(T, W, { clientId })],
    ['stock', `${base}/warehouses/${W}/inventory/stock`, (clientId) => fetchApiListStock(T, W, { clientId })],
    ['ledger', `${base}/warehouses/${W}/inventory/events`, (clientId) => fetchApiListLedgerEvents(T, W, { clientId })],
    ['adjustment pendings', `${base}/inventory/adjustment-pendings`, (clientId) => fetchApiListAdjustmentPendings(T, { clientId })],
    ['variances', `${base}/movements/variances`, (clientId) => fetchApiListVariances(T, { clientId })],
    ['orders', `${base}/warehouses/${W}/outbound/orders`, (clientId) => fetchApiListOrders(T, W, { clientId })],
    ['waves', `${base}/warehouses/${W}/outbound/waves`, (clientId) => fetchApiListWaves(T, W, { clientId })],
    ['manifests', `${base}/warehouses/${W}/outbound/manifests`, (clientId) => fetchApiListManifests(T, W, { clientId })],
    ['returns', `${base}/returns`, (clientId) => fetchApiListReturns(T, { clientId })],
    ['invoices', `${base}/invoices`, (clientId) => fetchApiListInvoices(T, { clientId })],
    ['e-way bills', `${base}/eway/bills`, (clientId) => fetchApiListEwayBills(T, { clientId })],
    ['reorder policies', `${base}/replenishment/policies`, (clientId) => fetchApiListReorderPolicies(T, { clientId })],
    ['breaches', `${base}/replenishment/breaches`, (clientId) => fetchApiListBreaches(T, { clientId })],
    ['suggested POs', `${base}/replenishment/suggested-pos`, (clientId) => fetchApiListSuggestedPos(T, { clientId })],
    ['batch alerts', `${base}/replenishment/batch-alerts`, (clientId) => fetchApiListBatchAlerts(T, { clientId })],
  ];

  for (const [name, path, call] of CASES) {
    test(`${name}: clientId rides the query only when set`, async () => {
      writeSession(SESSION);
      stubFetch(200, { items: [], nextCursor: null });
      await call(undefined);
      expect(new URL(lastRequest!.url).pathname).toBe(path);
      expect(new URL(lastRequest!.url).searchParams.has('clientId')).toBe(false);
      await call(C);
      expect(new URL(lastRequest!.url).pathname).toBe(path);
      expect(new URL(lastRequest!.url).searchParams.get('clientId')).toBe(C);
      clearSession();
    });
  }
});

describe('gate-in wrappers (story 2-3a)', () => {
  const KEY = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
  const T = SESSION.tenant.id;
  const W = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
  const G = '0198f7a2-1b3c-7d4e-8f90-0000000000c1';
  const base = `/api/v1/tenants/${T}/receiving/gate-ins`;
  const GATE_IN = { id: G, code: 'GI-0001', status: 'gated_in', documents: [] };

  test('create POSTs the body with the Idempotency-Key, no query', async () => {
    writeSession(SESSION);
    stubFetch(201, { gateIn: GATE_IN });
    const body = { warehouseId: W, vehicleNo: 'KA01AB1234', transporterName: 'VRL', sealStatus: 'none' as const, documents: [] };
    const res = await fetchApiCreateGateIn(T, body, KEY);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(base);
    expect(new URL(lastRequest!.url).search).toBe('');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual(body);
    expect(res.gateIn.code).toBe('GI-0001');
    clearSession();
  });

  test('amend PATCHes the full replacement to the gate-in', async () => {
    writeSession(SESSION);
    stubFetch(200, { gateIn: GATE_IN });
    const body = { vehicleNo: 'KA01AB1234', transporterName: 'VRL', sealStatus: 'none' as const, driverPhone: null, documents: [] };
    await fetchApiAmendGateIn(T, G, body, KEY);
    expect(lastRequest!.method).toBe('PATCH');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/${G}`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual(body);
    clearSession();
  });

  test('unload POSTs to the WEB route (never the device one) with the phase body', async () => {
    writeSession(SESSION);
    stubFetch(200, { applied: false, gateIn: GATE_IN });
    const body = { phase: 'end' as const, occurredAt: '2026-10-21T04:10:00.000Z', packagesCounted: 10 };
    const res = await fetchApiUnloadGateIn(T, G, body, KEY);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/${G}/unload`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual(body);
    expect(res.applied).toBe(false);
    clearSession();
  });

  test('gate-out POSTs the time with the key', async () => {
    writeSession(SESSION);
    stubFetch(200, { gateIn: GATE_IN });
    await fetchApiGateOutGateIn(T, G, { gatedOutAt: '2026-10-21T06:00:00.000Z' }, KEY);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/${G}/gate-out`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({ gatedOutAt: '2026-10-21T06:00:00.000Z' });
    clearSession();
  });

  test('the list sends the warehouse always, each status as its own repeated parameter, cursor and limit only when set — never a clientId', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListGateIns(T, W);
    let url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(base);
    expect([...url.searchParams.keys()]).toEqual(['warehouseId']);
    expect(url.searchParams.get('warehouseId')).toBe(W);
    await fetchApiListGateIns(T, W, { status: ['gated_in', 'unloading', 'unloaded'], limit: 200, cursor: 'c1' });
    url = new URL(lastRequest!.url);
    expect(url.searchParams.getAll('status')).toEqual(['gated_in', 'unloading', 'unloaded']);
    expect(url.searchParams.get('limit')).toBe('200');
    expect(url.searchParams.get('cursor')).toBe('c1');
    expect(url.searchParams.has('clientId')).toBe(false);
    clearSession();
  });

  test('the detail GETs one gate-in', async () => {
    writeSession(SESSION);
    stubFetch(200, { gateIn: { ...GATE_IN, receipts: [] } });
    const res = await fetchApiGetGateIn(T, G);
    expect(lastRequest!.method).toBe('GET');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base}/${G}`);
    expect(res.gateIn.code).toBe('GI-0001');
    clearSession();
  });

  test('a refusal is an ApiProblem carrying its code', async () => {
    writeSession(SESSION);
    stubFetch(409, { code: 'gate-in-closed', status: 409, detail: 'GI-0001 is gated out.' });
    await expect(fetchApiGateOutGateIn(T, G, {}, KEY)).rejects.toMatchObject({ code: 'gate-in-closed', status: 409 });
    clearSession();
  });
});

describe('story 2-4a — the GRN lines read, the batch list by bin, the stock adjustment', () => {
  const T = '0198f7a2-1b3c-7d4e-8f90-112233445566';
  const W = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';
  const SKU = '0198f7a2-1b3c-7d4e-8f90-aabbccddeeff';
  const BIN = '0198f7a2-1b3c-7d4e-8f90-aabbccddee00';
  const GRN = '0198f7a2-1b3c-7d4e-8f90-aabbccddee11';
  const KEY = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

  test('the GRN lines read is a GET on the GRN', async () => {
    stubFetch(200, { items: [] });
    await fetchApiListGoodsReceiptLines(T, GRN);
    expect(new URL(lastRequest!.url).pathname).toBe(`/api/v1/tenants/${T}/receiving/goods-receipts/${GRN}/lines`);
    expect(lastRequest!.method).toBe('GET');
  });

  test('the batch list narrows to one bin when asked (and only then)', async () => {
    stubFetch(200, { items: [] });
    await fetchApiListBatches(T, W, SKU, { binId: BIN });
    expect([...new URL(lastRequest!.url).searchParams.entries()]).toEqual([
      ['skuId', SKU],
      ['binId', BIN],
    ]);
  });

  test('the adjustment POSTs the body under the key; 201 is applied, 202 is pending', async () => {
    const body = { warehouseId: W, skuId: SKU, binId: BIN, quantityDelta: -2, reasonCode: 'damaged' as const, note: 'n' };
    stubFetch(201, { event: { id: 'e' }, onHand: { quantity: 1 } });
    expect((await fetchApiAdjustStock(T, body, KEY)).kind).toBe('applied');
    expect(new URL(lastRequest!.url).pathname).toBe(`/api/v1/tenants/${T}/inventory/adjustments`);
    expect(lastRequest!.method).toBe('POST');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.clone().json()).toEqual(body);
    stubFetch(202, { pendingAdjustment: { id: 'p-1' } });
    expect(await fetchApiAdjustStock(T, body, KEY)).toEqual({ kind: 'pending', pending: { pendingAdjustment: { id: 'p-1' } } as never });
    stubFetch(400, { code: 'damaged-bin-write-off-only', title: 't', status: 400, detail: 'd' });
    await expect(fetchApiAdjustStock(T, body, KEY)).rejects.toMatchObject({ code: 'damaged-bin-write-off-only' });
  });
});

/**
 * Story 3-5a — the Counts surface's six wrappers: the list and detail reads
 * (no clientId — the list is exempt from the client filter), the bulk
 * create's two arms with the draft key, and the schedule's read, set and
 * remove, each write with its key.
 */
describe('3-5a wrappers (count tasks, bulk create, count policies)', () => {
  const KEY = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
  const W = '0198f7a2-1b3c-7d4e-8f90-778899aabbcc';
  const TASK = '0198f7a2-1b3c-7d4e-8f90-5566778899aa';
  const ZONE = '0198f7a2-1b3c-7d4e-8f90-8899aabbccdd';
  const base = () => `/api/v1/tenants/${SESSION.tenant.id}`;

  test('the list GET forwards its filters and cursor; a bare call sends no query', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListCountTasks(SESSION.tenant.id, { warehouseId: W, status: 'completed', origin: 'recount', cursor: 'c1', limit: 50 });
    const url = new URL(lastRequest!.url);
    expect(url.pathname).toBe(`${base()}/movements/counts`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ warehouseId: W, status: 'completed', origin: 'recount', cursor: 'c1', limit: '50' });
    expect(url.searchParams.has('clientId')).toBe(false);
    await fetchApiListCountTasks(SESSION.tenant.id);
    expect(new URL(lastRequest!.url).search).toBe('');
    clearSession();
  });

  test('the detail GET hits the task path', async () => {
    writeSession(SESSION);
    stubFetch(200, { task: { id: TASK }, lines: [], variances: [], recountTaskId: null });
    await fetchApiGetCountTask(SESSION.tenant.id, TASK);
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/movements/counts/${TASK}`);
    expect(lastRequest!.method).toBe('GET');
    clearSession();
  });

  test('the bulk create POSTs exactly one of binIds / zoneId with the key', async () => {
    writeSession(SESSION);
    stubFetch(201, { created: [], skipped: [] });
    await fetchApiCreateCounts(SESSION.tenant.id, { warehouseId: W, binIds: ['b1', 'b2'] }, KEY);
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/movements/counts`);
    expect(lastRequest!.method).toBe('POST');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({ warehouseId: W, binIds: ['b1', 'b2'] });
    await fetchApiCreateCounts(SESSION.tenant.id, { warehouseId: W, zoneId: ZONE }, KEY);
    expect(await lastRequest!.json()).toEqual({ warehouseId: W, zoneId: ZONE });
    clearSession();
  });

  test('a 422 too-many-bins surfaces as an ApiProblem with its code', async () => {
    writeSession(SESSION);
    stubFetch(422, { code: 'too-many-bins', status: 422, title: 'Too many bins', detail: 'at most 500' });
    try {
      await fetchApiCreateCounts(SESSION.tenant.id, { warehouseId: W, zoneId: ZONE }, KEY);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiProblem);
      expect((error as ApiProblem).code).toBe('too-many-bins');
    }
    clearSession();
  });

  test('the schedule: GET, PUT one class with the key, DELETE one class with the key', async () => {
    writeSession(SESSION);
    stubFetch(200, { policies: [] });
    const path = `${base()}/movements/warehouses/${W}/count-policies`;
    await fetchApiGetCountPolicies(SESSION.tenant.id, W);
    expect(new URL(lastRequest!.url).pathname).toBe(path);
    expect(lastRequest!.method).toBe('GET');
    await fetchApiUpsertCountPolicies(SESSION.tenant.id, W, [{ abcClass: 'b', intervalDays: 7 }], KEY);
    expect(lastRequest!.method).toBe('PUT');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({ policies: [{ abcClass: 'b', intervalDays: 7 }] });
    await fetchApiDeleteCountPolicy(SESSION.tenant.id, W, 'c', KEY);
    expect(new URL(lastRequest!.url).pathname).toBe(`${path}/c`);
    expect(lastRequest!.method).toBe('DELETE');
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    clearSession();
  });
});

describe('damage photo wrappers (story 2-5a)', () => {
  const KEY = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
  const GRN = '0198f7a2-1b3c-7d4e-8f90-0000000000b7';
  const LINE = '0198f7a2-1b3c-7d4e-8f90-00000000a001';
  const base = () => `/api/v1/tenants/${SESSION.tenant.id}`;

  test('the list GETs the receipt\'s photos with no key', async () => {
    writeSession(SESSION);
    stubFetch(200, { storageEnabled: true, photos: [] });
    await fetchApiListReceiptPhotos(SESSION.tenant.id, GRN);
    expect(lastRequest!.method).toBe('GET');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/receiving/goods-receipts/${GRN}/photos`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBeNull();
    clearSession();
  });

  test('add POSTs multipart {file} to the line under its key', async () => {
    writeSession(SESSION);
    stubFetch(201, { attachment: { id: 'a-1' } });
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'crate.jpg', { type: 'image/jpeg' });
    await fetchApiAddReceiptPhoto(SESSION.tenant.id, GRN, LINE, file, KEY);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/receiving/goods-receipts/${GRN}/lines/${LINE}/photos`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    const form = await lastRequest!.formData();
    expect((form.get('file') as File).name).toBe('crate.jpg');
    expect([...form.keys()]).toEqual(['file']);
    clearSession();
  });

  test('remove POSTs {reason} JSON under its key; a refusal surfaces its code', async () => {
    writeSession(SESSION);
    stubFetch(200, { attachment: { id: 'a-1', status: 'removed' } });
    await fetchApiRemoveReceiptPhoto(SESSION.tenant.id, GRN, 'a-1', 'Wrong pallet', KEY);
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/receiving/goods-receipts/${GRN}/photos/a-1/remove`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY);
    expect(await lastRequest!.json()).toEqual({ reason: 'Wrong pallet' });
    stubFetch(409, { type: 'about:blank', title: 'x', status: 409, code: 'attachment-not-attached' });
    await expect(fetchApiRemoveReceiptPhoto(SESSION.tenant.id, GRN, 'a-1', 'Again', KEY)).rejects.toMatchObject({ code: 'attachment-not-attached', status: 409 });
    clearSession();
  });

  test('the portal receipts: the list sends no query on the first page and the cursor after; the detail GETs its id', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiPortalGoodsReceipts(SESSION.tenant.id);
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/portal/inbound/goods-receipts`);
    expect(new URL(lastRequest!.url).search).toBe('');
    await fetchApiPortalGoodsReceipts(SESSION.tenant.id, { cursor: 'c2' });
    expect(new URL(lastRequest!.url).searchParams.get('cursor')).toBe('c2');
    stubFetch(200, { id: GRN, lines: [] });
    await fetchApiPortalGoodsReceipt(SESSION.tenant.id, GRN);
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/portal/inbound/goods-receipts/${GRN}`);
    clearSession();
  });
});

describe('story 4-7a — the disposition wrappers', () => {
  const base = () => `/api/v1/tenants/${SESSION.tenant.id}`;
  const KEY_47A = '01JABCDEFGHJKMNPQRSTVWXYZ0';
  const W = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
  const RMA = '0198f7a2-1b3c-7d4e-8f90-0000000000b2';

  test('the awaiting queue GETs its path; the first page with no option sends no query, filters ride as params', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiListAwaitingReturns(SESSION.tenant.id);
    expect(lastRequest!.method).toBe('GET');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/returns/awaiting`);
    expect(new URL(lastRequest!.url).search).toBe('');
    await fetchApiListAwaitingReturns(SESSION.tenant.id, { warehouseId: W, clientId: 'c-1', cursor: 'c2', limit: 100 });
    const params = new URL(lastRequest!.url).searchParams;
    expect(params.get('warehouseId')).toBe(W);
    expect(params.get('clientId')).toBe('c-1');
    expect(params.get('cursor')).toBe('c2');
    expect(params.get('limit')).toBe('100');
    clearSession();
  });

  test('dispose POSTs the body with the Idempotency-Key; a 409 carries its extension members', async () => {
    writeSession(SESSION);
    stubFetch(201, { dispositions: [] });
    const body = { warehouseId: W, receiptLineId: RMA, outcome: 'scrap' as const, qty: 2, reasonCode: 'damaged' as const };
    await fetchApiDisposeReturn(SESSION.tenant.id, body, KEY_47A);
    expect(lastRequest!.method).toBe('POST');
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/returns/dispositions`);
    expect(lastRequest!.headers.get('Idempotency-Key')).toBe(KEY_47A);
    expect(await lastRequest!.json()).toEqual(body);
    stubFetch(409, { type: 'x', title: 'Above threshold', status: 409, code: 'scrap-above-threshold', awaitingQty: 30, threshold: 10 });
    await expect(fetchApiDisposeReturn(SESSION.tenant.id, body, KEY_47A)).rejects.toMatchObject({
      code: 'scrap-above-threshold',
      extensions: { awaitingQty: 30, threshold: 10 },
    });
    clearSession();
  });

  test('the portal returns: no query on the first page; the filter and cursor ride as params; the detail GETs its id', async () => {
    writeSession(SESSION);
    stubFetch(200, { items: [], nextCursor: null });
    await fetchApiPortalReturns(SESSION.tenant.id);
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/portal/returns`);
    expect(new URL(lastRequest!.url).search).toBe('');
    await fetchApiPortalReturns(SESSION.tenant.id, { cursor: 'c2', dispositionState: 'awaiting' });
    expect(new URL(lastRequest!.url).searchParams.get('cursor')).toBe('c2');
    expect(new URL(lastRequest!.url).searchParams.get('dispositionState')).toBe('awaiting');
    stubFetch(200, { id: RMA, lines: [], dispositions: [] });
    await fetchApiPortalReturn(SESSION.tenant.id, RMA);
    expect(new URL(lastRequest!.url).pathname).toBe(`${base()}/portal/returns/${RMA}`);
    clearSession();
  });
});
