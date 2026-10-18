'use client';

import { useRef, useState, useSyncExternalStore } from 'react';

import {
  fetchApiSecondFactorBackupCodes,
  fetchApiSecondFactorConfirm,
  fetchApiSecondFactorDisable,
  fetchApiSecondFactorSetup,
} from '@/lib/api/client';
import type { SecondFactorSetupResponse, SecondFactorStatusResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import {
  backupCodesWarning,
  groupSecret,
  normaliseBackupInput,
  normaliseTotpInput,
  secondFactorReason,
} from '@/lib/second-factor';
import { useSecondFactorStatus } from '@/lib/use-second-factor';

import { BackupCodesPanel } from '@/components/auth/backup-codes-panel';
import { QrCode } from '@/components/auth/qr-code';
import { FeedbackBanner } from '@/components/feedback/banner';
import { buttonClass, inputClass, labelClass, primaryClass, ReadFailure, Section } from '@/components/shared/surface';

/** What the Security card is doing. */
type Mode =
  | { readonly kind: 'idle' }
  /** Proving it is you before a change: the password (2FA off) or a current code (2FA on). */
  | { readonly kind: 'prove'; readonly action: 'setup' | 'backup-codes' | 'disable' }
  | { readonly kind: 'scan'; readonly setup: SecondFactorSetupResponse }
  | { readonly kind: 'codes'; readonly codes: readonly string[] };

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

/**
 * Story 6-1b — My account → Security. Turn on / replace runs: proof (the
 * password when off, a current code when on) → the QR code → a code from the
 * new app → the backup codes panel. A wrong code is a 422 here — the session
 * stays. Turn off is hidden when the role requires two-factor sign-in.
 */
export function SecurityView() {
  const email = useSyncExternalStore(subscribeSession, () => readSession()?.user.email ?? null, () => null);
  const status = useSecondFactorStatus();
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [outcome, setOutcome] = useState<Outcome>(null);

  if (status.state === 'loading') {
    return (
      <Section title="Two-factor sign-in">
        <p className="text-(--muted-foreground)">Loading…</p>
      </Section>
    );
  }
  if (status.state === 'failed') {
    return (
      <Section title="Two-factor sign-in">
        <ReadFailure word="Not loaded" reason={status.reason} onRetry={status.reload} />
      </Section>
    );
  }
  const current = status.data;
  const done = (next: Outcome) => {
    setOutcome(next);
    setMode({ kind: 'idle' });
    status.reload();
  };

  return (
    <Section title="Two-factor sign-in">
      <StatusLine status={current} />
      {mode.kind === 'idle' && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={primaryClass}
            onClick={() => {
              setOutcome(null);
              setMode({ kind: 'prove', action: 'setup' });
            }}
          >
            {current.enabled ? 'Replace authenticator' : 'Turn on'}
          </button>
          {current.enabled && (
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                setOutcome(null);
                setMode({ kind: 'prove', action: 'backup-codes' });
              }}
            >
              New backup codes
            </button>
          )}
          {current.enabled && !current.required && (
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                setOutcome(null);
                setMode({ kind: 'prove', action: 'disable' });
              }}
            >
              Turn off
            </button>
          )}
        </div>
      )}
      {mode.kind === 'prove' && (
        <ProofForm
          action={mode.action}
          enabled={current.enabled}
          onCancel={() => setMode({ kind: 'idle' })}
          onSetup={(setup) => setMode({ kind: 'scan', setup })}
          onCodes={(codes) => setMode({ kind: 'codes', codes })}
          onDisabled={() => done({ tone: 'accepted', word: 'Two-factor sign-in is off', reason: 'Your other signed-in browsers were signed out.' })}
        />
      )}
      {mode.kind === 'scan' && (
        <ScanForm setup={mode.setup} onCancel={() => setMode({ kind: 'idle' })} onCodes={(codes) => setMode({ kind: 'codes', codes })} />
      )}
      {mode.kind === 'codes' && (
        <BackupCodesPanel
          codes={mode.codes}
          label={email ?? 'your account'}
          continueLabel="Done"
          onContinue={() => done({ tone: 'accepted', word: 'Saved', reason: 'Your two-factor sign-in is up to date.' })}
        />
      )}
      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}
    </Section>
  );
}

function StatusLine({ status }: { status: SecondFactorStatusResponse }) {
  const warning = status.enabled ? backupCodesWarning(status.backupCodesRemaining) : null;
  return (
    <div className="flex flex-col gap-2">
      <p>
        {status.enabled ? (
          <>
            <span className="font-medium">On</span>
            {status.enabledAt !== null && <> since {new Date(status.enabledAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</>}
            {' · '}
            {status.backupCodesRemaining} backup {status.backupCodesRemaining === 1 ? 'code' : 'codes'} left
          </>
        ) : (
          <span className="font-medium">Off</span>
        )}
      </p>
      {status.required && <p className="text-(--muted-foreground)">Owners must use two-factor sign-in.</p>}
      {warning !== null && <FeedbackBanner tone="warning" word="Backup codes" reason={warning} />}
    </div>
  );
}

/** The proof a change needs: the password (2FA off, setup only) or a current code / backup code. */
function ProofForm({
  action,
  enabled,
  onCancel,
  onSetup,
  onCodes,
  onDisabled,
}: {
  action: 'setup' | 'backup-codes' | 'disable';
  enabled: boolean;
  onCancel: () => void;
  onSetup: (setup: SecondFactorSetupResponse) => void;
  onCodes: (codes: readonly string[]) => void;
  onDisabled: () => void;
}) {
  const usePassword = action === 'setup' && !enabled;
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const session = readSession();
    if (session === null || inFlight.current) return;
    let proof = value;
    if (!usePassword) {
      const code = normaliseTotpInput(value) ?? normaliseBackupInput(value);
      if (code === null) {
        setRejection('Enter the 6-digit code from your authenticator app, or a backup code.');
        return;
      }
      proof = code;
    }
    inFlight.current = true;
    setPending(true);
    setRejection(null);
    try {
      const tenantId = session.tenant.id;
      if (action === 'setup') {
        onSetup(await fetchApiSecondFactorSetup(tenantId, usePassword ? { password: proof } : { code: proof }));
      } else if (action === 'backup-codes') {
        onCodes((await fetchApiSecondFactorBackupCodes(tenantId, proof)).backupCodes);
      } else {
        await fetchApiSecondFactorDisable(tenantId, proof);
        onDisabled();
      }
    } catch (error) {
      setValue('');
      setRejection(secondFactorReason(error));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const verb = action === 'setup' ? 'Continue' : action === 'backup-codes' ? 'Create new codes' : 'Turn off';
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-sm border border-(--border) p-3">
      {usePassword ? (
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Current password</span>
          <input
            className={inputClass}
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            autoFocus
            autoComplete="current-password"
          />
        </label>
      ) : (
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Code from your authenticator app, or a backup code</span>
          <input
            className={`${inputClass} font-mono`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            autoFocus
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={20}
          />
        </label>
      )}
      {action === 'backup-codes' && <p className="text-xs text-(--muted-foreground)">Your old backup codes stop working.</p>}
      {action === 'disable' && <p className="text-xs text-(--muted-foreground)">Your password alone will sign you in again.</p>}
      {rejection !== null && <FeedbackBanner tone="rejected" word="Not changed" reason={rejection} />}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={primaryClass}>
          {pending ? 'Checking…' : verb}
        </button>
        <button type="button" className={buttonClass} disabled={pending} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The new authenticator: scan, then confirm with a code from it. */
function ScanForm({
  setup,
  onCancel,
  onCodes,
}: {
  setup: SecondFactorSetupResponse;
  onCancel: () => void;
  onCodes: (codes: readonly string[]) => void;
}) {
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const session = readSession();
    const normalised = normaliseTotpInput(code);
    if (session === null || inFlight.current) return;
    if (normalised === null) {
      setRejection('Enter the 6-digit code your authenticator app now shows.');
      return;
    }
    inFlight.current = true;
    setPending(true);
    setRejection(null);
    try {
      onCodes((await fetchApiSecondFactorConfirm(session.tenant.id, normalised)).backupCodes);
    } catch (error) {
      setCode('');
      setRejection(secondFactorReason(error));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-sm border border-(--border) p-3">
      <p className="text-(--muted-foreground)">Scan this with your authenticator app, or type the key.</p>
      <QrCode value={setup.otpauthUri} label="QR code to add this account to your authenticator app" />
      <code className="data self-start rounded-sm bg-(--muted) px-2 py-1 font-mono">{groupSecret(setup.secret)}</code>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Code from the app</span>
        <input
          className={`${inputClass} font-mono tracking-widest`}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\s+/g, ''))}
          required
          autoFocus
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
        />
      </label>
      {rejection !== null && <FeedbackBanner tone="rejected" word="Not set up" reason={rejection} />}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={primaryClass}>
          {pending ? 'Checking…' : 'Confirm'}
        </button>
        <button type="button" className={buttonClass} disabled={pending} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
