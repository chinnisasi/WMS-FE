'use client';

import { useEffect, useId, useState } from 'react';

import { downloadText } from '@/lib/csv';
import { backupCodesText } from '@/lib/second-factor';

const buttonClass = 'rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted)';
const primaryClass =
  'rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60';

/**
 * Story 6-1b — the ten backup codes, shown once: at enrolment (sign-in) and
 * on My account → Security. Copy and Download (`downloadText`); Continue
 * stays disabled until the real, labelled "I've saved these codes" checkbox
 * is ticked, and leaving the page before that asks first (`beforeunload`).
 * The caller writes nothing (at sign-in: not even the session) until
 * `onContinue` — a reload before it would otherwise lose the codes.
 */
export function BackupCodesPanel({
  codes,
  label,
  onContinue,
  continueLabel = 'Continue',
}: {
  codes: readonly string[];
  /** Whose codes — the account email — printed in the copied / downloaded text. */
  label: string;
  onContinue: () => void;
  continueLabel?: string;
}) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const checkboxId = useId();

  useEffect(() => {
    if (saved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers need a returnValue to prompt.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saved]);

  const text = backupCodesText(codes, label);

  return (
    <section aria-label="Backup codes" className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium">Save your backup codes</h2>
        <p className="text-(--muted-foreground)">
          If you lose your phone, each of these codes signs you in once. This is the only time they are shown.
        </p>
      </div>
      <ol data-testid="backup-codes" className="data grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          Copy
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => downloadText('wms-backup-codes.txt', text, 'text/plain;charset=utf-8')}
        >
          Download
        </button>
        <span aria-live="polite" className="text-xs text-(--muted-foreground)">
          {copied ? 'Copied' : ''}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input id={checkboxId} type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
        <label htmlFor={checkboxId}>I&apos;ve saved these codes</label>
      </div>
      <button type="button" className={`${primaryClass} self-start`} disabled={!saved} onClick={onContinue}>
        {continueLabel}
      </button>
    </section>
  );
}
