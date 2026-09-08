import { client } from './generated/client.gen';
import {
  healthControllerHealth,
  tenancyControllerCreateWarehouse,
  tenancyControllerListWarehouses,
  tenancyControllerRegister,
  tenancyControllerSignIn,
} from './generated/sdk.gen';
import { readSession } from '../auth';
import type {
  CreateWarehouseDto,
  HealthResponse,
  RegisterTenantDto,
  SignInDto,
  SignInResponse,
  TenantRegistrationResponse,
  WarehouseListResponse,
  WarehouseResponse,
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
  }
  return request;
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