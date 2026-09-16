import { client } from './generated/client.gen';
import {
  catalogControllerEditSku,
  catalogControllerImportCatalog,
  catalogControllerListSkus,
  devicesControllerListDevices,
  devicesControllerMintEnrollmentCode,
  devicesControllerRevokeDevice,
  healthControllerHealth,
  inboundControllerGetPurchaseOrder,
  inboundControllerListPurchaseOrders,
  inboundControllerListVendors,
  inventoryControllerListStock,
  outboundControllerCancelOrder,
  outboundControllerCancelWave,
  outboundControllerCreateOrder,
  outboundControllerCreateWavePolicy,
  outboundControllerGenerateWave,
  outboundControllerGetOrder,
  outboundControllerGetWave,
  outboundControllerListOrders,
  outboundControllerListWavePolicies,
  outboundControllerListWaves,
  outboundControllerReleaseWave,
  receivingControllerApproveOverReceipt,
  receivingControllerListGoodsReceipts,
  receivingControllerListOverReceipts,
  receivingControllerListQcHolds,
  receivingControllerPlaceQcHold,
  receivingControllerReleaseQcHold,
  receivingControllerRejectOverReceipt,
  tenancyControllerCreateBin,
  tenancyControllerCreateWarehouse,
  tenancyControllerCreateZone,
  tenancyControllerGenerateBinGrid,
  tenancyControllerListBins,
  tenancyControllerListWarehouses,
  tenancyControllerListZones,
  tenancyControllerMergeBin,
  tenancyControllerRegister,
  tenancyControllerSetBinBlocked,
  tenancyControllerRetireBin,
  tenancyControllerSetupChecklist,
  tenancyControllerSignIn,
  usersControllerAcceptInvite,
  usersControllerInviteUser,
  usersControllerListUsers,
  usersControllerMe,
  usersControllerSetUserRole,
} from './generated/sdk.gen';
import { ensureSessionHint, readSession, clearSession, writeSession } from '../auth';
import type {
  AcceptInviteDto,
  AcceptInviteResponse,
  BinGridResponse,
  BinListResponse,
  BinMergeResponse,
  BinResponse,
  CatalogImportResponse,
  CreateBinDto,
  CreateWarehouseDto,
  CreateZoneDto,
  DeviceListResponse,
  DeviceResponse,
  GenerateBinsDto,
  GoodsReceiptListResponse,
  HealthResponse,
  MergeBinDto,
  InviteUserDto,
  InviteUserResponse,
  MeResponse,
  MintEnrollmentCodeResponse,
  CreateOrderDto,
  CreateWavePolicyDto,
  GenerateWaveDto,
  OrderListResponse,
  OrderResponse,
  OverReceiptDecisionResponse,
  OverReceiptListResponse,
  PlaceQcHoldDto,
  QcHoldListResponse,
  QcHoldResponse,
  StockListResponse,
  PatchBinDto,
  PatchSkuDto,
  PurchaseOrderListResponse,
  PurchaseOrderResponse,
  RegisterTenantDto,
  SetUserRoleDto,
  SetupChecklistResponse,
  SignInDto,
  SignInResponse,
  SkuListResponse,
  SkuResponse,
  TenantRegistrationResponse,
  UserListResponse,
  UserResponse,
  VendorListResponse,
  WarehouseListResponse,
  WarehouseResponse,
  WaveListResponse,
  WavePolicyListResponse,
  WavePolicyResponse,
  WaveResponse,
  ZoneListResponse,
  ZoneResponse,
} from './generated/types.gen';

/**
 * Configures the generated client once. The base URL points at wms-be's
 * `/api/v1` shell; every typed function lives in ./generated (AD-8 — no
 * hand-written API types anywhere in wms-fe).
 */
// `||` (not `??`) so a set-but-empty env var still falls back to the default.
const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api/v1';

client.setConfig({
  baseUrl,
});

/**
 * Attaches the stored session token to every request the browser makes.
 * Server-side renders (no session) send nothing — the tenancy endpoints
 * answer 401 and surfaces degrade honestly.
 */
client.interceptors.request.use((request) => {
  const session = readSession();
  if (session !== null) {
    request.headers.set('Authorization', `Bearer ${session.token}`);
    // Bootstrap: the proxy gate may have rendered this page on an expired
    // hint cookie even though localStorage holds a fresh token — re-assert
    // the mirror so the next hard navigation doesn't bounce to /login.
    ensureSessionHint();
  }
  return request;
});

/**
 * The backend's 401 is authoritative: the token was rejected (expired,
 * revoked, tampered). Drop the stale session immediately so the UI flips to
 * signed-out — the proxy gate then also sees the cleared hint cookie.
 */
client.interceptors.response.use((response) => {
  if (response.status === 401) {
    clearSession();
  }
  return response;
});

export { client };

/** A backend problem-details response, surfaced as an error to callers. */
export class ApiProblem extends Error {
  readonly code: string;
  readonly detail?: string;
  readonly status: number;
  /**
   * The problem's human-readable `title` (RFC 9457). Surfaces branch on
   * `code`, never on prose — but a refusal whose cause is invisible in every
   * DTO the client holds (story 4.2b: an order cancel refused for committed
   * reservations or drawn pick lines) can only be explained by rendering the
   * server's own words, so the title is carried rather than dropped.
   */
  readonly title?: string;

  constructor(code: string, status: number, detail?: string, title?: string) {
    super(detail ?? code);
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.title = title;
  }
}

/**
 * The failure a wrapper throws.
 *
 * A problem+json body becomes an `ApiProblem` carrying the machine-readable
 * `code` every surface branches on. A TRANSPORT failure is different in kind:
 * the generated client hands back the rejected fetch's own Error (wms-be
 * down, DNS, CORS, an aborted request) and there is no HTTP response, no
 * `code`, and nothing the server said. Dressing that up as
 * `ApiProblem('request-failed')` put the raw `"TypeError: Failed to fetch"`
 * on screen, because every reason mapper renders `detail` in its default arm
 * — the house "is wms-be running?" copy those mappers keep for a non-problem
 * error was unreachable in practice. It is surfaced as the Error it is so
 * that copy fires.
 *
 * A non-problem JSON error body (a 500 with `{ message: 'boom' }`) is still an
 * answer from the server and still becomes `ApiProblem('request-failed')`.
 */
function unwrapError(error: unknown, fallbackStatus: number): Error {
  if (isProblemDetails(error)) {
    return new ApiProblem(error.code, error.status ?? fallbackStatus, error.detail, error.title);
  }
  if (error instanceof Error) {
    return error;
  }
  if (typeof error !== 'object' || error === null) {
    // A non-JSON error body — a proxy's HTML 502 page, a plain-text gateway
    // message. `String(error)` used to become the `detail` every mapper
    // renders, putting raw markup on screen; there is nothing here the
    // server said in a shape a client can use, so it is transport-shaped
    // too and the house unreachable copy fires.
    return new Error(`The request failed with status ${fallbackStatus} and no problem details.`);
  }
  return new ApiProblem('request-failed', fallbackStatus, String(error));
}

function isProblemDetails(
  error: unknown,
): error is { code: string; detail?: string; status?: number; title?: string } {
  return typeof error === 'object' && error !== null && 'code' in error;
}

export async function fetchApiHealth(options?: {
  signal?: AbortSignal;
}): Promise<HealthResponse> {
  const { data, error } = await healthControllerHealth(options);
  if (error || !data) {
    throw unwrapError(error, 503);
  }
  return data;
}

export async function fetchApiRegisterTenant(
  body: RegisterTenantDto,
  idempotencyKey: string,
): Promise<TenantRegistrationResponse> {
  const { data, error } = await tenancyControllerRegister({
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

export async function fetchApiSignIn(body: SignInDto): Promise<SignInResponse> {
  const { data, error } = await tenancyControllerSignIn({ body });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

export async function fetchApiCreateWarehouse(
  tenantId: string,
  body: CreateWarehouseDto,
  idempotencyKey: string,
): Promise<WarehouseResponse> {
  const { data, error } = await tenancyControllerCreateWarehouse({
    path: { tenantId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

export async function fetchApiListWarehouses(
  tenantId: string,
  options?: { cursor?: string; signal?: AbortSignal },
): Promise<WarehouseListResponse> {
  const { data, error } = await tenancyControllerListWarehouses({
    path: { tenantId },
    query: options?.cursor === undefined ? undefined : { cursor: options.cursor },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

export async function fetchApiCreateZone(
  tenantId: string,
  warehouseId: string,
  body: CreateZoneDto,
  idempotencyKey: string,
): Promise<ZoneResponse> {
  const { data, error } = await tenancyControllerCreateZone({
    path: { tenantId, warehouseId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

export async function fetchApiListZones(
  tenantId: string,
  warehouseId: string,
  options?: { cursor?: string; signal?: AbortSignal },
): Promise<ZoneListResponse> {
  const { data, error } = await tenancyControllerListZones({
    path: { tenantId, warehouseId },
    query: options?.cursor === undefined ? undefined : { cursor: options.cursor },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

export async function fetchApiCreateBin(
  tenantId: string,
  warehouseId: string,
  zoneId: string,
  body: CreateBinDto,
  idempotencyKey: string,
): Promise<BinResponse> {
  const { data, error } = await tenancyControllerCreateBin({
    path: { tenantId, warehouseId, zoneId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

export async function fetchApiGenerateBinGrid(
  tenantId: string,
  warehouseId: string,
  zoneId: string,
  body: GenerateBinsDto,
  idempotencyKey: string,
): Promise<BinGridResponse> {
  const { data, error } = await tenancyControllerGenerateBinGrid({
    path: { tenantId, warehouseId, zoneId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

export async function fetchApiListBins(
  tenantId: string,
  warehouseId: string,
  zoneId: string,
  options?: { cursor?: string; signal?: AbortSignal },
): Promise<BinListResponse> {
  const { data, error } = await tenancyControllerListBins({
    path: { tenantId, warehouseId, zoneId },
    query: options?.cursor === undefined ? undefined : { cursor: options.cursor },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

export async function fetchApiSetBinBlocked(
  tenantId: string,
  warehouseId: string,
  binId: string,
  body: PatchBinDto,
  idempotencyKey: string,
): Promise<BinResponse> {
  const { data, error } = await tenancyControllerSetBinBlocked({
    path: { tenantId, warehouseId, binId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Merges a bin into another (capability `bin.retire`, story 3.6) — the
 * source's stock moves through real ledger movements and the source retires
 * in the same commit.
 */
export async function fetchApiMergeBin(
  tenantId: string,
  warehouseId: string,
  sourceBinId: string,
  body: MergeBinDto,
  idempotencyKey: string,
): Promise<BinMergeResponse> {
  const { data, error } = await tenancyControllerMergeBin({
    path: { tenantId, warehouseId, binId: sourceBinId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Retires a bin (capability `bin.retire`) — one-way, only an EMPTY bin can. */
export async function fetchApiRetireBin(
  tenantId: string,
  warehouseId: string,
  binId: string,
  idempotencyKey: string,
): Promise<BinResponse> {
  const { data, error } = await tenancyControllerRetireBin({
    path: { tenantId, warehouseId, binId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Catalog import (story 1.4) — synchronous multipart; valid rows commit in
 * one transaction, bad rows come back row-level (a 201 can carry failures).
 * `mode` is undefined for the default `initial` run; `fix` targets only the
 * latest run's failed SKU codes.
 */
export async function fetchApiImportCatalog(
  tenantId: string,
  file: File,
  mode: 'initial' | 'fix' | undefined,
  idempotencyKey: string,
): Promise<CatalogImportResponse> {
  const { data, error } = await catalogControllerImportCatalog({
    body: { file, ...(mode === undefined ? {} : { mode }) },
    headers: { 'Idempotency-Key': idempotencyKey },
    path: { tenantId },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

export async function fetchApiListSkus(
  tenantId: string,
  options?: { cursor?: string; signal?: AbortSignal },
): Promise<SkuListResponse> {
  const { data, error } = await catalogControllerListSkus({
    path: { tenantId },
    query: options?.cursor === undefined ? undefined : { cursor: options.cursor },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * SKU edit — everything but the SKU code is editable; the code is immutable.
 */
export async function fetchApiEditSku(
  tenantId: string,
  skuId: string,
  body: PatchSkuDto,
  idempotencyKey: string,
): Promise<SkuResponse> {
  const { data, error } = await catalogControllerEditSku({
    path: { tenantId, skuId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

export async function fetchApiSetupChecklist(
  tenantId: string,
  options?: { signal?: AbortSignal },
): Promise<SetupChecklistResponse> {
  const { data, error } = await tenancyControllerSetupChecklist({
    path: { tenantId },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Invite a user (story 1.5, Owner capability `users.invite`) — the response
 * carries the one-time invite token for the owner to share out-of-band.
 */
export async function fetchApiInviteUser(
  tenantId: string,
  body: InviteUserDto,
  idempotencyKey: string,
): Promise<InviteUserResponse> {
  const { data, error } = await usersControllerInviteUser({
    path: { tenantId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** The tenant's users — a read, open to any tenant member. */
export async function fetchApiListUsers(
  tenantId: string,
  options?: { cursor?: string; signal?: AbortSignal },
): Promise<UserListResponse> {
  const { data, error } = await usersControllerListUsers({
    path: { tenantId },
    query: options?.cursor === undefined ? undefined : { cursor: options.cursor },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Change a user's role (Owner capability `users.role_change`). */
export async function fetchApiSetUserRole(
  tenantId: string,
  userId: string,
  body: SetUserRoleDto,
  idempotencyKey: string,
): Promise<UserResponse> {
  const { data, error } = await usersControllerSetUserRole({
    path: { tenantId, userId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Accept a one-time invite (unauthenticated) — sets the invitee's password. */
export async function fetchApiAcceptInvite(
  tenantId: string,
  body: AcceptInviteDto,
  idempotencyKey: string,
): Promise<AcceptInviteResponse> {
  const { data, error } = await usersControllerAcceptInvite({
    path: { tenantId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** The signed-in user's own row — the /me bootstrap refresher reads this. */
export async function fetchApiMe(tenantId: string): Promise<MeResponse> {
  const { data, error } = await usersControllerMe({
    path: { tenantId },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Mint a one-time device enrollment code (story 3.2, capability
 * `device.manage`) — the device app redeems it once, within its TTL.
 */
export async function fetchApiMintEnrollmentCode(
  tenantId: string,
  idempotencyKey: string,
): Promise<MintEnrollmentCodeResponse> {
  const { data, error } = await devicesControllerMintEnrollmentCode({
    path: { tenantId },
    body: {},
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** The tenant's enrolled devices — a read, open to any tenant member. */
export async function fetchApiListDevices(
  tenantId: string,
  options?: { cursor?: string; signal?: AbortSignal },
): Promise<DeviceListResponse> {
  const { data, error } = await devicesControllerListDevices({
    path: { tenantId },
    query: options?.cursor === undefined ? undefined : { cursor: options.cursor },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Revoke a device (capability `device.manage`) — wipe-flagged, audited,
 * effective on the device's next request; re-revoke is idempotent.
 */
export async function fetchApiRevokeDevice(
  tenantId: string,
  deviceId: string,
  idempotencyKey: string,
): Promise<DeviceResponse> {
  const { data, error } = await devicesControllerRevokeDevice({
    path: { tenantId, deviceId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

// ── Inbound + receiving (stories 3.1 / 3.3) ─────────────────────────────────

export async function fetchApiListVendors(
  tenantId: string,
  options?: { cursor?: string; signal?: AbortSignal },
): Promise<VendorListResponse> {
  const { data, error } = await inboundControllerListVendors({
    path: { tenantId },
    query: options?.cursor === undefined ? undefined : { cursor: options.cursor },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

export async function fetchApiListPurchaseOrders(
  tenantId: string,
  warehouseId: string,
  options?: { cursor?: string; signal?: AbortSignal },
): Promise<PurchaseOrderListResponse> {
  const { data, error } = await inboundControllerListPurchaseOrders({
    path: { tenantId, warehouseId },
    query: options?.cursor === undefined ? undefined : { cursor: options.cursor },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

export async function fetchApiGetPurchaseOrder(
  tenantId: string,
  poId: string,
  options?: { signal?: AbortSignal },
): Promise<PurchaseOrderResponse> {
  const { data, error } = await inboundControllerGetPurchaseOrder({
    path: { tenantId, poId },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** The GRN list (story 3.3) — one warehouse's (or the tenant's) receipts. */
export async function fetchApiListGoodsReceipts(
  tenantId: string,
  options?: { warehouseId?: string; cursor?: string; signal?: AbortSignal },
): Promise<GoodsReceiptListResponse> {
  const { data, error } = await receivingControllerListGoodsReceipts({
    path: { tenantId },
    query:
      options?.warehouseId === undefined && options?.cursor === undefined
        ? undefined
        : {
            ...(options.warehouseId === undefined ? {} : { warehouseId: options.warehouseId }),
            ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
          },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** The over-receipt queue (story 3.3) — the Conflicts & Reviews read. */
export async function fetchApiListOverReceipts(
  tenantId: string,
  options?: { status?: 'pending' | 'approved' | 'rejected'; cursor?: string; signal?: AbortSignal },
): Promise<OverReceiptListResponse> {
  const { data, error } = await receivingControllerListOverReceipts({
    path: { tenantId },
    query:
      options?.status === undefined && options?.cursor === undefined
        ? undefined
        : {
            ...(options.status === undefined ? {} : { status: options.status }),
            ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
          },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Approves an over-receipt (capability `review.decide`) — the excess applies. */
export async function fetchApiApproveOverReceipt(
  tenantId: string,
  overReceiptId: string,
  idempotencyKey: string,
): Promise<OverReceiptDecisionResponse> {
  const { data, error } = await receivingControllerApproveOverReceipt({
    path: { tenantId, overReceiptId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Rejects an over-receipt (capability `review.decide`) — the excess stays unapplied. */
export async function fetchApiRejectOverReceipt(
  tenantId: string,
  overReceiptId: string,
  idempotencyKey: string,
): Promise<OverReceiptDecisionResponse> {
  const { data, error } = await receivingControllerRejectOverReceipt({
    path: { tenantId, overReceiptId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** The QC holds list (story 3.4) — warehouse- and status-filterable. */
export async function fetchApiListQcHolds(
  tenantId: string,
  options?: {
    warehouseId?: string;
    status?: 'open' | 'released';
    cursor?: string;
    signal?: AbortSignal;
  },
): Promise<QcHoldListResponse> {
  const { data, error } = await receivingControllerListQcHolds({
    path: { tenantId },
    query:
      options?.warehouseId === undefined &&
      options?.status === undefined &&
      options?.cursor === undefined
        ? undefined
        : {
            ...(options.warehouseId === undefined ? {} : { warehouseId: options.warehouseId }),
            ...(options.status === undefined ? {} : { status: options.status }),
            ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
          },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Places a QC hold (capability `qc.manage`, story 3.4) — the (sku, bin)
 * scope's stock relocates into the warehouse's system QC-hold bin server-side.
 */
export async function fetchApiPlaceQcHold(
  tenantId: string,
  body: PlaceQcHoldDto,
  idempotencyKey: string,
): Promise<QcHoldResponse> {
  const { data, error } = await receivingControllerPlaceQcHold({
    path: { tenantId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Releases a QC hold (capability `qc.manage`) — the stock returns to its origin bin. */
export async function fetchApiReleaseQcHold(
  tenantId: string,
  holdId: string,
  idempotencyKey: string,
): Promise<QcHoldResponse> {
  const { data, error } = await receivingControllerReleaseQcHold({
    path: { tenantId, holdId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * The on-hand stock rows (story 2.2 read) for the QC hold form's scope
 * choices — the (sku, bin) scopes with on-hand to hold.
 */
export async function fetchApiListStock(
  tenantId: string,
  warehouseId: string,
  options?: { skuId?: string; binId?: string; cursor?: string; signal?: AbortSignal },
): Promise<StockListResponse> {
  const { data, error } = await inventoryControllerListStock({
    path: { tenantId, warehouseId },
    query:
      options?.skuId === undefined &&
      options?.binId === undefined &&
      options?.cursor === undefined
        ? undefined
        : {
            ...(options.skuId === undefined ? {} : { skuId: options.skuId }),
            ...(options.binId === undefined ? {} : { binId: options.binId }),
            ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
          },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * One warehouse's order page (story 4.1 read, surfaced by 4.2b) — newest
 * first, keyset cursor. The endpoint offers `cursor` + `limit` and nothing
 * else: no status filter, no sort, no search. The surface's status control is
 * therefore page-scoped and says so, rather than pretending to search the
 * whole warehouse.
 */
export async function fetchApiListOrders(
  tenantId: string,
  warehouseId: string,
  options?: { cursor?: string; limit?: number; signal?: AbortSignal },
): Promise<OrderListResponse> {
  const { data, error } = await outboundControllerListOrders({
    path: { tenantId, warehouseId },
    query:
      options?.cursor === undefined && options?.limit === undefined
        ? undefined
        : {
            ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
            ...(options.limit === undefined ? {} : { limit: options.limit }),
          },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * One order's detail — the lines with their ordered / reserved / shortfall
 * quantities and live hold state. The list row cannot carry these
 * (`OrderEntryDto` has no `lines`), so the surface fetches this when a row
 * expands.
 */
export async function fetchApiGetOrder(
  tenantId: string,
  orderId: string,
  options?: { signal?: AbortSignal },
): Promise<OrderResponse> {
  const { data, error } = await outboundControllerGetOrder({
    path: { tenantId, orderId },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Creates an order (capability `orders.manage`, story 4.1). Acceptance
 * reserves `min(qty, atp)` per line, so a 201 can legitimately come back with
 * `reservedQty < qty` and `status: 'backordered'` lines — success with a
 * shortfall, never an error.
 */
export async function fetchApiCreateOrder(
  tenantId: string,
  body: CreateOrderDto,
  idempotencyKey: string,
): Promise<OrderResponse> {
  const { data, error } = await outboundControllerCreateOrder({
    path: { tenantId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Cancels an accepted order (capability `orders.manage`) — every open
 * per-line reservation is released. The endpoint's body is required and
 * empty. A 409 means a consuming flow already claimed a hold (committed
 * reservations, drawn pick lines); neither cause is visible in any DTO the
 * client holds, so callers render the server's words.
 */
export async function fetchApiCancelOrder(
  tenantId: string,
  orderId: string,
  idempotencyKey: string,
): Promise<OrderResponse> {
  const { data, error } = await outboundControllerCancelOrder({
    path: { tenantId, orderId },
    body: {},
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Waves, policies and picklists (story 4.2, surfaced by 4.2c)         */
/* ------------------------------------------------------------------ */

/**
 * One warehouse's wave-policy page. A policy IS the wave rule — grouping,
 * priority, the order cap and the carrier cutoff — so the generate form
 * picks from this list rather than asking for the rule per wave.
 */
export async function fetchApiListWavePolicies(
  tenantId: string,
  warehouseId: string,
  options?: { cursor?: string; limit?: number; signal?: AbortSignal },
): Promise<WavePolicyListResponse> {
  const { data, error } = await outboundControllerListWavePolicies({
    path: { tenantId, warehouseId },
    query:
      options?.cursor === undefined && options?.limit === undefined
        ? undefined
        : {
            ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
            ...(options.limit === undefined ? {} : { limit: options.limit }),
          },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Creates a wave policy (capability `waves.manage`). The cutoff is an
 * explicit `HH:MM` wall clock compared in an explicit IANA zone, and it gates
 * RELEASE only — planning ahead of a cutoff is the point. `00:00` is refused
 * by the backend (it would refuse release for the whole day).
 */
export async function fetchApiCreateWavePolicy(
  tenantId: string,
  body: CreateWavePolicyDto,
  idempotencyKey: string,
): Promise<WavePolicyResponse> {
  const { data, error } = await outboundControllerCreateWavePolicy({
    path: { tenantId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * One warehouse's wave page (headers only — `picklistCount` and nothing
 * deeper). Newest first, keyset cursor, no status filter and no search, so
 * the surface's status control is page-scoped and says so.
 */
export async function fetchApiListWaves(
  tenantId: string,
  warehouseId: string,
  options?: { cursor?: string; limit?: number; signal?: AbortSignal },
): Promise<WaveListResponse> {
  const { data, error } = await outboundControllerListWaves({
    path: { tenantId, warehouseId },
    query:
      options?.cursor === undefined && options?.limit === undefined
        ? undefined
        : {
            ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
            ...(options.limit === undefined ? {} : { limit: options.limit }),
          },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * One wave's detail — its picklists and every pick line in walk order. There
 * is no picklist endpoint: the stops a picker walks come free with this read,
 * which is why expanding a wave row fetches the wave once.
 */
export async function fetchApiGetWave(
  tenantId: string,
  waveId: string,
  options?: { signal?: AbortSignal },
): Promise<WaveResponse> {
  const { data, error } = await outboundControllerGetWave({
    path: { tenantId, waveId },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Generates a wave (capability `waves.manage`) — one call drives both
 * selection paths: omit `orderIds` for the auto-sweep of every eligible
 * accepted order, pass them for an explicit selection.
 */
export async function fetchApiGenerateWave(
  tenantId: string,
  body: GenerateWaveDto,
  idempotencyKey: string,
): Promise<WaveResponse> {
  const { data, error } = await outboundControllerGenerateWave({
    path: { tenantId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Releases a wave to the floor (capability `waves.manage`).
 *
 * NO body — unlike cancel-order, whose empty `{}` is required. The endpoint
 * still requires an `Idempotency-Key`, and an already-released wave replays
 * as a 200 no-op rather than raising a second `wave.released` event.
 *
 * A 409 `cutoff-passed` is decided by the SERVER's clock against the policy
 * cutoff; the browser's at-risk amber is advisory and never gates this call.
 */
export async function fetchApiReleaseWave(
  tenantId: string,
  waveId: string,
  idempotencyKey: string,
): Promise<WaveResponse> {
  const { data, error } = await outboundControllerReleaseWave({
    path: { tenantId, waveId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Cancels a wave (capability `waves.manage`) — its picklists and pick lines
 * go cancelled and its orders become eligible for waving again; no
 * reservation and no stock moves. NO body, same as release.
 */
export async function fetchApiCancelWave(
  tenantId: string,
  waveId: string,
  idempotencyKey: string,
): Promise<WaveResponse> {
  const { data, error } = await outboundControllerCancelWave({
    path: { tenantId, waveId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Bootstrap `/me` refetch (story 1.5): the stored session's role was read at
 * sign-in, but roles change without re-login (the backend re-reads the DB per
 * command) — on app mount this re-fetches the caller's own row and rewrites
 * the stored session when it moved, so surface gating tracks reality.
 */
export async function refreshSessionUser(): Promise<void> {
  const session = readSession();
  if (session === null) return;
  try {
    const { user } = await fetchApiMe(session.tenant.id);
    const current = readSession();
    if (
      current !== null &&
      (current.user.id !== user.id ||
        current.user.role !== user.role ||
        current.user.status !== user.status)
    ) {
      writeSession({ ...current, user });
    }
  } catch {
    // A failed refresh leaves the stored role in place — the backend still
    // gates every command; hiding is cosmetic, not authoritative.
  }
}