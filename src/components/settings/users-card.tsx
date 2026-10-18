'use client';

import { useState, useSyncExternalStore } from 'react';

import {
  ApiProblem,
  fetchApiInviteUser,
  fetchApiResetSecondFactor,
  fetchApiSetUserActive,
  fetchApiSetUserRole,
  fetchApiUnlockUser,
} from '@/lib/api/client';
import type { ClientDto, UserResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import {
  ASSIGNABLE_ROLES,
  inviteBody,
  inviteRoleOptions,
  notifyUsersChanged,
  portalInviteClients,
  roleHasCapability,
  type UserRole,
} from '@/lib/users';
import { showClients } from '@/lib/clients';
import { canResetSecondFactor, secondFactorChip, secondFactorReason } from '@/lib/second-factor';
import { ulid } from '@/lib/ulid';
import { readyClients, useClients } from '@/lib/use-clients';
import { useUsers } from '@/lib/use-users';

import { FeedbackBanner } from '@/components/feedback/banner';
import { ConfirmRow } from '@/components/settings/confirm-row';
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';

const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
const labelClass = 'text-sm font-medium';
const selectClass = `${inputClass} appearance-none`;

/**
 * The inline role select keeps the four staff roles (story 21-7): `client`
 * is never assigned — a portal user is created by an invite naming its client.
 */
const ROLE_OPTIONS: readonly UserRole[] = ASSIGNABLE_ROLES;

const ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  owner: 'Owner',
  ops_manager: 'Ops Manager',
  operator: 'Operator',
  accountant: 'Accountant',
  client: 'Client portal',
};

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

/**
 * Users & roles (story 1.5), a Settings sub-card. The list is a read — open
 * to every tenant member. The invite form and the inline role changes render
 * only for roles holding `users.invite` / `users.role_change` (hide surfaces,
 * never "blocked" screens — the backend's DB-read authority still gates every
 * command). A successful invite surfaces the one-time invite link for the
 * owner to share out-of-band (no email delivery).
 */
export function UsersCard() {
  // `null` = unknown (server render) → render nothing, no hydration mismatch.
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );

  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <div className="rounded-md border border-(--border) p-3 text-sm">
        <div className="font-medium">Users</div>
        <div className="text-(--muted-foreground)">Sign in to see your team.</div>
      </div>
    );
  }
  return <UsersCardSessioned />;
}

function UsersCardSessioned() {
  const users = useUsers();
  // The role through the session subscription, never a bare render-time read
  // (frontend guide: a role change elsewhere must re-render the gates).
  const role = useSyncExternalStore(subscribeSession, () => readSession()?.user.role, () => undefined);
  const selfId = useSyncExternalStore(subscribeSession, () => readSession()?.user.id, () => undefined);
  const clients = readyClients(useClients());
  const [outcome, setOutcome] = useState<Outcome>(null);
  // The invite response's one-time link, kept visible until the next action.
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  // Story 6-1b — a reset's one-time enrolment code, shown once (with Copy).
  const [enrolmentCode, setEnrolmentCode] = useState<{ email: string; code: string; expiresAt: string } | null>(null);

  const canInvite = roleHasCapability(role, 'users.invite');
  const canChangeRole = roleHasCapability(role, 'users.role_change');
  // Story 6-1a — which row's confirmation is open (`${action}-${userId}`).
  const [confirming, setConfirming] = useState<string | null>(null);

  const columns: readonly DataTableColumn<UserResponse>[] = [
    { key: 'email', header: 'Email' },
    {
      key: 'role',
      header: 'Role',
      render: (user) =>
        // Story 21-7 — a client-portal user's role is fixed at invite: shown
        // read-only, with its client's code, never as a select.
        user.role === 'client' ? (
          <span data-testid="client-role">
            {ROLE_LABELS.client}
            {user.clientId !== null ? ` · ${clients?.find((client) => client.id === user.clientId)?.code ?? '—'}` : ''}
          </span>
        ) : canChangeRole ? (
          <RoleSelect user={user} onDone={setOutcome} users={users} />
        ) : (
          <span>{ROLE_LABELS[user.role] ?? user.role}</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      // Story 6-1b — the "2FA On/Off" chip only for `users.role_change`
      // holders (it would tell anyone else which owners lack it).
      render: (user) => <UserStatusBadges user={user} showSecondFactor={canChangeRole} />,
    },
    // Story 6-1a — offboarding and unlock, for `users.role_change` holders.
    ...(canChangeRole
      ? [
          {
            key: 'actions',
            header: '',
            render: (user: UserResponse) => (
              <UserActions
                user={user}
                isSelf={user.id === selfId}
                confirming={confirming}
                setConfirming={setConfirming}
                onDone={(next, link) => {
                  setOutcome(next);
                  if (link !== undefined) setInviteLink(link);
                  users?.reload();
                  notifyUsersChanged();
                }}
                onEnrolmentCode={(shown) => {
                  setEnrolmentCode(shown);
                  users?.reload();
                  notifyUsersChanged();
                }}
              />
            ),
          } satisfies DataTableColumn<UserResponse>,
        ]
      : []),
  ];

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">Users & roles</h2>
        <div className="text-(--muted-foreground)">
          Your team. Invited users set their own password through their one-time invite link.
        </div>
      </div>

      {canInvite && (
        <InviteForm
          clients={clients}
          onInvited={(link) => {
            setInviteLink(link);
            setOutcome(null);
            // The invited user is a new row — refresh the table now instead
            // of waiting for an unrelated refetch.
            users?.reload();
            notifyUsersChanged();
          }}
        />
      )}

      {inviteLink !== null && (
        <div className="flex flex-col gap-1 rounded-sm border border-(--border) bg-(--muted) p-2">
          <div className="text-xs font-medium">One-time invite link (valid 7 days):</div>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={inviteLink}
              onFocus={(e) => e.target.select()}
              className={`${inputClass} font-mono text-xs`}
            />
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(inviteLink);
              }}
              className="shrink-0 rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted)"
            >
              Copy
            </button>
          </div>
          <div className="text-xs text-(--muted-foreground)">
            Share it out-of-band — it works once, then expires.
          </div>
        </div>
      )}

      {enrolmentCode !== null && (
        <div role="status" className="flex flex-col gap-1 rounded-sm border border-(--border) bg-(--muted) p-2">
          <div className="text-xs font-medium">
            Enrolment code for {enrolmentCode.email} (valid until{' '}
            {new Date(enrolmentCode.expiresAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}):
          </div>
          <div className="flex items-center gap-2">
            <code data-testid="enrolment-code" className="data rounded-sm bg-(--background) px-2 py-1 font-mono text-sm">
              {enrolmentCode.code}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(enrolmentCode.code);
              }}
              className="shrink-0 rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted)"
            >
              Copy
            </button>
          </div>
          <div className="text-xs text-(--muted-foreground)">
            Hand it to them in person — they need it, with their password, to set up two-factor sign-in again. It is shown only now.
          </div>
        </div>
      )}

      <DataTable<UserResponse>
        columns={columns}
        rows={users?.items ?? []}
        nextCursor={users?.nextCursor ?? null}
        onCursor={users?.onCursor}
        emptyMessage="No users yet — invite your first team member above."
      />

      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}
    </section>
  );
}

/** The invite form: email + role select, fresh ULID key per submit. */
function InviteForm({
  onInvited,
  clients,
}: {
  onInvited: (link: string) => void;
  clients: readonly ClientDto[] | null;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('operator');
  const [clientId, setClientId] = useState<string>('');
  const clientRole = showClients(clients);
  const pickable = clients === null ? [] : portalInviteClients(clients);
  const [pending, setPending] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const session = readSession();
    if (session === null) return;
    const { body, problem } = inviteBody(email, role, clientId === '' ? null : clientId);
    if (body === null) {
      setRejection(problem);
      return;
    }
    setPending(true);
    setRejection(null);
    try {
      const invited = await fetchApiInviteUser(session.tenant.id, body, ulid());
      setEmail('');
      const url = new URL('/accept-invite', window.location.origin);
      url.searchParams.set('tenant', session.tenant.id);
      url.searchParams.set('token', invited.inviteToken);
      onInvited(url.toString());
    } catch (error) {
      setRejection(rejectionReason(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-sm border border-(--border) p-3">
      <div className="text-xs text-(--muted-foreground)">
        Invite a team member — they appear as <span className="font-mono">invited</span> until they accept.
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-[2] flex-col gap-1">
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
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Role</span>
          <select
            className={selectClass}
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
          >
            {inviteRoleOptions(clientRole).map((option) => (
              <option key={option} value={option}>
                {ROLE_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        {role === 'client' && (
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>Client</span>
            <select
              className={selectClass}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              aria-label="Client brand"
              required
            >
              <option value="">Pick a client…</option>
              {pickable.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.code} — {client.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="submit"
          disabled={pending}
          className="self-end rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Inviting…' : 'Invite'}
        </button>
      </div>
      {rejection !== null && <FeedbackBanner tone="rejected" word="Not invited" reason={rejection} />}
    </form>
  );
}

const chipClass = 'rounded-full border px-2 py-0.5 text-xs';

/** Story 6-1a — `lockedUntil` in the future reads "Locked" (words, not colour alone). */
export function isSignInLocked(user: Pick<UserResponse, 'lockedUntil'>, now = Date.now()): boolean {
  return typeof user.lockedUntil === 'string' && Date.parse(user.lockedUntil) > now;
}

function UserStatusBadges({ user, showSecondFactor }: { user: UserResponse; showSecondFactor: boolean }) {
  const chip = showSecondFactor ? secondFactorChip(user.secondFactorEnabled) : null;
  return (
    <span className="flex flex-wrap gap-1">
      {user.status === 'invited' ? (
        <span className={`${chipClass} border-(--border) bg-(--muted) text-(--muted-foreground)`}>Invited</span>
      ) : user.status === 'deactivated' ? (
        <span className={`${chipClass} border-(--destructive) text-(--destructive)`}>Deactivated</span>
      ) : (
        <span className={`${chipClass} border-(--accent) text-(--accent-foreground)`}>Active</span>
      )}
      {isSignInLocked(user) && (
        <span className={`${chipClass} border-(--warning,#b45309) text-(--warning,#b45309)`} title={`Locked until ${user.lockedUntil}`}>
          Sign-in locked
        </span>
      )}
      {chip !== null && (
        <span data-testid="second-factor-chip" className={`${chipClass} border-(--border) text-(--muted-foreground)`}>
          {chip}
        </span>
      )}
    </span>
  );
}

const rowButtonClass = 'rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40';

/** Story 6-1a — Deactivate / Reactivate / Unlock for one user row, each behind a confirmation. */
function UserActions({
  user,
  isSelf,
  confirming,
  setConfirming,
  onDone,
  onEnrolmentCode,
}: {
  user: UserResponse;
  isSelf: boolean;
  confirming: string | null;
  setConfirming: (value: string | null) => void;
  onDone: (outcome: Outcome, inviteLink?: string) => void;
  onEnrolmentCode: (shown: { email: string; code: string; expiresAt: string }) => void;
}) {
  const open = (action: string) => setConfirming(`${action}-${user.id}`);
  const close = () => setConfirming(null);
  const rejected = (reason: string) => onDone({ tone: 'rejected', word: 'Not changed', reason });

  if (confirming === `deactivate-${user.id}`) {
    return (
      <ConfirmRow
        key={`deactivate-${user.id}`}
        question={
          isSelf
            ? 'Deactivate your own account? You will be signed out everywhere.'
            : `Deactivate ${user.email}? They are signed out everywhere and cannot sign in or badge in. Their history stays.`
        }
        confirmLabel="Deactivate"
        ariaLabel={`Confirm deactivating ${user.email}`}
        run={(key, tenantId) => fetchApiSetUserActive(tenantId, user.id, false, key)}
        reason={rejectionReason}
        onDone={(result) => {
          close();
          onDone({ tone: 'accepted', word: `${result.user.email} deactivated`, reason: 'Every session they had has ended.' });
        }}
        onRejected={(reason) => {
          close();
          rejected(reason);
        }}
        onClose={close}
      />
    );
  }
  if (confirming === `reactivate-${user.id}`) {
    return (
      <ConfirmRow
        key={`reactivate-${user.id}`}
        question={`Reactivate ${user.email}?`}
        confirmLabel="Reactivate"
        ariaLabel={`Confirm reactivating ${user.email}`}
        run={(key, tenantId) =>
          fetchApiSetUserActive(tenantId, user.id, true, key).then((result) => ({ result, tenantId }))
        }
        reason={rejectionReason}
        onDone={({ result, tenantId }) => {
          close();
          if (result.inviteToken !== undefined) {
            const url = new URL('/accept-invite', window.location.origin);
            url.searchParams.set('tenant', tenantId);
            url.searchParams.set('token', result.inviteToken);
            onDone(
              { tone: 'accepted', word: `${result.user.email} reactivated`, reason: 'They had not accepted their invite — share the new invite link below.' },
              url.toString(),
            );
            return;
          }
          onDone({ tone: 'accepted', word: `${result.user.email} reactivated`, reason: 'They can sign in again.' });
        }}
        onRejected={(reason) => {
          close();
          rejected(reason);
        }}
        onClose={close}
      />
    );
  }
  if (confirming === `unlock-${user.id}`) {
    return (
      <ConfirmRow
        key={`unlock-${user.id}`}
        question={`Unlock sign-in for ${user.email}?`}
        confirmLabel="Unlock"
        ariaLabel={`Confirm unlocking ${user.email}`}
        run={(key, tenantId) => fetchApiUnlockUser(tenantId, user.id, key)}
        reason={rejectionReason}
        onDone={(result) => {
          close();
          onDone({ tone: 'accepted', word: `${result.email} unlocked`, reason: 'They can try signing in again now.' });
        }}
        onRejected={(reason) => {
          close();
          rejected(reason);
        }}
        onClose={close}
      />
    );
  }
  if (confirming === `reset-2fa-${user.id}`) {
    return (
      <ConfirmRow
        key={`reset-2fa-${user.id}`}
        question={`Reset two-factor sign-in for ${user.email}? They are signed out, and set it up again with a one-time code you hand them.`}
        confirmLabel="Reset 2FA"
        ariaLabel={`Confirm resetting two-factor sign-in for ${user.email}`}
        run={(key, tenantId) => fetchApiResetSecondFactor(tenantId, user.id, key)}
        reason={secondFactorReason}
        onDone={(result) => {
          close();
          if (result.enrolmentCode !== null && result.enrolmentCodeExpiresAt !== null) {
            onEnrolmentCode({ email: user.email, code: result.enrolmentCode, expiresAt: result.enrolmentCodeExpiresAt });
            return;
          }
          onDone({ tone: 'accepted', word: 'Nothing to reset', reason: `${user.email} has not set up two-factor sign-in.` });
        }}
        onRejected={(reason) => {
          close();
          rejected(reason);
        }}
        onClose={close}
      />
    );
  }
  return (
    <span className="flex flex-wrap gap-1">
      {/* Story 6-1b — never on your own row (Security handles your own); also while a reset is pending (re-issue an expired code). */}
      {!isSelf && canResetSecondFactor(user) && (
        <button type="button" className={rowButtonClass} onClick={() => open('reset-2fa')}>
          Reset 2FA
        </button>
      )}
      {isSignInLocked(user) && (
        <button type="button" className={rowButtonClass} onClick={() => open('unlock')}>
          Unlock
        </button>
      )}
      {user.status === 'deactivated' ? (
        <button type="button" className={rowButtonClass} onClick={() => open('reactivate')}>
          Reactivate
        </button>
      ) : (
        <button type="button" className={rowButtonClass} onClick={() => open('deactivate')}>
          Deactivate
        </button>
      )}
    </span>
  );
}

/** The inline role cell: a select that PATCHes on change (sku-table pattern). */
function RoleSelect({
  user,
  onDone,
  users,
}: {
  user: UserResponse;
  onDone: (outcome: Outcome) => void;
  users: ReturnType<typeof useUsers>;
}) {
  const [pending, setPending] = useState(false);

  async function onChange(role: string) {
    const session = readSession();
    if (session === null || role === user.role) return;
    setPending(true);
    try {
      const updated = await fetchApiSetUserRole(
        session.tenant.id,
        user.id,
        { role: role as (typeof ASSIGNABLE_ROLES)[number] },
        ulid(),
      );
      onDone({
        tone: 'accepted',
        word: `${updated.email} is now ${ROLE_LABELS[updated.role]}`,
        reason:
          updated.role === 'owner'
            ? 'Owners can manage users — invite, change roles, and demote everyone but the last Owner.'
            : 'They are signed out and sign in again under the new role.',
      });
      users?.reload();
      notifyUsersChanged();
    } catch (error) {
      onDone({ tone: 'rejected', word: 'Not changed', reason: rejectionReason(error) });
    } finally {
      setPending(false);
    }
  }

  return (
    <select
      className={`${selectClass} w-auto py-1 text-xs`}
      value={user.role}
      disabled={pending}
      onChange={(e) => void onChange(e.target.value)}
      aria-label={`Role for ${user.email}`}
    >
      {ROLE_OPTIONS.map((option) => (
        <option key={option} value={option}>
          {ROLE_LABELS[option]}
        </option>
      ))}
    </select>
  );
}

/**
 * Clients branch on the machine-readable problem `code`, never on prose —
 * extended with the new users codes (spec 1.5).
 */
function rejectionReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'email-exists':
        return error.detail ?? 'An account for this email already exists.';
      case 'last-owner':
        return 'The last active Owner cannot be demoted or deactivated — make another user an Owner first.';
      case 'not-found':
        return 'That user no longer exists — refresh the page.';
      case 'role-denied':
        return error.detail ?? 'Your role does not allow this change.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the entered values and try again.';
      case 'client-not-active':
        return error.detail ?? 'That client brand is not active — portal users are invited for an active client only.';
      default:
        return error.detail ?? `Request failed (${error.code}).`;
    }
  }
  return 'The API is unreachable — is wms-be running?';
}