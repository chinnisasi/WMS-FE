'use client';

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { fetchApiBinBlockImpact, fetchApiBlockBin, fetchApiUnblockBin } from '@/lib/api/client';
import type { BinBlockImpactResponse, BinResponse } from '@/lib/api/generated';
import { readSession } from '@/lib/auth';
import {
  BIN_BLOCK_EFFECT,
  BIN_BLOCK_NOTE_MAX,
  BIN_BLOCK_REASONS,
  BIN_BLOCK_REASON_LABEL,
  binBlockByline,
  binBlockImpactClientLine,
  binBlockImpactReason,
  binBlockImpactSentence,
  binBlockReason,
  binBlockStale,
  binBlockedLabel,
  parseBinBlockDraft,
  parseBinUnblockDraft,
  type BinBlockReason,
} from '@/lib/bin-block';
import { ulid } from '@/lib/ulid';

import { FeedbackBanner } from '@/components/feedback/banner';
import { buttonClass, inputClass } from '@/components/shared/surface';

type ImpactState = { state: 'loading' } | { state: 'ready'; data: BinBlockImpactResponse } | { state: 'failed'; reason: string };

/**
 * Story 3-3b — the Block / Unblock dialog of one bin (`bin.block`). Block
 * takes a reason (`other` needs a note), an optional note, and shows the
 * impact preview (`GET …/block-impact` — advisory: a block is never refused
 * for open work, so a failed read still lets the block go ahead). Unblock
 * always takes a note. The key is per DRAFT — reused on a retry of the same
 * body, a new one after any edit; a pre-render double click is a no-op (the
 * synchronous ref guard); Esc closes, never while in flight (the 3-3a C5
 * rule: closing would drop the key, and a retry under a fresh one after a
 * lost response would read as a false 409).
 */
export function BinBlockDialog({
  mode,
  tenantId,
  warehouseId,
  bin,
  onClose,
  onDone,
  onStale,
}: {
  mode: 'block' | 'unblock';
  tenantId: string;
  warehouseId: string;
  bin: BinResponse;
  onClose: () => void;
  onDone: (response: BinResponse) => void;
  /** 409 `bin-already-blocked` / `bin-not-blocked` / `bin-retired`, or 404: the bin moved on — the parent re-reads and closes. */
  onStale: (reason: string) => void;
}) {
  const [reason, setReason] = useState<BinBlockReason | ''>('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [impact, setImpact] = useState<ImpactState>({ state: 'loading' });
  const [impactRevision, setImpactRevision] = useState(0);
  const inFlight = useRef(false);
  const keyRef = useRef<{ key: string; body: string } | null>(null);
  const first = useRef<HTMLSelectElement | HTMLTextAreaElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Only this dialog's own Escape: another open dialog (the labels panel) keeps its Esc.
      if (event.key === 'Escape' && !inFlight.current && root.current?.contains(document.activeElement)) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    first.current?.focus();
  }, []);

  // The impact preview — block only; the dialog is keyed per bin by its parent.
  useEffect(() => {
    if (mode !== 'block') return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchApiBinBlockImpact(tenantId, warehouseId, bin.id);
        if (!cancelled) setImpact({ state: 'ready', data });
      } catch (error) {
        if (!cancelled) setImpact({ state: 'failed', reason: binBlockImpactReason(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, tenantId, warehouseId, bin.id, impactRevision]);

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

  async function submit() {
    if (readSession() === null) {
      setProblem('Your session expired — sign in again.');
      return;
    }
    if (inFlight.current) return;
    const parsed = mode === 'block' ? parseBinBlockDraft({ reason, note }) : parseBinUnblockDraft(note);
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
          ? await fetchApiBlockBin(tenantId, warehouseId, bin.id, parsed.body as Parameters<typeof fetchApiBlockBin>[3], keyRef.current.key)
          : await fetchApiUnblockBin(tenantId, warehouseId, bin.id, parsed.body as Parameters<typeof fetchApiUnblockBin>[3], keyRef.current.key);
      keyRef.current = null;
      onDone(response);
    } catch (error) {
      if (binBlockStale(error)) {
        keyRef.current = null;
        onStale(binBlockReason(error));
        return;
      }
      setProblem(binBlockReason(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const title = mode === 'block' ? `Block bin ${bin.code}` : `Unblock bin ${bin.code}`;
  const byline = binBlockByline(bin);
  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={trapTab}
      className="flex flex-col gap-3 rounded-sm border border-(--border) bg-(--muted) p-3 text-sm"
      data-testid="bin-block-dialog"
    >
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">
          {mode === 'block' ? 'Block' : 'Unblock'} bin <span className="font-mono">{bin.code}</span>
        </span>
        <span className="text-xs text-(--muted-foreground)">
          {mode === 'block'
            ? BIN_BLOCK_EFFECT
            : `Now: ${binBlockedLabel(bin)}${byline === null ? '' : ` (${byline})`}. Unblocking makes its stock promisable again and lets it take putaway and picks.`}
        </span>
      </div>
      {mode === 'block' && (
        <div className="flex flex-col gap-1 rounded-sm border border-(--border) bg-(--background) p-2 text-xs" data-testid="bin-block-impact" role="status">
          {impact.state === 'loading' && <span className="text-(--muted-foreground)">Reading what this block would affect…</span>}
          {impact.state === 'failed' && (
            <span className="flex flex-wrap items-center gap-2">
              <span>{impact.reason} You can still block the bin.</span>
              <button
                type="button"
                className="rounded-sm border border-(--border) px-2 py-0.5 hover:bg-(--muted)"
                onClick={() => {
                  setImpact({ state: 'loading' });
                  setImpactRevision((r) => r + 1);
                }}
              >
                Retry
              </button>
            </span>
          )}
          {impact.state === 'ready' && (
            <>
              <span>{binBlockImpactSentence(impact.data)}</span>
              {impact.data.byClient.length > 0 && (
                <ul className="flex flex-col gap-0.5 pl-3" aria-label="Affected clients">
                  {impact.data.byClient.map((row) => (
                    <li key={row.clientId} className="data">
                      {binBlockImpactClientLine(row)}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
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
              setReason(e.target.value as BinBlockReason | '');
              setProblem(null);
            }}
          >
            <option value="">Pick a reason…</option>
            {BIN_BLOCK_REASONS.map((value) => (
              <option key={value} value={value}>
                {BIN_BLOCK_REASON_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
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
          maxLength={BIN_BLOCK_NOTE_MAX * 2}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setProblem(null);
          }}
        />
      </label>
      {problem !== null && <FeedbackBanner tone="rejected" word={mode === 'block' ? 'Not blocked' : 'Not unblocked'} reason={problem} />}
      <div className="flex gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={() => {
            void submit();
          }}
        >
          {busy ? (mode === 'block' ? 'Blocking…' : 'Unblocking…') : mode === 'block' ? 'Block bin' : 'Unblock bin'}
        </button>
        <button type="button" className={buttonClass} onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
