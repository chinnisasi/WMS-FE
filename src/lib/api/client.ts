import { client } from './generated/client.gen';
import {
  catalogControllerEditSku,
  catalogControllerImportCatalog,
  catalogControllerListSkus,
  healthControllerHealth,
  tenancyControllerCreateBin,
  tenancyControllerCreateWarehouse,
  tenancyControllerCreateZone,
  tenancyControllerGenerateBinGrid,
  tenancyControllerListBins,
  tenancyControllerListWarehouses,
  tenancyControllerListZones,
  tenancyControllerRegister,
  tenancyControllerSetBinBlocked,
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
  BinResponse,
  CatalogImportResponse,
  CreateBinDto,
  CreateWarehouseDto,
  CreateZoneDto,
  GenerateBinsDto,
  HealthResponse,
  InviteUserDto,
  InviteUserResponse,
  MeResponse,
  PatchBinDto,
  PatchSkuDto,
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
  WarehouseListResponse,
  WarehouseResponse,
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

  constructor(code: string, status: number, detail?: string) {
    super(detail ?? code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function unwrapError(error: unknown, fallbackStatus: number): ApiProblem {
  if (isProblemDetails(error)) {
    return new ApiProblem(error.code, error.status ?? fallbackStatus, error.detail);
  }
  return new ApiProblem('request-failed', fallbackStatus, String(error));
}

function isProblemDetails(error: unknown): error is { code: string; detail?: string; status?: number } {
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