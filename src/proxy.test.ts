import { describe, expect, test } from 'bun:test';

import { gate } from './proxy';

describe('proxy auth gate', () => {
  test('no hint + an app surface redirects to /login', () => {
    expect(gate('/', false)).toEqual({ kind: 'redirect', pathname: '/login' });
    expect(gate('/settings', false)).toEqual({ kind: 'redirect', pathname: '/login' });
    expect(gate('/inventory/deep/route', false)).toEqual({
      kind: 'redirect',
      pathname: '/login',
    });
  });

  test('no hint + auth pages pass through (the signed-out destination)', () => {
    expect(gate('/login', false)).toEqual({ kind: 'next' });
    expect(gate('/register', false)).toEqual({ kind: 'next' });
  });

  test('hint + auth pages bounce to the app root (no loitering on /login signed in)', () => {
    expect(gate('/login', true)).toEqual({ kind: 'redirect', pathname: '/' });
    expect(gate('/register', true)).toEqual({ kind: 'redirect', pathname: '/' });
    expect(gate('/register/step', true)).toEqual({ kind: 'redirect', pathname: '/' });
  });

  test('hint + app surfaces pass through', () => {
    expect(gate('/', true)).toEqual({ kind: 'next' });
    expect(gate('/settings', true)).toEqual({ kind: 'next' });
  });

  test('prefix matching is path-segment exact — /login-ish is not an auth page', () => {
    expect(gate('/login-ish', false)).toEqual({ kind: 'redirect', pathname: '/login' });
  });

  // Story 6-1c — the verified defect: an emailed invite link redirected a
  // new invitee (no hint cookie) to /login. The public pages never redirect.
  test('the public link pages render with or without a hint (an invite or a reset link opens for anyone)', () => {
    for (const hasHint of [false, true]) {
      expect(gate('/accept-invite', hasHint)).toEqual({ kind: 'next' });
      expect(gate('/reset-password', hasHint)).toEqual({ kind: 'next' });
    }
    expect(gate('/accept-invite-ish', false)).toEqual({ kind: 'redirect', pathname: '/login' });
  });

  test('/forgot-password is an auth page: open signed out, bounced to the app signed in', () => {
    expect(gate('/forgot-password', false)).toEqual({ kind: 'next' });
    expect(gate('/forgot-password', true)).toEqual({ kind: 'redirect', pathname: '/' });
  });

  test('A14 — after a reset the browser has no hint, so /login?reset=done renders', () => {
    expect(gate('/login', false)).toEqual({ kind: 'next' });
  });
});
