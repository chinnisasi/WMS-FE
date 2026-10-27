'use client';

import { useEffect, useRef, useState } from 'react';
import { readSession } from '@/lib/auth';
import { ApiProblem, fetchApiGetQcHold, fetchApiInspectQcHold } from '@/lib/api/client';
import type { InspectQcHoldResponse, QcHeldArmDto, QcHoldEntryDto, SkuResponse } from '@/lib/api/generated';
import { formatQuantity } from '@/lib/format-quantity';
import { qcReason } from '@/lib/over-receipt';
import {
  QC_FAIL_REASONS,
  QC_FAIL_REASON_LABEL,
  buildInspectBody,
  draftTotals,
  expiredPassWarning,
  failedOf,
  initialArmDraft,
  inspectionSummary,
  type InspectArmDraft,
  type QcFailReason,
} from '@/lib/qc-inspection';
import { ulid } from '@/lib/ulid';

const inputClass = 'w-24 rounded-sm border border-(--border) bg-(--background) px-2 py-1 text-sm';

/**
 * Story 2-8a — the Inspect dialog of an open QC hold: one row per batch arm
 * the hold moved (read from `GET …/qc-holds/{id}` — the held quantities are
 * the server's, never typed), Passed defaulting to the whole arm, Failed
 * computed, a reason when anything fails, an optional note (required for
 * Other), and the summary "N pass, M fail → DAMAGED". Passing an expired
 * batch warns and never blocks. The key is minted per click; a pre-render
 * double click is a no-op (the synchronous ref guard).
 */
export function QcInspectDialog({
  hold,
  sku,
  onClose,
  onInspected,
  onAlreadyClosed,
}: {
  hold: QcHoldEntryDto;
  sku: Pick<SkuResponse, 'code' | 'uom' | 'uomPrecision'> | null;
  onClose: () => void;
  onInspected: (response: InspectQcHoldResponse) => void;
  /** 409 `qc-hold-released`: the hold closed elsewhere (or by a lost first response) — close and reload. */
  onAlreadyClosed: () => void;
}) {
  const [arms, setArms] = useState<readonly QcHeldArmDto[] | null>(null);
  const [loadFailure, setLoadProblem] = useState<string | null>(null);
  // No session at mount: the detail read never runs — say so, never "Loading…" forever.
  const [noSession] = useState(() => readSession() === null);
  const loadProblem = noSession ? 'Your session expired — sign in again.' : loadFailure;
  const [drafts, setDrafts] = useState<readonly InspectArmDraft[]>([]);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  // One Idempotency-Key per DRAFT: a retry of the same body (a lost response)
  // replays; any edit to the body mints a new key.
  const keyRef = useRef<{ key: string; body: string } | null>(null);
  const firstInput = useRef<HTMLInputElement | null>(null);
  const focused = useRef(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!focused.current && firstInput.current !== null) {
      focused.current = true;
      firstInput.current.focus();
    }
  });

  useEffect(() => {
    const session = readSession();
    if (session === null) return;
    const controller = new AbortController();
    (async () => {
      try {
        const detail = await fetchApiGetQcHold(session.tenant.id, hold.id, controller.signal);
        if (controller.signal.aborted) return;
        if (detail.arms.length === 0) {
          setLoadProblem('This hold has no held stock to inspect.');
          return;
        }
        setArms(detail.arms);
        setDrafts(detail.arms.map((arm) => initialArmDraft(arm)));
      } catch (error) {
        if (!controller.signal.aborted) setLoadProblem(qcReason(error));
      }
    })();
    return () => controller.abort();
  }, [hold.id]);

  const unit = sku ?? { code: '(unknown SKU)', uom: 'units', uomPrecision: 3 };
  // The instant the expiry warning compares against — read once per dialog.
  const [nowMs] = useState(() => Date.now());
  const draft = arms === null ? null : buildInspectBody(arms, drafts, note, unit);
  const totals = arms === null ? null : draftTotals(arms, drafts);

  function setDraft(index: number, patch: Partial<InspectArmDraft>) {
    setDrafts((current) => current.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)));
    setProblem(null);
  }

  async function submit() {
    const session = readSession();
    if (session === null) {
      setProblem('Your session expired — sign in again.');
      return;
    }
    if (inFlight.current || draft === null) return;
    if (!draft.ok) {
      setProblem(draft.problem);
      return;
    }
    const body = JSON.stringify(draft.body);
    if (keyRef.current === null || keyRef.current.body !== body) keyRef.current = { key: ulid(), body };
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetchApiInspectQcHold(session.tenant.id, hold.id, draft.body, keyRef.current.key);
      onInspected(response);
    } catch (error) {
      if (error instanceof ApiProblem && error.code === 'qc-hold-released') {
        onAlreadyClosed();
        return;
      }
      setProblem(qcReason(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Inspect QC hold" className="flex flex-col gap-3 rounded-sm border border-(--border) bg-(--muted) p-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">
          Inspect <span className="font-mono">{unit.code}</span>
          {hold.grnCode !== null && <> · {hold.grnCode}</>}
        </span>
        <span className="text-xs text-(--muted-foreground)">
          Passed units go back to the origin bin{hold.kind === 'receipt' ? ' (Receiving — putaway work again)' : hold.kind === 'return' ? ' (Returns — they await a disposition again)' : ''}; failed units move to the DAMAGED
          bin (not sellable, write-off only). The hold closes as inspected.
        </span>
      </div>
      {loadProblem !== null ? (
        <div role="alert" className="text-(--destructive)">
          {loadProblem}
        </div>
      ) : arms === null ? (
        <div className="text-(--muted-foreground)">Loading the held stock…</div>
      ) : (
        <>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-(--muted-foreground)">
                <th className="py-1 font-normal">Batch</th>
                <th className="py-1 font-normal">Expiry</th>
                <th className="py-1 text-right font-normal">Held</th>
                <th className="py-1 font-normal">Passed</th>
                <th className="py-1 text-right font-normal">Failed</th>
                <th className="py-1 font-normal">Reason</th>
              </tr>
            </thead>
            <tbody>
              {arms.map((arm, index) => {
                const entry = drafts[index] ?? { passed: '', reason: '' };
                const failed = failedOf(arm.quantity, entry.passed);
                const label = arm.batchCode ?? (arm.batchId === null ? '—' : `…${arm.batchId.slice(-8)}`);
                const passedNumber = failed === null ? 0 : arm.quantity - failed;
                const warning = expiredPassWarning(arm, passedNumber, nowMs);
                return (
                  <tr key={arm.batchId ?? 'untracked'} className="align-top">
                    <td className="py-1 font-mono">{label}</td>
                    <td className="py-1">{arm.expiryDate ?? '—'}</td>
                    <td className="py-1 text-right">{formatQuantity(arm.quantity, unit.uomPrecision)}</td>
                    <td className="py-1">
                      <input
                        ref={index === 0 ? firstInput : undefined}
                        aria-label={`Passed ${label}`}
                        inputMode="decimal"
                        className={inputClass}
                        value={entry.passed}
                        onChange={(e) => setDraft(index, { passed: e.target.value })}
                      />
                      {warning !== null && (
                        <div role="status" className="mt-1 max-w-xs text-(--warning-foreground,inherit)">
                          ⚠ {warning}
                        </div>
                      )}
                    </td>
                    <td className="py-1 text-right">{failed === null ? '—' : formatQuantity(failed, unit.uomPrecision)}</td>
                    <td className="py-1">
                      {failed !== null && failed > 0 ? (
                        <select
                          aria-label={`Fail reason ${label}`}
                          className="rounded-sm border border-(--border) bg-(--background) px-2 py-1 text-sm"
                          value={entry.reason}
                          onChange={(e) => setDraft(index, { reason: e.target.value as QcFailReason | '' })}
                        >
                          <option value="">Pick a reason…</option>
                          {QC_FAIL_REASONS.map((reason) => (
                            <option key={reason} value={reason}>
                              {QC_FAIL_REASON_LABEL[reason]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-(--muted-foreground)">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-(--muted-foreground)">Note (optional; required for Other)</span>
            <textarea
              aria-label="Inspection note"
              className="rounded-sm border border-(--border) bg-(--background) px-2 py-1 text-sm"
              rows={2}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setProblem(null);
              }}
            />
          </label>
          {totals !== null && (
            <div aria-label="Inspection summary" className="font-medium">
              {inspectionSummary(totals.passed, totals.failed, unit.uomPrecision)}
            </div>
          )}
        </>
      )}
      {problem !== null && (
        <div role="alert" className="text-(--destructive)">
          {problem}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || arms === null || loadProblem !== null}
          onClick={() => {
            void submit();
          }}
          className="rounded-md bg-(--primary) px-3 py-1.5 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60"
        >
          {busy ? 'Recording…' : 'Record inspection'}
        </button>
        <button type="button" onClick={onClose} className="rounded-sm border border-(--border) px-3 py-1.5 text-sm hover:bg-(--background)">
          Cancel
        </button>
      </div>
    </div>
  );
}
