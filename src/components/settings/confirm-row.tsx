'use client';

import { useRef, useState, type ReactNode } from 'react';

import { readSession } from '@/lib/auth';
import { ulid } from '@/lib/ulid';

const rowButtonClass =
  'rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40';
const primaryButtonClass =
  'rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-40';

/**
 * A one-question confirmation row for a Settings row action (extracted from
 * the rate cards card in story 21-10; the clients card's suspend and
 * reactivate use it too).
 *
 * The Idempotency-Key is **per confirmation**: the caller mounts one
 * `ConfirmRow` per confirmation, keyed by action and target (e.g.
 * `` `${action}-${id}` ``), so the key minted on the first press
 * (`keyRef.current ??= ulid()`) is reused by every retry of it, and a new
 * confirmation — another action, another row, or the same action after this
 * one succeeded and unmounted — mints a fresh key. A synchronous `inFlight`
 * ref, not state, guards a pre-render double-click.
 *
 * `run(key, tenantId)` performs the request and resolves with whatever `onDone`
 * needs; a thrown error is worded by `reason(error)` and handed to
 * `onRejected`.
 *
 * Story 1-2a — an optional `detail(error)`: a refusal that carries structured
 * content a string cannot (the departure's blocker list) renders it here,
 * under the confirmation, in a `role="alert"` region, and the row stays open
 * for a retry (`onRejected` is not called for it). `null` falls back to
 * `onRejected`.
 */
export function ConfirmRow<T>({
  question,
  confirmLabel,
  ariaLabel,
  run,
  reason,
  onDone,
  onRejected,
  onClose,
  keepLabel = 'Keep',
  detail,
}: {
  question: string;
  confirmLabel: string;
  ariaLabel: string;
  /** The request — the key first; the signed-in tenant is passed for convenience. */
  run: (idempotencyKey: string, tenantId: string) => Promise<T>;
  reason: (error: unknown) => string;
  onDone: (result: T) => void;
  onRejected: (reason: string) => void;
  onClose: () => void;
  keepLabel?: string;
  detail?: (error: unknown) => ReactNode | null;
}) {
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<ReactNode | null>(null);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  async function confirm() {
    if (inFlight.current) return;
    const session = readSession();
    if (session === null) return;
    inFlight.current = true;
    setBusy(true);
    keyRef.current ??= ulid();
    setShown(null);
    try {
      const result = await run(keyRef.current, session.tenant.id);
      onDone(result);
    } catch (error) {
      const structured = detail === undefined ? null : detail(error);
      if (structured !== null) {
        setShown(structured);
      } else {
        onRejected(reason(error));
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap items-center gap-2">
      <span>{question}</span>
      <button type="button" disabled={busy} onClick={confirm} className={primaryButtonClass}>
        {confirmLabel}
      </button>
      {/* Disabled in flight: a "Keep" pressed now would not stop a request that still lands. */}
      <button type="button" disabled={busy} onClick={onClose} className={rowButtonClass}>
        {keepLabel}
      </button>
      {shown !== null ? (
        <div role="alert" className="w-full text-sm">
          {shown}
        </div>
      ) : null}
    </div>
  );
}
