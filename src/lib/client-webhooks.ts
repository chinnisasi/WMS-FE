import { ApiProblem } from '@/lib/api/client';
import type { WebhookDeliveryDto, WebhookEndpointDto } from '@/lib/api/generated';
import type { StatusTone } from '@/lib/status-tone';

/**
 * Story 5-2a — the client webhooks panel's words, pure so each is pinned by
 * `client-webhooks.test.ts`. Every vocabulary is a `Record` over the
 * GENERATED union, so a status, reason or event type the backend adds fails
 * this file's compile until it has copy.
 */

export type WebhookEventType = WebhookEndpointDto['eventTypes'][number];
export type WebhookEndpointStatus = WebhookEndpointDto['status'];
export type WebhookDisabledReason = NonNullable<WebhookEndpointDto['disabledReason']>;
export type WebhookDeliveryStatus = WebhookDeliveryDto['status'];

export const WEBHOOK_EVENT_TYPES = ['receipt.recorded', 'order.dispatched', 'order.delivered'] as const satisfies readonly WebhookEventType[];

/** What each event means to the client, in words. */
export const WEBHOOK_EVENT_LABEL: Readonly<Record<WebhookEventType, string>> = {
  'receipt.recorded': 'Goods received',
  'order.dispatched': 'Order dispatched',
  // Story 4-9a (A28).
  'order.delivered': 'Order delivered',
};

/** The one-line explanation beside each checkbox. */
export const WEBHOOK_EVENT_HINT: Readonly<Record<WebhookEventType, string>> = {
  'receipt.recorded': 'Each goods receipt (GRN) of this client, with its lines and quantities.',
  'order.dispatched': 'Each dispatched order of this client, with the carrier, the tracking number and what shipped.',
  'order.delivered': 'Each recorded delivery of a truck consignment of this client — delivered, with exceptions or refused; an amendment is sent again with a higher deliverySeq (the highest wins).',
};

export const MAX_WEBHOOK_ENDPOINTS = 5;
export const WEBHOOK_URL_MAX_LENGTH = 2048;
export const WEBHOOK_DESCRIPTION_MAX_LENGTH = 200;

export function webhookEventsLabel(types: readonly WebhookEventType[]): string {
  return types.map((type) => WEBHOOK_EVENT_LABEL[type]).join(' · ');
}

const IST = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `27 Oct 2026, 14:05 IST` — the IST wall clock of an instant. */
export function istInstantLabel(iso: string): string {
  const parts = IST.formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')} IST`;
}

const DISABLED_WORD: Readonly<Record<WebhookDisabledReason, string>> = {
  manual: 'Disabled — by staff',
  failing: 'Disabled — failing',
  gone: 'Disabled — receiver gone (410)',
  'client-departed': 'Disabled — client departed',
};

/** The endpoint's status chip: a word and a tone (never colour alone). */
export function endpointStatusChip(endpoint: Pick<WebhookEndpointDto, 'status' | 'disabledReason' | 'failingSince'>): {
  tone: StatusTone;
  word: string;
  solid: boolean;
} {
  if (endpoint.status === 'active') {
    return endpoint.failingSince === null
      ? { tone: 'success', word: 'Active', solid: false }
      : { tone: 'warning', word: `Active — failing since ${istInstantLabel(endpoint.failingSince)}`, solid: false };
  }
  if (endpoint.status === 'deleted') return { tone: 'neutral', word: 'Deleted', solid: false };
  const reason = endpoint.disabledReason ?? 'manual';
  if (reason === 'failing') {
    const since = endpoint.failingSince === null ? '' : ` since ${istInstantLabel(endpoint.failingSince)}`;
    return { tone: 'danger', word: `${DISABLED_WORD.failing}${since}`, solid: true };
  }
  return { tone: reason === 'gone' ? 'danger' : 'neutral', word: DISABLED_WORD[reason], solid: reason === 'gone' };
}

/** `whsec_…a1B2` — the secret is never shown again after the one-time dialog. */
export function secretHintLabel(hint: string): string {
  return `whsec_…${hint}`;
}

const DELIVERY_STATUS: Readonly<Record<WebhookDeliveryStatus, { tone: StatusTone; word: string }>> = {
  pending: { tone: 'info', word: 'Pending' },
  sending: { tone: 'info', word: 'Sending' },
  held: { tone: 'warning', word: 'Held' },
  succeeded: { tone: 'success', word: 'Delivered' },
  failed: { tone: 'danger', word: 'Failed' },
};

export function deliveryStatusChip(status: WebhookDeliveryStatus): { tone: StatusTone; word: string } {
  return DELIVERY_STATUS[status];
}

/** A delivery's last outcome in words — the HTTP status, or what the transport or the sender said. */
const ERROR_WORD: Readonly<Record<string, string>> = {
  network: 'Could not connect',
  timeout: 'Timed out',
  'dns-failed': 'Host not found',
  'tls-handshake': 'TLS handshake failed',
  'tls-cert': 'Certificate not trusted',
  'target-blocked': 'Blocked — the host resolves to a private address',
  'secret-unavailable': 'Signing secret unavailable (server configuration)',
  stale: 'Interrupted — sent again',
  expired: 'Expired — not delivered within 72 hours',
  'endpoint-disabled': 'Endpoint disabled',
  'endpoint-deleted': 'Endpoint deleted',
  unsubscribed: 'Event type no longer subscribed',
  'client-departed': 'Client departed',
  'held-overflow': 'Dropped — over 10,000 held',
  'held-expired': 'Dropped — held over 30 days',
  discarded: 'Discarded on re-enable',
};

export function deliveryOutcomeLabel(delivery: Pick<WebhookDeliveryDto, 'lastStatusCode' | 'lastErrorCode' | 'status'>): string {
  if (delivery.status === 'succeeded') return delivery.lastStatusCode === null ? 'Delivered' : `HTTP ${delivery.lastStatusCode}`;
  const code = delivery.lastErrorCode;
  if (code === null) return delivery.lastStatusCode === null ? '—' : `HTTP ${delivery.lastStatusCode}`;
  const http = /^http-(\d{3})$/.exec(code);
  if (http !== null) {
    const status = Number(http[1]);
    return status >= 300 && status < 400 ? `HTTP ${status} — redirect not followed` : `HTTP ${status}`;
  }
  return ERROR_WORD[code] ?? code;
}

/** The test send's outcome as a banner. */
export function testOutcome(test: { statusCode: number | null; errorCode: string | null; durationMs: number }): {
  tone: 'accepted' | 'rejected';
  word: string;
  reason: string;
} {
  const took = `${test.durationMs.toLocaleString('en-IN')} ms`;
  if (test.errorCode === null) {
    return { tone: 'accepted', word: `Test delivered — HTTP ${test.statusCode ?? 200}`, reason: `The receiver answered in ${took}.` };
  }
  return {
    tone: 'rejected',
    word: 'Test not delivered',
    reason: `${deliveryOutcomeLabel({ status: 'failed', lastStatusCode: test.statusCode, lastErrorCode: test.errorCode })} (${took}). The failure counters were not touched.`,
  };
}

// ── the add / edit draft ─────────────────────────────────────────────────

export interface EndpointFields {
  url: string;
  description: string;
  eventTypes: WebhookEventType[];
  /** A19 — staff attest the client asked for this URL (create only). */
  attested: boolean;
}

export function emptyEndpointFields(): EndpointFields {
  return { url: '', description: '', eventTypes: [...WEBHOOK_EVENT_TYPES], attested: false };
}

export function endpointFieldsOf(endpoint: WebhookEndpointDto): EndpointFields {
  return { url: endpoint.url, description: endpoint.description ?? '', eventTypes: [...endpoint.eventTypes], attested: true };
}

export function endpointDraftDirty(fields: EndpointFields, initial: EndpointFields): boolean {
  return (
    fields.url.trim() !== initial.url.trim() ||
    fields.description.trim() !== initial.description.trim() ||
    [...fields.eventTypes].sort().join() !== [...initial.eventTypes].sort().join()
  );
}

const PRIVATE_HOST = /^(localhost|.*\.(local|localhost|internal|home\.arpa))$/;
const NUMERIC_HOST = /^(?:0x[0-9a-f]*|[0-9]+)(?:\.(?:0x[0-9a-f]*|[0-9]+))*$/i;

/**
 * The client-side check — the same rules the server enforces (it is the
 * authority and re-checks): an https URL, a public DNS host, no user name or
 * fragment, port 443 or 1024–65535; at least one event; a description of at
 * most 200 characters; and, on a new endpoint, the attestation.
 */
export function parseEndpointDraft(
  fields: EndpointFields,
  mode: 'create' | 'edit',
): { body: { url: string; description: string | null; eventTypes: WebhookEventType[] }; problem: null } | { body: null; problem: string } {
  const raw = fields.url.trim();
  if (raw === '') return { body: null, problem: 'Enter the URL the client gave you.' };
  if (raw.length > WEBHOOK_URL_MAX_LENGTH) return { body: null, problem: `The URL must be at most ${WEBHOOK_URL_MAX_LENGTH} characters.` };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { body: null, problem: 'Enter a full URL such as https://hooks.example.com/wms.' };
  }
  if (url.protocol !== 'https:') return { body: null, problem: 'The URL must start with https:// — webhooks are never sent over plain http.' };
  if (url.username !== '' || url.password !== '') return { body: null, problem: 'Remove the user name and password from the URL — the signature authenticates each delivery.' };
  if (url.hash !== '' || raw.includes('#')) return { body: null, problem: 'Remove the #fragment from the URL.' };
  const host = url.hostname.replace(/\.$/, '').toLowerCase();
  if (host.startsWith('[') || NUMERIC_HOST.test(host)) return { body: null, problem: 'Use the receiver’s DNS name, not an IP address.' };
  if (!host.includes('.') || PRIVATE_HOST.test(host)) return { body: null, problem: `${host} is not a public host name.` };
  const port = url.port === '' ? 443 : Number(url.port);
  if (port !== 443 && (port < 1024 || port > 65535)) return { body: null, problem: 'The port must be 443 or 1024–65535.' };
  if (fields.eventTypes.length === 0) return { body: null, problem: 'Choose at least one event to send.' };
  const description = fields.description.trim();
  if (description.length > WEBHOOK_DESCRIPTION_MAX_LENGTH) {
    return { body: null, problem: `The description must be at most ${WEBHOOK_DESCRIPTION_MAX_LENGTH} characters.` };
  }
  if (mode === 'create' && !fields.attested) return { body: null, problem: 'Confirm the client asked for this URL.' };
  return {
    body: {
      url: raw,
      description: description === '' ? null : description,
      eventTypes: WEBHOOK_EVENT_TYPES.filter((type) => fields.eventTypes.includes(type)),
    },
    problem: null,
  };
}

/** The bulk redeliver's `since`: N hours back, as an instant. */
export function sinceHoursAgo(hours: number, nowMs: number = Date.now()): string {
  return new Date(nowMs - hours * 3_600_000).toISOString();
}

// ── refusals ─────────────────────────────────────────────────────────────

/** A webhook command's refusal in words (branching on `code`, never prose). */
export function webhookReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'webhook-endpoint-limit':
        return `A client holds at most ${MAX_WEBHOOK_ENDPOINTS} webhook endpoints — delete one first.`;
      case 'duplicate-webhook-url':
        return 'This client already has an endpoint for that URL — edit it instead.';
      case 'webhooks-unavailable':
        return 'Webhooks are turned off on this server — ask your administrator to configure them.';
      case 'webhook-endpoint-disabled':
        return 'Enable the endpoint first — a test send works while it is disabled.';
      case 'delivery-in-progress':
        return 'That delivery is still pending or held — only a failed or delivered one can be sent again.';
      case 'delivery-purged':
        return 'That delivery is older than 30 days and was purged.';
      case 'held-decision-required':
        return 'Deliveries were held while the endpoint was failing — choose to send them or discard them.';
      case 'client-departed':
        return 'This client has departed — reactivate it before enabling its webhooks.';
      case 'rate-limited': {
        const after = typeof error.extensions.retryAfterSeconds === 'number' ? error.extensions.retryAfterSeconds : null;
        return `At most 10 test sends and redeliveries a minute per endpoint${after === null ? '' : ` — try again in ${after} s`}.`;
      }
      case 'not-found':
        return 'That endpoint or client no longer exists — refresh the list.';
      case 'role-denied':
        return 'Only an owner can manage webhooks.';
      case 'permission-denied':
        return 'Your session belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed with different details — edit and save again.';
      case 'conflict':
        return 'The same submission is still in flight — retry to read the settled result.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the endpoint and try again.';
      default:
        return error.detail ?? `Not saved (${error.code}).`;
    }
  }
  return 'The server could not be reached — check your connection and try again.';
}

/** The read's failure in words. */
export function webhooksReadReason(error: unknown): string {
  if (error instanceof ApiProblem && error.code === 'role-denied') return 'Only an owner can see webhooks.';
  return webhookReason(error);
}
