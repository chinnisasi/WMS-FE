import { describe, expect, test } from 'bun:test';

import {
  INVITE_EMAIL_POLL_WINDOW_MS,
  INVITE_EMAIL_WORDS,
  inviteEmailInFlight,
  inviteEmailWords,
  inviteLinkNote,
  inviteLinkOf,
  shouldPollInviteEmails,
} from './users';

/**
 * Story 5-1a (decision 8) — the invite email's words, the link the card
 * shows, and the light polling rule.
 */

describe('invite email words', () => {
  test('pending and sending read "Queued to send…"; sent reads "Sent to the mail service" (never "delivered"); skipped reads nothing', () => {
    expect(inviteEmailWords('pending')).toBe('Queued to send…');
    expect(inviteEmailWords('sending')).toBe('Queued to send…');
    expect(inviteEmailWords('sent')).toBe('Sent to the mail service');
    expect(inviteEmailWords('skipped')).toBeNull();
    expect(Object.values(INVITE_EMAIL_WORDS).some((words) => words !== null && /deliver/i.test(words))).toBe(false);
  });

  test('failed, expired and cancelled read "Not sent — resend or copy the link"; no field or null reads nothing', () => {
    for (const status of ['failed', 'expired', 'cancelled'] as const) {
      expect(inviteEmailWords(status)).toBe('Not sent — resend or copy the link');
    }
    expect(inviteEmailWords(null)).toBeNull();
    expect(inviteEmailWords(undefined)).toBeNull();
  });

  test('only pending and sending are in flight', () => {
    expect(Object.keys(INVITE_EMAIL_WORDS).filter((status) => inviteEmailInFlight(status as never))).toEqual(['pending', 'sending']);
  });
});

describe('the invite link', () => {
  test("the backend's inviteUrl is the link — the same string the email carries", () => {
    expect(inviteLinkOf({ inviteToken: 'tok', inviteUrl: 'https://app.wms.in/accept-invite?tenant=t&token=tok' }, 't', 'http://localhost:3001')).toBe(
      'https://app.wms.in/accept-invite?tenant=t&token=tok',
    );
  });

  test('a null or absent inviteUrl (no WEB_BASE_URL, or a pre-5-1a replay) falls back to this origin', () => {
    expect(inviteLinkOf({ inviteToken: 'a+b', inviteUrl: null }, 't-1', 'http://localhost:3001')).toBe(
      'http://localhost:3001/accept-invite?tenant=t-1&token=a%2Bb',
    );
    expect(inviteLinkOf({ inviteToken: 'x' }, 't-1', 'http://localhost:3001')).toBe('http://localhost:3001/accept-invite?tenant=t-1&token=x');
  });

  test('the note says what happened to the email; a skipped (or unknown) one says to share the link', () => {
    expect(inviteLinkNote('a@x.in', 'pending')).toContain('queued to send');
    expect(inviteLinkNote('a@x.in', 'sent')).toContain('sent to the mail service');
    expect(inviteLinkNote('a@x.in', 'failed')).toContain('was not sent');
    expect(inviteLinkNote('a@x.in', 'skipped')).toBe('Share it out-of-band — it works once, then expires.');
    expect(inviteLinkNote('a@x.in', null)).toBe('Share it out-of-band — it works once, then expires.');
  });
});

describe('polling while an invite email is in flight', () => {
  const pending = { status: 'invited', inviteEmail: { status: 'pending' as const } };
  const sent = { status: 'invited', inviteEmail: { status: 'sent' as const } };

  test('polls while an invited row is pending or sending, for at most 60 s', () => {
    expect(shouldPollInviteEmails([sent, pending], null, 1_000)).toBe(true);
    expect(shouldPollInviteEmails([pending], 0, INVITE_EMAIL_POLL_WINDOW_MS - 1)).toBe(true);
    expect(shouldPollInviteEmails([pending], 0, INVITE_EMAIL_POLL_WINDOW_MS)).toBe(false);
  });

  test('never polls when nothing is in flight, or the field is absent (a non-owner), or the row is no longer invited', () => {
    expect(shouldPollInviteEmails([sent], null, 0)).toBe(false);
    expect(shouldPollInviteEmails([{ status: 'invited' }], null, 0)).toBe(false);
    expect(shouldPollInviteEmails([{ status: 'active', inviteEmail: { status: 'pending' } }], null, 0)).toBe(false);
  });
});
