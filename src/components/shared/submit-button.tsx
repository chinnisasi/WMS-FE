import { primaryClass } from '@/components/shared/surface';

/**
 * Story UI-2 (UI-PATTERNS §4, W10) — the submit button that pairs with
 * `useKeyedSubmit`: it says what it does ("Create counts", never "Submit"),
 * reads "Creating…" and is disabled while the command is in flight, and
 * carries the reason it is disabled when it is not ready (a disabled control
 * says why — §10 item 9). Portal-allowed: no hook.
 */
export function SubmitButton({
  busy,
  ready = true,
  label,
  busyLabel,
  notReadyReason,
  className = primaryClass,
}: {
  readonly busy: boolean;
  readonly ready?: boolean;
  readonly label: string;
  readonly busyLabel: string;
  /** Why the draft cannot be sent yet — the button's description while it is disabled for that reason. */
  readonly notReadyReason?: string;
  readonly className?: string;
}) {
  const blocked = !ready && !busy && notReadyReason !== undefined;
  return (
    <button
      type="submit"
      className={className}
      disabled={busy || !ready}
      aria-busy={busy ? 'true' : undefined}
      title={blocked ? notReadyReason : undefined}
    >
      {busy ? busyLabel : label}
      {blocked && <span className="sr-only"> — {notReadyReason}</span>}
    </button>
  );
}
