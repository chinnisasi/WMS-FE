import { ApiProblem } from '@/lib/api/client';
import type { ClientContactLastEmailDto, ClientEmailLogItemDto, ClientEmailLogResponse } from '@/lib/api/generated';
import { MAX_CONTACT_EMAIL_LENGTH, contactEmailProblem, type ContactEmailEvent } from '@/lib/clients';
import { istInstantLabel } from '@/lib/client-webhooks';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import type { StatusTone } from '@/lib/status-tone';

/**
 * Story 5-2b — a client's receipt and dispatch emails: the contact form's
 * opt-in words, the contact row's line and badge, and the Emails panel's
 * status words, banners and Reply-To draft. Pure, pinned by
 * `client-emails.test.ts`. Each vocabulary is a `Record` over the GENERATED
 * union, so a status or event the backend adds fails this file's compile
 * until it has words. Times reuse 5-2a's IST formatter (`istInstantLabel`).
 */

export { istInstantLabel };

export type ClientEmailEvent = ContactEmailEvent;
export type ClientEmailStatus = ClientEmailLogItemDto['status'];
export type ClientEmailKind = ClientEmailLogItemDto['kind'];

/** The events in the backend's vocabulary order — a body sends them in this order. */
export const CLIENT_EMAIL_EVENTS = ['receipt.recorded', 'order.dispatched', 'shipment.documents', 'consignment.documents-needed'] as const satisfies readonly ClientEmailEvent[];

/** The most emails of one kind a client is sent per IST day (A5) — the D2C guard until the daily digest. */
export const CLIENT_EMAIL_DAILY_CAP = 500;

/** The contact form's checkbox labels. */
export const CLIENT_EMAIL_EVENT_LABEL: Readonly<Record<ClientEmailEvent, string>> = {
  'receipt.recorded': 'Goods received (each GRN)',
  'order.dispatched': 'Dispatched (each order)',
  // Story 4-4a (A4) — the third box.
  'shipment.documents': 'Shipping documents (signed handover sheet, invoice, e-way bill, POD)',
  // Story 4-6a (A20) — the fourth box.
  'consignment.documents-needed': 'Documents needed (a packed order is waiting for your invoice or e-way bill)',
};

/** The hint beside each checkbox. The dispatch one promises no digest (B14). */
export const CLIENT_EMAIL_EVENT_HINT: Readonly<Record<ClientEmailEvent, string>> = {
  'receipt.recorded': 'One email per goods receipt, with its lines and quantities.',
  'order.dispatched': `Each order is one email per contact. A daily limit of ${CLIENT_EMAIL_DAILY_CAP} applies.`,
  'shipment.documents': `Each document the warehouse attaches is one email with the file, and each signed-sheet page its own. A daily limit of ${CLIENT_EMAIL_DAILY_CAP} applies.`,
  'consignment.documents-needed': `One email when an order is packed and still needs the brand's invoice or e-way bill before it can leave. A daily limit of ${CLIENT_EMAIL_DAILY_CAP} applies.`,
};

/** The fieldset's lead line. */
export const CLIENT_EMAILS_FIELDSET_HINT = 'Operations contacts usually want these.';

/** Why the fieldset is disabled on the warehouse's own (`self`) client — the server refuses an opt-in there. */
export const SELF_CLIENT_EMAILS_NOTE = 'Your own company gets no client emails — they go to a client brand’s contacts.';

const EVENT_SHORT: Readonly<Record<ClientEmailEvent, string>> = {
  'receipt.recorded': 'receipts',
  'order.dispatched': 'dispatches',
  'shipment.documents': 'shipping documents',
  'consignment.documents-needed': 'documents needed',
};

/** The contact row's line, `Emails: receipts, dispatches` — null when it opted into none. */
export function contactEmailsLabel(events: readonly ClientEmailEvent[]): string | null {
  const chosen = CLIENT_EMAIL_EVENTS.filter((event) => events.includes(event));
  return chosen.length === 0 ? null : `Emails: ${chosen.map((event) => EVENT_SHORT[event]).join(', ')}`;
}

/**
 * The contact body's `emailEvents`, in vocabulary order. On the `self`
 * client the key is left out entirely (an add then stores none, an edit
 * leaves it unchanged) — the server refuses any opt-in there.
 */
export function contactEmailEventsBody(
  events: readonly ClientEmailEvent[],
  systemOwned: boolean,
): { emailEvents: ClientEmailEvent[] } | Record<string, never> {
  if (systemOwned) return {};
  return { emailEvents: CLIENT_EMAIL_EVENTS.filter((event) => events.includes(event)) };
}

// ── the status words ─────────────────────────────────────────────────────

/** Why an email was not sent, skipped or cancelled — the local codes, then the provider's. */
const REASON_WORD: Readonly<Record<string, string>> = {
  suppressed: 'address refused (it bounced or complained before)',
  expired: 'expired before it could be sent',
  allowlist: 'address outside this server’s allowlist',
  'provider-off': 'mail is off on this server',
  stale: 'interrupted mid-send — never sent twice',
  render: 'the email could not be built',
  unsealable: 'the email could not be built',
  unsubscribed: 'unsubscribed',
  MessageRejected: 'refused by the mail service',
  BadRequestException: 'refused by the mail service',
  'address-not-verified': 'address not verified with the mail service',
  network: 'the mail service could not be reached',
};

/** A code in words; an unknown code reads as itself (`not sent — Foo`), never as nothing. */
export function clientEmailReasonWord(code: string | null): string {
  if (code === null) return 'no reason given';
  return Object.hasOwn(REASON_WORD, code) ? REASON_WORD[code]! : code;
}

/** `pending` / `sending`: the row will still change, so the log is worth re-reading. */
export function clientEmailQueued(status: ClientEmailStatus): boolean {
  return status === 'pending' || status === 'sending';
}

/**
 * The log row's status in words. "Sent" means the mail service accepted it —
 * never "delivered" (no bounce intake yet).
 */
export function clientEmailStatusWord(email: Pick<ClientEmailLogItemDto, 'status' | 'errorCode'>): string {
  switch (email.status) {
    case 'pending':
    case 'sending':
      return 'Queued…';
    case 'sent':
      return 'Sent to the mail service';
    case 'failed':
    case 'expired':
    case 'skipped':
      return `Not sent — ${clientEmailReasonWord(email.status === 'expired' ? (email.errorCode ?? 'expired') : email.errorCode)}`;
    case 'cancelled':
      return `Cancelled — ${clientEmailReasonWord(email.errorCode ?? 'unsubscribed')}`;
  }
}

/**
 * A log problem (the server's `problems=true`): not sent (failed, expired), or
 * skipped by the allowlist — a skip because mail is off is the server's
 * state, said once by the banner, not a problem per row.
 */
export function isClientEmailProblem(email: Pick<ClientEmailLogItemDto, 'status' | 'errorCode'>): boolean {
  return email.status === 'failed' || email.status === 'expired' || (email.status === 'skipped' && email.errorCode === 'allowlist');
}

/** The status chip's tone — a word always beside it (never colour alone). */
export function clientEmailStatusTone(email: Pick<ClientEmailLogItemDto, 'status' | 'errorCode'>): StatusTone {
  if (clientEmailQueued(email.status)) return 'info';
  if (email.status === 'sent') return 'success';
  if (email.status === 'failed' || email.status === 'expired') return 'danger';
  if (isClientEmailProblem(email)) return 'warning';
  return 'neutral';
}

const KIND_WORD: Readonly<Record<ClientEmailKind, string>> = {
  receipt: 'Goods received',
  dispatch: 'Dispatched',
  'shipment-document': 'Shipping document',
};

/** The log row's kind, `Goods received` / `Dispatched`. */
export function clientEmailKindWord(kind: ClientEmailKind): string {
  return KIND_WORD[kind];
}

// ── the contact badge ─────────────────────────────────────────────────────

/**
 * The contact row's warning badge from its `lastEmail`, or null: a
 * suppressed address first (sending again will not help), then any other
 * log problem.
 */
export function contactEmailBadge(lastEmail: Pick<ClientContactLastEmailDto, 'status' | 'errorCode'> | null): string | null {
  if (lastEmail === null) return null;
  if (lastEmail.errorCode === 'suppressed') return 'Address refused — it bounced or complained before';
  if (isClientEmailProblem(lastEmail)) return 'Last email not sent';
  return null;
}

// ── the panel's banners and help ──────────────────────────────────────────

export const CLIENT_EMAILS_HELP = 'Sent means the mail service accepted it; a bounce on a first send is not shown yet.';

export interface EmailBanner {
  readonly word: string;
  readonly reason: string;
}

/** The server-state banners, in order: mail off, client emails off, then each kind over today's limit. */
export function clientEmailBanners(log: Pick<ClientEmailLogResponse, 'mailEnabled' | 'clientMailEnabled' | 'capReachedToday'>): EmailBanner[] {
  const banners: EmailBanner[] = [];
  if (!log.mailEnabled) {
    banners.push({
      word: 'Mail is off on this server',
      reason: 'No email is sent until an administrator configures a mail provider — new emails are recorded as not sent.',
    });
  }
  if (!log.clientMailEnabled) {
    banners.push({
      word: 'Client emails are off on this server',
      reason: 'Receipts, dispatches and shipping documents are not emailed to client contacts until an administrator switches them on. Opt-ins can still be edited.',
    });
  }
  // Story 4-4a (D5) — the third kind; its cap flag is `shipmentDocument`.
  const capped: [ClientEmailKind, keyof ClientEmailLogResponse['capReachedToday'], string, string][] = [
    ['receipt', 'receipt', 'receipts', 'receipt'],
    ['dispatch', 'dispatch', 'dispatches', 'dispatch'],
    ['shipment-document', 'shipmentDocument', 'shipping documents', 'shipping document'],
  ];
  for (const [, flag, plural, noun] of capped) {
    if (log.capReachedToday[flag]) {
      banners.push({
        word: `Daily limit of ${CLIENT_EMAIL_DAILY_CAP} reached — later ${plural} today were not emailed`,
        reason: `The limit counts this client’s ${noun} emails since midnight IST, and resets at the next midnight.`,
      });
    }
  }
  return banners;
}

// ── polling ───────────────────────────────────────────────────────────────

/** The log re-reads every 5 s while a row is queued — for at most 60 s from the first queued read (5-1a decision 8). */
export const CLIENT_EMAIL_POLL_MS = 5_000;
export const CLIENT_EMAIL_POLL_WINDOW_MS = 60_000;

/** Whether to schedule another read: some row queued, and the window not yet spent. */
export function shouldPollClientEmails(
  items: readonly Pick<ClientEmailLogItemDto, 'status'>[],
  pollingSince: number | null,
  now: number,
): boolean {
  if (!items.some((item) => clientEmailQueued(item.status))) return false;
  return pollingSince === null || now - pollingSince < CLIENT_EMAIL_POLL_WINDOW_MS;
}

// ── Reply-To ──────────────────────────────────────────────────────────────

export const REPLY_TO_MAX_LENGTH = MAX_CONTACT_EMAIL_LENGTH;

/** The Reply-To as read: the client's, or the server's default. */
export function replyToLabel(replyTo: string | null): string {
  return replyTo ?? 'Not set — the server’s default Reply-To applies, if one is configured';
}

/** The draft → the body's `replyTo` (trimmed, lower-cased; blank clears it), or a problem. */
export function parseReplyToDraft(value: string): { replyTo: string | null; problem: null } | { replyTo?: undefined; problem: string } {
  const trimmed = value.trim();
  if (trimmed === '') return { replyTo: null, problem: null };
  const problem = contactEmailProblem(trimmed);
  if (problem !== null) return { problem };
  return { replyTo: trimmed.toLowerCase(), problem: null };
}

/** The success banner of a Reply-To save. */
export function replyToSaved(clientCode: string, replyTo: string | null): EmailBanner {
  return replyTo === null
    ? { word: 'Reply-To cleared', reason: `Replies to ${clientCode}’s emails go to the server’s default Reply-To, if one is configured.` }
    : { word: 'Reply-To saved', reason: `Replies to ${clientCode}’s receipt and dispatch emails go to ${replyTo}.` };
}

/** The Reply-To save's refusal in words (branching on `code`). */
export function replyToReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'validation-failed':
        return 'Enter one email address like accounts@3pl.in, or leave it blank for the server’s default.';
      case 'not-found':
        return 'That client no longer exists — refresh the page.';
      case 'role-denied':
        return 'Only an owner can change the Reply-To.';
      case 'permission-denied':
        return 'Your session belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed with different details — edit and save again.';
      case 'conflict':
        return 'The same submission is still in flight — retry to read the settled result.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `Reply-To not saved (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** The log read's failure in words. */
export function clientEmailsReadReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        return 'That client no longer exists — refresh the page.';
      case 'role-denied':
        return 'Client portal sessions cannot read the email log.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `Emails not loaded (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}
