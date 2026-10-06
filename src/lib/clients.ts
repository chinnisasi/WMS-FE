/**
 * Story 21-2b — the client dimension on the web: the tenant's client brands
 * (the system-owned `self` client is the tenant's own company), the import's
 * client choice, the client column shown once more than one client exists,
 * and the refusal mappers for every door the attribution rules guard.
 *
 * Pure: no React, no fetch — every sentence and derivation here is pinned by
 * `clients.test.ts` (the house rule: a claim left in JSX is a claim nothing
 * can pin).
 */
import { ApiProblem } from '@/lib/api/client';
import type { ClientDto } from '@/lib/api/generated';
import { UNREACHABLE_REASON, verbatim } from '@/lib/outbound-orders';

/** Fired on `window` after a client mutation so readers refetch. */
export const CLIENTS_CHANGED_EVENT = 'wms-clients-changed';

export function notifyClientsChanged(): void {
  window.dispatchEvent(new Event(CLIENTS_CHANGED_EVENT));
}

/** The backend's create-client shape rule, mirrored (DTO `@Matches` + `@Length`). */
export const CLIENT_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,31}$/;
/** The backend's `@Length(1, 200)` on a client name (the tenant name's cap). */
export const MAX_CLIENT_NAME_LENGTH = 200;

/**
 * Whether the client dimension is visible at all: a tenant holding only its
 * own `self` client is the D2C case and sees no client column, no picker.
 */
export function showClients(clients: readonly ClientDto[] | null): boolean {
  return clients !== null && clients.length > 1;
}

/** How a client is named on screen — the tenant's own client reads as the company. */
export function clientLabel(client: ClientDto, tenantName: string | null): string {
  if (client.systemOwned) {
    return tenantName === null || tenantName === '' ? 'Your company' : `${tenantName} (your company)`;
  }
  return `${client.code} — ${client.name}`;
}

/** The short form for a table cell: the code, or the company for `self`. */
export function clientCell(
  clientId: string | null | undefined,
  clients: readonly ClientDto[],
  tenantName: string | null,
): string {
  if (clientId === null || clientId === undefined) return '—';
  const client = clients.find((entry) => entry.id === clientId);
  if (client === undefined) return '—';
  if (client.systemOwned) return tenantName === null || tenantName === '' ? 'Your company' : tenantName;
  return client.code;
}

/** The import's single-client hint — the exact copy the spec names. */
export function singleClientImportHint(tenantName: string | null): string {
  return `Importing for ${tenantName === null || tenantName === '' ? 'your company' : tenantName}. Add clients in Settings to import for a brand.`;
}

/**
 * The import's client choice (decisions 3 and 4):
 * - one client → no picker; the hint line; `clientId` omitted (the backend
 *   defaults to the tenant's own client while it is the only one);
 * - more than one → a REQUIRED picker with no default — a mis-attributed SKU
 *   is fixed once it has history, so nothing is pre-selected;
 * - fix mode → NOTHING is sent: the server inherits the client of the
 *   tenant's LATEST run (which may be another user's or another tab's, so
 *   this card cannot know it — guessing would answer 400 with a wrong
 *   client locked); the result names the client the server used.
 */
export type ImportClientChoice =
  | { readonly kind: 'single'; readonly hint: string }
  | { readonly kind: 'pick' }
  | { readonly kind: 'inherit'; readonly hint: string };

/**
 * Story 21-2b — the result line's client: the label of the client the
 * SERVER reports the run imported for (a fix run inherits server-side, so
 * this card learns the client only from the response). Null when unknown.
 */
export function importedForLabel(
  clients: readonly ClientDto[],
  clientId: string | null,
  tenantName: string | null,
): string | null {
  if (clientId === null) return null;
  const client = clients.find((entry) => entry.id === clientId);
  return client === undefined ? null : clientLabel(client, tenantName);
}

/** The fix-mode hint when the run being fixed is not in hand. */
export const INHERIT_CLIENT_HINT =
  'A fix run imports for the same client as the latest run it fixes — the result names it.';

export function importClientChoice(
  clients: readonly ClientDto[],
  mode: 'initial' | 'fix',
  tenantName: string | null,
): ImportClientChoice {
  if (!showClients(clients)) return { kind: 'single', hint: singleClientImportHint(tenantName) };
  if (mode === 'fix') return { kind: 'inherit', hint: INHERIT_CLIENT_HINT };
  return { kind: 'pick' };
}

/** The `clientId` the import sends, or a problem that stops the submit. */
export function importClientParam(
  choice: ImportClientChoice,
  picked: string,
): { clientId: string | undefined; problem: string | null } {
  switch (choice.kind) {
    case 'single':
    case 'inherit':
      return { clientId: undefined, problem: null };
    case 'pick':
      return picked === ''
        ? { clientId: undefined, problem: 'Choose the client this import is for.' }
        : { clientId: picked, problem: null };
  }
}

/** The create form: trim + uppercase the code, trim the name; refuse what the backend would 400. */
export function parseClientDraft(
  code: string,
  name: string,
): { body: { code: string; name: string } | null; problem: string | null } {
  const normalizedCode = code.trim().toUpperCase();
  const normalizedName = name.trim();
  if (normalizedCode === 'SELF') {
    return { body: null, problem: 'The code SELF is reserved for your own company — choose another.' };
  }
  if (!CLIENT_CODE_RE.test(normalizedCode)) {
    return {
      body: null,
      problem: 'A client code is 2–32 characters of letters, digits and "-", starting with a letter or digit.',
    };
  }
  const nameProblem = clientNameProblem(name);
  if (nameProblem !== null) {
    return { body: null, problem: nameProblem };
  }
  return { body: { code: normalizedCode, name: normalizedName }, problem: null };
}

/**
 * The name rule the create and rename forms share: 1–200 characters once
 * trimmed, counted in CODE POINTS (the backend's `[...name].length`) — never
 * UTF-16 units, which would refuse a 200-character name carrying emoji or
 * other astral characters. Whitespace-only is refused, not sent.
 */
export function clientNameProblem(name: string): string | null {
  const length = [...name.trim()].length;
  return length < 1 || length > MAX_CLIENT_NAME_LENGTH
    ? `A client name is 1–${MAX_CLIENT_NAME_LENGTH} characters.`
    : null;
}

/**
 * The order form's SKU options: once the first line names a SKU, only SKUs
 * of that SKU's client are offered — an order is for one client, and the
 * server refuses a mix (409 `mixed-client`).
 */
export function skusForOrderClient<T extends { id: string; clientId?: string | null }>(
  skus: readonly T[],
  firstLineSkuId: string,
): readonly T[] {
  if (firstLineSkuId === '') return skus;
  const first = skus.find((sku) => sku.id === firstLineSkuId);
  if (first === undefined || first.clientId === null || first.clientId === undefined) return skus;
  return skus.filter((sku) => sku.clientId === first.clientId);
}

/** The shared `mixed-client` sentence — the server names the client codes. */
export function mixedClientReason(problem: ApiProblem): string {
  return problem.detail ?? 'These SKUs belong to more than one client — one document is for one client.';
}

/** Client create / rename refusals. */
export function clientReason(error: unknown, action: 'created' | 'renamed'): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'duplicate-client-code':
        return error.detail ?? 'Another client already uses that code.';
      case 'not-found':
        return 'That client no longer exists — refresh the page.';
      case 'role-denied':
        return 'Only an owner can manage clients.';
      case 'permission-denied':
        return 'Your session belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed.';
      case 'conflict':
        return 'The same submission is still in flight — retry to read the settled result.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the code and name and try again.';
      default:
        return error.detail ?? `Client not ${action} (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * Story 21-2b — the correction's outcome, built from the RESPONSE: the
 * server moves the SKU's whole kit/product group, so every moved SKU is
 * named (the named one first).
 */
export function correctionOutcome(
  moved: readonly { code: string; clientId?: string | null }[],
  clients: readonly ClientDto[],
  tenantName: string | null,
): { word: string; reason: string } {
  const first = moved[0];
  if (first === undefined) return { word: 'Nothing moved', reason: 'The SKU already belongs to that client.' };
  const to = clientCell(first.clientId ?? null, clients, tenantName);
  if (moved.length === 1) {
    return { word: `${first.code} moved`, reason: `It now belongs to ${to}.` };
  }
  const others = moved.slice(1).map((sku) => sku.code).join(', ');
  return {
    word: `${moved.length} SKUs moved`,
    reason: `${first.code} and the SKUs that share its kit or product (${others}) now belong to ${to}.`,
  };
}

/** The owner's SKU client correction refusals. */
export function correctClientReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'sku-has-history':
        // The server names the SKU (it may be a kit partner or product
        // sibling that must move with it) and what it carries.
        return error.detail ?? 'This SKU already has history — its client can no longer change.';
      case 'mixed-client':
        return mixedClientReason(error);
      case 'not-found':
        return 'That SKU or client no longer exists — refresh the page.';
      case 'role-denied':
        return "Only an owner can correct a SKU's client.";
      case 'idempotency-key-reuse':
        return 'This correction was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Choose a client and try again.';
      default:
        return error.status === 409 ? verbatim(error) : (error.detail ?? `Client not corrected (${error.code}).`);
    }
  }
  return UNREACHABLE_REASON;
}

/** The import's refusals (the file-level ones; row errors render per row). */
export function importReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'import-too-large':
        return error.detail ?? 'Keep the file under 10,000 data rows and 5 MB.';
      case 'unsupported-file-type':
        return 'Only .csv and .xlsx files can be imported.';
      case 'file-unreadable':
        return error.detail ?? 'The file could not be read — check the header row uses the documented column names.';
      case 'client-required':
        return 'Choose the client this import is for — this tenant holds more than one client.';
      case 'not-found':
        return 'That client no longer exists — refresh the page and choose again.';
      case 'role-denied':
        return 'Your role cannot import the catalog.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the file and try again.';
      default:
        return error.detail ?? `Import failed (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}
