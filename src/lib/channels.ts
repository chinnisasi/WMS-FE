import { ApiProblem } from '@/lib/api/client';
import type {
  ChannelBufferVerdictDto,
  ChannelConnectionListEntryDto,
  ChannelConnectionResponse,
} from '@/lib/api/generated';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import type { Capability } from '@/lib/users';

/**
 * The channels surface's pure decisions (story 7-1, the `replenishment.ts`
 * pattern): the frozen provider vocabulary with its connect-form field
 * declarations (the FE mirror of the backend's channel-registry — no
 * adapters-catalogue route exists, so the three frozen providers' fields are
 * pinned here as a const, in the registry's wire order), the health
 * vocabulary, the standing-buffer helper types, and the machine-problem
 * reason strings of the reads and commands. Clients branch on the problem
 * `code`, never on prose.
 */

export const CHANNEL_PROVIDERS = ['shopify', 'amazon-in', 'flipkart'] as const;
export type ChannelProvider = (typeof CHANNEL_PROVIDERS)[number];

export const CHANNEL_PROVIDER_LABEL: Record<ChannelProvider, string> = {
  shopify: 'Shopify',
  'amazon-in': 'Amazon.in',
  flipkart: 'Flipkart',
};

/**
 * One credential field the connect/rotate form renders — the mirror of the
 * backend `ChannelCredentialField` (name in the provider's wire order). A
 * required field left blank is refused here TOO (nothing is sent); the
 * backend's 400 stays the authority.
 */
export interface ChannelCredentialFieldSpec {
  readonly name: string;
  readonly label: string;
  readonly required: boolean;
  readonly description: string;
  /**
   * Whether the field is secret material (`true` renders a password input).
   * A non-secret field (Shopify's `locationId` — a warehouse identifier the
   * merchant looks up in their admin) hides behind dots for no reason, so
   * the default for legacy fields is kept at `true` and the new 7-2 fields
   * declare honestly. Optional so the 7-1 declarations stay as written.
   */
  readonly sensitive?: boolean;
}

/**
 * The three frozen providers' credential fields, in registry wire order
 * (story 7-1 froze the provider set; a fourth channel extends BOTH this
 * mirror and the backend registry).
 */
export const CHANNEL_CREDENTIAL_FIELDS: Record<ChannelProvider, readonly ChannelCredentialFieldSpec[]> = {
  shopify: [
    { name: 'shopDomain', label: 'Store domain', required: true, description: 'The *.myshopify.com store domain the API is called against.' },
    { name: 'accessToken', label: 'Admin API access token', required: true, description: 'The Admin API access token minted for this app by the store owner.' },
    { name: 'apiVersion', label: 'Admin API version', required: false, description: 'Optional Admin API version pin (e.g. 2026-01); the adapter default applies when absent.' },
    // Story 7-2's two optional credential fields (the registry declares them;
    // this mirror renders them in the connect/rotate forms automatically):
    // the webhook signing secret the ingest verification checks HMACs
    // against, and the fulfillment location id the writeback requires.
    { name: 'webhookSecret', label: 'Webhook signing secret', required: false, sensitive: true, description: 'The webhook signing secret from the merchant-side app setup — deliveries carry an HMAC the ingest checks against it. Omitted means webhook ingestion stays off.' },
    { name: 'locationId', label: 'Fulfillment location id', required: false, sensitive: false, description: 'The store location id fulfillments are written against — the writeback refuses named (writeback-location-unset) while absent.' },
  ],
  'amazon-in': [
    { name: 'sellerId', label: 'Seller id', required: true, description: "The Selling Partner account's seller identifier." },
    { name: 'refreshToken', label: 'SP-API refresh token', required: true, description: 'The Selling Partner API refresh token minted at app authorization.' },
    { name: 'marketplaceId', label: 'Marketplace id', required: false, description: 'Optional marketplace pin (India when absent).' },
  ],
  flipkart: [
    { name: 'appId', label: 'Application id', required: true, description: "The marketplace seller app's application identifier." },
    { name: 'appSecret', label: 'Application secret', required: true, description: "The marketplace seller app's secret material." },
    { name: 'sellerId', label: 'Seller id', required: false, description: 'Optional seller identifier pin.' },
  ],
};

/** The backorder policy vocabulary (the backend's enum, consumed by 7-2). */
export const BACKORDER_POLICIES = ['accept', 'reject'] as const;
export type BackorderPolicy = (typeof BACKORDER_POLICIES)[number];

export const BACKORDER_POLICY_LABEL: Record<BackorderPolicy, string> = {
  accept: 'Accept backorders',
  reject: 'Reject backorders',
};

/** The sync-health vocabulary (arm 4) — the badge's word, not just its colour. */
export const HEALTH_LABEL = { ok: 'ok', degraded: 'degraded', error: 'error' } as Record<
  ChannelConnectionListEntryDto['health'],
  string
>;

/** The breaker's vocabulary — surfaced next to the health word (arm 4). */
export const BREAKER_LABEL = { closed: 'breaker closed', open: 'breaker open', 'half-open': 'breaker half-open' } as Record<
  ChannelConnectionListEntryDto['breakerState'],
  string
>;

/** The capability every mutating affordance on this surface consults. */
export const CHANNEL_MANAGE_CAPABILITY: Capability = 'channel.manage';

/**
 * One standing-buffer bucket — the list entry carries them as untyped
 * objects on the wire (`{[key: string]: unknown}` in the generated type);
 * this interface is the honest shape the backend's dto declares.
 */
export interface ChannelBufferBucket {
  readonly warehouseId: string;
  readonly skuId: string;
  readonly bufferMilli: number;
}

/** The buckets of one connection, read back with their declared shape. */
export function entryBuckets(entry: ChannelConnectionListEntryDto): readonly ChannelBufferBucket[] {
  return entry.buffers as unknown as readonly ChannelBufferBucket[];
}

/** Fired on `window` after a channels mutation (connect, rotate, buffers, disconnect, retry). */
export const CHANNELS_CHANGED_EVENT = 'wms-channels-changed';

export function notifyChannelsChanged(): void {
  window.dispatchEvent(new Event(CHANNELS_CHANGED_EVENT));
}

/**
 * The list read's failure reasons. The route's only client arms are 401/403
 * (the GET is member-open server-side) — a foreign tenant filter is the
 * 403's shape here.
 */
export function channelListReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? 'Could not load the channel connections.';
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * A connect's failure reasons (capability `channel.manage`). The 409
 * `connection-exists` arm lands VERBATIM (the replenishment convention):
 * the provider got connected between this card's read and the click — the
 * cause is invisible in the DTOs this client holds, so the server's own
 * words are the only honest rendering, and the caller reloads the list (the
 * row the server says exists is the answer).
 */
export function connectReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.status === 409) {
      return error.title !== undefined
        ? `${error.title}${error.detail === undefined ? '' : ` — ${error.detail}`}`
        : (error.detail ?? `Not connected (${error.code}).`);
    }
    switch (error.code) {
      case 'connection-exists':
        return 'This provider is already connected — rotate its credential instead.';
      case 'role-denied':
        return 'Your role cannot connect channels.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This connect was already processed — click again to send a fresh request.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Fill every required credential field — nothing was sent.';
      default:
        return error.detail ?? `Not connected (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * A rotate's failure reasons (capability `channel.manage`). A provider the
 * build no longer registers is a 400 — the connection stays, the material
 * just cannot be replaced from this surface.
 */
export function rotateCredentialsReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        return 'This connection no longer exists — refresh the page.';
      case 'role-denied':
        return 'Your role cannot rotate channel credentials.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This rotation was already processed — click again to send a fresh request.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Fill every required credential field — nothing was sent.';
      default:
        return error.detail ?? `Not rotated (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * A backorder-policy save's failure reasons (capability `channel.manage`).
 * The PUT is last-write-wins — no 409 from the guard; the 409 arm that
 * exists is the same-key-in-flight race.
 */
export function updateConnectionConfigReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        // The 404 covers BOTH: an already-deleted connection and (story 7-2)
        // a foreign or unknown ingest warehouse on this save.
        return 'The connection — or the warehouse chosen to ingest — no longer exists — refresh the page.';
      case 'role-denied':
        return 'Your role cannot change a channel’s backorder policy.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This save was already processed — click again to send a fresh request.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Not saved — check the request and try again.';
      default:
        return error.detail ?? `Not saved (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * A standing-buffer save's failure reasons (capability `channel.manage`).
 * Per-item refusals never land here — they ride the 200 verdicts (the
 * response IS the answer; `buffersSavedSentence` renders them). This mapper
 * covers the whole-request arms: shape, 404, the 503
 * `reservation-store-unavailable` (nothing was written — the store being
 * down refuses EVERYTHING, and saying so honestly is the UI's job).
 */
export function setBuffersReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'reservation-store-unavailable':
        return 'The reservation store is unreachable — no buffer was changed. Try again shortly.';
      case 'not-found':
        return 'A warehouse or SKU on this editor no longer exists — refresh the page.';
      case 'role-denied':
        return 'Your role cannot edit standing buffers.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This save was already processed — click again to send a fresh request.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Buffers must be decimals of at most three places — nothing was sent.';
      default:
        return error.detail ?? `Not saved (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * A disconnect's failure reasons (capability `channel.manage`). The 404
 * covers an already-disconnected connection (a repeat under a NEW key); the
 * DELETE arm has no 403-from-state — a revoke attempt that fails never
 * blocks the delete.
 */
export function disconnectReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        return 'This connection is already gone — refresh the page.';
      case 'role-denied':
        return 'Your role cannot disconnect channels.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This disconnect was already processed — click again to send a fresh request.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Not disconnected — check the request and try again.';
      default:
        return error.detail ?? `Not disconnected (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * A retry's failure reasons (capability `channel.manage`). A 503 is the ATP
 * read failing closed — the retry appended nothing, nothing was broken; the
 * row keeps its health until the retry lands.
 */
export function retryConnectionReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'reservation-store-unavailable':
        return 'The availability read failed closed (the reservation store is unreachable) — nothing was appended. Try again shortly.';
      case 'not-found':
        return 'This connection no longer exists — refresh the page.';
      case 'role-denied':
        return 'Your role cannot retry a channel’s sync.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This retry was already processed — click again to send a fresh request.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Not retried — check the request and try again.';
      default:
        return error.detail ?? `Not retried (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** The connect's one-sentence acceptance — no credential material is ever echoed. */
export function connectAcceptedSentence(response: ChannelConnectionResponse): string {
  return `${response.providerName} is connected — its standing buffers and sync health read below. The credential was sealed, never stored in the clear.`;
}

/** The rotate's one-sentence acceptance, built from the snapshot's own stamps. */
export function credentialsRotatedSentence(): string {
  return 'The credential was replaced in place — the version bumped and the old sealed material overwritten.';
}

/** The backorder-policy save's one-sentence acceptance. */
export function backorderPolicySavedSentence(policy: BackorderPolicy): string {
  return policy === 'accept'
    ? 'Backorders are accepted — 7-2’s ingestion will admit orders beyond ATP per line.'
    : 'Backorders are rejected — 7-2’s ingestion will refuse lines beyond ATP.';
}

/**
 * The buffer save's one-sentence acceptance, built from the RESPONSE (the
 * per-item verdicts are the answer): counts, plus every refused item named
 * with the server's own words — a refusal stands for that item while the
 * others applied. The `code`/`detail` arms are optional on the wire
 * (`refused` always carries them; the union makes the reads prove it).
 */
export function buffersSavedSentence(verdicts: readonly ChannelBufferVerdictDto[]): string {
  const applied = verdicts.filter((v) => v.status === 'applied').length;
  const unchanged = verdicts.filter((v) => v.status === 'unchanged').length;
  const refused = verdicts.filter((v) => v.status === 'refused');
  const parts: string[] = [];
  if (applied > 0) parts.push(`${applied} buffer${applied === 1 ? '' : 's'} applied`);
  if (unchanged > 0) parts.push(`${unchanged} unchanged`);
  const head = parts.length === 0 ? 'Nothing to change' : parts.join(', ');
  const refusedClause =
    refused.length === 0
      ? '.'
      : `. ${refused.length} refused: ${refused
          .map((v) => v.detail ?? v.code ?? 'refused')
          .join(' · ')}`;
  return `${head}${refusedClause}`;
}

/**
 * The providers whose webhook endpoints exist on the wire (the FE mirror of
 * the backend registry's `webhook` declarations — amazon-in/flipkart keep
 * the unconfigured 501 posture, so no URL is offered for them).
 */
export const CHANNEL_WEBHOOK_PROVIDERS = ['shopify'] as const;

/**
 * The webhook endpoint's URL, COMPOSED FROM THE CONFIGURED API BASE (story
 * 7-2, bl-16): the deployment base the backend is publicly reachable on —
 * never `window.location.origin`, which is the browser app's own host and
 * would hand the merchant an unusable URL. The backend's `/api/v1` shell is
 * stripped from the base and the route re-appended, so a base that already
 * carries a path prefix composes the same URL.
 */
export function webhookUrlFromBase(
  apiBaseUrl: string,
  tenantId: string,
  provider: string,
  connectionId: string,
  endpoint: 'orders' | 'cancellations',
): string | null {
  // A relative or malformed base cannot compose a URL for the merchant —
  // return null so the caller offers no copy row instead of crashing the
  // render (code-review triage row 47).
  let url: URL;
  try {
    url = new URL(apiBaseUrl);
  } catch {
    return null;
  }
  url.pathname = url.pathname.replace(/\/api\/v1\/?$/, '');
  return `${url.origin}${url.pathname.replace(/\/$/, '')}/api/v1/tenants/${tenantId}/webhooks/channels/${provider}/${connectionId}/${endpoint}`;
}

/**
 * The mappings READ's failure reasons (capability `channel.manage` — both
 * mapping routes carry it, pinned bl-21; a 403 here is the capability arm).
 */
export function listMappingsReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        return 'This connection no longer exists — refresh the page.';
      case 'role-denied':
        return 'Your role cannot read a channel’s SKU mappings.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `Mappings not shown (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * A mapping save's failure reasons (capability `channel.manage`; full
 * replacement in one transaction). The `validation-failed` arm names the
 * caps — the 200-SKU bound or the publish scope arithmetic
 * (skuCount × activeWarehouses) — so the detail rides VERBATIM: it carries
 * the numbers the editor must bring under the ceiling.
 */
export function setMappingsReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        return 'A connection or SKU on this editor no longer exists — refresh the page.';
      case 'role-denied':
        return 'Your role cannot edit a channel’s SKU mappings.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This save was already processed — click again to send a fresh request.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Mappings must name up to 200 SKUs — nothing was sent.';
      default:
        return error.detail ?? `Not saved (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** The ingest-warehouse save's one-sentence acceptance (story 7-2). */
export function ingestWarehouseSavedSentence(warehouseCode: string | null): string {
  return warehouseCode === null
    ? 'The ingest warehouse was cleared — channel orders will refuse (ingest-warehouse-unset) until a warehouse is set again.'
    : `The ingest warehouse is ${warehouseCode} — channel orders land on it through THE order path.`;
}

/** The mapping save's one-sentence acceptance (story 7-2, full replacement). */
export function mappingsSavedSentence(count: number): string {
  return count === 0
    ? 'The mapping set is cleared — no channel SKU maps, and ingest refuses unmapped lines.'
    : `${count} mapping${count === 1 ? '' : 's'} replaced — rows absent from this save were removed by it, in the same transaction.`;
}

/** The disconnect's one-sentence acceptance. */
export function disconnectAcceptedSentence(): string {
  return 'The connection is deleted — its sealed credential is gone and its standing buffers were released back to the pool.';
}

/** The retry's one-sentence acceptance, built from the snapshot's breaker state. */
export function retryAcceptedSentence(response: ChannelConnectionResponse): string {
  return `The availability snapshot was re-appended — the breaker reads ${response.breakerState}; the delivery lands through the outbox.`;
}

/**
 * One lag figure's inline words (degraded rows name their lag, per UX-DR19)
 * — whole seconds under a minute, whole minutes at or past it.
 */
export function lagLabel(lagMs: number | null): string | null {
  if (lagMs === null) return null;
  if (lagMs < 60_000) return `${Math.round(lagMs / 1000)}s of sync lag`;
  return `${Math.round(lagMs / 60_000)}m of sync lag`;
}