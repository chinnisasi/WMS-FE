import { client } from './generated/client.gen';
import {
  catalogControllerCorrectSkuClient,
  clientsControllerCreateClient,
  clientsControllerListClients,
  clientsControllerRenameClient,
  catalogControllerCreateKit,
  catalogControllerCreateProduct,
  catalogControllerEditProduct,
  catalogControllerEditSku,
  catalogControllerGetSegregationMatrix,
  catalogControllerImportCatalog,
  catalogControllerListKits,
  catalogControllerListProducts,
  catalogControllerListSkus,
  catalogControllerReplaceKit,
  channelsControllerConnect,
  channelsControllerDisconnect,
  channelsControllerListConnections,
  channelsControllerRetryConnection,
  channelsControllerRotateCredentials,
  channelsControllerSetConnectionBuffers,
  channelsControllerListConnectionMappings,
  channelsControllerSetConnectionMappings,
  channelsControllerUpdateConnectionConfig,
  carriersControllerListConnections,
  complianceControllerGetOrderColdChainTrace,
  complianceControllerListExcursions,
  complianceControllerResolveExcursion,
  invoicingControllerGenerateInvoice,
  ewayControllerAppendStateThreshold,
  ewayControllerDismiss,
  ewayControllerExportBills,
  ewayControllerGenerate,
  ewayControllerListBills,
  ewayControllerListGstinSettings,
  ewayControllerListStateThresholds,
  ewayControllerPutGstinSetting,
  ewayControllerRecord,
  ewayControllerUpdateTransport,
  invoicingControllerGetInvoice,
  invoicingControllerHsnSummary,
  invoicingControllerHsnSummaryGstins,
  invoicingControllerListInvoices,
  devicesControllerListDevices,
  devicesControllerListRejectedOps,
  devicesControllerMintEnrollmentCode,
  devicesControllerResolveRejectedOp,
  devicesControllerRevokeDevice,
  healthControllerHealth,
  inboundControllerGetPurchaseOrder,
  inboundControllerListPurchaseOrders,
  inboundControllerListVendors,
  inventoryControllerApproveAdjustment,
  inventoryControllerGetBatch,
  inventoryControllerListAdjustmentPendings,
  inventoryControllerListEvents,
  inventoryControllerListStock,
  inventoryControllerRejectAdjustment,
  movementsControllerListCountVariances,
  movementsControllerResolveCountVariance,
  outboundControllerCancelOrder,
  outboundControllerCancelWave,
  outboundControllerCreateOrder,
  outboundControllerCreateWavePolicy,
  outboundControllerCreateManifest,
  outboundControllerGenerateWave,
  outboundControllerDispatchOrder,
  outboundControllerGetOrder,
  outboundControllerGetOrderRates,
  outboundControllerGetShipment,
  outboundControllerGetWave,
  outboundControllerLabelOrder,
  outboundControllerListManifests,
  outboundControllerListOrders,
  outboundControllerPackOrder,
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
  replenishmentControllerDeleteReorderPolicy,
  replenishmentControllerDismissBatchAlert,
  replenishmentControllerDismissBreach,
  replenishmentControllerGetExpiryPolicy,
  replenishmentControllerListBatchAlerts,
  replenishmentControllerListBreaches,
  replenishmentControllerListReorderPolicies,
  replenishmentControllerListSuggestedPos,
  replenishmentControllerSubmitSuggestedPo,
  replenishmentControllerUpsertReorderPolicy,
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
  reportingControllerOverview,
  rateCardsControllerActivate,
  rateCardsControllerCancel,
  rateCardsControllerCreate,
  rateCardsControllerDiscard,
  rateCardsControllerInForce,
  rateCardsControllerList,
  rateCardsControllerReplaceLines,
} from './generated/sdk.gen';
import { ensureSessionHint, readSession, clearSession, writeSession } from '../auth';
import type {
  AcceptInviteDto,
  AcceptInviteResponse,
  AdjustmentDecisionResponse,
  AdjustmentPendingListResponse,
  BinGridResponse,
  BinListResponse,
  BinMergeResponse,
  BinResponse,
  CatalogImportResponse,
  ChannelBuffersSetResponse,
  ChannelConnectionMappingsResponse,
  ChannelConnectionResponse,
  ChannelConnectionsResponse,
  ConnectChannelDto,
  RotateChannelCredentialDto,
  SetChannelBuffersDto,
  SetChannelMappingsDto,
  UpdateConnectionConfigDto,
  ColdChainTraceResponse,
  CreateBinDto,
  CreateProductDto,
  CreateWarehouseDto,
  CreateZoneDto,
  CountVarianceListResponse,
  DeviceListResponse,
  DeviceResponse,
  ExcursionListResponse,
  LedgerEventListResponse,
  ExcursionResponse,
  GenerateInvoiceDto,
  AppendEwayStateThresholdDto,
  EwayBillListResponse,
  EwayBillResponse,
  EwayExportResponse,
  EwayGstinSettingListResponse,
  EwayGstinSettingResponse,
  EwayStateThresholdListResponse,
  EwayStateThresholdResponse,
  RecordEwayDto,
  UpdateEwayTransportDto,
  HsnSummaryGstinsResponse,
  HsnSummaryResponse,
  InvoiceListResponse,
  InvoiceResponse,
  GenerateBinsDto,
  GoodsReceiptListResponse,
  HealthResponse,
  MergeBinDto,
  InviteUserDto,
  InviteUserResponse,
  KitListResponse,
  KitResponse,
  MeResponse,
  MintEnrollmentCodeResponse,
  CreateOrderDto,
  CarrierConnectionListResponse,
  CreateWavePolicyDto,
  CreateManifestDto,
  DispatchOrderDto,
  DispatchResponse,
  GenerateWaveDto,
  LabelOrderDto,
  ManifestListResponse,
  OrderRatesResponse,
  ManifestResponse,
  OrderListResponse,
  ShipmentResponse,
  OrderResponse,
  PackOrderDto,
  PackResponse,
  OverReceiptDecisionResponse,
  OverReceiptListResponse,
  PlaceQcHoldDto,
  QcHoldListResponse,
  QcHoldResponse,
  ReorderPolicyListResponse,
  ReorderPolicyResponse,
  BreachListResponse,
  BreachResponse,
  BatchAlertListResponse,
  BatchAlertResponse,
  BatchDetailResponse,
  ExpiryPolicyResponse,
  SuggestedPoListResponse,
  SubmitSuggestedPoResponse,
  UpsertReorderPolicyDto,
  SubmitSuggestedPoDto,
  StockListResponse,
  PutKitDto,
  PatchBinDto,
  PatchProductDto,
  PatchSkuDto,
  ClientDto,
  ClientListResponse,
  RateCardDto,
  RateCardInForceResponse,
  RateCardLineDto,
  RateCardListResponse,
  ProductListResponse,
  ProductResponse,
  PurchaseOrderListResponse,
  PurchaseOrderResponse,
  RegisterTenantDto,
  RejectedOpListResponse,
  RejectedOpResolveResponse,
  ResolveCountVarianceDto,
  ResolveCountVarianceResponse,
  ResolveRejectedOpDto,
  SegregationMatrixResponse,
  SetUserRoleDto,
  SetupChecklistResponse,
  SignInDto,
  SignInResponse,
  SkuListResponse,
  SkuClientCorrectionResponse,
  SkuResponse,
  TenantRegistrationResponse,
  UserListResponse,
  ReportingOverviewResponse,
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

// Story 7-2: the ONE origin every surface composes absolute API URLs from —
// the channel webhook rows are built on this base, never on
// `window.location.origin` (bl-16: the backend the browser talks to — behind
// a proxy, on another host, a LAN box — is the base configured here; the page
// origin can differ from it).
export const API_BASE_URL = baseUrl;

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
  /**
   * The problem's RFC 9457 EXTENSION members (story 8-2b) — everything
   * beyond the standard `type/title/status/detail/instance/code`. Structured
   * data a refusal carries for the client to act on, e.g. the e-way export's
   * per-bill `bills: [{id, reasons}]`. Empty when the problem has none.
   */
  readonly extensions: Readonly<Record<string, unknown>>;

  constructor(code: string, status: number, detail?: string, title?: string, extensions: Record<string, unknown> = {}) {
    super(detail ?? code);
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.title = title;
    this.extensions = extensions;
  }
}

const STANDARD_PROBLEM_MEMBERS = new Set(['type', 'title', 'status', 'detail', 'instance', 'code', 'errors', 'message']);

function problemExtensions(error: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(error).filter(([key]) => !STANDARD_PROBLEM_MEMBERS.has(key)));
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
    return new ApiProblem(error.code, error.status ?? fallbackStatus, error.detail, error.title, problemExtensions(error));
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

/**
 * Story 9-1 — the per-warehouse Overview: ten KPI tiles, each figure with
 * its drill. A read (member-open); no query parameters.
 */
export async function fetchApiReportingOverview(
  tenantId: string,
  warehouseId: string,
  options?: { signal?: AbortSignal },
): Promise<ReportingOverviewResponse> {
  const { data, error } = await reportingControllerOverview({
    path: { tenantId, warehouseId },
    signal: options?.signal,
  });
  if (error || !data) throw unwrapError(error, 400);
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
 * latest run's failed SKU codes. Story 21-2b: `clientId` names the client
 * the run's new SKUs belong to — dropped from the form when undefined (the
 * backend then defaults to the tenant's own client while it is the only
 * one, and a fix-mode run inherits its original run's client).
 */
export async function fetchApiImportCatalog(
  tenantId: string,
  file: File,
  mode: 'initial' | 'fix' | undefined,
  idempotencyKey: string,
  clientId?: string,
): Promise<CatalogImportResponse> {
  const { data, error } = await catalogControllerImportCatalog({
    body: {
      file,
      ...(mode === undefined ? {} : { mode }),
      ...(clientId === undefined ? {} : { clientId }),
    },
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
  options?: { cursor?: string; productId?: string; signal?: AbortSignal },
): Promise<SkuListResponse> {
  const { data, error } = await catalogControllerListSkus({
    path: { tenantId },
    query:
      options?.cursor === undefined && options?.productId === undefined
        ? undefined
        : {
            ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
            ...(options.productId === undefined ? {} : { productId: options.productId }),
          },
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

/**
 * Story 21-2b — the owner's client correction: allowed by the server only
 * while the SKU has no ledger event, order line or PO line (409
 * `sku-has-history` otherwise). Gated `clients.manage`.
 */
export async function fetchApiCorrectSkuClient(
  tenantId: string,
  skuId: string,
  clientId: string,
  idempotencyKey: string,
): Promise<SkuClientCorrectionResponse> {
  const { data, error } = await catalogControllerCorrectSkuClient({
    path: { tenantId, skuId },
    body: { clientId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Clients (story 21-2b) — the tenant's client brands. The list is a   */
/* member-open read (unpaginated, bounded at 500); create and rename   */
/* are owner-only (`clients.manage`).                                  */
/* ------------------------------------------------------------------ */

export async function fetchApiListClients(
  tenantId: string,
  options?: { signal?: AbortSignal },
): Promise<ClientListResponse> {
  const { data, error } = await clientsControllerListClients({
    path: { tenantId },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

export async function fetchApiCreateClient(
  tenantId: string,
  body: { code: string; name: string },
  idempotencyKey: string,
): Promise<ClientDto> {
  const { data, error } = await clientsControllerCreateClient({
    path: { tenantId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.client;
}

export async function fetchApiRenameClient(
  tenantId: string,
  clientId: string,
  name: string,
  idempotencyKey: string,
): Promise<ClientDto> {
  const { data, error } = await clientsControllerRenameClient({
    path: { tenantId, clientId },
    body: { name },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.client;
}

/* ------------------------------------------------------------------ */
/* Rate cards (story 21-3) — a client's versioned prices. Reads are    */
/* member-open; the mutations need `rates.manage` (owner + accountant). */
/* ------------------------------------------------------------------ */

/** A client's cards — drafts first, then by effective date descending. */
export async function fetchApiListRateCards(
  tenantId: string,
  clientId: string,
  options?: { signal?: AbortSignal },
): Promise<RateCardListResponse> {
  const { data, error } = await rateCardsControllerList({
    path: { tenantId, clientId },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * The client's card in force at `at` (default: the SERVER's now) — the
 * "In force" highlight reads this, never the browser clock. `rateCard` is
 * null when nothing is in force (the client is not billed then).
 */
export async function fetchApiRateCardInForce(
  tenantId: string,
  clientId: string,
  options?: { at?: string; signal?: AbortSignal },
): Promise<RateCardInForceResponse> {
  const { data, error } = await rateCardsControllerInForce({
    path: { tenantId, clientId },
    query: options?.at === undefined ? undefined : { at: options.at },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

export async function fetchApiCreateRateCard(
  tenantId: string,
  clientId: string,
  lines: readonly RateCardLineDto[],
  idempotencyKey: string,
): Promise<RateCardDto> {
  const { data, error } = await rateCardsControllerCreate({
    path: { tenantId, clientId },
    body: { lines: [...lines] },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.rateCard;
}

export async function fetchApiReplaceRateCardLines(
  tenantId: string,
  rateCardId: string,
  lines: readonly RateCardLineDto[],
  idempotencyKey: string,
): Promise<RateCardDto> {
  const { data, error } = await rateCardsControllerReplaceLines({
    path: { tenantId, rateCardId },
    body: { lines: [...lines] },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.rateCard;
}

export async function fetchApiActivateRateCard(
  tenantId: string,
  rateCardId: string,
  effectiveFrom: string,
  idempotencyKey: string,
): Promise<RateCardDto> {
  const { data, error } = await rateCardsControllerActivate({
    path: { tenantId, rateCardId },
    body: { effectiveFrom },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.rateCard;
}

export async function fetchApiCancelRateCard(
  tenantId: string,
  rateCardId: string,
  idempotencyKey: string,
): Promise<RateCardDto> {
  const { data, error } = await rateCardsControllerCancel({
    path: { tenantId, rateCardId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.rateCard;
}

/** Discards a draft (DELETE → 204, no body; only a problem payload is an error). */
export async function fetchApiDiscardRateCard(
  tenantId: string,
  rateCardId: string,
  idempotencyKey: string,
): Promise<void> {
  const { error } = await rateCardsControllerDiscard({
    path: { tenantId, rateCardId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error) {
    throw unwrapError(error, 400);
  }
}

/* ------------------------------------------------------------------ */
/* Products and kits (story 11-6) — the web variant/kit surfaces ride  */
/* the read endpoints the 11-3/11-4 stories shipped; only the writers  */
/* below are new to this app.                                          */
/* ------------------------------------------------------------------ */

/** The tenant's products — a read, open to any tenant member (11-3). */
export async function fetchApiListProducts(
  tenantId: string,
  options?: { cursor?: string; signal?: AbortSignal },
): Promise<ProductListResponse> {
  const { data, error } = await catalogControllerListProducts({
    path: { tenantId },
    query: options?.cursor === undefined ? undefined : { cursor: options.cursor },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Create a product — identity only (name + declared axes), gated `sku.edit`. */
export async function fetchApiCreateProduct(
  tenantId: string,
  body: CreateProductDto,
  idempotencyKey: string,
): Promise<ProductResponse> {
  const { data, error } = await catalogControllerCreateProduct({
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
 * Edit a product — the name is always editable; the axes only while no SKU
 * is attached (409 `product-has-variants`).
 */
export async function fetchApiEditProduct(
  tenantId: string,
  productId: string,
  body: PatchProductDto,
  idempotencyKey: string,
): Promise<ProductResponse> {
  const { data, error } = await catalogControllerEditProduct({
    path: { tenantId, productId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** The tenant's kits — SKUs carrying composition rows, with their BOMs (11-4). */
export async function fetchApiListKits(
  tenantId: string,
  options?: { cursor?: string; signal?: AbortSignal },
): Promise<KitListResponse> {
  const { data, error } = await catalogControllerListKits({
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
 * Make an existing SKU a kit — the only door into kit-ness. Quantities are
 * base-UoM decimals per component (the API converts to milli at the edge).
 */
export async function fetchApiCreateKit(
  tenantId: string,
  skuId: string,
  body: PutKitDto,
  idempotencyKey: string,
): Promise<KitResponse> {
  const { data, error } = await catalogControllerCreateKit({
    path: { tenantId, skuId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Replace an existing kit's whole composition (PUT — the BOM is a set). */
export async function fetchApiReplaceKit(
  tenantId: string,
  skuId: string,
  body: PutKitDto,
  idempotencyKey: string,
): Promise<KitResponse> {
  const { data, error } = await catalogControllerReplaceKit({
    path: { tenantId, skuId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * The hazard segregation matrix (story 12-7) — an ungated read (any member)
 * returning the server's own predicate as data: the class vocabulary plus
 * every incompatible unordered pair, fully expanded, so the FE renders
 * `compatible(a, b) = !incompatible.includes(pair)` with zero logic of its
 * own and nothing hardcoded to drift.
 */
export async function fetchApiGetSegregationMatrix(tenantId: string): Promise<SegregationMatrixResponse> {
  const { data, error } = await catalogControllerGetSegregationMatrix({
    path: { tenantId },
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

/**
 * Packs a fully-picked accepted order at the bench (capability `pack.execute`,
 * story 4.5). The scan is verified against what was actually PICKED — never
 * what was ordered — so a short-picked order packs with fewer units, and a
 * discrepancy is refused 422 `pack-mismatch` naming every divergent SKU with
 * BOTH quantities. Nothing is written on any refusal arm. The 201 carries the
 * packing slip, which is also the idempotency snapshot: a replay (same key,
 * same payload) re-serves it byte-for-byte.
 */
export async function fetchApiPackOrder(
  tenantId: string,
  orderId: string,
  body: PackOrderDto,
  idempotencyKey: string,
): Promise<PackResponse> {
  const { data, error } = await outboundControllerPackOrder({
    path: { tenantId, orderId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Dispatches a packed order (capability `dispatch.execute`, story 4.6) — the
 * TERMINAL transition of the order state machine: every committed reservation
 * the order still owns is retired, which is the ATP correction, and there is
 * no un-dispatch. The body is optional and empty means complete: carrier and
 * tracking are optional free text, and a blank string is treated as absent by
 * the backend.
 */
export async function fetchApiDispatchOrder(
  tenantId: string,
  orderId: string,
  body: DispatchOrderDto,
  idempotencyKey: string,
): Promise<DispatchResponse> {
  const { data, error } = await outboundControllerDispatchOrder({
    path: { tenantId, orderId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Labels, shipments and manifests (story 4.6c)                        */
/* ------------------------------------------------------------------ */

/**
 * The tenant's carrier connections (story 4.6b's read, consumed by 4.6c's
 * label form picker). Each row carries the display name and the account
 * label — everything the label form's picker states; the credential material
 * itself is never in a response.
 */
export async function fetchApiListConnections(
  tenantId: string,
  options?: { cursor?: string; limit?: number; signal?: AbortSignal },
): Promise<CarrierConnectionListResponse> {
  const { data, error } = await carriersControllerListConnections({
    path: { tenantId },
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
 * Generates a label for a packed order through a carrier connection
 * (capability `labels.execute`, story 4.6c) — one labelled shipment per
 * order, ever. The adapter's failure arms are REFUSALS, not errors: a 501
 * `carrier-transport-unconfigured` (a DIRECT carrier with no transport on
 * this deployment) and a 503 `carrier-encryption-unavailable` write nothing
 * and leave the order labellable, so the UI retry is a fresh submit.
 */
export async function fetchApiLabelOrder(
  tenantId: string,
  orderId: string,
  body: LabelOrderDto,
  idempotencyKey: string,
): Promise<ShipmentResponse> {
  const { data, error } = await outboundControllerLabelOrder({
    path: { tenantId, orderId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Closes a set of labelled shipments onto ONE carrier connection as a
 * manifest (capability `labels.execute`, story 4.6c) — terminal, with no
 * un-manifest. The body names shipment ids; duplicates collapse and order
 * is irrelevant (the set is the intent).
 */
export async function fetchApiCreateManifest(
  tenantId: string,
  warehouseId: string,
  body: CreateManifestDto,
  idempotencyKey: string,
): Promise<ManifestResponse> {
  const { data, error } = await outboundControllerCreateManifest({
    path: { tenantId, warehouseId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * The order's shipment read-back (story 4.6c) — null when the order has no
 * label yet. The route answers 404 in that case; the caller treats a 404
 * `not-found` as "no shipment yet" rather than a failed read.
 */
export async function fetchApiGetShipment(
  tenantId: string,
  orderId: string,
  options?: { signal?: AbortSignal },
): Promise<ShipmentResponse | null> {
  const { data, error } = await outboundControllerGetShipment({
    path: { tenantId, orderId },
    signal: options?.signal,
  });
  if (error || !data) {
    if (isProblemDetails(error) && error.code === 'not-found' && error.status === 404) {
      return null;
    }
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * The order's carrier rate shopping read (story 4.6d) — one quoted-or-refused
 * item per live carrier connection, sorted by carrierCode. A READ: no
 * idempotency key, no capability, nothing stored, recomputed per request. A
 * 404 means the order does not exist in this tenant (unknown or foreign) and
 * the caller renders "no order" rather than a failed read.
 */
export async function fetchApiGetOrderRates(
  tenantId: string,
  orderId: string,
  options?: { signal?: AbortSignal },
): Promise<OrderRatesResponse | null> {
  const { data, error } = await outboundControllerGetOrderRates({
    path: { tenantId, orderId },
    signal: options?.signal,
  });
  if (error || !data) {
    if (isProblemDetails(error) && error.code === 'not-found' && error.status === 404) {
      return null;
    }
    throw unwrapError(error, 400);
  }
  return data;
}

/** One warehouse's manifest page, newest first (keyset cursor pagination). */
export async function fetchApiListManifests(
  tenantId: string,
  warehouseId: string,
  options?: { cursor?: string; limit?: number; signal?: AbortSignal },
): Promise<ManifestListResponse> {
  const { data, error } = await outboundControllerListManifests({
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
 * The temperature excursion review queue (story 12-5, surfaced by 12-7) —
 * warehouse- and status-filterable, open to any member. Same query-shape as
 * the over-receipt queue read: a first page with no filters sends no query.
 */
export async function fetchApiListExcursions(
  tenantId: string,
  options?: {
    warehouseId?: string;
    status?: 'open' | 'resolved';
    cursor?: string;
    signal?: AbortSignal;
  },
): Promise<ExcursionListResponse> {
  const { data, error } = await complianceControllerListExcursions({
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

/** Resolves an excursion (capability `review.decide`) — the review-status flip only. */
export async function fetchApiResolveExcursion(
  tenantId: string,
  excursionId: string,
  idempotencyKey: string,
): Promise<ExcursionResponse> {
  const { data, error } = await complianceControllerResolveExcursion({
    path: { tenantId, excursionId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * The tenant's GST invoices (story 8-1), newest first — header rows only (no
 * lines, no document). Open to any member. A first page sends no query.
 */
export async function fetchApiListInvoices(
  tenantId: string,
  options?: { cursor?: string; signal?: AbortSignal },
): Promise<InvoiceListResponse> {
  const { data, error } = await invoicingControllerListInvoices({
    path: { tenantId },
    query: options?.cursor === undefined ? undefined : { cursor: options.cursor },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** One invoice's detail: the row, its priced lines and the document snapshot. */
export async function fetchApiGetInvoice(
  tenantId: string,
  invoiceId: string,
  options?: { signal?: AbortSignal },
): Promise<InvoiceResponse> {
  const { data, error } = await invoicingControllerGetInvoice({
    path: { tenantId, invoiceId },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * The HSN summary (story 8-2a) of one supplier GSTIN for one period — a month
 * `YYYY-MM` or an FY quarter `FY-yyyy-Qn`. Open to any member; both query
 * parameters are required (400 validation-failed otherwise).
 */
export async function fetchApiHsnSummary(
  tenantId: string,
  query: { gstin: string; period: string },
  options?: { signal?: AbortSignal },
): Promise<HsnSummaryResponse> {
  const { data, error } = await invoicingControllerHsnSummary({
    path: { tenantId },
    query: { gstin: query.gstin, period: query.period },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Every supplier GSTIN with issued invoices, with its first/last issue instant (story 8-2a). */
export async function fetchApiHsnSummaryGstins(
  tenantId: string,
  options?: { signal?: AbortSignal },
): Promise<HsnSummaryGstinsResponse> {
  const { data, error } = await invoicingControllerHsnSummaryGstins({
    path: { tenantId },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Generates or re-derives a dispatched order's ONE invoice (capability
 * `invoice.generate`). `rates` prices UNPRICED lines only — the backend
 * refuses an override on an acceptance-priced line (409
 * line-already-priced). Answers 200 with the invoice as it stands.
 */
export async function fetchApiGenerateInvoice(
  tenantId: string,
  body: GenerateInvoiceDto,
  idempotencyKey: string,
): Promise<InvoiceResponse> {
  const { data, error } = await invoicingControllerGenerateInvoice({
    path: { tenantId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

// ── e-way bills (story 8-2b) ─────────────────────────────────────────────────

export interface EwayBillListOptions {
  status?: 'pending' | 'generated' | 'dismissed';
  gstin?: string;
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}

/**
 * One page of e-way bills, newest first (open to any member). Only the
 * filters the caller set ride the query — a first page with no filter sends
 * no query at all.
 */
export async function fetchApiListEwayBills(tenantId: string, options: EwayBillListOptions = {}): Promise<EwayBillListResponse> {
  const query: NonNullable<Parameters<typeof ewayControllerListBills>[0]['query']> = {};
  if (options.status !== undefined) query.status = options.status;
  if (options.gstin !== undefined) query.gstin = options.gstin;
  if (options.cursor !== undefined) query.cursor = options.cursor;
  if (options.limit !== undefined) query.limit = options.limit;
  const { data, error } = await ewayControllerListBills({
    path: { tenantId },
    query: Object.keys(query).length === 0 ? undefined : query,
    signal: options.signal,
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/**
 * The NIC bulk-upload JSON over ready pending bills of ONE GSTIN
 * (`eway.manage`). All or nothing: a 409 `eway-not-exportable` carries
 * `bills: [{id, reasons}]` in `ApiProblem.extensions`.
 */
export async function fetchApiExportEwayBills(tenantId: string, ids: readonly string[], idempotencyKey: string): Promise<EwayExportResponse> {
  const { data, error } = await ewayControllerExportBills({
    path: { tenantId },
    body: { ids: [...ids] },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Replaces a pending bill's whole Part B (`eway.manage`); an absent field clears it. */
export async function fetchApiUpdateEwayTransport(
  tenantId: string,
  billId: string,
  body: UpdateEwayTransportDto,
  idempotencyKey: string,
): Promise<EwayBillResponse> {
  const { data, error } = await ewayControllerUpdateTransport({
    path: { tenantId, billId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Records the EWB number the portal returned (`eway.manage`) — final. */
export async function fetchApiRecordEwayBill(
  tenantId: string,
  billId: string,
  body: RecordEwayDto,
  idempotencyKey: string,
): Promise<EwayBillResponse> {
  const { data, error } = await ewayControllerRecord({
    path: { tenantId, billId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Dismisses a pending bill with a reason (`eway.manage`). */
export async function fetchApiDismissEwayBill(
  tenantId: string,
  billId: string,
  reason: string,
  idempotencyKey: string,
): Promise<EwayBillResponse> {
  const { data, error } = await ewayControllerDismiss({
    path: { tenantId, billId },
    body: { reason },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Generates a ready bill through the configured gateway (`eway.manage`) — no body. */
export async function fetchApiGenerateEwayBill(tenantId: string, billId: string, idempotencyKey: string): Promise<EwayBillResponse> {
  const { data, error } = await ewayControllerGenerate({
    path: { tenantId, billId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** The tenant's intra-state threshold overrides — the full append-only history. */
export async function fetchApiListEwayStateThresholds(
  tenantId: string,
  options?: { signal?: AbortSignal },
): Promise<EwayStateThresholdListResponse> {
  const { data, error } = await ewayControllerListStateThresholds({ path: { tenantId }, signal: options?.signal });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Appends an intra-state threshold override (`eway.configure`, owner). Answers 201. */
export async function fetchApiAppendEwayStateThreshold(
  tenantId: string,
  body: AppendEwayStateThresholdDto,
  idempotencyKey: string,
): Promise<EwayStateThresholdResponse> {
  const { data, error } = await ewayControllerAppendStateThreshold({
    path: { tenantId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** The e-way settings of every GSTIN the tenant holds. */
export async function fetchApiListEwayGstinSettings(
  tenantId: string,
  options?: { signal?: AbortSignal },
): Promise<EwayGstinSettingListResponse> {
  const { data, error } = await ewayControllerListGstinSettings({ path: { tenantId }, signal: options?.signal });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Sets whether e-invoicing applies to one of the tenant's GSTINs (`eway.configure`, owner). */
export async function fetchApiPutEwayGstinSetting(
  tenantId: string,
  gstin: string,
  eInvoiceApplies: boolean,
  idempotencyKey: string,
): Promise<EwayGstinSettingResponse> {
  const { data, error } = await ewayControllerPutGstinSetting({
    path: { tenantId, gstin },
    body: { eInvoiceApplies },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/**
 * One dispatched order's cold-chain trace (FR-45, story 12-6) — reconstructed
 * from the ledger alone: per order line, every picked scope's complete
 * batch/serial chain annotated with each bin's CURRENT storage class, plus
 * the dwell-window-correlated excursions.
 */
export async function fetchApiGetOrderColdChainTrace(
  tenantId: string,
  warehouseId: string,
  orderId: string,
): Promise<ColdChainTraceResponse> {
  const { data, error } = await complianceControllerGetOrderColdChainTrace({
    path: { tenantId, warehouseId, orderId },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * The count-variance review queue (stories 5-4/5-5): the tenant's variances
 * keyed on (createdAt, id), newest first, status- and warehouse-filterable. A
 * read, never capability-gated — the deciding MUTATION is `variances.resolve`.
 * Same query-shape as the excursion queue read: a first page with no filters
 * sends no query.
 */
export async function fetchApiListVariances(
  tenantId: string,
  options?: {
    status?: 'open' | 'adjusted' | 'recounted';
    warehouseId?: string;
    cursor?: string;
    signal?: AbortSignal;
  },
): Promise<CountVarianceListResponse> {
  const { data, error } = await movementsControllerListCountVariances({
    path: { tenantId },
    query:
      options?.status === undefined &&
      options?.warehouseId === undefined &&
      options?.cursor === undefined
        ? undefined
        : {
            ...(options.status === undefined ? {} : { status: options.status }),
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

/**
 * Resolves a count variance (capability `variances.resolve`). The body arms:
 * `{decision:'approve_adjust', consideredEventSeqs}` — the consulted ledger
 * seqs the approver ticked, non-empty and ≤ 200 on the approve arm; or
 * `{decision:'recount'}`, no seqs required. Every click carries a fresh
 * ULID, so a double click replays, never duplicates.
 */
export async function fetchApiResolveVariance(
  tenantId: string,
  varianceId: string,
  body: ResolveCountVarianceDto,
  idempotencyKey: string,
): Promise<ResolveCountVarianceResponse> {
  const { data, error } = await movementsControllerResolveCountVariance({
    path: { tenantId, varianceId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * The rejected-ops review queue (story 5-6): the terminal device ops a
 * device's replay ended on without landing — refused outright (`rejected`)
 * or held as an AD-14 quarantine resident (`quarantined`) — uploaded
 * AUDIT-ONLY by the device's sync report. Keyset cursor pagination,
 * status-filterable; the deciding MUTATION is `review.decide`. Same
 * query-shape as the variance queue read: a first page with no filters
 * sends no query.
 */
export async function fetchApiListRejectedOps(
  tenantId: string,
  options?: {
    status?: 'open' | 'applied' | 'recounted' | 'discarded';
    cursor?: string;
    signal?: AbortSignal;
  },
): Promise<RejectedOpListResponse> {
  const { data, error } = await devicesControllerListRejectedOps({
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

/**
 * Resolves a rejected op (capability `review.decide`) — one of three arms:
 * `{decision:'apply'}` re-executes the op against every live guard (never a
 * force-write: binStateEpoch is stripped server-side and every refusal is
 * answered verbatim with the row still open); `{decision:'recount'}` re-plans
 * the bin (the payload must name one, or the server refuses 400); or
 * `{decision:'discard'}` retires the row with a marker. Every click carries
 * a fresh ULID, so a double click replays, never duplicates.
 */
export async function fetchApiResolveRejectedOp(
  tenantId: string,
  rejectedOpId: string,
  body: ResolveRejectedOpDto,
  idempotencyKey: string,
): Promise<RejectedOpResolveResponse> {
  const { data, error } = await devicesControllerResolveRejectedOp({
    path: { tenantId, rejectedOpId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * The 5-2 adjustment-approval queue — pendings whose |delta| exceeded the
 * tenant's threshold, keyset cursor pagination, status-filterable. A read,
 * never capability-gated.
 */
export async function fetchApiListAdjustmentPendings(
  tenantId: string,
  options?: {
    status?: 'pending' | 'approved' | 'rejected';
    cursor?: string;
    signal?: AbortSignal;
  },
): Promise<AdjustmentPendingListResponse> {
  const { data, error } = await inventoryControllerListAdjustmentPendings({
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

/**
 * Approves a pending adjustment (capability `adjustments.approve`) — the
 * stored arms re-execute through the full guard set; a moved world answers
 * the guard's 400/409/422 verbatim and the row stays pending.
 */
export async function fetchApiApproveAdjustmentPending(
  tenantId: string,
  pendingId: string,
  idempotencyKey: string,
): Promise<AdjustmentDecisionResponse> {
  const { data, error } = await inventoryControllerApproveAdjustment({
    path: { tenantId, pendingId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Rejects a pending adjustment (capability `adjustments.approve`) — the
 * same decide contract, reject arm: status flip only, no stock write.
 */
export async function fetchApiRejectAdjustmentPending(
  tenantId: string,
  pendingId: string,
  idempotencyKey: string,
): Promise<AdjustmentDecisionResponse> {
  const { data, error } = await inventoryControllerRejectAdjustment({
    path: { tenantId, pendingId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * One warehouse's ledger timeline (story 2.4's read), newest first, keyset —
 * narrowed to a bin's events (`fromBin == bin || toBin == bin`) for the
 * variance-review ledger panel (story 5-5): the history the approver consults
 * before an approve-adjust correction.
 */
export async function fetchApiListLedgerEvents(
  tenantId: string,
  warehouseId: string,
  options?: {
    binId?: string;
    cursor?: string;
    signal?: AbortSignal;
  },
): Promise<LedgerEventListResponse> {
  const { data, error } = await inventoryControllerListEvents({
    path: { tenantId, warehouseId },
    query:
      options?.binId === undefined && options?.cursor === undefined
        ? undefined
        : {
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

/* ------------------------------------------------------------------ */
/* Replenishment (story 6-1) — policies, breaches, suggested POs        */
/* ------------------------------------------------------------------ */

/**
 * Lists reorder override policies (a read, open to any member) — one page of
 * the tenant's per-warehouse overrides, newest first, filterable to one
 * warehouse and/or SKU. A first read with no filters sends no query.
 */
export async function fetchApiListReorderPolicies(
  tenantId: string,
  options?: {
    warehouseId?: string;
    skuId?: string;
    cursor?: string;
    signal?: AbortSignal;
  },
): Promise<ReorderPolicyListResponse> {
  const { data, error } = await replenishmentControllerListReorderPolicies({
    path: { tenantId },
    query:
      options?.warehouseId === undefined &&
      options?.skuId === undefined &&
      options?.cursor === undefined
        ? undefined
        : {
            ...(options.warehouseId === undefined ? {} : { warehouseId: options.warehouseId }),
            ...(options.skuId === undefined ? {} : { skuId: options.skuId }),
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
 * Upserts one per-warehouse reorder-point override (capability
 * `replenishment.manage`) — last-write-wins against the
 * `(tenant, warehouse, sku)` unique. `reorderPoint`/`reorderQty` are
 * MILLI-units (base UoM × 10³) on this module's wire, strictly positive.
 * Arms: 400 validation-failed naming the offending field; 403 role-denied
 * (or a foreign session); 404 the warehouse or SKU is unknown/foreign;
 * 409 conflict on a concurrent upsert of the same (warehouse, sku) or a
 * concurrent idempotent request; 422 idempotency-key-reuse on a reused key
 * with a different payload.
 */
export async function fetchApiUpsertReorderPolicy(
  tenantId: string,
  body: UpsertReorderPolicyDto,
  idempotencyKey: string,
): Promise<ReorderPolicyResponse> {
  const { data, error } = await replenishmentControllerUpsertReorderPolicy({
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
 * Deletes one per-warehouse reorder override (capability
 * `replenishment.manage`) — the SKU-column default resumes as the effective
 * point. The delete carries no body; the 404 covers an already-removed row.
 */
export async function fetchApiDeleteReorderPolicy(
  tenantId: string,
  policyId: string,
  idempotencyKey: string,
): Promise<ReorderPolicyResponse> {
  const { data, error } = await replenishmentControllerDeleteReorderPolicy({
    path: { tenantId, policyId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Lists reorder breaches (the alert queue read, open to any member),
 * status-filterable (the tabs) and to one warehouse. A first page with no
 * filters sends no query.
 */
export async function fetchApiListBreaches(
  tenantId: string,
  options?: {
    status?: 'open' | 'recovered' | 'actioned' | 'dismissed';
    warehouseId?: string;
    cursor?: string;
    signal?: AbortSignal;
  },
): Promise<BreachListResponse> {
  const { data, error } = await replenishmentControllerListBreaches({
    path: { tenantId },
    query:
      options?.status === undefined &&
      options?.warehouseId === undefined &&
      options?.cursor === undefined
        ? undefined
        : {
            ...(options.status === undefined ? {} : { status: options.status }),
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

/**
 * Dismisses an OPEN breach (capability `replenishment.manage`) — human
 * dismissal (`dismissed`); its suggested-PO draft stays a draft. A 409
 * means the breach left `open` state in between (recovered by a sweep,
 * actioned by a submit) — cause invisible client-side, so the server's
 * words render. The body is empty.
 */
export async function fetchApiDismissBreach(
  tenantId: string,
  breachId: string,
  idempotencyKey: string,
): Promise<BreachResponse> {
  const { data, error } = await replenishmentControllerDismissBreach({
    path: { tenantId, breachId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Lists suggested POs (the draft queue read, open to any member),
 * status-filterable (the tabs) and to one warehouse. A first page with no
 * filters sends no query.
 */
export async function fetchApiListSuggestedPos(
  tenantId: string,
  options?: {
    status?: 'draft' | 'submitted' | 'dismissed';
    warehouseId?: string;
    cursor?: string;
    signal?: AbortSignal;
  },
): Promise<SuggestedPoListResponse> {
  const { data, error } = await replenishmentControllerListSuggestedPos({
    path: { tenantId },
    query:
      options?.status === undefined &&
      options?.warehouseId === undefined &&
      options?.cursor === undefined
        ? undefined
        : {
            ...(options.status === undefined ? {} : { status: options.status }),
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

/**
 * Submits a DRAFT suggested PO as a REAL purchase order (capability
 * `replenishment.manage` — the mint itself re-executes the inbound PO
 * command under `po.manage` server-side). Edits are optional: vendorId
 * and/or quantityMilli (MILLI-units), omitted keys keep the draft's value.
 * The response carrier is FLAT — `purchaseOrder` IS the minted PO
 * (`{id, code, …, lines…}`), never a wrapped `{purchaseOrder: {…}}`
 * snapshot; the success sentence reads the code off it directly.
 *
 * A 409 is either `suggested-po-submitted` (already submitted — the queue
 * recovers by reload) or the inner PO command's re-execution refusing
 * guard-class (the vendor or SKU moved; the draft stays a draft). The
 * cause is invisible in every DTO this client holds, so 409s render the
 * server's words.
 */
export async function fetchApiSubmitSuggestedPo(
  tenantId: string,
  draftId: string,
  body: SubmitSuggestedPoDto,
  idempotencyKey: string,
): Promise<SubmitSuggestedPoResponse> {
  const { data, error } = await replenishmentControllerSubmitSuggestedPo({
    path: { tenantId, draftId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * The tenant's expiry/aging alert config read-back (an ungated read): null
 * when no config row exists, which is the DISABLE mechanism — an absent row
 * means the scan evaluates nothing for the tenant, so the panel renders
 * "alerts are off" rather than a failed read.
 *
 * Arms: 200 `{expiryPolicy}` with the last-write snapshot; 404 `not-found`
 * → null (the disabled convention); 401 unauth / 403 foreign session →
 * thrown as usual. No 403 role arm — the read is open to every member.
 */
export async function fetchApiGetExpiryPolicy(
  tenantId: string,
  options?: { signal?: AbortSignal },
): Promise<ExpiryPolicyResponse | null> {
  const { data, error } = await replenishmentControllerGetExpiryPolicy({
    path: { tenantId },
    signal: options?.signal,
  });
  if (error || !data) {
    if (isProblemDetails(error) && error.code === 'not-found' && error.status === 404) {
      return null;
    }
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Lists the tenant's batch alerts (the expiry/aging queue read, open to any
 * member), kind-/status-/warehouse-filterable with keyset cursor pagination;
 * each row carries its LIVE on-hand (`onHandMilli`, re-read at read time).
 * A first page with no filters sends no query.
 *
 * Arms: 400 `invalid-cursor` on a stale/malformed cursor (validation-failed
 * naming `cursor` lands in the same mapper), `limit`/`kind`/`status`
 * validation otherwise; 404 `not-found` on a foreign warehouse filter; the
 * list read has no capability arm.
 */
export async function fetchApiListBatchAlerts(
  tenantId: string,
  options?: {
    kind?: 'expiry_upcoming' | 'aged';
    status?: 'open' | 'resolved' | 'dismissed';
    warehouseId?: string;
    cursor?: string;
    signal?: AbortSignal;
  },
): Promise<BatchAlertListResponse> {
  const { data, error } = await replenishmentControllerListBatchAlerts({
    path: { tenantId },
    query:
      options?.kind === undefined &&
      options?.status === undefined &&
      options?.warehouseId === undefined &&
      options?.cursor === undefined
        ? undefined
        : {
            ...(options.kind === undefined ? {} : { kind: options.kind }),
            ...(options.status === undefined ? {} : { status: options.status }),
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

/**
 * Dismisses an OPEN batch alert (capability `replenishment.manage`) —
 * `open → dismissed`, the dismisser stamped; no stock-side effect (the
 * alert is evidence). A 409 `batch-alert-not-open` means the alert left
 * `open` state in between (auto-resolved by a scan, dismissed in another
 * tab) — cause invisible client-side, so the server's words render. The
 * body is empty.
 */
export async function fetchApiDismissBatchAlert(
  tenantId: string,
  alertId: string,
  idempotencyKey: string,
): Promise<BatchAlertResponse> {
  const { data, error } = await replenishmentControllerDismissBatchAlert({
    path: { tenantId, alertId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * One batch's detail read (the panel's click-through target): identity,
 * expiry/mfg dates, lifecycle status, per-bin on-hand rows, and the full
 * movement history. Unknown or foreign batch → 404, thrown (the caller
 * renders the failed arm — unlike the expiry-policy read, a missing
 * batch here is an error, not a "none yet" state).
 */
export async function fetchApiGetBatch(
  tenantId: string,
  batchId: string,
  options?: { signal?: AbortSignal },
): Promise<BatchDetailResponse> {
  const { data, error } = await inventoryControllerGetBatch({
    path: { tenantId, batchId },
    signal: options?.signal,
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

// ── Channels (story 7-1) ────────────────────────────────────────────────────

/**
 * Lists the tenant's channel connections with their sync health (story 7-1) —
 * public faces only, never credential material. Open to every member
 * server-side (the repo rule: reads ungated; the mutations carry
 * `channel.manage`).
 */
export async function fetchApiListChannelConnections(
  tenantId: string,
  options?: { signal?: AbortSignal },
): Promise<ChannelConnectionsResponse> {
  const { data, error } = await channelsControllerListConnections({
    path: { tenantId },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Connects a sales channel (capability `channel.manage`, story 7-1): the
 * provider-shaped credential material is sealed under CHANNEL_ENCRYPTION_KEY
 * and NEVER returned — the snapshot is the connection's public face.
 */
export async function fetchApiConnectChannel(
  tenantId: string,
  body: ConnectChannelDto,
  idempotencyKey: string,
): Promise<ChannelConnectionResponse> {
  const { data, error } = await channelsControllerConnect({
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
 * Rotates a connection's credential in place (capability `channel.manage`) —
 * same id, the version bumped, the old sealed blob replaced.
 */
export async function fetchApiRotateChannelCredentials(
  tenantId: string,
  connectionId: string,
  body: RotateChannelCredentialDto,
  idempotencyKey: string,
): Promise<ChannelConnectionResponse> {
  const { data, error } = await channelsControllerRotateCredentials({
    path: { tenantId, connectionId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Sets a connection's backorder policy (capability `channel.manage`) —
 * stored now, consumed by 7-2's ingestion acceptance.
 */
export async function fetchApiUpdateChannelConnectionConfig(
  tenantId: string,
  connectionId: string,
  body: UpdateConnectionConfigDto,
  idempotencyKey: string,
): Promise<ChannelConnectionResponse> {
  const { data, error } = await channelsControllerUpdateConnectionConfig({
    path: { tenantId, connectionId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Places / adjusts / clears a connection's standing buffers per item
 * (capability `channel.manage`) — the per-item verdicts are the answer;
 * a `refused` item carries the server's own words (`buffer-over-ceiling`,
 * the pool figure) and the OLD buffer still stands.
 */
export async function fetchApiSetChannelBuffers(
  tenantId: string,
  connectionId: string,
  body: SetChannelBuffersDto,
  idempotencyKey: string,
): Promise<ChannelBuffersSetResponse> {
  const { data, error } = await channelsControllerSetConnectionBuffers({
    path: { tenantId, connectionId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Reads a connection's SKU mappings (story 7-2, capability `channel.manage`
 * — channel settings are NOT available to operators, pinned bl-21).
 */
export async function fetchApiListConnectionMappings(
  tenantId: string,
  connectionId: string,
): Promise<ChannelConnectionMappingsResponse> {
  const { data, error } = await channelsControllerListConnectionMappings({
    path: { tenantId, connectionId },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Replaces a connection's SKU mappings FULLY (story 7-2, capability
 * `channel.manage`) — rows absent from the list are removed; the publish
 * scope ceiling (skuCount × activeWarehouses) is validated server-side and
 * its 400 names the arithmetic.
 */
export async function fetchApiSetConnectionMappings(
  tenantId: string,
  connectionId: string,
  body: SetChannelMappingsDto,
  idempotencyKey: string,
): Promise<ChannelConnectionMappingsResponse> {
  const { data, error } = await channelsControllerSetConnectionMappings({
    path: { tenantId, connectionId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Disconnects a channel (capability `channel.manage`, DELETE): a hard
 * delete — the sealed material is gone, its standing buffers release, its
 * mappings drop. The 204 has no body the unwrap would have called `!data`;
 * only a problem payload is an error here.
 */
export async function fetchApiDisconnectChannel(
  tenantId: string,
  connectionId: string,
  idempotencyKey: string,
): Promise<void> {
  const { error } = await channelsControllerDisconnect({
    path: { tenantId, connectionId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error) {
    throw unwrapError(error, 400);
  }
}

/**
 * Retries a stalled connection (capability `channel.manage`) — re-appends
 * the availability snapshot through the outbox and half-opens the breaker.
 */
export async function fetchApiRetryChannelConnection(
  tenantId: string,
  connectionId: string,
  idempotencyKey: string,
): Promise<ChannelConnectionResponse> {
  const { data, error } = await channelsControllerRetryConnection({
    path: { tenantId, connectionId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}
