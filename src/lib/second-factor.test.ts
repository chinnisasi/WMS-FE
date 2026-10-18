import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { ApiProblem, isSessionRoute } from './api/client';
import type { SignInResponse } from './api/generated';
import { clearSession, readSession, writeSession, type Session } from './auth';
import { loginNotice, operatorShellRoute, SESSION_ENDED_NOTICE } from './portal';
import {
  backupCodesText,
  backupCodesWarning,
  canResetSecondFactor,
  enrolmentStepReason,
  expiresInLabel,
  failedAttemptsNotice,
  groupSecret,
  normaliseBackupInput,
  normaliseTotpInput,
  RELOAD_REASON,
  secondFactorChip,
  secondFactorReason,
  signInStep,
} from './second-factor';

/** Story 6-1b — the words and the narrowing of two-factor sign-in. */

const SESSION_BODY: SignInResponse = {
  accessToken: 'a.b.c',
  tokenType: 'Bearer',
  expiresInSeconds: 900,
  refreshExpiresInSeconds: 43200,
  tenant: { id: 't', name: 'T', gstin: null },
  user: { id: 'u', email: 'u@example.com', role: 'owner', status: 'active', clientId: null, createdAt: '2026-10-18T00:00:00.000Z' },
  client: null,
};

describe('signInStep — narrowing by the presence of `challenge`', () => {
  test('a session body (no `challenge` key) is the session arm', () => {
    expect(signInStep(SESSION_BODY).kind).toBe('session');
  });

  test('the two challenge arms', () => {
    expect(signInStep({ challenge: 'totp', challengeToken: 'x', expiresInSeconds: 300 }).kind).toBe('totp');
    expect(
      signInStep({
        challenge: 'enroll',
        challengeToken: 'x',
        expiresInSeconds: 600,
        secret: 'S',
        otpauthUri: 'otpauth://totp/x',
        enrolmentCodeRequired: false,
      }).kind,
    ).toBe('enroll');
  });

  test('an unknown challenge (a newer backend) is never guessed at: the page must reload', () => {
    expect(signInStep({ challenge: 'webauthn' } as never).kind).toBe('unknown');
    expect(RELOAD_REASON).toBe('Reload this page to sign in.');
  });
});

describe('secondFactorReason — every code the routes answer', () => {
  const problem = (code: string, extensions: Record<string, unknown> = {}, detail?: string) =>
    new ApiProblem(code, 401, detail, undefined, extensions);

  test('second-factor-invalid names the attempts left', () => {
    expect(secondFactorReason(problem('second-factor-invalid', { attemptsLeft: 3 }))).toBe('That code is not right — 3 attempts left.');
    expect(secondFactorReason(problem('second-factor-invalid', { attemptsLeft: 1 }))).toBe('That code is not right — 1 attempt left.');
    expect(secondFactorReason(problem('second-factor-invalid', { attemptsLeft: 0 }))).toBe('That code is not right.');
  });

  test('second-factor-locked: minutes, or until an owner unlocks', () => {
    expect(secondFactorReason(problem('second-factor-locked', { retryAfterSeconds: 840 }))).toBe('Too many wrong codes. Try again in 14 minutes.');
    expect(secondFactorReason(problem('second-factor-locked', { retryAfterSeconds: null }))).toContain('until an owner unlocks it');
  });

  test('the remaining codes', () => {
    expect(secondFactorReason(problem('challenge-ended'))).toBe('This sign-in step has ended — sign in again.');
    expect(secondFactorReason(problem('client-outdated'))).toBe(RELOAD_REASON);
    expect(secondFactorReason(problem('enrolment-code-expired'))).toContain('Ask an owner to reset your two-factor sign-in again.');
    expect(enrolmentStepReason(problem('second-factor-invalid', { attemptsLeft: 2 }))).toBe(
      'The authenticator code or the enrolment code is not right — 2 attempts left.',
    );
    expect(canResetSecondFactor({ secondFactorEnabled: false, secondFactorResetPending: true })).toBe(true);
    expect(canResetSecondFactor({ secondFactorEnabled: true })).toBe(true);
    expect(canResetSecondFactor({})).toBe(false);
    expect(secondFactorReason(problem('password-invalid'))).toBe('That password is not right.');
    expect(secondFactorReason(problem('second-factor-required'))).toBe('Owners must use two-factor sign-in — it cannot be turned off.');
    expect(secondFactorReason(problem('mystery', {}, 'Server words.'))).toBe('Server words.');
    expect(secondFactorReason(new Error('Failed to fetch'))).toBe('The API is unreachable — is wms-be running?');
  });
});

describe('inputs and copy', () => {
  test('a TOTP code: spaces stripped, exactly six digits', () => {
    expect(normaliseTotpInput(' 123 456 ')).toBe('123456');
    expect(normaliseTotpInput('12345')).toBeNull();
    expect(normaliseTotpInput('abcdef')).toBeNull();
  });

  test('a backup code: case-insensitive, hyphens and spaces accepted', () => {
    expect(normaliseBackupInput('abcde fgh23')).toBe('ABCDE-FGH23');
    expect(normaliseBackupInput('ABCDE-FGH23')).toBe('ABCDE-FGH23');
    expect(normaliseBackupInput('ABCDE-FGH2')).toBeNull();
  });

  test('the secret in groups of four; the expiry as m:ss, never negative', () => {
    expect(groupSecret('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')).toBe('ABCD EFGH IJKL MNOP QRST UVWX YZ23 4567');
    expect(expiresInLabel(599_100)).toBe('Expires in 10:00');
    expect(expiresInLabel(61_000)).toBe('Expires in 1:01');
    expect(expiresInLabel(-5)).toBe('Expires in 0:00');
  });

  test('failed attempts since the last sign-in', () => {
    expect(failedAttemptsNotice(undefined)).toBeNull();
    expect(failedAttemptsNotice(0)).toBeNull();
    expect(failedAttemptsNotice(7)).toContain('7 failed two-factor attempts since your last sign-in');
    expect(failedAttemptsNotice(1)).toContain('1 failed two-factor attempt since your last sign-in');
  });

  test('the low backup codes warning shows at 2 or fewer, including 0', () => {
    expect(backupCodesWarning(10)).toBeNull();
    expect(backupCodesWarning(3)).toBeNull();
    expect(backupCodesWarning(2)).toContain('Only 2 backup codes left');
    expect(backupCodesWarning(1)).toContain('Only 1 backup code left');
    expect(backupCodesWarning(0)).toContain('no backup codes left');
  });

  test('the codes text carries every code', () => {
    const text = backupCodesText(['AAAAA-BBBBB', 'CCCCC-DDDDD'], 'owner@example.com');
    expect(text).toContain('owner@example.com');
    expect(text).toContain('AAAAA-BBBBB\nCCCCC-DDDDD');
  });

  test('the Team chip: hidden when the field is undefined', () => {
    expect(secondFactorChip(undefined)).toBeNull();
    expect(secondFactorChip(true)).toBe('2FA On');
    expect(secondFactorChip(false)).toBe('2FA Off');
  });
});

describe('notices and routing', () => {
  test('the two new session ends have their words on /login', () => {
    expect(loginNotice(undefined, 'second-factor-reset')).toBe('An owner reset your two-factor sign-in — sign in and set it up again.');
    expect(loginNotice(undefined, 'second-factor-changed')).toBe('Your two-factor settings changed on another device — sign in again.');
    expect(Object.keys(SESSION_ENDED_NOTICE)).toEqual(expect.arrayContaining(['second-factor-reset', 'second-factor-changed']));
  });

  test('the second sign-in step is a session route (its 401 never signs anyone out or refreshes)', () => {
    expect(isSessionRoute('http://api.test/api/v1/tenants/sign-in/second-factor')).toBe(true);
    expect(isSessionRoute('http://api.test/api/v1/tenants/sign-in')).toBe(true);
    expect(isSessionRoute('http://api.test/api/v1/tenants/t-1/me/second-factor/confirm')).toBe(false);
  });

  test('Security lives under (app), so a portal session is sent to the portal before it renders', () => {
    const root = join(import.meta.dir, '..', 'app');
    expect(existsSync(join(root, '(app)', 'account', 'security', 'page.tsx'))).toBe(true);
    expect(existsSync(join(root, '(portal)', 'account'))).toBe(false);
    const portal = { user: { clientId: 'c-1' } } as unknown as Session;
    expect(operatorShellRoute(portal)).toEqual({ kind: 'redirect', href: '/portal/stock' });
  });
});

describe('writeSession refuses what is not a session (an old bundle reading a challenge)', () => {
  afterEach(() => clearSession());

  test('no string token, or a non-finite expiry → nothing stored', () => {
    const base = {
      token: 'a.b.c',
      tenant: { id: 't', name: 'T', gstin: null },
      user: { id: 'u', email: 'u@example.com', role: 'owner' as const, status: 'active' as const },
      expiresAt: Date.now() + 60_000,
      refreshUntil: Date.now() + 3_600_000,
    };
    expect(writeSession({ ...base, token: undefined as unknown as string })).toBe(false);
    expect(writeSession({ ...base, expiresAt: Number.NaN })).toBe(false);
    expect(writeSession({ ...base, refreshUntil: Number.NaN })).toBe(false);
    expect(readSession()).toBeNull();
    expect(writeSession(base)).toBe(true);
    expect(readSession()?.token).toBe('a.b.c');
  });
});
