import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import {
  CLIENT_EMAIL_EVENT_HINT,
  CLIENT_EMAIL_EVENTS,
  CLIENT_EMAIL_EVENT_LABEL,
  CLIENT_EMAIL_POLL_WINDOW_MS,
  clientEmailBanners,
  clientEmailReasonWord,
  clientEmailStatusTone,
  clientEmailStatusWord,
  clientEmailsReadReason,
  contactEmailBadge,
  contactEmailEventsBody,
  clientEmailKindWord,
  contactEmailsLabel,
  isClientEmailProblem,
  istInstantLabel,
  parseReplyToDraft,
  replyToReason,
  replyToSaved,
  shouldPollClientEmails,
} from './client-emails';
import { UNREACHABLE_REASON } from './outbound-orders';

function problem(code: string, status = 400, detail?: string): ApiProblem {
  return new ApiProblem(code, status, detail);
}

describe('client emails — the contact form and row (story 5-2b)', () => {
  test('the checkbox labels, and the dispatch hint promises no digest (B14)', () => {
    expect(CLIENT_EMAIL_EVENT_LABEL['receipt.recorded']).toBe('Goods received (each GRN)');
    expect(CLIENT_EMAIL_EVENT_LABEL['order.dispatched']).toBe('Dispatched (each order)');
    expect(CLIENT_EMAIL_EVENT_HINT['order.dispatched']).toBe('Each order is one email per contact. A daily limit of 500 applies.');
    expect(CLIENT_EMAIL_EVENT_HINT['order.dispatched']).not.toContain('digest');
  });

  test('the row line names whichever apply, in vocabulary order; none is no line', () => {
    expect(contactEmailsLabel(['order.dispatched', 'receipt.recorded'])).toBe('Emails: receipts, dispatches');
    expect(contactEmailsLabel(['order.dispatched'])).toBe('Emails: dispatches');
    expect(contactEmailsLabel([])).toBeNull();
  });

  test('the body sends emailEvents in vocabulary order — and leaves the key out on the self client', () => {
    expect(contactEmailEventsBody(['order.dispatched', 'receipt.recorded'], false)).toEqual({ emailEvents: ['receipt.recorded', 'order.dispatched'] });
    expect(contactEmailEventsBody([], false)).toEqual({ emailEvents: [] });
    expect(contactEmailEventsBody(['receipt.recorded'], true)).toEqual({});
  });

  test('the badge: suppressed first, then not sent; a sent, queued, cancelled or mail-off skip is no badge', () => {
    expect(contactEmailBadge({ status: 'failed', errorCode: 'suppressed' })).toBe('Address refused — it bounced or complained before');
    expect(contactEmailBadge({ status: 'skipped', errorCode: 'suppressed' })).toBe('Address refused — it bounced or complained before');
    expect(contactEmailBadge({ status: 'failed', errorCode: 'MessageRejected' })).toBe('Last email not sent');
    expect(contactEmailBadge({ status: 'expired', errorCode: 'expired' })).toBe('Last email not sent');
    expect(contactEmailBadge({ status: 'skipped', errorCode: 'allowlist' })).toBe('Last email not sent');
    expect(contactEmailBadge({ status: 'skipped', errorCode: 'provider-off' })).toBeNull();
    expect(contactEmailBadge({ status: 'sent', errorCode: null })).toBeNull();
    expect(contactEmailBadge({ status: 'pending', errorCode: null })).toBeNull();
    expect(contactEmailBadge({ status: 'cancelled', errorCode: 'unsubscribed' })).toBeNull();
    expect(contactEmailBadge(null)).toBeNull();
  });
});

describe('client emails — the log (story 5-2b)', () => {
  test('status words', () => {
    expect(clientEmailStatusWord({ status: 'pending', errorCode: null })).toBe('Queued…');
    expect(clientEmailStatusWord({ status: 'sending', errorCode: null })).toBe('Queued…');
    expect(clientEmailStatusWord({ status: 'sent', errorCode: null })).toBe('Sent to the mail service');
    expect(clientEmailStatusWord({ status: 'failed', errorCode: 'suppressed' })).toBe('Not sent — address refused (it bounced or complained before)');
    expect(clientEmailStatusWord({ status: 'expired', errorCode: null })).toBe('Not sent — expired before it could be sent');
    expect(clientEmailStatusWord({ status: 'skipped', errorCode: 'allowlist' })).toBe('Not sent — address outside this server’s allowlist');
    expect(clientEmailStatusWord({ status: 'skipped', errorCode: 'provider-off' })).toBe('Not sent — mail is off on this server');
    expect(clientEmailStatusWord({ status: 'failed', errorCode: 'stale' })).toBe('Not sent — interrupted mid-send — never sent twice');
    expect(clientEmailStatusWord({ status: 'failed', errorCode: 'render' })).toBe('Not sent — the email could not be built');
    expect(clientEmailStatusWord({ status: 'cancelled', errorCode: 'unsubscribed' })).toBe('Cancelled — unsubscribed');
    expect(clientEmailStatusWord({ status: 'cancelled', errorCode: null })).toBe('Cancelled — unsubscribed');
  });

  test('an unknown provider code reads as itself; a null as "no reason given"', () => {
    expect(clientEmailReasonWord('SomeNewSesException')).toBe('SomeNewSesException');
    expect(clientEmailReasonWord('toString')).toBe('toString');
    expect(clientEmailReasonWord(null)).toBe('no reason given');
    expect(clientEmailStatusWord({ status: 'failed', errorCode: 'http-500' })).toBe('Not sent — http-500');
  });

  test('the problem predicate is the server’s problems=true', () => {
    expect(isClientEmailProblem({ status: 'failed', errorCode: 'x' })).toBe(true);
    expect(isClientEmailProblem({ status: 'expired', errorCode: 'expired' })).toBe(true);
    expect(isClientEmailProblem({ status: 'skipped', errorCode: 'allowlist' })).toBe(true);
    expect(isClientEmailProblem({ status: 'skipped', errorCode: 'provider-off' })).toBe(false);
    expect(isClientEmailProblem({ status: 'cancelled', errorCode: 'unsubscribed' })).toBe(false);
    expect(isClientEmailProblem({ status: 'sent', errorCode: null })).toBe(false);
    expect(isClientEmailProblem({ status: 'pending', errorCode: null })).toBe(false);
  });

  test('tones: queued info, sent success, not sent danger, allowlist warning, the rest neutral', () => {
    expect(clientEmailStatusTone({ status: 'sending', errorCode: null })).toBe('info');
    expect(clientEmailStatusTone({ status: 'sent', errorCode: null })).toBe('success');
    expect(clientEmailStatusTone({ status: 'failed', errorCode: 'x' })).toBe('danger');
    expect(clientEmailStatusTone({ status: 'expired', errorCode: 'expired' })).toBe('danger');
    expect(clientEmailStatusTone({ status: 'skipped', errorCode: 'allowlist' })).toBe('warning');
    expect(clientEmailStatusTone({ status: 'skipped', errorCode: 'provider-off' })).toBe('neutral');
    expect(clientEmailStatusTone({ status: 'cancelled', errorCode: 'unsubscribed' })).toBe('neutral');
  });

  test('IST times reuse the webhook formatter', () => {
    expect(istInstantLabel('2026-10-27T08:35:00.000Z')).toBe('27 Oct 2026, 14:05 IST');
  });

  test('banners: mail off, client emails off, then each capped kind', () => {
    const on = { mailEnabled: true, clientMailEnabled: true, capReachedToday: { receipt: false, dispatch: false, shipmentDocument: false } };
    expect(clientEmailBanners(on)).toEqual([]);
    const words = clientEmailBanners({ mailEnabled: false, clientMailEnabled: false, capReachedToday: { receipt: true, dispatch: true, shipmentDocument: false } }).map((b) => b.word);
    expect(words).toEqual([
      'Mail is off on this server',
      'Client emails are off on this server',
      'Daily limit of 500 reached — later receipts today were not emailed',
      'Daily limit of 500 reached — later dispatches today were not emailed',
    ]);
    expect(clientEmailBanners({ ...on, capReachedToday: { receipt: false, dispatch: true, shipmentDocument: false } }).map((b) => b.word)).toEqual([
      'Daily limit of 500 reached — later dispatches today were not emailed',
    ]);
    // Story 4-4a (D5) — the third kind's own cap.
    const docs = clientEmailBanners({ ...on, capReachedToday: { receipt: false, dispatch: false, shipmentDocument: true } });
    expect(docs.map((b) => b.word)).toEqual(['Daily limit of 500 reached — later shipping documents today were not emailed']);
    expect(docs[0]!.reason).toContain('shipping document emails');
  });

  test('story 4-4a — the shipping documents event and kind have words', () => {
    expect(contactEmailsLabel(['shipment.documents', 'receipt.recorded'])).toBe('Emails: receipts, shipping documents');
    expect(clientEmailKindWord('shipment-document')).toBe('Shipping document');
  });

  test('story 4-6a (A20) — the fourth box: documents needed, after shipping documents', () => {
    expect(CLIENT_EMAIL_EVENTS.at(-2)).toBe('consignment.documents-needed');
    expect(CLIENT_EMAIL_EVENT_LABEL['consignment.documents-needed']).toBe('Documents needed (a packed order is waiting for your invoice or e-way bill)');
    expect(contactEmailsLabel(['consignment.documents-needed', 'order.dispatched'])).toBe('Emails: dispatches, documents needed');
    expect(contactEmailEventsBody(['consignment.documents-needed', 'receipt.recorded'], false)).toEqual({ emailEvents: ['receipt.recorded', 'consignment.documents-needed'] });
  });

  test('story 4-9a (A27) — the fifth box: deliveries, last in vocabulary order', () => {
    expect(CLIENT_EMAIL_EVENTS.at(-1)).toBe('delivery.recorded');
    expect(CLIENT_EMAIL_EVENT_LABEL['delivery.recorded']).toBe('Deliveries (a truck consignment delivered, delivered with exceptions or refused)');
    expect(contactEmailsLabel(['delivery.recorded', 'order.dispatched'])).toBe('Emails: dispatches, deliveries');
  });

  test('polling: only while a row is queued, for at most 60 s from the first queued read', () => {
    const queued = [{ status: 'sent' as const }, { status: 'pending' as const }];
    expect(shouldPollClientEmails(queued, null, 1_000)).toBe(true);
    expect(shouldPollClientEmails(queued, 1_000, 1_000 + CLIENT_EMAIL_POLL_WINDOW_MS - 1)).toBe(true);
    expect(shouldPollClientEmails(queued, 1_000, 1_000 + CLIENT_EMAIL_POLL_WINDOW_MS)).toBe(false);
    expect(shouldPollClientEmails([{ status: 'sent' }, { status: 'failed' }], null, 1_000)).toBe(false);
    expect(shouldPollClientEmails([], null, 1_000)).toBe(false);
  });

  test('the read failure in words', () => {
    expect(clientEmailsReadReason(problem('not-found', 404))).toBe('That client no longer exists — refresh the page.');
    expect(clientEmailsReadReason(new TypeError('fetch failed'))).toBe(UNREACHABLE_REASON);
  });
});

describe('client emails — Reply-To (story 5-2b)', () => {
  test('the draft: trimmed and lower-cased; blank clears; a malformed one is a problem', () => {
    expect(parseReplyToDraft(' Ops@3PL.in ')).toEqual({ replyTo: 'ops@3pl.in', problem: null });
    expect(parseReplyToDraft('   ')).toEqual({ replyTo: null, problem: null });
    expect(parseReplyToDraft('ops@3pl').problem).toBe('Enter an email address like name@company.com.');
  });

  test('the save banner and the refusals', () => {
    expect(replyToSaved('ACME', 'ops@3pl.in').word).toBe('Reply-To saved');
    expect(replyToSaved('ACME', null).word).toBe('Reply-To cleared');
    expect(replyToReason(problem('validation-failed', 400, 'replyTo must be …'))).toBe(
      'Enter one email address like accounts@3pl.in, or leave it blank for the server’s default.',
    );
    expect(replyToReason(problem('role-denied', 403))).toBe('Only an owner can change the Reply-To.');
    expect(replyToReason(problem('something-new', 409, 'Detail.'))).toBe('Detail.');
    expect(replyToReason(new TypeError('fetch failed'))).toBe(UNREACHABLE_REASON);
  });
});
