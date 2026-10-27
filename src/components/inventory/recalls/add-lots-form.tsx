'use client';

import { useState, type FormEvent } from 'react';

import { fetchApiAddRecallBatches } from '@/lib/api/client';
import type { RecallCandidateDto, RecallHeaderDto, RecallSnapshotDto } from '@/lib/api/generated';
import { readSession } from '@/lib/auth';
import {
  CANDIDATES_TRUNCATED,
  RECALL_MAX_LOTS,
  candidateAvailability,
  candidatesSummary,
  notifyRecallsChanged,
  parseAddBatchesDraft,
  preTickedCandidates,
  recallReason,
  recallRefusalWord,
} from '@/lib/recalls';
import { useKeyedSubmit } from '@/lib/use-keyed-submit';
import { useRecallCandidates } from '@/lib/use-recalls';

import { FeedbackBanner } from '@/components/feedback/banner';
import { CandidateChecklist } from '@/components/inventory/recalls/candidate-checklist';
import { Field } from '@/components/shared/field';
import { SkeletonBar } from '@/components/shared/skeleton';
import { SubmitButton } from '@/components/shared/submit-button';
import { ReadFailure, buttonClass, inputClass } from '@/components/shared/surface';

/**
 * Story 3-7a (A14) — "Add lots" to an OPEN recall (`qc.manage`): a matching
 * batch found later — a second SKU with the same lot code, or a lot received
 * after the recall opened. The candidates read for the recall's own client;
 * the recall's lots read "On this recall", a lot on another live recall
 * cannot be ticked, exact matches are pre-ticked. At most 50 lots in all.
 * Keyed per draft.
 */
export function AddLotsForm({
  recall,
  lotCount,
  onAdded,
  onCancel,
}: {
  readonly recall: RecallHeaderDto;
  readonly lotCount: number;
  readonly onAdded: (recall: RecallSnapshotDto, added: number) => void;
  readonly onCancel: () => void;
}) {
  const [codeDraft, setCodeDraft] = useState('');
  const [query, setQuery] = useState<{ clientId: string; code: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = useKeyedSubmit();
  const candidates = useRecallCandidates(query);
  const key = query === null ? '' : query.code;
  const items: readonly RecallCandidateDto[] = candidates.state === 'ready' ? candidates.data.items : [];
  const [ticks, setTicks] = useState<{ key: string; ids: ReadonlySet<string> } | null>(null);
  const selected: ReadonlySet<string> =
    ticks !== null && ticks.key === key ? ticks.ids : new Set(candidates.state === 'ready' ? preTickedCandidates(items, recall.mode, recall.id) : []);
  const sendable = items.filter((c) => candidateAvailability(c, recall.mode, recall.id).kind === 'selectable' && selected.has(c.batchId)).map((c) => c.batchId);

  function find(event: FormEvent) {
    event.preventDefault();
    const code = codeDraft.trim();
    if (!/[A-Za-z0-9]/.test(code)) {
      setProblem('Type the lot code from the label or the brand’s notice.');
      return;
    }
    submit.invalidate();
    setProblem(null);
    setQuery({ clientId: recall.clientId, code });
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const session = readSession();
    if (session === null) {
      setProblem('Your session expired — sign in again.');
      return;
    }
    const parsed = parseAddBatchesDraft(sendable, lotCount);
    if (parsed.problem !== null) {
      setProblem(parsed.problem);
      return;
    }
    try {
      const result = await submit.run((k) => fetchApiAddRecallBatches(session.tenant.id, recall.id, parsed.body, k));
      if (!result.sent) return;
      notifyRecallsChanged();
      onAdded(result.value.recall, parsed.body.batchIds.length);
    } catch (error) {
      setProblem(recallReason(error, 'add'));
    }
  }

  return (
    <div className="flex max-w-4xl flex-col gap-3 rounded-md border border-(--border) bg-(--muted)/40 p-4" data-testid="add-lots-form">
      <div className="flex flex-col gap-1">
        <h3 className="font-medium">Add lots to {recall.code}</h3>
        <p className="text-xs text-(--muted-foreground)">
          Lots of {recall.clientCode} only — {lotCount} of {RECALL_MAX_LOTS} lots used.{' '}
          {recall.mode === 'live' ? 'A live recall blocks each one in every warehouse.' : 'A mock recall blocks nothing.'}
        </p>
      </div>
      <form className="flex flex-wrap items-end gap-3" onSubmit={find} role="search" aria-label="Find more lots">
        <Field label="Lot code" className="flex w-72 flex-col gap-1">
          {(control) => <input {...control} name="addLotCode" className={inputClass} value={codeDraft} disabled={submit.busy} onChange={(e) => setCodeDraft(e.target.value)} />}
        </Field>
        <button type="submit" className={buttonClass} disabled={submit.busy}>
          Find lots
        </button>
      </form>
      {query !== null && candidates.state === 'loading' && <SkeletonBar className="h-8 w-full" />}
      {candidates.state === 'failed' && <ReadFailure word="Lots not found" reason={candidates.reason} onRetry={candidates.reload} />}
      {candidates.state === 'ready' && query !== null && (
        <form className="flex flex-col gap-2" onSubmit={(e) => void add(e)} aria-label="Lots to add">
          <p className="text-sm">{candidatesSummary(candidates.data.normalisedCode, items)}</p>
          {candidates.data.truncated && (
            <div data-testid="candidates-truncated">
              <FeedbackBanner tone="warning" word="Too many matches" reason={CANDIDATES_TRUNCATED} />
            </div>
          )}
          {items.length > 0 && (
            <CandidateChecklist
              items={items}
              mode={recall.mode}
              recallId={recall.id}
              selected={selected}
              disabled={submit.busy}
              onToggle={(id) => {
                const next = new Set(selected);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                setTicks({ key, ids: next });
                submit.invalidate();
                setProblem(null);
              }}
            />
          )}
          {problem !== null && <FeedbackBanner tone="rejected" word={recallRefusalWord('add')} reason={problem} />}
          <div className="flex flex-wrap gap-2">
            <SubmitButton
              busy={submit.busy}
              ready={sendable.length > 0}
              notReadyReason="Tick at least one lot to add."
              label={`Add ${sendable.length} ${sendable.length === 1 ? 'lot' : 'lots'}`}
              busyLabel="Adding…"
            />
            <button type="button" className={buttonClass} disabled={submit.busy} onClick={onCancel}>
              Discard
            </button>
          </div>
        </form>
      )}
      {(candidates.state !== 'ready' || query === null) && (
        <div className="flex flex-col gap-2">
          {problem !== null && <FeedbackBanner tone="rejected" word={recallRefusalWord('add')} reason={problem} />}
          <div>
            <button type="button" className={buttonClass} onClick={onCancel}>
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
