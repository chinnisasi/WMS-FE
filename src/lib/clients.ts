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
import type {
  AddressDto,
  ClientContactDto,
  ClientDto,
  ClientRegisteredAddressInputDto,
  ClientTaxDetailsDto,
  CreateClientContactDto,
  UpdateClientTaxDetailsDto,
} from '@/lib/api/generated';
import { CLIENT_DEPARTED_REASON } from '@/lib/client-departed';
import { GST_STATE_NAMES, GSTIN_STATE_CODES } from '@/lib/gst-states';
import { parseGstinField } from '@/lib/gstin';
import { UNREACHABLE_REASON, emptyDestinationFields, parseDestinationFields, verbatim, type DestinationFields } from '@/lib/outbound-orders';

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

/**
 * Story 1-2a — whether a client takes NEW work: every status but `departed`.
 * A suspended client still ships (decision 5 — suspension cuts only the
 * portal), so only departure hides a client from the pickers that start new
 * work (orders, ASNs, imports, kits, variants, mappings, rate-card drafts,
 * SKU corrections). History lists, reports and invoices still show it.
 */
export function clientTakesWork(client: Pick<ClientDto, 'status'>): boolean {
  return client.status !== 'departed';
}

/** Story 1-2a — the clients a picker that starts new work offers. Null passes through (not loaded). */
export function workingClients(clients: readonly ClientDto[] | null): readonly ClientDto[] | null {
  return clients === null ? null : clients.filter(clientTakesWork);
}

/**
 * Story 1-2a — the SKU filter built on `clientTakesWork`: drop the SKUs of a
 * departed client. With the clients not loaded (null) nothing is dropped —
 * the server refuses 409 `client-departed` anyway; a SKU whose client is
 * unknown here is kept for the same reason.
 */
export function skusOfWorkingClients<T extends { readonly clientId?: string | null }>(
  skus: readonly T[],
  clients: readonly ClientDto[] | null,
): readonly T[] {
  if (clients === null) return skus;
  const departed = new Set(clients.filter((client) => !clientTakesWork(client)).map((client) => client.id));
  if (departed.size === 0) return skus;
  return skus.filter((sku) => sku.clientId === null || sku.clientId === undefined || !departed.has(sku.clientId));
}

/** Story 1-2a — whether a SKU's client has departed (false when unknown). */
export function skuClientDeparted(
  sku: { readonly clientId?: string | null },
  clients: readonly ClientDto[] | null,
): boolean {
  if (clients === null || sku.clientId === null || sku.clientId === undefined) return false;
  const client = clients.find((entry) => entry.id === sku.clientId);
  return client !== undefined && !clientTakesWork(client);
}

/** Story 1-2a — the words a return gate shows for a departed client's order. */
export const RETURNS_CLIENT_DEPARTED = 'Client departed — reactivate to accept returns';

/** Story 1-2a — the words every surface shows for a 409 `client-departed` (a leaf module). */
export { CLIENT_DEPARTED_REASON };

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

/**
 * Story 1-1 — the import card's uniqueness rule: a SKU code and a barcode are
 * unique per client (`skus_tenant_client_code_unique`,
 * `skus_tenant_client_barcode_unique`), so a duplicate is refused only
 * within the run's client.
 */
export const CATALOG_CODES_PER_CLIENT_HELP =
  'SKU codes and barcodes are unique per client: two clients may both own a code or a barcode, but one client cannot hold it twice.';

/** Story 1-1 — a kit cell names components of the run's own client. */
export const KIT_CELL_CLIENT_HELP = "naming this client's SKUs";

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
 * Story 21-6 — the ASN form's SKU options once its client is chosen: the
 * explicit-client picker (story 1-1: the order form uses it too). An ASN names its client
 * up front (and the server refuses another client's SKU 409
 * `sku-client-mismatch`), so the picker offers only that client's SKUs —
 * and none until a client is picked. A SKU row without a client (a response
 * stored before 21-2b) is never offered: it cannot be shown to match.
 */
export function skusOfClient<T extends { id: string; clientId?: string | null }>(
  skus: readonly T[],
  clientId: string,
): readonly T[] {
  if (clientId === '') return [];
  return skus.filter((sku) => sku.clientId === clientId);
}

/**
 * Story 1-1 — a client's short name inside a SKU label: the brand's code,
 * or the tenant's own company by its name (the `self` client mirrors the
 * tenant name; an empty one reads "Your company").
 */
export function clientShortLabel(client: Pick<ClientDto, 'code' | 'name' | 'systemOwned'>): string {
  if (client.systemOwned) return client.name === '' ? 'Your company' : client.name;
  return client.code;
}

/**
 * Story 1-1 — how a SKU is named in a picker or a list. A SKU code (and a
 * barcode) is unique per client, not per tenant, so two brands can both own
 * `TSHIRT-M`: once the tenant holds more than one client the label appends
 * the SKU's client — `TSHIRT-M · ACME`. With one client (or the clients not
 * loaded, or a SKU whose client is unknown here) it is the bare code, so a
 * single-client tenant sees nothing change.
 */
export function skuDisplayLabel(
  sku: { readonly code: string; readonly clientId?: string | null },
  clients: readonly ClientDto[] | null,
): string {
  if (!showClients(clients) || sku.clientId === null || sku.clientId === undefined) return sku.code;
  const client = clients!.find((entry) => entry.id === sku.clientId);
  return client === undefined ? sku.code : `${sku.code} · ${clientShortLabel(client)}`;
}

/**
 * Story 1-1 — the same suffix for any SKU-named text that is not the code
 * (a name in the Batches datalist): `Serum 30 ml · ACME`, or the text alone
 * under the same one-client rule.
 */
export function withSkuClient(
  text: string,
  sku: { readonly clientId?: string | null },
  clients: readonly ClientDto[] | null,
): string {
  return skuDisplayLabel({ code: text, clientId: sku.clientId }, clients);
}

/**
 * Story 1-1 — the client a picker narrows to from a SKU already chosen (the
 * channel mapping's first row, a kit, a product's existing variant): that
 * SKU's client, or null (no narrowing) when it is not chosen, not loaded or
 * carries no client.
 */
export function clientOfSku(
  skus: readonly { readonly id: string; readonly clientId?: string | null }[],
  skuId: string | null | undefined,
): string | null {
  if (skuId === null || skuId === undefined || skuId === '') return null;
  return skus.find((sku) => sku.id === skuId)?.clientId ?? null;
}

/**
 * Story 1-1 — a SKU picker's order: by code, two clients' same code side by
 * side, the tie broken by the client's short name (`TSHIRT-M · ACME` before
 * `TSHIRT-M · BETA`) so the order is stable rather than the read's.
 */
export function sortSkusForPicker<T extends { readonly code: string; readonly clientId?: string | null }>(
  skus: readonly T[],
  clients: readonly ClientDto[] | null,
): T[] {
  const tie = (sku: T) => {
    const client = clients?.find((entry) => entry.id === sku.clientId);
    return client === undefined ? '' : clientShortLabel(client);
  };
  return [...skus].sort((a, b) => a.code.localeCompare(b.code) || tie(a).localeCompare(tie(b)));
}

/**
 * A narrowed picker keeps a row's CURRENT SKU listed even when it falls
 * outside the narrowing (a stored mapping made before the narrowing): a
 * `<select>` whose value is not among its options would show — and save —
 * another SKU.
 */
export function keepCurrentSku<T extends { readonly id: string }>(
  options: readonly T[],
  all: readonly T[],
  currentId: string,
): readonly T[] {
  if (currentId === '' || options.some((sku) => sku.id === currentId)) return options;
  const current = all.find((sku) => sku.id === currentId);
  return current === undefined ? options : [current, ...options];
}

/* ── story 1-1: order entry is client-first ─────────────────────────────── */

/** The SKU select's placeholder before a client is chosen. */
export const PICK_CLIENT_FIRST = 'Pick a client first';

/**
 * The order form's SKU options. With more than one client the form asks for
 * the client first and every line offers only that client's SKUs (none
 * until one is picked — a SKU code alone no longer names one SKU). With one
 * client (or the clients not loaded) nothing changes: every SKU is offered.
 * No `clientId` is sent either way — the server derives it from the lines.
 */
export function orderSkuOptions<T extends { id: string; clientId?: string | null }>(
  skus: readonly T[],
  clients: readonly ClientDto[] | null,
  pickedClientId: string,
): readonly T[] {
  return showClients(clients) ? skusOfClient(skus, pickedClientId) : skus;
}

/**
 * The clients an order can be entered for. Story 1-2a decision 5: a
 * SUSPENDED client still ships (suspension cuts only the portal), so only a
 * departed one is left out (`clientTakesWork`). Null passes through (not loaded).
 */
export function orderableClients(clients: readonly ClientDto[] | null): readonly ClientDto[] | null {
  return workingClients(clients);
}

/** The submit's client problem: a multi-client tenant must pick one first. */
export function orderClientProblem(clients: readonly ClientDto[] | null, pickedClientId: string): string | null {
  return showClients(clients) && pickedClientId === '' ? 'Choose the client this order is for.' : null;
}

/**
 * The lines a client change would clear: every line whose SKU is not the
 * next client's (a blank line is kept). Pure, so the confirm row's count
 * and the clearing itself cannot disagree.
 */
export function linesKeptForClient<R extends { skuId: string }>(
  rows: readonly R[],
  skus: readonly { id: string; clientId?: string | null }[],
  nextClientId: string,
): readonly R[] {
  return rows.filter((row) => row.skuId === '' || clientOfSku(skus, row.skuId) === nextClientId);
}

/** The confirm row's question before a client change clears lines. */
export function clientChangeQuestion(cleared: number, nextClientLabel: string): string {
  const lines =
    cleared === 1
      ? "the line already picked — it is another client's SKU"
      : `the ${cleared} lines already picked — they are another client's SKUs`;
  return `Change the client to ${nextClientLabel}? This clears ${lines}.`;
}

/** Story 1-1 — narrow options to one client; `null` offers them all. */
export function narrowToClient<T extends { readonly clientId?: string | null }>(
  skus: readonly T[],
  clientId: string | null,
): readonly T[] {
  return clientId === null ? skus : skus.filter((sku) => sku.clientId === clientId);
}

/** The shared `mixed-client` sentence — the server names the client codes. */
export function mixedClientReason(problem: ApiProblem): string {
  return problem.detail ?? 'These SKUs belong to more than one client — one document is for one client.';
}

/** Story 21-10 — the Status column's words (the API's lowercase status, never shown raw). */
export function clientStatusLabel(status: ClientDto['status']): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'suspended':
      return 'Suspended';
    case 'departed':
      return 'Departed';
    default:
      return status;
  }
}

/**
 * Story 21-10 — the row actions that move a client between `active` and
 * `suspended`; story 1-2a adds `depart` (offboarding).
 */
export type ClientStatusAction = 'suspend' | 'reactivate' | 'depart';

/**
 * The status actions a row offers, in order (story 1-2a: a list):
 * - active → Suspend, Depart;
 * - suspended → Reactivate, Depart;
 * - departed → Reactivate.
 * Nothing on the tenant's own `self` client (the server refuses it 400). The
 * caller gates on `clients.manage` as well.
 */
export function clientStatusAction(client: ClientDto): readonly ClientStatusAction[] {
  if (client.systemOwned) return [];
  switch (client.status) {
    case 'active':
      return ['suspend', 'depart'];
    case 'suspended':
      return ['reactivate', 'depart'];
    case 'departed':
      return ['reactivate'];
    default:
      return [];
  }
}

/** The status the PATCH sends for an action. */
export function clientStatusTarget(action: ClientStatusAction): 'active' | 'suspended' | 'departed' {
  switch (action) {
    case 'suspend':
      return 'suspended';
    case 'depart':
      return 'departed';
    case 'reactivate':
      return 'active';
  }
}

/** The row button's word for an action. */
export function clientStatusActionLabel(action: ClientStatusAction): string {
  switch (action) {
    case 'suspend':
      return 'Suspend';
    case 'depart':
      return 'Depart';
    case 'reactivate':
      return 'Reactivate';
  }
}

/** The confirmation question — what the change stops and what it does not. */
export function clientStatusQuestion(action: ClientStatusAction, name: string, from?: ClientDto['status']): string {
  switch (action) {
    case 'suspend':
      return `Suspend ${name}? Its portal users are signed out on their next action and cannot sign in or announce shipments; no new portal users can be invited and no new rate card can be drafted or activated. Warehouse work and billing continue (it cannot see invoices in the portal while suspended). Open ASNs stay open.`;
    case 'depart':
      return `Depart ${name}? It takes no new work from now on: no new orders, purchase orders, shipment notices, returns, SKUs, imports or channel mappings, and stock that turns up for it is refused until it is reactivated. Its portal users are signed out now. Its history, reports and invoices stay. It can depart only once nothing is left open for it.`;
    case 'reactivate':
      return from === 'departed'
        ? `Reactivate ${name}? It takes work again; its portal users sign in again to use the portal.`
        : `Reactivate ${name}? Its portal users can sign in again.`;
  }
}

/** The confirm button's words for an action on a client. */
export function clientStatusConfirmLabel(action: ClientStatusAction, code: string): string {
  return `${clientStatusActionLabel(action)} ${code}`;
}

/** The success sentence, built from the RESPONSE's client — one per target status. */
export function clientStatusSuccess(client: ClientDto): string {
  switch (client.status) {
    case 'suspended':
      return `${client.name} is suspended.`;
    case 'departed':
      return `${client.name} has departed — it takes no new work, and its history stays.`;
    default:
      return `${client.name} is active again.`;
  }
}

/** The outcome word for a status response. */
export function clientStatusWord(client: ClientDto): string {
  switch (client.status) {
    case 'suspended':
      return `${client.code} suspended`;
    case 'departed':
      return `${client.code} departed`;
    default:
      return `${client.code} reactivated`;
  }
}

/** The refusal word per action. */
export function clientStatusRefusedWord(action: ClientStatusAction): string {
  switch (action) {
    case 'suspend':
      return 'Not suspended';
    case 'depart':
      return 'Not departed';
    case 'reactivate':
      return 'Not reactivated';
  }
}

/** The `clientReason` action of a status action. */
export function clientStatusReasonAction(action: ClientStatusAction): 'suspended' | 'departed' | 'reactivated' {
  return action === 'suspend' ? 'suspended' : action === 'depart' ? 'departed' : 'reactivated';
}

// ── story 1-2a: the departure's blockers ────────────────────────────────────

/** One reason a client cannot depart yet (the server's `blockers[]`). */
export interface DepartureBlocker {
  readonly kind: string;
  readonly count: number;
  readonly codes: readonly string[];
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The words for each blocker kind the server knows (an unknown kind has its own fallback). */
const BLOCKER_WORDS: Readonly<Record<string, (n: number) => string>> = {
  stock: (n) => `Stock on hand in ${plural(n, 'SKU', 'SKUs')}`,
  'open-purchase-orders': (n) => plural(n, 'open purchase order', 'open purchase orders'),
  'open-asns': (n) => plural(n, 'open shipment notice', 'open shipment notices'),
  'pending-over-receipts': (n) => `${plural(n, 'over-receipt', 'over-receipts')} awaiting a decision`,
  'open-orders': (n) => plural(n, 'open order', 'open orders'),
  'open-rmas': (n) => plural(n, 'open return', 'open returns'),
  'pending-adjustments': (n) => `${plural(n, 'stock adjustment', 'stock adjustments')} awaiting approval`,
  'open-counts': (n) => plural(n, 'open count', 'open counts'),
  'open-review-items': (n) => `${plural(n, 'item', 'items')} in Conflicts & Reviews`,
  'unsettled-invoices': (n) => plural(n, 'unsettled client invoice', 'unsettled client invoices'),
};

/**
 * Story 1-2a — the blockers of a 409 `client-not-wound-down` (its
 * `extensions.blockers`), or null for any other error or a malformed list.
 * Entries that are not `{kind: string, count: number}` are dropped.
 */
export function departureBlockers(error: unknown): readonly DepartureBlocker[] | null {
  if (!(error instanceof ApiProblem) || error.code !== 'client-not-wound-down') return null;
  const raw = error.extensions['blockers'];
  if (!Array.isArray(raw)) return null;
  const blockers: DepartureBlocker[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { kind, count, codes } = entry as { kind?: unknown; count?: unknown; codes?: unknown };
    if (typeof kind !== 'string' || typeof count !== 'number') continue;
    blockers.push({
      kind,
      count,
      codes: Array.isArray(codes) ? codes.filter((code): code is string => typeof code === 'string') : [],
    });
  }
  return blockers;
}

/**
 * One blocker in words: "Stock on hand in 4 SKUs", "2 open orders: SO-104,
 * SO-109 and 1 more"; an unknown kind reads "N other open items (kind)".
 */
export function departureBlockerLine(blocker: DepartureBlocker): string {
  const words = Object.prototype.hasOwnProperty.call(BLOCKER_WORDS, blocker.kind)
    ? BLOCKER_WORDS[blocker.kind]!(blocker.count)
    : `${blocker.count} other open ${blocker.count === 1 ? 'item' : 'items'} (${blocker.kind})`;
  if (blocker.codes.length === 0) return words;
  const more = blocker.count - blocker.codes.length;
  return `${words}: ${blocker.codes.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

/** The lead sentence above the blocker list. */
export const DEPARTURE_BLOCKED_LEAD = 'This client cannot depart yet. Finish, cancel or settle each of these, then depart it again:';

/** Client create / rename / suspend / depart / reactivate refusals. */
export function clientReason(
  error: unknown,
  action: 'created' | 'renamed' | 'suspended' | 'departed' | 'reactivated',
): string {
  const statusAction = action === 'suspended' || action === 'reactivated' || action === 'departed';
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'duplicate-client-code':
        return error.detail ?? 'Another client already uses that code.';
      case 'client-not-active':
        return statusAction
          ? 'A departed client can only be reactivated.'
          : (error.detail ?? 'This client is not active.');
      case 'client-not-wound-down':
        return error.detail ?? 'This client still has open work — it cannot depart yet.';
      case 'client-departed':
        return CLIENT_DEPARTED_REASON;
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
        return error.detail ?? (statusAction ? 'That status change is not allowed.' : 'Check the code and name and try again.');
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
      // Story 1-2a: the target client has departed (it takes no new SKUs).
      case 'client-departed':
        return CLIENT_DEPARTED_REASON;
      // Story 1-1: a code and a barcode are unique per client — the target
      // client already holds the code or barcode of a SKU that would move
      // (the server names which).
      case 'duplicate-sku-code':
        return error.detail ?? 'That client already has a SKU with this code — rename one first.';
      case 'duplicate-barcode':
        return error.detail ?? 'That client already has a SKU with this barcode — clear or change one first.';
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
      // Story 1-2a: the run's client has departed (it takes no new SKUs).
      case 'client-departed':
        return CLIENT_DEPARTED_REASON;
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

// ── story 21-5: the client's tax details ────────────────────────────────────

/** A client with no tax details at all (every field unset). */
export const NO_TAX_DETAILS: ClientTaxDetailsDto = Object.freeze({
  legalName: null,
  gstin: null,
  billingLine1: null,
  billingLine2: null,
  billingCity: null,
  billingStateCode: null,
  billingPincode: null,
});

/** The tax-detail fields in the backend's fixed order. */
export const TAX_DETAIL_FIELDS = [
  'legalName',
  'gstin',
  'billingLine1',
  'billingLine2',
  'billingCity',
  'billingStateCode',
  'billingPincode',
] as const;
export type TaxDetailField = (typeof TAX_DETAIL_FIELDS)[number];

/** The form's text fields (an unset value is ''). */
export type TaxDetailsFields = Record<TaxDetailField, string>;

/** The backend's ceilings (the 0062 CHECKs / the address primitive). */
export const TAX_DETAIL_MAX: Readonly<Record<Exclude<TaxDetailField, 'gstin' | 'billingStateCode' | 'billingPincode'>, number>> = {
  legalName: 200,
  billingLine1: 200,
  billingLine2: 200,
  billingCity: 100,
};

const TAX_DETAIL_LABEL: Readonly<Record<TaxDetailField, string>> = {
  legalName: 'Legal name',
  gstin: 'GSTIN',
  billingLine1: 'Address line 1',
  billingLine2: 'Address line 2',
  billingCity: 'City',
  billingStateCode: 'State',
  billingPincode: 'Pincode',
};

export function taxDetailLabel(field: TaxDetailField): string {
  return TAX_DETAIL_LABEL[field];
}

/** The state select's options: every GST registration code, `27 — Maharashtra`, by code. */
export const BILLING_STATE_OPTIONS: readonly { readonly code: string; readonly label: string }[] = Object.freeze(
  GSTIN_STATE_CODES.map((code) => ({ code, label: `${code} — ${GST_STATE_NAMES[code] ?? code}` })),
);

/** A client's stored tax details as form text (a pre-21-5 read without them is all unset). */
export function taxDetailsFieldsOf(client: Pick<ClientDto, 'taxDetails'>): TaxDetailsFields {
  const details = client.taxDetails ?? NO_TAX_DETAILS;
  return Object.fromEntries(TAX_DETAIL_FIELDS.map((field) => [field, details[field] ?? ''])) as TaxDetailsFields;
}

/**
 * The form → the PATCH body, or a problem (nothing is sent when set): only
 * the CHANGED fields are sent (an untouched field stays absent — unchanged on
 * the server); a field emptied is sent as `null` (cleared). The rules the
 * backend answers 400 to are mirrored so a guaranteed refusal is never sent:
 * the GSTIN shape and registration prefix (`parseGstinField`), a six-digit
 * pincode, the ceilings, and the GSTIN agreeing with the billing state.
 * Nothing changed → `body: {}` with no problem (the caller says so).
 */
export function parseTaxDetailsDraft(
  fields: TaxDetailsFields,
  stored: ClientTaxDetailsDto | undefined,
): { body: UpdateClientTaxDetailsDto; problem: null } | { body: null; problem: string } {
  const current = stored ?? NO_TAX_DETAILS;
  const next: Record<TaxDetailField, string | null> = { ...NO_TAX_DETAILS };
  for (const field of TAX_DETAIL_FIELDS) {
    const trimmed = fields[field].trim();
    next[field] = trimmed === '' ? null : field === 'gstin' ? trimmed.toUpperCase() : trimmed;
  }
  for (const [field, max] of Object.entries(TAX_DETAIL_MAX) as [TaxDetailField, number][]) {
    const value = next[field];
    if (value !== null && [...value].length > max) return { body: null, problem: `${taxDetailLabel(field)} is at most ${max} characters.` };
  }
  if (next.gstin !== null) {
    const parsed = parseGstinField(next.gstin, 'The GSTIN');
    if (parsed.problem !== null) return { body: null, problem: parsed.problem };
  }
  if (next.billingPincode !== null && !/^\d{6}$/.test(next.billingPincode)) {
    return { body: null, problem: 'A pincode is six digits.' };
  }
  if (next.billingStateCode !== null && !GSTIN_STATE_CODES.includes(next.billingStateCode)) {
    return { body: null, problem: 'Choose a state from the list.' };
  }
  if (next.gstin !== null && next.billingStateCode !== null && next.gstin.slice(0, 2) !== next.billingStateCode) {
    const named = GST_STATE_NAMES[next.gstin.slice(0, 2)] ?? next.gstin.slice(0, 2);
    return {
      body: null,
      problem: `This GSTIN is registered in ${named} (${next.gstin.slice(0, 2)}) — a registered client is billed in its GSTIN's state, so pick that state.`,
    };
  }
  const body: Record<string, string | null> = {};
  for (const field of TAX_DETAIL_FIELDS) {
    if (next[field] !== (current[field] ?? null)) body[field] = next[field];
  }
  return { body: body as UpdateClientTaxDetailsDto, problem: null };
}

/**
 * The card's one-line summary of a client's tax details: the legal name, the
 * GSTIN (or "unregistered") and the billing state — or what is still missing
 * before an invoice can issue to it (the same parts the invoice's
 * recipient gaps name).
 */
export function taxDetailsSummary(client: Pick<ClientDto, 'taxDetails' | 'systemOwned'>): string {
  if (client.systemOwned) return '—';
  const details = client.taxDetails ?? NO_TAX_DETAILS;
  const missing = [
    details.legalName === null ? 'legal name' : null,
    details.billingLine1 === null || details.billingCity === null || details.billingStateCode === null || details.billingPincode === null
      ? 'billing address'
      : null,
  ].filter((part): part is string => part !== null);
  if (missing.length > 0) return `Missing ${missing.join(' and ')} — needed to invoice`;
  const state = details.billingStateCode === null ? '' : ` · ${GST_STATE_NAMES[details.billingStateCode] ?? details.billingStateCode}`;
  return `${details.legalName} · ${details.gstin ?? 'Unregistered'}${state}`;
}

/** The tax-details write's refusals. */
export function taxDetailsReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'validation-failed':
        return error.detail ?? 'Check the tax details and try again.';
      case 'not-found':
        return 'That client no longer exists — refresh the page.';
      case 'role-denied':
        return 'Only an owner or an accountant can set tax details.';
      case 'permission-denied':
        return 'Your session belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed with different details — edit and save again.';
      case 'conflict':
        return 'The same submission is still in flight — retry to read the settled result.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `Tax details not saved (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

// ── story 1-2a: contacts ────────────────────────────────────────────────────

/** The contact roles, in the backend's vocabulary order. */
export const CONTACT_ROLES = ['operations', 'billing', 'returns'] as const satisfies readonly ClientContactDto['roles'][number][];
export type ContactRole = (typeof CONTACT_ROLES)[number];

const CONTACT_ROLE_LABEL: Readonly<Record<ContactRole, string>> = {
  operations: 'Operations',
  billing: 'Billing',
  returns: 'Returns',
};

export function contactRoleLabel(role: ContactRole): string {
  return CONTACT_ROLE_LABEL[role];
}

/** A contact's roles in words — "General" when it carries none. */
export function contactRolesLabel(roles: readonly ContactRole[]): string {
  return roles.length === 0 ? 'General' : roles.map(contactRoleLabel).join(', ');
}

/** The backend's ceilings (the 0077 CHECKs, `ADDRESS_FIELD_LENGTHS.phone`, the email column). */
export const MAX_CONTACT_NAME_LENGTH = 120;
export const MAX_CONTACT_PHONE_LENGTH = 20;
export const MAX_CONTACT_EMAIL_LENGTH = 254;
/** The most contacts one client holds (a 21st is 409 `contact-limit`). */
export const MAX_CLIENT_CONTACTS = 20;

/**
 * The email rule, mirrored from the server's `isEmailAddress` closely enough
 * to never send a guaranteed refusal: trimmed and lower-cased, one `@` with
 * something before it, a dot inside the domain, no spaces, at most 254
 * characters. The server's `validation-failed` detail is the fallback for
 * anything stricter it checks.
 */
export function contactEmailProblem(email: string): string | null {
  const value = email.trim().toLowerCase();
  if (value === '') return 'An email is required.';
  if (value.length > MAX_CONTACT_EMAIL_LENGTH) return `An email is at most ${MAX_CONTACT_EMAIL_LENGTH} characters.`;
  const at = value.lastIndexOf('@');
  const local = at <= 0 ? '' : value.slice(0, at);
  const domain = at <= 0 ? '' : value.slice(at + 1);
  const dot = domain.indexOf('.');
  if (local === '' || /\s/.test(value) || local.includes('@') || dot <= 0 || dot === domain.length - 1 || domain.endsWith('.')) {
    return 'Enter an email address like name@company.com.';
  }
  return null;
}

/** The contact form's text fields. */
export interface ContactFields {
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly roles: readonly ContactRole[];
}

export function emptyContactFields(): ContactFields {
  return { name: '', email: '', phone: '', roles: [] };
}

export function contactFieldsOf(contact: ClientContactDto): ContactFields {
  return { name: contact.name, email: contact.email, phone: contact.phone ?? '', roles: [...contact.roles] };
}

/** Whether a draft differs from where it started (the panel asks before discarding it). */
export function contactDraftDirty(fields: ContactFields, from: ContactFields): boolean {
  return (
    fields.name !== from.name ||
    fields.email !== from.email ||
    fields.phone !== from.phone ||
    fields.roles.length !== from.roles.length ||
    fields.roles.some((role) => !from.roles.includes(role))
  );
}

/**
 * The form → the body, or a problem (nothing is sent when set): the name
 * trimmed (1–120 code points), the email trimmed and lower-cased
 * (`contactEmailProblem`), a blank phone sent as null (≤ 20), the roles in
 * vocabulary order.
 */
export function parseContactDraft(
  fields: ContactFields,
): { body: CreateClientContactDto & { phone: string | null }; problem: null } | { body: null; problem: string } {
  const name = fields.name.trim();
  const nameLength = [...name].length;
  if (nameLength < 1 || nameLength > MAX_CONTACT_NAME_LENGTH) {
    return { body: null, problem: `A contact name is 1–${MAX_CONTACT_NAME_LENGTH} characters.` };
  }
  const emailProblem = contactEmailProblem(fields.email);
  if (emailProblem !== null) return { body: null, problem: emailProblem };
  const phone = fields.phone.trim();
  if (phone.length > MAX_CONTACT_PHONE_LENGTH) {
    return { body: null, problem: `A phone is at most ${MAX_CONTACT_PHONE_LENGTH} characters.` };
  }
  return {
    body: {
      name,
      email: fields.email.trim().toLowerCase(),
      phone: phone === '' ? null : phone,
      roles: CONTACT_ROLES.filter((role) => fields.roles.includes(role)),
    },
    problem: null,
  };
}

/** The contact writes' refusals. */
export function contactReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'primary-contact-required':
        return 'This is the primary contact — make another contact primary first.';
      case 'duplicate-contact-email':
        return 'Another contact of this client already uses that email.';
      case 'contact-limit':
        return `A client holds at most ${MAX_CLIENT_CONTACTS} contacts — remove one first.`;
      case 'not-found':
        return 'That contact or client no longer exists — refresh the list.';
      case 'role-denied':
        return 'Only an owner can manage contacts.';
      case 'permission-denied':
        return 'Your session belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed with different details — edit and save again.';
      case 'conflict':
        return 'The same submission is still in flight — retry to read the settled result.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the contact and try again.';
      default:
        return error.detail ?? `Contact not saved (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** The contacts read's failure. */
export function contactsReadReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        return 'That client no longer exists — refresh the page.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `Contacts not loaded (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

// ── story 1-2a: addresses ───────────────────────────────────────────────────

/** The registered address form's fields (an unset value is ''). */
export interface RegisteredAddressFields {
  readonly line1: string;
  readonly line2: string;
  readonly city: string;
  readonly stateCode: string;
  readonly pincode: string;
}

export function registeredFieldsOf(client: Pick<ClientDto, 'registeredAddress'>): RegisteredAddressFields {
  const address = client.registeredAddress ?? null;
  return address === null
    ? { line1: '', line2: '', city: '', stateCode: '', pincode: '' }
    : { line1: address.line1, line2: address.line2 ?? '', city: address.city, stateCode: address.stateCode, pincode: address.pincode };
}

/** The return address as the shared destination field set. */
export function returnFieldsOf(client: Pick<ClientDto, 'returnAddress'>): DestinationFields {
  const address = client.returnAddress ?? null;
  return address === null
    ? emptyDestinationFields()
    : {
        contactName: address.contactName,
        phone: address.phone,
        line1: address.line1,
        line2: address.line2 ?? '',
        city: address.city,
        state: address.state,
        pincode: address.pincode,
      };
}

/**
 * The registered address form → the wire group, or a problem: every field
 * but line 2 required, the 21-5 billing ceilings, a state from the GST
 * registration list (the tax form's select), a six-digit pincode.
 */
export function parseRegisteredAddress(
  fields: RegisteredAddressFields,
): { address: ClientRegisteredAddressInputDto; problem: null } | { address: null; problem: string } {
  const t = {
    line1: fields.line1.trim(),
    line2: fields.line2.trim(),
    city: fields.city.trim(),
    stateCode: fields.stateCode.trim(),
    pincode: fields.pincode.trim(),
  };
  const missing = [
    ['line1', 'an address line 1'],
    ['city', 'a city'],
    ['stateCode', 'a state'],
    ['pincode', 'a pincode'],
  ].filter(([key]) => t[key as keyof typeof t] === '');
  if (missing.length > 0) {
    const labels = missing.map(([, text]) => text);
    const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
    return { address: null, problem: `The registered address needs ${list}.` };
  }
  if ([...t.line1].length > 200 || [...t.line2].length > 200) return { address: null, problem: 'An address line is at most 200 characters.' };
  if ([...t.city].length > 100) return { address: null, problem: 'A city is at most 100 characters.' };
  if (!GSTIN_STATE_CODES.includes(t.stateCode)) return { address: null, problem: 'Choose a state from the list.' };
  if (!/^\d{6}$/.test(t.pincode)) return { address: null, problem: 'The pincode is six digits, as text — leading zeros are part of it.' };
  return {
    address: { line1: t.line1, ...(t.line2 === '' ? {} : { line2: t.line2 }), city: t.city, stateCode: t.stateCode, pincode: t.pincode },
    problem: null,
  };
}

/** The return address form → the wire address (the shared shipment parser, labelled 'return address'). */
export function parseReturnAddress(fields: DestinationFields): { address: AddressDto | null; problem: string | null } {
  const parsed = parseDestinationFields(fields, 'return address');
  return { address: parsed.destination, problem: parsed.problem };
}

/** One address in a line (the card's summary). */
export function registeredAddressLine(client: Pick<ClientDto, 'registeredAddress'>): string {
  const address = client.registeredAddress ?? null;
  if (address === null) return 'Not set';
  const state = GST_STATE_NAMES[address.stateCode] ?? address.stateCode;
  return [address.line1, address.line2, address.city, `${state} ${address.pincode}`].filter((part) => part !== null && part !== '').join(', ');
}

export function returnAddressLine(client: Pick<ClientDto, 'returnAddress'>): string {
  const address = client.returnAddress ?? null;
  if (address === null) return 'Not set';
  return [`${address.contactName} (${address.phone})`, address.line1, address.line2, address.city, `${address.state} ${address.pincode}`]
    .filter((part) => part !== undefined && part !== null && part !== '')
    .join(', ');
}

/** The addresses write's refusals. */
export function addressesReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'validation-failed':
        return error.detail ?? 'Check the address and try again.';
      case 'not-found':
        return 'That client no longer exists — refresh the page.';
      case 'role-denied':
        return 'Only an owner can set a client’s addresses.';
      case 'permission-denied':
        return 'Your session belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed with different details — edit and save again.';
      case 'conflict':
        return 'The same submission is still in flight — retry to read the settled result.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `Addresses not saved (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}
