'use client';

import { useState, type FormEvent } from 'react';

import { fetchApiCloseRecall } from '@/lib/api/client';
import type { RecallDetailResponse, RecallSnapshotDto } from '@/lib/api/generated';
import { readSession } from '@/lib/auth';
import {
  EMPTY_CLOSE_DRAFT,
  RECALL_EVIDENCE_MAX,
  RECALL_NOTE_MAX,
  closeNeedsOverride,
  pruneCloseDraft,
  notifyRecallsChanged,
  parseCloseRecallDraft,
  recallQuantity,
  recallReason,
  recallReasonStale,
  recallRefusalWord,
  releaseEligible,
  releaseIneligibleReason,
  releaseNeedsOverride,
  releaseStockLabel,
  unaccountedLots,
  type CloseRecallDraft,
} from '@/lib/recalls';
import { useKeyedSubmit } from '@/lib/use-keyed-submit';

import { FeedbackBanner } from '@/components/feedback/banner';
import { Field } from '@/components/shared/field';
import { StatusChip } from '@/components/shared/status-chip';
import { SubmitButton } from '@/components/shared/submit-button';
import { buttonClass, inputClass } from '@/components/shared/surface';

/**
 * Story 3-7a — closing a recall (`qc.manage`, A5/A6): a note; which lots to
 * release (only a lot THIS recall blocked and still blocked for the recall —
 * every other lot says why it stays blocked); an override reason the moment
 * a ticked lot still holds stock on hand, in transit or in open orders; the
 * acknowledgement when any lot's stock does not match its ledger history
 * (unaccounted ≠ 0); an optional disposition note per lot and an evidence
 * reference. The close freezes every lot's figures as of now; no stock
 * moves. Keyed per draft. A refusal that means the recall moved on re-reads
 * the detail and keeps the draft.
 */
export function CloseRecallForm({
  detail,
  onClosed,
  onCancel,
}: {
  readonly detail: RecallDetailResponse;
  readonly onClosed: (recall: RecallSnapshotDto) => void;
  readonly onCancel: () => void;
}) {
  const { recall, lots } = detail;
  const [typed, setDraft] = useState<CloseRecallDraft>(EMPTY_CLOSE_DRAFT);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = useKeyedSubmit();
  // A re-read (detail.lots changes) can make a ticked lot ineligible, or drop
  // a lot: derived at render (guide §1.5), the draft keeps only ticks that are
  // still eligible and notes for lots still on the recall — never a hidden
  // tick that refuses every submit and cannot be unticked.
  const draft = pruneCloseDraft(typed, lots);
  const ticked = new Set(draft.releaseBatchIds);
  const needsOverride = closeNeedsOverride(draft, lots);
  const unaccounted = unaccountedLots(lots);

  function edit(next: Partial<CloseRecallDraft>) {
    setDraft((current) => ({ ...pruneCloseDraft(current, lots), ...next }));
    submit.invalidate();
    setProblem(null);
  }

  async function close(event: FormEvent) {
    event.preventDefault();
    const session = readSession();
    if (session === null) {
      setProblem('Your session expired — sign in again.');
      return;
    }
    const parsed = parseCloseRecallDraft(draft, lots);
    if (parsed.problem !== null) {
      setProblem(parsed.problem);
      return;
    }
    try {
      const result = await submit.run((key) => fetchApiCloseRecall(session.tenant.id, recall.id, parsed.body, key));
      if (!result.sent) return;
      notifyRecallsChanged();
      onClosed(result.value.recall);
    } catch (error) {
      setProblem(recallReason(error, 'close'));
      // The lots moved under the draft: re-read the figures behind it.
      if (recallReasonStale(error)) notifyRecallsChanged();
    }
  }

  const releaseCount = draft.releaseBatchIds.length;
  return (
    <form className="flex max-w-4xl flex-col gap-4 rounded-md border border-(--border) bg-(--muted)/40 p-4" onSubmit={(e) => void close(e)} data-testid="close-recall-form">
      <div className="flex flex-col gap-1">
        <h3 className="font-medium">Close {recall.code}</h3>
        <p className="text-xs text-(--muted-foreground)">
          Closing freezes every lot&apos;s figures as of now — the report keeps both the live and the at-close figures. No stock moves: dispose of it by write-off
          or return first. Lots you do not release stay blocked and can be unblocked later from Batches.
        </p>
      </div>
      <fieldset className="flex flex-col gap-4" disabled={submit.busy}>
        <Field label="Close note" hint="Why the recall is closed — the client reads it on its portal.">
          {(control) => (
            <textarea {...control} name="closeNote" className={inputClass} rows={2} maxLength={RECALL_NOTE_MAX * 2} value={draft.note} onChange={(e) => edit({ note: e.target.value })} />
          )}
        </Field>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Lots</legend>
          <ul className="flex flex-col gap-2">
            {lots.map((lot) => {
              const eligible = releaseEligible(lot);
              const why = releaseIneligibleReason(lot, recall.mode);
              const stock = releaseStockLabel(lot);
              return (
                <li key={lot.batchId} className="flex flex-col gap-1 rounded-sm border border-(--border) bg-(--background) p-2" data-lot={lot.batchCode}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{lot.batchCode}</span>
                    <span className="text-xs text-(--muted-foreground)">
                      {lot.skuCode} — {lot.skuName}
                    </span>
                    {lot.figures.unaccounted !== 0 && (
                      <StatusChip tone="warning" glyph="⚠">
                        Unaccounted {recallQuantity(lot.figures.unaccounted, lot.uom)}
                      </StatusChip>
                    )}
                  </div>
                  {eligible ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        aria-label={`Release ${lot.batchCode}`}
                        checked={ticked.has(lot.batchId)}
                        onChange={() => {
                          const next = new Set(ticked);
                          if (next.has(lot.batchId)) next.delete(lot.batchId);
                          else next.add(lot.batchId);
                          edit({ releaseBatchIds: [...next] });
                        }}
                      />
                      <span>Release — unblock it in every warehouse</span>
                      {stock !== null && releaseNeedsOverride(lot) && <span className="text-xs text-(--warning)">· still has stock: {stock}</span>}
                    </label>
                  ) : (
                    <span className="text-xs text-(--muted-foreground)" data-testid="release-ineligible">
                      {why}
                    </span>
                  )}
                  <Field label={`Disposition of ${lot.batchCode} (optional)`} className="flex flex-col gap-1">
                    {(control) => (
                      <input
                        {...control}
                        className={inputClass}
                        placeholder="Destroyed under certificate …, returned to the brand …"
                        maxLength={RECALL_NOTE_MAX * 2}
                        value={draft.dispositionNotes[lot.batchId] ?? ''}
                        onChange={(e) => edit({ dispositionNotes: { ...draft.dispositionNotes, [lot.batchId]: e.target.value } })}
                      />
                    )}
                  </Field>
                </li>
              );
            })}
          </ul>
        </fieldset>

        {needsOverride && (
          <Field label="Why release with stock still there?" hint="A ticked lot still has stock on hand, in transit or in open orders. The reason is audited on each lot's unblock.">
            {(control) => (
              <textarea
                {...control}
                name="overrideReason"
                className={inputClass}
                rows={2}
                maxLength={RECALL_NOTE_MAX * 2}
                value={draft.overrideReason}
                onChange={(e) => edit({ overrideReason: e.target.value })}
              />
            )}
          </Field>
        )}

        {unaccounted.length > 0 && (
          <label className="flex items-start gap-2 rounded-sm border border-(--warning) bg-(--warning)/10 p-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              aria-label="Acknowledge the unaccounted stock"
              checked={draft.acknowledgeUnaccounted}
              onChange={(e) => edit({ acknowledgeUnaccounted: e.target.checked })}
            />
            <span>
              {unaccounted.map((lot) => lot.batchCode).join(', ')} {unaccounted.length === 1 ? 'has' : 'have'} stock that does not match the ledger history. Close
              anyway — the acknowledgement is audited.
            </span>
          </label>
        )}

        <Field label="Evidence reference (optional)" hint="A destruction certificate number or similar." className="flex max-w-md flex-col gap-1">
          {(control) => (
            <input {...control} name="evidenceRef" className={inputClass} maxLength={RECALL_EVIDENCE_MAX * 2} value={draft.evidenceRef} onChange={(e) => edit({ evidenceRef: e.target.value })} />
          )}
        </Field>
      </fieldset>
      {problem !== null && <FeedbackBanner tone="rejected" word={recallRefusalWord('close')} reason={problem} />}
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton
          busy={submit.busy}
          label={releaseCount === 0 ? 'Close recall' : `Close and release ${releaseCount} ${releaseCount === 1 ? 'lot' : 'lots'}`}
          busyLabel="Closing…"
        />
        <button type="button" className={buttonClass} disabled={submit.busy} onClick={onCancel}>
          Discard
        </button>
      </div>
    </form>
  );
}
