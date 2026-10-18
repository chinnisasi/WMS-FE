'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';

import { ApiProblem, fetchApiAcceptInvite, fetchApiRegisterTenant, fetchApiSignIn } from '@/lib/api/client';
import type {
  EnrollChallengeResponse,
  SecondFactorSignInResponse,
  SignInResponse,
  TotpChallengeResponse,
} from '@/lib/api/generated';
import { failedAttemptsNotice, RELOAD_REASON, signInStep } from '@/lib/second-factor';
import { writeSession } from '@/lib/auth';
import { PORTAL_SUSPENDED_MESSAGE, signInDestination } from '@/lib/portal';
import { GSTIN_HELP } from '@/lib/gstin';
import { registerTenantBody } from '@/lib/tenancy-forms';
import { ulid } from '@/lib/ulid';

import { FeedbackBanner } from '@/components/feedback/banner';
import { BackupCodesPanel } from '@/components/auth/backup-codes-panel';
import { EnrollStep, SecondFactorStep } from '@/components/auth/second-factor-steps';

const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
const labelClass = 'text-sm font-medium';

/**
 * Registration: business name, owner email, password → tenant + owner user.
 * The response carries no password material and no session token, so
 * success routes to /login to mint the 15-minute token. Honest error lines
 * branch on the machine-readable problem `code`.
 */
export function RegisterForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [password, setPassword] = useState('');
  // Story 8-1c: the business GSTIN, optional — blank sends no `gstin` key.
  const [gstin, setGstin] = useState('');
  const gstinHelpId = useId();
  const [pending, setPending] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setRejection(null);
    // The GSTIN's shape is decided before anything is requested — and before
    // setPending(true), so a refused shape leaves the button enabled.
    const built = registerTenantBody({ name, ownerEmail, password, gstinText: gstin });
    if ('problem' in built) {
      setRejection(built.problem);
      return;
    }
    setPending(true);
    try {
      const registration = await fetchApiRegisterTenant(built.body, ulid());
      // Registration returns no session token (sign-in mints it), so route
      // to /login with the new owner email prefilled — honest, no fake
      // session.
      router.push(`/login?email=${encodeURIComponent(registration.owner.email)}`);
    } catch (error) {
      setRejection(rejectionReason(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Business name</span>
        <input
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={200}
          autoComplete="organization"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Business GSTIN (optional)</span>
        <input
          className={inputClass}
          value={gstin}
          onChange={(e) => setGstin(e.target.value)}
          // No `pattern`: `parseGstinField` is the only shape gate (a native
          // pattern would block a padded paste the parser trims). The cap is
          // loose for the same reason — 15 characters plus padding.
          maxLength={20}
          autoCapitalize="characters"
          spellCheck={false}
          autoComplete="off"
          placeholder="29AAPCD1234K1Z5"
          aria-describedby={gstinHelpId}
        />
        <span id={gstinHelpId} className="text-xs text-(--muted-foreground)">{GSTIN_HELP}</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Owner email</span>
        <input
          className={inputClass}
          type="email"
          value={ownerEmail}
          onChange={(e) => setOwnerEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Password</span>
        <input
          className={inputClass}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          maxLength={200}
          autoComplete="new-password"
        />
      </label>
      {rejection !== null && <FeedbackBanner tone="rejected" word="Not registered" reason={rejection} />}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60"
      >
        {pending ? 'Registering…' : 'Create account'}
      </button>
    </form>
  );
}

/** The steps of a sign-in (story 6-1b). */
type LoginStep =
  | { readonly kind: 'password' }
  | { readonly kind: 'totp'; readonly challenge: TotpChallengeResponse; readonly expiresAt: number }
  | { readonly kind: 'enroll'; readonly challenge: EnrollChallengeResponse; readonly expiresAt: number }
  /** Signed in, held until Continue: the backup codes to save, or the failed-attempts notice. */
  | { readonly kind: 'done'; readonly body: SignInResponse | SecondFactorSignInResponse };

const STEP_ANNOUNCEMENT: Readonly<Record<LoginStep['kind'], string>> = {
  password: '',
  totp: 'Step 2 of 2: enter the code from your authenticator app.',
  enroll: 'Step 2 of 2: set up two-factor sign-in.',
  done: 'Signed in.',
};

/**
 * Sign-in: verifies the password and stores the short-lived session the
 * warehouse endpoints require. The response's `user {id, email, role}`
 * rides along (story 1.5) — it feeds the sidebar/settings surface gating
 * until the /me bootstrap refresh on the next mount.
 *
 * Story 6-1b — two steps when the server asks: the form switches in place to
 * the code step (an enrolled user) or the enrolment step (an owner not yet
 * enrolled). The email is kept and the password cleared; an `aria-live`
 * region announces the step; the `?ended=` notice hides. When the step ends
 * (its expiry here, or `challenge-ended` from the server) the form returns
 * to the password with "Sign in again" and focus on the password. The session
 * is written — and the page left — only on Continue when there are backup
 * codes to save or failed attempts to report; until then the access token
 * lives in component state.
 */
export function LoginForm({ initialEmail = '', notice = null }: { initialEmail?: string; notice?: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const [step, setStep] = useState<LoginStep>({ kind: 'password' });
  const passwordRef = useRef<HTMLInputElement>(null);

  /** Writes the session and leaves for the shell. */
  function enter(body: SignInResponse | SecondFactorSignInResponse) {
    const written = writeSession({
      token: body.accessToken,
      tenant: body.tenant,
      user: body.user,
      // Story 21-7 — a client-portal user's client brand (null for staff).
      client: body.client ?? null,
      expiresAt: Date.now() + body.expiresInSeconds * 1000,
      // Story 6-1a — refreshable until the session's absolute end.
      refreshUntil: Date.now() + body.refreshExpiresInSeconds * 1000,
    });
    if (!written) {
      setStep({ kind: 'password' });
      setRejection(RELOAD_REASON);
      return;
    }
    router.push(signInDestination(body.user));
  }

  /** A session arrived: hold it when there is something to read first, else go in. */
  function arrived(body: SignInResponse | SecondFactorSignInResponse) {
    const extra = body as SecondFactorSignInResponse;
    if ((extra.backupCodes?.length ?? 0) > 0 || failedAttemptsNotice(extra.secondFactorFailedAttempts) !== null) {
      setStep({ kind: 'done', body });
      return;
    }
    enter(body);
  }

  function stepEnded() {
    setStep({ kind: 'password' });
    setRejection('Sign in again.');
    // After the render that brings the password field back.
    setTimeout(() => passwordRef.current?.focus(), 0);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setRejection(null);
    try {
      const answer = signInStep(await fetchApiSignIn({ email, password }));
      if (answer.kind === 'unknown') {
        setRejection(RELOAD_REASON);
        return;
      }
      if (answer.kind === 'session') {
        arrived(answer.body);
        return;
      }
      setPassword('');
      setStep({ kind: answer.kind, challenge: answer.challenge, expiresAt: Date.now() + answer.challenge.expiresInSeconds * 1000 } as LoginStep);
    } catch (error) {
      setRejection(error instanceof ApiProblem && error.code === 'client-outdated' ? RELOAD_REASON : rejectionReason(error));
    } finally {
      setPending(false);
    }
  }

  const announcement = <p aria-live="polite" className="sr-only">{STEP_ANNOUNCEMENT[step.kind]}</p>;

  if (step.kind === 'totp' || step.kind === 'enroll') {
    return (
      <div className="flex flex-col gap-4">
        {announcement}
        <p className="text-sm text-(--muted-foreground)">
          Signing in as <span className="font-medium text-(--foreground)">{email}</span>
        </p>
        {step.kind === 'totp' ? (
          <SecondFactorStep challenge={step.challenge} expiresAt={step.expiresAt} onSession={arrived} onEnded={stepEnded} />
        ) : (
          <EnrollStep challenge={step.challenge} expiresAt={step.expiresAt} onSession={arrived} onEnded={stepEnded} />
        )}
      </div>
    );
  }

  if (step.kind === 'done') {
    const extra = step.body as SecondFactorSignInResponse;
    const failed = failedAttemptsNotice(extra.secondFactorFailedAttempts);
    return (
      <div className="flex flex-col gap-4">
        {announcement}
        {failed !== null && <FeedbackBanner tone="warning" word="Failed attempts" reason={failed} />}
        {extra.backupCodes !== undefined && extra.backupCodes.length > 0 ? (
          <BackupCodesPanel codes={extra.backupCodes} label={email} onContinue={() => enter(step.body)} />
        ) : (
          <button
            type="button"
            onClick={() => enter(step.body)}
            className="rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90"
          >
            Continue
          </button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {announcement}
      {notice !== null && <FeedbackBanner tone="rejected" word="Signed out" reason={notice} />}
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Email</span>
        <input
          className={inputClass}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Password</span>
        <input
          ref={passwordRef}
          className={inputClass}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
      </label>
      {rejection !== null && <FeedbackBanner tone="rejected" word="Not signed in" reason={rejection} />}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

/**
 * Accept-invite (story 1.5): the one-time token arrives as the invite link's
 * query parameter; the invitee sets their own password. No session is minted
 * here — success routes to /login with the now-active email prefilled.
 */
export function AcceptInviteForm({ initialToken = '' }: { initialToken?: string }) {
  const router = useRouter();
  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setRejection('The two passwords do not match.');
      return;
    }
    // The inviting tenant id rides the invite link too.
    const tenantId = new URLSearchParams(window.location.search).get('tenant') ?? '';
    if (tenantId === '') {
      setRejection('This invite link is incomplete — ask the owner for a fresh invitation.');
      return;
    }
    setPending(true);
    setRejection(null);
    try {
      const accepted = await fetchApiAcceptInvite(tenantId, { token, password }, ulid());
      router.push(`/login?email=${encodeURIComponent(accepted.user.email)}`);
    } catch (error) {
      setRejection(rejectionReason(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Invite token</span>
        <input
          className={`${inputClass} font-mono text-xs`}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
          maxLength={512}
          autoComplete="off"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Password</span>
        <input
          className={inputClass}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          maxLength={200}
          autoComplete="new-password"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Confirm password</span>
        <input
          className={inputClass}
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
          maxLength={200}
          autoComplete="new-password"
        />
      </label>
      {rejection !== null && <FeedbackBanner tone="rejected" word="Not accepted" reason={rejection} />}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60"
      >
        {pending ? 'Accepting…' : 'Accept invite'}
      </button>
    </form>
  );
}

/** Story 6-1a — "N minutes" from a lockout's `retryAfterSeconds` (15 when absent). */
function minutesFrom(error: ApiProblem): string {
  const seconds = typeof error.extensions?.retryAfterSeconds === 'number' ? error.extensions.retryAfterSeconds : 15 * 60;
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/** Clients branch on the machine-readable problem `code`, never on prose. */
function rejectionReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'duplicate-email':
        return 'An account for this email already exists.';
      case 'unauthenticated':
        return 'Unknown email or wrong password.';
      // Story 6-1a — lockout and the attempt limit.
      case 'sign-in-locked':
        return `Too many failed attempts. Try again in ${minutesFrom(error)}, or ask an owner to unlock your account.`;
      case 'rate-limited':
        return 'Too many sign-in attempts from this network. Wait a minute and try again.';
      case 'client-suspended':
        return PORTAL_SUSPENDED_MESSAGE;
      case 'invite-pending':
        return 'This invitation has not been accepted yet — use the link from your invitation.';
      case 'invite-invalid':
        return 'This invite link is not valid — ask the owner for a fresh invitation.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed; check your tenant list.';
      case 'validation-failed':
        return error.detail ?? 'Check the entered values and try again.';
      default:
        return error.detail ?? `Request failed (${error.code}).`;
    }
  }
  return 'The API is unreachable — is wms-be running?';
}