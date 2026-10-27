'use client';

import { useRef, useState, type FormEvent } from 'react';

import { fetchApiAddRecallBatches, fetchApiOpenRecall } from '@/lib/api/client';
import type { ClientDto, RecallCandidateDto, RecallSnapshotDto } from '@/lib/api/generated';
import { readSession } from '@/lib/auth';
import {
  BRAND_REF_HINT,
  CANDIDATES_TRUNCATED,
  RECALL_MODE_HELP,
  RECALL_MODE_LABEL,
  RECALL_NOTE_MAX,
  RECALL_REF_MAX,
  REASON_NOTE_HINT,
  addBatchesOutcome,
  candidateAvailability,
  candidatesSummary,
  notifyRecallsChanged,
  parseOpenRecallDraft,
  preTickedCandidates,
  recallReason,
  recallRefusalWord,
  type RecallMode,
} from '@/lib/recalls';
import { ulid } from '@/lib/ulid';
import { useKeyedSubmit } from '@/lib/use-keyed-submit';
import { findRecallByCode, useRecallCandidates } from '@/lib/use-recalls';

import { FeedbackBanner } from '@/components/feedback/banner';
import { CandidateChecklist } from '@/components/inventory/recalls/candidate-checklist';
import { Field } from '@/components/shared/field';
import { SkeletonBar } from '@/components/shared/skeleton';
import { SubmitButton } from '@/components/shared/submit-button';
import { ReadFailure, buttonClass, inputClass, rowButtonClass, selectClass } from '@/components/shared/surface';

const MODES: readonly RecallMode[] = ['live', 'mock'];

/**
 * Story 3-7a — "Open a recall" (`qc.manage`, decision 11): pick the client,
 * type the lot code from the brand's notice, and the candidates read lists
 * every batch of that client whose code matches — EXACT matches pre-ticked,
 * similar ones labelled to check against the label. The reason note is
 * visible to the client; the brand reference links the recalls of one
 * vendor lot across clients; live blocks now, mock is a drill.
 *
 * The key is per draft (`useKeyedSubmit`): any edit — client, ticks, note,
 * reference, mode — invalidates it; a retry of the unchanged draft replays.
 * A lot whose code is already on an open recall of the client offers "Add to
 * RCL-x" (A14) — an inline confirmation keyed per confirmation.
 */
export function OpenRecallForm({
  clients,
  defaultClientId,
  onOpened,
  onCancel,
}: {
  readonly clients: readonly ClientDto[];
  readonly defaultClientId: string;
  readonly onOpened: (recall: RecallSnapshotDto) => void;
  readonly onCancel: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const clientId = picked ?? defaultClientId;
  const [codeDraft, setCodeDraft] = useState('');
  const [query, setQuery] = useState<{ clientId: string; code: string } | null>(null);
  const [mode, setMode] = useState<RecallMode>('live');
  const [reasonNote, setReasonNote] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ word: string; reason: string } | null>(null);
  const submit = useKeyedSubmit();

  const candidates = useRecallCandidates(query);
  const candidatesKey = query === null ? '' : `${query.clientId}|${query.code}`;
  const items: readonly RecallCandidateDto[] = candidates.state === 'ready' ? candidates.data.items : [];
  // Keyed derivation (guide §1.5): the ticks belong to one candidates answer —
  // until the viewer ticks, they are the pre-ticked EXACT matches.
  const [ticks, setTicks] = useState<{ key: string; ids: ReadonlySet<string> } | null>(null);
  const selected: ReadonlySet<string> =
    ticks !== null && ticks.key === candidatesKey ? ticks.ids : new Set(candidates.state === 'ready' ? preTickedCandidates(items, mode) : []);
  const selectable = items.filter((c) => candidateAvailability(c, mode).kind === 'selectable');
  const sendable = selectable.filter((c) => selected.has(c.batchId)).map((c) => c.batchId);

  function edited() {
    submit.invalidate();
    setProblem(null);
    setRefusal(null);
  }

  function find(event: FormEvent) {
    event.preventDefault();
    const code = codeDraft.trim();
    if (clientId === '') {
      setProblem('Pick the client whose lot is recalled.');
      return;
    }
    if (!/[A-Za-z0-9]/.test(code)) {
      setProblem('Type the lot code from the label or the brand’s notice.');
      return;
    }
    edited();
    setNotice(null);
    setQuery({ clientId, code });
  }

  async function open(event: FormEvent) {
    event.preventDefault();
    const session = readSession();
    if (session === null) {
      setRefusal('Your session expired — sign in again.');
      return;
    }
    const parsed = parseOpenRecallDraft({ clientId: query?.clientId ?? '', batchIds: sendable, reasonNote, externalRef, mode });
    if (parsed.problem !== null) {
      setProblem(parsed.problem);
      return;
    }
    setProblem(null);
    setRefusal(null);
    try {
      const result = await submit.run((key) => fetchApiOpenRecall(session.tenant.id, parsed.body, key));
      if (!result.sent) return;
      notifyRecallsChanged();
      onOpened(result.value.recall);
    } catch (error) {
      setRefusal(recallReason(error, 'open'));
    }
  }

  return (
    <div className="flex max-w-4xl flex-col gap-4 rounded-md border border-(--border) bg-(--muted)/40 p-4" data-testid="open-recall-form">
      <div className="flex flex-col gap-1">
        <h3 className="font-medium">Open a recall</h3>
        <p className="text-xs text-(--muted-foreground)">
          A recall names one client&apos;s lots. A live recall blocks every active one in every warehouse in the same moment, lists where the units sit and which
          open orders hold them, traces every shipment and receipt, and gives the brand its report.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3" onSubmit={find} role="search" aria-label="Find the recalled lot">
        <Field label="Client" className="flex w-56 flex-col gap-1">
          {(control) => (
            <select
              {...control}
              className={selectClass}
              value={clientId}
              disabled={submit.busy}
              onChange={(e) => {
                setPicked(e.target.value);
                edited();
              }}
            >
              <option value="">Pick a client…</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.code} — {client.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Lot code" hint="Punctuation and case are ignored: AB-12/3 also finds AB123." className="flex w-72 flex-col gap-1">
          {(control) => (
            <input
              {...control}
              name="lotCode"
              className={inputClass}
              value={codeDraft}
              placeholder="As printed on the label"
              disabled={submit.busy}
              onChange={(e) => setCodeDraft(e.target.value)}
            />
          )}
        </Field>
        <button type="submit" className={buttonClass} disabled={submit.busy}>
          Find lots
        </button>
      </form>

      {query !== null && candidates.state === 'loading' && (
        <div className="flex flex-col gap-2" role="status" aria-label="Finding the lots">
          <SkeletonBar className="h-3 w-64" />
          <SkeletonBar className="h-8 w-full" />
        </div>
      )}
      {candidates.state === 'failed' && <ReadFailure word="Lots not found" reason={candidates.reason} onRetry={candidates.reload} />}
      {notice !== null && <FeedbackBanner tone="accepted" word={notice.word} reason={notice.reason} />}
      {candidates.state === 'ready' && query !== null && (
        <div className="flex flex-col gap-2">
          <p className="text-sm" data-testid="candidates-summary">
            {candidatesSummary(candidates.data.normalisedCode, items)}
          </p>
          {candidates.data.truncated && (
            <div data-testid="candidates-truncated">
              <FeedbackBanner tone="warning" word="Too many matches" reason={CANDIDATES_TRUNCATED} />
            </div>
          )}
          {items.length > 0 && (
            <CandidateChecklist
              items={items}
              mode={mode}
              selected={selected}
              disabled={submit.busy}
              onToggle={(id) => {
                const next = new Set(selected);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                setTicks({ key: candidatesKey, ids: next });
                edited();
              }}
              renderAdd={(candidate) => (
                <AddToOpenRecall
                  key={candidate.batchId}
                  candidate={candidate}
                  clientId={query.clientId}
                  onAdded={(word, reason) => {
                    setNotice({ word, reason });
                    notifyRecallsChanged();
                  }}
                />
              )}
            />
          )}
        </div>
      )}

      {candidates.state === 'ready' && items.length > 0 && (
        <form className="flex flex-col gap-3" onSubmit={(e) => void open(e)} aria-label="Recall details">
          <fieldset className="flex flex-col gap-3" disabled={submit.busy}>
            <Field label="Reason note" hint={REASON_NOTE_HINT}>
              {(control) => (
                <textarea
                  {...control}
                  name="reasonNote"
                  className={inputClass}
                  rows={2}
                  maxLength={RECALL_NOTE_MAX * 2}
                  value={reasonNote}
                  onChange={(e) => {
                    setReasonNote(e.target.value);
                    edited();
                  }}
                />
              )}
            </Field>
            <Field label="Brand reference (optional)" hint={BRAND_REF_HINT} className="flex max-w-md flex-col gap-1">
              {(control) => (
                <input
                  {...control}
                  name="externalRef"
                  className={inputClass}
                  maxLength={RECALL_REF_MAX * 2}
                  value={externalRef}
                  onChange={(e) => {
                    setExternalRef(e.target.value);
                    edited();
                  }}
                />
              )}
            </Field>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Kind of recall</legend>
              {MODES.map((value) => (
                <label key={value} className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="recallMode"
                    value={value}
                    className="mt-1"
                    checked={mode === value}
                    onChange={() => {
                      setMode(value);
                      edited();
                    }}
                  />
                  <span className="flex flex-col">
                    <span className="font-medium">{RECALL_MODE_LABEL[value]}</span>
                    <span className="text-xs text-(--muted-foreground)">{RECALL_MODE_HELP[value]}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </fieldset>
          {problem !== null && <FeedbackBanner tone="rejected" word={recallRefusalWord('open')} reason={problem} />}
          {refusal !== null && <FeedbackBanner tone="rejected" word={recallRefusalWord('open')} reason={refusal} />}
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton
              busy={submit.busy}
              ready={sendable.length > 0}
              notReadyReason="Tick at least one lot to recall."
              label={
                mode === 'mock'
                  ? `Open mock recall over ${sendable.length} ${sendable.length === 1 ? 'lot' : 'lots'}`
                  : `Recall ${sendable.length} ${sendable.length === 1 ? 'lot' : 'lots'}`
              }
              busyLabel="Opening…"
            />
            <button type="button" className={buttonClass} disabled={submit.busy} onClick={onCancel}>
              Discard
            </button>
          </div>
        </form>
      )}
      {(candidates.state !== 'ready' || items.length === 0) && (
        <div className="flex flex-col gap-2">
          {problem !== null && <FeedbackBanner tone="rejected" word="Not found" reason={problem} />}
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

/**
 * A14 — "Add to RCL-x": a lot whose code is already on an open recall of
 * the client joins THAT recall rather than opening a second one. An inline
 * confirmation (never a second modal), keyed per confirmation: a retry of
 * it reuses the key; the next confirmation mints a new one.
 */
function AddToOpenRecall({
  candidate,
  clientId,
  onAdded,
}: {
  readonly candidate: RecallCandidateDto;
  readonly clientId: string;
  readonly onAdded: (word: string, reason: string) => void;
}) {
  const recallCode = candidate.sameCodeOnOpenRecall!;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  async function add() {
    const session = readSession();
    if (session === null || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    keyRef.current ??= ulid();
    try {
      const recall = await findRecallByCode(session.tenant.id, recallCode, { clientId, status: 'open' });
      if (recall === null) {
        setProblem(`${recallCode} is no longer open — refresh the lots.`);
        return;
      }
      const { recall: snapshot } = await fetchApiAddRecallBatches(session.tenant.id, recall.id, { batchIds: [candidate.batchId] }, keyRef.current);
      keyRef.current = null;
      setConfirming(false);
      const outcome = addBatchesOutcome(snapshot, 1);
      onAdded(outcome.word, `${candidate.batchCode} of ${candidate.skuCode}: ${outcome.reason}`);
    } catch (error) {
      setProblem(recallReason(error, 'add'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button type="button" className={rowButtonClass} onClick={() => setConfirming(true)}>
        Add to {recallCode}
      </button>
    );
  }
  return (
    <span className="flex flex-col gap-1" data-testid="add-to-recall-confirm">
      <span>
        Add {candidate.batchCode} to {recallCode}? A live recall blocks it in every warehouse.
      </span>
      <span className="flex gap-1">
        <button type="button" className={rowButtonClass} disabled={busy} onClick={() => void add()}>
          {busy ? 'Adding…' : `Add ${candidate.batchCode}`}
        </button>
        <button
          type="button"
          className={rowButtonClass}
          disabled={busy}
          onClick={() => {
            keyRef.current = null;
            setConfirming(false);
            setProblem(null);
          }}
        >
          Cancel
        </button>
      </span>
      {problem !== null && (
        <span role="alert" className="text-(--destructive)">
          {problem}
        </span>
      )}
    </span>
  );
}
