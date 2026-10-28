import { describe, expect, test } from 'bun:test';

import { ApiProblem, isSessionRoute } from './api/client';
import {
  forgotPasswordHref,
  forgotRefusal,
  minutesText,
  newPasswordProblem,
  PASSWORD_TOO_SHORT,
  PASSWORDS_DIFFER,
  rateLimitedReason,
  RESET_REQUESTED_COPY,
  resetDoneHref,
  resetRefusal,
  resetTokenFromHash,
} from './password-reset';
import { secondFactorReason } from './second-factor';

const problem = (code: string, extensions: Record<string, unknown> = {}, detail?: string) => new ApiProblem(code, 400, detail, undefined, extensions);

describe('password reset words and rules (story 6-1c)', () => {
  test('the token comes from the fragment only', () => {
    expect(resetTokenFromHash('#token=0193a1b2-0000-7000-8000-000000000001.s3cr3t_-x')).toBe('0193a1b2-0000-7000-8000-000000000001.s3cr3t_-x');
    expect(resetTokenFromHash('token=abc.def')).toBe('abc.def');
    expect(resetTokenFromHash('')).toBeNull();
    expect(resetTokenFromHash('#token=')).toBeNull();
    expect(resetTokenFromHash('#other=1')).toBeNull();
  });

  test('the new password: 8 characters, and both fields agree', () => {
    expect(newPasswordProblem('short', 'short')).toBe(PASSWORD_TOO_SHORT);
    expect(newPasswordProblem('long-enough', 'long-enougH')).toBe(PASSWORDS_DIFFER);
    expect(newPasswordProblem('long-enough', 'long-enough')).toBeNull();
  });

  test('links carry the typed email and the done flag', () => {
    expect(forgotPasswordHref('  priya@example.com ')).toBe('/forgot-password?email=priya%40example.com');
    expect(forgotPasswordHref('')).toBe('/forgot-password');
    expect(resetDoneHref('a+b@x.in')).toBe('/login?email=a%2Bb%40x.in&reset=done');
  });

  test('A12 — a 429 says its wait in minutes; "a minute" when the server gave none', () => {
    expect(minutesText(30)).toBe('1 minute');
    expect(minutesText(1801)).toBe('31 minutes');
    expect(rateLimitedReason(problem('rate-limited', { retryAfterSeconds: 1800 }), 'sign-in attempts', true)).toBe(
      'Too many sign-in attempts from this network or for this account. Try again in 30 minutes.',
    );
    // C31 — the reset buckets are per address only.
    expect(rateLimitedReason(problem('rate-limited'), 'reset requests')).toBe('Too many reset requests from this network. Try again in a minute.');
    expect(secondFactorReason(problem('rate-limited', { retryAfterSeconds: 600 }))).toBe('Too many attempts. Try again in 10 minutes.');
  });

  test('every confirm refusal has its state or its words', () => {
    expect(resetRefusal(problem('reset-link-invalid'))).toEqual({ kind: 'invalid' });
    expect(resetRefusal(problem('second-factor-needed')).kind).toBe('code-needed');
    expect(resetRefusal(problem('second-factor-invalid', { attemptsLeft: 2 }))).toEqual({ kind: 'reason', reason: 'That code is not right — 2 attempts left.' });
    // C16 — the 5th wrong code spent the link.
    expect(resetRefusal(problem('second-factor-invalid', { attemptsLeft: 0 }))).toEqual({ kind: 'invalid' });
    expect(resetRefusal(problem('second-factor-locked', { retryAfterSeconds: 900 }))).toEqual({ kind: 'reason', reason: 'Too many wrong codes. Try again in 15 minutes.' });
    expect(resetRefusal(problem('second-factor-locked', { retryAfterSeconds: null }))).toEqual({
      kind: 'reason',
      reason: 'Too many wrong codes — two-factor sign-in is locked. Ask an owner to unlock it.',
    });
    expect(resetRefusal(problem('second-factor-unavailable'))).toEqual({ kind: 'reason', reason: 'Two-factor sign-in is unavailable — try again later.' });
    expect(resetRefusal(new Error('Failed to fetch'))).toEqual({ kind: 'reason', reason: 'The API is unreachable — is wms-be running?' });
  });

  test('the request page: one answer for every email; only a limit or a bad address refuses', () => {
    expect(RESET_REQUESTED_COPY).toBe("If an account exists for that email, we've sent a link. It expires in 60 minutes.");
    expect(forgotRefusal(problem('rate-limited', { retryAfterSeconds: 3000 }))).toBe('Too many reset requests from this network. Try again in 50 minutes.');
    expect(forgotRefusal(problem('validation-failed', {}, 'email must be an email'))).toBe('Enter the email address you sign in with.');
  });

  test('A13 — the three reset routes are session routes (no bearer, no refresh, no sign-out on their 401)', () => {
    for (const path of ['password-reset', 'password-reset/check', 'password-reset/confirm']) {
      expect(isSessionRoute(`http://api.test/api/v1/tenants/${path}`)).toBe(true);
    }
    expect(isSessionRoute('http://api.test/api/v1/tenants/password-reset/other')).toBe(false);
  });
});
