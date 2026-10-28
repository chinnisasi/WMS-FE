'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

import {
  ApiProblem,
  fetchApiAcceptInvite,
  fetchApiCheckPasswordReset,
  fetchApiConfirmPasswordReset,
  fetchApiRegisterTenant,
  fetchApiRequestPasswordReset,
  fetchApiSignIn,
} from '@/lib/api/client';
import type {
  EnrollChallengeResponse,
  SecondFactorSignInResponse,
  SignInResponse,
  TotpChallengeResponse,
} from '@/lib/api/generated';
import {
  failedAttemptsNotice,
  normaliseBackupInput,
  normaliseTotpInput,
  RELOAD_REASON,
  secondFactorReason,
  signInStep,
} from '@/lib/second-factor';
import { clearSession, writeSession } from '@/lib/auth';
import {
  forgotPasswordHref,
  forgotRefusal,
  newPasswordProblem,
  rateLimitedReason,
  RESET_LINK_INVALID_COPY,
  RESET_REQUESTED_COPY,
  resetDoneHref,
  resetRefusal,
  resetTokenFromHash,
} from '@/lib/password-reset';
import { PORTAL_DEPARTED_MESSAGE, PORTAL_SUSPENDED_MESSAGE, signInDestination } from '@/lib/portal';
import { GSTIN_HELP } from '@/lib/gstin';
import { registerTenantBody } from '@/lib/tenancy-forms';
import { ulid } from '@/lib/ulid';

import { FeedbackBanner } from '@/components/feedback/banner';
import { Field } from '@/components/shared/field';
import { SubmitButton } from '@/components/shared/submit-button';
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
  | { readonly kind: 'done'; readonly body: SignInResponse | SecondFactorSignInResponse; readonly arrivedAt: number };

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
export function LoginForm({
  initialEmail = '',
  notice = null,
  resetDone = false,
}: {
  initialEmail?: string;
  notice?: string | null;
  /** Story 6-1c — the notice is a completed reset's (an accepted banner, not "Signed out"). */
  resetDone?: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const [step, setStep] = useState<LoginStep>({ kind: 'password' });
  const passwordRef = useRef<HTMLInputElement>(null);

  /**
   * Writes the session and leaves for the shell. The expiries count from
   * `arrivedAt` — when the response arrived — not from Continue: time spent
   * reading the backup codes is already off the token's life.
   */
  function enter(body: SignInResponse | SecondFactorSignInResponse, arrivedAt: number) {
    const written = writeSession({
      token: body.accessToken,
      tenant: body.tenant,
      user: body.user,
      // Story 21-7 — a client-portal user's client brand (null for staff).
      client: body.client ?? null,
      expiresAt: arrivedAt + body.expiresInSeconds * 1000,
      // Story 6-1a — refreshable until the session's absolute end.
      refreshUntil: arrivedAt + body.refreshExpiresInSeconds * 1000,
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
    const arrivedAt = Date.now();
    const extra = body as SecondFactorSignInResponse;
    if ((extra.backupCodes?.length ?? 0) > 0 || failedAttemptsNotice(extra.secondFactorFailedAttempts) !== null) {
      setStep({ kind: 'done', body, arrivedAt });
      return;
    }
    enter(body, arrivedAt);
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
      setRejection(
        error instanceof ApiProblem && error.code === 'client-outdated'
          ? RELOAD_REASON
          : error instanceof ApiProblem && error.code === 'enrolment-code-expired'
            ? secondFactorReason(error)
            : rejectionReason(error),
      );
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
          <BackupCodesPanel codes={extra.backupCodes} label={email} onContinue={() => enter(step.body, step.arrivedAt)} />
        ) : (
          <button
            type="button"
            onClick={() => enter(step.body, step.arrivedAt)}
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
      {notice !== null &&
        (resetDone ? (
          <FeedbackBanner tone="accepted" word="Password changed" reason={notice} />
        ) : (
          <FeedbackBanner tone="rejected" word="Signed out" reason={notice} />
        ))}
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
      {/* Story 6-1c — under the password, carrying the typed email to the request page. */}
      <Link href={forgotPasswordHref(email)} className="-mt-2 self-end text-sm text-(--primary) underline underline-offset-2">
        Forgot password?
      </Link>
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
      setRejection('This invite link is incomplete — ask whoever invited you to send a new invitation.');
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

/**
 * Story 6-1c — forgot password: the email (prefilled from the sign-in page),
 * then one answer for every email — the server never says whether an
 * account exists. A limit (429) says its wait in minutes.
 */
export function ForgotPasswordForm({ initialEmail = '' }: { initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setRejection(null);
    try {
      await fetchApiRequestPasswordReset({ email: email.trim() });
      setSentTo(email.trim());
    } catch (error) {
      setRejection(forgotRefusal(error));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  if (sentTo !== null) {
    return (
      <div className="flex flex-col gap-4">
        <FeedbackBanner tone="accepted" word="Check your email" reason={RESET_REQUESTED_COPY} />
        <p className="text-sm text-(--muted-foreground)">
          No email after a few minutes? Check your spam folder, or{' '}
          <button type="button" className="text-(--primary) underline underline-offset-2" onClick={() => setSentTo(null)}>
            send another link
          </button>
          .
        </p>
        <Link href={`/login?email=${encodeURIComponent(sentTo)}`} className="text-sm text-(--primary) underline underline-offset-2">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="Email" hint="The address you sign in with.">
        {(control) => (
          <input
            {...control}
            className={inputClass}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            autoComplete="email"
          />
        )}
      </Field>
      {rejection !== null && <FeedbackBanner tone="rejected" word="Not sent" reason={rejection} />}
      <SubmitButton busy={pending} label="Send reset link" busyLabel="Sending…" />
      <Link href={email.trim() === '' ? '/login' : `/login?email=${encodeURIComponent(email.trim())}`} className="text-sm text-(--primary) underline underline-offset-2">
        Back to sign in
      </Link>
    </form>
  );
}

/** The reset page's states (story 6-1c, A16). */
type ResetState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'invalid' }
  /** The check itself failed (a limit, the API unreachable): the link may be fine — retry (code review C29). */
  | { readonly kind: 'check-failed'; readonly reason: string }
  | { readonly kind: 'ready'; readonly email: string; readonly secondFactorRequired: boolean };

/**
 * Story 6-1c — set a new password from an emailed link. The token rides the
 * link's FRAGMENT (`#token=…`, A5): read on the client, dropped from the
 * address bar at once (`history.replaceState`), and sent only in POST
 * bodies. Opening the page changes nothing — `check` validates the link
 * and writes nothing, so a mail scanner spends nothing. An enrolled account
 * needs a code (TOTP or backup). Success signs NO ONE in: the local session
 * and the hint cookie are cleared (the server has already ended every
 * session, A14) and the page goes to `/login?…&reset=done`.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<ResetState>({ kind: 'checking' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [pending, setPending] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldProblem, setFieldProblem] = useState<string | null>(null);
  const inFlight = useRef(false);
  const started = useRef(false);

  /**
   * Validates the link. On the first load a failed check (not a dead link)
   * shows Retry; on a re-check (after `second-factor-needed`) it keeps the
   * form as it was and says why (code review C15). Answers the fresh state.
   */
  async function runCheck(value: string, recheck = false): Promise<ResetState | null> {
    try {
      const checked = await fetchApiCheckPasswordReset(value);
      const next: ResetState = { kind: 'ready', email: checked.email, secondFactorRequired: checked.secondFactorRequired };
      setState(next);
      return next;
    } catch (error) {
      const refusal = resetRefusal(error);
      if (refusal.kind === 'invalid') {
        setState({ kind: 'invalid' });
        return { kind: 'invalid' };
      }
      const reason = refusal.kind === 'reason' ? refusal.reason : 'Check the link and try again.';
      if (recheck) setRejection(reason);
      else setState({ kind: 'check-failed', reason });
      return null;
    }
  }

  useEffect(() => {
    // Code review C28 — once per page (StrictMode runs a mount effect twice in
    // development; the first run already took the token off the address bar).
    if (started.current) return;
    started.current = true;
    const found = resetTokenFromHash(window.location.hash);
    // Drop the token from the address bar (and so from history and sync) at once.
    if (window.location.hash !== '') window.history.replaceState(null, '', window.location.pathname);
    void (async () => {
      // The state lands after the effect (the hash is client-only, so the
      // server render and the first client render both read "checking").
      await Promise.resolve();
      if (found === null) {
        setState({ kind: 'invalid' });
        return;
      }
      setToken(found);
      await runCheck(found);
    })();
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || token === null || state.kind !== 'ready') return;
    const problem = newPasswordProblem(password, confirm);
    setFieldProblem(problem);
    if (problem !== null) return;
    let sentCode: string | undefined;
    if (state.secondFactorRequired) {
      const normalised = useBackup ? normaliseBackupInput(code) : normaliseTotpInput(code);
      if (normalised === null) {
        setRejection(useBackup ? 'A backup code is 10 letters and digits, like ABCDE-FGH23.' : 'Enter the 6-digit code from your authenticator app.');
        return;
      }
      sentCode = normalised;
    }
    inFlight.current = true;
    setPending(true);
    setRejection(null);
    setNotice(null);
    try {
      const done = await fetchApiConfirmPasswordReset({ token, password, ...(sentCode === undefined ? {} : { code: sentCode }) });
      // A14 — the server ended every session; the browser agrees before it leaves.
      clearSession();
      router.push(resetDoneHref(done.email));
    } catch (error) {
      const refusal = resetRefusal(error);
      if (refusal.kind === 'invalid') {
        setState({ kind: 'invalid' });
      } else if (refusal.kind === 'code-needed') {
        // The factor may have changed since the check: ask again, then show
        // the field — the notice only when a code is now asked for (C14).
        setCode('');
        const fresh = await runCheck(token, true);
        if (fresh?.kind === 'ready' && fresh.secondFactorRequired) setNotice(refusal.reason);
      } else {
        setCode('');
        setRejection(refusal.reason);
      }
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  if (state.kind === 'checking') {
    return (
      <p role="status" className="text-sm text-(--muted-foreground)">
        Checking your link…
      </p>
    );
  }

  if (state.kind === 'check-failed') {
    return (
      <div className="flex flex-col gap-4">
        <FeedbackBanner tone="rejected" word="Couldn’t check the link" reason={state.reason} />
        <button
          type="button"
          className="self-start rounded-md border border-(--border) px-3 py-2 text-sm font-medium hover:bg-(--muted)"
          onClick={() => {
            if (token === null) return;
            setState({ kind: 'checking' });
            void runCheck(token);
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (state.kind === 'invalid') {
    return (
      <div className="flex flex-col gap-4">
        <FeedbackBanner tone="rejected" word="Link not valid" reason={RESET_LINK_INVALID_COPY} />
        <div className="flex flex-wrap gap-4 text-sm">
          <Link href="/forgot-password" className="font-medium text-(--primary) underline underline-offset-2">
            Request a new link
          </Link>
          <Link href="/login" className="text-(--primary) underline underline-offset-2">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {state.email !== '' && (
        <p className="text-sm text-(--muted-foreground)">
          Setting a new password for <span className="font-medium text-(--foreground)">{state.email}</span>
        </p>
      )}
      {notice !== null && <FeedbackBanner tone="warning" word="Code needed" reason={notice} />}
      <Field label="New password" hint="At least 8 characters.">
        {(control) => (
          <input
            {...control}
            className={inputClass}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            maxLength={200}
            autoFocus
            autoComplete="new-password"
          />
        )}
      </Field>
      <Field label="Confirm new password" error={fieldProblem}>
        {(control) => (
          <input
            {...control}
            className={inputClass}
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onBlur={() => setFieldProblem(confirm === '' ? null : newPasswordProblem(password, confirm))}
            required
            minLength={8}
            maxLength={200}
            autoComplete="new-password"
          />
        )}
      </Field>
      {state.secondFactorRequired && (
        <div className="flex flex-col gap-2">
          {useBackup ? (
            <Field label="Backup code" hint="This account uses two-factor sign-in.">
              {(control) => (
                <input
                  {...control}
                  key="backup"
                  className={`${inputClass} font-mono`}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={20}
                  placeholder="ABCDE-FGH23"
                />
              )}
            </Field>
          ) : (
            <Field label="Authenticator code" hint="This account uses two-factor sign-in.">
              {(control) => (
                <input
                  {...control}
                  key="totp"
                  className={`${inputClass} font-mono tracking-widest`}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\s+/g, ''))}
                  required
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  placeholder="123456"
                />
              )}
            </Field>
          )}
          <button
            type="button"
            className="self-start text-sm text-(--primary) underline underline-offset-2"
            onClick={() => {
              setUseBackup((value) => !value);
              setCode('');
              setRejection(null);
            }}
          >
            {useBackup ? 'Use the authenticator app' : 'Use a backup code'}
          </button>
        </div>
      )}
      {rejection !== null && <FeedbackBanner tone="rejected" word="Not changed" reason={rejection} />}
      <SubmitButton busy={pending} label="Set new password" busyLabel="Setting password…" />
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
      // Story 6-1c (A12) — the wait in minutes (the untrusted hour buckets).
      case 'rate-limited':
        return rateLimitedReason(error, 'sign-in attempts', true);
      case 'client-suspended':
        return PORTAL_SUSPENDED_MESSAGE;
      // Story 1-2a — a portal user whose client has departed.
      case 'client-departed':
        return PORTAL_DEPARTED_MESSAGE;
      case 'invite-pending':
        return 'This invitation has not been accepted yet — use the link from your invitation.';
      case 'invite-invalid':
        return 'This invite link is not valid — ask whoever invited you to send a new invitation.';
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