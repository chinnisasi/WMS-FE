import { client } from './generated/client.gen';
import {
  catalogControllerCorrectSkuClient,
  clientsControllerCreateClient,
  clientsControllerListClients,
  clientsControllerRenameClient,
  catalogControllerCreateKit,
  catalogControllerCreateProduct,
  catalogControllerCreateSku,
  catalogControllerEditProduct,
  catalogControllerEditSku,
  catalogControllerGetSegregationMatrix,
  catalogControllerImportCatalog,
  catalogControllerListKits,
  catalogControllerListProducts,
  catalogControllerListSkus,
  catalogControllerReplaceKit,
  catalogControllerReplacePackaging,
  catalogControllerUpdateSkuStatus,
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
  licencesControllerAdd,
  licencesControllerCoverage,
  licencesControllerEdit,
  licencesControllerGetPolicy,
  licencesControllerSetPolicy,
  licencesControllerList,
  licencesControllerWithdraw,
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
  devicesControllerReleaseDevice,
  devicesControllerUnlockDevice,
  healthControllerHealth,
  inboundControllerAmendAsn,
  inboundControllerCancelAsn,
  inboundControllerCloseAsn,
  inboundControllerCreateAsn,
  inboundControllerCreatePurchaseOrder,
  gateInControllerAmend,
  gateInControllerCreate,
  gateInControllerGateOut,
  gateInControllerGet,
  gateInControllerList,
  gateInControllerUnloadWeb,
  inboundControllerImportAsns,
  outboundControllerImportOrders,
  inboundControllerGetAsn,
  inboundControllerGetPurchaseOrder,
  inboundControllerListAsns,
  inboundControllerListPurchaseOrders,
  inventoryControllerAdjustStock,
  inventoryControllerApproveAdjustment,
  partnersControllerCreatePartner,
  partnersControllerCreatePartnerLink,
  partnersControllerListPartners,
  partnersControllerUpdatePartner,
  partnersControllerUpdatePartnerLink,
  partnersControllerUpdatePartnerStatus,
  inventoryControllerGetBatch,
  inventoryControllerListAdjustmentPendings,
  inventoryControllerListBatches,
  inventoryControllerBlockBatch,
  inventoryControllerUnblockBatch,
  inventoryControllerListEvents,
  inventoryControllerListStock,
  inventoryControllerRejectAdjustment,
  movementsControllerCreateCount,
  movementsControllerDeleteCountPolicy,
  movementsControllerCancelCountTask,
  movementsControllerStartStockTake,
  movementsControllerListStockTakes,
  movementsControllerGetStockTake,
  movementsControllerListStockTakeVariances,
  movementsControllerDownloadStockTakeReport,
  movementsControllerRecountStockTakeBins,
  movementsControllerCloseStockTake,
  movementsControllerAbandonStockTake,
  movementsControllerGetCountPolicies,
  movementsControllerGetCountTask,
  movementsControllerListCountTasks,
  movementsControllerListCountVariances,
  movementsControllerMoveStock,
  movementsControllerResolveCountVariance,
  movementsControllerUpsertCountPolicies,
  outboundControllerAllocateOrder,
  outboundControllerCancelOrder,
  outboundControllerCancelOrderWithRestock,
  outboundControllerGetRestockPlan,
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
  receivingControllerGetQcHold,
  receivingControllerInspectQcHold,
  receivingControllerListGoodsReceiptLines,
  receivingControllerListLpns,
  receivingControllerMintLpns,
  receivingControllerPrintLpnLabels,
  receivingControllerVoidLpn,
  receivingControllerListReceiptPhotos,
  receivingControllerAddReceiptPhoto,
  receivingControllerRemoveReceiptPhoto,
  receivingControllerListGoodsReceipts,
  receivingControllerListOverReceipts,
  receivingControllerListQcHolds,
  receivingControllerPlaceQcHold,
  receivingControllerReleaseQcHold,
  receivingControllerReleaseReceiptHolds,
  vendorReturnsControllerCancel,
  vendorReturnsControllerCreate,
  vendorReturnsControllerDispatch,
  vendorReturnsControllerGet,
  vendorReturnsControllerList,
  vendorReturnsControllerReturnable,
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
  tenancyControllerPrintBinLabels,
  tenancyControllerListWarehouses,
  tenancyControllerListZones,
  tenancyControllerMergeBin,
  tenancyControllerRegister,
  tenancyControllerSetBinBlocked,
  tenancyControllerBlockBin,
  tenancyControllerUnblockBin,
  tenancyControllerBinBlockImpact,
  tenancyControllerRetireBin,
  tenancyControllerSetupChecklist,
  tenancyControllerSignIn,
  tenancyControllerSignInSecondFactor,
  tenancyControllerRequestPasswordReset,
  tenancyControllerCheckPasswordReset,
  tenancyControllerConfirmPasswordReset,
  usersControllerAcceptInvite,
  usersControllerInviteUser,
  usersControllerListUsers,
  usersControllerMe,
  usersControllerSetUserRole,
  usersControllerDeactivateUser,
  usersControllerReactivateUser,
  usersControllerUnlockUser,
  usersControllerResendInvite,
  usersControllerResetSecondFactor,
  usersControllerSecondFactorBackupCodes,
  usersControllerSecondFactorConfirm,
  usersControllerSecondFactorDisable,
  usersControllerSecondFactorSetup,
  usersControllerSecondFactorStatus,
  reportingControllerOverview,
  notificationsControllerList,
  notificationsControllerStatus,
  notificationsControllerOpened,
  rateCardsControllerActivate,
  rateCardsControllerCancel,
  rateCardsControllerCreate,
  rateCardsControllerDiscard,
  rateCardsControllerInForce,
  billingUsageControllerUsage,
  reportingControllerAudit,
  reportingControllerDownloadAuditExport,
  reportingControllerDownloadRegister,
  inventoryControllerAcknowledgeChainBreak,
  inventoryControllerLedgerAnchors,
  inventoryControllerLedgerIntegrity,
  inventoryControllerLedgerProof,
  reportingControllerListAuditExports,
  reportingControllerRequestAuditExport,
  reportingControllerClientService,
  portalControllerService,
  rateCardsControllerList,
  rateCardsControllerReplaceLines,
  clientsControllerUpdateClientStatus,
  clientsControllerUpdateTaxDetails,
  clientsControllerUpdateAddresses,
  clientsControllerGetReceivingPolicy,
  clientsControllerUpdateReceivingPolicy,
  clientsControllerGetAllocationPolicy,
  clientsControllerUpdateAllocationPolicy,
  clientsControllerListContacts,
  clientsControllerAddContact,
  clientsControllerEditContact,
  clientsControllerRemoveContact,
  clientWebhooksControllerList,
  clientWebhooksControllerCreate,
  clientWebhooksControllerUpdate,
  clientWebhooksControllerRemove,
  clientWebhooksControllerRotateSecret,
  clientWebhooksControllerTest,
  clientWebhooksControllerDeliveries,
  clientWebhooksControllerBulkRedeliver,
  clientWebhooksControllerDelivery,
  clientWebhooksControllerRedeliver,
  clientInvoicesControllerDiscard,
  clientInvoiceNotesControllerCreate,
  clientInvoiceNotesControllerDiscard,
  clientInvoiceNotesControllerGet,
  clientInvoiceNotesControllerGetPolicy,
  clientInvoiceNotesControllerIssue,
  clientInvoiceNotesControllerNotesOfInvoice,
  clientInvoiceNotesControllerPutPolicy,
  clientChargesControllerApprove,
  clientChargesControllerCancel,
  clientChargesControllerGet,
  clientChargesControllerGetPolicy,
  clientChargesControllerList,
  clientChargesControllerPutPolicy,
  clientChargesControllerRecord,
  clientChargesControllerReject,
  clientInvoiceNotesControllerRegister,
  clientInvoiceNotesControllerVoid,
  clientInvoicesControllerDispute,
  clientInvoicesControllerGet,
  clientInvoicesControllerIssue,
  clientInvoicesControllerLineRecords,
  clientInvoicesControllerList,
  clientInvoicesControllerPrepare,
  clientInvoicesControllerStorageBreakdown,
  clientInvoicesControllerRefresh,
  clientInvoicesControllerSettle,
  clientInvoicesControllerVoid,
  portalControllerAnnounceAsn,
  portalControllerAsn,
  portalControllerAsns,
  portalControllerGoodsReceipts,
  portalControllerGoodsReceipt,
  portalControllerInvoice,
  portalControllerInvoiceNote,
  portalControllerInvoiceNotes,
  portalControllerInvoices,
  portalControllerMe,
  portalControllerOrder,
  portalControllerOrders,
  portalControllerPlaceOrder,
  portalControllerImportOrders,
  portalControllerPortalRecall,
  portalControllerPortalRecallReport,
  portalControllerPortalRecalls,
  portalControllerPortalReturn,
  recallsControllerAddBatches,
  recallsControllerBins,
  recallsControllerCandidates,
  recallsControllerClose,
  recallsControllerDetail,
  recallsControllerList,
  recallsControllerOpen,
  recallsControllerReceipts,
  recallsControllerReport,
  recallsControllerShipments,
  portalControllerPortalReturns,
  portalControllerPurchaseOrder,
  portalControllerPurchaseOrders,
  portalControllerSkus,
  portalControllerStock,
  portalControllerWarehouses,
  putawayControllerListPutawayTasks,
  returnsControllerAwaiting,
  returnsControllerCancel,
  returnsControllerCreate,
  returnsControllerDispose,
  returnsControllerGet,
  returnsControllerList,
  returnsControllerReturnable,
  dockControllerBook,
  dockControllerCancel,
  dockControllerCreateDoor,
  dockControllerGet,
  dockControllerGetSchedule,
  dockControllerListDoors,
  dockControllerPutSchedule,
  dockControllerReschedule,
  dockControllerUpdateDoor,
  dockControllerWindow,
} from './generated/sdk.gen';
import {
  accessTokenExpired,
  ensureSessionHint,
  readSession,
  clearSession,
  writeSession,
  PORTAL_SUSPENDED_EVENT,
} from '../auth';
import { refreshAccessToken } from '../session-refresh';
import { getApiBaseUrl } from './base-url';
import type {
  BulkRedeliverWebhooksDto,
  CreateWebhookEndpointDto,
  UpdateWebhookEndpointDto,
  WebhookBulkRedeliverResponse,
  WebhookDeliveryDetailDto,
  WebhookDeliveryDto,
  WebhookDeliveryListResponse,
  WebhookEndpointListResponse,
  WebhookEndpointResponse,
  WebhookTestResponse,
  ReportingControllerDownloadRegisterData,
  PortalAsnDetailResponse,
  PortalAsnPageResponse,
  PortalGoodsReceiptListResponse,
  PortalGoodsReceiptDetailDto,
  PortalAsnRowDto,
  PortalCreateAsnDto,
  PortalCreateOrderDto,
  PortalInvoiceDetailResponse,
  PortalInvoiceNotesResponse,
  PortalNoteDetailResponse,
  PortalInvoicePageResponse,
  PortalMeResponse,
  PortalOrderDetailResponse,
  PortalOrderPageResponse,
  PortalOrderRowDto,
  PortalPlacedOrderResponse,
  PortalPurchaseOrderDetailResponse,
  PortalPurchaseOrderPageResponse,
  PortalPurchaseOrderRowDto,
  PortalSkuPageResponse,
  PortalStockPageResponse,
  PortalWarehouseListResponse,
  ServiceReportDto,
  AuditTrailResponse,
  ReportingControllerAuditData,
  AuditExportDto,
  AuditExportListResponse,
  ChainBreakDto,
  LedgerAnchorListResponse,
  LedgerIntegrityResponse,
  AuditExportRequestDto,
  ClientInvoiceDto,
  ClientInvoiceLineRecordsResponse,
  ClientInvoiceListResponse,
  StorageBreakdownResponse,
  ClientInvoiceResponse,
  CreateNoteDto,
  InvoiceNotesResponse,
  IssueNoteResponse,
  NoteDto,
  NotePolicyResponse,
  ChargePolicyResponse,
  ClientChargeDto,
  ClientChargeListResponse,
  RecordClientChargeDto,
  RecordClientChargeResponse,
  NoteRegisterResponse,
  IssueClientInvoiceResponse,
  PrepareClientInvoicesResponse,
  UpdateClientStatusDto,
  UpdateClientAddressesDto,
  UpdateClientReceivingPolicyDto,
  ClientReceivingPolicyResponse,
  UpdateClientAllocationPolicyDto,
  ClientAllocationPolicyResponse,
  ReleaseReceiptHoldsResponse,
  ClientContactDto,
  AddLicenceDto,
  CoverageGapsResponse,
  LicencePolicyResponse,
  SetLicencePolicyDto,
  SetLicencePolicyResponse,
  EditLicenceDto,
  LicenceDto,
  LicenceListResponse,
  CreateClientContactDto,
  UpdateClientContactDto,
  UpdateClientTaxDetailsDto,
  AcceptInviteDto,
  AcceptInviteResponse,
  AdjustmentDecisionResponse,
  AdjustmentPendingListResponse,
  BinGridResponse,
  BinLabelsRequestDto,
  LpnLabelsRequestDto,
  LpnListResponse,
  LpnResponse,
  MintLpnsRequestDto,
  MintLpnsResponse,
  VoidLpnRequestDto,
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
  CreateSkuDto,
  ReplacePackagingDto,
  UpdateSkuStatusDto,
  SkuWriteResponse,
  CreateWarehouseDto,
  CreateZoneDto,
  CountVarianceListResponse,
  CountPoliciesResponse,
  CancelCountTaskResponse,
  StartStockTakeResponse,
  StockTakeListResponse,
  StockTakeDetailResponse,
  StockTakeVarianceListResponse,
  RecountStockTakeResponse,
  CloseStockTakeResponse,
  AbandonStockTakeResponse,
  CountPolicyDto,
  CountTaskDetailResponse,
  CountTaskListResponse,
  CreateCountsBulkResponse,
  DeviceListResponse,
  DeviceResponse,
  UserStatusResponse,
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
  GoodsReceiptLinesResponse,
  ReceiptPhotosResponse,
  ReceiptPhotoResponse,
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
  CancelWithRestockResponse,
  AllocateOrderResponse,
  RestockPlanResponse,
  PackOrderDto,
  PackResponse,
  OverReceiptDecisionResponse,
  OverReceiptListResponse,
  PlaceQcHoldDto,
  InspectQcHoldDto,
  InspectQcHoldResponse,
  QcHoldDetailResponse,
  QcHoldListResponse,
  QcHoldResponse,
  ReorderPolicyListResponse,
  ReorderPolicyResponse,
  BreachListResponse,
  BreachResponse,
  BatchAlertListResponse,
  BatchAlertResponse,
  BatchDetailResponse,
  BatchListResponse,
  BatchBlockResponse,
  BlockBatchDto,
  UnblockBatchDto,
  MoveStockDto,
  MoveStockResponse,
  StockAdjustmentDto,
  StockAdjustmentPendingResponse,
  StockAdjustmentResponse,
  ExpiryPolicyResponse,
  SuggestedPoListResponse,
  SubmitSuggestedPoResponse,
  UpsertReorderPolicyDto,
  SubmitSuggestedPoDto,
  StockListResponse,
  PutKitDto,
  PatchBinDto,
  BlockBinDto,
  UnblockBinDto,
  BinBlockImpactResponse,
  PatchProductDto,
  PatchSkuDto,
  ClientDto,
  ClientListResponse,
  RateCardDto,
  RateCardInForceResponse,
  ClientUsageResponse,
  RateCardLineDto,
  RateCardListResponse,
  ProductListResponse,
  ProductResponse,
  PurchaseOrderListResponse,
  PurchaseOrderResponse,
  AmendAsnDto,
  CreateReturnAuthorizationDto,
  ReturnableOrderDto,
  ReturnAuthorizationDto,
  ReturnAuthorizationListResponse,
  AwaitingDispositionListResponse,
  DisposeReturnDto,
  ReturnDispositionResultDto,
  PortalReturnPageResponse,
  PortalRecallDetailResponse,
  PortalRecallListResponse,
  AddRecallBatchesDto,
  CloseRecallDto,
  OpenRecallDto,
  RecallBinsResponse,
  RecallCandidatesResponse,
  RecallDetailResponse,
  RecallListResponse,
  RecallReceiptsResponse,
  RecallResponse,
  RecallShipmentsResponse,
  RecallsControllerListData,
  PortalReturnDetailResponse,
  PortalControllerPortalReturnsData,
  AsnListResponse,
  AsnImportResponseDto,
  OrderImportResponseDto,
  PortalOrderImportResponseDto,
  AsnResponse,
  CreateAsnDto,
  CreatePurchaseOrderDto,
  AmendGateInDto,
  CreateGateInDto,
  GateInDetailResponse,
  BookDockAppointmentDto,
  CancelDockAppointmentDto,
  CreateDockDoorDto,
  DockAppointmentResponse,
  DockDoorListResponse,
  DockDoorResponse,
  DockScheduleResponse,
  DockWindowResponse,
  PutDockScheduleDto,
  RescheduleDockAppointmentDto,
  UpdateDockDoorDto,
  GateInListResponse,
  GateInResponse,
  GateInUnloadResponse,
  GateOutDto,
  UnloadGateInDto,
  CreateVendorReturnDto,
  DispatchVendorReturnDto,
  ReturnableDamagedResponse,
  VendorReturnDto,
  VendorReturnListResponse,
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
  TotpChallengeResponse,
  EnrollChallengeResponse,
  SecondFactorSignInDto,
  SecondFactorSignInResponse,
  PasswordResetRequestDto,
  PasswordResetRequestedResponse,
  PasswordResetCheckResponse,
  PasswordResetConfirmDto,
  PasswordResetConfirmResponse,
  SecondFactorStatusResponse,
  SecondFactorSetupDto,
  SecondFactorSetupResponse,
  BackupCodesResponse,
  SecondFactorResetResponse,
  SkuListResponse,
  SkuClientCorrectionResponse,
  SkuResponse,
  TenantRegistrationResponse,
  UserListResponse,
  ReportingOverviewResponse,
  NotificationListResponse,
  NotificationStatusResponse,
  UserResponse,
  PartnerListResponse,
  PartnerDto,
  CreatePartnerDto,
  UpdatePartnerDto,
  UpdatePartnerStatusDto,
  CreatePartnerLinkDto,
  UpdatePartnerLinkDto,
  WarehouseListResponse,
  WarehouseResponse,
  WaveListResponse,
  WavePolicyListResponse,
  WavePolicyResponse,
  WaveResponse,
  ZoneListResponse,
  ZoneResponse,
  PutawayTaskListResponse,
  InventoryControllerListEventsData,
} from './generated/types.gen';

/**
 * Configures the generated client. The base URL points at wms-be's `/api/v1`
 * shell; every typed function lives in ./generated (AD-8 — no hand-written
 * API types anywhere in wms-fe).
 *
 * Story 6-2a (A7) — the base is resolved at CALL time (`getApiBaseUrl()`,
 * the runtime config first), never frozen when this module is imported: the
 * generated client reads its config when each request starts, so every
 * request method is wrapped to re-sync the base first. A changed base is
 * applied with `setConfig` before that request builds its URL.
 *
 * Story 7-2: the same base is the ONE origin every surface composes absolute
 * API URLs from — the channel webhook rows are built on `getPublicApiBaseUrl()` (rendered: never the internal base, C7),
 * never on `window.location.origin` (bl-16: the backend the browser talks to
 * — behind a proxy, on another host, a LAN box — can differ from the page).
 */
let configuredBaseUrl: string | undefined;

/** Applies the current API base to the generated client; returns it. */
export function syncClientBaseUrl(): string {
  const baseUrl = getApiBaseUrl();
  if (baseUrl !== configuredBaseUrl) {
    client.setConfig({ baseUrl });
    configuredBaseUrl = baseUrl;
  }
  return baseUrl;
}

const REQUEST_METHODS = ['connect', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'request', 'trace'] as const;
for (const method of REQUEST_METHODS) {
  const original = client[method] as (...args: unknown[]) => unknown;
  (client as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
    syncClientBaseUrl();
    return original(...args);
  };
}
syncClientBaseUrl();

/**
 * Attaches the stored session token to every request the browser makes.
 * Server-side renders (no session) send nothing — the tenancy endpoints
 * answer 401 and surfaces degrade honestly.
 */
/**
 * Story 6-1a — a copy of each outgoing request, kept until its response, so a
 * 401 `token-expired` can be retried ONCE with a fresh token: the original's
 * body is consumed by the time the response arrives. The copy keeps every
 * header, so a retried write carries the same Idempotency-Key.
 */
const retryCopies = new WeakMap<Request, Request>();

/**
 * Story 6-1a — the session routes manage tokens themselves; nothing refreshes
 * around them. Story 6-1b — the second sign-in step is one too: its 401 (a
 * wrong code) must never sign anyone out or trigger a refresh. Story 6-1c
 * (A13) — the three password-reset routes as well: no bearer attached, no
 * refresh, no sign-out on their answers (a reset opened in a signed-in tab).
 */
export function isSessionRoute(url: string): boolean {
  return /\/tenants\/(sign-in|sign-in\/second-factor|session\/refresh|session\/sign-out|password-reset|password-reset\/check|password-reset\/confirm)$/.test(
    new URL(url).pathname,
  );
}

client.interceptors.request.use(async (request) => {
  // Story 6-1c (A13) — a reset route carries no credential but its own token.
  if (/\/tenants\/password-reset(\/check|\/confirm)?$/.test(new URL(request.url).pathname)) return request;
  let session = readSession();
  // Story 6-1a — a lapsed access token is refreshed BEFORE the request, not
  // after a guaranteed 401 (a reopened tab, a laptop back from sleep).
  if (session !== null && accessTokenExpired(session) && !isSessionRoute(request.url)) {
    await refreshAccessToken();
    session = readSession();
  }
  if (session !== null) {
    request.headers.set('Authorization', `Bearer ${session.token}`);
    // Bootstrap: the proxy gate may have rendered this page on an expired
    // hint cookie even though localStorage holds a fresh token — re-assert
    // the mirror so the next hard navigation doesn't bounce to /login.
    ensureSessionHint();
    if (!isSessionRoute(request.url)) retryCopies.set(request, request.clone());
  }
  return request;
});

/**
 * Story 6-1a — the backend's 401 says what to do:
 *  - `token-expired`: refresh once and retry the request (its copy, same
 *    Idempotency-Key); a failed refresh leaves the 401 as the answer.
 *  - `session-ended`: the session is over — clear it with the server's
 *    `reason`, which the sign-in page shows.
 *  - anything else (a forged or malformed token): clear it.
 */
client.interceptors.response.use(async (response, request) => {
  if (response.status !== 401 || isSessionRoute(request.url)) return response;
  const body = (await response.clone().json().catch(() => ({}))) as { code?: unknown; reason?: unknown };
  if (body.code === 'token-expired') {
    const copy = retryCopies.get(request);
    retryCopies.delete(request);
    if (copy !== undefined && (await refreshAccessToken())) {
      const session = readSession();
      if (session !== null) {
        copy.headers.set('Authorization', `Bearer ${session.token}`);
        const retried = await fetch(copy);
        // Code review — the retry's own 401 (the session ended between the
        // refresh and the retry) is handled like any other.
        if (retried.status === 401) await signOutFrom(retried);
        return retried;
      }
    }
    return response;
  }
  await signOutFrom(response, body);
  return response;
});

/** A 401 that is not `token-expired`: clear the session, carrying the server's `reason` when it ended one. */
async function signOutFrom(response: Response, parsed?: { code?: unknown; reason?: unknown }): Promise<void> {
  const body = parsed ?? ((await response.clone().json().catch(() => ({}))) as { code?: unknown; reason?: unknown });
  if (body.code === 'token-expired') return;
  clearSession(body.code === 'session-ended' && typeof body.reason === 'string' ? body.reason : undefined);
}

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
/**
 * Story 9-1b — a list query of exactly the options the caller set: an
 * undefined option is dropped, and no option at all sends no query (a first
 * page of the normal view stays query-free, as every wrapper's test pins).
 */
function definedQuery<Q extends Record<string, unknown>>(
  options: Q,
): { [K in keyof Q]?: Exclude<Q[K], undefined> } | undefined {
  const query: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) if (value !== undefined) query[key] = value;
  return Object.keys(query).length === 0 ? undefined : (query as { [K in keyof Q]?: Exclude<Q[K], undefined> });
}

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

/**
 * The password step. Story 6-1b — the answer is the session, or a challenge
 * (narrow with `signInStep`, `lib/second-factor.ts`); `X-WMS-Second-Factor: 1`
 * tells the server this build can complete the second step (without it the
 * server answers 409 `client-outdated` rather than a challenge an old bundle
 * would mistake for a session).
 */
export async function fetchApiSignIn(
  body: SignInDto,
): Promise<SignInResponse | TotpChallengeResponse | EnrollChallengeResponse> {
  // Story 6-1a — `include`, so the browser keeps the cross-origin refresh cookie.
  const { data, error } = await tenancyControllerSignIn({
    body,
    credentials: 'include',
    headers: { 'X-WMS-Second-Factor': '1' },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 6-1c — asks for a reset link. One 202 body for every email; only a limit (429) or a malformed address (400) refuses. */
export async function fetchApiRequestPasswordReset(body: PasswordResetRequestDto): Promise<PasswordResetRequestedResponse> {
  const { data, error } = await tenancyControllerRequestPasswordReset({ body });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Story 6-1c — validates a reset link (changes nothing): its account and whether a code is needed. */
export async function fetchApiCheckPasswordReset(token: string): Promise<PasswordResetCheckResponse> {
  const { data, error } = await tenancyControllerCheckPasswordReset({ body: { token } });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/**
 * Story 6-1c — sets the new password. `include`, so the browser keeps the
 * `wms_device` cookie the confirm sets (the next sign-in from this browser
 * is trusted). It issues no session.
 */
export async function fetchApiConfirmPasswordReset(body: PasswordResetConfirmDto): Promise<PasswordResetConfirmResponse> {
  const { data, error } = await tenancyControllerConfirmPasswordReset({ body, credentials: 'include' });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Story 6-1b — the second sign-in step: the code (and, after a reset, the enrolment code) → the session. */
export async function fetchApiSecondFactor(body: SecondFactorSignInDto): Promise<SecondFactorSignInResponse> {
  const { data, error } = await tenancyControllerSignInSecondFactor({ body, credentials: 'include' });
  if (error || !data) {
    throw unwrapError(error, 401);
  }
  return data;
}

/** Story 6-1b — My account → Security: the caller's two-factor state. */
export async function fetchApiSecondFactorStatus(tenantId: string): Promise<SecondFactorStatusResponse> {
  const { data, error } = await usersControllerSecondFactorStatus({ path: { tenantId } });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 6-1b — starts (or replaces) the authenticator: the password when off, a code when on. Not keyed. */
export async function fetchApiSecondFactorSetup(tenantId: string, body: SecondFactorSetupDto): Promise<SecondFactorSetupResponse> {
  const { data, error } = await usersControllerSecondFactorSetup({ path: { tenantId }, body });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 6-1b — confirms the new authenticator; answers the ten backup codes once. Not keyed. */
export async function fetchApiSecondFactorConfirm(tenantId: string, code: string): Promise<BackupCodesResponse> {
  const { data, error } = await usersControllerSecondFactorConfirm({ path: { tenantId }, body: { code } });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 6-1b — a new set of backup codes (the old set stops working). Not keyed. */
export async function fetchApiSecondFactorBackupCodes(tenantId: string, code: string): Promise<BackupCodesResponse> {
  const { data, error } = await usersControllerSecondFactorBackupCodes({ path: { tenantId }, body: { code } });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 6-1b — turns two-factor sign-in off (not for owners). Not keyed. */
export async function fetchApiSecondFactorDisable(tenantId: string, code: string): Promise<SecondFactorStatusResponse> {
  const { data, error } = await usersControllerSecondFactorDisable({ path: { tenantId }, body: { code } });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 6-1b — an owner resets a colleague's two-factor sign-in; answers the one-time enrolment code. Keyed. */
export async function fetchApiResetSecondFactor(
  tenantId: string,
  userId: string,
  idempotencyKey: string,
): Promise<SecondFactorResetResponse> {
  const { data, error } = await usersControllerResetSecondFactor({
    path: { tenantId, userId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
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

/**
 * Story 2-10a — bin labels as a file (ZPL `text/plain` or a PDF), as a Blob
 * (`parseAs: 'blob'`, the audit-export file pattern). A refusal is still
 * problem+json and becomes an `ApiProblem` — the listing arms carry
 * `extensions.binCodes`, `too-many-labels` carries `extensions.count`. The
 * server's filename is not readable cross-origin; the caller names the file
 * (`binLabelsFilename`).
 */
export async function fetchApiBinLabels(tenantId: string, warehouseId: string, body: BinLabelsRequestDto): Promise<Blob> {
  const { data, error, response } = await tenancyControllerPrintBinLabels({
    path: { tenantId, warehouseId },
    body,
    parseAs: 'blob',
  });
  if (error || !data) {
    throw unwrapError(error, response?.status ?? 400);
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
 * Story 3-3b — block a bin with a reason (`bin.block`): `{ reason, note? }`,
 * `other` needs a note. Keyed per draft. The PATCH `blocked` arm is retired —
 * `fetchApiSetBinBlocked` stays for the structure edits (class, client) only.
 */
export async function fetchApiBlockBin(
  tenantId: string,
  warehouseId: string,
  binId: string,
  body: BlockBinDto,
  idempotencyKey: string,
): Promise<BinResponse> {
  const { data, error } = await tenancyControllerBlockBin({
    path: { tenantId, warehouseId, binId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 3-3b — unblock a bin, with a required note (`bin.block`). Keyed per draft. */
export async function fetchApiUnblockBin(
  tenantId: string,
  warehouseId: string,
  binId: string,
  body: UnblockBinDto,
  idempotencyKey: string,
): Promise<BinResponse> {
  const { data, error } = await tenancyControllerUnblockBin({
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
 * Story 3-3b — what blocking a bin would take out of service (`bin.block`):
 * on-hand units and SKUs, planned pick lines, open count lines, per client.
 * Advisory and read-only; no key.
 */
export async function fetchApiBinBlockImpact(
  tenantId: string,
  warehouseId: string,
  binId: string,
  options?: { signal?: AbortSignal },
): Promise<BinBlockImpactResponse> {
  const { data, error } = await tenancyControllerBinBlockImpact({
    path: { tenantId, warehouseId, binId },
    signal: options?.signal,
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
  options?: {
    cursor?: string;
    productId?: string;
    /** Story 1-5a — one client's SKUs; sent only when set. */
    clientId?: string;
    /** Story 1-4b — only active or only inactive SKUs; absent lists every SKU. */
    status?: 'active' | 'inactive';
    /** Story 2-1 — the page size (the route's `@Max(200)`); absent = the server's default. */
    limit?: number;
    signal?: AbortSignal;
  },
): Promise<SkuListResponse> {
  const { data, error } = await catalogControllerListSkus({
    path: { tenantId },
    query: definedQuery({
      cursor: options?.cursor,
      productId: options?.productId,
      clientId: options?.clientId,
      status: options?.status,
      limit: options?.limit,
    }),
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
 * Story 1-4 — create ONE SKU (gated `sku.edit`): one import row's worth of
 * typed fields, its pack levels and barcodes included. The caller notifies
 * the catalog readers on success (`notifyCatalogChanged`).
 */
export async function fetchApiCreateSku(
  tenantId: string,
  body: CreateSkuDto,
  idempotencyKey: string,
): Promise<SkuWriteResponse> {
  const { data, error } = await catalogControllerCreateSku({
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
 * Story 1-4 — replace a SKU's pack levels and every NON-primary barcode
 * (PUT — replace semantics; the primary rides the SKU PATCH).
 */
export async function fetchApiReplacePackaging(
  tenantId: string,
  skuId: string,
  body: ReplacePackagingDto,
  idempotencyKey: string,
): Promise<SkuWriteResponse> {
  const { data, error } = await catalogControllerReplacePackaging({
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
 * Story 1-4b — deactivate (with an optional reason) or reactivate a SKU
 * (gated `sku.edit`). The caller notifies the catalog readers on success.
 */
export async function fetchApiUpdateSkuStatus(
  tenantId: string,
  skuId: string,
  body: UpdateSkuStatusDto,
  idempotencyKey: string,
): Promise<SkuWriteResponse> {
  const { data, error } = await catalogControllerUpdateSkuStatus({
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

/**
 * Story 21-5 — set a client brand's tax details (`billing.invoice`: owner +
 * accountant). An absent field is unchanged; `null` clears it.
 */
export async function fetchApiUpdateClientTaxDetails(
  tenantId: string,
  clientId: string,
  body: UpdateClientTaxDetailsDto,
  idempotencyKey: string,
): Promise<ClientDto> {
  const { data, error } = await clientsControllerUpdateTaxDetails({
    path: { tenantId, clientId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.client;
}

/**
 * Story 21-10 — suspend (`suspended`) or reactivate (`active`) a client
 * brand (owner-only). An unchanged status answers 200 with the client as it
 * is (the key is stored server-side, so a retry replays).
 */
export async function fetchApiUpdateClientStatus(
  tenantId: string,
  clientId: string,
  status: UpdateClientStatusDto['status'],
  idempotencyKey: string,
): Promise<ClientDto> {
  const { data, error } = await clientsControllerUpdateClientStatus({
    path: { tenantId, clientId },
    body: { status },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.client;
}

/**
 * Story 1-2a — set a client's registered and return addresses (owner-only).
 * Each group: omitted is unchanged, `null` clears it, a value replaces it.
 */
export async function fetchApiUpdateClientAddresses(
  tenantId: string,
  clientId: string,
  body: UpdateClientAddressesDto,
  idempotencyKey: string,
): Promise<ClientDto> {
  const { data, error } = await clientsControllerUpdateAddresses({
    path: { tenantId, clientId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.client;
}

/**
 * Story 1-2b — a client's receiving policy (tolerance in basis points, QC on
 * receipt, expiry required, minimum remaining shelf life) plus how many of
 * its SKUs are untracked (any staff session).
 */
export async function fetchApiGetClientReceivingPolicy(
  tenantId: string,
  clientId: string,
  options?: { signal?: AbortSignal },
): Promise<ClientReceivingPolicyResponse> {
  const { data, error } = await clientsControllerGetReceivingPolicy({
    path: { tenantId, clientId },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 1-2b — replace a client's receiving policy (owner-only). A FULL
 * replace: all four fields are always sent (`minShelfLifeDays` null for
 * none). Answers the client; its `receivingPolicy` is optional on the wire
 * (a replayed pre-1-2b answer lacks it).
 */
export async function fetchApiUpdateClientReceivingPolicy(
  tenantId: string,
  clientId: string,
  body: UpdateClientReceivingPolicyDto,
  idempotencyKey: string,
): Promise<ClientDto> {
  const { data, error } = await clientsControllerUpdateReceivingPolicy({
    path: { tenantId, clientId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.client;
}

/**
 * Story 4-3a — a client's outbound allocation policy (rule + minimum remaining
 * shelf life at dispatch) plus its untracked-SKU and undated-batch counts (any
 * staff session).
 */
export async function fetchApiGetClientAllocationPolicy(
  tenantId: string,
  clientId: string,
  options?: { signal?: AbortSignal },
): Promise<ClientAllocationPolicyResponse> {
  const { data, error } = await clientsControllerGetAllocationPolicy({
    path: { tenantId, clientId },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 4-3a — replace a client's allocation policy (owner-only). A FULL
 * replace: both keys are always sent (`minOutboundShelfLifeDays` null for
 * none — a missing key is a 400). Answers the client; its `allocationPolicy`
 * is optional on the wire (a replayed pre-4-3a answer lacks it).
 */
export async function fetchApiUpdateClientAllocationPolicy(
  tenantId: string,
  clientId: string,
  body: UpdateClientAllocationPolicyDto,
  idempotencyKey: string,
): Promise<ClientDto> {
  const { data, error } = await clientsControllerUpdateAllocationPolicy({
    path: { tenantId, clientId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.client;
}

/** Story 1-6c — the tenant's drug and FSSAI licences with the server's expiry badge (any staff session). */
export async function fetchApiListLicences(
  tenantId: string,
  options?: { signal?: AbortSignal },
): Promise<LicenceListResponse> {
  const { data, error } = await licencesControllerList({
    path: { tenantId },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 1-6c — the coverage gaps wherever drug or food goods are (any staff session). */
export async function fetchApiLicenceCoverage(
  tenantId: string,
  options?: { signal?: AbortSignal },
): Promise<CoverageGapsResponse> {
  const { data, error } = await licencesControllerCoverage({
    path: { tenantId },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 1-6d — the licence enforcement switch and today's known gap count (any staff session). */
export async function fetchApiLicencePolicy(tenantId: string, options?: { signal?: AbortSignal }): Promise<LicencePolicyResponse> {
  const { data, error } = await licencesControllerGetPolicy({
    path: { tenantId },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 1-6d — turn licence enforcement on or off (owner-only). Turning on
 * sends the gap count the owner saw (`acknowledgedGapCount`); a live count
 * above it is 409 `licence-gaps-unacknowledged` carrying `gapCount` in its
 * extensions. The answer carries `gapCount` only on a turn-on.
 */
export async function fetchApiSetLicencePolicy(
  tenantId: string,
  body: SetLicencePolicyDto,
  idempotencyKey: string,
): Promise<SetLicencePolicyResponse> {
  const { data, error } = await licencesControllerSetPolicy({
    path: { tenantId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 1-6c — add a client or site licence (owner-only, licences.manage). */
export async function fetchApiAddLicence(tenantId: string, body: AddLicenceDto, idempotencyKey: string): Promise<LicenceDto> {
  const { data, error } = await licencesControllerAdd({
    path: { tenantId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.licence;
}

/** Story 1-6c — edit a licence: absent keeps, null clears (owner-only). */
export async function fetchApiEditLicence(
  tenantId: string,
  licenceId: string,
  body: EditLicenceDto,
  idempotencyKey: string,
): Promise<LicenceDto> {
  const { data, error } = await licencesControllerEdit({
    path: { tenantId, licenceId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.licence;
}

/** Story 1-6c — withdraw a licence (owner-only); never deleted. */
export async function fetchApiWithdrawLicence(tenantId: string, licenceId: string, idempotencyKey: string): Promise<LicenceDto> {
  const { data, error } = await licencesControllerWithdraw({
    path: { tenantId, licenceId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.licence;
}

/** Story 1-2a — a client's contacts, the primary first (any staff session). */
export async function fetchApiListClientContacts(
  tenantId: string,
  clientId: string,
  options?: { signal?: AbortSignal },
): Promise<ClientContactDto[]> {
  const { data, error } = await clientsControllerListContacts({
    path: { tenantId, clientId },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.items;
}

/** Story 1-2a — add a contact (owner-only); the first becomes primary. */
export async function fetchApiAddClientContact(
  tenantId: string,
  clientId: string,
  body: CreateClientContactDto,
  idempotencyKey: string,
): Promise<ClientContactDto> {
  const { data, error } = await clientsControllerAddContact({
    path: { tenantId, clientId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.contact;
}

/** Story 1-2a — edit a contact (owner-only); `isPrimary: true` makes it the primary. */
export async function fetchApiEditClientContact(
  tenantId: string,
  clientId: string,
  contactId: string,
  body: UpdateClientContactDto,
  idempotencyKey: string,
): Promise<ClientContactDto> {
  const { data, error } = await clientsControllerEditContact({
    path: { tenantId, clientId, contactId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.contact;
}

/** Story 1-2a — remove a contact (owner-only); answers the removed contact. */
export async function fetchApiRemoveClientContact(
  tenantId: string,
  clientId: string,
  contactId: string,
  idempotencyKey: string,
): Promise<ClientContactDto> {
  const { data, error } = await clientsControllerRemoveContact({
    path: { tenantId, clientId, contactId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.contact;
}

/* ------------------------------------------------------------------ */
/* Client webhooks (story 5-2a) — owner-only (`clients.manage`), reads  */
/* too. The signing secret arrives ONCE, in a fresh create or rotate.   */
/* ------------------------------------------------------------------ */

/** A client's live webhook endpoints, plus the server's `webhooks-unavailable` warning. */
export async function fetchApiListWebhookEndpoints(
  tenantId: string,
  clientId: string,
  options?: { signal?: AbortSignal },
): Promise<WebhookEndpointListResponse> {
  const { data, error } = await clientWebhooksControllerList({ path: { tenantId, clientId }, signal: options?.signal });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

export async function fetchApiCreateWebhookEndpoint(
  tenantId: string,
  clientId: string,
  body: CreateWebhookEndpointDto,
  idempotencyKey: string,
): Promise<WebhookEndpointResponse> {
  const { data, error } = await clientWebhooksControllerCreate({
    path: { tenantId, clientId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

export async function fetchApiUpdateWebhookEndpoint(
  tenantId: string,
  clientId: string,
  endpointId: string,
  body: UpdateWebhookEndpointDto,
  idempotencyKey: string,
): Promise<WebhookEndpointResponse> {
  const { data, error } = await clientWebhooksControllerUpdate({
    path: { tenantId, clientId, endpointId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

export async function fetchApiDeleteWebhookEndpoint(
  tenantId: string,
  clientId: string,
  endpointId: string,
  idempotencyKey: string,
): Promise<WebhookEndpointResponse> {
  const { data, error } = await clientWebhooksControllerRemove({
    path: { tenantId, clientId, endpointId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

export async function fetchApiRotateWebhookSecret(
  tenantId: string,
  clientId: string,
  endpointId: string,
  revokePrevious: boolean,
  idempotencyKey: string,
): Promise<WebhookEndpointResponse> {
  const { data, error } = await clientWebhooksControllerRotateSecret({
    path: { tenantId, clientId, endpointId },
    body: { revokePrevious },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

export async function fetchApiTestWebhookEndpoint(
  tenantId: string,
  clientId: string,
  endpointId: string,
  idempotencyKey: string,
): Promise<WebhookTestResponse> {
  const { data, error } = await clientWebhooksControllerTest({
    path: { tenantId, clientId, endpointId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

export async function fetchApiListWebhookDeliveries(
  tenantId: string,
  clientId: string,
  endpointId: string,
  query: { cursor?: string; limit?: number; status?: WebhookDeliveryDto['status'] },
  options?: { signal?: AbortSignal },
): Promise<WebhookDeliveryListResponse> {
  const { data, error } = await clientWebhooksControllerDeliveries({
    path: { tenantId, clientId, endpointId },
    query,
    signal: options?.signal,
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

export async function fetchApiGetWebhookDelivery(
  tenantId: string,
  clientId: string,
  endpointId: string,
  deliveryId: string,
): Promise<WebhookDeliveryDetailDto> {
  const { data, error } = await clientWebhooksControllerDelivery({ path: { tenantId, clientId, endpointId, deliveryId } });
  if (error || !data) throw unwrapError(error, 400);
  return data.delivery;
}

export async function fetchApiRedeliverWebhook(
  tenantId: string,
  clientId: string,
  endpointId: string,
  deliveryId: string,
  idempotencyKey: string,
): Promise<WebhookDeliveryDto> {
  const { data, error } = await clientWebhooksControllerRedeliver({
    path: { tenantId, clientId, endpointId, deliveryId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data.delivery;
}

export async function fetchApiBulkRedeliverWebhooks(
  tenantId: string,
  clientId: string,
  endpointId: string,
  body: BulkRedeliverWebhooksDto,
  idempotencyKey: string,
): Promise<WebhookBulkRedeliverResponse> {
  const { data, error } = await clientWebhooksControllerBulkRedeliver({
    path: { tenantId, clientId, endpointId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/* ------------------------------------------------------------------ */
/* Client invoices (story 21-5) — a client's monthly services tax      */
/* invoice per supplying GSTIN. Reads are member-open (portal sessions */
/* refused); the mutations need `billing.invoice`.                      */
/* ------------------------------------------------------------------ */

/** Prepare the drafts of one client for an ended IST month (`YYYY-MM`). */
export async function fetchApiPrepareClientInvoices(
  tenantId: string,
  clientId: string,
  month: string,
  idempotencyKey: string,
): Promise<PrepareClientInvoicesResponse> {
  const { data, error } = await clientInvoicesControllerPrepare({
    path: { tenantId, clientId },
    body: { month },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** A keyset page of client invoices, newest first; a first page sends only the filters given. */
export async function fetchApiListClientInvoices(
  tenantId: string,
  options?: { clientId?: string; status?: ClientInvoiceDto['status']; cursor?: string; limit?: number; signal?: AbortSignal },
): Promise<ClientInvoiceListResponse> {
  const query = {
    ...(options?.clientId === undefined ? {} : { clientId: options.clientId }),
    ...(options?.status === undefined ? {} : { status: options.status }),
    ...(options?.cursor === undefined ? {} : { cursor: options.cursor }),
    ...(options?.limit === undefined ? {} : { limit: options.limit }),
  };
  const { data, error } = await clientInvoicesControllerList({
    path: { tenantId },
    query: Object.keys(query).length === 0 ? undefined : query,
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** One client invoice: lines, gaps, warnings, party, totals. */
export async function fetchApiGetClientInvoice(
  tenantId: string,
  invoiceId: string,
  options?: { signal?: AbortSignal },
): Promise<ClientInvoiceResponse> {
  const { data, error } = await clientInvoicesControllerGet({
    path: { tenantId, invoiceId },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 21-5b — one keyset page of a client-invoice line's records (the
 * dispute drill-down). The first page (no cursor) carries the
 * reconciliation `summary`; a first page sends only the limit given.
 */
export async function fetchApiClientInvoiceLineRecords(
  tenantId: string,
  invoiceId: string,
  lineId: string,
  options?: { cursor?: string; limit?: number; signal?: AbortSignal },
): Promise<ClientInvoiceLineRecordsResponse> {
  const query = {
    ...(options?.cursor === undefined ? {} : { cursor: options.cursor }),
    ...(options?.limit === undefined ? {} : { limit: options.limit }),
  };
  const { data, error } = await clientInvoicesControllerLineRecords({
    path: { tenantId, invoiceId, lineId },
    query: Object.keys(query).length === 0 ? undefined : query,
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 21-5b — a storage line's one-day per-SKU breakdown in one warehouse. */
export async function fetchApiClientInvoiceStorageBreakdown(
  tenantId: string,
  invoiceId: string,
  lineId: string,
  date: string,
  warehouseId: string,
  options?: { signal?: AbortSignal },
): Promise<StorageBreakdownResponse> {
  const { data, error } = await clientInvoicesControllerStorageBreakdown({
    path: { tenantId, invoiceId, lineId },
    query: { date, warehouseId },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Re-derive a draft from the current figures. */
export async function fetchApiRefreshClientInvoice(tenantId: string, invoiceId: string, idempotencyKey: string): Promise<ClientInvoiceDto> {
  const { data, error } = await clientInvoicesControllerRefresh({
    path: { tenantId, invoiceId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.invoice;
}

/** Discard a draft (204). */
export async function fetchApiDiscardClientInvoice(tenantId: string, invoiceId: string, idempotencyKey: string): Promise<void> {
  const { error } = await clientInvoicesControllerDiscard({
    path: { tenantId, invoiceId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error) {
    throw unwrapError(error, 400);
  }
}

/**
 * Issue a draft: `{outcome: 'issued' | 'stale', invoice}` — a stale answer is
 * a 200 carrying the fresh draft (nothing issued), recorded under its key; the
 * caller mints a NEW key per click.
 */
export async function fetchApiIssueClientInvoice(tenantId: string, invoiceId: string, idempotencyKey: string): Promise<IssueClientInvoiceResponse> {
  const { data, error } = await clientInvoicesControllerIssue({
    path: { tenantId, invoiceId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Dispute, settle or void an issued invoice; the note is sent only when given. */
export async function fetchApiTransitionClientInvoice(
  tenantId: string,
  invoiceId: string,
  verb: 'dispute' | 'settle' | 'void',
  note: string | null,
  idempotencyKey: string,
): Promise<ClientInvoiceDto> {
  const options = {
    path: { tenantId, invoiceId },
    body: note === null ? {} : { note },
    headers: { 'Idempotency-Key': idempotencyKey },
  };
  const { data, error } =
    verb === 'dispute'
      ? await clientInvoicesControllerDispute(options)
      : verb === 'settle'
        ? await clientInvoicesControllerSettle(options)
        : await clientInvoicesControllerVoid(options);
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.invoice;
}

/* ------------------------------------------------------------------ */
/* Credit and debit notes (story 5-6a) — GST s.34 notes against an     */
/* issued client invoice. Reads are member-open; the mutations need    */
/* `billing.invoice`, the policy PUT the owner-only `billing.configure`.*/
/* ------------------------------------------------------------------ */

/** Draft a credit or debit note against an issued invoice (201 `{note}`). */
export async function fetchApiCreateClientInvoiceNote(tenantId: string, invoiceId: string, body: CreateNoteDto, idempotencyKey: string): Promise<NoteDto> {
  const { data, error } = await clientInvoiceNotesControllerCreate({
    path: { tenantId, invoiceId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data.note;
}

/** One invoice's notes (drafts included) and its document value after the issued ones. */
export async function fetchApiClientInvoiceNotes(tenantId: string, invoiceId: string, options?: { signal?: AbortSignal }): Promise<InvoiceNotesResponse> {
  const { data, error } = await clientInvoiceNotesControllerNotesOfInvoice({ path: { tenantId, invoiceId }, signal: options?.signal });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

export async function fetchApiGetClientInvoiceNote(tenantId: string, noteId: string, options?: { signal?: AbortSignal }): Promise<NoteDto> {
  const { data, error } = await clientInvoiceNotesControllerGet({ path: { tenantId, noteId }, signal: options?.signal });
  if (error || !data) throw unwrapError(error, 400);
  return data.note;
}

/** Issue a draft note: `{note, invoice?}` — `invoice` when the note settled its dispute. A NEW key per click. */
export async function fetchApiIssueClientInvoiceNote(tenantId: string, noteId: string, idempotencyKey: string): Promise<IssueNoteResponse> {
  const { data, error } = await clientInvoiceNotesControllerIssue({ path: { tenantId, noteId }, headers: { 'Idempotency-Key': idempotencyKey } });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

export async function fetchApiDiscardClientInvoiceNote(tenantId: string, noteId: string, idempotencyKey: string): Promise<void> {
  const { error } = await clientInvoiceNotesControllerDiscard({ path: { tenantId, noteId }, headers: { 'Idempotency-Key': idempotencyKey } });
  if (error) throw unwrapError(error, 400);
}

export async function fetchApiVoidClientInvoiceNote(tenantId: string, noteId: string, voidNote: string, idempotencyKey: string): Promise<NoteDto> {
  const { data, error } = await clientInvoiceNotesControllerVoid({
    path: { tenantId, noteId },
    body: { voidNote },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data.note;
}

/** The notes register (GSTR-1 CDNR fields) of one supplying GSTIN over inclusive IST dates. */
export async function fetchApiClientInvoiceNoteRegister(
  tenantId: string,
  query: { gstin: string; from: string; to: string; kind?: 'credit' | 'debit'; status?: 'issued' | 'void'; cursor?: string; limit?: number },
  options?: { signal?: AbortSignal },
): Promise<NoteRegisterResponse> {
  const { data, error } = await clientInvoiceNotesControllerRegister({ path: { tenantId }, query, signal: options?.signal });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

export async function fetchApiNotePolicy(tenantId: string, options?: { signal?: AbortSignal }): Promise<NotePolicyResponse> {
  const { data, error } = await clientInvoiceNotesControllerGetPolicy({ path: { tenantId }, signal: options?.signal });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

export async function fetchApiPutNotePolicy(tenantId: string, requireSecondApprover: boolean, idempotencyKey: string): Promise<NotePolicyResponse> {
  const { data, error } = await clientInvoiceNotesControllerPutPolicy({
    path: { tenantId },
    body: { requireSecondApprover },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/* ------------------------------------------------------------------ */
/* Ad-hoc charges (story 5-5a) — one billable event for one client in  */
/* one warehouse on one IST day. Reads are member-open; record (and    */
/* cancelling one's own pending charge) needs `billing.charge`; approve,*/
/* reject, cancel-approved and the policy PUT need `billing.invoice`.  */
/* Every write takes an Idempotency-Key.                               */
/* ------------------------------------------------------------------ */

export interface ClientChargesQuery {
  readonly clientId?: string;
  readonly warehouseId?: string;
  readonly status?: ClientChargeDto['status'];
  /** The billing month, `YYYY-MM`. */
  readonly month?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

/** The charges, newest first (keyset), each with the invoice that bills it. */
export async function fetchApiListClientCharges(tenantId: string, query: ClientChargesQuery, options?: { signal?: AbortSignal }): Promise<ClientChargeListResponse> {
  const { data, error } = await clientChargesControllerList({ path: { tenantId }, query: { ...query }, signal: options?.signal });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

export async function fetchApiGetClientCharge(tenantId: string, chargeId: string, options?: { signal?: AbortSignal }): Promise<ClientChargeDto> {
  const { data, error } = await clientChargesControllerGet({ path: { tenantId, chargeId }, signal: options?.signal });
  if (error || !data) throw unwrapError(error, 400);
  return data.charge;
}

/** Record a charge: 201 `{charge, warnings}` — approved at record or pending. */
export async function fetchApiRecordClientCharge(tenantId: string, body: RecordClientChargeDto, idempotencyKey: string): Promise<RecordClientChargeResponse> {
  const { data, error } = await clientChargesControllerRecord({ path: { tenantId }, body, headers: { 'Idempotency-Key': idempotencyKey } });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

export async function fetchApiApproveClientCharge(tenantId: string, chargeId: string, idempotencyKey: string): Promise<ClientChargeDto> {
  const { data, error } = await clientChargesControllerApprove({ path: { tenantId, chargeId }, headers: { 'Idempotency-Key': idempotencyKey } });
  if (error || !data) throw unwrapError(error, 400);
  return data.charge;
}

export async function fetchApiRejectClientCharge(tenantId: string, chargeId: string, note: string, idempotencyKey: string): Promise<ClientChargeDto> {
  const { data, error } = await clientChargesControllerReject({ path: { tenantId, chargeId }, body: { note }, headers: { 'Idempotency-Key': idempotencyKey } });
  if (error || !data) throw unwrapError(error, 400);
  return data.charge;
}

export async function fetchApiCancelClientCharge(tenantId: string, chargeId: string, note: string, idempotencyKey: string): Promise<ClientChargeDto> {
  const { data, error } = await clientChargesControllerCancel({ path: { tenantId, chargeId }, body: { note }, headers: { 'Idempotency-Key': idempotencyKey } });
  if (error || !data) throw unwrapError(error, 400);
  return data.charge;
}

/** The self-approval limit (no setting = ₹10,000, `isDefault`). */
export async function fetchApiClientChargePolicy(tenantId: string, options?: { signal?: AbortSignal }): Promise<ChargePolicyResponse> {
  const { data, error } = await clientChargesControllerGetPolicy({ path: { tenantId }, signal: options?.signal });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

export async function fetchApiPutClientChargePolicy(tenantId: string, selfApproveLimitPaise: number, idempotencyKey: string): Promise<ChargePolicyResponse> {
  const { data, error } = await clientChargesControllerPutPolicy({
    path: { tenantId },
    body: { selfApproveLimitPaise },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
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

/**
 * Story 21-4 — a client's metered usage over an inclusive IST date period
 * (`from`/`to` are `YYYY-MM-DD`): each charge's quantity per rate-card
 * segment, with its rate and GST-exclusive amount — an estimate until
 * invoiced. Member-open.
 */
export async function fetchApiClientUsage(
  tenantId: string,
  clientId: string,
  period: { from: string; to: string },
  options?: { signal?: AbortSignal },
): Promise<ClientUsageResponse> {
  const { data, error } = await billingUsageControllerUsage({
    path: { tenantId, clientId },
    query: { from: period.from, to: period.to },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 21-8 — one client's service report (dock-to-stock, pick accuracy,
 * dispatch timeliness) over an inclusive IST date period, optionally one
 * warehouse (absent: every warehouse). Member-open; the portal's
 * `fetchApiPortalService` answers the identical body for its own client.
 */
export async function fetchApiClientServiceReport(
  tenantId: string,
  clientId: string,
  period: { from: string; to: string; warehouseId?: string | null },
  options?: { signal?: AbortSignal },
): Promise<ServiceReportDto> {
  const { data, error } = await reportingControllerClientService({
    path: { tenantId, clientId },
    query: serviceQuery(period),
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 9-3a — one page of the tenant's audit trail (owner-only, `audit.view`;
 * any other role is 403 `role-denied`). Every filter is optional and sent only
 * when present; the cursor goes back verbatim.
 */
export async function fetchApiAuditTrail(
  tenantId: string,
  query: Omit<NonNullable<ReportingControllerAuditData['query']>, 'cursor' | 'limit'>,
  options?: { cursor?: string; limit?: number; signal?: AbortSignal },
): Promise<AuditTrailResponse> {
  const { data, error } = await reportingControllerAudit({
    path: { tenantId },
    query: definedQuery({
      actorUserId: query.actorUserId,
      actionPrefix: query.actionPrefix,
      targetType: query.targetType,
      targetId: query.targetId,
      from: query.from,
      to: query.to,
      cursor: options?.cursor,
      limit: options?.limit,
    }),
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 9-3b — queues an export of the audit trail under the APPLIED filters
 * (owner-only). The caller mints a fresh Idempotency-Key per click: a key
 * reused across clicks would replay the first export's stale `queued`
 * snapshot. Always 202.
 */
export async function fetchApiRequestAuditExport(
  tenantId: string,
  body: AuditExportRequestDto,
  idempotencyKey: string,
): Promise<AuditExportDto> {
  const { data, error, response } = await reportingControllerRequestAuditExport({
    path: { tenantId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, response?.status ?? 400);
  }
  return data;
}

/** Story 9-3b — the caller's own last 20 audit exports, newest first (unpaged). */
export async function fetchApiAuditExports(tenantId: string, options?: { signal?: AbortSignal }): Promise<AuditExportListResponse> {
  const { data, error, response } = await reportingControllerListAuditExports({
    path: { tenantId },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, response?.status ?? 400);
  }
  return data;
}

/**
 * Story 9-3b — a ready export's file, as a Blob (`parseAs: 'blob'`). The
 * server sends the gzipped CSV with `Content-Encoding: gzip`, so the
 * browser's fetch hands back the inflated CSV. A refusal (404, 409) is still
 * problem+json — the generated client parses an error body as JSON whatever
 * `parseAs` says — and becomes an `ApiProblem`.
 */
export async function fetchApiAuditExportFile(tenantId: string, exportId: string): Promise<Blob> {
  const { data, error, response } = await reportingControllerDownloadAuditExport({
    path: { tenantId, exportId },
    parseAs: 'blob',
  });
  if (error || !data) {
    throw unwrapError(error, response?.status ?? 400);
  }
  return data;
}

/**
 * Story 9-3c — the tenant's ledger integrity status, one row per warehouse
 * (owner-only: `audit.view`). Unpaged — the backend bounds it by the
 * warehouse count.
 */
export async function fetchApiLedgerIntegrity(tenantId: string, options?: { signal?: AbortSignal }): Promise<LedgerIntegrityResponse> {
  const { data, error, response } = await inventoryControllerLedgerIntegrity({
    path: { tenantId },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, response?.status ?? 400);
  }
  return data;
}

/** Story 9-3c — one warehouse's anchors, newest range first (keyset cursor). */
export async function fetchApiLedgerAnchors(
  tenantId: string,
  warehouseId: string,
  query: { cursor?: string; limit?: number },
): Promise<LedgerAnchorListResponse> {
  const { data, error, response } = await inventoryControllerLedgerAnchors({
    path: { tenantId, warehouseId },
    query,
  });
  if (error || !data) {
    throw unwrapError(error, response?.status ?? 400);
  }
  return data;
}

/** Story 5-3a — the five operational registers and the two file formats (the generated unions). */
export type ReportName = ReportingControllerDownloadRegisterData['path']['report'];
export type ReportFormat = ReportingControllerDownloadRegisterData['query']['format'];

/**
 * Story 5-3a — one operational register as a file, as a Blob (`parseAs:
 * 'blob'`), saved byte for byte as the server built it (the bearer header
 * rules out a plain link). Only the set filters are sent: `clientId` when a
 * client is picked, `from`/`to` for a dated register. A refusal is still
 * problem+json and becomes an `ApiProblem`.
 */
export async function fetchApiReportFile(
  tenantId: string,
  warehouseId: string,
  report: ReportName,
  query: { format: ReportFormat; clientId: string | null; period: { from: string; to: string } | null },
): Promise<Blob> {
  const { data, error, response } = await reportingControllerDownloadRegister({
    path: { tenantId, warehouseId, report },
    query: {
      format: query.format,
      ...(query.clientId === null ? {} : { clientId: query.clientId }),
      ...(query.period === null ? {} : { from: query.period.from, to: query.period.to }),
    },
    parseAs: 'blob',
  });
  if (error || !data) {
    throw unwrapError(error, response?.status ?? 400);
  }
  return data as unknown as Blob;
}

/**
 * Story 9-3c — one anchored range's proof file, as a Blob (`parseAs:
 * 'blob'`) so it is saved byte for byte as the server wrote it. A refusal is
 * still problem+json and becomes an `ApiProblem`.
 */
export async function fetchApiLedgerProof(tenantId: string, warehouseId: string, anchorId: string): Promise<Blob> {
  const { data, error, response } = await inventoryControllerLedgerProof({
    path: { tenantId, warehouseId, anchorId },
    parseAs: 'blob',
  });
  if (error || !data) {
    throw unwrapError(error, response?.status ?? 400);
  }
  return data as unknown as Blob;
}

/** Story 9-3c — the owner acknowledges a chain break (a fresh key per click). Acknowledging repairs nothing. */
export async function fetchApiAcknowledgeChainBreak(
  tenantId: string,
  warehouseId: string,
  breakId: string,
  idempotencyKey: string,
): Promise<ChainBreakDto> {
  const { data, error, response } = await inventoryControllerAcknowledgeChainBreak({
    path: { tenantId, warehouseId, breakId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, response?.status ?? 400);
  }
  return data;
}

/** The service report's query: the period, plus the warehouse only when one is chosen (never `warehouseId=`). */
function serviceQuery(period: { from: string; to: string; warehouseId?: string | null }): { from: string; to: string; warehouseId?: string } {
  return {
    from: period.from,
    to: period.to,
    ...(period.warehouseId === undefined || period.warehouseId === null ? {} : { warehouseId: period.warehouseId }),
  };
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
  options?: { cursor?: string; /** Story 1-5a — one client's rows; sent only when set. */ clientId?: string; signal?: AbortSignal },
): Promise<ProductListResponse> {
  const { data, error } = await catalogControllerListProducts({
    path: { tenantId },
    query: definedQuery({ cursor: options?.cursor, clientId: options?.clientId }),
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
  options?: { cursor?: string; /** Story 1-5a — one client's rows; sent only when set. */ clientId?: string; signal?: AbortSignal },
): Promise<KitListResponse> {
  const { data, error } = await catalogControllerListKits({
    path: { tenantId },
    query: definedQuery({ cursor: options?.cursor, clientId: options?.clientId }),
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

/**
 * Story 6-1a — offboarding: deactivate ends every session of the user now;
 * reactivate restores them (a never-accepted invitee comes back with a fresh
 * invite token). `users.role_change`.
 */
export async function fetchApiSetUserActive(
  tenantId: string,
  userId: string,
  active: boolean,
  idempotencyKey: string,
): Promise<UserStatusResponse> {
  const options = { path: { tenantId, userId }, headers: { 'Idempotency-Key': idempotencyKey } };
  const { data, error } = active ? await usersControllerReactivateUser(options) : await usersControllerDeactivateUser(options);
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 5-1a — sends an invited user a new invitation (`users.invite`, owner):
 * a fresh token and link (the old link stops working) and a new invite email.
 */
export async function fetchApiResendInvite(
  tenantId: string,
  userId: string,
  idempotencyKey: string,
): Promise<InviteUserResponse> {
  const { data, error } = await usersControllerResendInvite({
    path: { tenantId, userId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 6-1a — clears a user's sign-in lock (`users.role_change`). */
export async function fetchApiUnlockUser(tenantId: string, userId: string, idempotencyKey: string): Promise<UserResponse> {
  const { data, error } = await usersControllerUnlockUser({
    path: { tenantId, userId },
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

/**
 * Story 6-1a — supervisor device actions (`device.manage`): Release ends the
 * badge session and frees the device for another operator; Unlock clears the
 * wrong-PIN lock.
 */
export async function fetchApiDeviceAction(
  tenantId: string,
  deviceId: string,
  action: 'release' | 'unlock',
  idempotencyKey: string,
): Promise<DeviceResponse> {
  const options = { path: { tenantId, deviceId }, headers: { 'Idempotency-Key': idempotencyKey } };
  const { data, error } =
    action === 'release' ? await devicesControllerReleaseDevice(options) : await devicesControllerUnlockDevice(options);
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

// ── Inbound + receiving (stories 3.1 / 3.3) ─────────────────────────────────

// ── Business partners (story 1-3) ───────────────────────────────────────────

/** The partner list's filters (every one optional; `clientId` = an ACTIVE link to that client). */
export interface PartnerListOptions {
  role?: 'vendor' | 'consignee' | 'transporter';
  clientId?: string;
  status?: 'active' | 'inactive';
  q?: string;
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}

/** Story 1-3 — `GET /partners`: a keyset page by code, each partner with its client links. */
export async function fetchApiListPartners(tenantId: string, options?: PartnerListOptions): Promise<PartnerListResponse> {
  const query = {
    ...(options?.role === undefined ? {} : { role: options.role }),
    ...(options?.clientId === undefined ? {} : { clientId: options.clientId }),
    ...(options?.status === undefined ? {} : { status: options.status }),
    ...(options?.q === undefined ? {} : { q: options.q }),
    ...(options?.cursor === undefined ? {} : { cursor: options.cursor }),
    ...(options?.limit === undefined ? {} : { limit: options.limit }),
  };
  const { data, error } = await partnersControllerListPartners({
    path: { tenantId },
    query: Object.keys(query).length === 0 ? undefined : query,
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

export async function fetchApiCreatePartner(tenantId: string, body: CreatePartnerDto, idempotencyKey: string): Promise<PartnerDto> {
  const { data, error } = await partnersControllerCreatePartner({
    path: { tenantId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.partner;
}

/** Tri-state PATCH: an absent key is unchanged, `null` clears it. */
export async function fetchApiUpdatePartner(
  tenantId: string,
  partnerId: string,
  body: UpdatePartnerDto,
  idempotencyKey: string,
): Promise<PartnerDto> {
  const { data, error } = await partnersControllerUpdatePartner({
    path: { tenantId, partnerId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.partner;
}

export async function fetchApiUpdatePartnerStatus(
  tenantId: string,
  partnerId: string,
  body: UpdatePartnerStatusDto,
  idempotencyKey: string,
): Promise<PartnerDto> {
  const { data, error } = await partnersControllerUpdatePartnerStatus({
    path: { tenantId, partnerId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.partner;
}

export async function fetchApiCreatePartnerLink(
  tenantId: string,
  partnerId: string,
  body: CreatePartnerLinkDto,
  idempotencyKey: string,
): Promise<PartnerDto> {
  const { data, error } = await partnersControllerCreatePartnerLink({
    path: { tenantId, partnerId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.partner;
}

export async function fetchApiUpdatePartnerLink(
  tenantId: string,
  partnerId: string,
  linkId: string,
  body: UpdatePartnerLinkDto,
  idempotencyKey: string,
): Promise<PartnerDto> {
  const { data, error } = await partnersControllerUpdatePartnerLink({
    path: { tenantId, partnerId, linkId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data.partner;
}

export async function fetchApiListPurchaseOrders(
  tenantId: string,
  warehouseId: string,
  options?: { cursor?: string; status?: 'open' | 'closed'; limit?: number; /** Story 1-5a — one client's POs; sent only when set. */ clientId?: string; signal?: AbortSignal },
): Promise<PurchaseOrderListResponse> {
  const query = {
    ...(options?.cursor === undefined ? {} : { cursor: options.cursor }),
    ...(options?.status === undefined ? {} : { status: options.status }),
    ...(options?.limit === undefined ? {} : { limit: options.limit }),
    ...(options?.clientId === undefined ? {} : { clientId: options.clientId }),
  };
  const { data, error } = await inboundControllerListPurchaseOrders({
    path: { tenantId, warehouseId },
    query: Object.keys(query).length === 0 ? undefined : query,
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 21-6 — one warehouse's advance shipment notices (keyset, newest
 * first), optionally one status's or one client's. Member-open; a client-
 * portal session answers 403 until 21-7.
 */
export async function fetchApiListAsns(
  tenantId: string,
  warehouseId: string,
  options?: {
    status?: 'announced' | 'partially_received' | 'received' | 'closed' | 'cancelled';
    clientId?: string;
    cursor?: string;
    limit?: number;
    signal?: AbortSignal;
  },
): Promise<AsnListResponse> {
  const query = {
    ...(options?.status === undefined ? {} : { status: options.status }),
    ...(options?.clientId === undefined ? {} : { clientId: options.clientId }),
    ...(options?.cursor === undefined ? {} : { cursor: options.cursor }),
    ...(options?.limit === undefined ? {} : { limit: options.limit }),
  };
  const { data, error } = await inboundControllerListAsns({
    path: { tenantId, warehouseId },
    query: Object.keys(query).length === 0 ? undefined : query,
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 21-6 — one ASN with its lines (announced / received / open). */
export async function fetchApiGetAsn(
  tenantId: string,
  asnId: string,
  options?: { signal?: AbortSignal },
): Promise<AsnResponse> {
  const { data, error } = await inboundControllerGetAsn({ path: { tenantId, asnId }, signal: options?.signal });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 21-6 — announces a shipment (capability `asn.manage`); the key is per draft. */
export async function fetchApiCreateAsn(
  tenantId: string,
  body: CreateAsnDto,
  idempotencyKey: string,
): Promise<AsnResponse> {
  const { data, error } = await inboundControllerCreateAsn({
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
 * The ASN import (2026-10-17) — `POST …/inbound/asn-imports` (`asn.manage`),
 * multipart: the file, the warehouse every ASN lands in, and the step.
 * `{ dryRun: true }` is Check file: it writes nothing and sends NO
 * Idempotency-Key. `{ dryRun: false, idempotencyKey }` is Import: the key is
 * minted once per checked file and reused until another file is picked, so
 * an Import retried after a timeout replays the stored answer.
 */
export async function fetchApiImportAsns(
  tenantId: string,
  file: File,
  warehouseId: string,
  step: { readonly dryRun: true } | { readonly dryRun: false; readonly idempotencyKey: string },
): Promise<AsnImportResponseDto> {
  const { data, error } = await inboundControllerImportAsns({
    path: { tenantId },
    body: { file, warehouseId, ...(step.dryRun ? { dryRun: 'true' as const } : {}) },
    ...(step.dryRun ? {} : { headers: { 'Idempotency-Key': step.idempotencyKey } }),
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 4-1c — one step of an order import: Check file (no key) or Import (the checked file's key). */
export type OrderImportStep = { readonly dryRun: true } | { readonly dryRun: false; readonly idempotencyKey: string };

/**
 * Story 4-1c — the staff order import (`orders.manage`): Check file
 * (`dryRun`, 200, nothing written) or Import (201 complete, 200 when the
 * server's time budget stopped it — `complete: false`).
 */
export async function fetchApiImportOrders(
  tenantId: string,
  file: File,
  warehouseId: string,
  step: OrderImportStep,
): Promise<OrderImportResponseDto> {
  const { data, error } = await outboundControllerImportOrders({
    path: { tenantId },
    body: { file, warehouseId, ...(step.dryRun ? { dryRun: 'true' as const } : {}) },
    ...(step.dryRun ? {} : { headers: { 'Idempotency-Key': step.idempotencyKey } }),
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 4-1c — the client portal's order import (`orders.place`; the client is the session's). */
export async function fetchApiPortalImportOrders(
  tenantId: string,
  file: File,
  warehouseId: string,
  step: OrderImportStep,
): Promise<PortalOrderImportResponseDto> {
  const { data, error } = await portalControllerImportOrders({
    path: { tenantId },
    body: { file, warehouseId, ...(step.dryRun ? { dryRun: 'true' as const } : {}) },
    ...(step.dryRun ? {} : { headers: { 'Idempotency-Key': step.idempotencyKey } }),
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 21-6 — amends an open ASN: `expectedAt` and the FULL line set (`asn.manage`). */
export async function fetchApiAmendAsn(
  tenantId: string,
  asnId: string,
  body: AmendAsnDto,
  idempotencyKey: string,
): Promise<AsnResponse> {
  const { data, error } = await inboundControllerAmendAsn({
    path: { tenantId, asnId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 21-6 — closes a partially received ASN short, or cancels an untouched one, with a note (`asn.manage`). */
export async function fetchApiTransitionAsn(
  tenantId: string,
  asnId: string,
  transition: 'close' | 'cancel',
  note: string,
  idempotencyKey: string,
): Promise<AsnResponse> {
  const call = transition === 'close' ? inboundControllerCloseAsn : inboundControllerCancelAsn;
  const { data, error } = await call({
    path: { tenantId, asnId },
    body: { note },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 2-1 — raises a purchase order (capability `po.manage`) on the
 * existing create route; the body is `CreatePurchaseOrderDto` as is (no
 * `clientId` — the server derives it from the SKUs). The key is per draft.
 */
export async function fetchApiCreatePurchaseOrder(
  tenantId: string,
  body: CreatePurchaseOrderDto,
  idempotencyKey: string,
): Promise<PurchaseOrderResponse> {
  const { data, error } = await inboundControllerCreatePurchaseOrder({
    path: { tenantId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 2-3a — the gate-in statuses (`GATE_IN_STATUSES`). */
export type GateInStatus = GateInListResponse['items'][number]['status'];

/**
 * Story 2-3a — records a gate-in (`gate.manage`): one inbound vehicle visit.
 * The key is per draft (reused on a retry of the unchanged draft).
 */
export async function fetchApiCreateGateIn(
  tenantId: string,
  body: CreateGateInDto,
  idempotencyKey: string,
): Promise<GateInResponse> {
  const { data, error } = await gateInControllerCreate({
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
 * Story 2-3a — amends a gate-in: a FULL replacement of the header (a blank
 * optional becomes null) and of the document set; `gatedInAt` absent leaves
 * the time unchanged.
 */
export async function fetchApiAmendGateIn(
  tenantId: string,
  gateInId: string,
  body: AmendGateInDto,
  idempotencyKey: string,
): Promise<GateInResponse> {
  const { data, error } = await gateInControllerAmend({
    path: { tenantId, gateInId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 2-3a — records the unload start, or its end with the packages counted
 * (the WEB route). `applied: false` means the first record stands and
 * nothing changed — never a success.
 */
export async function fetchApiUnloadGateIn(
  tenantId: string,
  gateInId: string,
  body: UnloadGateInDto,
  idempotencyKey: string,
): Promise<GateInUnloadResponse> {
  const { data, error } = await gateInControllerUnloadWeb({
    path: { tenantId, gateInId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 2-3a — gates a gate-in out (closes the visit; no further edits). */
export async function fetchApiGateOutGateIn(
  tenantId: string,
  gateInId: string,
  body: GateOutDto,
  idempotencyKey: string,
): Promise<GateInResponse> {
  const { data, error } = await gateInControllerGateOut({
    path: { tenantId, gateInId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 2-3a — one warehouse's gate-ins, newest `gatedInAt` first. `status`
 * repeats on the wire (`?status=gated_in&status=unloading`); no client filter
 * (a truck can carry several clients).
 */
export async function fetchApiListGateIns(
  tenantId: string,
  warehouseId: string,
  options?: { status?: readonly GateInStatus[]; cursor?: string; limit?: number; signal?: AbortSignal },
): Promise<GateInListResponse> {
  const { data, error } = await gateInControllerList({
    path: { tenantId },
    query: {
      warehouseId,
      ...(options?.status === undefined || options.status.length === 0 ? {} : { status: [...options.status] }),
      ...(options?.cursor === undefined ? {} : { cursor: options.cursor }),
      ...(options?.limit === undefined ? {} : { limit: options.limit }),
    },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 2-3a — one gate-in with its documents (PO/ASN codes) and its linked receipts. */
export async function fetchApiGetGateIn(
  tenantId: string,
  gateInId: string,
  options?: { signal?: AbortSignal },
): Promise<GateInDetailResponse> {
  const { data, error } = await gateInControllerGet({ path: { tenantId, gateInId }, signal: options?.signal });
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
  options?: {
    warehouseId?: string;
    /** Story 9-1b — the drill's filters (21-6 `blind`; 9-1 `from`/`to`). */
    blind?: boolean;
    from?: string;
    to?: string;
    /** Story 1-5a — the client switcher: one client's rows (filtered server-side); sent only when set. */
    clientId?: string;
    cursor?: string;
    signal?: AbortSignal;
  },
): Promise<GoodsReceiptListResponse> {
  const query = definedQuery({
    warehouseId: options?.warehouseId,
    blind: options?.blind,
    from: options?.from,
    to: options?.to,
    cursor: options?.cursor,
    clientId: options?.clientId,
  });
  const { data, error } = await receivingControllerListGoodsReceipts({
    path: { tenantId },
    query,
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 9-1b — the warehouse's derived putaway tasks (one per GRN line whose
 * applied stock still sits in the system Receiving bin), oldest receipt
 * first. Unpaged: the route returns `{items}` and takes only the warehouse.
 * Arms: 400 malformed warehouseId, 404 a foreign warehouse.
 */
export async function fetchApiListPutawayTasks(
  tenantId: string,
  warehouseId: string,
  options?: { /** Story 1-5a — one client's tasks; sent only when set. */ clientId?: string; signal?: AbortSignal },
): Promise<PutawayTaskListResponse> {
  const { data, error } = await putawayControllerListPutawayTasks({
    path: { tenantId },
    query: { warehouseId, ...(options?.clientId === undefined ? {} : { clientId: options.clientId }) },
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
  options?: {
    status?: 'pending' | 'approved' | 'rejected';
    /** Story 9-1b — the drill's filters (9-1). */
    warehouseId?: string;
    from?: string;
    to?: string;
    /** Story 1-5a — the client switcher: one client's rows (filtered server-side); sent only when set. */
    clientId?: string;
    cursor?: string;
    signal?: AbortSignal;
  },
): Promise<OverReceiptListResponse> {
  const query = definedQuery({
    status: options?.status,
    warehouseId: options?.warehouseId,
    from: options?.from,
    to: options?.to,
    cursor: options?.cursor,
    clientId: options?.clientId,
  });
  const { data, error } = await receivingControllerListOverReceipts({
    path: { tenantId },
    query,
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
    /** Story 2-8a — `inspected` added; `closed` = released or inspected (the Closed tab). */
    status?: 'open' | 'released' | 'inspected' | 'closed';
    /** Story 1-2b — only one goods receipt's QC-on-receipt holds. */
    grnId?: string;
    /** Story 1-5a — the client switcher: one client's rows (filtered server-side); sent only when set. */
    clientId?: string;
    cursor?: string;
    limit?: number;
    signal?: AbortSignal;
  },
): Promise<QcHoldListResponse> {
  const query = {
    ...(options?.warehouseId === undefined ? {} : { warehouseId: options.warehouseId }),
    ...(options?.status === undefined ? {} : { status: options.status }),
    ...(options?.grnId === undefined ? {} : { grnId: options.grnId }),
    ...(options?.cursor === undefined ? {} : { cursor: options.cursor }),
    ...(options?.limit === undefined ? {} : { limit: options.limit }),
    ...(options?.clientId === undefined ? {} : { clientId: options.clientId }),
  };
  const { data, error } = await receivingControllerListQcHolds({
    path: { tenantId },
    query: Object.keys(query).length === 0 ? undefined : query,
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
 * Story 2-8a — one QC hold with the batch arms it moved (code, expiry,
 * quantity) and, once inspected, its inspection. Any member may read it.
 */
export async function fetchApiGetQcHold(tenantId: string, holdId: string, signal?: AbortSignal): Promise<QcHoldDetailResponse> {
  const { data, error } = await receivingControllerGetQcHold({ path: { tenantId, holdId }, signal });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 2-8a — records a hold's inspection outcome (capability `qc.manage`):
 * per held arm, passed units go back to the origin and failed units to the
 * DAMAGED bin with a reason; the hold closes `inspected`. 422
 * `qc-inspection-mismatch` when the lines do not cover the held arms exactly.
 */
export async function fetchApiInspectQcHold(
  tenantId: string,
  holdId: string,
  body: InspectQcHoldDto,
  idempotencyKey: string,
): Promise<InspectQcHoldResponse> {
  const { data, error } = await receivingControllerInspectQcHold({
    path: { tenantId, holdId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 1-2b — release every open QC-on-receipt hold of one goods receipt
 * (capability `qc.manage`) in one transaction. 409 `qc-hold-released` when
 * the receipt has no open receipt hold.
 */
export async function fetchApiReleaseReceiptQcHolds(
  tenantId: string,
  grnId: string,
  idempotencyKey: string,
): Promise<ReleaseReceiptHoldsResponse> {
  const { data, error } = await receivingControllerReleaseReceiptHolds({
    path: { tenantId },
    body: { grnId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * The on-hand stock rows (story 2.2 read) for the QC hold form's scope
 * choices — the (sku, bin) scopes with on-hand to hold. Inventory-screen adds
 * `limit`, `order: 'location'` (bin by bin; the items then carry `binCode`
 * and `binSystemOwned`) and `nonZero`. A first page with no option sends no
 * query at all, as before.
 */
export async function fetchApiListStock(
  tenantId: string,
  warehouseId: string,
  options?: {
    skuId?: string;
    binId?: string;
    cursor?: string;
    limit?: number;
    order?: 'location';
    nonZero?: boolean;
    /** Story 1-5a — the client switcher: one client's rows (filtered server-side); sent only when set. */
    clientId?: string;
    signal?: AbortSignal;
  },
): Promise<StockListResponse> {
  const query = {
    ...(options?.skuId === undefined ? {} : { skuId: options.skuId }),
    ...(options?.binId === undefined ? {} : { binId: options.binId }),
    ...(options?.cursor === undefined ? {} : { cursor: options.cursor }),
    ...(options?.limit === undefined ? {} : { limit: options.limit }),
    ...(options?.order === undefined ? {} : { order: options.order }),
    ...(options?.nonZero === undefined ? {} : { nonZero: options.nonZero }),
    ...(options?.clientId === undefined ? {} : { clientId: options.clientId }),
  };
  const { data, error } = await inventoryControllerListStock({
    path: { tenantId, warehouseId },
    query: Object.keys(query).length === 0 ? undefined : query,
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Inventory-screen — one SKU's batches in a warehouse, FEFO (expiry ASC,
 * nulls last), each with its on-hand here (0 when none). Unpaged; `skuId` is
 * required by the backend.
 */
export async function fetchApiListBatches(
  tenantId: string,
  warehouseId: string,
  skuId: string,
  options?: { signal?: AbortSignal; binId?: string },
): Promise<BatchListResponse> {
  const { data, error } = await inventoryControllerListBatches({
    path: { tenantId, warehouseId },
    // Story 2-4a — `binId` narrows each batch's on-hand to one bin (the
    // damaged write-off lists the DAMAGED bin's batches); absent = the warehouse.
    query: options?.binId === undefined ? { skuId } : { skuId, binId: options.binId },
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 3-3a — block a batch (a lot) in every warehouse, with a reason
 * (`qc.manage`). Keyed per draft (reused on a retry of the unchanged draft,
 * cleared on any edit — reason and note are in the server's hash). 201 with
 * the batch's lifecycle view.
 */
export async function fetchApiBlockBatch(
  tenantId: string,
  batchId: string,
  body: BlockBatchDto,
  idempotencyKey: string,
): Promise<BatchBlockResponse> {
  const { data, error } = await inventoryControllerBlockBatch({
    path: { tenantId, batchId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 3-3a — unblock a batch, with a required note (`qc.manage`). Keyed per draft. */
export async function fetchApiUnblockBatch(
  tenantId: string,
  batchId: string,
  body: UnblockBatchDto,
  idempotencyKey: string,
): Promise<BatchBlockResponse> {
  const { data, error } = await inventoryControllerUnblockBatch({
    path: { tenantId, batchId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

// ── story 3-7a — batch recalls ──────────────────────────────────────────────

export type RecallListQuery = NonNullable<RecallsControllerListData['query']>;

/** The tenant's recalls, newest first; only the set filters are sent (a first page sends no cursor). */
export async function fetchApiListRecalls(
  tenantId: string,
  query: RecallListQuery,
  options?: { signal?: AbortSignal },
): Promise<RecallListResponse> {
  const sent = Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== ''));
  const { data, error } = await recallsControllerList({
    path: { tenantId },
    query: Object.keys(sent).length === 0 ? undefined : (sent as RecallListQuery),
    signal: options?.signal,
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** One client's lots matching a lot code (exact or normalised) — the open dialog's checklist. */
export async function fetchApiRecallCandidates(
  tenantId: string,
  clientId: string,
  code: string,
  options?: { signal?: AbortSignal },
): Promise<RecallCandidatesResponse> {
  const { data, error } = await recallsControllerCandidates({ path: { tenantId }, query: { clientId, code }, signal: options?.signal });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Open a recall (`qc.manage`) — keyed per draft. */
export async function fetchApiOpenRecall(tenantId: string, body: OpenRecallDto, idempotencyKey: string): Promise<RecallResponse> {
  const { data, error } = await recallsControllerOpen({ path: { tenantId }, body, headers: { 'Idempotency-Key': idempotencyKey } });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** One recall: header, lots and live figures, where it sits, held orders, planned picks. */
export async function fetchApiRecallDetail(tenantId: string, recallId: string, options?: { signal?: AbortSignal }): Promise<RecallDetailResponse> {
  const { data, error } = await recallsControllerDetail({ path: { tenantId, recallId }, signal: options?.signal });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

type TracePage = { cursor?: string; limit?: number; signal?: AbortSignal };

function tracePageQuery(options?: TracePage): { cursor?: string; limit?: number } | undefined {
  if (options?.cursor === undefined && options?.limit === undefined) return undefined;
  return {
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  };
}

/** Every bin holding a lot of the recall (staff only), paged. */
export async function fetchApiRecallBins(tenantId: string, recallId: string, options?: TracePage): Promise<RecallBinsResponse> {
  const { data, error } = await recallsControllerBins({ path: { tenantId, recallId }, query: tracePageQuery(options), signal: options?.signal });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Where the recalled lots went — one row per dispatched pick, paged. */
export async function fetchApiRecallShipments(tenantId: string, recallId: string, options?: TracePage): Promise<RecallShipmentsResponse> {
  const { data, error } = await recallsControllerShipments({ path: { tenantId, recallId }, query: tracePageQuery(options), signal: options?.signal });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Where the recalled lots came from — one row per goods receipt, paged. */
export async function fetchApiRecallReceipts(tenantId: string, recallId: string, options?: TracePage): Promise<RecallReceiptsResponse> {
  const { data, error } = await recallsControllerReceipts({ path: { tenantId, recallId }, query: tracePageQuery(options), signal: options?.signal });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/**
 * The recall report as a file (CSV streams every row; XLSX at most 200,000
 * rows), as a Blob (`parseAs: 'blob'`, the `fetchApiBinLabels` pattern). A
 * refusal is still problem+json and becomes an `ApiProblem`. The server's
 * filename is not readable cross-origin — the caller names the file
 * (`recallReportFilename`). Every download is audited server-side.
 */
export async function fetchApiRecallReport(tenantId: string, recallId: string, format: 'csv' | 'xlsx'): Promise<Blob> {
  const { data, error, response } = await recallsControllerReport({ path: { tenantId, recallId }, query: { format }, parseAs: 'blob' });
  if (error || !data) throw unwrapError(error, response?.status ?? 400);
  return data as unknown as Blob;
}

/** Add lots to an open recall (`qc.manage`) — keyed per draft. */
export async function fetchApiAddRecallBatches(
  tenantId: string,
  recallId: string,
  body: AddRecallBatchesDto,
  idempotencyKey: string,
): Promise<RecallResponse> {
  const { data, error } = await recallsControllerAddBatches({ path: { tenantId, recallId }, body, headers: { 'Idempotency-Key': idempotencyKey } });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Close a recall (`qc.manage`) — freezes the figures, releases the named lots; keyed per draft. */
export async function fetchApiCloseRecall(tenantId: string, recallId: string, body: CloseRecallDto, idempotencyKey: string): Promise<RecallResponse> {
  const { data, error } = await recallsControllerClose({ path: { tenantId, recallId }, body, headers: { 'Idempotency-Key': idempotencyKey } });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/**
 * Story 3-1 — move stock between two bins of one warehouse (`stock.move`).
 * The key is per draft (reused on a retry of the unchanged draft, cleared on
 * any edit — every field is in the server's hash). A web move sends no
 * `occurredAt` (the server refuses it from a web session — the move happens now).
 */
export async function fetchApiMoveStock(
  tenantId: string,
  warehouseId: string,
  body: MoveStockDto,
  idempotencyKey: string,
): Promise<MoveStockResponse> {
  const { data, error } = await movementsControllerMoveStock({
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
 * One warehouse's order page (story 4.1 read, surfaced by 4.2b) — newest
 * first, keyset cursor. The endpoint offers `cursor` + `limit` and nothing
 * else: no status filter, no sort, no search. The surface's status control is
 * therefore page-scoped and says so, rather than pretending to search the
 * whole warehouse.
 */
export async function fetchApiListOrders(
  tenantId: string,
  warehouseId: string,
  options?: {
    /** Story 9-1b — the drill's filters (9-1); the normal view sends none. */
    status?: 'accepted' | 'ready_to_dispatch' | 'dispatched' | 'cancelled';
    source?: 'manual' | 'ingested';
    backordered?: boolean;
    /** Story 4-2c — `true`: only backorder follow-ons; `false`: only root orders (the SM-4 drill). */
    followOn?: boolean;
    from?: string;
    to?: string;
    /** Story 1-5a — the client switcher: one client's rows (filtered server-side); sent only when set. */
    clientId?: string;
    /** Story 4-1b — the exact-match search (a client order number or a channel reference); sent only when set. */
    reference?: string;
    cursor?: string;
    limit?: number;
    signal?: AbortSignal;
  },
): Promise<OrderListResponse> {
  const query = definedQuery({
    reference: options?.reference,
    status: options?.status,
    source: options?.source,
    backordered: options?.backordered,
    followOn: options?.followOn,
    from: options?.from,
    to: options?.to,
    cursor: options?.cursor,
    clientId: options?.clientId,
    limit: options?.limit,
  });
  const { data, error } = await outboundControllerListOrders({
    path: { tenantId, warehouseId },
    query,
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
 * Story 4-2c — "Allocate now" (capability `orders.manage`): reserves what is
 * free now for an accepted order's lines that hold nothing (backordered at
 * acceptance, or a follow-on). A 200 may reserve nothing (`allocated: []`) —
 * that is an outcome, not an error. Refusals: 409 `order-not-accepted`, 409
 * `order-on-open-wave` (`extensions.waveId`), 503
 * `reservation-store-unavailable`, 404. The key is the caller's per-click key.
 */
export async function fetchApiAllocateOrder(
  tenantId: string,
  orderId: string,
  idempotencyKey: string,
): Promise<AllocateOrderResponse> {
  const { data, error } = await outboundControllerAllocateOrder({
    path: { tenantId, orderId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 4-2b — cancels an accepted or packed order and RESTOCKS it
 * (capability `orders.manage`): every drawn unit goes back to stock in one
 * transaction — to the bin it was drawn from, or, with `restockBinId`, all
 * into that one storage bin — the order's holds are released, a labelled
 * (unmanifested) shipment is voided. `restock` is null only for the
 * already-cancelled no-op. The key is the caller's per-draft key.
 */
export async function fetchApiCancelOrderWithRestock(
  tenantId: string,
  orderId: string,
  body: { restockBinId?: string | null },
  idempotencyKey: string,
): Promise<CancelWithRestockResponse> {
  const { data, error } = await outboundControllerCancelOrderWithRestock({
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
 * Story 4-2b — what a cancel-with-restock would put back (`lines`, the
 * order's draws not yet restocked) and what one already put back
 * (`restocked`), plus the order's shipment. A READ: no capability, no key.
 */
export async function fetchApiGetRestockPlan(
  tenantId: string,
  orderId: string,
  options?: { signal?: AbortSignal },
): Promise<RestockPlanResponse> {
  const { data, error } = await outboundControllerGetRestockPlan({
    path: { tenantId, orderId },
    signal: options?.signal,
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
  options?: { cursor?: string; limit?: number; /** Story 1-5a — one client's rows (any-match); sent only when set. */ clientId?: string; signal?: AbortSignal },
): Promise<ManifestListResponse> {
  const { data, error } = await outboundControllerListManifests({
    path: { tenantId, warehouseId },
    query: definedQuery({ cursor: options?.cursor, limit: options?.limit, clientId: options?.clientId }),
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
  options?: { cursor?: string; limit?: number; /** Story 1-5a — one client's rows (any-match); sent only when set. */ clientId?: string; signal?: AbortSignal },
): Promise<WaveListResponse> {
  const { data, error } = await outboundControllerListWaves({
    path: { tenantId, warehouseId },
    query: definedQuery({ cursor: options?.cursor, limit: options?.limit, clientId: options?.clientId }),
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
  options?: {
    /** Story 9-1b — the drill's filters (9-1). */
    warehouseId?: string;
    from?: string;
    to?: string;
    /** Story 1-5a — the client switcher: one client's rows (filtered server-side); sent only when set. */
    clientId?: string;
    cursor?: string;
    signal?: AbortSignal;
  },
): Promise<InvoiceListResponse> {
  const { data, error } = await invoicingControllerListInvoices({
    path: { tenantId },
    query: definedQuery({
      warehouseId: options?.warehouseId,
      from: options?.from,
      to: options?.to,
      cursor: options?.cursor,
      clientId: options?.clientId,
    }),
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
  /** Story 9-1b — the drill's filters (9-1). */
  warehouseId?: string;
  source?: 'manual' | 'gateway';
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
  /** Story 1-5a — one client's bills (through the invoice's order); sent only when set. */
  clientId?: string;
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
  if (options.warehouseId !== undefined) query.warehouseId = options.warehouseId;
  if (options.source !== undefined) query.source = options.source;
  if (options.from !== undefined) query.from = options.from;
  if (options.to !== undefined) query.to = options.to;
  if (options.cursor !== undefined) query.cursor = options.cursor;
  if (options.limit !== undefined) query.limit = options.limit;
  if (options.clientId !== undefined) query.clientId = options.clientId;
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
    /** Story 1-5a — the client switcher: one client's rows (filtered server-side); sent only when set. */
    clientId?: string;
    cursor?: string;
    signal?: AbortSignal;
  },
): Promise<CountVarianceListResponse> {
  const { data, error } = await movementsControllerListCountVariances({
    path: { tenantId },
    query: definedQuery({
      status: options?.status,
      warehouseId: options?.warehouseId,
      clientId: options?.clientId,
      cursor: options?.cursor,
    }),
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
 * Story 3-5a — the web count-task list: newest first, keyset cursor,
 * warehouse/status/origin/bin filters. Exempt from the client filter (a bin
 * may hold several clients' goods), so it takes no `clientId`. Carries no
 * quantity — the detail does.
 */
export async function fetchApiListCountTasks(
  tenantId: string,
  options?: {
    warehouseId?: string;
    status?: 'pending' | 'completed' | 'cancelled';
    origin?: 'on_demand' | 'scheduled' | 'recount';
    binId?: string;
    cursor?: string;
    limit?: number;
    signal?: AbortSignal;
  },
): Promise<CountTaskListResponse> {
  const { data, error } = await movementsControllerListCountTasks({
    path: { tenantId },
    query: definedQuery({
      warehouseId: options?.warehouseId,
      status: options?.status,
      origin: options?.origin,
      binId: options?.binId,
      cursor: options?.cursor,
      limit: options?.limit,
    }),
    signal: options?.signal,
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 3-5a — one count task: expected beside counted, its variances and the recount a variance names. */
export async function fetchApiGetCountTask(tenantId: string, taskId: string): Promise<CountTaskDetailResponse> {
  const { data, error } = await movementsControllerGetCountTask({ path: { tenantId, taskId } });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 3-5a — the bulk on-demand create (`counts.manage`): many bins
 * (`binIds`, 1–500) or a zone's countable bins (`zoneId`). The created tasks
 * are not pushed to handhelds; bins with an open task (and listed system or
 * retired bins) come back in `skipped`. The single-bin create (`binId`) has
 * no web consumer, so this wrapper sends the bulk arms only. The key is the
 * draft's (reused across retries of an unchanged selection).
 */
export async function fetchApiCreateCounts(
  tenantId: string,
  body: { warehouseId: string; binIds: readonly string[] } | { warehouseId: string; zoneId: string },
  idempotencyKey: string,
): Promise<CreateCountsBulkResponse> {
  const { data, error } = await movementsControllerCreateCount({
    path: { tenantId },
    body: 'binIds' in body ? { warehouseId: body.warehouseId, binIds: [...body.binIds] } : { warehouseId: body.warehouseId, zoneId: body.zoneId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  // The 201 is oneOf the single and the bulk shapes; a bulk body only ever answers the bulk one.
  return data as CreateCountsBulkResponse;
}

/**
 * Story 3-5b — cancel a PENDING cycle count (`counts.manage`). A stock take's
 * task answers 409 `stock-take-task` (abandon the take instead).
 */
export async function fetchApiCancelCountTask(tenantId: string, taskId: string, idempotencyKey: string): Promise<CancelCountTaskResponse> {
  const { data, error } = await movementsControllerCancelCountTask({
    path: { tenantId, taskId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 3-5b — start a stock take (`counts.manage`): the whole warehouse
 * (`zoneIds` null) or the named zones. The key is the draft's.
 */
export async function fetchApiStartStockTake(
  tenantId: string,
  warehouseId: string,
  body: { zoneIds: readonly string[] | null; note: string | null },
  idempotencyKey: string,
): Promise<StartStockTakeResponse> {
  const { data, error } = await movementsControllerStartStockTake({
    path: { tenantId, warehouseId },
    body: { zoneIds: body.zoneIds === null ? null : [...body.zoneIds], note: body.note },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 3-5b — the warehouse's stock takes, newest first (any staff role). */
export async function fetchApiListStockTakes(
  tenantId: string,
  options?: { warehouseId?: string; cursor?: string; limit?: number },
): Promise<StockTakeListResponse> {
  const { data, error } = await movementsControllerListStockTakes({
    path: { tenantId },
    query: definedQuery({ warehouseId: options?.warehouseId, cursor: options?.cursor, limit: options?.limit }),
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 3-5b — one stock take's dashboard (totals, zones, the close's digest). */
export async function fetchApiGetStockTake(tenantId: string, stockTakeId: string): Promise<StockTakeDetailResponse> {
  const { data, error } = await movementsControllerGetStockTake({ path: { tenantId, stockTakeId } });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 3-5b — the take's variances, keyset by bin code (gated: counts.manage or variances.resolve). */
export async function fetchApiListStockTakeVariances(
  tenantId: string,
  stockTakeId: string,
  options?: { status?: 'open' | 'adjusted' | 'recounted'; cursor?: string; limit?: number },
): Promise<StockTakeVarianceListResponse> {
  const { data, error } = await movementsControllerListStockTakeVariances({
    path: { tenantId, stockTakeId },
    query: definedQuery({ status: options?.status, cursor: options?.cursor, limit: options?.limit }),
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 3-5b — recount selected bins of a counting take (`variances.resolve`). */
export async function fetchApiRecountStockTakeBins(
  tenantId: string,
  stockTakeId: string,
  binIds: readonly string[],
  idempotencyKey: string,
): Promise<RecountStockTakeResponse> {
  const { data, error } = await movementsControllerRecountStockTakeBins({
    path: { tenantId, stockTakeId },
    body: { binIds: [...binIds] },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 3-5b — post and close (`variances.resolve`; the owner when any open variance is over its threshold). */
export async function fetchApiCloseStockTake(
  tenantId: string,
  stockTakeId: string,
  openVarianceDigest: string,
  idempotencyKey: string,
): Promise<CloseStockTakeResponse> {
  const { data, error } = await movementsControllerCloseStockTake({
    path: { tenantId, stockTakeId },
    body: { openVarianceDigest },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 3-5b — abandon a counting take (`counts.manage`): its pending tasks cancelled, the freeze lifted. */
export async function fetchApiAbandonStockTake(
  tenantId: string,
  stockTakeId: string,
  note: string | null,
  idempotencyKey: string,
): Promise<AbandonStockTakeResponse> {
  const { data, error } = await movementsControllerAbandonStockTake({
    path: { tenantId, stockTakeId },
    body: { note },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 3-5b — the take's client report as a Blob (`parseAs: 'blob'`, the
 * bin-labels pattern). The server's filename is not readable cross-origin;
 * the caller names the file (`stockTakeReportFilename`).
 */
export async function fetchApiStockTakeReport(
  tenantId: string,
  stockTakeId: string,
  options: { format: 'csv' | 'xlsx'; clientId: string | null },
): Promise<Blob> {
  const { data, error, response } = await movementsControllerDownloadStockTakeReport({
    path: { tenantId, stockTakeId },
    query: { format: options.format, ...(options.clientId === null ? {} : { clientId: options.clientId }) },
    parseAs: 'blob',
  });
  if (error || !data) {
    throw unwrapError(error, response?.status ?? 400);
  }
  return data;
}

/** Story 3-5a — the warehouse's cycle-count schedule (any staff role). */
export async function fetchApiGetCountPolicies(tenantId: string, warehouseId: string): Promise<CountPoliciesResponse> {
  const { data, error } = await movementsControllerGetCountPolicies({ path: { tenantId, warehouseId } });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 3-5a — set (upsert) classes of the schedule (`counts.manage`); the answer is the whole set. */
export async function fetchApiUpsertCountPolicies(
  tenantId: string,
  warehouseId: string,
  policies: readonly CountPolicyDto[],
  idempotencyKey: string,
): Promise<CountPoliciesResponse> {
  const { data, error } = await movementsControllerUpsertCountPolicies({
    path: { tenantId, warehouseId },
    body: { policies: policies.map((policy) => ({ abcClass: policy.abcClass, intervalDays: policy.intervalDays })) },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 3-5a — unschedule one class (`counts.manage`); the answer is the remaining set. */
export async function fetchApiDeleteCountPolicy(
  tenantId: string,
  warehouseId: string,
  abcClass: CountPolicyDto['abcClass'],
  idempotencyKey: string,
): Promise<CountPoliciesResponse> {
  const { data, error } = await movementsControllerDeleteCountPolicy({
    path: { tenantId, warehouseId, abcClass },
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
    /** Story 1-5a — the client switcher: one client's rows (filtered server-side); sent only when set. */
    clientId?: string;
    cursor?: string;
    signal?: AbortSignal;
  },
): Promise<AdjustmentPendingListResponse> {
  const { data, error } = await inventoryControllerListAdjustmentPendings({
    path: { tenantId },
    query: definedQuery({ status: options?.status, clientId: options?.clientId, cursor: options?.cursor }),
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
    /** Story 9-1b — the drill's filters (9-1): a one-element `type` list, the window, an SKU, an order, a short-pick flag. */
    type?: Readonly<NonNullable<NonNullable<InventoryControllerListEventsData['query']>['type']>>;
    from?: string;
    to?: string;
    skuId?: string;
    orderId?: string;
    shortPick?: boolean;
    /** Story 9-3a — a document's events ("View ledger"): one `referenceDoc` key each. */
    grnId?: string;
    poId?: string;
    adjustmentPendingId?: string;
    countVarianceId?: string;
    /** Story 1-5a — the client switcher: one client's rows (filtered server-side); sent only when set. */
    clientId?: string;
    cursor?: string;
    signal?: AbortSignal;
  },
): Promise<LedgerEventListResponse> {
  const { data, error } = await inventoryControllerListEvents({
    path: { tenantId, warehouseId },
    query: definedQuery({
      binId: options?.binId,
      type: options?.type === undefined ? undefined : [...options.type],
      from: options?.from,
      to: options?.to,
      skuId: options?.skuId,
      orderId: options?.orderId,
      shortPick: options?.shortPick,
      grnId: options?.grnId,
      poId: options?.poId,
      adjustmentPendingId: options?.adjustmentPendingId,
      countVarianceId: options?.countVarianceId,
      cursor: options?.cursor,
      clientId: options?.clientId,
    }),
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
    /** Story 1-5a — the client switcher: one client's rows (filtered server-side); sent only when set. */
    clientId?: string;
    cursor?: string;
    signal?: AbortSignal;
  },
): Promise<ReorderPolicyListResponse> {
  const { data, error } = await replenishmentControllerListReorderPolicies({
    path: { tenantId },
    query: definedQuery({
      warehouseId: options?.warehouseId,
      skuId: options?.skuId,
      clientId: options?.clientId,
      cursor: options?.cursor,
    }),
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
    /** Story 1-5a — the client switcher: one client's rows (filtered server-side); sent only when set. */
    clientId?: string;
    cursor?: string;
    signal?: AbortSignal;
  },
): Promise<BreachListResponse> {
  const { data, error } = await replenishmentControllerListBreaches({
    path: { tenantId },
    query: definedQuery({
      status: options?.status,
      warehouseId: options?.warehouseId,
      clientId: options?.clientId,
      cursor: options?.cursor,
    }),
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
    /** Story 1-5a — the client switcher: one client's rows (filtered server-side); sent only when set. */
    clientId?: string;
    cursor?: string;
    signal?: AbortSignal;
  },
): Promise<SuggestedPoListResponse> {
  const { data, error } = await replenishmentControllerListSuggestedPos({
    path: { tenantId },
    query: definedQuery({
      status: options?.status,
      warehouseId: options?.warehouseId,
      clientId: options?.clientId,
      cursor: options?.cursor,
    }),
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
    /** Story 9-1b — the drill's window (9-1). */
    from?: string;
    to?: string;
    /** Story 1-5a — the client switcher: one client's rows (filtered server-side); sent only when set. */
    clientId?: string;
    cursor?: string;
    signal?: AbortSignal;
  },
): Promise<BatchAlertListResponse> {
  const { data, error } = await replenishmentControllerListBatchAlerts({
    path: { tenantId },
    query: definedQuery({
      kind: options?.kind,
      status: options?.status,
      warehouseId: options?.warehouseId,
      from: options?.from,
      to: options?.to,
      cursor: options?.cursor,
      clientId: options?.clientId,
    }),
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
    // Story 21-7 — a portal session re-reads `portal/me` (the operator `/me`
    // sits behind the operator fence and would refuse it 403).
    const portal = session.user.clientId !== null;
    const { user, client } = portal
      ? await fetchApiPortalMe(session.tenant.id)
      : { ...(await fetchApiMe(session.tenant.id)), client: null };
    const current = readSession();
    // A response from a pre-21-7 backend carries no `clientId` — staff.
    const clientId = user.clientId ?? null;
    if (
      current !== null &&
      (current.user.id !== user.id ||
        current.user.role !== user.role ||
        current.user.status !== user.status ||
        current.user.clientId !== clientId ||
        (portal && (current.client?.id !== client?.id || current.client?.name !== client?.name)))
    ) {
      writeSession({
        ...current,
        user: { id: user.id, email: user.email, role: user.role, status: user.status, clientId },
        client: clientId === null ? null : client,
      });
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

// ── Client portal (story 21-7) ──────────────────────────────────────────────

/**
 * A portal read's failure: unwrapped as every wrapper does, and — for a
 * `client-suspended` refusal (the client brand was suspended mid-session) —
 * announced on `window` so the portal shell signs out with the notice.
 */
function portalError(error: unknown): Error {
  const failure = unwrapError(error, 400);
  if (failure instanceof ApiProblem && failure.code === 'client-suspended' && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PORTAL_SUSPENDED_EVENT));
  }
  return failure;
}

type PortalPageOptions = { cursor?: string; limit?: number; signal?: AbortSignal };

function portalPageQuery(options?: PortalPageOptions): { cursor?: string; limit?: number } | undefined {
  if (options?.cursor === undefined && options?.limit === undefined) return undefined;
  return {
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  };
}

/** The portal user and its client brand (the portal shell's bootstrap). */
export async function fetchApiPortalMe(tenantId: string, options?: { signal?: AbortSignal }): Promise<PortalMeResponse> {
  const { data, error } = await portalControllerMe({ path: { tenantId }, signal: options?.signal });
  if (error || !data) throw portalError(error);
  return data;
}

/** This client's stock, one row per (SKU, warehouse); keyset by SKU code. */
export async function fetchApiPortalStock(tenantId: string, options?: PortalPageOptions): Promise<PortalStockPageResponse> {
  const { data, error } = await portalControllerStock({ path: { tenantId }, query: portalPageQuery(options), signal: options?.signal });
  if (error || !data) throw portalError(error);
  return data;
}

/** This client's orders, newest first; optionally one status. */
export async function fetchApiPortalOrders(
  tenantId: string,
  options?: PortalPageOptions & {
    status?: PortalOrderRowDto['status'];
    /** Story 4-1b — the exact-match search over this client's own orders; sent only when set. */
    reference?: string;
  },
): Promise<PortalOrderPageResponse> {
  const page = portalPageQuery(options);
  const filters = {
    ...(options?.status === undefined ? {} : { status: options.status }),
    ...(options?.reference === undefined ? {} : { reference: options.reference }),
  };
  const query = Object.keys(filters).length === 0 ? page : { ...page, ...filters };
  const { data, error } = await portalControllerOrders({ path: { tenantId }, query, signal: options?.signal });
  if (error || !data) throw portalError(error);
  return data;
}

export async function fetchApiPortalOrder(
  tenantId: string,
  orderId: string,
  options?: { signal?: AbortSignal },
): Promise<PortalOrderDetailResponse> {
  const { data, error } = await portalControllerOrder({ path: { tenantId, orderId }, signal: options?.signal });
  if (error || !data) throw portalError(error);
  return data;
}

export async function fetchApiPortalAsns(
  tenantId: string,
  options?: PortalPageOptions & { status?: PortalAsnRowDto['status'] },
): Promise<PortalAsnPageResponse> {
  const page = portalPageQuery(options);
  const query = options?.status === undefined ? page : { ...page, status: options.status };
  const { data, error } = await portalControllerAsns({ path: { tenantId }, query, signal: options?.signal });
  if (error || !data) throw portalError(error);
  return data;
}

export async function fetchApiPortalAsn(
  tenantId: string,
  asnId: string,
  options?: { signal?: AbortSignal },
): Promise<PortalAsnDetailResponse> {
  const { data, error } = await portalControllerAsn({ path: { tenantId, asnId }, signal: options?.signal });
  if (error || !data) throw portalError(error);
  return data;
}

export async function fetchApiPortalPurchaseOrders(
  tenantId: string,
  options?: PortalPageOptions & { status?: PortalPurchaseOrderRowDto['status'] },
): Promise<PortalPurchaseOrderPageResponse> {
  const page = portalPageQuery(options);
  const query = options?.status === undefined ? page : { ...page, status: options.status };
  const { data, error } = await portalControllerPurchaseOrders({ path: { tenantId }, query, signal: options?.signal });
  if (error || !data) throw portalError(error);
  return data;
}

/** Story 2-5a — this client's goods receipts, newest first (keyset). */
export async function fetchApiPortalGoodsReceipts(
  tenantId: string,
  options?: PortalPageOptions,
): Promise<PortalGoodsReceiptListResponse> {
  const { data, error } = await portalControllerGoodsReceipts({ path: { tenantId }, query: portalPageQuery(options), signal: options?.signal });
  if (error || !data) throw portalError(error);
  return data;
}

/**
 * Story 2-5a — one of this client's goods receipts: its lines with their
 * condition and damage photos (attached ones with a short-lived URL, removed
 * ones as a placeholder). Another client's receipt is a 404.
 */
export async function fetchApiPortalGoodsReceipt(
  tenantId: string,
  grnId: string,
  options?: { signal?: AbortSignal },
): Promise<PortalGoodsReceiptDetailDto> {
  const { data, error } = await portalControllerGoodsReceipt({ path: { tenantId, grnId }, signal: options?.signal });
  if (error || !data) throw portalError(error);
  return data;
}

/**
 * Story 4-7a — this client's returns with their disposition totals, newest
 * first; optionally only those still awaiting a decision or only decided ones.
 */
export async function fetchApiPortalReturns(
  tenantId: string,
  options?: PortalPageOptions & { dispositionState?: NonNullable<NonNullable<PortalControllerPortalReturnsData['query']>['dispositionState']> },
): Promise<PortalReturnPageResponse> {
  const page = portalPageQuery(options);
  const query = options?.dispositionState === undefined ? page : { ...page, dispositionState: options.dispositionState };
  const { data, error } = await portalControllerPortalReturns({ path: { tenantId }, query, signal: options?.signal });
  if (error || !data) throw portalError(error);
  return data;
}

/** Story 4-7a — one of this client's returns: its lines and what was decided for each unit. Another client's is a 404. */
export async function fetchApiPortalReturn(
  tenantId: string,
  rmaId: string,
  options?: { signal?: AbortSignal },
): Promise<PortalReturnDetailResponse> {
  const { data, error } = await portalControllerPortalReturn({ path: { tenantId, rmaId }, signal: options?.signal });
  if (error || !data) throw portalError(error);
  return data;
}

export async function fetchApiPortalPurchaseOrder(
  tenantId: string,
  poId: string,
  options?: { signal?: AbortSignal },
): Promise<PortalPurchaseOrderDetailResponse> {
  const { data, error } = await portalControllerPurchaseOrder({ path: { tenantId, poId }, signal: options?.signal });
  if (error || !data) throw portalError(error);
  return data;
}

/**
 * Story 21-7b — the portal's one write: announces this client's inbound
 * shipment (`asn.announce`; the client is the session's, never the body's).
 * Answers the bare `PortalAsnDetail`; the key is per draft.
 */
export async function fetchApiPortalAnnounceAsn(
  tenantId: string,
  body: PortalCreateAsnDto,
  idempotencyKey: string,
): Promise<PortalAsnDetailResponse> {
  const { data, error } = await portalControllerAnnounceAsn({
    path: { tenantId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw portalError(error);
  return data;
}

/**
 * Story 4-1a — the portal's second write: places an outbound order for this
 * client's own active SKUs (`orders.place`; the client is the session's,
 * never the body's — and no line carries a rate). Answers
 * `{orderId, warehouseName, lineCount, placedAt}`; the key is per draft.
 */
export async function fetchApiPortalPlaceOrder(
  tenantId: string,
  body: PortalCreateOrderDto,
  idempotencyKey: string,
): Promise<PortalPlacedOrderResponse> {
  const { data, error } = await portalControllerPlaceOrder({
    path: { tenantId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw portalError(error);
  return data;
}

/** Story 21-7b — this client's non-kit SKUs (the announce form's options); keyset by code. */
export async function fetchApiPortalSkus(tenantId: string, options?: PortalPageOptions): Promise<PortalSkuPageResponse> {
  const { data, error } = await portalControllerSkus({ path: { tenantId }, query: portalPageQuery(options), signal: options?.signal });
  if (error || !data) throw portalError(error);
  return data;
}

/** Story 21-7b — the tenant's warehouses a client may announce into (name and city; unpaginated). */
export async function fetchApiPortalWarehouses(tenantId: string, options?: { signal?: AbortSignal }): Promise<PortalWarehouseListResponse> {
  const { data, error } = await portalControllerWarehouses({ path: { tenantId }, signal: options?.signal });
  if (error || !data) throw portalError(error);
  return data;
}

/** This client's issued invoices (never a draft), newest first. */
export async function fetchApiPortalInvoices(tenantId: string, options?: PortalPageOptions): Promise<PortalInvoicePageResponse> {
  const { data, error } = await portalControllerInvoices({ path: { tenantId }, query: portalPageQuery(options), signal: options?.signal });
  if (error || !data) throw portalError(error);
  return data;
}

export async function fetchApiPortalInvoice(
  tenantId: string,
  invoiceId: string,
  options?: { signal?: AbortSignal },
): Promise<PortalInvoiceDetailResponse> {
  const { data, error } = await portalControllerInvoice({ path: { tenantId, invoiceId }, signal: options?.signal });
  if (error || !data) throw portalError(error);
  return data;
}

/** Story 5-6a — one of this client's invoices' issued and void notes, and the document value after them. */
export async function fetchApiPortalInvoiceNotes(
  tenantId: string,
  invoiceId: string,
  options?: { signal?: AbortSignal },
): Promise<PortalInvoiceNotesResponse> {
  const { data, error } = await portalControllerInvoiceNotes({ path: { tenantId, invoiceId }, signal: options?.signal });
  if (error || !data) throw portalError(error);
  return data;
}

/** Story 5-6a — one issued or void note of this client. */
export async function fetchApiPortalInvoiceNote(
  tenantId: string,
  noteId: string,
  options?: { signal?: AbortSignal },
): Promise<PortalNoteDetailResponse> {
  const { data, error } = await portalControllerInvoiceNote({ path: { tenantId, noteId }, signal: options?.signal });
  if (error || !data) throw portalError(error);
  return data;
}

/** Story 3-7a — this client's recalls, newest first. */
export async function fetchApiPortalRecalls(tenantId: string, options?: PortalPageOptions): Promise<PortalRecallListResponse> {
  const { data, error } = await portalControllerPortalRecalls({ path: { tenantId }, query: portalPageQuery(options), signal: options?.signal });
  if (error || !data) throw portalError(error);
  return data;
}

/** Story 3-7a — one of this client's recalls (no bin, no actor — the server's allowlist). */
export async function fetchApiPortalRecall(tenantId: string, recallId: string, options?: { signal?: AbortSignal }): Promise<PortalRecallDetailResponse> {
  const { data, error } = await portalControllerPortalRecall({ path: { tenantId, recallId }, signal: options?.signal });
  if (error || !data) throw portalError(error);
  return data;
}

/**
 * Story 3-7a — this client's recall report as a file, as a Blob (`parseAs:
 * 'blob'`); the caller names the file (CORS hides `Content-Disposition`).
 */
export async function fetchApiPortalRecallReport(tenantId: string, recallId: string, format: 'csv' | 'xlsx'): Promise<Blob> {
  const { data, error } = await portalControllerPortalRecallReport({ path: { tenantId, recallId }, query: { format }, parseAs: 'blob' });
  if (error || !data) throw portalError(error);
  return data as unknown as Blob;
}

/**
 * Story 21-8 — this client's service report (the session's client — never a
 * `clientId` in the query): the same body as the operator's report.
 */
export async function fetchApiPortalService(
  tenantId: string,
  period: { from: string; to: string; warehouseId?: string | null },
  options?: { signal?: AbortSignal },
): Promise<ServiceReportDto> {
  const { data, error } = await portalControllerService({ path: { tenantId }, query: serviceQuery(period), signal: options?.signal });
  if (error || !data) throw portalError(error);
  return data;
}

// ── story 9-2 — the notification panel ──────────────────────────────────────

/**
 * The caller's notification entries, newest raised first (the server routes
 * by role — a member sees only the sources it can act on). A first page
 * sends no cursor; `limit` is 1–100 (server default 25).
 */
export async function fetchApiListNotifications(
  tenantId: string,
  options?: { cursor?: string; limit?: number; signal?: AbortSignal },
): Promise<NotificationListResponse> {
  const query = {
    ...(options?.cursor === undefined ? {} : { cursor: options.cursor }),
    ...(options?.limit === undefined ? {} : { limit: options.limit }),
  };
  const { data, error } = await notificationsControllerList({
    path: { tenantId },
    query: Object.keys(query).length === 0 ? undefined : query,
    signal: options?.signal,
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** The bell's dot for the caller — `{hasNew}`, never a count. */
export async function fetchApiNotificationStatus(
  tenantId: string,
  options?: { signal?: AbortSignal },
): Promise<NotificationStatusResponse> {
  const { data, error } = await notificationsControllerStatus({ path: { tenantId }, signal: options?.signal });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/**
 * Marks the panel opened (clears the dot). Deliberately NOT the keyed-POST
 * shape: the route takes no Idempotency-Key — setting "last opened" to now is
 * naturally idempotent (the API-SURFACE exception).
 */
export async function fetchApiMarkNotificationsOpened(tenantId: string): Promise<NotificationStatusResponse> {
  const { data, error } = await notificationsControllerOpened({ path: { tenantId } });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

// ── Story 13-1 — return authorizations ─────────────────────────────────────

/** One order's returnable quantities per line (member-open). */
export async function fetchApiReturnable(
  tenantId: string,
  orderId: string,
  options?: { signal?: AbortSignal },
): Promise<ReturnableOrderDto> {
  const { data, error } = await returnsControllerReturnable({ path: { tenantId }, query: { orderId }, signal: options?.signal });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/**
 * The return authorizations, newest first (keyset), optionally one
 * warehouse's, one status's or one order's. Member-open. A first page with no
 * option sends no query.
 */
export async function fetchApiListReturns(
  tenantId: string,
  options?: {
    warehouseId?: string;
    status?: ReturnAuthorizationDto['status'];
    orderId?: string;
    /** Story 1-5a — the client switcher: one client's rows (filtered server-side); sent only when set. */
    clientId?: string;
    cursor?: string;
    signal?: AbortSignal;
  },
): Promise<ReturnAuthorizationListResponse> {
  const { data, error } = await returnsControllerList({
    path: { tenantId },
    query: definedQuery({
      warehouseId: options?.warehouseId,
      status: options?.status,
      orderId: options?.orderId,
      cursor: options?.cursor,
      clientId: options?.clientId,
    }),
    signal: options?.signal,
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** One return authorization with its lines. */
export async function fetchApiGetReturn(
  tenantId: string,
  rmaId: string,
  options?: { signal?: AbortSignal },
): Promise<ReturnAuthorizationDto> {
  const { data, error } = await returnsControllerGet({ path: { tenantId, rmaId }, signal: options?.signal });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Authorizes part of a dispatched order for return (`returns.manage`); the key is per draft. */
export async function fetchApiCreateReturn(
  tenantId: string,
  body: CreateReturnAuthorizationDto,
  idempotencyKey: string,
): Promise<ReturnAuthorizationDto> {
  const { data, error } = await returnsControllerCreate({
    path: { tenantId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Cancels an open return authorization with a reason (`returns.manage`); the key is per click. */
export async function fetchApiCancelReturn(
  tenantId: string,
  rmaId: string,
  reason: string,
  idempotencyKey: string,
): Promise<ReturnAuthorizationDto> {
  const { data, error } = await returnsControllerCancel({
    path: { tenantId, rmaId },
    body: { reason },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

// ── Story 4-7a — returns disposition ───────────────────────────────────────

/**
 * The received return-receipt lines still awaiting a disposition, OLDEST
 * first (keyset ASC), optionally one warehouse's or one client's. Any staff
 * role. A first page with no option sends no query.
 */
export async function fetchApiListAwaitingReturns(
  tenantId: string,
  options?: { warehouseId?: string; clientId?: string; cursor?: string; limit?: number; signal?: AbortSignal },
): Promise<AwaitingDispositionListResponse> {
  const { data, error } = await returnsControllerAwaiting({
    path: { tenantId },
    query: definedQuery({
      warehouseId: options?.warehouseId,
      clientId: options?.clientId,
      cursor: options?.cursor,
      limit: options?.limit,
    }),
    signal: options?.signal,
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/**
 * Records one disposition of a received return-receipt line — restock (to a
 * storage bin), quarantine (a QC hold) or scrap (`returns.manage`). The key
 * is per draft: reused on a retry of the same draft, new for a changed one.
 */
export async function fetchApiDisposeReturn(
  tenantId: string,
  body: DisposeReturnDto,
  idempotencyKey: string,
): Promise<ReturnDispositionResultDto> {
  const { data, error } = await returnsControllerDispose({
    path: { tenantId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/**
 * Story 2-4a — one goods receipt's lines (the expandable GRN row): SKU,
 * batch, good and applied units, and the damaged and short quantities with
 * their reasons. Any staff role.
 */
export async function fetchApiListGoodsReceiptLines(
  tenantId: string,
  grnId: string,
  options?: { signal?: AbortSignal },
): Promise<GoodsReceiptLinesResponse> {
  const { data, error } = await receivingControllerListGoodsReceiptLines({ path: { tenantId, grnId }, signal: options?.signal });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 2-10b — one goods receipt's LPNs (licence plates) in code order, every status — any member. */
export async function fetchApiListLpns(tenantId: string, grnId: string, options?: { signal?: AbortSignal }): Promise<LpnListResponse> {
  const { data, error } = await receivingControllerListLpns({ path: { tenantId, grnId }, signal: options?.signal });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 2-10b — mints LPNs for lines of a recorded goods receipt
 * (`labels.execute`): one per declared quantity, in request order. The key is
 * per draft — reused across retries of an unchanged request.
 */
export async function fetchApiMintLpns(tenantId: string, grnId: string, body: MintLpnsRequestDto, idempotencyKey: string): Promise<MintLpnsResponse> {
  const { data, error } = await receivingControllerMintLpns({
    path: { tenantId, grnId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/** Story 2-10b — voids an active LPN (`labels.execute`) with a reason (and a note, required with `other`). */
export async function fetchApiVoidLpn(tenantId: string, grnId: string, lpnId: string, body: VoidLpnRequestDto, idempotencyKey: string): Promise<LpnResponse> {
  const { data, error } = await receivingControllerVoidLpn({
    path: { tenantId, grnId, lpnId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 2-10b — LPN labels as a file (ZPL `text/plain` or a PDF), as a Blob
 * (the bin-labels pattern). A refusal is problem+json → `ApiProblem`; the
 * listing arms carry `extensions.lpnCodes`, `too-many-labels` carries
 * `extensions.count`. The caller names the file (`lpnLabelsFilename`).
 */
export async function fetchApiLpnLabels(tenantId: string, grnId: string, body: LpnLabelsRequestDto): Promise<Blob> {
  const { data, error, response } = await receivingControllerPrintLpnLabels({
    path: { tenantId, grnId },
    body,
    parseAs: 'blob',
  });
  if (error || !data) {
    throw unwrapError(error, response?.status ?? 400);
  }
  return data;
}

/**
 * Story 2-5a — one goods receipt's damage photos (any staff role): every live
 * photo (attached + awaited) in receipt order with a short-lived presigned
 * URL, then at most the 50 newest removed / never-arrived ones. A URL is
 * valid until its `urlExpiresAt` (≈ 300 s) — the dialog refetches this list
 * when an image fails after that (A28).
 */
export async function fetchApiListReceiptPhotos(
  tenantId: string,
  grnId: string,
  options?: { signal?: AbortSignal },
): Promise<ReceiptPhotosResponse> {
  const { data, error } = await receivingControllerListReceiptPhotos({ path: { tenantId, grnId }, signal: options?.signal });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 2-5a — add one damage photo to a goods-receipt line from the web
 * (`receipt.attach`). Multipart (`file` only), keyed: the key is the photo's
 * intent, so a retry of the SAME prepared file reuses it. 201 carries the
 * attachment with no URL — refetch the list to show it.
 */
export async function fetchApiAddReceiptPhoto(
  tenantId: string,
  grnId: string,
  lineId: string,
  file: File,
  idempotencyKey: string,
): Promise<ReceiptPhotoResponse> {
  const { data, error } = await receivingControllerAddReceiptPhoto({
    body: { file },
    headers: { 'Idempotency-Key': idempotencyKey },
    path: { tenantId, grnId, lineId },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 2-5a — remove a damage photo (soft: the record stays with who and
 * why), or cancel an awaited placeholder (`receipt.photo-remove`). The reason
 * is in the request hash, so a key is bound to the reason it was sent with.
 */
export async function fetchApiRemoveReceiptPhoto(
  tenantId: string,
  grnId: string,
  attachmentId: string,
  reason: string,
  idempotencyKey: string,
): Promise<ReceiptPhotoResponse> {
  const { data, error } = await receivingControllerRemoveReceiptPhoto({
    body: { reason },
    headers: { 'Idempotency-Key': idempotencyKey },
    path: { tenantId, grnId, attachmentId },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return data;
}

/**
 * Story 2-4a — a stock adjustment (`stock.adjust`), the web's first: the
 * damaged write-off sends a NEGATIVE delta on the system DAMAGED bin. Keyed;
 * answers the applied adjustment (201) or its pend (202, over the tenant's
 * threshold) — told apart by `pendingAdjustment`.
 */
export async function fetchApiAdjustStock(
  tenantId: string,
  body: StockAdjustmentDto,
  idempotencyKey: string,
): Promise<{ kind: 'applied'; adjustment: StockAdjustmentResponse } | { kind: 'pending'; pending: StockAdjustmentPendingResponse }> {
  const { data, error } = await inventoryControllerAdjustStock({
    path: { tenantId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) {
    throw unwrapError(error, 400);
  }
  return 'pendingAdjustment' in data
    ? { kind: 'pending', pending: data as StockAdjustmentPendingResponse }
    : { kind: 'applied', adjustment: data as StockAdjustmentResponse };
}

// ── story 2-8b: returns to vendor ───────────────────────────────────────────

/** Story 2-8b — the RTV statuses (the list's `status` filter). */
export type VendorReturnStatusFilter = VendorReturnDto['status'];

/**
 * Story 2-8b — creates a return to vendor (`rtv.manage`): a draft drawing on
 * one client's DAMAGED stock, the vendor and the brand frozen. The key is per
 * draft (reused on a retry of the unchanged body).
 */
export async function fetchApiCreateVendorReturn(
  tenantId: string,
  body: CreateVendorReturnDto,
  idempotencyKey: string,
): Promise<VendorReturnDto> {
  const { data, error } = await vendorReturnsControllerCreate({
    path: { tenantId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/**
 * Story 2-8b — the tenant's returns to vendor, newest first; `warehouseId`,
 * `clientId` and `status` ride the query only when set.
 */
export async function fetchApiListVendorReturns(
  tenantId: string,
  options?: {
    warehouseId?: string;
    clientId?: string;
    status?: VendorReturnStatusFilter;
    cursor?: string;
    limit?: number;
    signal?: AbortSignal;
  },
): Promise<VendorReturnListResponse> {
  const { data, error } = await vendorReturnsControllerList({
    path: { tenantId },
    query: definedQuery({
      warehouseId: options?.warehouseId,
      clientId: options?.clientId,
      status: options?.status,
      cursor: options?.cursor,
      limit: options?.limit,
    }),
    signal: options?.signal,
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Story 2-8b — one return to vendor: its frozen parties, lines, pick, dispatch and cancellation. */
export async function fetchApiGetVendorReturn(
  tenantId: string,
  vendorReturnId: string,
  options?: { signal?: AbortSignal },
): Promise<VendorReturnDto> {
  const { data, error } = await vendorReturnsControllerGet({ path: { tenantId, vendorReturnId }, signal: options?.signal });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/**
 * Story 2-8b — dispatches a picked return (`dispatch.execute`): the brand's
 * document, the e-way bill, the carrier and the packages; the units leave
 * DAMAGED (`rtv.dispatched`).
 */
export async function fetchApiDispatchVendorReturn(
  tenantId: string,
  vendorReturnId: string,
  body: DispatchVendorReturnDto,
  idempotencyKey: string,
): Promise<VendorReturnDto> {
  const { data, error } = await vendorReturnsControllerDispatch({
    path: { tenantId, vendorReturnId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Story 2-8b — cancels a draft or picked return (`rtv.manage`), with a reason. */
export async function fetchApiCancelVendorReturn(
  tenantId: string,
  vendorReturnId: string,
  reason: string,
  idempotencyKey: string,
): Promise<VendorReturnDto> {
  const { data, error } = await vendorReturnsControllerCancel({
    path: { tenantId, vendorReturnId },
    body: { reason },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/**
 * Story 2-8b — one client's DAMAGED arms in a warehouse with what is still
 * available after the open claims, and per arm the GRN lines it may be
 * sourced from. `skuId` narrows it (A15).
 */
export async function fetchApiReturnableDamaged(
  tenantId: string,
  warehouseId: string,
  clientId: string,
  options?: { skuId?: string; signal?: AbortSignal },
): Promise<ReturnableDamagedResponse> {
  const { data, error } = await vendorReturnsControllerReturnable({
    path: { tenantId, warehouseId },
    query: { clientId, ...(options?.skuId === undefined ? {} : { skuId: options.skuId }) },
    signal: options?.signal,
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

// ── Story 2-3b — dock doors, the dock schedule and dock appointments ────────

/** Story 2-3b — every dock door of a warehouse, active first then by code (any staff session). */
export async function fetchApiListDockDoors(tenantId: string, warehouseId: string, options?: { signal?: AbortSignal }): Promise<DockDoorListResponse> {
  const { data, error } = await dockControllerListDoors({ path: { tenantId, warehouseId }, signal: options?.signal });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Story 2-3b — adds a dock door (`dock.manage`). Per-draft key. */
export async function fetchApiCreateDockDoor(tenantId: string, warehouseId: string, body: CreateDockDoorDto, idempotencyKey: string): Promise<DockDoorResponse> {
  const { data, error } = await dockControllerCreateDoor({
    path: { tenantId, warehouseId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Story 2-3b — replaces a door's code, name and active flag (`dock.manage`); a door is never deleted. */
export async function fetchApiUpdateDockDoor(
  tenantId: string,
  warehouseId: string,
  doorId: string,
  body: UpdateDockDoorDto,
  idempotencyKey: string,
): Promise<DockDoorResponse> {
  const { data, error } = await dockControllerUpdateDoor({
    path: { tenantId, warehouseId, doorId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Story 2-3b — the warehouse's dock schedule (`configured: false` = the defaults). */
export async function fetchApiGetDockSchedule(tenantId: string, warehouseId: string, options?: { signal?: AbortSignal }): Promise<DockScheduleResponse> {
  const { data, error } = await dockControllerGetSchedule({ path: { tenantId, warehouseId }, signal: options?.signal });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Story 2-3b — replaces the warehouse's dock schedule (`dock.manage`). */
export async function fetchApiPutDockSchedule(tenantId: string, warehouseId: string, body: PutDockScheduleDto, idempotencyKey: string): Promise<DockScheduleResponse> {
  const { data, error } = await dockControllerPutSchedule({
    path: { tenantId, warehouseId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/**
 * Story 2-3b — the dock calendar of a window (`from`/`to` inclusive IST
 * dates, at most 7 days): the schedule, the doors, the appointments (≤ 1000)
 * and the exact summary. `includeCancelled` rides only when true.
 */
export async function fetchApiDockWindow(
  tenantId: string,
  query: { warehouseId: string; from: string; to: string; includeCancelled?: boolean },
  options?: { signal?: AbortSignal },
): Promise<DockWindowResponse> {
  const { data, error } = await dockControllerWindow({
    path: { tenantId },
    query: {
      warehouseId: query.warehouseId,
      from: query.from,
      to: query.to,
      ...(query.includeCancelled === true ? { includeCancelled: true } : {}),
    },
    signal: options?.signal,
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Story 2-3b — books a dock appointment (`dock.schedule`). Per-draft key. */
export async function fetchApiBookDockAppointment(tenantId: string, body: BookDockAppointmentDto, idempotencyKey: string): Promise<DockAppointmentResponse> {
  const { data, error } = await dockControllerBook({ path: { tenantId }, body, headers: { 'Idempotency-Key': idempotencyKey } });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Story 2-3b — one dock appointment (the drawer, `?open=`). */
export async function fetchApiGetDockAppointment(tenantId: string, appointmentId: string, options?: { signal?: AbortSignal }): Promise<DockAppointmentResponse> {
  const { data, error } = await dockControllerGet({ path: { tenantId, appointmentId }, signal: options?.signal });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Story 2-3b — reschedules a booked appointment: a FULL replacement (`dock.schedule`). */
export async function fetchApiRescheduleDockAppointment(
  tenantId: string,
  appointmentId: string,
  body: RescheduleDockAppointmentDto,
  idempotencyKey: string,
): Promise<DockAppointmentResponse> {
  const { data, error } = await dockControllerReschedule({
    path: { tenantId, appointmentId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}

/** Story 2-3b — cancels a booked appointment with a reason (`dock.schedule`). */
export async function fetchApiCancelDockAppointment(
  tenantId: string,
  appointmentId: string,
  body: CancelDockAppointmentDto,
  idempotencyKey: string,
): Promise<DockAppointmentResponse> {
  const { data, error } = await dockControllerCancel({
    path: { tenantId, appointmentId },
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (error || !data) throw unwrapError(error, 400);
  return data;
}
