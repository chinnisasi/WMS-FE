'use client';

import { useState, useSyncExternalStore } from 'react';

import { ApiProblem, fetchApiDeviceAction, fetchApiMintEnrollmentCode, fetchApiRevokeDevice } from '@/lib/api/client';
import type { DeviceResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';
import { useDevices } from '@/lib/use-devices';

import { FeedbackBanner } from '@/components/feedback/banner';
import { ConfirmRow } from '@/components/settings/confirm-row';
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { StatusChip } from '@/components/shared/status-chip';

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

/**
 * Device enrollment (story 3.2), a Settings sub-card: the tenant's floor
 * devices (label, operator, enrolled/last-seen, status), the one-time
 * enrollment-code mint, and the revoke action (wipe-flagged, effective on
 * the device's next request). The list is a read — open to every tenant
 * member; the mint and revoke controls render only for roles holding
 * `device.manage` (the backend's DB-read authority still gates every
 * command).
 */
export function DevicesCard() {
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
        <div className="font-medium">Devices</div>
        <div className="text-(--muted-foreground)">Sign in to see your floor devices.</div>
      </div>
    );
  }
  return <DevicesCardSessioned />;
}

function DevicesCardSessioned() {
  const devices = useDevices();
  const session = readSession();
  // The role through the session subscription (frontend guide), not a bare render-time read.
  const role = useSyncExternalStore(subscribeSession, () => readSession()?.user.role, () => undefined);
  // Story 6-1a — which row's Release / Unlock confirmation is open.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  // The minted one-time code, kept visible until the next action.
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);

  const canManage = roleHasCapability(role, 'device.manage');

  const columns: readonly DataTableColumn<DeviceResponse>[] = [
    // Story UI-2 (A4) — client-side sort; offered only while the page is the whole list.
    { key: 'label', header: 'Device', sortValue: (d) => d.label, render: (d) => d.label ?? '—' },
    {
      key: 'operator',
      header: 'Operator',
      sortValue: (d) => d.operatorEmail,
      render: (d) => d.operatorEmail ?? 'Not badged in yet',
    },
    {
      key: 'enrolled',
      header: 'Enrolled',
      render: (d) =>
        d.enrolledAt === null ? (
          '—'
        ) : (
          <time dateTime={d.enrolledAt}>{new Date(d.enrolledAt).toLocaleString()}</time>
        ),
    },
    {
      key: 'lastSeen',
      header: 'Last seen',
      sortValue: (d) => d.lastSeenAt,
      render: (d) =>
        d.lastSeenAt === null ? (
          '—'
        ) : (
          <time dateTime={d.lastSeenAt}>{new Date(d.lastSeenAt).toLocaleString()}</time>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (d) =>
        d.status === 'revoked' ? (
          <StatusChip tone="danger">Revoked · wipe flagged</StatusChip>
        ) : (
          <span className="flex flex-wrap gap-1">
            <StatusChip tone="success">Active</StatusChip>
            {badgeLocked(d) && (
              <StatusChip tone="warning">Badge-in locked</StatusChip>
            )}
          </span>
        ),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            render: (d: DeviceResponse) =>
              d.status === 'active' ? (
                <DeviceActions
                  device={d}
                  confirming={confirming}
                  setConfirming={setConfirming}
                  onDone={(next) => {
                    setOutcome(next);
                    devices?.reload();
                  }}
                  revoke={<RevokeButton device={d} onDone={setOutcome} devices={devices} />}
                />
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">Device enrollment</h2>
        <div className="text-(--muted-foreground)">
          Floor devices scan against your warehouse. Enrolling binds a device to this tenant; a
          revoked device is locked out on its next request and flagged for data wipe.
        </div>
      </div>

      {canManage && (
        <MintCodeForm
          onMinted={(minted) => {
            setCode(minted);
            setOutcome(null);
          }}
        />
      )}

      {code !== null && (
        <div className="flex flex-col gap-1 rounded-sm border border-(--border) bg-(--muted) p-2">
          <div className="text-xs font-medium">
            One-time enrollment code (valid until{' '}
            {new Date(code.expiresAt).toLocaleTimeString()}):
          </div>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={code.code}
              onFocus={(e) => e.target.select()}
              className="w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 font-mono text-xs focus-visible:outline-2 focus-visible:outline-(--ring)"
            />
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(code.code).catch(() => undefined);
              }}
              className="shrink-0 rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted)"
            >
              Copy
            </button>
          </div>
          <div className="text-xs font-medium">Tenant id (the device app asks for it too):</div>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={session?.tenant.id ?? ''}
              onFocus={(e) => e.target.select()}
              className="w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 font-mono text-xs focus-visible:outline-2 focus-visible:outline-(--ring)"
            />
            <button
              type="button"
              onClick={() => {
                if (session === null) return;
                void navigator.clipboard?.writeText(session.tenant.id).catch(() => undefined);
              }}
              className="shrink-0 rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted)"
            >
              Copy
            </button>
          </div>
          <div className="text-xs text-(--muted-foreground)">
            Enter the tenant id and the code once in the device app — the code works a single
            time, then expires.
          </div>
        </div>
      )}

      <DataTable<DeviceResponse>
        columns={columns}
        rows={devices?.items ?? []}
        nextCursor={devices?.nextCursor ?? null}
        onCursor={devices?.onCursor}
        emptyMessage="No devices yet — mint an enrollment code above to add your first scanner."
      />

      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}
    </section>
  );
}

/** The mint form: one click, fresh ULID key per mint. */
/** Story 6-1a — a badge-in lock still in the future (words, not colour alone). */
export function badgeLocked(device: Pick<DeviceResponse, 'badgeLockedUntil'>, now = Date.now()): boolean {
  return typeof device.badgeLockedUntil === 'string' && Date.parse(device.badgeLockedUntil) > now;
}

const rowButtonClass = 'rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40';

/**
 * Story 6-1a — Release device (an operator left with the device still badged
 * in: frees it for the next operator; their queued scans go to review) and
 * Unlock (5 wrong PINs). Each behind a confirmation.
 */
function DeviceActions({
  device,
  confirming,
  setConfirming,
  onDone,
  revoke,
}: {
  device: DeviceResponse;
  confirming: string | null;
  setConfirming: (value: string | null) => void;
  onDone: (outcome: Outcome) => void;
  revoke: React.ReactNode;
}) {
  const label = device.label ?? 'this device';
  const close = () => setConfirming(null);
  for (const action of ['release', 'unlock'] as const) {
    if (confirming === `${action}-${device.id}`) {
      return (
        <ConfirmRow
          key={`${action}-${device.id}`}
          question={
            action === 'release'
              ? `Release ${label}? ${device.operatorEmail ?? 'The operator'} is badged out; scans still queued on it go to review under their name.`
              : `Unlock badge-in on ${label}?`
          }
          confirmLabel={action === 'release' ? 'Release' : 'Unlock'}
          ariaLabel={`Confirm ${action} for ${label}`}
          run={(key, tenantId) => fetchApiDeviceAction(tenantId, device.id, action, key)}
          reason={rejectionReason}
          onDone={() => {
            close();
            onDone(
              action === 'release'
                ? { tone: 'accepted', word: `${label} released`, reason: 'Another operator can badge in on it now.' }
                : { tone: 'accepted', word: `${label} unlocked`, reason: 'Operators can badge in again.' },
            );
          }}
          onRejected={(reason) => {
            close();
            onDone({ tone: 'rejected', word: action === 'release' ? 'Not released' : 'Not unlocked', reason });
          }}
          onClose={close}
        />
      );
    }
  }
  return (
    <span className="flex flex-wrap gap-1">
      {badgeLocked(device) && (
        <button type="button" className={rowButtonClass} onClick={() => setConfirming(`unlock-${device.id}`)}>
          Unlock
        </button>
      )}
      {device.operatorUserId !== null && (
        <button type="button" className={rowButtonClass} onClick={() => setConfirming(`release-${device.id}`)}>
          Release device
        </button>
      )}
      {revoke}
    </span>
  );
}

function MintCodeForm({ onMinted }: { onMinted: (minted: { code: string; expiresAt: string }) => void }) {
  const [pending, setPending] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const session = readSession();
    if (session === null) return;
    setPending(true);
    setRejection(null);
    try {
      const minted = await fetchApiMintEnrollmentCode(session.tenant.id, ulid());
      onMinted({ code: minted.code, expiresAt: minted.expiresAt });
    } catch (error) {
      setRejection(rejectionReason(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-sm border border-(--border) p-3">
      <div className="text-xs text-(--muted-foreground)">
        Mint a one-time enrollment code for a device app, then enter it on the device within 15
        minutes.
      </div>
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60"
      >
        {pending ? 'Minting…' : 'Mint enrollment code'}
      </button>
      {rejection !== null && <FeedbackBanner tone="rejected" word="Not minted" reason={rejection} />}
    </form>
  );
}

/** The revoke action: one click, confirmation included (wipe-flagged server-side). */
function RevokeButton({
  device,
  onDone,
  devices,
}: {
  device: DeviceResponse;
  onDone: (outcome: Outcome) => void;
  devices: ReturnType<typeof useDevices>;
}) {
  const [pending, setPending] = useState(false);

  async function onClick() {
    const session = readSession();
    if (session === null) return;
    if (
      !window.confirm(
        `Revoke ${device.label ?? 'this device'}? Its queued work is quarantined and its data is wipe-flagged.`,
      )
    ) {
      return;
    }
    setPending(true);
    try {
      await fetchApiRevokeDevice(session.tenant.id, device.id, ulid());
      onDone({
        tone: 'accepted',
        word: `${device.label ?? 'Device'} revoked`,
        reason: 'The device is locked out on its next request and flagged for data wipe.',
      });
      devices?.reload();
    } catch (error) {
      onDone({ tone: 'rejected', word: 'Not revoked', reason: rejectionReason(error) });
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={pending}
      className="rounded-sm border border-(--destructive) px-2 py-1 text-xs text-(--destructive) hover:bg-(--muted) disabled:opacity-60"
    >
      {pending ? 'Revoking…' : 'Revoke'}
    </button>
  );
}

/**
 * Clients branch on the machine-readable problem `code`, never on prose.
 */
function rejectionReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'role-denied':
        return error.detail ?? 'Your role does not allow managing devices.';
      case 'not-found':
        return 'That device no longer exists — refresh the page.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `Request failed (${error.code}).`;
    }
  }
  return 'The API is unreachable — is wms-be running?';
}