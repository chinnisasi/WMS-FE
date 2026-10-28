/**
 * Story 6-1b — two-factor sign-in: the narrowing of the sign-in answer, the
 * words for every refusal, and input normalisation. Pure, so every sentence
 * here is pinned by `second-factor.test.ts` (a sentence left in JSX is a
 * sentence nothing can pin).
 */
import { ApiProblem } from '@/lib/api/client';
import type {
  EnrollChallengeResponse,
  SecondFactorSignInResponse,
  SignInResponse,
  TotpChallengeResponse,
} from '@/lib/api/generated';

/** What the password step answered. */
export type SignInStep =
  | { readonly kind: 'session'; readonly body: SignInResponse | SecondFactorSignInResponse }
  | { readonly kind: 'totp'; readonly challenge: TotpChallengeResponse }
  | { readonly kind: 'enroll'; readonly challenge: EnrollChallengeResponse }
  /** A challenge this build does not know (a newer backend): the page must reload. */
  | { readonly kind: 'unknown' };

/**
 * Narrows the sign-in answer by the PRESENCE of `challenge` (the backend's
 * `oneOf` has no discriminator on the session arm). An unknown `challenge`
 * value is never guessed at.
 */
export function signInStep(body: SignInResponse | TotpChallengeResponse | EnrollChallengeResponse): SignInStep {
  if (!Object.hasOwn(body, 'challenge')) return { kind: 'session', body: body as SignInResponse };
  const challenge = (body as { challenge: unknown }).challenge;
  if (challenge === 'totp') return { kind: 'totp', challenge: body as TotpChallengeResponse };
  if (challenge === 'enroll') return { kind: 'enroll', challenge: body as EnrollChallengeResponse };
  return { kind: 'unknown' };
}

export const RELOAD_REASON = 'Reload this page to sign in.';

const UNREACHABLE = 'The API is unreachable — is wms-be running?';

function minutesText(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/** "N attempts left", from a `second-factor-invalid` refusal (null when the server gave none). */
export function attemptsLeftOf(error: unknown): number | null {
  if (!(error instanceof ApiProblem)) return null;
  const left = error.extensions?.attemptsLeft;
  return typeof left === 'number' && Number.isFinite(left) ? left : null;
}

/**
 * The words for a refusal on any two-factor route (the sign-in step and My
 * account → Security). Branches on the problem `code`, never on prose.
 */
export function secondFactorReason(error: unknown): string {
  if (!(error instanceof ApiProblem)) return UNREACHABLE;
  switch (error.code) {
    case 'second-factor-invalid': {
      const left = attemptsLeftOf(error);
      if (left === null || left <= 0) return 'That code is not right.';
      return `That code is not right — ${left === 1 ? '1 attempt' : `${left} attempts`} left.`;
    }
    case 'second-factor-locked': {
      const retry = error.extensions?.retryAfterSeconds;
      return typeof retry === 'number' && Number.isFinite(retry)
        ? `Too many wrong codes. Try again in ${minutesText(retry)}.`
        : 'Too many wrong codes — two-factor sign-in is locked until an owner unlocks it.';
    }
    case 'challenge-ended':
      return 'This sign-in step has ended — sign in again.';
    case 'enrolment-code-expired':
      return 'Your enrolment code has expired. Ask an owner to reset your two-factor sign-in again.';
    case 'second-factor-unavailable':
      return 'Two-factor sign-in cannot be checked right now — tell an owner.';
    case 'client-outdated':
      return RELOAD_REASON;
    case 'password-invalid':
      return 'That password is not right.';
    case 'second-factor-required':
      return 'Owners must use two-factor sign-in — it cannot be turned off.';
    case 'second-factor-not-enabled':
      return 'Two-factor sign-in is not set up for this account.';
    case 'second-factor-setup-expired':
      return 'This setup has expired or was replaced — start again.';
    case 'second-factor-changed':
      return 'Your two-factor settings changed while this was in progress — start again.';
    case 'self-reset':
      return 'Use My account → Security to change your own authenticator — another owner resets yours.';
    case 'sign-in-locked':
      return 'Too many wrong passwords. Try again later, or ask an owner to unlock your account.';
    case 'rate-limited': {
      // Story 6-1c (A12) — the server's wait, in minutes (an hour bucket's is long).
      const retry = error.extensions?.retryAfterSeconds;
      return typeof retry === 'number' && Number.isFinite(retry) && retry > 0
        ? `Too many attempts. Try again in ${minutesText(retry)}.`
        : 'Too many attempts from this network. Wait a minute and try again.';
    }
    case 'role-denied':
      return error.detail ?? 'Your role does not allow this.';
    case 'not-found':
      return 'That user no longer exists — refresh the page.';
    case 'validation-failed':
      return error.detail ?? 'Check the entered value and try again.';
    default:
      return error.detail ?? `Request failed (${error.code}).`;
  }
}

/** The six digits of an authenticator code, spaces stripped; null when it is not one. */
export function normaliseTotpInput(text: string): string | null {
  const clean = text.replace(/\s+/g, '');
  return /^\d{6}$/.test(clean) ? clean : null;
}

/** A backup code as typed: case-insensitive, hyphens and spaces accepted; null when it is not one. */
export function normaliseBackupInput(text: string): string | null {
  const clean = text.replace(/[\s-]+/g, '').toUpperCase();
  return /^[A-Z2-7]{10}$/.test(clean) ? `${clean.slice(0, 5)}-${clean.slice(5)}` : null;
}

/** The secret, for typing into an app by hand: groups of four. */
export function groupSecret(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join(' ');
}

/** "Expires in m:ss" — the time left on a step, never negative. */
export function expiresInLabel(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `Expires in ${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Shown after a sign-in that followed wrong codes (the server's count). */
export function failedAttemptsNotice(count: number | undefined): string | null {
  if (count === undefined || !Number.isFinite(count) || count <= 0) return null;
  return count === 1
    ? '1 failed two-factor attempt since your last sign-in. If it was not you, change your password and tell an owner.'
    : `${count} failed two-factor attempts since your last sign-in. If it was not you, change your password and tell an owner.`;
}

/** Security's warning when the backup codes run low (2 or fewer, 0 included); null otherwise. */
export function backupCodesWarning(remaining: number): string | null {
  if (remaining > 2) return null;
  if (remaining === 0) return 'You have no backup codes left — create a new set now.';
  return `Only ${remaining} backup ${remaining === 1 ? 'code' : 'codes'} left — create a new set soon.`;
}

/** The text a Copy or Download of the backup codes carries. */
export function backupCodesText(codes: readonly string[], label: string): string {
  return [
    `WMS backup codes — ${label}`,
    'Each code works once. Keep them somewhere safe, away from your phone.',
    '',
    ...codes,
    '',
  ].join('\n');
}

/** The enrolment step after a reset: the wrong code may be either one (the server counts it the same). */
export function enrolmentStepReason(error: unknown): string {
  if (error instanceof ApiProblem && error.code === 'second-factor-invalid') {
    const left = attemptsLeftOf(error);
    const base = 'The authenticator code or the enrolment code is not right';
    return left === null || left <= 0 ? `${base}.` : `${base} — ${left === 1 ? '1 attempt' : `${left} attempts`} left.`;
  }
  return secondFactorReason(error);
}

/** Story 6-1b (amendment) — the Team card offers Reset 2FA on another user with 2FA on, or with a reset still pending. */
export function canResetSecondFactor(user: { secondFactorEnabled?: boolean; secondFactorResetPending?: boolean }): boolean {
  return user.secondFactorEnabled === true || user.secondFactorResetPending === true;
}

/** The Team card's chip text — shown only to `users.role_change` holders, never when unknown. */
export function secondFactorChip(enabled: boolean | undefined): string | null {
  if (enabled === undefined) return null;
  return enabled ? '2FA On' : '2FA Off';
}

/** Story 6-1b — the sign-in page's words for the two new session ends. */
export const SECOND_FACTOR_ENDED_NOTICE = {
  'second-factor-reset': 'An owner reset your two-factor sign-in — sign in and set it up again.',
  'second-factor-changed': 'Your two-factor settings changed on another device — sign in again.',
} as const;
