/**
 * Story 6-1c — the password reset's words and rules, pure, so every sentence
 * is pinned by `password-reset.test.ts` (a sentence left in JSX is a sentence
 * nothing can pin).
 */
import { ApiProblem } from '@/lib/api/client';
import { secondFactorReason } from '@/lib/second-factor';

/** What the forgot-password page says after ANY request (the server answers one 202 for every email). */
export const RESET_REQUESTED_COPY = "If an account exists for that email, we've sent a link. It expires in 60 minutes.";

/** The reset page when its link is unusable (and the confirm's 400). */
export const RESET_LINK_INVALID_COPY = 'This link has expired or was already used. If you just set your password, sign in.';

export const PASSWORDS_DIFFER = 'The two passwords do not match.';
export const PASSWORD_TOO_SHORT = 'Use at least 8 characters.';

const UNREACHABLE = 'The API is unreachable — is wms-be running?';

/** "N minutes" from a wait in seconds (at least 1). */
export function minutesText(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/**
 * Story 6-1c (A12) — the words for a 429 `rate-limited`: the wait the server
 * gave, in minutes (an hour bucket's wait is long); "a minute" when it gave
 * none. `perAccount`: the refusal may be the account's bucket (sign-in) —
 * the reset routes' buckets are per address only (code review C31).
 */
export function rateLimitedReason(error: ApiProblem, what = 'attempts', perAccount = false): string {
  const retry = error.extensions?.retryAfterSeconds;
  const wait = typeof retry === 'number' && Number.isFinite(retry) && retry > 0 ? minutesText(retry) : 'a minute';
  return `Too many ${what} from this network${perAccount ? ' or for this account' : ''}. Try again in ${wait}.`;
}

/**
 * The reset token from the link's fragment (`#token=<id>.<secret>`, A5) —
 * the token never travels in a query string. Null when there is none.
 */
export function resetTokenFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const token = params.get('token')?.trim() ?? '';
  return token === '' ? null : token;
}

/** The new password's client rules (the server's 8–200 rule, and the two fields agree). Null = fine. */
export function newPasswordProblem(password: string, confirm: string): string | null {
  if (password.length < 8) return PASSWORD_TOO_SHORT;
  if (password !== confirm) return PASSWORDS_DIFFER;
  return null;
}

/** `/forgot-password`, carrying the email typed on the sign-in page. */
export function forgotPasswordHref(email: string): string {
  const trimmed = email.trim();
  return trimmed === '' ? '/forgot-password' : `/forgot-password?email=${encodeURIComponent(trimmed)}`;
}

/** Where a completed reset goes: the sign-in page, the email prefilled, the notice on. */
export function resetDoneHref(email: string): string {
  return `/login?email=${encodeURIComponent(email)}&reset=done`;
}

/** What the reset page does with a refusal. */
export type ResetRefusal =
  /** The link is dead: the invalid-link state with "Request a new link". */
  | { readonly kind: 'invalid' }
  /** The account needs a code (or its factor changed): re-check, then show the code field with this notice. */
  | { readonly kind: 'code-needed'; readonly reason: string }
  /** Stay on the form with this reason. */
  | { readonly kind: 'reason'; readonly reason: string };

export function resetRefusal(error: unknown): ResetRefusal {
  if (!(error instanceof ApiProblem)) return { kind: 'reason', reason: UNREACHABLE };
  switch (error.code) {
    case 'reset-link-invalid':
      return { kind: 'invalid' };
    case 'second-factor-needed':
      return { kind: 'code-needed', reason: 'This account uses two-factor sign-in — enter a code from your authenticator app, or a backup code.' };
    case 'second-factor-unavailable':
      return { kind: 'reason', reason: 'Two-factor sign-in is unavailable — try again later.' };
    case 'second-factor-locked': {
      const retry = error.extensions?.retryAfterSeconds;
      return {
        kind: 'reason',
        reason:
          typeof retry === 'number' && Number.isFinite(retry)
            ? `Too many wrong codes. Try again in ${minutesText(retry)}.`
            : 'Too many wrong codes — two-factor sign-in is locked. Ask an owner to unlock it.',
      };
    }
    case 'second-factor-invalid':
      // Code review C16 — the 5th wrong code spent the link: offer a new one.
      if (error.extensions?.attemptsLeft === 0) return { kind: 'invalid' };
      return { kind: 'reason', reason: secondFactorReason(error) };
    case 'rate-limited':
      return { kind: 'reason', reason: rateLimitedReason(error) };
    case 'validation-failed':
      return { kind: 'reason', reason: error.detail ?? 'Check the entered values and try again.' };
    default:
      return { kind: 'reason', reason: error.detail ?? `Request failed (${error.code}).` };
  }
}

/** The forgot-password page's refusal words (the request answers 202 for every email; only a limit or a bad address refuses). */
export function forgotRefusal(error: unknown): string {
  if (!(error instanceof ApiProblem)) return UNREACHABLE;
  if (error.code === 'rate-limited') return rateLimitedReason(error, 'reset requests');
  if (error.code === 'validation-failed') return 'Enter the email address you sign in with.';
  return error.detail ?? `Request failed (${error.code}).`;
}
