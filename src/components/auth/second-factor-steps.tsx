'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { ApiProblem, fetchApiSecondFactor } from '@/lib/api/client';
import type { EnrollChallengeResponse, SecondFactorSignInResponse, TotpChallengeResponse } from '@/lib/api/generated';
import {
  expiresInLabel,
  groupSecret,
  normaliseBackupInput,
  normaliseTotpInput,
  secondFactorReason,
} from '@/lib/second-factor';

import { FeedbackBanner } from '@/components/feedback/banner';
import { QrCode } from '@/components/auth/qr-code';

const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
const labelClass = 'text-sm font-medium';
const primaryClass =
  'rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60';
const linkButtonClass = 'self-start text-sm text-(--primary) underline underline-offset-2';

/** A ticking "now", for an expiry countdown. */
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Ends the step on the client at its expiry (the server would answer `challenge-ended` anyway). */
function useExpiry(expiresAt: number, onEnded: () => void): void {
  const ended = useRef(onEnded);
  useEffect(() => {
    ended.current = onEnded;
  });
  useEffect(() => {
    const timer = setTimeout(() => ended.current(), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt]);
}

interface StepProps {
  /** Unix ms — when the challenge ends on the client. */
  readonly expiresAt: number;
  readonly onSession: (body: SecondFactorSignInResponse) => void;
  /** The challenge is over (expired here, or `challenge-ended` from the server): back to the password. */
  readonly onEnded: () => void;
}

/**
 * Story 6-1b — the code step: a 6-digit code from the authenticator app, or
 * ("Use a backup code") one of the backup codes.
 */
export function SecondFactorStep({ challenge, expiresAt, onSession, onEnded }: StepProps & { challenge: TotpChallengeResponse }) {
  const [useBackup, setUseBackup] = useState(false);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const inFlight = useRef(false);
  useExpiry(expiresAt, onEnded);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const normalised = useBackup ? normaliseBackupInput(code) : normaliseTotpInput(code);
    if (normalised === null) {
      setRejection(useBackup ? 'A backup code is 10 letters and digits, like ABCDE-FGH23.' : 'Enter the 6-digit code from your authenticator app.');
      return;
    }
    inFlight.current = true;
    setPending(true);
    setRejection(null);
    try {
      onSession(await fetchApiSecondFactor({ challengeToken: challenge.challengeToken, code: normalised }));
    } catch (error) {
      if (error instanceof ApiProblem && error.code === 'challenge-ended') {
        onEnded();
        return;
      }
      setCode('');
      setRejection(secondFactorReason(error));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {useBackup ? (
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Backup code</span>
          <input
            key="backup"
            className={`${inputClass} font-mono`}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            autoFocus
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={20}
            placeholder="ABCDE-FGH23"
          />
        </label>
      ) : (
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Authenticator code</span>
          <input
            key="totp"
            className={`${inputClass} font-mono tracking-widest`}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\s+/g, ''))}
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            pattern="[0-9]{6}"
            placeholder="123456"
          />
        </label>
      )}
      <button
        type="button"
        className={linkButtonClass}
        onClick={() => {
          setUseBackup((value) => !value);
          setCode('');
          setRejection(null);
        }}
      >
        {useBackup ? 'Use the authenticator app' : 'Use a backup code'}
      </button>
      {rejection !== null && <FeedbackBanner tone="rejected" word="Not signed in" reason={rejection} />}
      <button type="submit" disabled={pending} className={primaryClass}>
        {pending ? 'Checking…' : 'Verify'}
      </button>
    </form>
  );
}

/**
 * Story 6-1b — the enrolment step (an owner who has not set up two-factor
 * sign-in): the QR code, the secret in groups of four with Copy, the time
 * left, the enrolment code when an owner's reset requires it, then a code
 * from the newly set-up app.
 */
export function EnrollStep({ challenge, expiresAt, onSession, onEnded }: StepProps & { challenge: EnrollChallengeResponse }) {
  const [code, setCode] = useState('');
  const [enrolmentCode, setEnrolmentCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const inFlight = useRef(false);
  const secretId = useId();
  const now = useNow();
  useExpiry(expiresAt, onEnded);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const normalised = normaliseTotpInput(code);
    if (normalised === null) {
      setRejection('Enter the 6-digit code your authenticator app now shows.');
      return;
    }
    inFlight.current = true;
    setPending(true);
    setRejection(null);
    try {
      onSession(
        await fetchApiSecondFactor({
          challengeToken: challenge.challengeToken,
          code: normalised,
          ...(challenge.enrolmentCodeRequired ? { enrolmentCode: enrolmentCode.trim() } : {}),
        }),
      );
    } catch (error) {
      if (error instanceof ApiProblem && error.code === 'challenge-ended') {
        onEnded();
        return;
      }
      setCode('');
      setRejection(secondFactorReason(error));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-(--muted-foreground)">
        Owners sign in with a code from an authenticator app. Scan this QR code with the app (Google Authenticator,
        Microsoft Authenticator, 1Password and others), or type the key.
      </p>
      <div className="flex justify-center">
        <QrCode value={challenge.otpauthUri} label="QR code to add this account to your authenticator app" />
      </div>
      <div className="flex flex-col gap-1">
        <span id={secretId} className={labelClass}>
          Key
        </span>
        <div className="flex items-center gap-2">
          <code aria-labelledby={secretId} className="data rounded-sm bg-(--muted) px-2 py-1 font-mono text-sm">
            {groupSecret(challenge.secret)}
          </code>
          <button
            type="button"
            className="rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted)"
            onClick={() => {
              void navigator.clipboard?.writeText(challenge.secret).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            Copy
          </button>
          <span aria-live="polite" className="text-xs text-(--muted-foreground)">
            {copied ? 'Copied' : ''}
          </span>
        </div>
      </div>
      <p className="text-xs text-(--muted-foreground)">{expiresInLabel(expiresAt - now)}</p>
      {challenge.enrolmentCodeRequired && (
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Enrolment code</span>
          <input
            className={`${inputClass} font-mono`}
            value={enrolmentCode}
            onChange={(e) => setEnrolmentCode(e.target.value)}
            required
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={20}
          />
          <span className="text-xs text-(--muted-foreground)">
            An owner reset your two-factor sign-in — enter the code they gave you.
          </span>
        </label>
      )}
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
          pattern="[0-9]{6}"
          placeholder="123456"
        />
      </label>
      {rejection !== null && <FeedbackBanner tone="rejected" word="Not set up" reason={rejection} />}
      <button type="submit" disabled={pending} className={primaryClass}>
        {pending ? 'Checking…' : 'Set up and sign in'}
      </button>
    </form>
  );
}
