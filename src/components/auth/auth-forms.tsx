'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ApiProblem, fetchApiAcceptInvite, fetchApiRegisterTenant, fetchApiSignIn } from '@/lib/api/client';
import { writeSession } from '@/lib/auth';
import { ulid } from '@/lib/ulid';

import { FeedbackBanner } from '@/components/feedback/banner';

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
  const [pending, setPending] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setRejection(null);
    try {
      const registration = await fetchApiRegisterTenant(
        { name, ownerEmail, password },
        ulid(),
      );
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

/**
 * Sign-in: verifies the password and stores the short-lived session the
 * warehouse endpoints require. The response's `user {id, email, role}`
 * rides along (story 1.5) — it feeds the sidebar/settings surface gating
 * until the /me bootstrap refresh on the next mount.
 */
export function LoginForm({ initialEmail = '' }: { initialEmail?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setRejection(null);
    try {
      const signIn = await fetchApiSignIn({ email, password });
      writeSession({
        token: signIn.accessToken,
        tenant: signIn.tenant,
        user: signIn.user,
        expiresAt: Date.now() + signIn.expiresInSeconds * 1000,
      });
      router.push('/settings');
    } catch (error) {
      setRejection(rejectionReason(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
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

/** Clients branch on the machine-readable problem `code`, never on prose. */
function rejectionReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'duplicate-email':
        return 'An account for this email already exists.';
      case 'unauthenticated':
        return 'Unknown email or wrong password.';
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