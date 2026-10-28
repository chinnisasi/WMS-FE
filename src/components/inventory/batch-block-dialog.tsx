'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { fetchApiBlockBatch, fetchApiUnblockBatch } from '@/lib/api/client';
import type { BatchBlockResponse } from '@/lib/api/generated';
import { readSession } from '@/lib/auth';
import {
  BATCH_BLOCK_NOTE_MAX,
  BATCH_BLOCK_REASONS,
  BATCH_BLOCK_REASON_LABEL,
  OPEN_A_RECALL_NUDGE,
  batchBlockReason,
  batchRecallCode,
  batchUnderRecallRefusal,
  underRecallSentence,
  batchBlockStale,
  batchLifecycleLabel,
  parseBlockDraft,
  parseUnblockDraft,
  type BatchBlockReason,
  type BatchLifecycleFacts,
} from '@/lib/batch-block';
import { recallHref } from '@/lib/recalls';
import { ulid } from '@/lib/ulid';

import { FeedbackBanner } from '@/components/feedback/banner';
import { buttonClass, inputClass } from '@/components/shared/surface';

/**
 * Story 3-3a — the Block / Unblock dialog of one batch (`qc.manage`). Block
 * takes a reason (`other` needs a note) and an optional note; Unblock always
 * takes a note. A block is lot-wide — every warehouse — and never moves stock:
 * the units stay on hand and stop being promised or default-drawn. The key is
 * per DRAFT (reused on a retry of the same body, a new one after any edit);
 * a pre-render double click is a no-op (the synchronous ref guard). Esc closes.
 */
export function BatchBlockDialog({
  mode,
  batch,
  onClose,
  onDone,
  onStale,
}: {
  mode: 'block' | 'unblock';
  batch: { readonly id: string; readonly code: string } & BatchLifecycleFacts;
  onClose: () => void;
  onDone: (response: BatchBlockResponse) => void;
  /** 409 `batch-already-blocked` / `batch-not-blocked`: the batch moved on — the parent re-reads and closes. */
  onStale: (reason: string) => void;
}) {
  const [reason, setReason] = useState<BatchBlockReason | ''>('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  // Story 3-7a (A4) — a 409 `batch-under-recall` names the recall to release it from.
  const [underRecall, setUnderRecall] = useState<{ code: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const knownRecall = batchRecallCode(batch);
  const recallBlocksUnblock = mode === 'unblock' && knownRecall !== null;
  const inFlight = useRef(false);
  const keyRef = useRef<{ key: string; body: string } | null>(null);
  const first = useRef<HTMLSelectElement | HTMLTextAreaElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Never while a request is in flight: closing would drop the draft's
      // key, and a retry under a fresh key after a lost response would read
      // as a false 409 (code review).
      if (event.key === 'Escape' && !inFlight.current) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** The focus trap: Tab and Shift+Tab cycle inside the dialog. */
  function trapTab(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab' || root.current === null) return;
    const focusable = [...root.current.querySelectorAll<HTMLElement>('select, textarea, input, button, [href], [tabindex]:not([tabindex="-1"])')].filter(
      (el) => !(el as HTMLButtonElement).disabled,
    );
    if (focusable.length === 0) return;
    const firstEl = focusable[0]!;
    const lastEl = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === firstEl || !root.current.contains(active))) {
      event.preventDefault();
      lastEl.focus();
    } else if (!event.shiftKey && (active === lastEl || !root.current.contains(active))) {
      event.preventDefault();
      firstEl.focus();
    }
  }

  useEffect(() => {
    first.current?.focus();
  }, []);

  async function submit() {
    const session = readSession();
    if (session === null) {
      setProblem('Your session expired — sign in again.');
      return;
    }
    if (inFlight.current || recallBlocksUnblock) return;
    const parsed = mode === 'block' ? parseBlockDraft({ reason, note }) : parseUnblockDraft(note);
    if (parsed.kind === 'refused') {
      setProblem(parsed.problem);
      return;
    }
    const body = JSON.stringify(parsed.body);
    if (keyRef.current === null || keyRef.current.body !== body) keyRef.current = { key: ulid(), body };
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const response =
        mode === 'block'
          ? await fetchApiBlockBatch(session.tenant.id, batch.id, parsed.body as Parameters<typeof fetchApiBlockBatch>[2], keyRef.current.key)
          : await fetchApiUnblockBatch(session.tenant.id, batch.id, parsed.body as Parameters<typeof fetchApiUnblockBatch>[2], keyRef.current.key);
      keyRef.current = null;
      onDone(response);
    } catch (error) {
      if (batchBlockStale(error)) {
        keyRef.current = null;
        onStale(batchBlockReason(error));
        return;
      }
      const recalled = batchUnderRecallRefusal(error);
      if (recalled !== false) {
        keyRef.current = null;
        setUnderRecall({ code: recalled });
        return;
      }
      setProblem(batchBlockReason(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const title = mode === 'block' ? `Block batch ${batch.code}` : `Unblock batch ${batch.code}`;
  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={trapTab}
      className="flex flex-col gap-3 rounded-sm border border-(--border) bg-(--muted) p-3 text-sm"
      data-testid="batch-block-dialog"
    >
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">
          {mode === 'block' ? 'Block' : 'Unblock'} batch <span className="font-mono">{batch.code}</span>
        </span>
        <span className="text-xs text-(--muted-foreground)">
          {mode === 'block'
            ? 'In every warehouse: the stock stays on hand but is no longer promised to orders or channels, and is not picked by default. Orders already reserved against it stand — those lines short at the wave. An explicit write-off can still remove it.'
            : `Now: ${batchLifecycleLabel(batch)}. Unblocking makes its unexpired stock promisable again.`}
        </span>
      </div>
      {recallBlocksUnblock && <UnderRecallNote code={knownRecall} blockedReason={batch.blockedReason} />}
      {mode === 'block' && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-(--muted-foreground)">Reason</span>
          <select
            ref={(el) => {
              first.current = el;
            }}
            aria-label="Block reason"
            className={inputClass}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value as BatchBlockReason | '');
              setProblem(null);
            }}
          >
            <option value="">Pick a reason…</option>
            {BATCH_BLOCK_REASONS.map((value) => (
              <option key={value} value={value}>
                {BATCH_BLOCK_REASON_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
      )}
      {mode === 'block' && reason === 'recall' && (
        // Story 3-7a (A4) — the standalone reason is kept; a recall document does more.
        <p className="text-xs" data-testid="open-a-recall-nudge">
          {OPEN_A_RECALL_NUDGE}{' '}
          <Link href={recallHref()} className="text-(--primary) underline underline-offset-2">
            Go to Recalls
          </Link>
        </p>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-xs text-(--muted-foreground)">
          {mode === 'block' ? 'Note (optional; required for Other)' : 'Note (required) — why the block is lifted'}
        </span>
        <textarea
          ref={(el) => {
            if (mode === 'unblock') first.current = el;
          }}
          aria-label={mode === 'block' ? 'Block note' : 'Unblock note'}
          className={inputClass}
          rows={2}
          maxLength={BATCH_BLOCK_NOTE_MAX * 2}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setProblem(null);
          }}
        />
      </label>
      {underRecall !== null && <UnderRecallNote code={underRecall.code} blockedReason={batch.blockedReason} />}
      {problem !== null && <FeedbackBanner tone="rejected" word={mode === 'block' ? 'Not blocked' : 'Not unblocked'} reason={problem} />}
      <div className="flex gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={busy || recallBlocksUnblock || underRecall !== null}
          title={recallBlocksUnblock ? `${underRecallSentence(knownRecall, batch.blockedReason)}.` : undefined}
          onClick={() => {
            void submit();
          }}
        >
          {busy ? (mode === 'block' ? 'Blocking…' : 'Unblocking…') : mode === 'block' ? 'Block batch' : 'Unblock batch'}
        </button>
        <button type="button" className={buttonClass} onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Story 3-7a (A4) — "Under recall RCL-x — release it from the recall", linked to that recall. */
export function UnderRecallNote({ code, blockedReason }: { readonly code: string | null; readonly blockedReason?: string | null }) {
  const releasable = blockedReason === undefined || blockedReason === null || blockedReason === 'recall';
  return (
    <p role="status" className="rounded-sm border border-(--warning) bg-(--warning)/10 px-2 py-1 text-xs" data-testid="under-recall-note">
      {underRecallSentence(code, blockedReason)}.{' '}
      <Link href={recallHref(code)} className="text-(--primary) underline underline-offset-2">
        {code === null ? 'Open Recalls' : `Open ${code}`}
      </Link>{' '}
      {releasable ? '— closing the recall with this lot released unblocks it.' : '— closing the recall leaves it blocked for its own reason.'}
    </p>
  );
}
