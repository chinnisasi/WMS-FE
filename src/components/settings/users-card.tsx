'use client';

import { useState, useSyncExternalStore } from 'react';

import {
  ApiProblem,
  fetchApiInviteUser,
  fetchApiSetUserRole,
} from '@/lib/api/client';
import type { UserResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { notifyUsersChanged, roleHasCapability, type UserRole } from '@/lib/users';
import { ulid } from '@/lib/ulid';
import { useUsers } from '@/lib/use-users';

import { FeedbackBanner } from '@/components/feedback/banner';
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';

const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
const labelClass = 'text-sm font-medium';
const selectClass = `${inputClass} appearance-none`;

/** The four coarse roles (spec 1.5) — surfaced verbatim. */
const ROLE_OPTIONS: readonly UserRole[] = ['operator', 'accountant', 'ops_manager', 'owner'];

const ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  owner: 'Owner',
  ops_manager: 'Ops Manager',
  operator: 'Operator',
  accountant: 'Accountant',
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
  const session = readSession();
  const [outcome, setOutcome] = useState<Outcome>(null);
  // The invite response's one-time link, kept visible until the next action.
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const canInvite = roleHasCapability(session?.user.role, 'users.invite');
  const canChangeRole = roleHasCapability(session?.user.role, 'users.role_change');

  const columns: readonly DataTableColumn<UserResponse>[] = [
    { key: 'email', header: 'Email' },
    {
      key: 'role',
      header: 'Role',
      render: (user) =>
        canChangeRole ? <RoleSelect user={user} onDone={setOutcome} users={users} /> : (
          <span>{ROLE_LABELS[user.role]}</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (user) =>
        user.status === 'invited' ? (
          <span className="rounded-full border border-(--border) bg-(--muted) px-2 py-0.5 text-xs text-(--muted-foreground)">
            Invited
          </span>
        ) : (
          <span className="rounded-full border border-(--accent) px-2 py-0.5 text-xs text-(--accent-foreground)">
            Active
          </span>
        ),
    },
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
function InviteForm({ onInvited }: { onInvited: (link: string) => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('operator');
  const [pending, setPending] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const session = readSession();
    if (session === null) return;
    setPending(true);
    setRejection(null);
    try {
      const invited = await fetchApiInviteUser(session.tenant.id, { email, role }, ulid());
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
            {ROLE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {ROLE_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
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
      const updated = await fetchApiSetUserRole(session.tenant.id, user.id, { role: role as UserRole }, ulid());
      onDone({
        tone: 'accepted',
        word: `${updated.email} is now ${ROLE_LABELS[updated.role]}`,
        reason:
          updated.role === 'owner'
            ? 'Owners can manage users — invite, change roles, and demote everyone but the last Owner.'
            : 'The change applies on their next action — no re-login needed.',
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
        return 'The last Owner cannot be demoted — invite another Owner first.';
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
      default:
        return error.detail ?? `Request failed (${error.code}).`;
    }
  }
  return 'The API is unreachable — is wms-be running?';
}